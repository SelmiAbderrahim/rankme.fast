import { randomUUID } from 'node:crypto';
import { UnrecoverableError } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appKeywords, appListingSnapshots } from '../../db/schema/index.js';
import {
  ProviderError,
  type AppInfo,
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
  siteFind: vi.fn(),
  profileFind: vi.fn(),
}));

vi.mock('../sites/index.js', () => ({ Site: { findOne: mocked.siteFind } }));
vi.mock('./app-profile.model.js', () => ({ AppProfile: { findOne: mocked.profileFind } }));

import {
  appListingProcessorTestables as internals,
  createAppListingProcessor,
} from './listing.processor.js';

const accountId = '507f1f77bcf86cd799439010';
const siteId = '507f1f77bcf86cd799439011';
const profileId = '507f1f77bcf86cd799439012';
const runId = randomUUID();
const capturedAt = '2026-08-10T12:00:00.000Z';
const playAppId = 'com.example.rankme';
const appleAppId = '123456789';
const fake = createFakeAppDataProvider();

let googleListing: AppInfo;
let appleListing: AppInfo;

function chain(value: unknown) {
  return { select: vi.fn().mockResolvedValue(value) };
}

function profile(input: {
  paired?: boolean;
  playPackageId?: string | null;
  appStoreId?: string | null;
} = {}) {
  return {
    paired: input.paired ?? false,
    playPackageId: input.playPackageId === undefined ? playAppId : input.playPackageId,
    appStoreId: input.appStoreId === undefined ? null : input.appStoreId,
  };
}

function payload(input: Record<string, unknown> = {}) {
  return {
    accountId,
    siteId,
    profileId,
    runId,
    capturedAt,
    locationCode: 2840,
    languageCode: 'en',
    ...input,
  };
}

function job(data: unknown = payload()) {
  return { data };
}

function provider(
  implementation: (store: AppStoreKind) => Promise<AppInfo> = async (store) =>
    store === 'google_play' ? googleListing : appleListing,
) {
  return {
    getAppInfo: vi.fn(async (input: { store: AppStoreKind }) => implementation(input.store)),
  };
}

async function trackedPhrase(phrase: string): Promise<void> {
  await getTestDb().insert(appKeywords).values({
    accountId, siteId, profileId, store: 'google_play', phrase,
    locationCode: 2840, languageCode: 'en',
  });
}

beforeAll(async () => {
  await startTestPostgres();
  googleListing = await fake.getAppInfo({
    store: 'google_play', appId: playAppId, locationCode: 2840, languageCode: 'en',
  });
  appleListing = await fake.getAppInfo({
    store: 'app_store', appId: appleAppId, locationCode: 2840, languageCode: 'en',
  });
});

afterAll(stopTestPostgres);

beforeEach(async () => {
  await truncateAllTables();
  mocked.siteFind.mockReset().mockReturnValue(chain({ _id: siteId, paused: false }));
  mocked.profileFind.mockReset().mockReturnValue(chain(profile()));
});

describe('app listing processor helpers', () => {
  it('maps store ids, normalization, registered targets, and retry classes', () => {
    const both = profile({ paired: true, appStoreId: appleAppId });
    expect(internals.appIdFor(both, 'google_play')).toBe(playAppId);
    expect(internals.appIdFor(both, 'app_store')).toBe(appleAppId);
    expect(internals.appIdFor(profile({ playPackageId: null }), 'google_play')).toBeNull();
    expect(internals.appIdFor(profile({ appStoreId: null }), 'app_store')).toBeNull();
    expect(internals.normalizeAppId('google_play', ' COM.Example.APP ')).toBe('com.example.app');
    expect(internals.normalizeAppId('app_store', ' 123ABC ')).toBe('123ABC');
    expect(internals.registeredStoreTargets(both)).toEqual([
      { store: 'google_play', appId: playAppId },
      { store: 'app_store', appId: appleAppId },
    ]);
    expect(internals.registeredStoreTargets(profile({ playPackageId: null, appStoreId: null }))).toEqual([]);
    expect(internals.failureIsRetryable(new UnrecoverableError('permanent'))).toBe(false);
    expect(internals.failureIsRetryable(new ProviderError('retry', true, { provider: 'fixture', operation: 'info' }))).toBe(true);
    expect(internals.failureIsRetryable(new ProviderError('stop', false, { provider: 'fixture', operation: 'info' }))).toBe(false);
    expect(internals.failureIsRetryable(new Error('unexpected'))).toBe(true);
    const permanent = new UnrecoverableError('permanent');
    expect(internals.permanentFailure(permanent)).toBe(permanent);
    expect(internals.permanentFailure(new ProviderError('stop', false, {
      provider: 'fixture', operation: 'contract-operation',
    })).message).toContain('contract-operation');
    expect(internals.permanentFailure(new Error('unexpected')).message).toContain('app-data-info');
  });
});

