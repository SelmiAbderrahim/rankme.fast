import { UnrecoverableError } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appKeywords, appRankSnapshots } from '../../db/schema/index.js';
import {
  ProviderError,
  type AppSearchResult,
  type AppStoreKind,
} from '../../shared/providers/index.js';
import { createFakeAppDataProvider } from '../../shared/providers/fakes.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';

const mocked = vi.hoisted(() => ({
  profileFind: vi.fn(),
  searchApps: vi.fn(),
  siteFind: vi.fn(),
}));

vi.mock('../sites/index.js', () => ({ Site: { findOne: mocked.siteFind } }));
vi.mock('./app-profile.model.js', () => ({ AppProfile: { findOne: mocked.profileFind } }));

import {
  appKeywordProcessorTestables as internals,
  createAppKeywordProcessor,
  type AppKeywordProcessorDeps,
} from './keywords.processor.js';
import { appKeywordWeekStart } from './weekly-checks.js';

const accountId = '507f1f77bcf86cd799439010';
const foreignAccountId = '507f1f77bcf86cd799439099';
const siteId = '507f1f77bcf86cd799439011';
const profileId = '507f1f77bcf86cd799439012';
const keywordId = '13bea72e-4fc8-495d-bcd7-03841ee099d2';
const STAMP = '2026-W33';
const NOW = new Date('2026-08-12T12:00:00.000Z');
const fake = createFakeAppDataProvider();

let googlePage: AppSearchResult;
let applePage: AppSearchResult;

function database(): ApplicationDb {
  return getTestDb();
}

function selected(value: unknown) {
  return { select: vi.fn().mockResolvedValue(value) };
}

function profile(input: {
  playPackageId?: string | null;
  appStoreId?: string | null;
} = {}) {
  return {
    playPackageId: input.playPackageId === undefined
      ? `  ${googlePage.rows[0]!.appId.toUpperCase()}  `
      : input.playPackageId,
    appStoreId: input.appStoreId === undefined
      ? `  ${applePage.rows[0]!.appId}  `
      : input.appStoreId,
  };
}

function payload(input: Record<string, unknown> = {}) {
  return {
    accountId,
    siteId,
    profileId,
    keywordId,
    reservationStamp: STAMP,
    manual: false,
    ...input,
  };
}

function job(data: unknown = payload()) {
  return { data };
}

function dependencies(input: {
  archive?: AppKeywordProcessorDeps['archive'];
  now?: () => Date;
} = {}): AppKeywordProcessorDeps {
  return {
    db: database(),
    provider: { searchApps: mocked.searchApps },
    logger: { error: vi.fn() },
    ...(input.archive === undefined ? {} : { archive: input.archive }),
    ...(input.now === undefined ? { now: () => NOW } : { now: input.now }),
  };
}

async function insertKeyword(input: {
  accountId?: string;
  active?: boolean;
  store?: AppStoreKind;
} = {}): Promise<void> {
  await getTestDb().insert(appKeywords).values({
    id: keywordId,
    accountId: input.accountId ?? accountId,
    siteId,
    profileId,
    store: input.store ?? 'google_play',
    phrase: 'seo audit',
    locationCode: 2840,
    languageCode: 'en',
    active: input.active ?? true,
  });
}

async function insertEvidence(position: number | null = 4): Promise<void> {
  await getTestDb().insert(appRankSnapshots).values({
    accountId,
    siteId,
    keywordId,
    position,
    rankAbsolute: position,
    foundAppId: position === null ? null : googlePage.rows[0]!.appId,
    checkedAt: appKeywordWeekStart(STAMP),
    observationMeta: googlePage.observationMeta,
  });
}

beforeAll(async () => {
  await startTestPostgres();
  googlePage = await fake.searchApps({
    store: 'google_play', keyword: 'seo audit', locationCode: 2840,
    languageCode: 'en', depth: 30,
  });
  applePage = await fake.searchApps({
    store: 'app_store', keyword: 'seo audit', locationCode: 2840,
    languageCode: 'en', depth: 100,
  });
});

afterAll(stopTestPostgres);

beforeEach(async () => {
  await truncateAllTables();
  mocked.profileFind.mockReset().mockReturnValue(selected(profile()));
  mocked.searchApps.mockReset().mockResolvedValue(googlePage);
  mocked.siteFind.mockReset().mockReturnValue(selected({ _id: siteId, paused: false }));
});

describe('app keyword processor helpers and trust boundary', () => {
  it('normalizes both store id families and resolves injected and real time', () => {
    expect(internals.normalizeStoreId('google_play', ' COM.Example.App ')).toBe('com.example.app');
    expect(internals.normalizeStoreId('app_store', ' 123ABC ')).toBe('123ABC');
    expect(internals.processorNow(() => NOW)).toBe(NOW);
    const before = Date.now();
    expect(internals.processorNow().getTime()).toBeGreaterThanOrEqual(before);
  });

  it('rejects malformed consumed payloads before touching storage', async () => {
    await expect(createAppKeywordProcessor(dependencies())(job({ unsafe: true }))).rejects.toThrow();
    expect(mocked.siteFind).not.toHaveBeenCalled();
  });
});

