import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  ga4Metrics,
  gscSearchAnalytics,
  gscSearchAppearance,
  gscSitemaps,
} from '../../db/schema/index.js';
import type {
  ReportBrandingSnapshot,
  ReportJsonValue,
} from '../../shared/report-exports/index.js';
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
import type { ReportExportAdapter } from '../report-exports/index.js';
import { Site, type PublicSite } from '../sites/index.js';
import { GoogleConnection } from './google-connection.model.js';
import { SCOPE_GA4 } from './google-connections.schema.js';
import {
  createGoogleReportExportAdapters,
  googleReportExportTestables as internals,
} from './report-export.adapters.js';

const accountId = '507f1f77bcf86cd799439010';
const actorUserId = '507f1f77bcf86cd799439014';
const foreignAccountId = '507f1f77bcf86cd799439015';
const siteId = '507f1f77bcf86cd799439011';
const currentDate = '2026-08-08';
const previousDate = '2026-07-10';
const capturedAt = new Date('2026-08-08T12:00:00.000Z');
const bindingGenerationId = 'legacy';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast',
  companyName: 'RankMeFast',
  accentColor: '#b5321e',
  logo: null,
};

function adapter(kind: string): ReportExportAdapter {
  const match = createGoogleReportExportAdapters(getTestDb()).find((item) => item.kind === kind);
  if (!match) throw new Error(`missing adapter ${kind}`);
  return match;
}

function access(purpose: 'create' | 'persist' = 'create', sourceVersion?: string) {
  return {
    accountId,
    actorUserId,
    purpose,
    target: { scope: 'site' as const, siteId },
    format: 'json' as const,
    locale: 'en' as const,
    ...(sourceVersion ? { sourceVersion } : {}),
  };
}

function compose(
  item: ReportExportAdapter,
  selection: Record<string, ReportJsonValue>,
  format: 'pdf' | 'csv' | 'json' = 'json',
) {
  return {
    accountId,
    actorUserId,
    target: { scope: 'site' as const, siteId },
    format,
    locale: 'en' as const,
    selection: item.selectionSchema.parse(selection),
    branding,
  };
}

async function seedSiteAndConnection(): Promise<void> {
  await Site.create({
    _id: siteId,
    accountId,
    url: 'https://example.test',
    domain: 'example.test',
    displayName: 'Example',
    gscPropertyUrl: 'sc-domain:example.test',
    gscBindingGenerationId: bindingGenerationId,
    ga4PropertyId: 'properties/123',
    ga4BindingGenerationId: bindingGenerationId,
  });
  await GoogleConnection.create({
    accountId,
    googleAccountEmail: 'owner@example.test',
    encryptedRefreshToken: { ciphertext: 'redacted', iv: 'redacted', authTag: 'redacted', keyVersion: 1 },
    scopes: [SCOPE_GA4],
    status: 'connected',
    propertyUrl: 'sc-domain:example.test',
    ga4PropertyId: 'properties/123',
    ga4PropertyDisplayName: 'Example analytics',
    connectedAt: capturedAt,
  });
}

