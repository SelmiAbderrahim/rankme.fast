import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../db/client.js';
import {
  competitorIntersections,
  competitors,
  trafficSnapshots,
  vendorResponses,
  type TrafficSnapshotPayload,
} from '../../db/schema/index.js';
import type {
  ReportBrandingSnapshot,
  ReportJsonValue,
} from '../../shared/report-exports/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { getSite, type PublicSite } from '../sites/index.js';
import {
  competitorReportExportTestables as internals,
  createCompetitorReportExportAdapters,
} from './report-export.adapters.js';
import { compareTrafficSnapshots } from './traffic-snapshots.compare.js';
import { getSnapshot } from './traffic-snapshots.service.js';

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./traffic-snapshots.service.js', () => ({ getSnapshot: vi.fn() }));
vi.mock('./traffic-snapshots.compare.js', () => ({ compareTrafficSnapshots: vi.fn() }));

const accountId = 'competitor-report-account';
const actorUserId = 'competitor-report-user';
const siteId = '507f1f77bcf86cd799439011';
const runA = '507f1f77bcf86cd799439012';
const runB = '507f1f77bcf86cd799439013';
const capturedAt = '2026-08-08T12:00:00.000Z';
const observedAt = new Date(capturedAt);
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};
const site: PublicSite = {
  id: siteId,
  url: 'https://example.test',
  domain: 'example.test',
  displayName: 'Example',
  paused: false,
  pausedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: capturedAt,
};

function database(): Db {
  return getTestDb() as unknown as Db;
}

const estimate = {
  sourceKind: 'estimate' as const,
  sourceLabel: null,
  observedAt: capturedAt,
  freshUntil: null,
  freshness: 'fresh' as const,
  market: null,
  sampleCount: 1,
  coverageNoteKey: null,
};

function payload(input: {
  visits?: number;
  rank?: number | null;
  keywords?: number | null;
  countries?: Array<{ countryCode: string; visits: number }>;
  history?: Array<{ capturedAt: string; visits: number; rank: number | null; keywords: number }>;
  retained?: { traffic: boolean; rankOverview: boolean; history: boolean };
} = {}): TrafficSnapshotPayload {
  return {
    monthlyOrganicVisits: { value: input.visits ?? 100, observation: estimate },
    topCountries: (input.countries ?? [{ countryCode: 'US', visits: 60 }, { countryCode: 'DE', visits: 20 }]).map((country) => ({ countryCode: country.countryCode, visits: { value: country.visits, observation: estimate } })),
    domainRank: { value: input.rank === undefined ? 40 : input.rank, observation: estimate },
    keywordCount: { value: input.keywords === undefined ? 20 : input.keywords, observation: estimate },
    history: (input.history ?? [
      { capturedAt: '2026-06-01T00:00:00.000Z', visits: 50, rank: 50, keywords: 10 },
      { capturedAt: '2026-07-01T00:00:00.000Z', visits: 100, rank: 40, keywords: 20 },
    ]).map((point) => ({
      capturedAt: point.capturedAt,
      rank: { value: point.rank, observation: estimate },
      traffic: { value: point.visits, observation: estimate },
      keywordCount: { value: point.keywords, observation: estimate },
    })),
    retained: input.retained ?? { traffic: true, rankOverview: true, history: true },
  };
}

function snapshotRun(input: {
  id?: string;
  site?: string | null;
  domain?: string;
  completedAt?: string | null;
  snapshot?: { capturedAt: string; payload: TrafficSnapshotPayload } | null;
} = {}) {
  return {
    id: input.id ?? runA,
    siteId: input.site === undefined ? siteId : input.site,
    targetDomain: input.domain ?? 'alpha.test',
    inputs: { locationCode: 2840, languageCode: 'en', historyMonths: 12 },
    status: 'succeeded' as const,
    retainedOps: { traffic: true, rankOverview: true, history: true },
    createdAt: '2026-08-01T00:00:00.000Z',
    completedAt: input.completedAt === undefined ? '2026-08-08T00:00:00.000Z' : input.completedAt,
    snapshot: input.snapshot === undefined ? { capturedAt, payload: payload() } : input.snapshot,
  } satisfies Awaited<ReturnType<typeof getSnapshot>>;
}

