/**
 * Report service tests — snapshot writer, diff, and the
 * locale-resolving getAuditReport reader. i18n coverage runs against every
 * one of the seven supported locales so a translation regression is caught
 * here, before the report screen renders it.
 */
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES, type SupportedLocale } from '../../shared/i18n/index.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { scanForForbidden } from '../../shared/security/denylist-scan.js';
import { Site } from '../sites/index.js';
import { AuditRun } from './audit-run.model.js';
import { AuditedPage } from './audited-page.model.js';
import { ReportSnapshot } from './report-snapshot.model.js';
import {
  diffSnapshots,
  emptyDiff,
  getAuditReport,
  getLatestSiteReport,
  resolveGscReasonKey,
  localizeAuditRuleCopy,
  writeReportSnapshot,
} from './report.service.js';
import { makeAuditResult } from './rules/fixtures.js';

beforeAll(() => startMemoryMongo());
afterAll(() => stopMemoryMongo());
beforeEach(() => clearCollections());

async function seedRun(overrides: { indexAfter?: string } = {}) {
  const accountId = new mongoose.Types.ObjectId();
  const site = await Site.create({
    accountId,
    url: 'https://example.com',
    domain: 'example.com',
  });
  const run = await AuditRun.create({
    accountId,
    siteId: site._id,
    pageCap: 100,
    status: 'queued',
    ...(overrides.indexAfter ? {} : {}),
  });
  return {
    accountId: accountId.toHexString(),
    siteId: site.id as string,
    runId: run.id as string,
  };
}

// ---------------------------------------------------------------------------
// writeReportSnapshot
// ---------------------------------------------------------------------------

