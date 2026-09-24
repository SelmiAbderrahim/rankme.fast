import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { keywords, rankings } from '../../db/schema/keywords.js';
import * as gscSnapshots from '../gsc-snapshots/index.js';
import {
  buildClientPortalDto,
  composeClientReport,
  inspectClientReportCompleteness,
} from '../client-reports/index.js';
import { Site } from '../sites/index.js';
import { User } from '../users/users.model.js';
import { AuditRun } from './audit-run.model.js';
import { ReportSnapshot } from './report-snapshot.model.js';
import { writeReportSnapshot } from './report.service.js';
import { makeAuditResult } from './rules/fixtures.js';

describe('composeClientReport stored snapshot projection', () => {
  beforeAll(async () => {
    await startMemoryMongo();
    await startTestPostgres();
  });

  afterAll(async () => {
    await stopTestPostgres();
    await stopMemoryMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    await truncateAllTables();
  });

  async function seedAccountAndSite() {
    const accountId = new Types.ObjectId();
    const user = await User.create({
      _id: accountId,
      email: 'composer@example.com',
      emailVerified: true,
      branding: { companyName: 'Acme', accentColor: '#112233' },
    });
    const site = await Site.create({
      accountId,
      url: 'https://example.com',
      domain: 'example.com',
      displayName: 'Example client',
      gscPropertyUrl: 'sc-domain:example.com',
      gscBindingGenerationId: 'legacy',
      gscBindingSource: 'legacy',
    });
    return { accountId: user.id as string, siteId: site.id as string };
  }

  it('composes bounded engine-tagged ranks and a dated 28-day GSC summary', async () => {
    const ids = await seedAccountAndSite();
    const run = await AuditRun.create({
      accountId: ids.accountId,
      siteId: ids.siteId,
      pageCap: 100,
      status: 'succeeded',
      finishedAt: new Date('2026-07-03T10:00:00.000Z'),
    });
    await writeReportSnapshot({
      runId: run.id as string,
      siteId: ids.siteId,
      accountId: ids.accountId,
      result: makeAuditResult(),
    });

    const engines = ['google', 'bing', 'youtube', 'amazon'] as const;
    for (let index = 0; index < 30; index += 1) {
      const engine = engines[index % engines.length]!;
      const inserted = await getTestDb()
        .insert(keywords)
        .values({
          accountId: ids.accountId,
          siteId: ids.siteId,
          phrase: `phrase-${String(index).padStart(2, '0')}`,
          locationCode: 2_848,
          languageCode: 'en',
          device: 'desktop',
          engine,
          engineTarget:
            engine === 'youtube'
              ? `channel-${index}`
              : engine === 'amazon'
                ? `B000000${String(index).padStart(3, '0')}`
                : null,
          active: true,
        })
        .returning({ id: keywords.id });
      await getTestDb().insert(rankings).values({
        keywordId: inserted[0]!.id,
        engine,
        position: index === 0 ? null : index + 1,
        checkedAt: new Date(`2026-07-04T${String(index % 24).padStart(2, '0')}:00:00.000Z`),
        source: 'fresh',
      });
    }
    await gscSnapshots.upsertSearchAnalytics(getTestDb() as never, {
      accountId: ids.accountId,
      siteId: ids.siteId,
      bindingGenerationId: 'legacy',
      snapshotDate: '2026-07-05',
      dimensionSet: 'query',
      windowDays: 28,
      rows: Array.from({ length: 8 }, (_, index) => ({
        keys: [`query-${index}`],
        clicks: 20 - index,
        impressions: 100 + index,
        ctr: (20 - index) / (100 + index),
        position: index + 1,
      })),
    });

    const report = await composeClientReport(
      {
        ...ids,
        locale: 'en',
        sections: { audit: true, ranks: true, gsc: true },
      },
      getTestDb() as never,
    );
    expect(report.siteLabel).toBe('Example client');
    expect(report.branding).toMatchObject({
      companyName: 'Acme',
      accentColor: '#112233',
    });
    expect(report.sections.audit?.snapshotDate).toBe('2026-07-03T10:00:00.000Z');
    expect(report.sections.ranks?.rows).toHaveLength(25);
    expect(new Set(report.sections.ranks?.rows.map((row) => row.engine))).toEqual(
      new Set(['google', 'bing', 'youtube', 'amazon']),
    );
    expect(report.sections.ranks?.rows[0]?.checkedAt).toBe(
      '2026-07-04T23:00:00.000Z',
    );
    expect(report.sections.gsc).toMatchObject({
      snapshotDate: '2026-07-05',
      windowDays: 28,
      totalClicks: 132,
      totalImpressions: 828,
    });
    expect(report.sections.gsc?.topQueries).toHaveLength(5);
    expect(report.sections.gsc?.topQueries.every((row) => row.snapshotDate === '2026-07-05'))
      .toBe(true);
    expect(report.generatedAt).toBe('2026-07-05T00:00:00.000Z');

    const completeness = await inspectClientReportCompleteness(
      {
        ...ids,
        locale: 'en',
        sections: { audit: true, ranks: true, gsc: true },
      },
      report,
      getTestDb() as never,
    );
    expect(completeness).toEqual({
      auditFindings: report.sections.audit!.report.findings.length,
      maxAffectedUrls: Math.max(
        ...report.sections.audit!.report.findings.map((finding) => finding.affectedUrls.length),
      ),
      rankRows: 30,
      gscQueries: 8,
    });

    await expect(inspectClientReportCompleteness(
      {
        ...ids,
        locale: 'en',
        sections: { audit: false, ranks: false, gsc: false },
      },
      { ...report, sections: { audit: null, ranks: null, gsc: null } },
      getTestDb() as never,
    )).resolves.toEqual({
      auditFindings: 0,
      maxAffectedUrls: 0,
      rankRows: 0,
      gscQueries: 0,
    });

    const portal = buildClientPortalDto({
      ...report,
      branding: {
        ...report.branding,
        logoPngBase64: 'reencoded-png',
        logoWidth: 120,
        logoHeight: 40,
      },
    });
    expect(portal.branding.logoDataUrl).toBe('data:image/png;base64,reencoded-png');
    expect(portal.sections.audit?.findings[0]).toMatchObject({
      title: expect.any(String),
      why: expect.any(String),
      fix: expect.any(String),
    });
    expect(portal.sections.ranks?.rows).toHaveLength(25);
    expect(portal.sections.gsc?.topQueries).toHaveLength(5);

    for (const branding of [
      { ...report.branding, logoPngBase64: '', logoWidth: null, logoHeight: null },
      { ...report.branding, logoPngBase64: 'png', logoWidth: null, logoHeight: null },
      { ...report.branding, logoPngBase64: 'png', logoWidth: 120, logoHeight: null },
    ]) {
      expect(buildClientPortalDto({ ...report, branding }).branding.logoDataUrl).toBeNull();
    }
    expect(buildClientPortalDto({
      ...report,
      sections: { audit: null, ranks: null, gsc: null },
    }).sections).toEqual({ audit: null, ranks: null, gsc: null });
  });

  it('returns honest null sections and refuses a report with no dated data', async () => {
    const ids = await seedAccountAndSite();
    await expect(inspectClientReportCompleteness(
      {
        ...ids,
        locale: 'en',
        sections: { audit: false, ranks: false, gsc: true },
      },
      {
        siteLabel: 'Example client',
        siteDomain: 'example.com',
        locale: 'en',
        branding: {
          companyName: '',
          accentColor: '',
          logoPngBase64: '',
          logoWidth: null,
          logoHeight: null,
        },
        generatedAt: '2026-07-01T00:00:00.000Z',
        sections: { audit: null, ranks: null, gsc: null },
      },
      getTestDb() as never,
    )).resolves.toMatchObject({ gscQueries: 0 });
    await expect(
      composeClientReport(
        {
          ...ids,
          locale: 'fr',
          sections: { audit: true, ranks: true, gsc: true },
        },
        getTestDb() as never,
      ),
    ).rejects.toMatchObject({ status: 409, message: 'clientReports.errors.noSnapshot' });

    await expect(
      composeClientReport(
        {
          accountId: ids.accountId,
          siteId: new Types.ObjectId().toHexString(),
          locale: 'en',
          sections: { audit: true, ranks: false, gsc: false },
        },
        getTestDb() as never,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('short-circuits unselected sections without manufacturing a date', async () => {
    const ids = await seedAccountAndSite();
    await expect(composeClientReport(
      {
        ...ids,
        locale: 'en',
        sections: { audit: false, ranks: false, gsc: false },
      },
      getTestDb() as never,
    )).rejects.toMatchObject({ status: 409 });
  });

  it('uses stored fallback dates, domain labels, and neutral branding without a user row', async () => {
    const ids = await seedAccountAndSite();
    const run = await AuditRun.create({
      accountId: ids.accountId,
      siteId: ids.siteId,
      pageCap: 100,
      status: 'succeeded',
    });
    await writeReportSnapshot({
      runId: run.id as string,
      siteId: ids.siteId,
      accountId: ids.accountId,
      result: makeAuditResult(),
    });
    const storedSnapshot = await ReportSnapshot.findOne({ runId: run._id }).lean();
    await Site.findByIdAndUpdate(ids.siteId, { $set: { displayName: '' } });
    await User.findByIdAndDelete(ids.accountId);

    const report = await composeClientReport({
      ...ids,
      locale: 'en',
      sections: { audit: true, ranks: false, gsc: false },
    }, getTestDb() as never);
    expect(report.sections.audit?.snapshotDate).toBe(storedSnapshot!.createdAt.toISOString());
    expect(report.siteLabel).toBe('example.com');
    expect(report.branding).toEqual({
      companyName: '',
      accentColor: '',
      logoPngBase64: '',
      logoWidth: null,
      logoHeight: null,
    });

    await AuditRun.findByIdAndUpdate(run._id, { $set: { status: 'failed' } });
    await expect(composeClientReport({
      ...ids,
      locale: 'en',
      sections: { audit: true, ranks: false, gsc: false },
    }, getTestDb() as never)).rejects.toMatchObject({ status: 409 });
  });

  it('keeps zero-impression GSC arithmetic finite and deterministically sorts ties', async () => {
    const ids = await seedAccountAndSite();
    await gscSnapshots.upsertSearchAnalytics(getTestDb() as never, {
      accountId: ids.accountId,
      siteId: ids.siteId,
      bindingGenerationId: 'legacy',
      snapshotDate: '2026-07-08',
      dimensionSet: 'query',
      windowDays: 28,
      rows: [
        { keys: ['zeta'], clicks: 0, impressions: 0, ctr: 0, position: 0 },
        { keys: ['alpha'], clicks: 0, impressions: 0, ctr: 0, position: 0 },
      ],
    });
    const report = await composeClientReport({
      ...ids,
      locale: 'en',
      sections: { audit: false, ranks: false, gsc: true },
    }, getTestDb() as never);
    expect(report.sections.gsc).toMatchObject({
      averageCtr: 0,
      averagePosition: 0,
    });
    expect(report.sections.gsc?.topQueries.map((row) => row.query)).toEqual(['alpha', 'zeta']);

    const read = vi.spyOn(gscSnapshots, 'readSearchAnalytics').mockResolvedValueOnce([]);
    await expect(composeClientReport({
      ...ids,
      locale: 'en',
      sections: { audit: false, ranks: false, gsc: true },
    }, getTestDb() as never)).rejects.toMatchObject({ status: 409 });
    read.mockRestore();
  });

  it('selects only the client report artifact locale summary without generating a fallback', async () => {
    const ids = await seedAccountAndSite();
    const run = await AuditRun.create({
      accountId: ids.accountId,
      siteId: ids.siteId,
      pageCap: 100,
      status: 'succeeded',
      finishedAt: new Date('2026-08-25T10:00:00.000Z'),
    });
    await writeReportSnapshot({
      runId: run.id as string,
      siteId: ids.siteId,
      accountId: ids.accountId,
      result: makeAuditResult(),
    });
    await ReportSnapshot.updateOne(
      { runId: run._id },
      {
        $set: {
          'aiSummaryVariantsByLocale.fr': {
            text: 'Résumé français exact.',
            locale: 'fr',
            model: 'm-fr',
            truncated: false,
            createdAt: new Date('2026-08-25T09:00:00.000Z'),
          },
        },
      },
    );
    const french = await composeClientReport({
      ...ids,
      locale: 'fr',
      sections: { audit: true, ranks: false, gsc: false },
    }, getTestDb() as never);
    expect(french.sections.audit?.report.aiSummary?.text).toBe('Résumé français exact.');

    const arabic = await composeClientReport({
      ...ids,
      locale: 'ar',
      sections: { audit: true, ranks: false, gsc: false },
    }, getTestDb() as never);
    expect(arabic.sections.audit?.report.aiSummary).toBeNull();
    expect(arabic.sections.audit?.report.aiSummaryAvailability).toMatchObject({
      requestedLocale: 'ar',
      availableLocales: ['fr'],
      status: 'idle',
    });
  });
});