function comparison(input: { snapshots?: Array<{ id: string; siteId: string | null; targetDomain: string; capturedAt: string; payload: TrafficSnapshotPayload }>; countryCodes?: string[] } = {}) {
  return {
    snapshots: input.snapshots ?? [
      { id: runB, siteId, targetDomain: 'beta.test', capturedAt: '2026-08-09T00:00:00.000Z', payload: payload() },
      { id: runA, siteId, targetDomain: 'alpha.test', capturedAt, payload: payload() },
    ],
    axes: { countryCodes: input.countryCodes ?? ['US', 'DE'] },
  } satisfies Awaited<ReturnType<typeof compareTrafficSnapshots>>;
}

beforeAll(async () => {
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
  vi.mocked(getSite).mockReset();
  vi.mocked(getSnapshot).mockReset();
  vi.mocked(compareTrafficSnapshots).mockReset();
  vi.mocked(getSite).mockResolvedValue(site);
});

function siteAccess(purpose: 'create' | 'persist' = 'create') {
  return { accountId, actorUserId, purpose, target: { scope: 'site' as const, siteId }, format: 'json' as const, locale: 'en' as const };
}

function resourceAccess(resourceId = runA, purpose: 'create' | 'persist' = 'create', targetSiteId: string | undefined = siteId) {
  return {
    accountId, actorUserId, purpose,
    target: { scope: 'account_resource' as const, resourceId, ...(targetSiteId === undefined ? {} : { siteId: targetSiteId }) },
    format: 'json' as const, locale: 'en' as const,
  };
}

function siteCompose(selection: Record<string, ReportJsonValue>) {
  return { ...siteAccess(), selection, branding };
}

function resourceCompose(selection: Record<string, ReportJsonValue>, resourceId = runA, targetSiteId: string | undefined = siteId) {
  return { ...resourceAccess(resourceId, 'create', targetSiteId), selection, branding };
}

async function insertCompetitor(input: { domain: string; day?: string; intersections?: number; fetchedAt?: Date; account?: string; site?: string }) {
  await getTestDb().insert(competitors).values({
    accountId: input.account ?? accountId,
    siteId: input.site ?? siteId,
    competitorDomain: input.domain,
    avgPosition: '4.5',
    intersections: input.intersections ?? 10,
    estimatedTraffic: '100.5',
    source: 'domain',
    fetchedAt: input.fetchedAt ?? observedAt,
    snapshotDay: input.day ?? '2026-08-08',
  });
}

async function insertIntersection(input: { domain: string; keywords: unknown; fetchedAt?: Date; account?: string; site?: string }) {
  await getTestDb().insert(competitorIntersections).values({
    accountId: input.account ?? accountId,
    siteId: input.site ?? siteId,
    competitorDomain: input.domain,
    keywords: input.keywords,
    fetchedAt: input.fetchedAt ?? observedAt,
  });
}

async function insertTech(input: { domain?: unknown; payload: unknown; fetchedAt?: Date }) {
  await getTestDb().insert(vendorResponses).values({
    capability: 'competitor', operation: 'tech-stack', cacheKey: randomUUID(),
    params: { domain: input.domain }, payload: input.payload,
    fetchedAt: input.fetchedAt ?? observedAt,
  });
}

