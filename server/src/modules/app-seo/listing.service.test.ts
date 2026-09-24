import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { appListingSnapshots } from '../../db/schema/index.js';
import { SUPPORTED_LOCALES } from '../../shared/i18n/index.js';
import type { AppInfo, AppStoreKind } from '../../shared/providers/index.js';
import { createFakeAppDataProvider } from '../../shared/providers/fakes.js';
import { enqueueAppSeoListingJob } from '../../shared/queue/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { loadOwnedSite } from '../sites/sites.guard.js';
import { getAppSeoTrackingQueue } from './keywords.queue-holder.js';
import { APP_LISTING_ENGINE_VERSION, type ListingEngineOutput } from './listing-rules/index.js';

const mocked = vi.hoisted(() => ({
  enqueue: vi.fn(),
  getQueue: vi.fn(),
  loadSite: vi.fn(),
  profileFind: vi.fn(),
}));

vi.mock('../sites/sites.guard.js', () => ({ loadOwnedSite: mocked.loadSite }));
vi.mock('./app-profile.model.js', () => ({ AppProfile: { findOne: mocked.profileFind } }));
vi.mock('../../shared/queue/index.js', () => ({ enqueueAppSeoListingJob: mocked.enqueue }));
vi.mock('./keywords.queue-holder.js', () => ({ getAppSeoTrackingQueue: mocked.getQueue }));

import {
  appListingServiceTestables as internals,
  createAppListingRun,
  localizeAppListingFinding,
  previewAppListingRun,
  readAppListingHistory,
  readLatestAppListing,
} from './listing.service.js';

const accountId = 'listing-service-account';
const siteId = '507f1f77bcf86cd799439011';
const profileId = '507f1f77bcf86cd799439012';
const playAppId = 'com.example.rankme';
const appleAppId = '123456789';
const CAPTURED = new Date('2026-08-10T12:00:00.000Z');
const EARLIER = new Date('2026-08-03T12:00:00.000Z');
const OLDEST = new Date('2026-07-27T12:00:00.000Z');
const queue = { name: 'app-listing-service-fixture' };
const fake = createFakeAppDataProvider();

describe('listing copy boundary', () => {
  const finding = {
    id: 'title-too-long', scope: 'google_play', status: 'finding', severity: 'fixNow',
    copyKey: 'appSeo.listing.findings.title-too-long', params: { limit: 30 },
    provenance: 'store-observation',
  } as const;

  it('rejects keys outside the listing namespace and unknown keys inside it', () => {
    expect(() => localizeAppListingFinding('en', {
      ...finding,
      copyKey: 'operator.untrusted',
    })).toThrow('Stored app listing copy key is invalid');
    expect(() => localizeAppListingFinding('en', {
      ...finding,
      copyKey: 'appSeo.listing.findings.not-a-real-finding',
    })).toThrow('Stored app listing copy key is invalid');
  });
});

let googleListing: AppInfo;
let appleListing: AppInfo;

function database(): ApplicationDb {
  return getTestDb();
}

function profile(input: { missing?: boolean } = {}) {
  return input.missing ? null : {
    _id: profileId,
    playPackageId: playAppId,
    appStoreId: appleAppId,
  };
}

function engineOutput(input: { partial?: boolean } = {}): ListingEngineOutput {
  return {
    engineVersion: APP_LISTING_ENGINE_VERSION,
    findings: [
      {
        id: 'title-too-long', scope: 'google_play', status: 'finding', severity: 'fixNow',
        copyKey: 'appSeo.listing.findings.title-too-long', params: { limit: 30 }, provenance: 'store-observation',
      },
      {
        id: 'rating-low', scope: 'google_play', status: 'finding', severity: 'watch',
        copyKey: 'appSeo.listing.findings.rating-low', params: { minimum: 4 }, provenance: 'store-observation',
      },
      {
        id: 'screenshots-few', scope: 'app_store', status: 'finding', severity: 'advisory',
        copyKey: 'appSeo.listing.findings.screenshots-few', params: {}, provenance: 'store-observation',
      },
      {
        id: 'stores-diverge', scope: 'parity', status: 'passed', severity: 'advisory',
        copyKey: 'appSeo.listing.findings.stores-diverge', params: {}, provenance: 'user-paired',
      },
    ],
    notObserved: input.partial
      ? [{ store: 'app_store', field: 'listing', copyKey: 'appSeo.listing.notObserved.storeFailed' }]
      : [{ store: 'app_store', field: 'subtitle', copyKey: 'appSeo.listing.notObserved.subtitle' }],
  };
}