describe('app listing processing', () => {
  it('rejects malformed queue data before touching storage', async () => {
    const process = createAppListingProcessor({ db: getTestDb(), provider: provider() });
    await expect(process(job({ unsafe: true }))).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('skips deleted and paused sites', async () => {
    const process = createAppListingProcessor({ db: getTestDb(), provider: provider() });
    mocked.siteFind.mockReturnValueOnce(chain(null));
    await expect(process(job())).resolves.toMatchObject({ status: 'skipped', storedStores: [], failedStores: [] });
    mocked.siteFind.mockReturnValueOnce(chain({ _id: siteId, paused: true }));
    await expect(process(job(payload({ runId: randomUUID() })))).resolves.toMatchObject({ status: 'skipped' });
  });

  it('fails permanently when the owned profile disappears or has no registered store', async () => {
    const process = createAppListingProcessor({ db: getTestDb(), provider: provider() });
    mocked.profileFind.mockReturnValueOnce(chain(null));
    await expect(process(job())).rejects.toThrow('profile not found');
    mocked.profileFind.mockReturnValueOnce(chain(profile({ playPackageId: null, appStoreId: null })));
    await expect(process(job(payload({ runId: randomUUID() })))).rejects.toThrow('no registered stores');
  });

  it('stores a normalized listing, sorted tracked phrases, and archive evidence', async () => {
    await trackedPhrase(' zebra ');
    await trackedPhrase('alpha');
    await trackedPhrase('alpha ');
    await trackedPhrase('   ');
    const archive = vi.fn().mockResolvedValue(undefined);
    const api = provider();
    const process = createAppListingProcessor({
      db: getTestDb(), provider: api, archive, now: () => new Date(capturedAt),
    });
    const result = await process(job());
    expect(result).toMatchObject({ status: 'stored', storedStores: ['google_play'], failedStores: [] });
    expect(api.getAppInfo).toHaveBeenCalledWith(expect.objectContaining({
      store: 'google_play', appId: playAppId, locationCode: 2840, languageCode: 'en',
    }));
    expect(archive).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'keyword', operation: 'app-data-info', accountId, siteId,
      fetchedAt: new Date(capturedAt),
    }));
    const rows = await getTestDb().select().from(appListingSnapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId, siteId, profileId, store: 'google_play' });
    expect(rows[0]?.findings).toMatchObject({ engineVersion: expect.any(String) });
  });

  it('reuses stored evidence, validates its scope, and reports already_stored', async () => {
    const api = provider();
    const process = createAppListingProcessor({ db: getTestDb(), provider: api });
    await process(job());
    api.getAppInfo.mockClear();
    await expect(process(job())).resolves.toMatchObject({ status: 'already_stored', storedStores: ['google_play'] });
    expect(api.getAppInfo).not.toHaveBeenCalled();

    await getTestDb().update(appListingSnapshots).set({ listing: appleListing });
    await expect(process(job())).rejects.toThrow('stored app listing scope');
  });

  it('keeps paired-store partial evidence for non-retryable provider failure', async () => {
    mocked.profileFind.mockReturnValue(chain(profile({ paired: true, appStoreId: appleAppId })));
    const nonRetryable = new ProviderError('apple malformed', false, {
      provider: 'fixture', operation: 'apple-info',
    });
    const process = createAppListingProcessor({
      db: getTestDb(),
      provider: provider(async (store) => {
        if (store === 'app_store') throw nonRetryable;
        return googleListing;
      }),
    });
    await expect(process(job())).resolves.toMatchObject({
      status: 'partial', storedStores: ['google_play'], failedStores: ['app_store'],
    });
    expect(await getTestDb().select().from(appListingSnapshots)).toHaveLength(1);
  });

  it('throws retryable failures after retaining successful paired-store evidence', async () => {
    mocked.profileFind.mockReturnValue(chain(profile({ paired: true, appStoreId: appleAppId })));
    const retryable = new ProviderError('google timeout', true, {
      provider: 'fixture', operation: 'google-info',
    });
    const process = createAppListingProcessor({
      db: getTestDb(),
      provider: provider(async (store) => {
        if (store === 'google_play') throw retryable;
        return appleListing;
      }),
    });
    await expect(process(job())).rejects.toBe(retryable);
    expect(await getTestDb().select().from(appListingSnapshots)).toHaveLength(1);
  });

  it('fails zero-evidence permanent failures and preserves provider operation labels', async () => {
    const providerFailure = new ProviderError('malformed', false, {
      provider: 'fixture', operation: 'app-info-contract',
    });
    let process = createAppListingProcessor({
      db: getTestDb(), provider: provider(async () => { throw providerFailure; }),
    });
    await expect(process(job())).rejects.toThrow('app-info-contract');

    process = createAppListingProcessor({
      db: getTestDb(),
      provider: provider(async () => ({ ...googleListing, appId: 'com.wrong.app' })),
    });
    await expect(process(job(payload({ runId: randomUUID() })))).rejects.toThrow('wrong store identity');
  });

  it('rejects provider store drift and propagates unexpected retryable errors', async () => {
    let process = createAppListingProcessor({
      db: getTestDb(),
      provider: provider(async () => ({ ...googleListing, store: 'app_store', appId: playAppId })),
    });
    await expect(process(job())).rejects.toThrow('wrong store identity');

    const unexpected = new Error('network stack failed');
    process = createAppListingProcessor({
      db: getTestDb(), provider: provider(async () => { throw unexpected; }),
    });
    await expect(process(job(payload({ runId: randomUUID() })))).rejects.toBe(unexpected);
  });

  it('uses the wall clock when archiving without an injected clock', async () => {
    const archive = vi.fn().mockResolvedValue(undefined);
    const process = createAppListingProcessor({ db: getTestDb(), provider: provider(), archive });
    await process(job());
    expect(archive).toHaveBeenCalledWith(expect.objectContaining({ fetchedAt: expect.any(Date) }));
  });

  it('processes an App Store-only profile without inventing a Play identifier', async () => {
    mocked.profileFind.mockReturnValue(chain(profile({
      playPackageId: null,
      appStoreId: appleAppId,
    })));
    const process = createAppListingProcessor({ db: getTestDb(), provider: provider() });
    await expect(process(job())).resolves.toMatchObject({
      status: 'stored', storedStores: ['app_store'],
    });
  });
});