describe('competitor report-export helpers', () => {
  it('normalizes values and enforces target scopes/site binding', () => {
    expect(internals.record({ a: 1 })).toEqual({ a: 1 });
    expect(internals.record(null)).toBeNull();
    expect(internals.record([])).toBeNull();
    expect(internals.record('bad')).toBeNull();
    expect(internals.textValue('a')).toBe('a');
    expect(internals.textValue(1)).toBeNull();
    expect(() => internals.assertSiteTarget({ scope: 'account_resource', resourceId: runA })).toThrow();
    expect(() => internals.assertSiteTarget({ scope: 'site', siteId })).not.toThrow();
    expect(() => internals.assertResourceTarget({ scope: 'site', siteId })).toThrow();
    expect(() => internals.assertResourceTarget({ scope: 'account_resource', resourceId: runA })).not.toThrow();
    expect(() => internals.assertResourceSite({ scope: 'account_resource', resourceId: runA }, null)).not.toThrow();
    expect(() => internals.assertResourceSite({ scope: 'account_resource', resourceId: runA, siteId }, 'foreign')).toThrow();
    expect(internals.comparisonAllowedSiteIds({ scope: 'account_resource', resourceId: runA })).toBeNull();
    expect(internals.comparisonAllowedSiteIds({ scope: 'account_resource', resourceId: runA, siteId })).toEqual([siteId]);
  });

  it('bounds selection labels, columns, and document metadata', () => {
    const items = internals.selectionItems('en', { alpha: ['a', 'b'], huge: ['x'.repeat(901)], longScalar: 'x'.repeat(901), nil: undefined });
    expect(items[0]?.value).toBe('a, b');
    expect(items[1]?.value).toMatch(/^1; selection:/u);
    expect(items[2]?.value).toMatch(/^1; selection:/u);
    expect(items[3]?.value).toBe('');
    expect(internals.boundedListLabel(['beta', 'alpha'])).toBe('alpha, beta');
    expect(internals.boundedListLabel(['x'.repeat(901), 'a'])).toMatch(/^2; selection:/u);
    expect(internals.columns('en')).toHaveLength(8);
    expect(internals.document({ kind: 'competitors.organic', stem: 'competitorsOrganic', locale: 'en', branding, subject: site.domain, selection: {}, dates: [], rows: [], noteKey: 'notes.competitorObservation', sourceDateId: 'source' })).toMatchObject({ completeness: { selectedItems: 0 }, artifacts: [] });
  });
});

describe('organic competitor report adapter', () => {
  it('reads only the latest day and sorts list rows deterministically', async () => {
    await insertCompetitor({ domain: 'old.test', day: '2026-08-07', fetchedAt: new Date('2026-08-07T00:00:00Z'), intersections: 99 });
    await insertCompetitor({ domain: 'beta.test', intersections: 10 });
    await insertCompetitor({ domain: 'alpha.test', intersections: 10 });
    await insertCompetitor({ domain: 'gamma.test', intersections: 20 });
    await insertCompetitor({ domain: 'foreign.test', account: 'foreign', site: 'foreign' });
    const data = await internals.organicData(database(), accountId, siteId, { mode: 'list' });
    expect(data).toMatchObject({ mode: 'list' });
    if (data.mode !== 'list') throw new Error('expected list data');
    expect(data.rows.map((row) => row.competitorDomain)).toEqual(['gamma.test', 'alpha.test', 'beta.test']);
    expect((await internals.organicData(database(), accountId, 'empty', { mode: 'list' }))).toMatchObject({ rows: [] });
  });

  it('enforces target/source and composes list rows with fallback subject/date', async () => {
    const [adapter] = createCompetitorReportExportAdapters(database());
    await insertCompetitor({ domain: 'alpha.test' });
    await insertIntersection({ domain: 'alpha.test', keywords: [] });
    await expect(adapter?.assertAccess({ ...siteAccess(), target: { scope: 'account_resource' as const, resourceId: runA } })).rejects.toMatchObject({ status: 404 });
    await expect(adapter?.assertAccess({ ...siteAccess('persist'), sourceVersion: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(adapter?.assertAccess(siteAccess())).resolves.toBeUndefined();
    vi.mocked(getSite).mockResolvedValue({ ...site, displayName: '' });
    const result = await adapter?.compose(siteCompose({ mode: 'list' }));
    expect(result?.document.subject[0]?.value).toBe(site.domain);
    expect(result?.document.completeness.selectedItems).toBe(1);
    if (!adapter || !result) throw new Error('organic adapter unavailable');
    for (const format of adapter.supportedFormats) await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: capturedAt })).resolves.toMatchObject({ format });
    expect(adapter.selectionSchema.parse({})).toEqual({ mode: 'list' });
    expect(adapter.selectionSchema.safeParse({ mode: 'intersection' }).success).toBe(false);
    await getTestDb().delete(competitors);
    const empty = await adapter.compose(siteCompose({ mode: 'list' }));
    expect(empty.document.sourceDates[0]?.observedAt).toBe(site.updatedAt);
  });

  it('selects the latest intersection and filters malformed/nonmatching rows', async () => {
    const [adapter] = createCompetitorReportExportAdapters(database());
    await expect(internals.organicData(database(), accountId, siteId, { mode: 'intersection', domain: 'missing.test' })).rejects.toMatchObject({ status: 404 });
    await insertIntersection({ domain: 'alpha.test', keywords: [{ keyword: 'old' }], fetchedAt: new Date('2026-08-07T00:00:00Z') });
    await insertIntersection({ domain: 'alpha.test', keywords: [null, { class: 'missing', keyword: 'gap', searchVolume: 20, target1Position: null, target2Position: 3 }, { class: 'missing', keyword: 1, target1Position: 8, target2Position: null, target1Url: 'https://example.test/a', target2Url: 'https://alpha.test/a' }, { class: 'other', keyword: 'filtered' }, { keyword: 'classless' }] });
    const result = await adapter?.compose(siteCompose({ mode: 'intersection', domain: 'alpha.test', rowClass: 'missing' }));
    expect(result?.document.completeness.selectedItems).toBe(2);
    expect((await adapter?.compose(siteCompose({ mode: 'intersection', domain: 'alpha.test' })))?.document.completeness.selectedItems).toBe(4);
    await insertIntersection({ domain: 'broken.test', keywords: { bad: true } });
    expect((await adapter?.compose(siteCompose({ mode: 'intersection', domain: 'broken.test' })))?.document.completeness.selectedItems).toBe(0);
  });
});

