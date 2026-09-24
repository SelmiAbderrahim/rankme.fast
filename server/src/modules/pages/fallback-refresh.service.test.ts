import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pagePerformanceSnapshots } from '../../db/schema/page-performance.js';
import { createFakeKeywordProvider } from '../../shared/providers/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import type { PagesRepository } from './pages.repository.js';
import {
  createPagesFallbackRefreshService,
  fingerprintFallbackPayload,
  normalizeFallbackCandidates,
  pagesFallbackSourceForProvider,
} from './fallback-refresh.service.js';

const OBSERVED_AT = new Date('2026-08-08T10:00:00.000Z');
const MARKET = { locationCode: 2840, languageCode: 'en', selection: 'default' as const };
const INPUT = {
  accountId: 'account-a',
  siteId: 'site-a',
  domain: 'example.com',
  siteUrl: 'https://example.com',
};

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    keyword: 'seo audit',
    searchVolume: 100,
    difficulty: 42,
    currentPosition: 7,
    estimatedTraffic: 12.5,
    rankingUrl: 'https://example.com/guide',
    ...overrides,
  } as never;
}

function repositoryMock(overrides: Partial<PagesRepository> = {}): PagesRepository {
  return {
    writeSuccessfulSnapshot: vi.fn(async (input) => ({
      snapshot: {
        id: '11111111-1111-4111-8111-111111111111',
        createdAt: OBSERVED_AT,
        updatedAt: OBSERVED_AT,
        successfulEmpty: input.acceptedCount === 0,
        ...input,
      },
      keywords: [],
      inserted: true,
    })) as never,
    readLatest: vi.fn(async () => null),
    readPrevious: vi.fn(async () => null),
    readRange: vi.fn(async () => []),
    readKeywords: vi.fn(async () => []),
    ...overrides,
  };
}

describe('fallback candidate normalization', () => {
  it('preserves nullable metrics, aggregates same-page keywords, and counts every drop reason', () => {
    const normalized = normalizeFallbackCandidates(
      [
        candidate({ searchVolume: null, difficulty: null, estimatedTraffic: null }),
        candidate({ keyword: 'technical seo' }),
        candidate({ rankingUrl: null }),
        candidate({ keyword: 'relative', rankingUrl: '/relative' }),
        candidate({ keyword: 'offsite', rankingUrl: 'https://evil.test/' }),
        candidate({ keyword: 'SEO AUDIT' }),
        candidate({ keyword: 'invalid', currentPosition: 0 }),
      ],
      'https://example.com',
    );
    expect(normalized.keywords).toHaveLength(2);
    expect(normalized.keywords[0]).toMatchObject({
      searchVolume: null,
      difficulty: null,
      estimatedTraffic: null,
    });
    expect(normalized.coverage).toEqual({
      sourceRowsFetched: 7,
      acceptedCount: 2,
      droppedCount: 5,
      malformedUrlCount: 2,
      offsiteUrlCount: 1,
      duplicateUrlCount: 1,
      invalidMetricCount: 1,
      sourceTruncated: false,
    });
  });

  it('rejects poisoned metric/text shapes and marks an operation-limit payload truncated', () => {
    const rows = Array.from({ length: 100 }, (_, index) =>
      candidate({
        keyword: index === 0 ? ' '.repeat(2) : `keyword-${index}`,
        currentPosition: index === 1 ? Number.POSITIVE_INFINITY : 1,
        searchVolume: index === 2 ? 0.5 : null,
        difficulty: index === 3 ? 101 : null,
        estimatedTraffic: index === 4 ? -1 : null,
        rankingUrl: `https://example.com/${index}`,
      }),
    );
    const normalized = normalizeFallbackCandidates(rows, 'https://example.com');
    expect(normalized.coverage).toMatchObject({
      sourceRowsFetched: 100,
      acceptedCount: 95,
      invalidMetricCount: 5,
      sourceTruncated: true,
    });
  });

  it('fingerprints normalized context deterministically and maps fake provenance to demo', () => {
    const normalized = normalizeFallbackCandidates([candidate()], 'https://example.com');
    const input = { source: 'demo' as const, market: MARKET, observedAt: OBSERVED_AT, normalized };
    expect(fingerprintFallbackPayload(input)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintFallbackPayload(input)).toBe(fingerprintFallbackPayload(input));
    expect(pagesFallbackSourceForProvider('fake')).toBe('demo');
    expect(pagesFallbackSourceForProvider('dataforseo')).toBe('dataforseo');
  });

  it('uses position as the final stable order for locale-equivalent keyword spellings', () => {
    const normalized = normalizeFallbackCandidates([
      candidate({ keyword: 'é', currentPosition: 2 }),
      candidate({ keyword: 'e\u0301', currentPosition: 1 }),
    ], 'https://example.com');
    expect(normalized.keywords.map((row) => row.position)).toEqual([1, 2]);
  });
});