async function insertSnapshot(input: {
  capturedAt: Date;
  store?: AppStoreKind;
  output?: ListingEngineOutput;
  listing?: AppInfo;
}): Promise<void> {
  const store = input.store ?? 'google_play';
  const listing = input.listing ?? (store === 'google_play' ? googleListing : appleListing);
  await getTestDb().insert(appListingSnapshots).values({
    accountId,
    siteId,
    profileId,
    store,
    capturedAt: input.capturedAt,
    listing,
    findings: input.output ?? engineOutput(),
    observationMeta: listing.observationMeta,
  });
}

function createInput(confirm = true) {
  return {
    accountId,
    siteId,
    run: {
      profileId,
      locationCode: 2840,
      languageCode: 'EN',
      confirm,
    },
  };
}

const originalFlags = {
  appSeo: env.APP_SEO_ENABLED,
  listing: env.APP_LISTING_AUDITS_ENABLED,
};

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
  env.APP_SEO_ENABLED = true;
  env.APP_LISTING_AUDITS_ENABLED = true;
  mocked.enqueue.mockReset().mockResolvedValue(undefined);
  mocked.getQueue.mockReset().mockReturnValue(queue);
  mocked.loadSite.mockReset().mockResolvedValue({ id: siteId });
  mocked.profileFind.mockReset().mockResolvedValue(profile());
});

afterEach(() => {
  env.APP_SEO_ENABLED = originalFlags.appSeo;
  env.APP_LISTING_AUDITS_ENABLED = originalFlags.listing;
  vi.restoreAllMocks();
});

describe('app listing gates, ownership, and preview', () => {
  it('evaluates both rollout flags and refuses spend while either is disabled', () => {
    expect(internals.listingAuditsEnabled()).toBe(true);
    expect(() => internals.requireListingAuditsEnabled()).not.toThrow();
    env.APP_SEO_ENABLED = false;
    expect(internals.listingAuditsEnabled()).toBe(false);
    expect(() => internals.requireListingAuditsEnabled()).toThrow();
    env.APP_SEO_ENABLED = true;
    env.APP_LISTING_AUDITS_ENABLED = false;
    expect(internals.listingAuditsEnabled()).toBe(false);
    expect(() => internals.requireListingAuditsEnabled()).toThrow();
  });

  it('fails closed for invalid and absent owned profiles and preserves pause policy', async () => {
    await expect(internals.requireOwnedProfile({
      accountId, siteId, profileId: 'invalid', allowPaused: false,
    })).rejects.toMatchObject({ status: 404 });
    mocked.profileFind.mockResolvedValueOnce(profile({ missing: true }));
    await expect(internals.requireOwnedProfile({
      accountId, siteId, profileId, allowPaused: true,
    })).rejects.toMatchObject({ status: 404 });
    await expect(internals.requireOwnedProfile({
      accountId, siteId, profileId, allowPaused: false,
    })).resolves.toMatchObject({ _id: profileId });
    expect(loadOwnedSite).toHaveBeenLastCalledWith(accountId, siteId, { allowPaused: false });
  });

  it('returns the community spend preview', () => {
    expect(previewAppListingRun()).toEqual({
      deploymentMode: 'community', capacityEnforced: false,
    });
  });
});