describe('competitor technology report adapter', () => {
  it('versions only known-domain archives and finds latest case-insensitively', async () => {
    await insertCompetitor({ domain: 'known.test' });
    await insertTech({ domain: 'foreign.test', payload: [] });
    await insertTech({ domain: 2, payload: [] });
    await insertTech({ domain: 'KNOWN.TEST', payload: [{ category: 'cms', name: 'Old' }], fetchedAt: new Date('2026-08-07T00:00:00Z') });
    await insertTech({ domain: 'known.test', payload: [{ category: 'cms', name: 'New' }] });
    expect(await internals.techSiteVersion(database(), accountId, siteId)).toMatch(/^competitors\.tech_stack:/u);
    expect((await internals.techArchive(database(), 'KNOWN.TEST'))?.fetchedAt).toEqual(observedAt);
    expect(await internals.techArchive(database(), 'missing.test')).toBeNull();
  });

  it('enforces known sources, schema validation, category selection, and rendering', async () => {
    const [, adapter] = createCompetitorReportExportAdapters(database());
    await expect(adapter?.compose(siteCompose({ domain: 'missing.test' }))).rejects.toMatchObject({ status: 404 });
    await insertCompetitor({ domain: 'known.test' });
    await expect(adapter?.compose(siteCompose({ domain: 'known.test' }))).rejects.toMatchObject({ status: 404 });
    await insertTech({ domain: 'known.test', payload: { techStack: [{ category: 'cms', name: 'WordPress', ignored: true }, { category: 'analytics', name: 'Analytics' }] } });
    await expect(adapter?.assertAccess({ ...siteAccess('persist'), sourceVersion: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(adapter?.assertAccess(siteAccess())).resolves.toBeUndefined();
    const result = await adapter?.compose(siteCompose({ domain: 'known.test', category: 'cms' }));
    expect(result?.document.completeness.selectedItems).toBe(1);
    if (!adapter || !result) throw new Error('tech adapter unavailable');
    for (const format of adapter.supportedFormats) await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: capturedAt })).resolves.toMatchObject({ format });
    vi.mocked(getSite).mockResolvedValue({ ...site, displayName: '' });
    expect((await adapter.compose(siteCompose({ domain: 'known.test' }))).document.subject[0]?.value).toBe(site.domain);

    await insertCompetitor({ domain: 'invalid.test' });
    await insertTech({ domain: 'invalid.test', payload: { techStack: [{ category: 'bad', name: '' }] } });
    await expect(adapter.compose(siteCompose({ domain: 'invalid.test' }))).rejects.toMatchObject({ status: 404 });
    await insertCompetitor({ domain: 'direct.test' });
    await insertTech({ domain: 'direct.test', payload: [{ category: 'hosting', name: 'Direct' }] });
    expect((await adapter.compose(siteCompose({ domain: 'direct.test' }))).document.completeness.selectedItems).toBe(1);
  });
});