async function seedGsc(): Promise<void> {
  await getTestDb().insert(gscSearchAnalytics).values([
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, windowDays: 28, dimensionSet: 'query', dimensionKey: 'alpha', clicks: 20, impressions: 100, ctr: 0.2, position: 2, fetchedAt: capturedAt },
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, windowDays: 28, dimensionSet: 'query', dimensionKey: 'beta', clicks: 10, impressions: 100, ctr: 0.1, position: 4, fetchedAt: capturedAt },
    { accountId, siteId, bindingGenerationId, snapshotDate: previousDate, windowDays: 28, dimensionSet: 'query', dimensionKey: 'previous', clicks: 5, impressions: 50, ctr: 0.1, position: 6, fetchedAt: new Date('2026-07-10T12:00:00.000Z') },
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, windowDays: 28, dimensionSet: 'page', dimensionKey: 'https://example.test/a', clicks: 15, impressions: 80, ctr: 0.1875, position: 3, fetchedAt: capturedAt },
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, windowDays: 28, dimensionSet: 'country', dimensionKey: 'US', clicks: 12, impressions: 70, ctr: 0.17, position: 3, fetchedAt: capturedAt },
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, windowDays: 28, dimensionSet: 'device', dimensionKey: 'mobile', clicks: 18, impressions: 90, ctr: 0.2, position: 2.5, fetchedAt: capturedAt },
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, windowDays: 90, dimensionSet: 'date', dimensionKey: '2026-08-07', clicks: 4, impressions: 40, ctr: 0.1, position: 5, fetchedAt: capturedAt },
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, windowDays: 90, dimensionSet: 'date', dimensionKey: '2026-08-08', clicks: 8, impressions: 50, ctr: 0.16, position: 4, fetchedAt: capturedAt },
  ]);
  await getTestDb().insert(gscSitemaps).values([
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, path: 'https://example.test/error.xml', type: 'sitemap', lastSubmitted: capturedAt, lastDownloaded: null, isPending: false, isSitemapsIndex: false, errors: 1, warnings: 0, processed: 0, fetchedAt: capturedAt },
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, path: 'https://example.test/processed.xml', type: 'sitemap', lastSubmitted: null, lastDownloaded: capturedAt, isPending: false, isSitemapsIndex: true, errors: 0, warnings: 0, processed: 20, fetchedAt: capturedAt },
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, path: 'https://example.test/submitted.xml', type: 'sitemap', lastSubmitted: null, lastDownloaded: null, isPending: true, isSitemapsIndex: false, errors: 0, warnings: 0, processed: 0, fetchedAt: capturedAt },
  ]);
  await getTestDb().insert(gscSearchAppearance).values([
    {
      accountId,
      siteId,
      bindingGenerationId,
      property: 'sc-domain:example.test',
      snapshotDate: currentDate,
      windowDays: 28,
      rawAppearance: 'AI_OVERVIEWS',
      classificationSlug: 'ai_overviews',
      classifiedGenerative: true,
      clicks: 6,
      impressions: 60,
      ctr: 0.1,
      position: 2,
      observationMeta: {
        sourceKind: 'first_party',
        sourceLabel: 'gsc.search-appearance',
        observedAt: capturedAt.toISOString(),
        freshUntil: null,
        freshness: 'stale',
        market: null,
        sampleCount: 1,
        coverageNoteKey: null,
      },
      fetchedAt: capturedAt,
    },
    {
      accountId,
      siteId,
      bindingGenerationId,
      property: 'sc-domain:example.test',
      snapshotDate: currentDate,
      windowDays: 28,
      rawAppearance: 'VIDEO',
      classificationSlug: 'video',
      classifiedGenerative: false,
      clicks: 2,
      impressions: 30,
      ctr: 0.066,
      position: 5,
      observationMeta: {
        sourceKind: 'first_party',
        sourceLabel: 'gsc.search-appearance',
        observedAt: capturedAt.toISOString(),
        freshUntil: null,
        freshness: 'fresh',
        market: null,
        sampleCount: 1,
        coverageNoteKey: null,
      },
      fetchedAt: capturedAt,
    },
  ]);
}