describe('app listing run creation', () => {
  it('previews without queue work until confirmation', async () => {
    await expect(createAppListingRun(createInput(false))).resolves.toEqual({
      preview: { deploymentMode: 'community', capacityEnforced: false },
      queued: false,
      runId: null,
      capturedAt: null,
    });
    expect(getAppSeoTrackingQueue).not.toHaveBeenCalled();
    expect(loadOwnedSite).toHaveBeenLastCalledWith(accountId, siteId, { allowPaused: false });
  });

  it('refuses confirmation while the rollout flag is off or the worker queue is unavailable', async () => {
    env.APP_LISTING_AUDITS_ENABLED = false;
    await expect(createAppListingRun(createInput())).rejects.toMatchObject({ status: 503 });
    env.APP_LISTING_AUDITS_ENABLED = true;
    mocked.getQueue.mockReturnValueOnce(null);
    await expect(createAppListingRun(createInput())).rejects.toMatchObject({ status: 503 });
    expect(enqueueAppSeoListingJob).not.toHaveBeenCalled();
  });

  it('queues one normalized multi-store run', async () => {
    const result = await createAppListingRun(createInput());
    expect(result).toMatchObject({ queued: true, runId: expect.any(String), capturedAt: expect.any(String) });
    expect(result.runId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(new Date(result.capturedAt!).toISOString()).toBe(result.capturedAt);
    expect(mocked.enqueue).toHaveBeenCalledWith(queue, {
      accountId,
      siteId,
      profileId,
      runId: result.runId,
      capturedAt: result.capturedAt,
      locationCode: 2840,
      languageCode: 'en',
    });
  });

  it('propagates enqueue failures', async () => {
    const failure = new Error('redis unavailable');
    mocked.enqueue.mockRejectedValueOnce(failure);
    await expect(createAppListingRun(createInput())).rejects.toBe(failure);
  });
});

describe('app listing latest report', () => {
  it('returns an honest empty state without a second snapshot query', async () => {
    await expect(readLatestAppListing({ accountId, siteId, profileId }, database()))
      .resolves.toEqual({ report: null, listingEnabled: true });
  });

  it('joins paired store rows at one captured instant into a canonical report', async () => {
    await insertSnapshot({ capturedAt: CAPTURED, store: 'google_play' });
    await insertSnapshot({ capturedAt: CAPTURED, store: 'app_store' });
    await insertSnapshot({ capturedAt: EARLIER, store: 'google_play' });
    const result = await readLatestAppListing({ accountId, siteId, profileId }, database());
    expect(result.report).toMatchObject({
      capturedAt: CAPTURED.toISOString(),
      engineVersion: APP_LISTING_ENGINE_VERSION,
      stores: {
        google_play: { store: 'google_play', listing: { store: 'google_play' }, observationMeta: googleListing.observationMeta },
        app_store: { store: 'app_store', listing: { store: 'app_store' }, observationMeta: appleListing.observationMeta },
      },
    });
  });

  it('re-renders the same evidence in every locale without queue work', async () => {
    await insertSnapshot({ capturedAt: CAPTURED, store: 'google_play' });
    const reports = [];
    for (const locale of SUPPORTED_LOCALES) {
      const result = await readLatestAppListing({ accountId, siteId, profileId, locale }, database());
      reports.push(result.report!);
    }

    const [english, arabic] = [reports[0]!, reports[1]!];
    for (const report of reports) {
      expect(report.findings.map(({ id, scope, status, severity, params, provenance }) => ({
        id, scope, status, severity, params, provenance,
      }))).toEqual(english.findings.map(({ id, scope, status, severity, params, provenance }) => ({
        id, scope, status, severity, params, provenance,
      })));
      expect(report.findings).not.toContainEqual(expect.objectContaining({ title: expect.stringContaining('{{') }));
      expect(report.findings).not.toContainEqual(expect.objectContaining({ title: expect.stringMatching(/^appSeo\./u) }));
    }
    expect(arabic.findings[0]?.title).not.toBe(english.findings[0]?.title);
    expect(arabic.findings[0]?.title).toMatch(/[\u0600-\u06ff]/u);
    expect(enqueueAppSeoListingJob).not.toHaveBeenCalled();
  });

  it('rejects a stored listing whose payload crosses its relational store scope', async () => {
    await insertSnapshot({ capturedAt: CAPTURED, store: 'google_play', listing: appleListing });
    await expect(readLatestAppListing({ accountId, siteId, profileId }, database()))
      .rejects.toThrow('does not match its store scope');
  });
});

describe('app listing history', () => {
  it('groups paired stores, counts only findings, exposes partial runs, sorts stores, and honors the run limit', async () => {
    await insertSnapshot({ capturedAt: CAPTURED, store: 'app_store', output: engineOutput({ partial: true }) });
    await insertSnapshot({ capturedAt: CAPTURED, store: 'google_play', output: engineOutput({ partial: true }) });
    await insertSnapshot({ capturedAt: EARLIER, output: engineOutput() });
    await insertSnapshot({ capturedAt: OLDEST, output: engineOutput() });
    const result = await readAppListingHistory({
      accountId, siteId, profileId, limit: 2,
    }, database());
    expect(result).toEqual({ listingEnabled: true, items: expect.any(Array) });
    expect(result.items).toEqual([
      {
        capturedAt: CAPTURED.toISOString(),
        engineVersion: APP_LISTING_ENGINE_VERSION,
        stores: ['app_store', 'google_play'],
        partial: true,
        findingCounts: { fixNow: 1, watch: 1, advisory: 1 },
      },
      {
        capturedAt: EARLIER.toISOString(),
        engineVersion: APP_LISTING_ENGINE_VERSION,
        stores: ['google_play'],
        partial: false,
        findingCounts: { fixNow: 1, watch: 1, advisory: 1 },
      },
    ]);
  });

  it('returns an empty history and read-only rollout state while spend is disabled', async () => {
    env.APP_SEO_ENABLED = false;
    const result = await readAppListingHistory({
      accountId, siteId, profileId, limit: 3,
    }, database());
    expect(result.items).toEqual([]);
    expect(result.listingEnabled).toBe(false);
  });
});
