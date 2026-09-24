import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { vendorResponses } from '../../db/schema/index.js';
import {
  ProviderError,
  type AppBulkMetricsRow,
  type AppCompetitorRow,
  type AppIntersectionRow,
  type AppKeywordRow,
} from '../../shared/providers/index.js';
import { createFakeAppDataProvider } from '../../shared/providers/fakes.js';
import {
  computeVendorCacheKey,
  createVendorCacheRepo,
} from '../../shared/vendor-cache/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { loadOwnedSite } from '../sites/sites.guard.js';

const mocked = vi.hoisted(() => ({
  loadSite: vi.fn(),
  profileFind: vi.fn(),
}));

vi.mock('./app-profile.model.js', () => ({
  AppProfile: { findOne: mocked.profileFind },
}));
vi.mock('../sites/sites.guard.js', () => ({ loadOwnedSite: mocked.loadSite }));

import {
  APP_RESEARCH_OPERATIONS,
  appResearchTestables as internals,
  previewAppResearch,
  readLatestAppResearch,
  runAppCompetitorDiscovery,
  runAppGapResearch,
  runAppKeywordResearch,
  setAppSeoResearchProvider,
} from './research.service.js';

const accountId = 'app-research-account';
const siteId = '507f1f77bcf86cd799439011';
const profileId = '507f1f77bcf86cd799439012';
const playAppId = 'com.example.rankme';
const appleAppId = '123456789';
const fetchedAt = new Date('2026-08-10T12:00:00.000Z');
const expiresAt = new Date('2099-01-01T00:00:00.000Z');
const provider = createFakeAppDataProvider();

let keywordRows: AppKeywordRow[];
let gapRows: AppIntersectionRow[];
let competitorRows: AppCompetitorRow[];
let metricRows: AppBulkMetricsRow[];

function database(): ApplicationDb {
  return getTestDb();
}

function profileQuery(input: {
  playPackageId?: string | null;
  appStoreId?: string | null;
  missing?: boolean;
} = {}) {
  return {
    select: vi.fn().mockResolvedValue(input.missing ? null : {
      _id: profileId,
      playPackageId: input.playPackageId === undefined ? `  ${playAppId.toUpperCase()}  ` : input.playPackageId,
      appStoreId: input.appStoreId === undefined ? appleAppId : input.appStoreId,
    }),
  };
}

async function seedCache(operation: string, params: Record<string, unknown>, payload: unknown): Promise<void> {
  const cacheKey = computeVendorCacheKey({ capability: 'keyword', operation, params });
  await createVendorCacheRepo(database()).upsert({
    capability: 'keyword', operation, cacheKey, params, payload, fetchedAt, expiresAt,
  });
}

function keywordInput(input: { cursor?: number; pageSize?: number; store?: 'google_play' | 'app_store' } = {}) {
  return {
    profileId,
    store: input.store ?? 'google_play',
    locationCode: 2840,
    languageCode: 'EN',
    cursor: input.cursor ?? 0,
    pageSize: input.pageSize ?? 25,
  };
}

function gapInput(input: {
  appIds?: string[];
  locationCode?: number;
  languageCode?: string;
  store?: 'google_play' | 'app_store';
} = {}) {
  return {
    profileId,
    store: input.store ?? 'google_play',
    locationCode: input.locationCode ?? 2840,
    languageCode: input.languageCode ?? 'en',
    appIds: input.appIds ?? [playAppId, 'com.example.competitor'],
  };
}

function competitorInput(store: 'google_play' | 'app_store' = 'google_play') {
  return { profileId, store, locationCode: 2840, languageCode: 'EN' };
}

const originalFlags = {
  appSeo: env.APP_SEO_ENABLED,
  research: env.APP_RESEARCH_ENABLED,
};

beforeAll(async () => {
  await startTestPostgres();
  keywordRows = await provider.keywordsForApp({ store: 'google_play', appId: playAppId, limit: 100 });
  gapRows = await provider.appIntersection({
    store: 'google_play', appIds: [playAppId, 'com.example.competitor'],
    locationCode: 2840, languageCode: 'en', limit: 100,
  });
  competitorRows = await provider.appCompetitors({
    store: 'google_play', appId: playAppId, locationCode: 2840, languageCode: 'en', limit: 100,
  });
  metricRows = await provider.bulkAppMetrics({
    store: 'google_play', appIds: competitorRows.map((row) => row.appId),
    locationCode: 2840, languageCode: 'en',
  });
});

afterAll(async () => {
  setAppSeoResearchProvider(null);
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
  env.APP_SEO_ENABLED = true;
  env.APP_RESEARCH_ENABLED = true;
  setAppSeoResearchProvider(provider);
  mocked.profileFind.mockReset().mockReturnValue(profileQuery());
  mocked.loadSite.mockReset().mockResolvedValue({ id: siteId });
});