async function seedGa4(): Promise<void> {
  await getTestDb().insert(ga4Metrics).values([
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, windowDays: 28, dimensionSet: 'channel', dimensionKey: 'organic', sessions: 100, activeUsers: 80, engagedSessions: 50, keyEvents: 10, fetchedAt: capturedAt },
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, windowDays: 28, dimensionSet: 'channel', dimensionKey: 'direct', sessions: 20, activeUsers: 15, engagedSessions: 0, keyEvents: 1, fetchedAt: capturedAt },
    { accountId, siteId, bindingGenerationId, snapshotDate: previousDate, windowDays: 28, dimensionSet: 'channel', dimensionKey: 'organic', sessions: 50, activeUsers: 40, engagedSessions: 20, keyEvents: 5, fetchedAt: new Date('2026-07-10T12:00:00.000Z') },
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, windowDays: 28, dimensionSet: 'page', dimensionKey: '/a', sessions: 70, activeUsers: 60, engagedSessions: 40, keyEvents: 7, fetchedAt: capturedAt },
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, windowDays: 28, dimensionSet: 'country', dimensionKey: 'US', sessions: 60, activeUsers: 50, engagedSessions: 30, keyEvents: 6, fetchedAt: capturedAt },
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, windowDays: 28, dimensionSet: 'device', dimensionKey: 'mobile', sessions: 80, activeUsers: 65, engagedSessions: 45, keyEvents: 8, fetchedAt: capturedAt },
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, windowDays: 90, dimensionSet: 'date', dimensionKey: '2026-08-07', sessions: 10, activeUsers: 8, engagedSessions: 5, keyEvents: 1, fetchedAt: capturedAt },
    { accountId, siteId, bindingGenerationId, snapshotDate: currentDate, windowDays: 90, dimensionSet: 'date', dimensionKey: '2026-08-08', sessions: 20, activeUsers: 16, engagedSessions: 10, keyEvents: 2, fetchedAt: capturedAt },
  ]);
}

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
  await seedSiteAndConnection();
  await seedGsc();
  await seedGa4();
});

describe('Google report-export helpers', () => {
  it('normalizes windows, sitemap states, columns, sources, and site labels', () => {
    expect(internals.windowDays('7d')).toBe(7);
    expect(internals.windowDays('28d')).toBe(28);
    expect(internals.windowDays('90d')).toBe(90);
    expect(internals.sitemapStatus({ errors: 1, warnings: 0, isPending: false, processed: 0 })).toBe('error');
    expect(internals.sitemapStatus({ errors: 0, warnings: 1, isPending: false, processed: 0 })).toBe('error');
    expect(internals.sitemapStatus({ errors: 0, warnings: 0, isPending: false, processed: 1 })).toBe('processed');
    expect(internals.sitemapStatus({ errors: 0, warnings: 0, isPending: true, processed: 0 })).toBe('submitted');
    expect(internals.metricsColumns('en', 'fields.query')).toHaveLength(5);
    expect(internals.ga4MetricColumns('en', 'fields.channel')).toHaveLength(5);
    expect(internals.gscSource('en', currentDate, 28)).toMatchObject({ id: 'gsc-observation', lagDays: expect.any(Number) });

    const publicSite: PublicSite = {
      id: siteId,
      url: 'https://example.test',
      domain: 'example.test',
      displayName: '',
      paused: false,
      pausedAt: null,
      createdAt: capturedAt.toISOString(),
      updatedAt: capturedAt.toISOString(),
    };
    expect(internals.googleDocument({
      kind: 'google.ga4',
      catalogStem: 'googleGa4',
      locale: 'en',
      site: publicSite,
      branding,
      selection: [],
      sourceDates: [],
      representedItems: 0,
      blocks: [],
    }).subject[0]?.value).toBe('example.test');
    expect(() => internals.assertStableGoogleVersion('a', 'b')).toThrow();
    expect(() => internals.assertStableGoogleVersion('a', 'a')).not.toThrow();
    expect(internals.assertStoredGoogleSite({ domain: 'example.test' })).toEqual({ domain: 'example.test' });
    expect(() => internals.assertStoredGoogleSite(null)).toThrow();
  });

  it('versions every relational source and enforces immutable persistence', async () => {
    for (const kind of ['google.gsc_search', 'google.gsc_sitemaps', 'google.gsc_generative_appearance', 'google.ga4'] as const) {
      const version = await internals.googleStoredVersion(getTestDb(), kind, accountId, siteId);
      expect(version).toMatch(new RegExp(`^${kind.replaceAll('.', '\\.')}:`, 'u'));
      await expect(internals.assertGoogleVersion(getTestDb(), kind, access('persist', version))).resolves.toBeUndefined();
      await expect(internals.assertGoogleVersion(getTestDb(), kind, access('persist', 'stale'))).rejects.toMatchObject({ status: 409 });
    }
    await expect(internals.assertGoogleVersion(getTestDb(), 'google.ga4', access())).resolves.toBeUndefined();
    await expect(internals.assertGoogleVersion(getTestDb(), 'google.ga4', { ...access('persist'), target: { scope: 'account_resource' as const, resourceId: 'x' } })).resolves.toBeUndefined();
    await getTestDb().delete(ga4Metrics).where(and(eq(ga4Metrics.accountId, accountId), eq(ga4Metrics.siteId, siteId)));
    await expect(internals.googleStoredVersion(getTestDb(), 'google.ga4', accountId, siteId)).resolves.toMatch(/^google\.ga4:/u);
  });

  it('reconstructs all report kinds from legacy Site bindings without generation ids', async () => {
    await Site.updateOne(
      { _id: siteId },
      { $unset: { gscBindingGenerationId: 1, ga4BindingGenerationId: 1 } },
    );

    for (const kind of [
      'google.gsc_search',
      'google.gsc_sitemaps',
      'google.gsc_generative_appearance',
      'google.ga4',
    ] as const) {
      const item = adapter(kind);
      await expect(item.compose(compose(item, {}))).resolves.toMatchObject({
        sourceVersion: expect.stringContaining(`${kind}:`),
      });
    }
  });

  it('serializes a missing frozen GA4 property without inventing one', async () => {
    await Site.updateOne({ _id: siteId }, { $set: { ga4PropertyId: null } });
    await expect(internals.reportBinding(accountId, siteId, 'google.ga4'))
      .resolves.toEqual({ generation: 'legacy', property: null });
  });
});