describe('traffic snapshot report adapter', () => {
  it('shapes unavailable, availability, nullable summaries, countries, and history', () => {
    const unavailable = internals.snapshotRows(snapshotRun({ snapshot: null, completedAt: null }), {});
    expect(unavailable).toHaveLength(1);
    const run = snapshotRun({ snapshot: { capturedAt, payload: payload({ rank: null, keywords: null, retained: { traffic: true, rankOverview: false, history: false }, countries: [{ countryCode: 'DE', visits: 20 }, { countryCode: 'US', visits: 60 }], history: [{ capturedAt: '2026-07-01T00:00:00.000Z', visits: 30, rank: null, keywords: 4 }, { capturedAt: '2026-06-01T00:00:00.000Z', visits: 20, rank: 70, keywords: 3 }] }) } });
    const all = internals.snapshotRows(run, {});
    expect(all).toHaveLength(10);
    expect(JSON.stringify(all)).toContain('unavailable');
    expect(internals.snapshotRows(run, { country: 'US' }).filter((row) => (row.id ?? '').startsWith('country-'))).toHaveLength(1);
  });

  it('enforces scope/site/source and composes all advertised formats', async () => {
    const [, , adapter] = createCompetitorReportExportAdapters(database());
    const run = snapshotRun({});
    vi.mocked(getSnapshot).mockResolvedValue(run);
    await expect(adapter?.assertAccess({ ...resourceAccess(), target: { scope: 'site' as const, siteId } })).rejects.toMatchObject({ status: 404 });
    await expect(adapter?.assertAccess(resourceAccess(runA, 'create', 'foreign'))).rejects.toMatchObject({ status: 404 });
    await expect(adapter?.assertAccess({ ...resourceAccess(runA, 'persist'), sourceVersion: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(adapter?.assertAccess(resourceAccess())).resolves.toBeUndefined();
    const result = await adapter?.compose(resourceCompose({ country: 'US' }));
    expect(result?.document.completeness.selectedItems).toBeGreaterThan(0);
    if (!adapter || !result) throw new Error('snapshot adapter unavailable');
    for (const format of adapter.supportedFormats) await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: capturedAt })).resolves.toMatchObject({ format });
  });

  it('uses completed and created fallbacks without a retained snapshot', async () => {
    const [, , adapter] = createCompetitorReportExportAdapters(database());
    vi.mocked(getSnapshot).mockResolvedValue(snapshotRun({ snapshot: null, completedAt: null }));
    const result = await adapter?.compose(resourceCompose({}));
    expect(result?.document.sourceDates[0]?.observedAt).toBe('2026-08-01T00:00:00.000Z');
  });
});

