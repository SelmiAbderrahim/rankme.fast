/**
 * Bing / YouTube / Amazon rank tracking.
 *
 * Covers the API layer (engine validation, flag gate, cross-account
 * isolation, community spend preview) and the processor (engine-tagged rows,
 * token matching, cache sharing, weekly cadence, provider failures,
 * flag-off) — plus the regression that proves the Google path is unchanged.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { pino } from 'pino';
import { createHash } from 'node:crypto';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
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
  type TestUser,
} from '../../shared/testing/auth.js';
import { Site } from '../sites/index.js';
import {
  keywords as keywordsTable,
  rankings as rankingsTable,
} from '../../db/schema/keywords.js';
import { vendorCache } from '../../db/schema/vendor-cache.js';
import { setRanksDb, setRanksQueue } from './ranks.queue-holder.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';
import { env } from '../../config/env.js';
import {
  createPostgresRankTargetsResolver,
  createRankProcessor,
} from './rank.processor.js';
import {
  computeSerpCacheKey,
  createSerpCacheRepo,
  serpCacheOperation,
  type SerpCacheRepo,
} from './serp-cache.service.js';
import {
  VendorQuotaError,
  VendorMalformedError,
  createFakeRankProvider,
  type AltEngineRankResult,
  type RankProvider,
} from '../../shared/providers/index.js';
import { normalizeEngineTarget } from './keywords.schema.js';
import type { RankDropHandler } from './rank-drop.service.js';
import { getKeywordHistory, listKeywords } from './keywords.service.js';

const app = createApp();
const logger = pino({ level: 'silent' });

async function seedUser(email = 'alt-engines@x.co'): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function seedSite(accountId: string, domain = 'example.com') {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
  });
  return site.id as string;
}

const fakeQueue = () => ({
  upsertJobScheduler: vi.fn(async () => undefined),
  removeJobScheduler: vi.fn(async () => true),
  add: vi.fn(async () => ({ id: 'manual-rank-job' })),
});

function jobFor(data: unknown): Job {
  return { data, attemptsMade: 0, opts: { attempts: 3 } } as unknown as Job;
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setRanksDb(db as unknown as never);
});
afterAll(async () => {
  uninstallTestAuth();
  setRanksDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setRanksQueue(null);
  (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED = true;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// API layer
// ---------------------------------------------------------------------------

describe('POST /api/sites/:siteId/keywords — engine picker', () => {
  it('adds a Bing keyword and stores no match token', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    setRanksQueue(fakeQueue() as never);

    const res = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send({ phrase: 'seo audit tool', locationCode: 2840, languageCode: 'en', engine: 'bing' });

    expect(res.status).toBe(201);
    expect(res.body.keyword.engine).toBe('bing');
    expect(res.body.keyword.engineTarget).toBeNull();
  });

  it('normalizes a YouTube handle and an Amazon ASIN before storing', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    setRanksQueue(fakeQueue() as never);

    const youtube = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send({
        phrase: 'seo audit tutorial',
        locationCode: 2840,
        languageCode: 'en',
        engine: 'youtube',
        engineTarget: '@AcmeChannel',
      });
    expect(youtube.status).toBe(201);
    expect(youtube.body.keyword.engineTarget).toBe('acmechannel');

    const amazon = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send({
        phrase: 'seo audit book',
        locationCode: 2840,
        languageCode: 'en',
        engine: 'amazon',
        engineTarget: 'b0tracked1',
      });
    expect(amazon.status).toBe(201);
    expect(amazon.body.keyword.engineTarget).toBe('B0TRACKED1');
  });

  it('tracks the same phrase on Google and Bing simultaneously', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    setRanksQueue(fakeQueue() as never);

    for (const engine of ['google', 'bing'] as const) {
      const res = await request(app)
        .post(`/api/sites/${siteId}/keywords`)
        .set('Cookie', user.cookie)
        .send({ phrase: 'seo audit tool', locationCode: 2840, languageCode: 'en', engine });
      expect(res.status).toBe(201);
    }
    const rows = await getTestDb()
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.siteId, siteId));
    expect(rows.map((r) => r.engine).sort()).toEqual(['bing', 'google']);
  });

  it.each([
    [
      { engine: 'youtube' },
      'ranks.errors.engineTargetRequired',
    ],
    [
      { engine: 'youtube', engineTarget: 'no' },
      'ranks.errors.youtubeHandleInvalid',
    ],
    [
      { engine: 'amazon', engineTarget: 'TOOSHORT' },
      'ranks.errors.amazonAsinInvalid',
    ],
    [
      { engine: 'google', engineTarget: 'acmechannel' },
      'ranks.errors.engineTargetNotAllowed',
    ],
  ])('rejects %j with a localized validation error', async (body, key) => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);

    const res = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send({ phrase: 'seo audit tool', locationCode: 2840, languageCode: 'en', ...body });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(key);
  });

  it('blocks NEW non-Google keywords when the flag is off but keeps Google and stored reads', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    setRanksQueue(fakeQueue() as never);

    const seeded = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send({ phrase: 'stored bing phrase', locationCode: 2840, languageCode: 'en', engine: 'bing' });
    expect(seeded.status).toBe(201);

    (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED = false;

    const blocked = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send({ phrase: 'new bing phrase', locationCode: 2840, languageCode: 'en', engine: 'bing' });
    expect(blocked.status).toBe(404);
    expect(blocked.body.error.message).toBe(DICTIONARIES.en.ranks.errors.altEnginesUnavailable);

    const google = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send({ phrase: 'google phrase', locationCode: 2840, languageCode: 'en' });
    expect(google.status).toBe(201);

    const listed = await request(app)
      .get(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.keywords.map((k: { engine: string }) => k.engine).sort()).toEqual([
      'bing',
      'google',
    ]);
  });

  it('returns 404 — never 403 — for a foreign site', async () => {
    const owner = await seedUser('owner-alt@x.co');
    const stranger = await seedUser('stranger-alt@x.co');
    const siteId = await seedSite(owner.id);

    const res = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', stranger.cookie)
      .send({ phrase: 'seo audit tool', locationCode: 2840, languageCode: 'en', engine: 'bing' });
    expect(res.status).toBe(404);

    const preview = await request(app)
      .post(`/api/sites/${siteId}/keywords/preview`)
      .set('Cookie', stranger.cookie)
      .send({ engine: 'bing' });
    expect(preview.status).toBe(404);
  });
});

describe('POST /api/sites/:siteId/keywords/preview', () => {
  it('returns the community preview for an alt-engine keyword without reserving', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const q = fakeQueue();
    setRanksQueue(q as never);

    const res = await request(app)
      .post(`/api/sites/${siteId}/keywords/preview`)
      .set('Cookie', user.cookie)
      .send({ engine: 'youtube' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deploymentMode: 'community', capacityEnforced: false });
    expect(q.add).not.toHaveBeenCalled();
    expect(await getTestDb().select().from(keywordsTable)).toEqual([]);
  });

  it('refuses a preview for a disabled engine but still previews Google', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED = false;

    const blocked = await request(app)
      .post(`/api/sites/${siteId}/keywords/preview`)
      .set('Cookie', user.cookie)
      .send({ engine: 'bing' });
    expect(blocked.status).toBe(404);

    const google = await request(app)
      .post(`/api/sites/${siteId}/keywords/preview`)
      .set('Cookie', user.cookie)
      .send({ engine: 'google' });
    expect(google.status).toBe(200);
    expect(google.body).toEqual({ deploymentMode: 'community', capacityEnforced: false });
  });
});

describe('normalizeEngineTarget', () => {
  it.each([
    ['youtube', '@AcmeChannel', 'acmechannel'],
    ['amazon', ' b0tracked1 ', 'B0TRACKED1'],
    ['bing', 'ignored', null],
    ['google', undefined, null],
    ['youtube', undefined, null],
  ] as const)('normalizes (%s, %s)', (engine, raw, expected) => {
    expect(normalizeEngineTarget(engine, raw)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

describe('rank processor — alt engines', () => {
  async function seedProcessorSite(domain = 'example.com') {
    const accountId = new mongoose.Types.ObjectId();
    const site = await Site.create({
      accountId,
      url: `https://${domain}`,
      domain,
    });
    return { accountId: accountId.toHexString(), siteId: site.id as string };
  }

  function payloadFor(ids: { accountId: string; siteId: string }, manual = false) {
    return { ...ids, keywordIds: [], schedulerKey: 'manual', ...(manual ? { manual } : {}) };
  }

  async function seedKeyword(
    ids: { accountId: string; siteId: string },
    overrides: Partial<typeof keywordsTable.$inferInsert> = {},
  ) {
    const rows = await getTestDb()
      .insert(keywordsTable)
      .values({
        accountId: ids.accountId,
        siteId: ids.siteId,
        phrase: 'seo audit tool',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
        ...overrides,
      })
      .returning();
    return rows[0]!;
  }

  function makeProcessor(
    ids: { accountId: string; siteId: string },
    provider: RankProvider = createFakeRankProvider(),
    opts: { withCache?: boolean; withDb?: boolean; clock?: () => Date } = {},
  ) {
    const db = getTestDb() as unknown as never;
    void ids;
    return createRankProcessor({
      provider,
      ...(opts.withDb === false ? {} : { db }),
      ...(opts.withCache === false
        ? {}
        : { cache: createSerpCacheRepo({ db, ttlHours: 24 }) }),
      resolveTargets: createPostgresRankTargetsResolver(db),
      logger,
      ...(opts.clock ? { clock: opts.clock } : {}),
    });
  }

  it('runs ONE alt-engine check and writes an engine-tagged row', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, { engine: 'bing' });
    const provider = createFakeRankProvider();
    const altSpy = vi.spyOn(provider, 'checkAltEngineRank');
    const googleSpy = vi.spyOn(provider, 'checkRank');

    const outcome = await makeProcessor(ids, provider)(jobFor(payloadFor(ids)));

    expect(altSpy).toHaveBeenCalledTimes(1);
    expect(googleSpy).not.toHaveBeenCalled();
    expect(outcome.checked).toBe(1);
    const [row] = await getTestDb()
      .select()
      .from(rankingsTable)
      .where(eq(rankingsTable.keywordId, keyword.id));
    expect(row?.engine).toBe('bing');
    // The fake places the tracked domain third on Bing.
    expect(row?.position).toBe(3);
  });

  it('matches YouTube and Amazon on the stored token, not on the host', async () => {
    const ids = await seedProcessorSite();
    const youtube = await seedKeyword(ids, {
      phrase: 'yt phrase',
      engine: 'youtube',
      engineTarget: 'acmechannel',
    });
    const amazon = await seedKeyword(ids, {
      phrase: 'az phrase',
      engine: 'amazon',
      engineTarget: 'B0TRACKED1',
    });

    await makeProcessor(ids)(jobFor(payloadFor(ids)));

    const rows = await getTestDb().select().from(rankingsTable);
    const byKeyword = new Map(rows.map((r) => [r.keywordId, r]));
    expect(byKeyword.get(youtube.id)?.position).toBe(2);
    expect(byKeyword.get(youtube.id)?.engine).toBe('youtube');
    expect(byKeyword.get(amazon.id)?.position).toBe(5);
    expect(byKeyword.get(amazon.id)?.engine).toBe('amazon');
    expect(byKeyword.get(amazon.id)?.observationMeta).toMatchObject({
      sourceKind: 'provider_observation',
      sourceLabel: 'dataforseo',
      coverageNoteKey: 'observations.coverage.providerIndexRanking',
    });
    expect(byKeyword.get(amazon.id)?.observationMeta?.sampleCount).toBeGreaterThan(0);
    const list = await listKeywords(
      { accountId: ids.accountId, siteId: ids.siteId, limit: 20 },
      { db: getTestDb() as never, ranksQueue: null },
    );
    expect(list.keywords.find((row) => row.id === amazon.id)?.observationMeta).toMatchObject({
      sourceLabel: 'dataforseo',
      coverageNoteKey: 'observations.coverage.providerIndexRanking',
    });
    const history = await getKeywordHistory(
      {
        accountId: ids.accountId,
        keywordId: amazon.id,
        from: '2025-01-01T00:00:00.000Z',
      },
      { db: getTestDb() as never, ranksQueue: null },
    );
    expect(history.series[0]?.observationMeta).toMatchObject({
      sourceLabel: 'dataforseo',
      coverageNoteKey: 'observations.coverage.providerIndexRanking',
    });
  });

  it('records a checked-but-not-found alt result as a null position', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, { phrase: 'unranked phrase', engine: 'bing' });

    await makeProcessor(ids)(jobFor(payloadFor(ids)));

    const [row] = await getTestDb()
      .select()
      .from(rankingsTable)
      .where(eq(rankingsTable.keywordId, keyword.id));
    expect(row).toBeDefined();
    expect(row?.position).toBeNull();
  });

  it('serves a cross-account cache hit and stores it under its own engine slot', async () => {
    // The alt-engine SERP cache is cross-USER, exactly like Google's: two
    // accounts tracking the same phrase in the same week share one recorded
    // SERP. (The same account cannot hit its own row twice in a week — the
    // weekly replay filter suppresses the second check entirely.)
    const first = await seedProcessorSite();
    const second = await seedProcessorSite();
    await seedKeyword(first, { engine: 'bing' });
    await seedKeyword(second, { engine: 'bing' });
    const provider = createFakeRankProvider();
    const spy = vi.spyOn(provider, 'checkAltEngineRank');

    await makeProcessor(first, provider)(jobFor(payloadFor(first)));
    await makeProcessor(second, provider)(jobFor(payloadFor(second)));

    expect(spy).toHaveBeenCalledTimes(1);

    const cacheRows = await getTestDb().select().from(vendorCache);
    expect(cacheRows.map((r) => r.operation)).toEqual([serpCacheOperation('bing')]);
    expect(cacheRows[0]?.operation).toBe('serp-bing');
    // Both accounts got a stored row from the one recorded SERP.
    expect(await getTestDb().select().from(rankingsTable)).toHaveLength(2);
  });

  it('concurrent token targets share rows but derive distinct positions after joining', async () => {
    const first = await seedProcessorSite('one.example');
    const second = await seedProcessorSite('two.example');
    const firstKeyword = await seedKeyword(first, {
      phrase: 'shared video phrase',
      engine: 'youtube',
      engineTarget: 'channel-one',
    });
    const secondKeyword = await seedKeyword(second, {
      phrase: 'shared video phrase',
      engine: 'youtube',
      engineTarget: 'channel-two',
    });
    const observedAt = new Date('2026-01-05T00:00:00.000Z');
    const altEngineResult: AltEngineRankResult = {
      engine: 'youtube',
      position: 2,
      foundUrl: 'https://www.youtube.com/watch?v=one',
      rows: [
        {
          domain: 'youtube.com',
          url: 'https://www.youtube.com/watch?v=one',
          rankGroup: 2,
          rankAbsolute: 2,
          matchToken: 'channel-one',
        },
        {
          domain: 'youtube.com',
          url: 'https://www.youtube.com/watch?v=two',
          rankGroup: 6,
          rankAbsolute: 6,
          matchToken: 'channel-two',
        },
      ],
      checkedAt: observedAt,
      observationMeta: {
        sourceKind: 'provider_observation',
        sourceLabel: 'dataforseo',
        observedAt: observedAt.toISOString(),
        freshUntil: '2026-01-12T00:00:00.000Z',
        freshness: 'fresh',
        market: null,
        sampleCount: 2,
        coverageNoteKey: 'observations.coverage.providerIndexRanking',
      },
    };
    const provider = createFakeRankProvider({ altEngineResult });
    const originalCheck = provider.checkAltEngineRank.bind(provider);
    const check = vi.spyOn(provider, 'checkAltEngineRank');
    check.mockImplementation(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return originalCheck(input);
    });
    const db = getTestDb() as unknown as never;
    const processor = createRankProcessor({
      provider,
      db,
      cache: createSerpCacheRepo({ db, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db),
      logger,
      clock: () => observedAt,
    });

    const [firstOutcome, secondOutcome] = await Promise.all([
      processor(jobFor(payloadFor(first))),
      processor(jobFor(payloadFor(second))),
    ]);

    expect(check).toHaveBeenCalledTimes(1);
    expect([firstOutcome.fromFresh, secondOutcome.fromFresh].sort()).toEqual([0, 1]);
    expect([firstOutcome.fromCache, secondOutcome.fromCache].sort()).toEqual([0, 1]);
    const rows = await getTestDb().select().from(rankingsTable);
    const byKeyword = new Map(rows.map((row) => [row.keywordId, row]));
    expect(byKeyword.get(firstKeyword.id)).toMatchObject({
      position: 2,
      foundUrl: 'https://www.youtube.com/watch?v=one',
    });
    expect(byKeyword.get(secondKeyword.id)).toMatchObject({
      position: 6,
      foundUrl: 'https://www.youtube.com/watch?v=two',
    });
    expect(rows.map((row) => row.source).sort()).toEqual(['cache', 'fresh']);
  });

  it('accepts a legacy Bing cache row without observation provenance', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, { phrase: 'legacy cached phrase', engine: 'bing' });
    const db = getTestDb() as unknown as never;
    const cache = createSerpCacheRepo({ db, ttlHours: 24 });
    const checkedAt = new Date('2026-01-05T00:00:00.000Z');
    const cacheKey = computeSerpCacheKey({
      phrase: keyword.phrase,
      locationCode: keyword.locationCode,
      languageCode: keyword.languageCode,
      device: keyword.device,
      engine: 'bing',
    });
    await cache.write({
      cacheKey,
      topResults: [
        {
          domain: 'example.com',
          url: 'https://example.com/legacy',
          rankGroup: 4,
          rankAbsolute: 4,
        },
      ],
      aiOverview: null,
      fetchedAt: checkedAt,
      expiresAt: new Date('2026-01-06T00:00:00.000Z'),
      engine: 'bing',
    });
    const provider = createFakeRankProvider();
    const check = vi.spyOn(provider, 'checkAltEngineRank');

    const outcome = await makeProcessor(ids, provider, {
      clock: () => new Date('2026-01-05T12:00:00.000Z'),
    })(jobFor(payloadFor(ids)));

    expect(outcome).toMatchObject({ checked: 1, fromCache: 1 });
    expect(check).not.toHaveBeenCalled();
    const [row] = await getTestDb()
      .select()
      .from(rankingsTable)
      .where(eq(rankingsTable.keywordId, keyword.id));
    expect(row).toMatchObject({ source: 'cache', position: 4, observationMeta: null });
  });

  it('uses a cache row that appears after the outer alt-engine miss', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, {
      phrase: 'late alt cache fill',
      engine: 'bing',
    });
    const checkedAt = new Date('2026-01-05T00:00:00.000Z');
    const fetchedAt = new Date('2026-01-04T23:59:00.000Z');
    const read = vi
      .fn<SerpCacheRepo['read']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        topResults: [
          {
            domain: 'example.com',
            url: 'https://example.com/late-cache',
            rankGroup: 5,
            rankAbsolute: 5,
          },
        ],
        aiOverview: null,
        features: null,
        fetchedAt,
        expiresAt: new Date('2026-01-06T00:00:00.000Z'),
      });
    const cache: SerpCacheRepo = {
      read,
      write: vi.fn<SerpCacheRepo['write']>(),
      async withSingleFlightLock<T>(_key: string, task: () => Promise<T>): Promise<T> {
        return task();
      },
      async withSingleFlightLockLeaderAware<T>(
        _key: string,
        task: () => Promise<T>,
      ): Promise<{ value: T; joined: boolean }> {
        return { value: await task(), joined: false };
      },
    };
    const provider = createFakeRankProvider();
    const check = vi.spyOn(provider, 'checkAltEngineRank');
    const db = getTestDb() as unknown as never;
    const outcome = await createRankProcessor({
      provider,
      db,
      cache,
      resolveTargets: createPostgresRankTargetsResolver(db),
      logger,
      clock: () => checkedAt,
    })(jobFor(payloadFor(ids)));

    expect(outcome).toMatchObject({ checked: 1, fromCache: 1, fromFresh: 0 });
    expect(read).toHaveBeenCalledTimes(2);
    expect(check).not.toHaveBeenCalled();
    expect(cache.write).not.toHaveBeenCalled();
    const [row] = await getTestDb()
      .select()
      .from(rankingsTable)
      .where(eq(rankingsTable.keywordId, keyword.id));
    expect(row).toMatchObject({
      source: 'cache',
      position: 5,
      foundUrl: 'https://example.com/late-cache',
    });
  });

  it('preserves Amazon observation provenance through a cross-account cache hit', async () => {
    const first = await seedProcessorSite();
    const second = await seedProcessorSite();
    await seedKeyword(first, {
      phrase: 'shared amazon product',
      engine: 'amazon',
      engineTarget: 'B0TRACKED1',
    });
    await seedKeyword(second, {
      phrase: 'shared amazon product',
      engine: 'amazon',
      engineTarget: 'B0TRACKED1',
    });
    const provider = createFakeRankProvider();
    const spy = vi.spyOn(provider, 'checkAltEngineRank');

    await makeProcessor(first, provider)(jobFor(payloadFor(first)));
    await makeProcessor(second, provider)(jobFor(payloadFor(second)));

    expect(spy).toHaveBeenCalledTimes(1);
    const rows = await getTestDb().select().from(rankingsTable);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.source).sort()).toEqual(['cache', 'fresh']);
    for (const row of rows) {
      expect(row.observationMeta).toMatchObject({
        sourceLabel: 'dataforseo',
        coverageNoteKey: 'observations.coverage.providerIndexRanking',
      });
    }
  });

  it('keys the alt-engine cache apart from the identical Google phrase', () => {
    const base = {
      phrase: 'seo audit tool',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    };
    const google = computeSerpCacheKey(base);
    expect(computeSerpCacheKey({ ...base, engine: 'google' })).toBe(google);
    for (const engine of ['bing', 'youtube', 'amazon'] as const) {
      expect(computeSerpCacheKey({ ...base, engine })).not.toBe(google);
    }
    // Regression pin: the Google digest still equals sha256 over the EXACT
    // pre-spec-03 canonical string — no engine token, no separator change.
    const preSpec03 = createHash('sha256')
      .update('seo audit tool|2840|en|desktop')
      .digest('hex');
    expect(google).toBe(preSpec03);
  });

  it('records the failure and stores nothing when the provider fails', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, { engine: 'bing' });
    const provider = createFakeRankProvider();
    vi.spyOn(provider, 'checkAltEngineRank').mockRejectedValue(
      new VendorMalformedError('vendor drift', {
        provider: 'dataforseo',
        operation: 'alt-engine-bing-organic',
      }),
    );

    const outcome = await makeProcessor(ids, provider)(jobFor(payloadFor(ids)));

    expect(outcome.errors).toBe(1);
    expect(await getTestDb().select().from(rankingsTable)).toEqual([]);
    expect(await getTestDb().select().from(vendorCache)).toEqual([]);
    const [row] = await getTestDb()
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.id, keyword.id));
    expect(row?.lastFailedCheckAt).not.toBeNull();
  });

  it('rethrows a batch-wide provider failure so BullMQ retries', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, { engine: 'bing' });
    const provider = createFakeRankProvider();
    vi.spyOn(provider, 'checkAltEngineRank').mockRejectedValue(
      new VendorQuotaError('vendor quota', {
        provider: 'dataforseo',
        operation: 'alt-engine-bing-organic',
      }),
    );

    await expect(makeProcessor(ids, provider)(jobFor(payloadFor(ids)))).rejects.toBeInstanceOf(
      VendorQuotaError,
    );
    expect(await getTestDb().select().from(rankingsTable)).toEqual([]);
  });

  it('excludes alt work from a job accepted while the producer flag is off', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, { engine: 'bing' });
    (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED = false;
    const provider = createFakeRankProvider();
    const spy = vi.spyOn(provider, 'checkAltEngineRank');

    const outcome = await makeProcessor(ids, provider)(
      jobFor({ ...payloadFor(ids), altEnginesEnabledAtEnqueue: false }),
    );

    expect(spy).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ checked: 0, skipped: 0 });
    expect(await getTestDb().select().from(rankingsTable)).toEqual([]);
  });

  it('drains a legacy queued alt check after the runtime flag turns off', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, { engine: 'bing' });
    (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED = false;

    const outcome = await makeProcessor(ids)(jobFor(payloadFor(ids)));

    expect(outcome).toMatchObject({ checked: 1, skipped: 0 });
    expect(await getTestDb().select().from(rankingsTable)).toHaveLength(1);
  });

  it('serves a token-matched engine from cache and keeps an unmatched miss null', async () => {
    // Two accounts track the SAME YouTube phrase; only the first one's handle
    // appears in the recorded SERP, so the cache hit must re-derive the second
    // account's own (absent) position instead of reusing the first's.
    const first = await seedProcessorSite();
    const second = await seedProcessorSite();
    await seedKeyword(first, {
      phrase: 'yt shared phrase',
      engine: 'youtube',
      engineTarget: 'acmechannel',
    });
    const strangerKeyword = await seedKeyword(second, {
      phrase: 'yt shared phrase',
      engine: 'youtube',
      engineTarget: 'someoneelse',
    });
    const provider = createFakeRankProvider();
    const spy = vi.spyOn(provider, 'checkAltEngineRank');

    await makeProcessor(first, provider)(jobFor(payloadFor(first)));
    await makeProcessor(second, provider)(jobFor(payloadFor(second)));

    expect(spy).toHaveBeenCalledTimes(1);
    const [strangerRow] = await getTestDb()
      .select()
      .from(rankingsTable)
      .where(eq(rankingsTable.keywordId, strangerKeyword.id));
    expect(strangerRow?.source).toBe('cache');
    expect(strangerRow?.position).toBeNull();
    expect(strangerRow?.foundUrl).toBeNull();
  });

  it('handles a provider failure with no database attached', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, { engine: 'bing' });
    const provider = createFakeRankProvider();
    vi.spyOn(provider, 'checkAltEngineRank').mockRejectedValue(
      new VendorMalformedError('vendor drift', {
        provider: 'dataforseo',
        operation: 'alt-engine-bing-organic',
      }),
    );

    const outcome = await makeProcessor(ids, provider, {
      withCache: false,
      withDb: false,
    })(jobFor(payloadFor(ids)));

    expect(outcome.errors).toBe(1);
  });

  it('checks a non-Google keyword once per week even on a manual sweep', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, { engine: 'bing' });
    const provider = createFakeRankProvider();
    const spy = vi.spyOn(provider, 'checkAltEngineRank');
    // Wednesday — a manual job would normally stamp "now" and re-check.
    const wednesday = new Date('2026-01-07T12:00:00.000Z');

    const run = makeProcessor(ids, provider, { clock: () => wednesday });
    await run(jobFor(payloadFor(ids, true)));
    await run(jobFor(payloadFor(ids, true)));

    expect(spy).toHaveBeenCalledTimes(1);
    const rows = await getTestDb().select().from(rankingsTable);
    expect(rows).toHaveLength(1);
    // Stamped at the Monday-00:00-UTC weekly floor, not at the trigger time.
    expect(rows[0]?.checkedAt.toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });

  it('runs a Google and an alt-engine keyword in ONE sweep', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, { phrase: 'google phrase' });
    await seedKeyword(ids, { phrase: 'bing phrase', engine: 'bing' });

    const outcome = await makeProcessor(ids)(jobFor(payloadFor(ids)));

    expect(outcome.checked).toBe(2);
    const engines = (await getTestDb().select().from(rankingsTable))
      .map((r) => r.engine)
      .sort();
    expect(engines).toEqual(['bing', 'google']);
  });

  it('works without a cache layer and without a database', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, { engine: 'bing' });

    const noCache = await makeProcessor(ids, createFakeRankProvider(), {
      withCache: false,
    })(jobFor(payloadFor(ids)));
    expect(noCache.checked).toBe(1);
    expect(await getTestDb().select().from(vendorCache)).toEqual([]);

    const noDb = await makeProcessor(ids, createFakeRankProvider(), {
      withCache: false,
      withDb: false,
    })(jobFor(payloadFor(ids)));
    expect(noDb.checked).toBe(1);
  });

  it('fires the shared rank-drop path for an alt engine', async () => {
    const ids = await seedProcessorSite();
    // The phrase makes the fake report "checked, not found", which the shared
    // detector reads as a drop out of a previously held position.
    const keyword = await seedKeyword(ids, { phrase: 'unranked phrase', engine: 'bing' });
    await getTestDb().insert(rankingsTable).values({
      keywordId: keyword.id,
      position: 1,
      checkedAt: new Date('2025-12-01T00:00:00.000Z'),
      source: 'fresh',
      engine: 'bing',
    });
    const onRankDrop: RankDropHandler = vi.fn(async () => undefined);
    const dropCalls = onRankDrop as unknown as ReturnType<typeof vi.fn>;
    const db = getTestDb() as unknown as never;
    const processor = createRankProcessor({
      provider: createFakeRankProvider(),
      db,
      cache: createSerpCacheRepo({ db, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db),
      logger,
      onRankDrop,
    });

    await processor(jobFor(payloadFor(ids)));

    expect(dropCalls).toHaveBeenCalledTimes(1);
    expect(dropCalls.mock.calls[0]?.[0]).toMatchObject({
      keywordId: keyword.id,
      previousPosition: 1,
      currentPosition: null,
    });
  });

  it('passes an alt-engine candidate to the durable confirmation hook', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, {
      phrase: 'unranked phrase',
      engine: 'bing',
    });
    await getTestDb().insert(rankingsTable).values({
      keywordId: keyword.id,
      position: 1,
      checkedAt: new Date('2025-12-01T00:00:00.000Z'),
      source: 'fresh',
      engine: 'bing',
    });
    const confirmRankDrop = vi.fn(async () => undefined);
    const db = getTestDb() as unknown as never;
    const processor = createRankProcessor({
      provider: createFakeRankProvider(),
      db,
      cache: createSerpCacheRepo({ db, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db),
      logger,
      confirmRankDrop,
    });

    await processor(jobFor(payloadFor(ids)));

    expect(confirmRankDrop).toHaveBeenCalledTimes(1);
    expect(confirmRankDrop).toHaveBeenCalledWith(
      expect.objectContaining({
        keywordId: keyword.id,
        rankingId: expect.any(String),
        previousPosition: 1,
        candidatePosition: null,
        engine: 'bing',
        engineTarget: null,
      }),
    );
  });

  it('never fails the job when the alt-engine drop hook throws', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, { engine: 'bing' });
    await getTestDb().insert(rankingsTable).values({
      keywordId: keyword.id,
      position: 1,
      checkedAt: new Date('2025-12-01T00:00:00.000Z'),
      source: 'fresh',
      engine: 'bing',
    });
    const db = getTestDb() as unknown as never;
    const processor = createRankProcessor({
      provider: createFakeRankProvider(),
      db,
      cache: createSerpCacheRepo({ db, ttlHours: 24 }),
      resolveTargets: createPostgresRankTargetsResolver(db),
      logger,
      onRankDrop: async () => {
        throw new Error('alert transport down');
      },
    });

    const outcome = await processor(jobFor(payloadFor(ids)));
    expect(outcome.checked).toBe(1);
  });

  it('propagates a non-provider failure from an alt-engine check', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, { engine: 'bing' });
    const provider = createFakeRankProvider();
    vi.spyOn(provider, 'checkAltEngineRank').mockRejectedValue(new Error('database off-line'));

    await expect(
      makeProcessor(ids, provider)(jobFor(payloadFor(ids))),
    ).rejects.toThrow('database off-line');
  });

  it('honours a pinned alt-engine result from the fake provider', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, { engine: 'bing' });
    const pinned: AltEngineRankResult = {
      engine: 'bing',
      position: 9,
      foundUrl: 'https://example.com/pinned',
      rows: [{
        domain: 'example.com',
        url: 'https://example.com/pinned',
        rankGroup: 9,
        rankAbsolute: 9,
        matchToken: null,
      }],
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      observationMeta: {
        sourceKind: 'provider_observation',
        sourceLabel: 'dataforseo',
        observedAt: '2026-01-01T00:00:00.000Z',
        freshUntil: null,
        freshness: 'fresh',
        market: null,
        sampleCount: 1,
        coverageNoteKey: null,
      },
    };

    await makeProcessor(ids, createFakeRankProvider({ altEngineResult: pinned }))(
      jobFor(payloadFor(ids)),
    );

    const [row] = await getTestDb()
      .select()
      .from(rankingsTable)
      .where(eq(rankingsTable.keywordId, keyword.id));
    expect(row?.position).toBe(9);
    expect(row?.foundUrl).toBe('https://example.com/pinned');
  });
});