describe('GSC search report adapter', () => {
  it('enforces site ownership, immutable sources, schema bounds, and every dimension', async () => {
    const item = adapter('google.gsc_search');
    await expect(item.assertAccess({ ...access(), target: { scope: 'account_resource' as const, resourceId: 'x' } })).rejects.toMatchObject({ status: 404 });
    await expect(item.assertAccess({ ...access(), accountId: foreignAccountId })).rejects.toMatchObject({ status: 404 });
    await expect(item.assertAccess(access())).resolves.toBeUndefined();
    await expect(item.assertAccess(access('persist', 'stale'))).rejects.toMatchObject({ status: 409 });
    expect(item.selectionSchema.parse({})).toMatchObject({ window: '28d', dimensions: expect.arrayContaining(['summary', 'date']) });
    expect(item.selectionSchema.safeParse({ dimensions: [] }).success).toBe(false);
    await expect(item.compose({ ...compose(item, {}), target: { scope: 'account_resource' as const, resourceId: 'x' } })).rejects.toMatchObject({ status: 404 });

    const result = await item.compose(compose(item, {}));
    expect(result.document.blocks.map((block) => block.type)).toEqual(expect.arrayContaining(['kpi_group', 'table', 'time_series', 'source_note']));
    expect(result.document.completeness.selectedItems).toBeGreaterThan(5);
    for (const format of item.supportedFormats) {
      await expect(item.render({ document: result.document, format, snapshotCreatedAt: capturedAt.toISOString() }), `gsc ${format}`).resolves.toMatchObject({ format });
    }
    const table = result.document.blocks.find((block) => block.type === 'table');
    const series = result.document.blocks.find((block) => block.type === 'time_series');
    if (!table || table.type !== 'table' || !series || series.type !== 'time_series') throw new Error('GSC projections unavailable');
    const { id: _tableId, ...tableRowWithoutId } = table.rows[0]!;
    const { id: _seriesId, ...seriesRowWithoutId } = series.tableFallback.rows[0]!;
    expect(internals.googleCsvRows({
      ...result.document,
      blocks: [
        { ...table, rows: [tableRowWithoutId] },
        { ...series, tableFallback: { ...series.tableFallback, rows: [seriesRowWithoutId] } },
      ],
    })).toHaveLength(2);

    await getTestDb().delete(gscSearchAnalytics).where(and(eq(gscSearchAnalytics.dimensionSet, 'query'), eq(gscSearchAnalytics.snapshotDate, previousDate)));
    const summaryOnly = await item.compose(compose(item, { dimensions: ['summary'] }));
    const summary = summaryOnly.document.blocks.find((block) => block.type === 'kpi_group');
    expect(summary && summary.type === 'kpi_group' ? summary.items.filter((entry) => entry.value.value === null) : []).toHaveLength(2);
    const queryOnly = await item.compose(compose(item, { dimensions: ['query'] }));
    expect(queryOnly.document.blocks.filter((block) => block.type === 'table')).toHaveLength(1);
    expect(queryOnly.document.blocks.some((block) => block.type === 'kpi_group')).toBe(false);
    expect(queryOnly.document.blocks.some((block) => block.type === 'time_series')).toBe(false);
  });
});