describe('writeReportSnapshot', () => {
  it('persists one snapshot per run with counts and findings', async () => {
    const ids = await seedRun();
    const result = makeAuditResult({
      pages: [{ url: 'https://example.com/a', title: null }],
    });
    const snap = await writeReportSnapshot({ ...ids, result });
    expect(snap.counts.fixNow).toBeGreaterThan(0);
    expect(snap.findings.length).toBeGreaterThan(0);

    const round = await ReportSnapshot.findOne({ runId: ids.runId });
    expect(round?.findings.length).toBe(snap.findings.length);
  });

  it('is idempotent — a second write for the same run updates in place', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult({
        pages: [{ url: 'https://example.com/a', title: null }],
      }),
    });
    const count = await ReportSnapshot.countDocuments({ runId: ids.runId });
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// diffSnapshots
// ---------------------------------------------------------------------------

describe('diffSnapshots', () => {
  it('empties the diff when there is no previous snapshot', () => {
    const diff = diffSnapshots(null, { findings: [] });
    expect(diff).toEqual(emptyDiff());
  });

  it('marks findings fixed, regressed, new, and unchanged', () => {
    const prev = {
      findings: [
        {
          ruleId: 'title-missing-or-weak',
          bucket: 'fix-now',
          affectedUrls: ['https://example.com/a'],
        },
        {
          ruleId: 'https-canonicalization',
          bucket: 'passed',
          affectedUrls: [],
        },
        {
          ruleId: 'headings-weak',
          bucket: 'passed',
          affectedUrls: [],
        },
      ],
    };
    const next = {
      findings: [
        // fixed (was fix-now, now passed on same url — modeled as passing with no urls)
        {
          ruleId: 'title-missing-or-weak',
          bucket: 'passed',
          affectedUrls: [],
        },
        // regressed (was passed, now fix-now site-wide)
        {
          ruleId: 'https-canonicalization',
          bucket: 'fix-now',
          affectedUrls: [],
        },
        // unchanged
        {
          ruleId: 'headings-weak',
          bucket: 'passed',
          affectedUrls: [],
        },
        // new — not present in prev at all
        {
          ruleId: 'thin-content',
          bucket: 'watch',
          affectedUrls: ['https://example.com/tiny'],
        },
      ],
    };
    const diff = diffSnapshots(prev, next);
    expect(diff.summary.fixed).toBeGreaterThanOrEqual(1);
    expect(diff.summary.regressed).toBe(1);
    expect(diff.summary.new).toBe(1);
    expect(diff.summary.unchanged).toBeGreaterThanOrEqual(1);
    const kinds = new Set(diff.entries.map((e) => e.kind));
    expect(kinds).toContain('fixed');
    expect(kinds).toContain('regressed');
    expect(kinds).toContain('new');
    expect(kinds).toContain('unchanged');
  });

  it('entries are sorted deterministically by ruleId then url', () => {
    const prev = { findings: [] };
    const next = {
      findings: [
        { ruleId: 'z-rule', bucket: 'watch', affectedUrls: ['https://z/'] },
        {
          ruleId: 'a-rule',
          bucket: 'watch',
          affectedUrls: ['https://a/2', 'https://a/1'],
        },
      ],
    };
    const diff = diffSnapshots(prev, next);
    expect(diff.entries.map((e) => `${e.ruleId}||${e.url}`)).toEqual([
      'a-rule||https://a/1',
      'a-rule||https://a/2',
      'z-rule||https://z/',
    ]);
  });

  it('treats a next=passed with no prior entry as unchanged (no false new)', () => {
    const diff = diffSnapshots(
      { findings: [] },
      {
        findings: [
          { ruleId: 'title-missing-or-weak', bucket: 'passed', affectedUrls: [] },
        ],
      },
    );
    expect(diff.summary.new).toBe(0);
    expect(diff.summary.unchanged).toBe(1);
  });

  it('treats prev-only passed entries as unchanged (dropped but was already fine)', () => {
    const diff = diffSnapshots(
      {
        findings: [
          { ruleId: 'title-missing-or-weak', bucket: 'passed', affectedUrls: [] },
        ],
      },
      { findings: [] },
    );
    expect(diff.summary.unchanged).toBe(1);
    expect(diff.summary.fixed).toBe(0);
  });

  it('marks matching-key finding as fixed when next=passed (both site-wide)', () => {
    const diff = diffSnapshots(
      {
        findings: [
          {
            ruleId: 'https-canonicalization',
            bucket: 'fix-now',
            affectedUrls: [],
          },
        ],
      },
      {
        findings: [
          {
            ruleId: 'https-canonicalization',
            bucket: 'passed',
            affectedUrls: [],
          },
        ],
      },
    );
    expect(diff.summary.fixed).toBe(1);
    expect(diff.entries).toEqual([
      { ruleId: 'https-canonicalization', url: '', kind: 'fixed' },
    ]);
  });

  it('treats prev-only non-passed entries as fixed', () => {
    const diff = diffSnapshots(
      {
        findings: [
          {
            ruleId: 'title-missing-or-weak',
            bucket: 'fix-now',
            affectedUrls: ['https://example.com/a'],
          },
        ],
      },
      { findings: [] },
    );
    expect(diff.summary.fixed).toBe(1);
  });

  it('handles urls containing "||" without ruleId/url collisions', () => {
    // A URL that literally contains `||` used to collide with the previous
    // `${ruleId}||${url}` separator (misparsed into ruleId="a", url="b" for
    // key "a||||b"). The JSON tuple key keeps them separable.
    const badUrl = 'https://example.com/a||b';
    const diff = diffSnapshots(
      {
        findings: [
          {
            ruleId: 'broken-internal-links',
            bucket: 'fix-now',
            affectedUrls: [badUrl],
          },
        ],
      },
      {
        findings: [
          {
            ruleId: 'broken-internal-links',
            bucket: 'passed',
            affectedUrls: [badUrl],
          },
        ],
      },
    );
    expect(diff.entries).toEqual([
      { ruleId: 'broken-internal-links', url: badUrl, kind: 'fixed' },
    ]);
    expect(diff.summary.fixed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getAuditReport (with i18n across all 7 locales)
// ---------------------------------------------------------------------------

describe('getAuditReport', () => {
  it('404s on unknown runId (invalid ObjectId)', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    await expect(
      getAuditReport({ runId: 'not-an-id', accountId, locale: 'en' }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('404s cross-account (no existence leak)', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });
    const foreignAccountId = new mongoose.Types.ObjectId().toHexString();
    await expect(
      getAuditReport({ runId: ids.runId, accountId: foreignAccountId, locale: 'en' }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('404s when run exists but snapshot has not been written', async () => {
    const ids = await seedRun();
    await expect(
      getAuditReport({ runId: ids.runId, accountId: ids.accountId, locale: 'en' }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('returns an empty diff on the first run (no prior snapshot)', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.diff).toEqual(emptyDiff());
  });

  it('returns a stored AI summary and infers succeeded when the legacy job field is absent', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });
    const createdAt = new Date('2026-07-16T09:00:00.000Z');
    await ReportSnapshot.updateOne(
      { runId: ids.runId },
      {
        $set: {
          aiSummary: {
            text: 'A concise audit summary.',
            locale: 'en',
            model: 'fake-summary-v1',
            truncated: false,
            createdAt,
          },
        },
        $unset: { aiSummaryJob: 1 },
      },
    );

    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.aiSummary).toEqual({
      text: 'A concise audit summary.',
      locale: 'en',
      model: 'fake-summary-v1',
      truncated: false,
      createdAt: createdAt.toISOString(),
    });
    expect(report.aiSummaryStatus).toBe('succeeded');
    expect(report.aiSummaryAvailability).toEqual({
      requestedLocale: 'en',
      availableLocales: ['en'],
      status: 'succeeded',
    });
  });

  it('projects only the requested summary variant and honestly reports a locale miss', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });
    await ReportSnapshot.updateOne(
      { runId: ids.runId },
      {
        $set: {
          'aiSummaryVariantsByLocale.ar': {
            text: 'أصلح العناوين أولاً.',
            locale: 'ar',
            model: 'model-ar',
            truncated: false,
            createdAt: new Date('2026-08-25T09:00:00.000Z'),
          },
          'aiSummaryVariantsByLocale.fr': {
            text: 'Corrigez les titres en premier.',
            locale: 'fr',
            model: 'model-fr',
            truncated: false,
            createdAt: new Date('2026-08-25T09:01:00.000Z'),
          },
          aiSummary: {
            text: 'Legacy English only.',
            locale: 'en',
            model: 'legacy',
            truncated: false,
            createdAt: new Date('2026-08-25T08:00:00.000Z'),
          },
        },
      },
    );
    const arabic = await getAuditReport({ ...ids, locale: 'ar' });
    expect(arabic.aiSummary?.text).toBe('أصلح العناوين أولاً.');
    expect(arabic.aiSummaryAvailability).toEqual({
      requestedLocale: 'ar',
      availableLocales: ['ar', 'en', 'fr'],
      status: 'succeeded',
    });
    const german = await getAuditReport({ ...ids, locale: 'de' });
    expect(german.aiSummary).toBeNull();
    expect(german.aiSummaryStatus).toBe('idle');
    expect(german.aiSummaryAvailability).toEqual({
      requestedLocale: 'de',
      availableLocales: ['ar', 'en', 'fr'],
      status: 'idle',
    });
  });

  it('populates a diff against the previous run for the same site', async () => {
    const ids = await seedRun();
    // First run: broken title → snapshot with fix-now.
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult({
        pages: [{ url: 'https://example.com/a', title: null }],
      }),
    });
    // Second run for the same site: fixed.
    const site = await Site.findById(ids.siteId);
    const run2 = await AuditRun.create({
      accountId: new mongoose.Types.ObjectId(ids.accountId),
      siteId: site!._id,
      pageCap: 100,
      status: 'queued',
    });
    await writeReportSnapshot({
      runId: run2.id as string,
      siteId: ids.siteId,
      accountId: ids.accountId,
      result: makeAuditResult(),
    });
    const report = await getAuditReport({
      runId: run2.id as string,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.diff.entries.length).toBeGreaterThan(0);
    // At least one 'fixed' entry from title-missing-or-weak.
    expect(report.diff.summary.fixed).toBeGreaterThanOrEqual(1);
  });

  it.each(SUPPORTED_LOCALES)(
    'resolves auditRules copy in %s (never falls back to a raw key)',
    async (locale: SupportedLocale) => {
      const ids = await seedRun();
      await writeReportSnapshot({ ...ids, result: makeAuditResult() });
      const report = await getAuditReport({
        runId: ids.runId,
        accountId: ids.accountId,
        locale,
      });
      for (const finding of report.findings) {
        // A raw key would still contain a dot (`auditRules.robots-blocked.title`);
        // any resolved value has been read from the dictionary.
        expect(finding.copy.title).not.toContain('auditRules.');
        expect(finding.copy.why).not.toContain('auditRules.');
        expect(finding.copy.fix).not.toContain('auditRules.');
        expect(finding.copy.passedLabel).not.toContain('auditRules.');
        expect(finding.copy.title.length).toBeGreaterThan(0);
      }
    },
  );

  it('a known rule title differs between two locales (real translations, not identical strings)', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });
    const en = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    const fr = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'fr',
    });
    const enRobots = en.findings.find((f) => f.ruleId === 'robots-blocked');
    const frRobots = fr.findings.find((f) => f.ruleId === 'robots-blocked');
    expect(enRobots!.copy.title).not.toBe(frRobots!.copy.title);
  });

  it('surfaces a pageSpeed section when the snapshot carries samples', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult(),
      pageSpeed: {
        status: 'ok',
        samples: [
          {
            url: 'https://example.com/',
            strategy: 'mobile',
            labScores: { performance: 92, accessibility: 90, bestPractices: 92, seo: 100 },
            coreWebVitals: { lcpMs: 1800, inp: 120, cls: 0.05, category: 'good' },
            mobileFriendly: true,
            fieldDataLevel: 'url',
          },
        ],
      },
    });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.pageSpeed?.status).toBe('ok');
    expect(report.pageSpeed?.samples[0]?.url).toBe('https://example.com/');
    expect(report.pageSpeed?.samples[0]?.fieldDataLevel).toBe('url');
  });

  it('surfaces pageSpeed=null when the snapshot has no pageSpeed section', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.pageSpeed).toBeNull();
  });

  it('surfaces an unavailable pageSpeed section so the UI can show a note (release-gate)', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult(),
      pageSpeed: { status: 'unavailable', samples: [] },
    });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.pageSpeed?.status).toBe('unavailable');
  });

  it('surfaces an indexStatus section when the snapshot carries samples', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult(),
      indexStatus: {
        status: 'ok',
        samples: [
          {
            url: 'https://example.com/',
            inspection: {
              indexVerdict: 'PASS',
              coverageState: 'Submitted and indexed',
              robotsTxtState: 'ALLOWED',
              pageFetchState: 'SUCCESSFUL',
              googleCanonical: 'https://example.com/',
              lastCrawlTime: new Date('2026-01-01T00:00:00.000Z'),
              richResults: {
                verdict: 'PASS',
                items: [{ type: 'FAQ', issues: 0 }],
              },
            },
          },
        ],
      },
    });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.indexStatus?.status).toBe('ok');
    expect(report.indexStatus?.samples[0]?.url).toBe('https://example.com/');
    expect(report.indexStatus?.samples[0]?.inspection.indexVerdict).toBe('PASS');
    expect(report.indexStatus?.samples[0]?.inspection.richResults.items).toEqual([
      { type: 'FAQ', issues: 0 },
    ]);
  });

  it('surfaces indexStatus=null when the snapshot has no indexStatus section', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.indexStatus).toBeNull();
  });

  it('surfaces an unavailable indexStatus section (release-gate)', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult(),
      indexStatus: { status: 'needs-reconnect', samples: [] },
    });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.indexStatus?.status).toBe('needs-reconnect');
    expect(report.indexStatus?.samples).toEqual([]);
  });

  it('surfaces gscSearch + gscSitemaps sections when the snapshot carries them', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult(),
      gscSearch: {
        status: 'ok',
        totalClicks: 54,
        totalImpressions: 4280,
        averageCtr: 54 / 4280,
        averagePosition: 6.2,
        topQueries: [
          {
            query: 'seo audit',
            clicks: 30,
            impressions: 3000,
            ctr: 0.01,
            position: 5.5,
          },
        ],
        topPages: [
          {
            url: 'https://example.com/',
            clicks: 20,
            impressions: 2000,
            ctr: 0.01,
            position: 4.0,
          },
        ],
        delta: { clicks: 8, impressions: 400 },
      },
      gscSitemaps: {
        status: 'ok',
        sitemaps: [
          {
            path: 'https://example.com/sitemap.xml',
            errors: 0,
            warnings: 2,
            processed: 128,
            lastDownloaded: new Date('2026-07-01T04:30:00.000Z'),
          },
        ],
      },
    });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.gscSearch).toEqual({
      status: 'ok',
      totalClicks: 54,
      totalImpressions: 4280,
      averageCtr: 54 / 4280,
      averagePosition: 6.2,
      topQueries: [
        { query: 'seo audit', clicks: 30, impressions: 3000, ctr: 0.01, position: 5.5 },
      ],
      topPages: [
        {
          url: 'https://example.com/',
          clicks: 20,
          impressions: 2000,
          ctr: 0.01,
          position: 4.0,
        },
      ],
      delta: { clicks: 8, impressions: 400 },
    });
    // Dates serialize to ISO strings on the wire.
    expect(report.gscSitemaps).toEqual({
      status: 'ok',
      sitemaps: [
        {
          path: 'https://example.com/sitemap.xml',
          errors: 0,
          warnings: 2,
          processed: 128,
          lastDownloaded: '2026-07-01T04:30:00.000Z',
        },
      ],
    });
  });

  it('surfaces null gsc sections on old snapshots (pre-feature)', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.gscSearch).toBeNull();
    expect(report.gscSitemaps).toBeNull();
  });

  it('surfaces unavailable gsc sections with a null delta + null lastDownloaded', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult(),
      gscSearch: {
        status: 'unavailable',
        totalClicks: 0,
        totalImpressions: 0,
        averageCtr: 0,
        averagePosition: 0,
        topQueries: [],
        topPages: [],
        delta: { clicks: null, impressions: null },
      },
      gscSitemaps: {
        status: 'no-sitemaps',
        sitemaps: [
          {
            path: 'https://example.com/pending.xml',
            errors: 0,
            warnings: 0,
            processed: 0,
            lastDownloaded: null,
          },
        ],
      },
    });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.gscSearch?.status).toBe('unavailable');
    expect(report.gscSearch?.delta).toEqual({ clicks: null, impressions: null });
    expect(report.gscSitemaps?.status).toBe('no-sitemaps');
    expect(report.gscSitemaps?.sitemaps[0]?.lastDownloaded).toBeNull();
  });

  it('resolves reason copy from GSC meta states', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult(),
      indexStatus: {
        status: 'ok',
        samples: [
          {
            url: 'https://example.com/blocked',
            inspection: {
              indexVerdict: 'FAIL',
              coverageState: 'Blocked by robots.txt',
              robotsTxtState: 'DISALLOWED',
              pageFetchState: null,
              googleCanonical: null,
              lastCrawlTime: null,
              richResults: { verdict: 'NEUTRAL', items: [] },
            },
          },
        ],
      },
    });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    const notIndexed = report.findings.find((f) => f.ruleId === 'not-indexed');
    expect(notIndexed?.copy.reason).toBe(
      'Your robots.txt file blocks Google from these pages.',
    );
    // Rules without a reason mapping keep the copy shape without the field.
    const titleRule = report.findings.find(
      (f) => f.ruleId === 'title-missing-or-weak',
    );
    expect(titleRule?.copy.reason).toBeUndefined();
  });

  it('preserves finding meta when the rule attaches it', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult({
        pages: [
          {
            url: 'https://example.com/x',
            brokenLinks: ['https://example.com/404'],
          },
        ],
      }),
    });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    const broken = report.findings.find((f) => f.ruleId === 'broken-internal-links');
    expect(broken?.meta).toEqual({
      totalBroken: 1,
      brokenLinkTargets: ['https://example.com/404'],
    });
    expect(broken?.brokenLinkTargets).toEqual(['https://example.com/404']);
    expect(broken?.codeFixPromptAvailable).toBe(true);
  });

  it('loads broken-link targets from audited pages for legacy snapshots', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult({
        pages: [
          {
            url: 'https://example.com/source',
            brokenLinks: ['https://example.com/broken'],
          },
        ],
      }),
    });
    await ReportSnapshot.updateOne(
      { runId: ids.runId },
      { $unset: { 'findings.$[finding].meta.brokenLinkTargets': 1 } },
      { arrayFilters: [{ 'finding.ruleId': 'broken-internal-links' }] },
    );
    await AuditedPage.create({
      runId: ids.runId,
      url: 'https://example.com/source',
      statusCode: 200,
      brokenLinks: ['https://example.com/broken'],
      onPageScore: 90,
    });

    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });

    expect(
      report.findings.find((finding) => finding.ruleId === 'broken-internal-links')
        ?.brokenLinkTargets,
    ).toEqual(['https://example.com/broken']);
  });

  it('omits code-fix availability for passed and insufficient-data findings', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });

    const passed = report.findings.find((finding) =>
      finding.ruleId === 'title-missing-or-weak');
    const insufficient = report.findings.find((finding) =>
      finding.ruleId === 'core-web-vitals-poor');
    expect(passed?.bucket).toBe('passed');
    expect(passed?.codeFixPromptAvailable).toBeUndefined();
    expect(insufficient?.meta?.insufficientData).toBeTruthy();
    expect(insufficient?.codeFixPromptAvailable).toBeUndefined();
  });

  it('surfaces null aiVisibility + localSeo sections on old snapshots (pre-feature)', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.aiVisibility).toBeNull();
    expect(report.localSeo).toBeNull();
  });

  it('round-trips the aiVisibility section, defaulting sentiment from negativeSentimentCount', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult(),
      aiVisibility: {
        status: 'ok',
        aiOverviewCitedCount: 1,
        aiOverviewTotalChecked: 2,
        llmMentionedCount: 1,
        llmTotalChecked: 2,
        shareOfVoicePct: 50,
        negativeSentimentCount: 1,
        competitorsPresent: true,
      },
    });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.aiVisibility).toEqual({
      status: 'ok',
      aiOverviewCitedCount: 1,
      aiOverviewTotalChecked: 2,
      llmMentionedCount: 1,
      llmTotalChecked: 2,
      shareOfVoicePct: 50,
      sentiment: { positive: 0, neutral: 0, negative: 1 },
      notMentionedPrompts: [],
    });
  });

  it('falls back to derived sentiment when persisted aiVisibility.sentiment is missing', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult(),
      aiVisibility: {
        status: 'ok',
        aiOverviewCitedCount: 0,
        aiOverviewTotalChecked: 1,
        llmMentionedCount: 0,
        llmTotalChecked: 1,
        shareOfVoicePct: null,
        negativeSentimentCount: 3,
        competitorsPresent: false,
      },
    });
    await ReportSnapshot.updateOne(
      { runId: ids.runId },
      { $unset: { 'aiVisibility.sentiment': '', 'aiVisibility.notMentionedPrompts': '' } },
    );
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.aiVisibility?.sentiment).toEqual({ positive: 0, neutral: 0, negative: 3 });
    expect(report.aiVisibility?.notMentionedPrompts).toEqual([]);
  });

  it('round-trips an explicit aiVisibility sentiment + notMentionedPrompts', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult(),
      aiVisibility: {
        status: 'ok',
        aiOverviewCitedCount: 0,
        aiOverviewTotalChecked: 2,
        llmMentionedCount: 0,
        llmTotalChecked: 2,
        shareOfVoicePct: null,
        negativeSentimentCount: 0,
        competitorsPresent: false,
        sentiment: { positive: 1, neutral: 1, negative: 0 },
        notMentionedPrompts: ['best widget shop'],
      },
    });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.aiVisibility?.sentiment).toEqual({ positive: 1, neutral: 1, negative: 0 });
    expect(report.aiVisibility?.notMentionedPrompts).toEqual(['best widget shop']);
  });

  it('round-trips the localSeo section (listings + reviews + Q&A + local pack)', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult(),
      localSeo: {
        status: 'ok',
        listings: [
          { source: 'google', consistent: true },
          { source: 'bing-places', consistent: false },
        ],
        reviews: { averageRating: 4.6, reviewCount: 128 },
        qa: { unansweredCount: 2 },
        localPack: { keyword: 'plumber austin', position: 2, totalPackSize: 3 },
      },
    });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.localSeo).toEqual({
      status: 'ok',
      listings: [
        { source: 'google', consistent: true },
        { source: 'bing-places', consistent: false },
      ],
      reviews: { averageRating: 4.6, reviewCount: 128 },
      qa: { unansweredCount: 2 },
      localPack: { keyword: 'plumber austin', position: 2, totalPackSize: 3 },
    });
    const napFinding = report.findings.find((f) => f.ruleId === 'nap-inconsistency');
    expect(napFinding?.bucket).toBe('fix-now');
  });

  it('round-trips a not-configured localSeo section with null reviews/qa/localPack', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult(),
      localSeo: {
        status: 'not-configured',
        listings: [],
        reviews: null,
        qa: null,
        localPack: null,
      },
    });
    const report = await getAuditReport({
      runId: ids.runId,
      accountId: ids.accountId,
      locale: 'en',
    });
    expect(report.localSeo).toEqual({
      status: 'not-configured',
      listings: [],
      reviews: null,
      qa: null,
      localPack: null,
    });
  });
});

