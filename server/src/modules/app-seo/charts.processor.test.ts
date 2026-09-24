import { UnrecoverableError } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appChartSnapshots } from '../../db/schema/index.js';
import {
  ProviderError,
  type AppChartPage,
  type AppStoreKind,
} from '../../shared/providers/index.js';
import { createFakeAppDataProvider } from '../../shared/providers/fakes.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { appKeywordWeekStart } from './weekly-checks.js';

const mocked = vi.hoisted(() => ({
  getTopChart: vi.fn(),
  profileFind: vi.fn(),
  siteFind: vi.fn(),
  subscriptionFind: vi.fn(),
}));

vi.mock('../sites/index.js', () => ({ Site: { findOne: mocked.siteFind } }));
vi.mock('./app-profile.model.js', () => ({ AppProfile: { findOne: mocked.profileFind } }));
vi.mock('./charts.model.js', () => ({
  AppChartSubscription: { findOne: mocked.subscriptionFind },
}));

import {
  appChartProcessorTestables as internals,
  createAppChartProcessor,
  type AppChartProcessorDeps,
} from './charts.processor.js';

const accountId = '507f1f77bcf86cd799439010';
const siteId = '507f1f77bcf86cd799439011';
const profileId = '507f1f77bcf86cd799439012';
const subscriptionId = '507f1f77bcf86cd799439013';
const STAMP = '2026-W33';
const NOW = new Date('2026-08-12T12:00:00.000Z');
const fake = createFakeAppDataProvider();

let googlePage: AppChartPage;
let applePage: AppChartPage;

function database(): ApplicationDb {
  return getTestDb();
}

function subscription(input: {
  store?: AppStoreKind;
  chartId?: string;
  categoryId?: string;
} = {}) {
  return {
    _id: subscriptionId,
    accountId,
    siteId,
    profileId,
    store: input.store ?? 'google_play',
    chartId: input.chartId ?? 'topselling_free',
    categoryId: input.categoryId ?? 'business',
    locationCode: 2840,
    languageCode: 'en',
  };
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
    subscriptionId,
    reservationStamp: STAMP,
    manual: false,
    ...input,
  };
}

function job(data: unknown = payload()) {
  return { data };
}

function dependencies(input: {
  archive?: AppChartProcessorDeps['archive'];
  now?: () => Date;
} = {}): AppChartProcessorDeps {
  return {
    db: database(),
    provider: { getTopChart: mocked.getTopChart },
    ...(input.archive === undefined ? {} : { archive: input.archive }),
    ...(input.now === undefined ? { now: () => NOW } : { now: input.now }),
  };
}

async function insertEvidence(input: {
  store?: AppStoreKind;
  position?: number | null;
} = {}): Promise<void> {
  const store = input.store ?? 'google_play';
  const page = store === 'google_play' ? googlePage : applePage;
  await getTestDb().insert(appChartSnapshots).values({
    accountId,
    siteId,
    profileId,
    store,
    chartId: store === 'google_play' ? 'topselling_free' : 'top_free_ios',
    categoryId: 'business',
    position: input.position === undefined ? 4 : input.position,
    checkedAt: appKeywordWeekStart(STAMP),
    observationMeta: page.observationMeta,
  });
}

beforeAll(async () => {
  await startTestPostgres();
  googlePage = await fake.getTopChart({
    store: 'google_play', chartId: 'topselling_free', categoryId: 'business',
    locationCode: 2840, languageCode: 'en', depth: 100,
  });
  applePage = await fake.getTopChart({
    store: 'app_store', chartId: 'top_free_ios', categoryId: 'business',
    locationCode: 2840, languageCode: 'en', depth: 100,
  });
});

afterAll(stopTestPostgres);

beforeEach(async () => {
  await truncateAllTables();
  mocked.getTopChart.mockReset().mockResolvedValue(googlePage);
  mocked.profileFind.mockReset().mockReturnValue(selected(profile()));
  mocked.siteFind.mockReset().mockReturnValue(selected({ _id: siteId, paused: false }));
  mocked.subscriptionFind.mockReset().mockResolvedValue(subscription());
});

describe('app chart processor helpers and trust boundary', () => {
  it('normalizes both store id families and resolves injected and real time', () => {
    expect(internals.normalizeStoreId('google_play', ' COM.Example.App ')).toBe('com.example.app');
    expect(internals.normalizeStoreId('app_store', ' 123ABC ')).toBe('123ABC');
    expect(internals.processorNow(() => NOW)).toBe(NOW);
    const before = Date.now();
    expect(internals.processorNow().getTime()).toBeGreaterThanOrEqual(before);
  });

  it('rejects malformed consumed payloads before touching storage', async () => {
    const process = createAppChartProcessor(dependencies());
    await expect(process(job({ unsafe: true }))).rejects.toThrow();
    expect(mocked.subscriptionFind).not.toHaveBeenCalled();
  });
});

