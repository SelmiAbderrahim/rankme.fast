import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  keywordClusterDecisionEvents,
  keywordResearchHistory,
  vendorResponses,
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
import { computeVendorCacheKey } from '../../shared/vendor-cache/index.js';
import { computeKeywordCacheKey } from './keyword-research.cache.js';
import type { ClusterRunSummary } from './keyword-research.clustering.js';
import { findClusterRunForAccount } from './keyword-research.clustering.js';
import {
  findTrendsRun,
  normalizeTrendsExploreInputs,
  serializeStoredRun,
} from './keyword-research.service.js';
import {
  createKeywordResearchReportExportAdapters,
  keywordResearchReportExportTestables as internals,
} from './report-export.adapters.js';
import { TrendsExplorationRun } from './trends-explorations.model.js';

vi.mock(import('./keyword-research.clustering.js'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, findClusterRunForAccount: vi.fn() };
});

vi.mock(import('./keyword-research.service.js'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, findTrendsRun: vi.fn() };
});

const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast',
  companyName: 'RankMeFast',
  accentColor: '#b5321e',
  logo: null,
};
const accountId = 'keyword-report-account';
const actorUserId = 'keyword-report-user';
const observedAt = new Date('2026-08-08T12:00:00.000Z');

beforeAll(async () => {
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
  vi.mocked(findTrendsRun).mockReset();
  vi.mocked(findClusterRunForAccount).mockReset();
});

