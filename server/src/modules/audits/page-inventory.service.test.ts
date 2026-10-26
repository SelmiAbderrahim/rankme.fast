import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { AuditRun } from './audit-run.model.js';
import { AuditedPage } from './audited-page.model.js';
import { ReportSnapshot } from './report-snapshot.model.js';
import { readLatestAuditPageDetail, readLatestCompletedPageInventory } from './page-inventory.service.js';

const ACCOUNT = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439013';
const SITE = '507f1f77bcf86cd799439012';

beforeAll(startMemoryMongo);
afterAll(stopMemoryMongo);
beforeEach(clearCollections);

describe('audit page inventory public reader', () => {
  it('returns only the latest completed account/site run with a bounded projection', async () => {
    await AuditRun.create({ accountId: OTHER, siteId: SITE, status: 'succeeded', pageCap: 10, kind: 'site' });
    await AuditRun.create({ accountId: ACCOUNT, siteId: SITE, status: 'failed', pageCap: 10, kind: 'site' });
    const run = await AuditRun.create({ accountId: ACCOUNT, siteId: SITE, status: 'succeeded', pageCap: 10, kind: 'site' });
    await AuditedPage.create([
      { runId: run._id, url: 'https://example.com/b', statusCode: 200, title: 'B', isIndexable: false, nonIndexableReason: 'noindex', onPageScore: 50 },
      { runId: run._id, url: 'https://example.com/a', statusCode: 200, title: null, isIndexable: true, nonIndexableReason: null, onPageScore: 80 },
    ]);
    await AuditedPage.collection.updateOne({ runId: run._id, url: 'https://example.com/b' }, { $set: { onPageScore: null } });
    const result = await readLatestCompletedPageInventory(ACCOUNT, SITE, 1);
    expect(result).toMatchObject({ runId: String(run._id), fetchedCount: 2, truncated: true, rows: [{ url: 'https://example.com/a', title: null, isIndexable: true, onPageScore: 80 }] });
    expect((await readLatestCompletedPageInventory(ACCOUNT, SITE, 2)).rows[1]).toMatchObject({ title: 'B', isIndexable: false, nonIndexableReason: 'noindex', onPageScore: null });
  });

  it('returns an empty bounded inventory for malformed or absent ownership', async () => {
    const empty = { runId: null, rows: [], fetchedCount: 0, truncated: false, coverageProbes: null, lastCrawl: null };
    await expect(readLatestCompletedPageInventory('bad', SITE)).resolves.toEqual(empty);
    await expect(readLatestCompletedPageInventory(ACCOUNT, SITE)).resolves.toEqual(empty);
  });

  it('carries the fetch evidence of each row and treats a legacy run as having none', async () => {
    const legacy = await AuditRun.create({ accountId: ACCOUNT, siteId: SITE, status: 'succeeded', pageCap: 10, kind: 'site' });
    await AuditedPage.create({ runId: legacy._id, url: 'https://example.com/old', statusCode: 200, onPageScore: 10 });
    const before = await readLatestCompletedPageInventory(ACCOUNT, SITE);
    expect(before.coverageProbes).toBeNull();
    expect(before.rows[0]).toMatchObject({ statusCode: 200, finalUrl: null, redirectChain: [], contentType: null, fetchFailure: null });

    const run = await AuditRun.create({
      accountId: ACCOUNT,
      siteId: SITE,
      status: 'succeeded',
      pageCap: 10,
      kind: 'site',
      pagesCrawled: 3,
      coverageProbes: [
        {
          url: 'https://example.com/',
          source: 'site-root',
          statusCode: 200,
          finalUrl: 'https://example.com/en',
          redirectChain: [{ url: 'https://example.com/', status: 301 }],
          contentType: 'text/html',
          failure: null,
        },
        {
          url: 'https://example.com/gone',
          source: 'search-console',
          statusCode: 404,
          failure: { kind: 'http_error', statusCode: 404 },
        },
        {
          url: 'https://example.com/report.pdf',
          source: 'search-console',
          statusCode: 200,
          contentType: 'application/pdf',
          failure: { kind: 'non_html', contentType: 'application/pdf' },
        },
        { url: 'https://example.com/slow', source: 'search-console', failure: { kind: 'timeout' } },
      ],
    });
    await AuditedPage.create([
      {
        runId: run._id,
        url: 'https://example.com/a',
        statusCode: 301,
        onPageScore: 10,
        finalUrl: 'https://example.com/en',
        redirectChain: [{ url: 'https://example.com/a', status: 301 }],
      },
      {
        runId: run._id,
        url: 'https://example.com/b',
        statusCode: 404,
        onPageScore: 10,
        contentType: 'text/html',
        fetchFailure: { kind: 'http_error', statusCode: 404 },
      },
      {
        runId: run._id,
        url: 'https://example.com/c.pdf',
        statusCode: 200,
        onPageScore: 10,
        fetchFailure: { kind: 'non_html', contentType: 'application/pdf' },
      },
    ]);
    const inventory = await readLatestCompletedPageInventory(ACCOUNT, SITE);
    expect(inventory.rows.map((r) => [r.url, r.statusCode, r.finalUrl, r.fetchFailure])).toEqual([
      ['https://example.com/a', 301, 'https://example.com/en', null],
      ['https://example.com/b', 404, null, { kind: 'http_error', statusCode: 404 }],
      ['https://example.com/c.pdf', 200, null, { kind: 'non_html', contentType: 'application/pdf' }],
    ]);
    expect(inventory.rows[0]!.redirectChain).toEqual([{ url: 'https://example.com/a', status: 301 }]);
    expect(inventory.rows[1]!.contentType).toBe('text/html');
    expect(inventory.coverageProbes).toEqual([
      {
        url: 'https://example.com/',
        source: 'site-root',
        statusCode: 200,
        finalUrl: 'https://example.com/en',
        redirectChain: [{ url: 'https://example.com/', status: 301 }],
        contentType: 'text/html',
        failure: null,
      },
      {
        url: 'https://example.com/gone',
        source: 'search-console',
        statusCode: 404,
        finalUrl: null,
        redirectChain: [],
        contentType: null,
        failure: { kind: 'http_error', statusCode: 404 },
      },
      {
        url: 'https://example.com/report.pdf',
        source: 'search-console',
        statusCode: 200,
        finalUrl: null,
        redirectChain: [],
        contentType: 'application/pdf',
        failure: { kind: 'non_html', contentType: 'application/pdf' },
      },
      {
        url: 'https://example.com/slow',
        source: 'search-console',
        statusCode: null,
        finalUrl: null,
        redirectChain: [],
        contentType: null,
        failure: { kind: 'timeout' },
      },
    ]);
  });

  it('distinguishes "nothing was missing" (empty list) from a run that recorded no probes', async () => {
    await AuditRun.create({ accountId: ACCOUNT, siteId: SITE, status: 'succeeded', pageCap: 10, kind: 'site', coverageProbes: [] });
    expect((await readLatestCompletedPageInventory(ACCOUNT, SITE)).coverageProbes).toEqual([]);
  });

  it('fills in the defaults for a stored probe that recorded only its address', async () => {
    await AuditRun.collection.insertOne({
      accountId: new (await import('mongoose')).default.Types.ObjectId(ACCOUNT),
      siteId: new (await import('mongoose')).default.Types.ObjectId(SITE),
      status: 'succeeded',
      kind: 'site',
      pageCap: 10,
      coverageProbes: [{ url: 'https://example.com/bare', source: 'site-root' }],
    });
    const inventory = await readLatestCompletedPageInventory(ACCOUNT, SITE);
    expect(inventory.coverageProbes).toEqual([
      {
        url: 'https://example.com/bare',
        source: 'site-root',
        statusCode: null,
        finalUrl: null,
        redirectChain: [],
        contentType: null,
        failure: null,
      },
    ]);
  });

  it('carries the last crawl record so a short inventory can say why', async () => {
    const finishedAt = new Date('2026-09-01T10:00:00.000Z');
    await AuditRun.create({
      accountId: ACCOUNT, siteId: SITE, status: 'succeeded', pageCap: 100, kind: 'site',
      pagesCrawled: 1, vendorPagesCrawled: 1, crawlStopReason: 'no_more_links', finishedAt,
      result: { domainChecks: { robotsTxtFound: true, sitemapFound: false, httpsEnforced: true, canonicalizationOk: true } },
    });
    expect((await readLatestCompletedPageInventory(ACCOUNT, SITE)).lastCrawl).toEqual({
      finishedAt: finishedAt.toISOString(),
      pageCap: 100,
      pagesStored: 1,
      vendorPagesCrawled: 1,
      stopReason: 'no_more_links',
      stopReasonSource: 'recorded',
      sitemapFound: false,
    });
  });

  it('records nothing it was not told: legacy runs and unconfirmed sitemaps stay null', async () => {
    await AuditRun.create({
      accountId: ACCOUNT, siteId: SITE, status: 'succeeded', pageCap: 25, kind: 'site',
      result: { domainChecks: { robotsTxtFound: true, sitemapFound: false, sitemapUnconfirmed: true, httpsEnforced: true, canonicalizationOk: true } },
    });
    expect((await readLatestCompletedPageInventory(ACCOUNT, SITE)).lastCrawl).toEqual({
      finishedAt: null,
      pageCap: 25,
      pagesStored: null,
      vendorPagesCrawled: null,
      stopReason: null,
      stopReasonSource: null,
      sitemapFound: null,
    });
    await clearCollections();
    await AuditRun.create({ accountId: ACCOUNT, siteId: SITE, status: 'succeeded', pageCap: 25, kind: 'site', result: null });
    expect((await readLatestCompletedPageInventory(ACCOUNT, SITE)).lastCrawl?.sitemapFound).toBeNull();
  });

  it('derives the stop reason of an older run that reached its page limit, without rewriting it', async () => {
    const run = await AuditRun.create({
      accountId: ACCOUNT, siteId: SITE, status: 'succeeded', pageCap: 100, kind: 'site', pagesCrawled: 100,
      result: { domainChecks: { robotsTxtFound: true, sitemapFound: true, httpsEnforced: true, canonicalizationOk: true } },
    });
    expect((await readLatestCompletedPageInventory(ACCOUNT, SITE)).lastCrawl).toMatchObject({
      stopReason: 'page_limit',
      stopReasonSource: 'derived',
    });
    expect((await AuditRun.findById(run._id).lean())?.crawlStopReason).toBeNull();
  });
});