describe('GSC sitemap report adapter', () => {
  it('covers submitted, processed, error, filtered-empty, and unavailable snapshots', async () => {
    const item = adapter('google.gsc_sitemaps');
    await expect(item.assertAccess({ ...access(), target: { scope: 'account_resource' as const, resourceId: 'x' } })).rejects.toMatchObject({ status: 404 });
    await expect(item.assertAccess(access())).resolves.toBeUndefined();
    await expect(item.assertAccess(access('persist', 'stale'))).rejects.toMatchObject({ status: 409 });
    expect(item.selectionSchema.parse({})).toEqual({});
    expect(item.selectionSchema.safeParse({ status: 'unknown' }).success).toBe(false);
    await expect(item.compose({ ...compose(item, {}), target: { scope: 'account_resource' as const, resourceId: 'x' } })).rejects.toMatchObject({ status: 404 });

    const all = await item.compose(compose(item, {}));
    expect(all.document.completeness.selectedItems).toBe(3);
    for (const status of ['submitted', 'processed', 'error'] as const) {
      await expect(item.compose(compose(item, { status }))).resolves.toMatchObject({ document: { completeness: { selectedItems: 1 } } });
    }
    for (const format of item.supportedFormats) {
      await expect(item.render({ document: all.document, format, snapshotCreatedAt: capturedAt.toISOString() }), `sitemap ${format}`).resolves.toMatchObject({ format });
    }

    await getTestDb().delete(gscSitemaps).where(eq(gscSitemaps.path, 'https://example.test/processed.xml'));
    const filtered = await item.compose(compose(item, { status: 'processed' }));
    expect(filtered.document.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'state', state: 'empty' })]));
    await getTestDb().delete(gscSitemaps);
    const unavailable = await item.compose(compose(item, {}));
    expect(unavailable.document.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'state', state: 'unavailable' })]));
  });
});