function access(resourceId: string, purpose: 'create' | 'persist' = 'create') {
  return {
    accountId,
    actorUserId,
    purpose,
    target: { scope: 'account_resource' as const, resourceId },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

function compose(resourceId: string, selection: Record<string, ReportJsonValue> = {}) {
  return {
    accountId,
    actorUserId,
    target: { scope: 'account_resource' as const, resourceId },
    format: 'json' as const,
    locale: 'en' as const,
    selection,
    branding,
  };
}

async function insertHistory(input: {
  kind: 'metrics' | 'related' | 'intent' | 'ideas' | 'gap' | 'overview' | 'trends' | 'clusters';
  phrases?: string[];
  cached?: boolean;
  createdAt?: Date;
}) {
  const id = randomUUID();
  await getTestDb().insert(keywordResearchHistory).values({
    id,
    accountId,
    kind: input.kind,
    phrases: input.phrases ?? ['alpha'],
    locationCode: 2840,
    languageCode: 'EN',
    resultCount: 1,
    cached: input.cached ?? false,
    createdAt: input.createdAt ?? observedAt,
  });
  return id;
}

async function insertKeywordArchive(input: {
  operation: string;
  phrase?: string;
  payload: unknown;
  params?: unknown;
  fetchedAt?: Date;
  cacheKey?: string;
}) {
  const phrase = input.phrase ?? 'alpha';
  await getTestDb().insert(vendorResponses).values({
    capability: 'keyword',
    operation: input.operation,
    cacheKey: input.cacheKey ?? computeKeywordCacheKey({
      phrase,
      locationCode: 2840,
      languageCode: 'EN',
    }),
    params: input.params ?? { phrase, locationCode: 2840, languageCode: 'EN' },
    payload: input.payload,
    fetchedAt: input.fetchedAt ?? new Date(observedAt.getTime() - 1_000),
  });
}

function trendsRun(input: {
  id?: string;
  siteId?: string | null;
  keywords?: string[];
  geo?: string | null;
  language?: string | null;
  completedAt?: Date | null;
  createdAt?: Date;
}) {
  const run = new TrendsExplorationRun({
    _id: input.id ?? '64f000000000000000000001',
    accountId,
    siteId: input.siteId ?? null,
    inputs: {
      keywords: input.keywords ?? ['alpha', 'beta'],
      geo: input.geo === undefined ? 'US' : input.geo,
      language: input.language === undefined ? 'en' : input.language,
    },
    status: 'succeeded',
    retained: true,
    completedAt: input.completedAt ?? observedAt,
    seriesCount: 2,
    relatedQueryCount: 2,
    createdAt: input.createdAt ?? new Date(observedAt.getTime() - 5_000),
    updatedAt: observedAt,
  });
  return run;
}

function clusterRun(): ClusterRunSummary {
  return {
    runId: 'cluster-run',
    accountId,
    market: { locationCode: 2840, languageCode: 'en' },
    memberRefs: [
      { keyword: 'beta', source: 'history', observedAt },
      { keyword: 'alpha', source: 'vendor_cache', observedAt: new Date(observedAt.getTime() - 1_000) },
    ],
    clusters: [
      { clusterId: 'z-cluster', label: 'Zed', memberKeywords: ['beta', 'alpha'], suggestedRoute: 'seo', confidence: 'high', summedSearchVolume: 30 },
      { clusterId: 'a-cluster', label: 'Aye', memberKeywords: ['gamma'], suggestedRoute: 'brief', confidence: 'medium', summedSearchVolume: 10 },
      { clusterId: 'm-cluster', label: 'Em', memberKeywords: ['delta'], suggestedRoute: 'seo', confidence: 'low', summedSearchVolume: 5 },
    ],
    aiProfile: { name: 'keyword-cluster', version: '1' },
    costMicros: 12,
    createdAt: observedAt,
    cached: true,
  };
}

describe('keyword research report-export pure shaping', () => {
  it('normalizes defensive scalar and record inputs', () => {
    expect(internals.record({ value: 1 })).toEqual({ value: 1 });
    expect(internals.record(null)).toBeNull();
    expect(internals.record([])).toBeNull();
    expect(internals.record('value')).toBeNull();
    expect(internals.strings(['a', 2, 'b'])).toEqual(['a', 'b']);
    expect(internals.strings('a')).toEqual([]);
    expect(internals.numberOrNull(2)).toBe(2);
    expect(internals.numberOrNull(Number.NaN)).toBeNull();
    expect(internals.numberOrNull('2')).toBeNull();
    expect(internals.stringOrNull('a')).toBe('a');
    expect(internals.stringOrNull(1)).toBeNull();
    expect(internals.boundedListLabel(['beta', 'alpha'])).toBe('alpha, beta');
    const bounded = internals.boundedListLabel(['z'.repeat(901), 'a']);
    expect(bounded).toMatch(/^2; selection:[a-f0-9]{64}$/u);
  });

  it('shapes monthly details and aligned research rows defensively', () => {
    expect(internals.monthlyDetails(null)).toBe('');
    expect(internals.monthlyDetails([
      null,
      { year: 2026, month: 8, searchVolume: 12 },
      { year: 2026, month: 9, value: 0 },
      { year: 0, month: 8, value: 2 },
      { year: 2026, month: 0, value: 2 },
      { year: 2026, month: 8, value: 'bad' },
    ])).toBe('2026-08:12, 2026-09:0');
    const row = internals.researchRow('metrics', { keyword: 'alpha' }, ['source']);
    expect(row.values[0]).toBeNull();
    expect(row.values[1]).toBe('alpha');
    expect(row.sourceDateIds).toEqual(['source']);
  });

  it('covers every archived research operation and selection filter', () => {
    const historyBase = {
      id: 'history',
      phrases: ['alpha'],
      locationCode: 2840,
      languageCode: 'en',
      resultCount: 1,
      cached: false,
      createdAt: observedAt,
    };
    const archive = (payload: unknown) => [{ cacheKey: 'key', payload, fetchedAt: observedAt }];

    expect(internals.researchRows({ ...historyBase, kind: 'metrics' }, archive(null), {})).toEqual([]);
    const metrics = internals.researchRows({ ...historyBase, kind: 'metrics' }, archive({
      phrase: 'alpha', searchVolume: 100, difficulty: 25, cpc: '1.50', intent: 'commercial', serpFeatures: ['paa', 2],
    }), {});
    expect(metrics[0]?.values).toContain('paa');
    expect(internals.researchRows({ ...historyBase, kind: 'metrics', phrases: [] }, archive({}), {})).toHaveLength(1);
    expect(internals.researchRows({ ...historyBase, kind: 'overview' }, archive({
      searchVolume: 10, cpcMicros: 2_500_000, monthlySearches: [{ year: 2026, month: 8, value: 9 }],
    }), { keyword: 'other' })).toEqual([]);
    expect(internals.researchRows({ ...historyBase, kind: 'overview' }, archive({
      searchVolume: 10, cpcMicros: 2_500_000, monthlySearches: [{ year: 2026, month: 8, value: 9 }],
    }), {})[0]?.values).toContain('2.5');
    expect(internals.researchRows({ ...historyBase, kind: 'intent' }, archive({ intent: 'informational', confidence: 0.8 }), {})[0]?.values).toContain(0.8);
    expect(internals.researchRows({ ...historyBase, kind: 'trends' }, archive({ monthlySearches: [null, { year: 2026, month: 8, searchVolume: 11 }, { year: 0, month: 0, searchVolume: 'bad' }] }), {})).toHaveLength(3);
    expect(internals.researchRows({ ...historyBase, kind: 'trends' }, archive({ monthlySearches: 'invalid' }), {})).toEqual([]);

    for (const kind of ['related', 'ideas'] as const) {
      const key = kind === 'related' ? 'related' : 'ideas';
      const rows = internals.researchRows({ ...historyBase, kind }, archive({
        [key]: [null, { keyword: 'alpha', searchVolume: 4, cpcMicros: 1_250_000 }, { keyword: 'other', cpc: '2.00' }],
      }), { keyword: 'alpha' });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.values).toContain('1.25');
    }
    const defensiveRelated = internals.researchRows({ ...historyBase, kind: 'related' }, archive({
      related: [{ searchVolume: 1 }],
    }), {});
    expect(defensiveRelated[0]?.values[2]).toBe('');
    expect(defensiveRelated[0]?.values[9]).toBeNull();
    expect(internals.researchRows({ ...historyBase, kind: 'related' }, archive({}), {})).toEqual([]);

    const gaps = internals.researchRows({ ...historyBase, kind: 'gap' }, archive({
      ownDomain: 'own.test', competitorDomain: 'competitor.test', rows: [null, {
        keyword: 'gap phrase', target2Url: 'https://competitor.test/page', class: 'missing', searchVolume: 7,
        target2Position: 3, provenance: { cache: 'cached' },
      }],
    }), { competitor: 'competitor.test' });
    expect(gaps).toHaveLength(1);
    expect(internals.researchRows({ ...historyBase, kind: 'gap' }, archive({ competitorDomain: 'other.test', rows: [] }), { competitor: 'competitor.test' })).toEqual([]);
    const defensiveGap = internals.researchRows({ ...historyBase, kind: 'gap' }, archive({ rows: [{ searchVolume: 1 }] }), {});
    expect(defensiveGap[0]?.values[1]).toBe('');
    expect(defensiveGap[0]?.values[3]).toBe('');
    expect(defensiveGap[0]?.values[4]).toBe('');
    expect(internals.researchRows({ ...historyBase, kind: 'gap' }, archive({ rows: 'invalid' }), {})).toEqual([]);
  });

  it('builds base documents with and without optional blocks', () => {
    const input = {
      kind: 'keyword.research_result' as const,
      stem: 'keywordResearchResult' as const,
      locale: 'en' as const,
      branding,
      subject: [],
      selection: [],
      sourceDates: [],
      rows: [],
      columns: [],
    };
    expect(internals.baseDocument(input).blocks).toHaveLength(1);
    expect(internals.baseDocument({ ...input, blocks: [{ type: 'prose', id: 'note', tone: 'body', text: 'Note' }] }).blocks).toHaveLength(2);
  });
});

describe('stored keyword research adapter', () => {
  it('enforces target ownership, history kind, source version, and operation selection', async () => {
    const [adapter] = createKeywordResearchReportExportAdapters(getTestDb());
    const missing = randomUUID();
    await expect(adapter?.assertAccess(access(missing))).rejects.toMatchObject({ status: 404 });
    const clusters = await insertHistory({ kind: 'clusters' });
    await expect(adapter?.assertAccess(access(clusters))).rejects.toMatchObject({ status: 404 });

    const id = await insertHistory({ kind: 'metrics' });
    await expect(adapter?.assertAccess({ ...access(id), target: { scope: 'site' as const, siteId: 'site-a' } })).rejects.toMatchObject({ status: 404 });
    await expect(adapter?.assertAccess({ ...access(id), target: { scope: 'account_resource' as const, resourceId: id, siteId: 'site-a' } })).rejects.toMatchObject({ status: 404 });
    await expect(adapter?.assertAccess({ ...access(id, 'persist'), sourceVersion: 'changed' })).rejects.toMatchObject({ status: 409 });
    await expect(adapter?.assertAccess(access(id))).resolves.toBeUndefined();
    await expect(adapter?.compose({ ...compose(id), selection: { operation: 'intent' } })).rejects.toMatchObject({ status: 400 });
    await expect(adapter?.compose({ ...compose(id), target: { scope: 'site' as const, siteId: 'site-a' } })).rejects.toMatchObject({ status: 404 });
  });

  it('reads the latest valid archive rows and composes metrics deterministically', async () => {
    const [adapter] = createKeywordResearchReportExportAdapters(getTestDb());
    const id = await insertHistory({ kind: 'metrics', phrases: ['beta', 'alpha'], cached: true });
    await insertKeywordArchive({ operation: 'metrics', phrase: 'alpha', payload: { phrase: 'alpha', searchVolume: 100, difficulty: 20, cpcMicros: 1_500_000, intent: 'commercial', serpFeatures: ['paa'] } });
    await insertKeywordArchive({ operation: 'metrics', phrase: 'alpha', payload: { phrase: 'stale', searchVolume: 1 }, fetchedAt: new Date(observedAt.getTime() - 2_000) });
    await insertKeywordArchive({ operation: 'metrics', phrase: 'beta', payload: { phrase: 'beta', searchVolume: 50, cpc: '2.00', monthlySearches: [{ year: 2026, month: 7, searchVolume: 40 }] } });
    await insertKeywordArchive({ operation: 'metrics', phrase: 'other', payload: { phrase: 'other' }, cacheKey: 'unwanted' });
    await insertKeywordArchive({ operation: 'metrics', phrase: 'alpha', payload: ['invalid'], params: {} });

    const result = await adapter?.compose(compose(id));
    expect(result?.document.completeness).toMatchObject({ selectedItems: 2, representedItems: 2 });
    expect(result?.document.sourceDates).toEqual(expect.arrayContaining([expect.objectContaining({ freshness: 'cached' })]));
    expect(result?.document.blocks[0]).toMatchObject({ type: 'table' });
    expect(result?.sourceVersion).toMatch(/^keyword-research:[a-f0-9]{64}$/u);
  });

  it('validates and deduplicates gap archive provenance', async () => {
    const [adapter] = createKeywordResearchReportExportAdapters(getTestDb());
    const id = await insertHistory({ kind: 'gap', phrases: ['competitor.test'] });
    const values = [
      { payload: null, params: {} },
      { payload: { competitorDomain: '' }, params: {} },
      { payload: { competitorDomain: 'foreign.test' }, params: { locationCode: 2840, languageCode: 'en' } },
      { payload: { competitorDomain: 'competitor.test' }, params: { locationCode: 999, languageCode: 'en' } },
      { payload: { competitorDomain: 'competitor.test' }, params: { locationCode: 2840, languageCode: 'fr' } },
      { payload: { competitorDomain: 'competitor.test', rows: [{ keyword: 'alpha' }] }, params: { locationCode: 2840, languageCode: 'EN' } },
      { payload: { competitorDomain: 'competitor.test', rows: [{ keyword: 'stale' }] }, params: { locationCode: 2840, languageCode: 'EN' } },
    ];
    for (const [index, value] of values.entries()) {
      await insertKeywordArchive({
        operation: 'gap',
        payload: value.payload ?? [],
        params: value.params,
        cacheKey: `gap-input-${index}`,
        fetchedAt: new Date(observedAt.getTime() - index * 1_000 - 1_000),
      });
    }
    const result = await adapter?.compose({ ...compose(id), selection: { competitor: 'competitor.test' } });
    expect(result?.document.completeness.selectedItems).toBe(1);
    await expect(adapter?.compose({ ...compose(id), selection: { competitor: 'other.test' } })).resolves.toMatchObject({ document: { completeness: { selectedItems: 0 } } });
  });

  it('composes an empty archive from history timestamps and renders advertised formats', async () => {
    const [adapter] = createKeywordResearchReportExportAdapters(getTestDb());
    const id = await insertHistory({ kind: 'intent' });
    const result = await adapter?.compose(compose(id));
    expect(result?.document.completeness.selectedItems).toBe(0);
    if (!adapter || !result) throw new Error('research adapter unavailable');
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: observedAt.toISOString() })).resolves.toMatchObject({ format });
    }
    await expect(adapter.render({ document: result.document, format: 'txt', snapshotCreatedAt: observedAt.toISOString() })).rejects.toThrow('report output failed validation');

    await insertKeywordArchive({ operation: 'intent', payload: { phrase: 'alpha', intent: 'informational', confidence: 0.7 } });
    await expect(adapter.compose(compose(id))).resolves.toMatchObject({ document: { completeness: { selectedItems: 1 } } });
  });

  it('validates strict research selections', () => {
    const [adapter] = createKeywordResearchReportExportAdapters(getTestDb());
    expect(adapter?.selectionSchema.safeParse({ operation: 'metrics', keyword: ' alpha ' }).success).toBe(true);
    expect(adapter?.selectionSchema.safeParse({ operation: 'unknown' }).success).toBe(false);
    expect(adapter?.selectionSchema.safeParse({ extra: true }).success).toBe(false);
  });
});