describe('app keyword owner and lifecycle guards', () => {
  it('permanently rejects missing, inactive, and foreign-account tracked keywords', async () => {
    const process = createAppKeywordProcessor(dependencies());
    await expect(process(job())).rejects.toThrow('tracked app keyword not found');

    await insertKeyword({ active: false });
    await expect(process(job())).rejects.toBeInstanceOf(UnrecoverableError);

    await truncateAllTables();
    await insertKeyword({ accountId: foreignAccountId });
    await expect(process(job())).rejects.toThrow('tracked app keyword not found');
    expect(mocked.siteFind).not.toHaveBeenCalled();
  });

  it('skips deleted and paused sites without provider spend', async () => {
    await insertKeyword();
    const process = createAppKeywordProcessor(dependencies());
    mocked.siteFind.mockReturnValueOnce(selected(null));
    await expect(process(job())).resolves.toEqual({
      keywordId, status: 'skipped', position: null,
    });
    mocked.siteFind.mockReturnValueOnce(selected({ _id: siteId, paused: true }));
    await expect(process(job())).resolves.toMatchObject({ status: 'skipped' });
    expect(mocked.searchApps).not.toHaveBeenCalled();
  });

  it('permanently rejects a missing profile or a missing id for either store', async () => {
    await insertKeyword();
    const process = createAppKeywordProcessor(dependencies());
    mocked.profileFind.mockReturnValueOnce(selected(null));
    await expect(process(job())).rejects.toThrow('app profile not found');

    mocked.profileFind.mockReturnValueOnce(selected(profile({ playPackageId: null })));
    await expect(process(job())).rejects.toThrow('no id for tracked store');

    await truncateAllTables();
    await insertKeyword({ store: 'app_store' });
    mocked.profileFind.mockReturnValueOnce(selected(profile({ appStoreId: null })));
    await expect(process(job())).rejects.toThrow('no id for tracked store');
    expect(mocked.searchApps).not.toHaveBeenCalled();
  });
});

describe('app keyword evidence persistence', () => {
  it('replays an already-stored nullable observation without provider spend', async () => {
    await insertKeyword();
    await insertEvidence(null);
    await expect(createAppKeywordProcessor(dependencies())(job())).resolves.toEqual({
      keywordId, status: 'already_stored', position: null,
    });
    expect(mocked.searchApps).not.toHaveBeenCalled();
  });

  it('stores an exact normalized Google Play match and archives redacted evidence', async () => {
    await insertKeyword();
    const archive = vi.fn().mockResolvedValue(undefined);
    const result = await createAppKeywordProcessor(dependencies({ archive }))(job());
    expect(result).toEqual({
      keywordId, status: 'stored', position: googlePage.rows[0]!.position,
    });
    expect(mocked.searchApps).toHaveBeenCalledWith({
      store: 'google_play', keyword: 'seo audit', locationCode: 2840,
      languageCode: 'en', depth: 30,
    });
    expect(archive).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'keyword', operation: 'app-data-search-apps',
      params: { keywordId, store: 'google_play', locationCode: 2840, languageCode: 'en' },
      accountId, siteId, costMicros: null, fetchedAt: NOW,
    }));
    const archived = archive.mock.calls[0]![0];
    expect(archived.payload).not.toHaveProperty('keyword');
    expect(archived.params).not.toHaveProperty('phrase');
    const rows = await getTestDb().select().from(appRankSnapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountId, siteId, keywordId,
      position: googlePage.rows[0]!.position,
      rankAbsolute: googlePage.rows[0]!.absolutePosition,
      foundAppId: googlePage.rows[0]!.appId,
    });
  });

  it('stores a bounded miss and preserves case-sensitive App Store matching', async () => {
    await insertKeyword();
    mocked.profileFind.mockReturnValueOnce(selected(profile({ playPackageId: 'not.in.results' })));
    await expect(createAppKeywordProcessor(dependencies())(job())).resolves.toEqual({
      keywordId, status: 'stored', position: null,
    });
    let rows = await getTestDb().select().from(appRankSnapshots);
    expect(rows[0]).toMatchObject({ position: null, rankAbsolute: null, foundAppId: null });

    await truncateAllTables();
    await insertKeyword({ store: 'app_store' });
    mocked.searchApps.mockResolvedValueOnce(applePage);
    await expect(createAppKeywordProcessor(dependencies())(job())).resolves.toEqual({
      keywordId, status: 'stored', position: applePage.rows[0]!.position,
    });
    expect(mocked.searchApps).toHaveBeenLastCalledWith(expect.objectContaining({
      store: 'app_store', depth: 100,
    }));
    rows = await getTestDb().select().from(appRankSnapshots);
    expect(rows[0]?.foundAppId).toBe(applePage.rows[0]!.appId);
  });

  it('fails non-retryable refusals permanently but preserves retryable and unexpected failures', async () => {
    await insertKeyword();
    const permanent = new ProviderError('malformed', false, {
      provider: 'fixture', operation: 'app-search-contract',
    });
    mocked.searchApps.mockRejectedValueOnce(permanent);
    await expect(createAppKeywordProcessor(dependencies())(job()))
      .rejects.toThrow('app-search-contract');
    mocked.searchApps.mockRejectedValueOnce(permanent);
    await expect(createAppKeywordProcessor(dependencies())(job()))
      .rejects.toBeInstanceOf(UnrecoverableError);

    const retryable = new ProviderError('timeout', true, {
      provider: 'fixture', operation: 'app-search-timeout',
    });
    mocked.searchApps.mockRejectedValueOnce(retryable);
    await expect(createAppKeywordProcessor(dependencies())(job())).rejects.toBe(retryable);
    const unexpected = new Error('storage unavailable');
    mocked.searchApps.mockRejectedValueOnce(unexpected);
    await expect(createAppKeywordProcessor(dependencies())(job())).rejects.toBe(unexpected);
    expect(await getTestDb().select().from(appRankSnapshots)).toEqual([]);
  });
});