describe('traffic comparison report adapter', () => {
  it('builds deterministic rows for every metric, country, history, and completeness state', () => {
    const value = comparison({ snapshots: [
      { id: runB, siteId, targetDomain: 'same.test', capturedAt, payload: payload({ keywords: null, retained: { traffic: false, rankOverview: false, history: false }, countries: [{ countryCode: 'US', visits: 10 }], history: [] }) },
      { id: runA, siteId, targetDomain: 'same.test', capturedAt, payload: payload({ rank: null, countries: [], history: [{ capturedAt: '2026-06-01T00:00:00.000Z', visits: 1, rank: null, keywords: 1 }, { capturedAt: '2026-07-01T00:00:00.000Z', visits: 2, rank: null, keywords: 2 }] }) },
    ], countryCodes: ['US', 'DE'] });
    const all = internals.trafficComparisonRows(value, { snapshotIds: [runA, runB] });
    expect(all.length).toBeGreaterThan(20);
    expect(JSON.stringify(all)).toContain('insufficient_history');
    expect(JSON.stringify(all)).toContain('unavailable');
    for (const metric of ['visits', 'rank', 'keywords'] as const) {
      const selected = internals.trafficComparisonRows(value, { snapshotIds: [runA, runB], metric, country: 'US' });
      expect(selected.every((row) => (row.id ?? '').includes(metric) || (row.id ?? '').includes('availability') || (row.id ?? '').includes('country'))).toBe(true);
    }
  });

  it('enforces identity, all site bindings, source version, and date fallbacks', async () => {
    const [, , , adapter] = createCompetitorReportExportAdapters(database());
    const first = snapshotRun({ id: runA });
    const second = snapshotRun({ id: runB, domain: 'beta.test' });
    vi.mocked(getSnapshot).mockImplementation(async (_account, id) => id === runA ? first : second);
    vi.mocked(compareTrafficSnapshots).mockResolvedValue(comparison());
    await getTestDb().insert(trafficSnapshots).values([
      { accountId, runId: runA, siteId, targetDomain: 'alpha.test', payload: payload(), capturedAt: observedAt },
      { accountId, runId: runB, siteId, targetDomain: 'beta.test', payload: payload(), capturedAt: new Date('2026-08-09T00:00:00Z') },
      { accountId: 'foreign', runId: 'foreign-run', siteId, targetDomain: 'foreign.test', payload: payload(), capturedAt: observedAt },
    ]);
    await expect(adapter?.assertAccess({ ...resourceAccess(), target: { scope: 'site' as const, siteId } })).rejects.toMatchObject({ status: 404 });
    await expect(adapter?.assertAccess({ ...resourceAccess(runA, 'persist'), sourceVersion: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(adapter?.assertAccess(resourceAccess())).resolves.toBeUndefined();
    await expect(adapter?.compose(resourceCompose({ snapshotIds: [runB] }))).rejects.toMatchObject({ status: 404 });
    vi.mocked(getSnapshot).mockResolvedValueOnce(snapshotRun({ id: runA, site: 'foreign' })).mockResolvedValueOnce(second);
    await expect(adapter?.compose(resourceCompose({ snapshotIds: [runA, runB] }))).rejects.toMatchObject({ status: 404 });
    const result = await adapter?.compose(resourceCompose({ snapshotIds: [runA, runB] }));
    expect(result?.document.sourceDates).toHaveLength(4);
    if (!adapter || !result) throw new Error('comparison adapter unavailable');
    for (const format of adapter.supportedFormats) await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: capturedAt })).resolves.toMatchObject({ format });
    expect(await internals.trafficAccountVersion(database(), accountId)).toMatch(/^competitors\.traffic:/u);
    expect(await internals.trafficAccountVersion(database(), accountId, siteId)).toMatch(/^competitors\.traffic:/u);
  });

  it('validates unique sorted ids and bounds a very long comparison subject', async () => {
    const [, , , adapter] = createCompetitorReportExportAdapters(database());
    expect(adapter?.selectionSchema.safeParse({ snapshotIds: [runA, runA] }).success).toBe(false);
    expect(adapter?.selectionSchema.parse({ snapshotIds: [runB, runA] }).snapshotIds).toEqual([runA, runB]);
    const longComparison = comparison({ snapshots: [
      { id: runA, siteId, targetDomain: 'a'.repeat(500), capturedAt, payload: payload({ history: [] }) },
      { id: runB, siteId, targetDomain: 'b'.repeat(500), capturedAt, payload: payload({ history: [] }) },
    ], countryCodes: [] });
    vi.mocked(getSnapshot).mockImplementation(async (_account, id) => snapshotRun({ id, domain: id === runA ? 'a.test' : 'b.test' }));
    vi.mocked(compareTrafficSnapshots).mockResolvedValue(longComparison);
    const result = await adapter?.compose(resourceCompose({ snapshotIds: [runA, runB] }, runA, undefined));
    expect(result?.document.subject[0]?.value).toMatch(/^2; selection:/u);
    expect(result?.document.sourceDates.filter((date) => date.kind === 'derived').every((date) => date.from === capturedAt && date.to === capturedAt)).toBe(true);
  });
});
