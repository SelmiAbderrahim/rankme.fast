import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../app.js';
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
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
} from '../../shared/testing/auth.js';
import {
  setKeywordProvider,
  setKeywordResearchAiRunner,
  setKeywordResearchCompetitorProvider,
  setKeywordResearchDb,
} from './keyword-research.holder.js';
import {
  computeClusterRunId,
  confidenceFor,
  findLatestClusterForPhrase,
  findClusterRunForAccount,
  listClusterRunsForAccount,
  resolvePhrasesToStoredRows,
  runClustering,
  sortedNormalizedPhrases,
} from './keyword-research.clustering.js';
import { KeywordClusterRun } from './keyword-cluster-runs.model.js';
import { setRanksDb } from '../ranks/index.js';
import {
  createFakeCompetitorProvider,
  createFakeKeywordProvider,
} from '../../shared/providers/index.js';
import { createAiProfileRunner } from '../../shared/ai-profiles/index.js';
import {
  type AiGenerationProvider,
  type AiGenerationResult,
  type GenerateStructuredInput,
  AiInvalidInputError,
  AiTimeoutError,
} from '../../shared/providers/ai-generation.js';
import { createFakeAiGenerationProvider } from '../../shared/providers/ai-generation-fake.js';
import { vendorCache } from '../../db/schema/vendor-cache.js';
import { keywordResearchHistory } from '../../db/schema/keyword-research-history.js';
import type { Express } from 'express';
import type { TestUser } from '../../shared/testing/auth.js';

type Runner = ReturnType<typeof createAiProfileRunner>;

function fakeRunnerReturning(clusters: Array<{
  label: string;
  memberIds: string[];
  suggestedRoute: 'brief' | 'seo';
  intentHomogeneity: number;
}>, citations: string[] = []): AiGenerationProvider {
  return {
    async generateStructured<T extends object>(
      input: GenerateStructuredInput<T>,
    ): Promise<AiGenerationResult<T>> {
      const candidate = { clusters, citations } as unknown;
      const parsed = input.validationSchema.safeParse(candidate);
      if (!parsed.success) throw new Error('fake_output_invalid');
      return {
        trust: 'untrusted' as const,
        object: parsed.data as Readonly<T>,
        provider: 'fake' as const,
        model: 'deterministic-schema-fixture',
        finishReason: 'stop',
        tokens: { input: null, output: null, cachedInput: null, reasoning: null },
        latencyMs: 0,
        attempts: [{
          ordinal: 1,
          provider: 'fake' as const,
          model: 'deterministic-schema-fixture',
          status: 'success' as const,
          latencyMs: 0,
          tokens: { input: null, output: null, cachedInput: null, reasoning: null },
          configuredEstimateCostMicros: 0n,
          actualOrEstimatedCostMicros: 5_000n,
          costSource: 'estimated' as const,
          errorCategory: null,
          errorCode: null,
        }],
        configuredEstimateCostMicros: 0n,
        actualCostMicros: null,
        actualOrEstimatedCostMicros: 5_000n,
        warnings: ['usage_estimated' as const],
      };
    },
  };
}

function throwingRunner(err: Error): AiGenerationProvider {
  return {
    async generateStructured() { throw err; },
  };
}

function makeRunner(provider: AiGenerationProvider): Runner {
  return createAiProfileRunner({ provider });
}

let app: Express;
let mongoUri: string;

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function seedCacheRow(phrase: string, opts: {
  operation: 'metrics' | 'overview' | 'related' | 'ideas';
  searchVolume: number;
  intent: string | null;
}) {
  const { computeKeywordCacheKey } = await import('./keyword-research.cache.js');
  const cacheKey = computeKeywordCacheKey({
    phrase,
    locationCode: 2840,
    languageCode: 'en',
  });
  await getTestDb().insert(vendorCache).values({
    capability: 'keyword',
    operation: opts.operation,
    cacheKey,
    params: { phrase, locationCode: 2840, languageCode: 'en' },
    payload: {
      keyword: phrase,
      searchVolume: opts.searchVolume,
      difficulty: 40,
      cpc: 1.5,
      intent: opts.intent,
    },
    fetchedAt: new Date('2026-07-01T00:00:00Z'),
    expiresAt: new Date('2026-08-01T00:00:00Z'),
  });
}

async function seedHistoryRow(accountId: string, phrase: string) {
  await getTestDb().insert(keywordResearchHistory).values({
    accountId,
    kind: 'metrics',
    phrases: [phrase],
    locationCode: 2840,
    languageCode: 'en',
    resultCount: 1,
    cached: false,
  });
}

beforeAll(async () => {
  mongoUri = await startMemoryMongo();
  await mongoose.connect(mongoUri);
  const db = await startTestPostgres();
  app = createApp();
  installTestAuth();
  setKeywordResearchDb(db as unknown as never);
  setRanksDb(db as unknown as never);
  setKeywordProvider(createFakeKeywordProvider());
  setKeywordResearchCompetitorProvider(createFakeCompetitorProvider());
  setKeywordResearchAiRunner(makeRunner(createFakeAiGenerationProvider()), ['fake']);
}, 120_000);