afterEach(() => {
  env.APP_SEO_ENABLED = originalFlags.appSeo;
  env.APP_RESEARCH_ENABLED = originalFlags.research;
  vi.restoreAllMocks();
});

describe('app research guards and helpers', () => {
  it('enforces feature flags, provider configuration, market, and store-specific normalization', () => {
    expect(internals.normalizeAppId('google_play', ' Com.Example.App ')).toBe('com.example.app');
    expect(internals.normalizeAppId('app_store', ' 123ABC ')).toBe('123ABC');
    expect(() => internals.assertUsEnglish(2840, ' EN ')).not.toThrow();
    expect(() => internals.assertUsEnglish(1, 'en')).toThrow();
    expect(() => internals.assertUsEnglish(2840, 'fr')).toThrow();
    expect(internals.requireCachedProbeValue(['row'])).toEqual(['row']);
    expect(() => internals.requireCachedProbeValue(null)).toThrow('missing its parsed value');
    expect(internals.getProvider()).toBe(provider);
    setAppSeoResearchProvider(null);
    expect(() => internals.getProvider()).toThrow('not configured');

    env.APP_SEO_ENABLED = false;
    expect(() => internals.requireResearchEnabled()).toThrow();
    env.APP_SEO_ENABLED = true;
    env.APP_RESEARCH_ENABLED = false;
    expect(() => internals.requireResearchEnabled()).toThrow();
    env.APP_RESEARCH_ENABLED = true;
    expect(() => internals.requireResearchEnabled()).not.toThrow();
  });

  it('fails closed across invalid, foreign, and store-incomplete profiles and permits paused reads only explicitly', async () => {
    await expect(internals.requireOwnedProfile(accountId, siteId, 'invalid', 'google_play'))
      .rejects.toMatchObject({ status: 404 });
    mocked.profileFind.mockReturnValueOnce(profileQuery({ missing: true }));
    await expect(internals.requireOwnedProfile(accountId, siteId, profileId, 'google_play'))
      .rejects.toMatchObject({ status: 404 });
    mocked.profileFind.mockReturnValueOnce(profileQuery({ playPackageId: null }));
    await expect(internals.requireOwnedProfile(accountId, siteId, profileId, 'google_play'))
      .rejects.toMatchObject({ status: 404 });
    mocked.profileFind.mockReturnValueOnce(profileQuery({ appStoreId: null }));
    await expect(internals.requireOwnedProfile(accountId, siteId, profileId, 'app_store'))
      .rejects.toMatchObject({ status: 404 });
    mocked.profileFind.mockReturnValueOnce(profileQuery());
    await expect(internals.requireOwnedProfile(accountId, siteId, profileId, 'google_play', true))
      .resolves.toMatchObject({ appId: playAppId });
    expect(loadOwnedSite).toHaveBeenLastCalledWith(accountId, siteId, { allowPaused: true });
    mocked.profileFind.mockReturnValueOnce(profileQuery());
    await expect(internals.requireOwnedProfile(accountId, siteId, profileId, 'app_store'))
      .resolves.toMatchObject({ appId: appleAppId });
  });
});