describe('keyword trends report adapter', () => {
  async function seedTrendsArchive(run: ReturnType<typeof trendsRun>, includeValid = true) {
    const stored = serializeStoredRun(run);
    const inputs = stored.inputs as { keywords: string[]; geo: string | null; language: string | null };
    const normalized = normalizeTrendsExploreInputs({ keywords: inputs.keywords, geo: inputs.geo ?? undefined, language: inputs.language ?? undefined });
    const cacheKey = computeVendorCacheKey({ capability: 'keyword', operation: 'trends_live', params: normalized });
    await insertKeywordArchive({ operation: 'trends_live', cacheKey, payload: { series: 'bad', relatedQueries: [] }, fetchedAt: new Date(observedAt.getTime() - 100) });
    if (includeValid) {
      await insertKeywordArchive({
        operation: 'trends_live',
        cacheKey,
        payload: {
          series: [null, { keyword: 'alpha', points: [null, { year: 2026, month: 8, value: 80 }, { year: 0, month: 0, value: 'bad' }] }, { keyword: 'alpha', points: 'invalid' }, { points: [] }, { keyword: 'other', points: [] }],
          relatedQueries: [null, { query: 'rising query', value: 90, kind: 'rising' }, { value: 5, kind: 'rising' }, { query: 'top query', value: 10, kind: 'top' }],
        },
        fetchedAt: new Date(observedAt.getTime() - 200),
      });
    }
  }

  it('enforces scope, owner, site binding, and immutable source version', async () => {
    const [, adapter] = createKeywordResearchReportExportAdapters(getTestDb());
    vi.mocked(findTrendsRun).mockResolvedValue(null);
    await expect(adapter?.assertAccess(access('64f000000000000000000001'))).rejects.toMatchObject({ status: 404 });

    const run = trendsRun({ siteId: 'site-a' });
    vi.mocked(findTrendsRun).mockResolvedValue(run);
    await expect(adapter?.assertAccess({ ...access(String(run._id)), target: { scope: 'site' as const, siteId: 'site-a' } })).rejects.toMatchObject({ status: 404 });
    await expect(adapter?.assertAccess({ ...access(String(run._id)), target: { scope: 'account_resource' as const, resourceId: String(run._id), siteId: 'site-b' } })).rejects.toMatchObject({ status: 404 });
    await expect(adapter?.assertAccess({ ...access(String(run._id), 'persist'), target: { scope: 'account_resource' as const, resourceId: String(run._id), siteId: 'site-a' }, sourceVersion: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(adapter?.assertAccess({ ...access(String(run._id)), target: { scope: 'account_resource' as const, resourceId: String(run._id), siteId: 'site-a' } })).resolves.toBeUndefined();
  });

  it('composes selected series and related queries from the archived source', async () => {
    const [, adapter] = createKeywordResearchReportExportAdapters(getTestDb());
    const run = trendsRun({});
    vi.mocked(findTrendsRun).mockResolvedValue(run);
    await seedTrendsArchive(run);
    const result = await adapter?.compose({ ...compose(String(run._id)), selection: { phrases: ['alpha'], relatedType: 'rising' } });
    expect(result?.document.completeness.selectedItems).toBe(5);
    expect(result?.document.sourceDates[0]).toMatchObject({ freshness: 'cached' });
    await expect(adapter?.compose({ ...compose(String(run._id)), selection: { phrases: ['foreign'] } })).rejects.toMatchObject({ status: 400 });
    await expect(adapter?.compose({ ...compose(String(run._id)), target: { scope: 'site' as const, siteId: 'site-a' }, selection: {} })).rejects.toMatchObject({ status: 404 });
  });

  it('uses stored fallbacks when no valid archive exists and rejects a mismatched site', async () => {
    const [, adapter] = createKeywordResearchReportExportAdapters(getTestDb());
    const run = trendsRun({ siteId: 'site-a', completedAt: null });
    run.set('completedAt', null);
    vi.mocked(findTrendsRun).mockResolvedValue(run);
    await seedTrendsArchive(run, false);
    const result = await adapter?.compose({ ...compose(String(run._id)), selection: {} });
    expect(result?.document.sourceDates[0]).toMatchObject({ freshness: 'unknown' });
    expect(result?.document.blocks.at(-1)).toMatchObject({ type: 'source_note', coverageWarning: expect.any(String) });
    await expect(adapter?.compose({ ...compose(String(run._id)), target: { scope: 'account_resource' as const, resourceId: String(run._id), siteId: 'site-b' }, selection: {} })).rejects.toMatchObject({ status: 404 });

    const worldwideRun = trendsRun({ id: '64f000000000000000000002', geo: null, language: null });
    vi.mocked(findTrendsRun).mockResolvedValue(worldwideRun);
    const worldwide = await adapter?.compose({ ...compose(String(worldwideRun._id)), selection: {} });
    expect(worldwide?.document.selection.map((item) => item.value)).not.toContain(null);
  });

  it('handles a null run directly and validates strict trend selections', async () => {
    expect(await internals.loadTrendsArchive(getTestDb(), null)).toEqual({ payload: null, fetchedAt: null });
    const [, adapter] = createKeywordResearchReportExportAdapters(getTestDb());
    expect(adapter?.selectionSchema.safeParse({ phrases: ['alpha'], relatedType: 'top' }).success).toBe(true);
    expect(adapter?.selectionSchema.safeParse({ phrases: [] }).success).toBe(false);
    expect(adapter?.selectionSchema.safeParse({ relatedType: 'other' }).success).toBe(false);
  });
});

describe('AI keyword cluster report adapter', () => {
  it('enforces owner, scope, and source immutability', async () => {
    const [, , adapter] = createKeywordResearchReportExportAdapters(getTestDb());
    vi.mocked(findClusterRunForAccount).mockResolvedValue(null);
    await expect(adapter?.assertAccess(access('missing-cluster'))).rejects.toMatchObject({ status: 404 });

    const run = clusterRun();
    vi.mocked(findClusterRunForAccount).mockResolvedValue(run);
    await expect(adapter?.assertAccess({ ...access(run.runId), target: { scope: 'site' as const, siteId: 'site-a' } })).rejects.toMatchObject({ status: 404 });
    await expect(adapter?.assertAccess({ ...access(run.runId), target: { scope: 'account_resource' as const, resourceId: run.runId, siteId: 'site-a' } })).rejects.toMatchObject({ status: 404 });
    await expect(adapter?.assertAccess({ ...access(run.runId, 'persist'), sourceVersion: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(adapter?.assertAccess(access(run.runId))).resolves.toBeUndefined();
    await expect(adapter?.compose({ ...compose(run.runId), target: { scope: 'site' as const, siteId: 'site-a' }, selection: { decision: 'all' } })).rejects.toMatchObject({ status: 404 });
  });

  it('composes latest decisions, ordered clusters, and every decision filter', async () => {
    const [, , adapter] = createKeywordResearchReportExportAdapters(getTestDb());
    const run = clusterRun();
    vi.mocked(findClusterRunForAccount).mockResolvedValue(run);
    await getTestDb().insert(keywordClusterDecisionEvents).values([
      { accountId, runId: run.runId, clusterId: 'z-cluster', kind: 'dismissed', idempotencyKey: 'old', note: 'old', createdAt: new Date(observedAt.getTime() - 2_000) },
      { accountId, runId: run.runId, clusterId: 'z-cluster', kind: 'accepted', siteId: 'site-a', idempotencyKey: 'new', note: 'accepted', createdAt: observedAt },
      { accountId, runId: run.runId, clusterId: 'a-cluster', kind: 'dismissed', idempotencyKey: 'dismissed', note: null, createdAt: observedAt },
    ]);

    const all = await adapter?.compose({ ...compose(run.runId), selection: { decision: 'all' } });
    expect(all?.document.completeness.selectedItems).toBe(4);
    expect(all?.document.blocks[0]).toMatchObject({ type: 'table' });
    for (const decision of ['accepted', 'dismissed', 'undecided'] as const) {
      const result = await adapter?.compose({ ...compose(run.runId), selection: { decision } });
      expect(result?.document.completeness.selectedItems).toBeGreaterThan(0);
    }
    expect(await internals.clusterDecisions(getTestDb(), 'foreign', run.runId)).toEqual(new Map());
  });

  it('uses created-at source fallbacks for a run without member observations', async () => {
    const [, , adapter] = createKeywordResearchReportExportAdapters(getTestDb());
    const run = { ...clusterRun(), memberRefs: [], clusters: [] };
    vi.mocked(findClusterRunForAccount).mockResolvedValue(run);
    const result = await adapter?.compose({ ...compose(run.runId), selection: { decision: 'all' } });
    expect(result?.document.sourceDates[0]).toMatchObject({ from: observedAt.toISOString(), to: observedAt.toISOString() });
    expect(adapter?.selectionSchema.parse({})).toEqual({ decision: 'all' });
    expect(adapter?.selectionSchema.safeParse({ decision: 'other' }).success).toBe(false);
  });
});