// -----------------------------------------------------------------------------
describe('audit deterministic copy boundary', () => {
  it('returns stable keys with localized copy and rejects unknown rule ids', () => {
    expect(localizeAuditRuleCopy('robots-blocked', 'ar')).toMatchObject({
      titleKey: 'auditRules.robots-blocked.title',
      whyKey: 'auditRules.robots-blocked.why',
      fixKey: 'auditRules.robots-blocked.fix',
      passedLabelKey: 'auditRules.robots-blocked.passedLabel',
    });
    expect(() => localizeAuditRuleCopy('not-a-real-rule', 'en')).toThrow(
      'Unknown audit copy key: auditRules.not-a-real-rule.title',
    );
  });
});

// resolveGscReasonKey — pure mapping over finding meta
// -----------------------------------------------------------------------------

describe('resolveGscReasonKey', () => {
  it('returns null without meta or for non-GSC rules', () => {
    expect(resolveGscReasonKey('not-indexed', undefined)).toBeNull();
    expect(
      resolveGscReasonKey('title-missing-or-weak', { coverageState: 'x' }),
    ).toBeNull();
  });

  it('not-indexed: robots takes precedence, via state or coverage text', () => {
    expect(
      resolveGscReasonKey('not-indexed', {
        robotsTxtState: 'DISALLOWED',
        coverageState: 'Blocked by robots.txt',
      }),
    ).toBe('auditRules.not-indexed.reasons.robotsBlocked');
    expect(
      resolveGscReasonKey('not-indexed', {
        coverageState: 'Blocked by robots.txt',
      }),
    ).toBe('auditRules.not-indexed.reasons.robotsBlocked');
  });

  it('not-indexed: fetch-shaped coverage states map to pageNotFetchable', () => {
    for (const coverageState of [
      'Not found (404)',
      'Blocked due to unauthorized request (401)',
      'Page with redirect',
      'Server error (5xx)',
    ]) {
      expect(resolveGscReasonKey('not-indexed', { coverageState })).toBe(
        'auditRules.not-indexed.reasons.pageNotFetchable',
      );
    }
  });

  it('not-indexed: unknown/discovered coverage maps to coverageUnknown; others null', () => {
    expect(
      resolveGscReasonKey('not-indexed', {
        coverageState: 'URL is unknown to Google',
      }),
    ).toBe('auditRules.not-indexed.reasons.coverageUnknown');
    expect(
      resolveGscReasonKey('not-indexed', {
        coverageState: 'Discovered - currently not indexed',
      }),
    ).toBe('auditRules.not-indexed.reasons.coverageUnknown');
    expect(
      resolveGscReasonKey('not-indexed', {
        coverageState: 'Duplicate without user-selected canonical',
      }),
    ).toBeNull();
    // insufficientData meta carries no states → null.
    expect(
      resolveGscReasonKey('not-indexed', { insufficientData: true }),
    ).toBeNull();
    // Non-string states are ignored, not crashed on.
    expect(
      resolveGscReasonKey('not-indexed', { coverageState: 42, robotsTxtState: 7 }),
    ).toBeNull();
  });

  it('index-partial: fetch problems beat coverage warnings', () => {
    expect(
      resolveGscReasonKey('index-partial', {
        pageFetchState: 'SOFT_404',
        coverageState: 'Indexed, though blocked',
      }),
    ).toBe('auditRules.index-partial.reasons.pageFetchProblem');
    expect(
      resolveGscReasonKey('index-partial', {
        pageFetchState: 'SUCCESSFUL',
        coverageState: 'Indexed, though blocked',
      }),
    ).toBe('auditRules.index-partial.reasons.coverageWarning');
    expect(resolveGscReasonKey('index-partial', {})).toBeNull();
    expect(
      resolveGscReasonKey('index-partial', { pageFetchState: 99 }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getLatestSiteReport — the shared "latest report for this site" authority
// used by BOTH the MCP tool and the public /api/v1 handler.
// ---------------------------------------------------------------------------

describe('getLatestSiteReport', () => {
  it('returns the newest succeeded run and its localized report', async () => {
    const ids = await seedRun();
    // An older succeeded run plus a newer failed one — neither may win.
    await AuditRun.updateOne({ _id: ids.runId }, { $set: { status: 'succeeded' } });
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });

    const newer = await AuditRun.create({
      accountId: new mongoose.Types.ObjectId(ids.accountId),
      siteId: new mongoose.Types.ObjectId(ids.siteId),
      pageCap: 100,
      status: 'succeeded',
    });
    await writeReportSnapshot({
      accountId: ids.accountId,
      siteId: ids.siteId,
      runId: newer.id as string,
      result: makeAuditResult({ pages: [{ url: 'https://example.com/a', title: null }] }),
    });

    const latest = await getLatestSiteReport({
      accountId: ids.accountId,
      siteId: ids.siteId,
      locale: 'en',
    });
    expect(latest.runId).toBe(newer.id);
    expect(latest.report.runId).toBe(newer.id);
    expect(latest.report.findings.length).toBeGreaterThan(0);
  });

  it('404s for a site owned by another account, a deleting site, and a site with no succeeded run', async () => {
    const ids = await seedRun();
    const stranger = new mongoose.Types.ObjectId().toHexString();

    await expect(
      getLatestSiteReport({ accountId: stranger, siteId: ids.siteId, locale: 'en' }),
    ).rejects.toThrow(HttpError);

    // Owned, but nothing has succeeded yet.
    await expect(
      getLatestSiteReport({ accountId: ids.accountId, siteId: ids.siteId, locale: 'en' }),
    ).rejects.toMatchObject({ message: 'audits.errors.notFound' });

    await Site.updateOne({ _id: ids.siteId }, { $set: { deletionStartedAt: new Date() } });
    await expect(
      getLatestSiteReport({ accountId: ids.accountId, siteId: ids.siteId, locale: 'en' }),
    ).rejects.toMatchObject({ message: 'sites.errors.notFound' });
  });

  it('carries the localized rule copy that quotes HTML through untouched', async () => {
    // `auditRules.mobile-unfriendly.fix` legitimately contains `<meta …>`; the
    // report must keep it verbatim. The MCP denylist allowance exists for this.
    const ids = await seedRun();
    await AuditRun.updateOne({ _id: ids.runId }, { $set: { status: 'succeeded' } });
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });

    const latest = await getLatestSiteReport({
      accountId: ids.accountId,
      siteId: ids.siteId,
      locale: 'en',
    });
    const mobile = latest.report.findings.find((f) => f.ruleId === 'mobile-unfriendly');
    expect(mobile?.copy.fix).toContain('<meta ');
  });

  it('returns a plain DTO — no Mongoose document internals reach a consumer', async () => {
    // `res.json()` hides Mongoose subdocuments behind `toJSON`, so the web path
    // never noticed that `counts` and `finding.meta` were handed over raw. Any
    // consumer that WALKS the object graph — the MCP denylist scan — trips over
    // the `$__parent` / `_doc` / `__parentArray` back-references instead. Assert
    // the shape a walker sees, not the shape a serializer sees.
    const ids = await seedRun();
    await AuditRun.updateOne({ _id: ids.runId }, { $set: { status: 'succeeded' } });
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });

    const { report } = await getLatestSiteReport({
      accountId: ids.accountId,
      siteId: ids.siteId,
      locale: 'en',
    });

    expect(scanForForbidden(report).filter((f) => f.reason === 'cyclic-value')).toEqual(
      [],
    );
    const withMeta = report.findings.find((f) => f.meta);
    expect(withMeta?.meta && Object.getPrototypeOf(withMeta.meta)).toBe(
      Object.prototype,
    );
    expect(Object.getPrototypeOf(report.counts)).toBe(Object.prototype);
  });
});