describe('latest audit page detail', () => {
  const isPage = (target: string) => (url: string) => url.replace(/\/$/, '') === target;
  const counts = { fixNow: 1, watch: 1, passed: 0 };

  async function seedSnapshot(runId: unknown, findings: Array<Record<string, unknown>>) {
    await ReportSnapshot.create({ runId, siteId: SITE, accountId: ACCOUNT, findings, counts });
  }

  it('returns the crawl facts and the open findings that name the page, directly or through a resource', async () => {
    const run = await AuditRun.create({ accountId: ACCOUNT, siteId: SITE, status: 'succeeded', pageCap: 10, kind: 'site' });
    await AuditedPage.create([
      { runId: run._id, url: 'https://example.com/', statusCode: 200, onPageScore: 80, clickDepth: 0, inboundInternalLinks: 5, pageSizeBytes: 1000, serverResponseMs: 120, imageCount: 4 },
      { runId: run._id, url: 'https://example.com/other', statusCode: 200, onPageScore: 70 },
    ]);
    await seedSnapshot(run._id, [
      { ruleId: 'placeholder-text', bucket: 'fix-now', severity: 'critical', affectedUrls: ['https://example.com/'] },
      { ruleId: 'broken-resources', bucket: 'fix-now', severity: 'warning', affectedUrls: [], meta: { resources: [{ url: 'https://example.com/a.png', usedOn: ['https://example.com/', 7] }, null, { usedOn: 'x' }] } },
      { ruleId: 'orphan-pages', bucket: 'watch', severity: 'warning', affectedUrls: ['https://example.com/other'] },
      { ruleId: 'large-pages', bucket: 'passed', severity: 'info', affectedUrls: [] },
      { ruleId: 'duplicate-titles', bucket: 'watch', severity: 'warning', affectedUrls: ['https://example.com/'], meta: { insufficientData: true } },
      { ruleId: 'retired-rule', bucket: 'watch', severity: 'info', affectedUrls: ['https://example.com/'] },
      { ruleId: 'redirect-chains', bucket: 'watch', severity: 'warning', affectedUrls: [], meta: { resources: 'not-a-list' } },
    ]);
    const detail = await readLatestAuditPageDetail(ACCOUNT, SITE, isPage('https://example.com'), 'fr');
    expect(detail).toMatchObject({
      runId: String(run._id),
      facts: { clickDepth: 0, inboundInternalLinks: 5, pageSizeBytes: 1000, serverResponseMs: 120 },
    });
    expect(detail?.issues.map((issue) => [issue.ruleId, issue.bucket, issue.severity])).toEqual([
      ['placeholder-text', 'fix-now', 'critical'],
      ['broken-resources', 'fix-now', 'warning'],
    ]);
    expect(detail?.issues.every((issue) => issue.title.length > 0)).toBe(true);
    const other = await readLatestAuditPageDetail(ACCOUNT, SITE, isPage('https://example.com/other'), 'en');
    expect(other).toMatchObject({ facts: {}, issues: [{ ruleId: 'orphan-pages' }] });
  });

  it('is null without a completed run, a snapshot-independent page match, or valid ownership', async () => {
    await expect(readLatestAuditPageDetail('bad', SITE, () => true, 'en')).resolves.toBeNull();
    await expect(readLatestAuditPageDetail(ACCOUNT, 'bad', () => true, 'en')).resolves.toBeNull();
    await expect(readLatestAuditPageDetail(ACCOUNT, SITE, () => true, 'en')).resolves.toBeNull();
    await AuditRun.create({ accountId: OTHER, siteId: SITE, status: 'succeeded', pageCap: 10, kind: 'site' });
    await expect(readLatestAuditPageDetail(ACCOUNT, SITE, () => true, 'en')).resolves.toBeNull();
    const run = await AuditRun.create({ accountId: ACCOUNT, siteId: SITE, status: 'succeeded', pageCap: 10, kind: 'site' });
    await AuditedPage.create({ runId: run._id, url: 'https://example.com/a', statusCode: 200, onPageScore: 1 });
    await expect(readLatestAuditPageDetail(ACCOUNT, SITE, () => false, 'en')).resolves.toBeNull();
    // No frozen snapshot yet: the facts are served and there are no issues.
    await expect(readLatestAuditPageDetail(ACCOUNT, SITE, () => true, 'en')).resolves.toEqual({
      runId: String(run._id),
      facts: {},
      issues: [],
    });
  });
});