describe('app research previews', () => {
  it('reports keyword cache misses and hits without calling the provider', async () => {
    const providerSpy = vi.spyOn(provider, 'keywordsForApp');
    await expect(previewAppResearch({
      accountId, siteId, profileId, store: 'google_play', surface: 'keywords',
      locationCode: 2840, languageCode: 'EN',
    }, database())).resolves.toEqual({
      deploymentMode: 'community',
      capacityEnforced: false,
      operation: 'app-research-keywords',
      cachedStatus: 'miss',
    });
    const params = { store: 'google_play', appId: playAppId, locationCode: 2840, languageCode: 'en' };
    await seedCache(APP_RESEARCH_OPERATIONS.keywords, params, keywordRows);
    await expect(previewAppResearch({
      accountId, siteId, profileId, store: 'google_play', surface: 'keywords',
      locationCode: 2840, languageCode: 'EN',
    }, database())).resolves.toMatchObject({ cachedStatus: 'hit' });
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it('validates gap markets, bounds, ownership, identifiers, and cache state', async () => {
    const base = {
      accountId, siteId, profileId, store: 'google_play' as const, surface: 'gap' as const,
      locationCode: 2840, languageCode: 'en',
    };
    await expect(previewAppResearch({ ...base, locationCode: 1, appIds: [playAppId, 'com.example.other'] }, database()))
      .rejects.toMatchObject({ status: 400 });
    await expect(previewAppResearch(base, database())).rejects.toMatchObject({ status: 400 });
    await expect(previewAppResearch({ ...base, appIds: [playAppId] }, database()))
      .rejects.toMatchObject({ status: 400 });
    await expect(previewAppResearch({ ...base, appIds: Array.from({ length: 21 }, (_, index) => `com.example.app${index}`) }, database()))
      .rejects.toMatchObject({ status: 400 });
    await expect(previewAppResearch({ ...base, appIds: ['com.example.one', 'com.example.two'] }, database()))
      .rejects.toMatchObject({ status: 400 });
    await expect(previewAppResearch({ ...base, appIds: [playAppId, 'INVALID ID'] }, database()))
      .rejects.toMatchObject({ status: 400 });

    const appIds = ['com.example.competitor', playAppId];
    await expect(previewAppResearch({ ...base, appIds }, database())).resolves.toEqual({
      deploymentMode: 'community',
      capacityEnforced: false,
      operation: 'app-research-gap',
      cachedStatus: 'miss',
    });
    await seedCache(APP_RESEARCH_OPERATIONS.gap, {
      store: 'google_play', appIds: [...appIds].sort(), locationCode: 2840, languageCode: 'en',
    }, gapRows);
    await expect(previewAppResearch({ ...base, appIds: [playAppId.toUpperCase(), 'com.example.competitor', playAppId] }, database()))
      .resolves.toMatchObject({ cachedStatus: 'hit' });

    await expect(previewAppResearch({
      ...base,
      store: 'app_store',
      appIds: [appleAppId, '987654321'],
    }, database())).resolves.toMatchObject({ cachedStatus: 'miss' });
  });

  it('distinguishes fresh, empty-cached, mixed, and fully cached competitor previews', async () => {
    const input = {
      accountId, siteId, profileId, store: 'google_play' as const,
      surface: 'competitors' as const, locationCode: 2840, languageCode: 'EN',
    };
    const baseParams = { store: 'google_play', appId: playAppId, locationCode: 2840, languageCode: 'en' };
    await expect(previewAppResearch(input, database())).resolves.toEqual({
      deploymentMode: 'community',
      capacityEnforced: false,
      operation: 'app-research-competitors',
      cachedStatus: 'miss',
    });

    await seedCache(APP_RESEARCH_OPERATIONS.competitors, baseParams, []);
    await expect(previewAppResearch(input, database())).resolves.toMatchObject({ cachedStatus: 'hit' });

    await truncateAllTables();
    await seedCache(APP_RESEARCH_OPERATIONS.competitors, baseParams, competitorRows);
    await expect(previewAppResearch(input, database())).resolves.toMatchObject({ cachedStatus: 'partial' });
    const metricAppIds = competitorRows.slice(0, 50).map((row) => row.appId).sort();
    await seedCache(APP_RESEARCH_OPERATIONS.metrics, {
      store: 'google_play', appIds: metricAppIds, locationCode: 2840, languageCode: 'en',
    }, metricRows);
    await expect(previewAppResearch(input, database())).resolves.toMatchObject({ cachedStatus: 'hit' });
  });
});

describe('app research mutations and stored reads', () => {
  it('paginates keyword research deterministically, archives, and then serves cache', async () => {
    const first = await runAppKeywordResearch({
      accountId, siteId, input: keywordInput({ pageSize: 1 }),
    }, database());
    expect(first).toMatchObject({
      surface: 'keywords', appId: playAppId, cursor: 0, nextCursor: 1,
      totalRows: keywordRows.length, cached: false,
    });
    const second = await runAppKeywordResearch({
      accountId, siteId, input: keywordInput({ cursor: keywordRows.length - 1, pageSize: 100 }),
    }, database());
    expect(second).toMatchObject({ cached: true, nextCursor: null });
    const latest = await readLatestAppResearch({
      accountId, siteId, profileId, store: 'google_play', surface: 'keywords',
    }, database());
    expect(latest).toEqual({ result: second, researchEnabled: true });
  });

  it('validates and runs US-English gap research with normalized, unique app ids', async () => {
    await expect(runAppGapResearch({
      accountId, siteId, input: gapInput({ locationCode: 1 }),
    }, database())).rejects.toMatchObject({ status: 400 });
    await expect(runAppGapResearch({
      accountId, siteId, input: gapInput({ appIds: [playAppId, playAppId] }),
    }, database())).rejects.toMatchObject({ status: 400 });
    await expect(runAppGapResearch({
      accountId, siteId, input: gapInput({ appIds: Array.from({ length: 21 }, (_, index) => `com.example.app${index}`) }),
    }, database())).rejects.toMatchObject({ status: 400 });
    await expect(runAppGapResearch({
      accountId, siteId, input: gapInput({ appIds: ['com.example.one', 'com.example.two'] }),
    }, database())).rejects.toMatchObject({ status: 400 });

    const result = await runAppGapResearch({
      accountId, siteId,
      input: gapInput({ appIds: [playAppId.toUpperCase(), 'com.example.competitor', playAppId] }),
    }, database());
    expect(result).toMatchObject({
      surface: 'gap', ownAppId: playAppId,
      appIds: ['com.example.competitor', playAppId], cached: false,
    });
    await expect(readLatestAppResearch({
      accountId, siteId, profileId, store: 'google_play', surface: 'gap',
    }, database())).resolves.toMatchObject({ result });
  });

  it('joins competitor metrics, preserves empty results, and degrades only provider metric failures', async () => {
    const full = await runAppCompetitorDiscovery({
      accountId, siteId, input: competitorInput(),
    }, database());
    expect(full).toMatchObject({ surface: 'competitors', partial: false, noteKey: null, cached: false });
    expect(full.rows.some((row) => row.metrics !== null)).toBe(true);
    await expect(runAppCompetitorDiscovery({
      accountId, siteId, input: competitorInput(),
    }, database())).resolves.toMatchObject({ cached: true, partial: false });

    await truncateAllTables();
    vi.spyOn(provider, 'appCompetitors').mockResolvedValueOnce([]);
    const empty = await runAppCompetitorDiscovery({
      accountId, siteId, input: competitorInput(),
    }, database());
    expect(empty).toMatchObject({ rows: [], partial: false, cached: false });

    await truncateAllTables();
    vi.spyOn(provider, 'bulkAppMetrics').mockRejectedValueOnce(new ProviderError(
      'metrics unavailable', true, { provider: 'fixture', operation: 'bulkAppMetrics' },
    ));
    const partial = await runAppCompetitorDiscovery({
      accountId, siteId, input: competitorInput(),
    }, database());
    expect(partial).toMatchObject({
      partial: true, cached: false, noteKey: 'appSeo.research.competitors.partialNote',
    });
    expect(partial.rows.every((row) => row.metrics === null)).toBe(true);

    await truncateAllTables();
    await seedCache(APP_RESEARCH_OPERATIONS.competitors, {
      store: 'google_play', appId: playAppId, locationCode: 2840, languageCode: 'en',
    }, competitorRows);
    vi.spyOn(provider, 'bulkAppMetrics').mockRejectedValueOnce(new ProviderError(
      'metrics unavailable', true, { provider: 'fixture', operation: 'bulkAppMetrics' },
    ));
    await expect(runAppCompetitorDiscovery({
      accountId, siteId, input: competitorInput(),
    }, database())).resolves.toMatchObject({ cached: false, partial: true });

    await truncateAllTables();
    vi.spyOn(provider, 'bulkAppMetrics').mockRejectedValueOnce(new Error('database fault'));
    await expect(runAppCompetitorDiscovery({
      accountId, siteId, input: competitorInput(),
    }, database())).rejects.toThrow('database fault');
  });

  it('returns null for absent or malformed archives and reflects both rollout flags', async () => {
    env.APP_SEO_ENABLED = false;
    let latest = await readLatestAppResearch({
      accountId, siteId, profileId, store: 'google_play', surface: 'competitors',
    }, database());
    expect(latest).toEqual({ result: null, researchEnabled: false });

    env.APP_SEO_ENABLED = true;
    env.APP_RESEARCH_ENABLED = false;
    latest = await readLatestAppResearch({
      accountId, siteId, profileId, store: 'google_play', surface: 'competitors',
    }, database());
    expect(latest.researchEnabled).toBe(false);
    expect(loadOwnedSite).toHaveBeenLastCalledWith(accountId, siteId, { allowPaused: true });

    await getTestDb().insert(vendorResponses).values({
      capability: 'keyword', operation: APP_RESEARCH_OPERATIONS.competitorsResult,
      cacheKey: 'malformed-result', params: { profileId, store: 'google_play' },
      payload: { unsafe: true }, accountId, siteId, fetchedAt,
    });
    env.APP_RESEARCH_ENABLED = true;
    latest = await readLatestAppResearch({
      accountId, siteId, profileId, store: 'google_play', surface: 'competitors',
    }, database());
    expect(latest).toMatchObject({ result: null, researchEnabled: true });
  });

  it('supports App Store ownership and preserves its numeric identifier casing', async () => {
    mocked.profileFind.mockReturnValue(profileQuery());
    const appleRows = await provider.keywordsForApp({
      store: 'app_store', appId: appleAppId, locationCode: 2840, languageCode: 'en', limit: 100,
    });
    vi.spyOn(provider, 'keywordsForApp').mockResolvedValueOnce(appleRows);
    await expect(runAppKeywordResearch({
      accountId, siteId, input: keywordInput({ store: 'app_store' }),
    }, database())).resolves.toMatchObject({ store: 'app_store', appId: appleAppId });
  });
});