describe('app chart owner and lifecycle guards', () => {
  it('permanently fails missing subscriptions and profiles', async () => {
    const process = createAppChartProcessor(dependencies());
    mocked.subscriptionFind.mockResolvedValueOnce(null);
    await expect(process(job())).rejects.toBeInstanceOf(UnrecoverableError);
    mocked.profileFind.mockReturnValueOnce(selected(null));
    await expect(process(job())).rejects.toThrow('app profile not found');
  });

  it('skips deleted and paused sites without provider spend', async () => {
    const process = createAppChartProcessor(dependencies());
    mocked.siteFind.mockReturnValueOnce(selected(null));
    await expect(process(job())).resolves.toEqual({
      subscriptionId, status: 'skipped', position: null,
    });
    mocked.siteFind.mockReturnValueOnce(selected({ _id: siteId, paused: true }));
    await expect(process(job())).resolves.toMatchObject({ status: 'skipped' });
    expect(mocked.getTopChart).not.toHaveBeenCalled();
  });

  it('permanently fails when the subscribed store id is no longer registered', async () => {
    const process = createAppChartProcessor(dependencies());
    mocked.profileFind.mockReturnValueOnce(selected(profile({ playPackageId: null })));
    await expect(process(job())).rejects.toThrow('no id for subscribed store');

    mocked.subscriptionFind.mockResolvedValueOnce(subscription({
      store: 'app_store', chartId: 'top_free_ios',
    }));
    mocked.profileFind.mockReturnValueOnce(selected(profile({ appStoreId: null })));
    await expect(process(job())).rejects.toThrow('no id for subscribed store');
  });
});

describe('app chart evidence persistence', () => {
  it('replays an already-stored nullable observation without provider spend', async () => {
    await insertEvidence({ position: null });
    const process = createAppChartProcessor(dependencies());
    await expect(process(job())).resolves.toEqual({
      subscriptionId, status: 'already_stored', position: null,
    });
    expect(mocked.getTopChart).not.toHaveBeenCalled();
  });

  it('stores an exact normalized Google Play match and archives redacted provider evidence', async () => {
    const archive = vi.fn().mockResolvedValue(undefined);
    const process = createAppChartProcessor(dependencies({ archive }));
    const result = await process(job());
    expect(result).toEqual({
      subscriptionId, status: 'stored', position: googlePage.rows[0]?.position ?? null,
    });
    expect(mocked.getTopChart).toHaveBeenCalledWith({
      store: 'google_play', chartId: 'topselling_free', categoryId: 'business',
      locationCode: 2840, languageCode: 'en', depth: 100,
    });
    expect(archive).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'keyword', operation: 'app-data-top-chart',
      params: expect.objectContaining({ subscriptionId, depth: 100 }),
      accountId, siteId, costMicros: null, fetchedAt: NOW,
    }));
    const rows = await getTestDb().select().from(appChartSnapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountId, siteId, profileId, store: 'google_play',
      position: googlePage.rows[0]?.position ?? null,
    });
  });

  it('stores null when the bounded chart omits the app and supports App Store ids without folding case', async () => {
    mocked.profileFind.mockReturnValueOnce(selected(profile({ playPackageId: 'not.in.chart' })));
    await expect(createAppChartProcessor(dependencies())(job())).resolves.toEqual({
      subscriptionId, status: 'stored', position: null,
    });

    await truncateAllTables();
    mocked.subscriptionFind.mockResolvedValueOnce(subscription({
      store: 'app_store', chartId: 'top_free_ios',
    }));
    mocked.getTopChart.mockResolvedValueOnce(applePage);
    await expect(createAppChartProcessor(dependencies())(job())).resolves.toMatchObject({
      status: 'stored', position: applePage.rows[0]?.position ?? null,
    });
  });

  it('fails non-retryable provider refusal permanently but preserves retryable and unexpected failures', async () => {
    const permanent = new ProviderError('malformed', false, {
      provider: 'fixture', operation: 'top-chart-contract',
    });
    mocked.getTopChart.mockRejectedValueOnce(permanent);
    await expect(createAppChartProcessor(dependencies())(job()))
      .rejects.toThrow('non-retryable app chart failure: top-chart-contract');

    const retryable = new ProviderError('timeout', true, {
      provider: 'fixture', operation: 'top-chart-timeout',
    });
    mocked.getTopChart.mockRejectedValueOnce(retryable);
    await expect(createAppChartProcessor(dependencies())(job())).rejects.toBe(retryable);
    const unexpected = new Error('storage unavailable');
    mocked.getTopChart.mockRejectedValueOnce(unexpected);
    await expect(createAppChartProcessor(dependencies())(job())).rejects.toBe(unexpected);
  });
});