afterAll(async () => {
  uninstallTestAuth();
  setKeywordResearchDb(null);
  setRanksDb(null);
  setKeywordProvider(null);
  setKeywordResearchCompetitorProvider(null);
  setKeywordResearchAiRunner(null, ['fake']);
  await mongoose.disconnect();
  await stopMemoryMongo();
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
  await clearCollections();
  setKeywordResearchAiRunner(makeRunner(createFakeAiGenerationProvider()), ['fake']);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

describe('sortedNormalizedPhrases', () => {
  it('lowercases, trims, collapses whitespace, dedupes, sorts', () => {
    expect(sortedNormalizedPhrases([
      'SEO Tools',
      '  seo   tools ',
      'best keyword tracker',
      '',
      'BEST keyword TRACKER',
    ])).toEqual(['best keyword tracker', 'seo tools']);
  });

  it('drops entries that normalize to empty', () => {
    expect(sortedNormalizedPhrases(['  ', '', ' hello '])).toEqual(['hello']);
  });
});

describe('computeClusterRunId', () => {
  it('is deterministic for the same input', () => {
    const a = computeClusterRunId({
      accountId: 'acct-1', locationCode: 2840, languageCode: 'en',
      phrases: ['seo tools', 'keyword tracker'],
    });
    const b = computeClusterRunId({
      accountId: 'acct-1', locationCode: 2840, languageCode: 'en',
      phrases: ['KEYWORD TRACKER', 'seo tools'],
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('differs for different accounts, markets, phrases', () => {
    const base = { accountId: 'a', locationCode: 2840, languageCode: 'en', phrases: ['x'] };
    const other = computeClusterRunId({ ...base, accountId: 'b' });
    const market = computeClusterRunId({ ...base, locationCode: 2826 });
    const lang = computeClusterRunId({ ...base, languageCode: 'fr' });
    const phrase = computeClusterRunId({ ...base, phrases: ['y'] });
    expect(new Set([computeClusterRunId(base), other, market, lang, phrase]).size).toBe(5);
  });
});

describe('confidenceFor', () => {
  it('maps per spec 13 §6.3 rule table', () => {
    expect(confidenceFor(10, 0.9)).toBe('high');
    expect(confidenceFor(10, 0.5)).toBe('medium');
    expect(confidenceFor(5, 0.9)).toBe('medium');
    expect(confidenceFor(5, 0.5)).toBe('low');
    expect(confidenceFor(2, 0.99)).toBe('low');
    expect(confidenceFor(8, 0.8)).toBe('high');
  });

  it('clamps intent_homogeneity out of range', () => {
    expect(confidenceFor(10, 1.5)).toBe('high');
    expect(confidenceFor(10, -0.1)).toBe('medium');
  });
});

describe('findLatestClusterForPhrase', () => {
  it('returns before querying when the phrase normalizes to empty', async () => {
    const findOne = vi.spyOn(KeywordClusterRun, 'findOne');

    await expect(
      findLatestClusterForPhrase(
        'acct-1',
        { locationCode: 2840, languageCode: 'en' },
        '   ',
      ),
    ).resolves.toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('returns null when no stored run matches the account and market', async () => {
    vi.spyOn(KeywordClusterRun, 'findOne').mockReturnValue({
      sort: () => ({ lean: () => ({ exec: async () => null }) }),
    } as never);

    await expect(
      findLatestClusterForPhrase(
        'acct-1',
        { locationCode: 2840, languageCode: 'en' },
        'missing phrase',
      ),
    ).resolves.toBeNull();
  });

  it('returns null when a legacy matched document has no normalized member match', async () => {
    vi.spyOn(KeywordClusterRun, 'findOne').mockReturnValue({
      sort: () => ({
        lean: () => ({
          exec: async () => ({
            clusters: [{ memberKeywords: ['different phrase'] }],
          }),
        }),
      }),
    } as never);

    await expect(
      findLatestClusterForPhrase(
        'acct-1',
        { locationCode: 2840, languageCode: 'EN' },
        'target phrase',
      ),
    ).resolves.toBeNull();
  });

  it('returns a defensive copy of the matching stored cluster', async () => {
    const stored = {
      clusterId: 'cluster-1',
      label: 'Target',
      memberKeywords: ['target phrase', 'supporting phrase'],
      suggestedRoute: 'brief' as const,
      confidence: 'high' as const,
      summedSearchVolume: 420,
    };
    vi.spyOn(KeywordClusterRun, 'findOne').mockReturnValue({
      sort: () => ({
        lean: () => ({ exec: async () => ({ clusters: [stored] }) }),
      }),
    } as never);

    const result = await findLatestClusterForPhrase(
      'acct-1',
      { locationCode: 2840, languageCode: 'EN' },
      ' Target Phrase ',
    );

    expect(result).toEqual(stored);
    expect(result?.memberKeywords).not.toBe(stored.memberKeywords);
  });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

describe('resolvePhrasesToStoredRows', () => {
  it('resolves phrases hitting vendor_cache', async () => {
    await seedCacheRow('seo tools', { operation: 'metrics', searchVolume: 1000, intent: 'commercial' });
    const now = new Date('2026-07-15T00:00:00Z');
    const { resolved, unresolved } = await resolvePhrasesToStoredRows(
      getTestDb() as never,
      { accountId: 'acct', locationCode: 2840, languageCode: 'en', phrases: ['seo tools'] },
      now,
    );
    expect(unresolved).toEqual([]);
    expect(resolved.get('seo tools')?.source).toBe('vendor_cache');
    expect(resolved.get('seo tools')?.searchVolume).toBe(1000);
    expect(resolved.get('seo tools')?.intent).toBe('commercial');
  });

  it('falls back to keyword_research_history when cache misses', async () => {
    await seedHistoryRow('acct', 'niche phrase');
    const { resolved, unresolved } = await resolvePhrasesToStoredRows(
      getTestDb() as never,
      { accountId: 'acct', locationCode: 2840, languageCode: 'en', phrases: ['niche phrase'] },
      new Date(),
    );
    expect(unresolved).toEqual([]);
    expect(resolved.get('niche phrase')?.source).toBe('history');
    expect(resolved.get('niche phrase')?.searchVolume).toBeNull();
    expect(resolved.get('niche phrase')?.intent).toBeNull();
  });

  it('reports unresolved phrases when neither store contains them', async () => {
    const { resolved, unresolved } = await resolvePhrasesToStoredRows(
      getTestDb() as never,
      { accountId: 'acct', locationCode: 2840, languageCode: 'en', phrases: ['unknown one', 'unknown two'] },
      new Date(),
    );
    expect(resolved.size).toBe(0);
    expect(unresolved).toEqual(['unknown one', 'unknown two']);
  });

  it('empty input returns empty maps', async () => {
    const result = await resolvePhrasesToStoredRows(
      getTestDb() as never,
      { accountId: 'acct', locationCode: 2840, languageCode: 'en', phrases: [] },
      new Date(),
    );
    expect(result.resolved.size).toBe(0);
    expect(result.unresolved).toEqual([]);
  });

  it('keeps the first non-expired row when a later row is older or expired', async () => {
    const { computeKeywordCacheKey } = await import('./keyword-research.cache.js');
    const cacheKey = computeKeywordCacheKey({
      phrase: 'reverse row', locationCode: 2840, languageCode: 'en',
    });
    // Fresh (newer fetchedAt) inserted first.
    await getTestDb().insert(vendorCache).values({
      capability: 'keyword', operation: 'metrics', cacheKey,
      params: {}, payload: { searchVolume: 900, intent: 'commercial' },
      fetchedAt: new Date('2026-07-10T00:00:00Z'),
      expiresAt: new Date('2026-08-01T00:00:00Z'),
    });
    // Older but also non-expired — should NOT replace the newer one.
    await getTestDb().insert(vendorCache).values({
      capability: 'keyword', operation: 'related', cacheKey,
      params: {}, payload: { searchVolume: 100, intent: 'informational' },
      fetchedAt: new Date('2026-07-01T00:00:00Z'),
      expiresAt: new Date('2026-08-01T00:00:00Z'),
    });
    // Expired — also should NOT replace.
    await getTestDb().insert(vendorCache).values({
      capability: 'keyword', operation: 'ideas', cacheKey,
      params: {}, payload: { searchVolume: 500, intent: 'commercial' },
      fetchedAt: new Date('2026-07-15T00:00:00Z'),
      expiresAt: new Date('2026-07-16T00:00:00Z'),
    });
    const now = new Date('2026-07-20T00:00:00Z');
    const { resolved } = await resolvePhrasesToStoredRows(
      getTestDb() as never,
      { accountId: 'acct', locationCode: 2840, languageCode: 'en', phrases: ['reverse row'] },
      now,
    );
    expect(resolved.get('reverse row')?.searchVolume).toBe(900);
  });

  it('handles a cache row with missing searchVolume field', async () => {
    const { computeKeywordCacheKey } = await import('./keyword-research.cache.js');
    const cacheKey = computeKeywordCacheKey({
      phrase: 'no vol', locationCode: 2840, languageCode: 'en',
    });
    await getTestDb().insert(vendorCache).values({
      capability: 'keyword', operation: 'ideas', cacheKey,
      params: {}, payload: { intent: 'commercial' }, // no searchVolume
      fetchedAt: new Date('2026-07-01T00:00:00Z'),
      expiresAt: new Date('2026-08-01T00:00:00Z'),
    });
    const { resolved } = await resolvePhrasesToStoredRows(
      getTestDb() as never,
      { accountId: 'acct', locationCode: 2840, languageCode: 'en', phrases: ['no vol'] },
      new Date('2026-07-15T00:00:00Z'),
    );
    expect(resolved.get('no vol')?.searchVolume).toBeNull();
  });

  it('picks the most recent row when both are non-expired', async () => {
    const { computeKeywordCacheKey } = await import('./keyword-research.cache.js');
    const cacheKey = computeKeywordCacheKey({
      phrase: 'multi row', locationCode: 2840, languageCode: 'en',
    });
    await getTestDb().insert(vendorCache).values({
      capability: 'keyword', operation: 'overview', cacheKey,
      params: {}, payload: { searchVolume: 100, intent: 'informational' },
      fetchedAt: new Date('2026-07-01T00:00:00Z'),
      expiresAt: new Date('2026-08-01T00:00:00Z'),
    });
    await getTestDb().insert(vendorCache).values({
      capability: 'keyword', operation: 'related', cacheKey,
      params: {}, payload: { searchVolume: 900, intent: 'commercial' },
      fetchedAt: new Date('2026-07-10T00:00:00Z'),
      expiresAt: new Date('2026-08-01T00:00:00Z'),
    });
    const now = new Date('2026-07-15T00:00:00Z');
    const { resolved } = await resolvePhrasesToStoredRows(
      getTestDb() as never,
      { accountId: 'acct', locationCode: 2840, languageCode: 'en', phrases: ['multi row'] },
      now,
    );
    expect(resolved.get('multi row')?.searchVolume).toBe(900);
  });

  it('history resolution honors the most recent createdAt across duplicate history rows', async () => {
    const accountId = 'multi-hist';
    // Two history rows for the same phrase; newest wins.
    await getTestDb().insert(keywordResearchHistory).values({
      accountId, kind: 'metrics', phrases: ['old phrase'],
      locationCode: 2840, languageCode: 'en', resultCount: 1, cached: false,
      createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    await getTestDb().insert(keywordResearchHistory).values({
      accountId, kind: 'metrics', phrases: ['old phrase', ''],
      locationCode: 2840, languageCode: 'en', resultCount: 1, cached: false,
      createdAt: new Date('2026-06-01T00:00:00Z'),
    });
    const { resolved } = await resolvePhrasesToStoredRows(
      getTestDb() as never,
      { accountId, locationCode: 2840, languageCode: 'en', phrases: ['old phrase'] },
      new Date('2026-07-15T00:00:00Z'),
    );
    expect(resolved.get('old phrase')?.observedAt.toISOString()).toBe(
      new Date('2026-06-01T00:00:00Z').toISOString(),
    );
  });

  it('history rows ignore phrases not in the missing set', async () => {
    const accountId = 'noise-hist';
    await getTestDb().insert(keywordResearchHistory).values({
      accountId, kind: 'metrics', phrases: ['unrelated'],
      locationCode: 2840, languageCode: 'en', resultCount: 1, cached: false,
    });
    await seedHistoryRow(accountId, 'wanted');
    const { resolved } = await resolvePhrasesToStoredRows(
      getTestDb() as never,
      { accountId, locationCode: 2840, languageCode: 'en', phrases: ['wanted'] },
      new Date(),
    );
    expect(resolved.get('wanted')?.source).toBe('history');
    expect(resolved.has('unrelated')).toBe(false);
  });

  it('drops unknown intent values to null', async () => {
    await seedCacheRow('rare phrase', { operation: 'metrics', searchVolume: 200, intent: 'gibberish' });
    const { resolved } = await resolvePhrasesToStoredRows(
      getTestDb() as never,
      { accountId: 'acct', locationCode: 2840, languageCode: 'en', phrases: ['rare phrase'] },
      new Date('2026-07-15T00:00:00Z'),
    );
    expect(resolved.get('rare phrase')?.intent).toBeNull();
  });

  it('prefers non-expired vendor_cache rows over expired ones', async () => {
    const { computeKeywordCacheKey } = await import('./keyword-research.cache.js');
    const cacheKey = computeKeywordCacheKey({
      phrase: 'seo tools',
      locationCode: 2840,
      languageCode: 'en',
    });
    // Expired row with high signal.
    await getTestDb().insert(vendorCache).values({
      capability: 'keyword', operation: 'overview', cacheKey,
      params: {}, payload: { searchVolume: 500, intent: 'informational' },
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2026-01-10T00:00:00Z'),
    });
    // Fresh row (non-expired).
    await getTestDb().insert(vendorCache).values({
      capability: 'keyword', operation: 'related', cacheKey,
      params: {}, payload: { searchVolume: 900, intent: 'commercial' },
      fetchedAt: new Date('2026-07-01T00:00:00Z'),
      expiresAt: new Date('2026-08-01T00:00:00Z'),
    });
    const now = new Date('2026-07-15T00:00:00Z');
    const { resolved } = await resolvePhrasesToStoredRows(
      getTestDb() as never,
      { accountId: 'acct', locationCode: 2840, languageCode: 'en', phrases: ['seo tools'] },
      now,
    );
    expect(resolved.get('seo tools')?.searchVolume).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// runClustering pipeline
// ---------------------------------------------------------------------------

describe('runClustering', () => {
  const market = { locationCode: 2840, languageCode: 'en' };

  async function seedTenPhrases(accountId = 'acct') {
    const phrases = ['alpha', 'beta', 'gamma', 'delta', 'epsilon',
                     'zeta', 'eta', 'theta', 'iota', 'kappa'];
    for (const p of phrases) {
      await seedCacheRow(p, { operation: 'metrics', searchVolume: 100, intent: 'commercial' });
    }
    return { accountId, phrases };
  }

  it('runs one AI pass and persists an immutable run', async () => {
    const { accountId, phrases } = await seedTenPhrases();
    const { getInputIds } = await captureAiInputIds();
    const ids = await getInputIds(accountId, phrases);
    setKeywordResearchAiRunner(makeRunner(fakeRunnerReturning([
      { label: 'Group A', memberIds: ids.slice(0, 5), suggestedRoute: 'brief', intentHomogeneity: 1 },
      { label: 'Group B', memberIds: ids.slice(5), suggestedRoute: 'seo', intentHomogeneity: 0.5 },
    ])), ['fake']);
    const run = await runClustering(
      { accountId, ...market, phrases, locale: 'en' },
      { db: getTestDb() as never, aiRunner: makeRunner(fakeRunnerReturning([
          { label: 'Group A', memberIds: ids.slice(0, 5), suggestedRoute: 'brief', intentHomogeneity: 1 },
          { label: 'Group B', memberIds: ids.slice(5), suggestedRoute: 'seo', intentHomogeneity: 0.5 },
        ])), providerOrder: ['fake'] },
    );
    expect(run.clusters.length).toBe(2);
    expect(run.clusters[0]?.label).toBe('Group A');
    expect(run.clusters[0]?.confidence).toBe('medium');
    expect(run.memberRefs.length).toBe(phrases.length);
    expect(run.cached).toBe(false);
    expect(run.costMicros).toBeGreaterThan(0);

    // Loading via findClusterRunForAccount returns cached=true.
    const found = await findClusterRunForAccount(accountId, run.runId);
    expect(found?.cached).toBe(true);
    expect(found?.clusters.length).toBe(2);
  });

  it('orders clusters by summed volume desc then label asc', async () => {
    const accountId = 'ordering-acct';
    const phrases = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta',
                     'eta', 'theta', 'iota', 'kappa'];
    for (const [i, p] of phrases.entries()) {
      await seedCacheRow(p, {
        operation: 'metrics',
        searchVolume: i < 5 ? 100 : 1000,
        intent: 'commercial',
      });
    }
    const { getInputIds } = await captureAiInputIds();
    const ids = await getInputIds(accountId, phrases);
    const runner = makeRunner(fakeRunnerReturning([
      { label: 'Zulu', memberIds: ids.slice(5, 10), suggestedRoute: 'seo', intentHomogeneity: 1 },
      { label: 'Alpha', memberIds: ids.slice(0, 5), suggestedRoute: 'brief', intentHomogeneity: 1 },
    ]));
    const run = await runClustering(
      { accountId, ...market, phrases, locale: 'en' },
      { db: getTestDb() as never, aiRunner: runner, providerOrder: ['fake'] },
    );
    expect(run.clusters.map((c) => c.label)).toEqual(['Zulu', 'Alpha']);
  });

  it('sorts equal-volume clusters by label ascending', async () => {
    const accountId = 'ordering-acct-2';
    const phrases = ['alpha', 'beta', 'gamma', 'delta', 'epsilon',
                     'zeta', 'eta', 'theta', 'iota', 'kappa'];
    for (const p of phrases) {
      await seedCacheRow(p, { operation: 'metrics', searchVolume: 100, intent: 'commercial' });
    }
    const { getInputIds } = await captureAiInputIds();
    const ids = await getInputIds(accountId, phrases);
    const runner = makeRunner(fakeRunnerReturning([
      { label: 'Charlie', memberIds: [ids[0]!], suggestedRoute: 'brief', intentHomogeneity: 1 },
      { label: 'Alpha', memberIds: [ids[1]!], suggestedRoute: 'seo', intentHomogeneity: 1 },
      { label: 'Bravo', memberIds: [ids[2]!], suggestedRoute: 'brief', intentHomogeneity: 1 },
    ]));
    const run = await runClustering(
      { accountId, ...market, phrases, locale: 'en' },
      { db: getTestDb() as never, aiRunner: runner, providerOrder: ['fake'] },
    );
    expect(run.clusters.map((c) => c.label)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('strips cluster members that do not cite a resolved id and drops empty clusters', async () => {
    const { accountId, phrases } = await seedTenPhrases('strip-acct');
    const { getInputIds } = await captureAiInputIds();
    const ids = await getInputIds(accountId, phrases);
    const runner = makeRunner(fakeRunnerReturning([
      { label: 'Real', memberIds: [ids[0]!, 'kw-fake-1234567890abcdef1234567890'], suggestedRoute: 'brief', intentHomogeneity: 1 },
      { label: 'Ghost', memberIds: ['kw-fake-1234567890abcdef1234567890'], suggestedRoute: 'seo', intentHomogeneity: 1 },
    ]));
    const run = await runClustering(
      { accountId, ...market, phrases, locale: 'en' },
      { db: getTestDb() as never, aiRunner: runner, providerOrder: ['fake'] },
    );
    expect(run.clusters.length).toBe(1);
    expect(run.clusters[0]?.label).toBe('Real');
    expect(run.clusters[0]?.memberKeywords.length).toBe(1);
  });

  it('evidence-only outcome persists with zero clusters', async () => {
    const { accountId, phrases } = await seedTenPhrases('empty-acct');
    const runner = makeRunner(fakeRunnerReturning([
      { label: 'Only Fake', memberIds: ['kw-fake-1234567890abcdef1234567890'], suggestedRoute: 'brief', intentHomogeneity: 1 },
    ]));
    const run = await runClustering(
      { accountId, ...market, phrases, locale: 'en' },
      { db: getTestDb() as never, aiRunner: runner, providerOrder: ['fake'] },
    );
    expect(run.clusters).toEqual([]);
    expect(run.memberRefs.length).toBe(phrases.length);
    const found = await findClusterRunForAccount(accountId, run.runId);
    expect(found?.clusters).toEqual([]);
  });

  it('drops empty-label and duplicate-label clusters', async () => {
    const { accountId, phrases } = await seedTenPhrases('label-acct');
    const { getInputIds } = await captureAiInputIds();
    const ids = await getInputIds(accountId, phrases);
    const runner = makeRunner(fakeRunnerReturning([
      { label: '   ', memberIds: [ids[0]!], suggestedRoute: 'brief', intentHomogeneity: 1 },
      { label: 'Solo', memberIds: [ids[1]!], suggestedRoute: 'brief', intentHomogeneity: 1 },
      { label: 'Solo', memberIds: [ids[2]!], suggestedRoute: 'seo', intentHomogeneity: 0.5 },
    ]));
    const run = await runClustering(
      { accountId, ...market, phrases, locale: 'en' },
      { db: getTestDb() as never, aiRunner: runner, providerOrder: ['fake'] },
    );
    expect(run.clusters.map((c) => c.label)).toEqual(['Solo']);
  });

  it('422 on empty-after-normalize phrases', async () => {
    const runner = makeRunner(createFakeAiGenerationProvider());
    await expect(
      runClustering(
        { accountId: 'x', ...market, phrases: [], locale: 'en' },
        { db: getTestDb() as never, aiRunner: runner, providerOrder: ['fake'] },
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('422 on unresolved phrases', async () => {
    const runner = makeRunner(createFakeAiGenerationProvider());
    await expect(
      runClustering(
        { accountId: 'x', ...market, phrases: ['nowhere phrase'], locale: 'en' },
        { db: getTestDb() as never, aiRunner: runner, providerOrder: ['fake'] },
      ),
    ).rejects.toMatchObject({
      status: 422,
      message: 'keywordResearch.errors.unresolvedPhrases',
    });
  });

  it('wraps upstream AI errors as localized 503', async () => {
    const { accountId, phrases } = await seedTenPhrases('err-acct');
    const runner = makeRunner(throwingRunner(new AiTimeoutError('provider_timeout')));
    await expect(
      runClustering(
        { accountId, ...market, phrases, locale: 'en' },
        { db: getTestDb() as never, aiRunner: runner, providerOrder: ['fake'] },
      ),
    ).rejects.toMatchObject({
      status: 503,
      message: 'keywordResearch.errors.upstreamUnavailable',
    });
  });

  it('wraps AI invalid-input as localized 422', async () => {
    const { accountId, phrases } = await seedTenPhrases('inv-acct');
    const runner = makeRunner(throwingRunner(new AiInvalidInputError('invalid_generation_input')));
    await expect(
      runClustering(
        { accountId, ...market, phrases, locale: 'en' },
        { db: getTestDb() as never, aiRunner: runner, providerOrder: ['fake'] },
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('re-throws when persistence fails and no stored run exists', async () => {
    const { accountId, phrases } = await seedTenPhrases('reraise-acct');
    const { getInputIds } = await captureAiInputIds();
    const ids = await getInputIds(accountId, phrases);
    const runner = makeRunner(fakeRunnerReturning([
      { label: 'Fresh', memberIds: [ids[0]!], suggestedRoute: 'brief', intentHomogeneity: 1 },
    ]));
    const spy = vi.spyOn(KeywordClusterRun, 'create').mockRejectedValueOnce(new Error('boom') as never);
    await expect(runClustering(
      { accountId, ...market, phrases, locale: 'en' },
      { db: getTestDb() as never, aiRunner: runner, providerOrder: ['fake'] },
    )).rejects.toThrow('boom');
    spy.mockRestore();
  });

  it('includes history-sourced members with null searchVolume in cluster sums', async () => {
    const accountId = 'mixed-src';
    // 8 vendor cache rows + 2 history-only phrases (14 phrases total to
    // exceed the 10 minimum? No — service accepts fewer. Actually spec
    // requires ≥10 at the ROUTER; the service function itself does not
    // enforce the min. So this test can use ≤10 phrases directly.)
    const cachePhrases = ['a1', 'a2', 'a3', 'a4', 'a5'];
    for (const p of cachePhrases) {
      await seedCacheRow(p, { operation: 'metrics', searchVolume: 100, intent: 'commercial' });
    }
    const historyPhrases = ['h1', 'h2'];
    for (const p of historyPhrases) {
      await seedHistoryRow(accountId, p);
    }
    const all = [...cachePhrases, ...historyPhrases];
    const { getInputIds } = await captureAiInputIds();
    const ids = await getInputIds(accountId, all);
    const runner = makeRunner(fakeRunnerReturning([
      { label: 'Mixed', memberIds: ids, suggestedRoute: 'brief', intentHomogeneity: 1 },
    ]));
    const run = await runClustering(
      { accountId, ...market, phrases: all, locale: 'en' },
      { db: getTestDb() as never, aiRunner: runner, providerOrder: ['fake'] },
    );
    // 5 cache members × 100 = 500 (history contributes 0 — searchVolume null branch).
    expect(run.clusters[0]?.summedSearchVolume).toBe(500);
    expect(run.clusters[0]?.memberKeywords.length).toBe(7);
  });

  it('accepts a caller-supplied correlationId', async () => {
    const { accountId, phrases } = await seedTenPhrases('corr-acct');
    const { getInputIds } = await captureAiInputIds();
    const ids = await getInputIds(accountId, phrases);
    const runner = makeRunner(fakeRunnerReturning([
      { label: 'C', memberIds: [ids[0]!], suggestedRoute: 'brief', intentHomogeneity: 1 },
    ]));
    const run = await runClustering(
      { accountId, ...market, phrases, locale: 'en', correlationId: 'corr-abc' },
      { db: getTestDb() as never, aiRunner: runner, providerOrder: ['fake'] },
    );
    expect(run.runId).toMatch(/^[a-f0-9]{64}$/);
  });

  it('collapses duplicate run insert (race) to the stored run', async () => {
    const { accountId, phrases } = await seedTenPhrases('race-acct');
    const { getInputIds } = await captureAiInputIds();
    const ids = await getInputIds(accountId, phrases);
    // Pre-insert the run so create() throws E11000.
    const runId = computeClusterRunId({ accountId, ...market, phrases });
    await KeywordClusterRun.create({
      runId, accountId, market: { locationCode: market.locationCode, languageCode: market.languageCode },
      memberRefs: [], clusters: [], aiProfile: { name: 'keyword_clustering', version: '1.0.0' },
      costMicros: 42, createdAt: new Date('2026-07-10T00:00:00Z'),
    });
    const runner = makeRunner(fakeRunnerReturning([
      { label: 'Fresh', memberIds: [ids[0]!], suggestedRoute: 'brief', intentHomogeneity: 1 },
    ]));
    const run = await runClustering(
      { accountId, ...market, phrases, locale: 'en' },
      { db: getTestDb() as never, aiRunner: runner, providerOrder: ['fake'] },
    );
    // Stored run wins; cost matches pre-inserted row.
    expect(run.costMicros).toBe(42);
    expect(run.clusters).toEqual([]);
    expect(run.cached).toBe(true);
  });
});

// Helper: run an AI pass through the fake provider once and capture the ids
// the clustering service assigns to each phrase (sha256-based) so tests can
// return them in the fake output.
async function captureAiInputIds() {
  return {
    async getInputIds(accountId: string, phrases: string[]): Promise<string[]> {
      const { createHash } = await import('node:crypto');
      const { sortedNormalizedPhrases: normalize } = await import('./keyword-research.clustering.js');
      const sorted = normalize(phrases);
      return sorted.map((p) => `kw-${createHash('sha256').update(p).digest('hex').slice(0, 24)}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Mongo model immutability
// ---------------------------------------------------------------------------

describe('KeywordClusterRun model', () => {
  it('refuses a mutating save on an already-persisted document', async () => {
    const doc = await KeywordClusterRun.create({
      runId: 'run-immut',
      accountId: 'acct',
      market: { locationCode: 2840, languageCode: 'en' },
      memberRefs: [],
      clusters: [],
      aiProfile: { name: 'keyword_clustering', version: '1.0.0' },
      costMicros: 0,
    });
    doc.costMicros = 999;
    await expect(doc.save()).rejects.toThrow('keyword_cluster_run:immutable');
  });

  it('a load-and-save-without-modify is permitted', async () => {
    await KeywordClusterRun.create({
      runId: 'run-load',
      accountId: 'acct',
      market: { locationCode: 2840, languageCode: 'en' },
      memberRefs: [],
      clusters: [],
      aiProfile: { name: 'keyword_clustering', version: '1.0.0' },
      costMicros: 0,
    });
    const loaded = await KeywordClusterRun.findOne({ runId: 'run-load' });
    expect(loaded).not.toBeNull();
    await expect(loaded!.save()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// listClusterRunsForAccount
// ---------------------------------------------------------------------------

describe('listClusterRunsForAccount', () => {
  it('returns newest-first, respects limit and pagination cursor', async () => {
    const accountId = 'list-acct';
    for (let i = 0; i < 5; i += 1) {
      await KeywordClusterRun.create({
        runId: `run-${i}`,
        accountId,
        market: { locationCode: 2840, languageCode: 'en' },
        memberRefs: [], clusters: [],
        aiProfile: { name: 'keyword_clustering', version: '1.0.0' },
        costMicros: i,
        createdAt: new Date(2026, 6, i + 1),
      });
    }
    const first = await listClusterRunsForAccount(accountId, { limit: 2 });
    expect(first.runs.map((r) => r.runId)).toEqual(['run-4', 'run-3']);
    expect(first.nextCursor).not.toBeNull();
    const page2 = await listClusterRunsForAccount(accountId, {
      limit: 2,
      cursor: {
        createdAt: first.runs[first.runs.length - 1]!.createdAt,
        id: (await KeywordClusterRun.findOne({ runId: 'run-3' }).lean())!._id.toString(),
      },
    });
    expect(page2.runs.map((r) => r.runId)).toEqual(['run-2', 'run-1']);
  });

  it('scopes strictly to the calling account (cross-account isolation)', async () => {
    await KeywordClusterRun.create({
      runId: 'other-acct-run', accountId: 'other',
      market: { locationCode: 2840, languageCode: 'en' },
      memberRefs: [], clusters: [], aiProfile: { name: 'keyword_clustering', version: '1.0.0' },
      costMicros: 0,
    });
    const own = await listClusterRunsForAccount('me', { limit: 10 });
    expect(own.runs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// HTTP routes: POST /clusters, GET /clusters, GET /clusters/:runId
// ---------------------------------------------------------------------------

describe('HTTP /api/keyword-research/clusters', () => {
  it('POST rejects unauthenticated calls with 401', async () => {
    const res = await request(app)
      .post('/api/keyword-research/clusters')
      .send({ locationCode: 2840, languageCode: 'en', phrases: Array(10).fill('x') });
    expect(res.status).toBe(401);
  });

  it('POST 422 when phrases cannot be resolved', async () => {
    const user = await seedUser('cluster-422@example.com');
    const phrases = Array.from({ length: 10 }, (_, i) => `nope-${i}`);
    const res = await request(app)
      .post('/api/keyword-research/clusters')
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en', phrases });
    expect(res.status).toBe(422);
    expect(res.body.error.details.unresolvedPhrases).toBeDefined();
  });

  it('POST happy path persists a run + identical rerun is a free cache read', async () => {
    const user = await seedUser('cluster-happy@example.com');
    const phrases = ['alpha', 'beta', 'gamma', 'delta', 'epsilon',
                     'zeta', 'eta', 'theta', 'iota', 'kappa'];
    for (const p of phrases) {
      await seedCacheRow(p, { operation: 'metrics', searchVolume: 500, intent: 'commercial' });
    }
    const { createHash } = await import('node:crypto');
    const sorted = [...phrases].sort();
    const ids = sorted.map((p) => `kw-${createHash('sha256').update(p).digest('hex').slice(0, 24)}`);
    setKeywordResearchAiRunner(
      makeRunner(fakeRunnerReturning([
        { label: 'Group', memberIds: ids, suggestedRoute: 'brief', intentHomogeneity: 1 },
      ])),
      ['fake'],
    );

    const first = await request(app)
      .post('/api/keyword-research/clusters')
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en', phrases });
    expect(first.status).toBe(200);
    expect(first.body.runId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.body.clusters.length).toBe(1);
    expect(first.body.cached).toBe(false);

    // Second identical request → stored read (cached=true), no AI call.
    const second = await request(app)
      .post('/api/keyword-research/clusters')
      .set('Cookie', user.cookie)
      .send({ locationCode: 2840, languageCode: 'en', phrases });
    expect(second.status).toBe(200);
    expect(second.body.runId).toBe(first.body.runId);
    expect(second.body.cached).toBe(true);
  });

  it('GET /clusters cross-account isolation returns only own runs', async () => {
    const a = await seedUser('cluster-list-a@example.com');
    const b = await seedUser('cluster-list-b@example.com');
    await KeywordClusterRun.create({
      runId: 'own-run', accountId: a.id,
      market: { locationCode: 2840, languageCode: 'en' },
      memberRefs: [], clusters: [], aiProfile: { name: 'keyword_clustering', version: '1.0.0' },
      costMicros: 0,
    });
    await KeywordClusterRun.create({
      runId: 'foreign-run', accountId: b.id,
      market: { locationCode: 2840, languageCode: 'en' },
      memberRefs: [], clusters: [], aiProfile: { name: 'keyword_clustering', version: '1.0.0' },
      costMicros: 0,
    });
    const res = await request(app)
      .get('/api/keyword-research/clusters')
      .set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    expect(res.body.runs.map((r: { runId: string }) => r.runId)).toEqual(['own-run']);
    expect(res.body.nextCursor).toBeNull();
  });

  it('GET /clusters malformed cursor 400', async () => {
    const user = await seedUser('cluster-cursor@example.com');
    const res = await request(app)
      .get('/api/keyword-research/clusters?cursor=not-valid-base64!')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });

  it('GET /clusters cursor with bad inner shape 400', async () => {
    const user = await seedUser('cluster-cursor-shape@example.com');
    const bad = Buffer.from(JSON.stringify({ createdAt: 'not-a-date', id: 'zz' }), 'utf8').toString('base64url');
    const res = await request(app)
      .get(`/api/keyword-research/clusters?cursor=${encodeURIComponent(bad)}`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });

  it('GET /clusters honors a valid encoded cursor', async () => {
    const user = await seedUser('cluster-cursor-2@example.com');
    for (let i = 0; i < 3; i += 1) {
      await KeywordClusterRun.create({
        runId: `page-run-${i}`, accountId: user.id,
        market: { locationCode: 2840, languageCode: 'en' },
        memberRefs: [], clusters: [], aiProfile: { name: 'keyword_clustering', version: '1.0.0' },
        costMicros: 0,
        createdAt: new Date(2026, 6, i + 1),
      });
    }
    const first = await request(app)
      .get('/api/keyword-research/clusters?limit=1')
      .set('Cookie', user.cookie);
    expect(first.status).toBe(200);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await request(app)
      .get(`/api/keyword-research/clusters?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .set('Cookie', user.cookie);
    expect(second.status).toBe(200);
    expect(second.body.runs[0].runId).toBe('page-run-1');
  });

  it('GET /clusters/:runId returns own run + 404 cross-account', async () => {
    const a = await seedUser('cluster-detail-a@example.com');
    const b = await seedUser('cluster-detail-b@example.com');
    const runId = 'a'.repeat(64);
    await KeywordClusterRun.create({
      runId, accountId: a.id,
      market: { locationCode: 2840, languageCode: 'en' },
      memberRefs: [], clusters: [], aiProfile: { name: 'keyword_clustering', version: '1.0.0' },
      costMicros: 0,
    });
    const ownRes = await request(app)
      .get(`/api/keyword-research/clusters/${runId}`)
      .set('Cookie', a.cookie);
    expect(ownRes.status).toBe(200);
    expect(ownRes.body.runId).toBe(runId);
    const foreignRes = await request(app)
      .get(`/api/keyword-research/clusters/${runId}`)
      .set('Cookie', b.cookie);
    expect(foreignRes.status).toBe(404);
  });

  it('GET /clusters/:runId invalid runId rejected 400 by schema', async () => {
    const user = await seedUser('cluster-detail-inv@example.com');
    const res = await request(app)
      .get('/api/keyword-research/clusters/not-a-hex')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });
});