describe('GSC generative-appearance report adapter', () => {
  it('filters classifications, preserves freshness, falls back to the domain, and represents no snapshot', async () => {
    const item = adapter('google.gsc_generative_appearance');
    await expect(item.assertAccess({ ...access(), target: { scope: 'account_resource' as const, resourceId: 'x' } })).rejects.toMatchObject({ status: 404 });
    await expect(item.assertAccess(access())).resolves.toBeUndefined();
    await expect(item.assertAccess(access('persist', 'stale'))).rejects.toMatchObject({ status: 409 });
    expect(item.selectionSchema.parse({})).toEqual({ window: '28d' });
    expect(item.selectionSchema.safeParse({ classification: Array.from({ length: 51 }, () => 'x') }).success).toBe(false);
    await expect(item.compose({ ...compose(item, {}), target: { scope: 'account_resource' as const, resourceId: 'x' } })).rejects.toMatchObject({ status: 404 });

    const all = await item.compose(compose(item, {}));
    expect(all.document.completeness.selectedItems).toBe(2);
    expect(all.document.sourceDates[0]).toMatchObject({ freshness: 'stale' });
    const filtered = await item.compose(compose(item, { classification: ['ai_overviews'] }));
    expect(filtered.document.completeness.selectedItems).toBe(1);
    const none = await item.compose(compose(item, { classification: ['other_unknown'] }));
    expect(none.document.completeness.selectedItems).toBe(0);
    for (const format of item.supportedFormats) {
      await expect(item.render({ document: all.document, format, snapshotCreatedAt: capturedAt.toISOString() }), `generative ${format}`).resolves.toMatchObject({ format });
    }

    await Site.updateOne({ _id: siteId }, { $set: { gscPropertyUrl: null, displayName: '' } });
    expect((await item.compose(compose(item, {}))).document.subject[0]?.value).toBe('example.test');
    await Site.updateOne({ _id: siteId }, { $set: { gscPropertyUrl: 'sc-domain:example.test' } });
    await getTestDb().update(gscSearchAppearance).set({
      observationMeta: {
        sourceKind: 'first_party',
        sourceLabel: 'gsc.search-appearance',
        observedAt: capturedAt.toISOString(),
        freshUntil: null,
        freshness: 'fresh',
        market: null,
        sampleCount: 1,
        coverageNoteKey: null,
      },
    });
    expect((await item.compose(compose(item, {}))).document.sourceDates[0]).toMatchObject({ freshness: 'unknown' });
    await getTestDb().delete(gscSearchAppearance);
    const unavailable = await item.compose(compose(item, {}));
    expect(unavailable.document.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'state', state: 'unavailable' })]));
  });
});

describe('GA4 report adapter', () => {
  it('enforces connection/site access and renders every summary and detail dimension', async () => {
    const item = adapter('google.ga4');
    await expect(item.assertAccess({ ...access(), target: { scope: 'account_resource' as const, resourceId: 'x' } })).rejects.toMatchObject({ status: 404 });
    await expect(item.assertAccess({ ...access(), accountId: foreignAccountId })).rejects.toMatchObject({ status: 404 });
    await expect(item.assertAccess(access())).resolves.toBeUndefined();
    await expect(item.assertAccess(access('persist', 'stale'))).rejects.toMatchObject({ status: 409 });
    expect(item.selectionSchema.parse({})).toMatchObject({ window: '28d', dimensions: expect.arrayContaining(['summary', 'date']) });
    expect(item.selectionSchema.safeParse({ window: '365d' }).success).toBe(false);
    await expect(item.compose({ ...compose(item, {}), target: { scope: 'account_resource' as const, resourceId: 'x' } })).rejects.toMatchObject({ status: 404 });

    const result = await item.compose(compose(item, {}));
    expect(result.document.blocks.map((block) => block.type)).toEqual(expect.arrayContaining(['kpi_group', 'table', 'time_series', 'source_note']));
    expect(result.document.completeness.selectedItems).toBeGreaterThan(5);
    for (const format of item.supportedFormats) {
      await expect(item.render({ document: result.document, format, snapshotCreatedAt: capturedAt.toISOString() }), `ga4 ${format}`).resolves.toMatchObject({ format });
    }

    await getTestDb().delete(ga4Metrics).where(and(eq(ga4Metrics.dimensionSet, 'channel'), eq(ga4Metrics.snapshotDate, previousDate)));
    const channelOnly = await item.compose(compose(item, { dimensions: ['channel'] }));
    expect(channelOnly.document.blocks.filter((block) => block.type === 'table')).toHaveLength(1);
    expect(channelOnly.document.blocks.some((block) => block.type === 'kpi_group')).toBe(false);
    expect(channelOnly.document.blocks.some((block) => block.type === 'time_series')).toBe(false);
  });
});