describe('Pages fallback refresh service', () => {
  it('reads the cache, normalizes the whole result, and writes demo provenance', async () => {
    const events: string[] = [];
    const repository = repositoryMock({
      writeSuccessfulSnapshot: vi.fn(async (input) => {
        events.push('write');
        return {
          snapshot: { id: 'snapshot', ...input } as never,
          keywords: [],
          inserted: true,
        };
      }),
    });
    const service = createPagesFallbackRefreshService({
      db: getTestDb() as never,
      provider: createFakeKeywordProvider(),
      providerSelection: 'fake',
      repository,
      resolveMarket: vi.fn(async () => MARKET),
      readRankedCandidates: vi.fn(async () => {
        events.push('cache');
        return { candidates: [candidate()], cached: true, fetchedAt: OBSERVED_AT };
      }),
    });
    const result = await service.refresh(INPUT);
    expect(events).toEqual(['cache', 'write']);
    expect(result).toMatchObject({
      ok: true,
      outcome: 'refreshed',
      source: 'demo',
      market: MARKET,
      cache: 'hit',
      observedAt: OBSERVED_AT,
      coverage: { acceptedCount: 1, droppedCount: 0 },
    });
  });

  it('persists a successful zero-row snapshot as empty', async () => {
    const repository = repositoryMock();
    const service = createPagesFallbackRefreshService({
      db: getTestDb() as never,
      provider: createFakeKeywordProvider(),
      providerSelection: 'dataforseo',
      repository,
      resolveMarket: vi.fn(async () => MARKET),
      readRankedCandidates: vi.fn(async () => ({
        candidates: [], cached: false, fetchedAt: OBSERVED_AT,
      })),
    });
    await expect(service.refresh(INPUT)).resolves.toMatchObject({
      ok: true, outcome: 'empty', source: 'dataforseo', cache: 'miss',
    });
    expect(repository.writeSuccessfulSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ acceptedCount: 0, sourceRowsFetched: 0, keywords: [] }),
    );
  });

  it('preserves last good data on provider and persistence failures', async () => {
    const prior = { id: 'last-good', observedAt: new Date('2026-08-01') } as never;
    const providerRepository = repositoryMock({ readLatest: vi.fn(async () => prior) });
    const providerFailure = createPagesFallbackRefreshService({
      db: getTestDb() as never,
      provider: createFakeKeywordProvider(),
      providerSelection: 'fake',
      repository: providerRepository,
      resolveMarket: vi.fn(async () => MARKET),
      readRankedCandidates: vi.fn(async () => {
        throw new Error('provider body must not escape');
      }),
    });
    await expect(providerFailure.refresh(INPUT)).resolves.toEqual({
      ok: false, failure: 'provider_unavailable', source: 'demo', market: MARKET, lastGood: prior,
    });
    expect(providerRepository.writeSuccessfulSnapshot).not.toHaveBeenCalled();

    const persistenceRepository = repositoryMock({
      writeSuccessfulSnapshot: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
      readLatest: vi.fn(async () => prior),
    });
    const persistenceFailure = createPagesFallbackRefreshService({
      db: getTestDb() as never,
      provider: createFakeKeywordProvider(),
      providerSelection: 'dataforseo',
      repository: persistenceRepository,
      resolveMarket: vi.fn(async () => MARKET),
      readRankedCandidates: vi.fn(async () => ({
        candidates: [candidate()], cached: false, fetchedAt: OBSERVED_AT,
      })),
    });
    await expect(persistenceFailure.refresh(INPUT)).resolves.toEqual({
      ok: false,
      failure: 'persistence_failed',
      source: 'dataforseo',
      market: MARKET,
      lastGood: prior,
    });
  });

  it('reuses the shared cross-account cache while persisting each tenant', async () => {
    const provider = createFakeKeywordProvider({ rankedSiteKeywords: [candidate()] });
    const ranked = vi.fn(provider.getRankedKeywordsForSite);
    const service = createPagesFallbackRefreshService({
      db: getTestDb() as never,
      provider: { ...provider, getRankedKeywordsForSite: ranked },
      providerSelection: 'fake',
      now: () => OBSERVED_AT,
    });
    const first = await service.refresh(INPUT);
    const second = await service.refresh({ ...INPUT, accountId: 'account-b', siteId: 'site-b' });
    expect(first).toMatchObject({ ok: true, cache: 'miss', source: 'demo' });
    expect(second).toMatchObject({ ok: true, cache: 'hit', source: 'demo' });
    expect(ranked).toHaveBeenCalledTimes(1);
    expect(await getTestDb().select().from(pagePerformanceSnapshots)).toHaveLength(2);
  });
});
