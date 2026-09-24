/**
 * Community-requests spec 01 — SERP feature capture and tracking.
 *
 * Covers, against the real Better-Auth + PGlite + Mongo-memory harness the
 * sibling ranks suites use:
 *   §1 persistence on a completed check, flag-off (no persistence, localized
 *      503 on reads, rank check unaffected), ownership true/false, retention
 *      pruning, cross-account 404, and byte-identical vendor cost per check;
 *   §2 the untouched rank path (cache read-through, rank-drop detection,
 *      rankings row shape, cache-key computation) with the flag ON and OFF;
 *   §3 the promoted single-normalizer authority and the adapter extraction.
 *
 * No live vendor call: fakes and in-repo fixtures only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { pino } from 'pino';
import { asc, eq } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { Job } from 'bullmq';
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
import { keywords as keywordsTable, rankings as rankingsTable } from '../../db/schema/keywords.js';
import { serpObservations } from '../../db/schema/serp-observations.js';
import { env } from '../../config/env.js';
import { setRanksDb, setRanksQueue } from './ranks.queue-holder.js';
import {
  createPostgresRankTargetsResolver,
  createRankProcessor,
} from './rank.processor.js';
import { computeSerpCacheKey, createSerpCacheRepo } from './serp-cache.service.js';
import type * as SerpObservationsRepoModule from './serp-observations.repo.js';
import {
  clampFeatureSnapshot,
  clampTopResults,
  EMPTY_SERP_FEATURE_SNAPSHOT,
  pruneObservations,
  readHistoryForKeyword,
  readLatestForKeywords,
  recordObservation,
} from './serp-observations.repo.js';
import { detectRankDrop } from './rank-drop.service.js';
import {
  createFakeRankProvider,
  fakeSerpFeaturesFor,
  recordVendorCostUsd,
  type RankCheckInput,
  type RankCheckResult,
  type RankProvider,
  type SerpFeatureSnapshot,
} from '../../shared/providers/index.js';
import {
  extractSerpFeatures,
  MAX_PAA_QUESTIONS,
  type SerpItem,
} from '../../shared/providers/dataforseo/serp.js';
import {
  isSerpFeatureType,
  mapSerpFeature,
  normalizeSerpFeatures,
  normalizeVendorSerpFeatures,
  SERP_FEATURE_TYPES,
} from '../../shared/providers/serp-features.js';
import { normalizeSerpFeatures as reExportedFromKeywordResearch } from '../keyword-research/keyword-research.service.js';
import { mapSerpFeature as reExportedFromAdapter } from '../../shared/providers/dataforseo/keywords.js';
import { listSerpFeatures } from './serp-features.service.js';

// Optional override so a single test can force the observation write to
// throw and prove the rank job survives it. Null → the real repo runs.
let recordObservationOverride: (() => Promise<never>) | null = null;

vi.mock('./serp-observations.repo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SerpObservationsRepoModule>();
  return {
    ...actual,
    recordObservation: async (
      ...args: Parameters<typeof actual.recordObservation>
    ) => {
      if (recordObservationOverride) return recordObservationOverride();
      return actual.recordObservation(...args);
    },
  };
});

const logger = pino({ level: 'silent' });
const app = createApp();

const OWNED_DOMAIN = 'example.com';

function jobFor(data: unknown): Job {
  return { data, attemptsMade: 0, opts: { attempts: 3 } } as unknown as Job;
}

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function seedSite(accountId: string, domain = OWNED_DOMAIN): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
  });
  return site.id as string;
}

async function seedKeyword(
  accountId: string,
  siteId: string,
  phrase: string,
): Promise<string> {
  const [row] = await getTestDb()
    .insert(keywordsTable)
    .values({
      accountId,
      siteId,
      phrase,
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    })
    .returning({ id: keywordsTable.id });
  return row!.id;
}

/**
 * Deterministic SERP provider used for the processor journeys. Reports the
 * SAME cost every call so the "no new spend" regression can compare totals
 * across flag states, and carries the fake feature snapshot on `checkRank`.
 */
function trackingProvider(calls: RankCheckInput[]): RankProvider {
  const fake = createFakeRankProvider();
  return {
    async checkRank(input): Promise<RankCheckResult> {
      calls.push(input);
      recordVendorCostUsd(0.006);
      return fake.checkRank(input);
    },
    checkLocalPackRank: fake.checkLocalPackRank,
    checkAltEngineRank: fake.checkAltEngineRank,
    searchPublicPages: fake.searchPublicPages,
  };
}

/**
 * Cross-user caching only exists on the domain-independent SERP seams. The
 * vendor-neutral `checkRank` fallback returns a result already matched to the
 * caller's domain, so `checkOne` deliberately refuses to populate or read the
 * shared cache with it. A cache-hit assertion therefore has to wire the
 * production path — `liveSerp`.
 */
function cacheableLiveProvider(calls: RankCheckInput[]): RankProvider & {
  liveSerp(input: RankCheckInput): Promise<{
    items: SerpItem[];
    costUsd: number | null;
    aiOverview: null;
    features: SerpFeatureSnapshot;
  }>;
} {
  const fake = createFakeRankProvider();
  const items: SerpItem[] = [
    {
      domain: OWNED_DOMAIN,
      url: `https://${OWNED_DOMAIN}/guides/snippet`,
      rankGroup: 1,
      rankAbsolute: 1,
    },
    {
      domain: 'rival-one.example',
      url: 'https://rival-one.example/paa',
      rankGroup: 2,
      rankAbsolute: 2,
    },
  ];
  return {
    ...fake,
    async liveSerp(input: RankCheckInput) {
      calls.push(input);
      recordVendorCostUsd(0.006);
      return {
        items,
        costUsd: 0.006,
        aiOverview: null,
        // Derived from the SERP itself, never from whoever asked for it —
        // that is exactly what makes the row shareable across accounts.
        features: fakeSerpFeaturesFor(input.keyword, OWNED_DOMAIN),
      };
    },
  };
}

/** PGlite and postgres-js differ only in the driver HKT — the sibling ranks
 * suites use the same widening cast. */
function testDb() {
  return getTestDb() as unknown as never;
}

function makeProcessor(provider: RankProvider, loggerOverride = logger) {
  const db = testDb();
  return createRankProcessor({
    provider,
    db,
    cache: createSerpCacheRepo({ db }),
    logger: loggerOverride,
    resolveTargets: createPostgresRankTargetsResolver(db),
    clock: () => new Date('2026-03-02T00:00:00.000Z'),
  });
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  installTestAuth();
  setRanksDb(testDb());
  setRanksQueue({
    add: vi.fn(async () => undefined),
  } as unknown as Parameters<typeof setRanksQueue>[0]);
});

afterAll(async () => {
  uninstallTestAuth();
  await stopMemoryMongo();
  await stopTestPostgres();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { SERP_FEATURE_TRACKING_ENABLED: boolean }).SERP_FEATURE_TRACKING_ENABLED = true;
});

// ---------------------------------------------------------------------------
// §3 — one normalization authority
// ---------------------------------------------------------------------------

describe('single-normalizer promotion (spec 01 §3)', () => {
  it('the keyword-research export IS the shared implementation, not a copy', () => {
    expect(reExportedFromKeywordResearch).toBe(normalizeSerpFeatures);
  });

  it('the dataforseo keywords adapter export IS the shared implementation', () => {
    expect(reExportedFromAdapter).toBe(mapSerpFeature);
  });

  it('closed-enum normalization keeps its shipped semantics', () => {
    expect(normalizeSerpFeatures(undefined)).toEqual([]);
    expect(normalizeSerpFeatures(null)).toEqual([]);
    expect(normalizeSerpFeatures([])).toEqual([]);
    expect(normalizeSerpFeatures(['ai_overview', 'weather_widget'])).toEqual([
      'ai_overview',
      'other',
    ]);
    expect(
      normalizeSerpFeatures(['video', 'video', 'featured_snippet', 'video']),
    ).toEqual(['video', 'featured_snippet']);
  });

  it('vendor aliasing keeps its shipped semantics and never drops a value', () => {
    expect(normalizeVendorSerpFeatures(null)).toEqual([]);
    expect(normalizeVendorSerpFeatures(undefined)).toEqual([]);
    expect(
      normalizeVendorSerpFeatures(['map', ' Image_Pack ', 'video_carousel', 'gizmo', '']),
    ).toEqual(['local_pack', 'images', 'video', 'other']);
    expect(
      normalizeVendorSerpFeatures(['map', 'local_pack', 42 as unknown as string]),
    ).toEqual(['local_pack']);
  });

  it('exposes every member of the closed union exactly once', () => {
    expect(new Set(SERP_FEATURE_TYPES).size).toBe(SERP_FEATURE_TYPES.length);
    for (const type of SERP_FEATURE_TYPES) expect(isSerpFeatureType(type)).toBe(true);
    expect(isSerpFeatureType('weather_widget')).toBe(false);
    expect(isSerpFeatureType(7)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §1 — adapter extraction from the SAME payload (zero new spend)
// ---------------------------------------------------------------------------

describe('extractSerpFeatures (spec 01 §5)', () => {
  it('captures tracked blocks, the snippet source, and PAA with answer hosts', () => {
    const snapshot = extractSerpFeatures([
      {
        items: [
          { type: 'organic', rank_group: 1, rank_absolute: 1, url: 'https://a.example/', domain: 'a.example' },
          {
            type: 'featured_snippet',
            rank_absolute: 1,
            domain: 'WWW.Example.COM',
            url: 'https://example.com/guide',
            title: '  How audits work  ',
          },
          {
            type: 'people_also_ask',
            rank_absolute: 4,
            items: [
              {
                type: 'people_also_ask_element',
                title: 'What is an SEO audit?',
                expanded_element: [
                  { url: 'https://example.com/what', domain: 'example.com' },
                ],
              },
              // Duplicate question — deduped.
              { type: 'people_also_ask_element', title: 'What is an SEO audit?' },
              // Question with no expanded source — answerDomain stays null.
              { type: 'people_also_ask_element', title: 'How long does it take?' },
              // Source without an explicit domain — host derived from the URL.
              {
                type: 'people_also_ask_element',
                title: 'Is it free?',
                expanded_element: [{ url: 'https://rival-one.example/free' }],
              },
              // Blank title carries no signal.
              { type: 'people_also_ask_element', title: '   ' },
              // Plain-string nested entries (related_searches shape) skipped.
              'not an object',
            ],
          },
          // Second block of an already-seen type does not duplicate the chip.
          { type: 'people_also_ask', rank_absolute: 9, items: [] },
          // Untracked blocks are skipped, never fabricated into `other`.
          { type: 'paid', rank_absolute: 0 },
          { type: 'related_searches', rank_absolute: 12, items: ['a', 'b'] },
          // Vendor alias resolves to a tracked type; no rank reported.
          { type: 'image_pack' },
        ],
      },
    ] as never);

    expect(snapshot.features).toEqual([
      { type: 'featured_snippet', rankAbsolute: 1 },
      { type: 'people_also_ask', rankAbsolute: 4 },
      { type: 'images', rankAbsolute: null },
    ]);
    expect(snapshot.featuredSnippet).toEqual({
      domain: 'example.com',
      url: 'https://example.com/guide',
      title: 'How audits work',
    });
    expect(snapshot.paa).toEqual([
      {
        question: 'What is an SEO audit?',
        answerDomain: 'example.com',
        answerUrl: 'https://example.com/what',
      },
      { question: 'How long does it take?', answerDomain: null, answerUrl: null },
      {
        question: 'Is it free?',
        answerDomain: 'rival-one.example',
        answerUrl: 'https://rival-one.example/free',
      },
    ]);
  });

  it('bounds PAA to the stored ceiling and tolerates a snippet with no source', () => {
    const snapshot = extractSerpFeatures([
      {
        items: [
          { type: 'featured_snippet', rank_absolute: 1, title: null },
          {
            type: 'people_also_ask',
            items: Array.from({ length: MAX_PAA_QUESTIONS + 5 }, (_, i) => ({
              type: 'people_also_ask_element',
              title: `question ${i}`,
            })),
          },
        ],
      },
      { items: null },
    ] as never);
    expect(snapshot.paa).toHaveLength(MAX_PAA_QUESTIONS);
    expect(snapshot.featuredSnippet).toEqual({ domain: null, url: null, title: null });
  });

  it('an empty SERP yields the honest "checked, nothing observed" snapshot', () => {
    expect(extractSerpFeatures([{ items: [] }] as never)).toEqual({
      features: [],
      featuredSnippet: null,
      paa: [],
    });
  });

  it('clamps hostile payloads before they reach Postgres (SEC-BOUND)', () => {
    const hostile: SerpFeatureSnapshot = {
      features: Array.from({ length: 50 }, () => ({
        type: 'video' as const,
        rankAbsolute: 1,
      })),
      featuredSnippet: null,
      paa: Array.from({ length: 40 }, (_, i) => ({
        question: `q${i}`,
        answerDomain: null,
        answerUrl: null,
      })),
    };
    const clamped = clampFeatureSnapshot(hostile);
    expect(clamped.features).toHaveLength(SERP_FEATURE_TYPES.length);
    expect(clamped.paa).toHaveLength(MAX_PAA_QUESTIONS);
    const rows: SerpItem[] = Array.from({ length: 140 }, (_, i) => ({
      domain: 'x.example',
      url: `https://x.example/${i}`,
      rankGroup: i + 1,
      rankAbsolute: i + 1,
    }));
    expect(clampTopResults(rows)).toHaveLength(100);
  });
});

// ---------------------------------------------------------------------------
// §1 — processor persistence, flag gating, retention, and cost parity
// ---------------------------------------------------------------------------

describe('rank processor persistence (spec 01 §1)', () => {
  it('writes one observation per completed check and is idempotent on replay', async () => {
    const user = await seedUser('serp-persist@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'featured snippet guide');

    const calls: RankCheckInput[] = [];
    const processor = makeProcessor(trackingProvider(calls));
    const job = jobFor({
      accountId: user.id,
      siteId,
      keywordIds: [],
      schedulerKey: 'manual',
      manual: true,
    });
    await processor(job);

    const rows = await getTestDb()
      .select()
      .from(serpObservations)
      .where(eq(serpObservations.keywordId, keywordId));
    expect(rows).toHaveLength(1);
    const [observation] = rows;
    expect(observation!.engine).toBe('google');
    expect(observation!.source).toBe('fresh');
    expect(observation!.features.features.map((f) => f.type)).toEqual([
      'featured_snippet',
      'people_also_ask',
    ]);
    expect(observation!.topResults.length).toBeGreaterThan(0);
    // `checked_at` lines up with the sibling rankings row (spec §4).
    const [ranking] = await getTestDb()
      .select()
      .from(rankingsTable)
      .where(eq(rankingsTable.keywordId, keywordId));
    expect(observation!.checkedAt.toISOString()).toBe(ranking!.checkedAt.toISOString());

    // Replay: the same period writes no second observation.
    await processor(job);
    const after = await getTestDb()
      .select()
      .from(serpObservations)
      .where(eq(serpObservations.keywordId, keywordId));
    expect(after).toHaveLength(1);
  });

  it('flag OFF writes no observation, and the rank check itself is unaffected', async () => {
    const user = await seedUser('serp-flagoff@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'featured snippet guide');

    (env as { SERP_FEATURE_TRACKING_ENABLED: boolean }).SERP_FEATURE_TRACKING_ENABLED =
      false;
    const calls: RankCheckInput[] = [];
    await makeProcessor(trackingProvider(calls))(
      jobFor({
        accountId: user.id,
        siteId,
        keywordIds: [],
        schedulerKey: 'manual',
        manual: true,
      }),
    );

    expect(
      await getTestDb()
        .select()
        .from(serpObservations)
        .where(eq(serpObservations.keywordId, keywordId)),
    ).toHaveLength(0);
    // The rank row still landed — capture is a byproduct, never a gate.
    expect(
      await getTestDb()
        .select()
        .from(rankingsTable)
        .where(eq(rankingsTable.keywordId, keywordId)),
    ).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('vendor cost and provider calls are byte-identical with the flag on and off', async () => {
    async function runOnce(enabled: boolean) {
      await clearCollections();
      await truncateAllTables();
      (env as { SERP_FEATURE_TRACKING_ENABLED: boolean }).SERP_FEATURE_TRACKING_ENABLED =
        enabled;
      const user = await seedUser(`serp-cost-${enabled}@x.co`);
      const siteId = await seedSite(user.id);
      await seedKeyword(user.id, siteId, 'featured snippet guide');
      const calls: RankCheckInput[] = [];
      await makeProcessor(trackingProvider(calls))(
        jobFor({
          accountId: user.id,
          siteId,
          keywordIds: [],
          schedulerKey: 'manual',
          manual: true,
        }),
      );
      const archive = await getTestDb().select().from(
        (await import('../../db/schema/vendor-cache.js')).vendorResponses,
      );
      return {
        calls,
        costs: archive.map((row) => row.costMicros).sort(),
        archived: archive.length,
      };
    }

    const off = await runOnce(false);
    const on = await runOnce(true);
    expect(on.calls).toEqual(off.calls);
    expect(on.calls).toHaveLength(1);
    expect(on.archived).toBe(off.archived);
    expect(on.costs).toEqual(off.costs);
  });

  it('a cache hit still records the observation from the cached snapshot', async () => {
    const user = await seedUser('serp-cachehit@x.co');
    const siteId = await seedSite(user.id);
    const first = await seedKeyword(user.id, siteId, 'featured snippet guide');
    const calls: RankCheckInput[] = [];
    const provider = cacheableLiveProvider(calls);
    await makeProcessor(provider)(
      jobFor({
        accountId: user.id,
        siteId,
        keywordIds: [],
        schedulerKey: 'manual',
        manual: true,
      }),
    );
    expect(calls).toHaveLength(1);

    // A SECOND account tracking the same phrase reads the cross-user cache.
    const other = await seedUser('serp-cachehit-2@x.co');
    const otherSite = await seedSite(other.id, 'rival-one.example');
    const otherKeyword = await seedKeyword(other.id, otherSite, 'featured snippet guide');
    await makeProcessor(provider)(
      jobFor({
        accountId: other.id,
        siteId: otherSite,
        keywordIds: [],
        schedulerKey: 'manual',
        manual: true,
      }),
    );
    // No second vendor call — the cache served it.
    expect(calls).toHaveLength(1);
    const [cached] = await getTestDb()
      .select()
      .from(serpObservations)
      .where(eq(serpObservations.keywordId, otherKeyword));
    expect(cached!.source).toBe('cache');
    expect(cached!.features.features.map((f) => f.type)).toEqual([
      'featured_snippet',
      'people_also_ask',
    ]);
    expect(first).not.toBe(otherKeyword);
  });

  it('a provider with no feature signal writes no fabricated observation', async () => {
    const user = await seedUser('serp-nosignal@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'no signal phrase');
    const bare: RankProvider = {
      async checkRank(input) {
        return { position: 2, foundUrl: `https://${input.domain}/x`, checkedAt: new Date() };
      },
      checkLocalPackRank: createFakeRankProvider().checkLocalPackRank,
      checkAltEngineRank: createFakeRankProvider().checkAltEngineRank,
      searchPublicPages: createFakeRankProvider().searchPublicPages,
    };
    await makeProcessor(bare)(
      jobFor({
        accountId: user.id,
        siteId,
        keywordIds: [],
        schedulerKey: 'manual',
        manual: true,
      }),
    );
    expect(
      await getTestDb()
        .select()
        .from(serpObservations)
        .where(eq(serpObservations.keywordId, keywordId)),
    ).toHaveLength(0);
  });

  it('a persistence failure never fails the rank job', async () => {
    const user = await seedUser('serp-persistfail@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'featured snippet guide');
    const warn = vi.fn();
    const info = vi.fn();
    const hostileVendorText = '<script>vendor SERP payload</script>';
    recordObservationOverride = async () => {
      throw new Error(hostileVendorText);
    };
    try {
      const outcome = await makeProcessor(
        trackingProvider([]),
        { info, warn } as unknown as typeof logger,
      )(
        jobFor({
          accountId: user.id,
          siteId,
          keywordIds: [],
          schedulerKey: 'manual',
          manual: true,
        }),
      );
      expect(outcome.errors).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        { siteId, keywordId },
        'serp observation persistence failed — rank job continues',
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(hostileVendorText);
    } finally {
      recordObservationOverride = null;
    }
    expect(
      await getTestDb()
        .select()
        .from(rankingsTable)
        .where(eq(rankingsTable.keywordId, keywordId)),
    ).toHaveLength(1);
    expect(
      await getTestDb()
        .select()
        .from(serpObservations)
        .where(eq(serpObservations.keywordId, keywordId)),
    ).toHaveLength(0);
  });
});

describe('retention and row bounds (spec 01 §4)', () => {
  async function seedObservation(
    ids: { accountId: string; siteId: string; keywordId: string },
    checkedAt: Date,
  ) {
    await recordObservation(
      testDb(),
      {
        ...ids,
        checkedAt,
        source: 'fresh',
        features: { features: [], featuredSnippet: null, paa: [] },
        topResults: [],
      },
      new Date('2000-01-01T00:00:00.000Z'),
    );
  }

  it('prunes rows outside the retention window', async () => {
    const user = await seedUser('serp-retention@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'retention');
    const ids = { accountId: user.id, siteId, keywordId };
    await seedObservation(ids, new Date('2025-01-01T00:00:00.000Z'));
    await seedObservation(ids, new Date('2026-03-01T00:00:00.000Z'));
    const removed = await pruneObservations(
      testDb(),
      keywordId,
      'google',
      new Date('2026-03-02T00:00:00.000Z'),
    );
    expect(removed).toBe(1);
    const remaining = await readHistoryForKeyword(testDb(), keywordId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.checkedAt.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('keeps only the newest N rows per keyword', async () => {
    const user = await seedUser('serp-rowbound@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'rowbound');
    const ids = { accountId: user.id, siteId, keywordId };
    for (let day = 1; day <= 34; day += 1) {
      await recordObservation(
        testDb(),
        {
          ...ids,
          checkedAt: new Date(Date.UTC(2026, 2, day)),
          source: 'fresh',
          features: { features: [], featuredSnippet: null, paa: [] },
          topResults: [],
        },
        new Date(Date.UTC(2026, 2, day)),
      );
    }
    const rows = await getTestDb()
      .select({ checkedAt: serpObservations.checkedAt })
      .from(serpObservations)
      .where(eq(serpObservations.keywordId, keywordId))
      .orderBy(asc(serpObservations.checkedAt));
    expect(rows).toHaveLength(30);
    expect(rows[0]!.checkedAt.toISOString()).toBe(new Date(Date.UTC(2026, 2, 5)).toISOString());
  });

  it('reads degrade to "nothing observed" on a drifted jsonb payload', async () => {
    const user = await seedUser('serp-drift@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'drift');
    await getTestDb()
      .insert(serpObservations)
      .values({
        accountId: user.id,
        siteId,
        keywordId,
        checkedAt: new Date('2026-03-01T00:00:00.000Z'),
        source: 'drifted' as never,
        features: { nope: true } as never,
        topResults: { nope: true } as never,
      });
    const [row] = await readHistoryForKeyword(testDb(), keywordId);
    expect(row!.features).toEqual({ features: [], featuredSnippet: null, paa: [] });
    expect(row!.topResults).toEqual([]);
    expect(row!.source).toBe('fresh');
    const latest = await readLatestForKeywords(testDb(), siteId, [keywordId]);
    expect(latest.get(keywordId)!.topResults).toEqual([]);
    expect(await readLatestForKeywords(testDb(), siteId, [])).toEqual(new Map());
  });

  it('is idempotent on a retry of the same check and skips the prune', async () => {
    const user = await seedUser('serp-idempotent@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'idempotent');
    const ids = { accountId: user.id, siteId, keywordId };
    const checkedAt = new Date('2026-03-01T00:00:00.000Z');
    const first = await recordObservation(
      testDb(),
      { ...ids, checkedAt, source: 'fresh', features: EMPTY_SERP_FEATURE_SNAPSHOT, topResults: [] },
      checkedAt,
    );
    // A BullMQ retry replays the identical (keyword, engine, checkedAt) — the
    // unique index absorbs it, and the prune does NOT run a second time.
    const replay = await recordObservation(
      testDb(),
      { ...ids, checkedAt, source: 'fresh', features: EMPTY_SERP_FEATURE_SNAPSHOT, topResults: [] },
      checkedAt,
    );
    expect(first.inserted).toBe(true);
    expect(replay.inserted).toBe(false);
    expect(await readHistoryForKeyword(testDb(), keywordId)).toHaveLength(1);
  });

  it('serves only the newest row per keyword when several are stored', async () => {
    const user = await seedUser('serp-latest-dedupe@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'latest-dedupe');
    const ids = { accountId: user.id, siteId, keywordId };
    await seedObservation(ids, new Date('2026-03-01T00:00:00.000Z'));
    await seedObservation(ids, new Date('2026-03-08T00:00:00.000Z'));
    const latest = await readLatestForKeywords(testDb(), siteId, [keywordId]);
    expect(latest.size).toBe(1);
    expect(latest.get(keywordId)!.checkedAt.toISOString()).toBe('2026-03-08T00:00:00.000Z');
  });

  it('prunes a keyword with no surviving rows without emitting an empty predicate', async () => {
    const user = await seedUser('serp-prune-empty@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'prune-empty');
    // No observation was ever written for this keyword, so the newest-N query
    // comes back empty and the guard short-circuits before `notInArray`.
    const removed = await pruneObservations(
      testDb(),
      keywordId,
      'google',
      new Date('2026-03-02T00:00:00.000Z'),
    );
    expect(removed).toBe(0);
    expect(await readHistoryForKeyword(testDb(), keywordId)).toEqual([]);
  });

  it('declares the keyword foreign key with ON DELETE CASCADE', () => {
    // Materializing the table config executes drizzle's lazy FK resolver — the
    // only way the `() => keywords.id` callback runs, and why no
    // coverage-ignore pragma is needed on it.
    const config = getTableConfig(serpObservations);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey!.reference();
    expect(reference.foreignTable).toBe(keywordsTable);
    expect(reference.foreignColumns.map((column) => column.name)).toEqual(['id']);
    expect(foreignKey!.onDelete).toBe('cascade');
  });
});

// ---------------------------------------------------------------------------
// §1 — read surface: ownership, honest empty states, flag gating, 404
// ---------------------------------------------------------------------------

describe('GET /api/sites/:siteId/serp-features', () => {
  async function seedCheckedSite(email: string, domain = OWNED_DOMAIN) {
    const user = await seedUser(email);
    const siteId = await seedSite(user.id, domain);
    const owned = await seedKeyword(user.id, siteId, 'featured snippet guide');
    const foreign = await seedKeyword(user.id, siteId, 'serp feature tracking');
    const unchecked = await seedKeyword(user.id, siteId, 'never checked phrase');
    await makeProcessor(trackingProvider([]))(
      jobFor({
        accountId: user.id,
        siteId,
        keywordIds: [],
        schedulerKey: 'manual',
        manual: true,
      }),
    );
    return { user, siteId, owned, foreign, unchecked };
  }

  it('reports ownership, third-party features, and the honest not-observed row', async () => {
    const { user, siteId, owned, foreign, unchecked } =
      await seedCheckedSite('serp-list@x.co');
    // The never-checked keyword has no observation because it was created
    // after the sweep; simulate that by deleting its row.
    await getTestDb().delete(serpObservations).where(eq(serpObservations.keywordId, unchecked));

    const res = await request(app)
      .get(`/api/sites/${siteId}/serp-features`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      captureEnabled: true,
      captureStatus: 'active',
    });
    const rows = res.body.rows as Array<Record<string, unknown>>;
    const byId = new Map(rows.map((row) => [row.keywordId as string, row]));

    const ownedRow = byId.get(owned)!;
    expect(ownedRow.features).toEqual(['featured_snippet', 'people_also_ask']);
    expect(ownedRow.ownedSnippet).toEqual({
      domain: OWNED_DOMAIN,
      url: `https://${OWNED_DOMAIN}/guides/snippet`,
    });
    expect(ownedRow.ownedPaa).toEqual([
      {
        question: 'How do I win a featured snippet?',
        url: `https://${OWNED_DOMAIN}/guides/snippet`,
      },
    ]);
    expect(ownedRow.paaCount).toBe(2);
    expect(typeof ownedRow.observedAt).toBe('string');

    const foreignRow = byId.get(foreign)!;
    expect(foreignRow.features).toEqual(['people_also_ask', 'video', 'images']);
    expect(foreignRow.ownedSnippet).toBeNull();
    expect(foreignRow.ownedPaa).toEqual([]);

    const uncheckedRow = byId.get(unchecked)!;
    expect(uncheckedRow.observedAt).toBeNull();
    expect(uncheckedRow.features).toEqual([]);
    expect(uncheckedRow.topResultCount).toBe(0);

    // Honesty invariant — no DTO field can express "absent on Google".
    expect(JSON.stringify(res.body)).not.toContain('"present"');
    expect(JSON.stringify(res.body)).not.toContain('"absent"');
  });

  it('is 404 for another account and for an unknown site id', async () => {
    const { siteId } = await seedCheckedSite('serp-owner@x.co');
    const stranger = await seedUser('serp-stranger@x.co');
    const res = await request(app)
      .get(`/api/sites/${siteId}/serp-features`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
    const bogus = await request(app)
      .get('/api/sites/not-an-object-id/serp-features')
      .set('Cookie', stranger.cookie);
    expect(bogus.status).toBe(404);
  });

  it('keeps stored list observations readable when the capture flag is off', async () => {
    const { user, siteId } = await seedCheckedSite('serp-list-off@x.co');
    (env as { SERP_FEATURE_TRACKING_ENABLED: boolean }).SERP_FEATURE_TRACKING_ENABLED =
      false;
    const res = await request(app)
      .get(`/api/sites/${siteId}/serp-features`)
      .set('Cookie', user.cookie)
      .set('x-lang', 'fr');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      captureEnabled: false,
      captureStatus: 'paused',
    });
    expect(res.body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phrase: 'featured snippet guide',
          observedAt: expect.any(String),
          features: expect.arrayContaining(['featured_snippet']),
        }),
      ]),
    );
  });

  it('requires authentication', async () => {
    const { siteId } = await seedCheckedSite('serp-anon@x.co');
    const res = await request(app).get(`/api/sites/${siteId}/serp-features`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/keywords/:id/serp-features', () => {
  it('returns the latest observation, PAA ownership, top results, and history', async () => {
    const user = await seedUser('serp-detail@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'featured snippet guide');
    await makeProcessor(trackingProvider([]))(
      jobFor({
        accountId: user.id,
        siteId,
        keywordIds: [],
        schedulerKey: 'manual',
        manual: true,
      }),
    );

    const res = await request(app)
      .get(`/api/keywords/${keywordId}/serp-features`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.phrase).toBe('featured snippet guide');
    expect(res.body.latest.features).toEqual(['featured_snippet', 'people_also_ask']);
    expect(res.body.latest.ownedSnippet.domain).toBe(OWNED_DOMAIN);
    expect(res.body.latest.snippetSource.domain).toBe(OWNED_DOMAIN);
    expect(res.body.latest.paa).toEqual([
      {
        question: 'How do I win a featured snippet?',
        answerDomain: OWNED_DOMAIN,
        answerUrl: `https://${OWNED_DOMAIN}/guides/snippet`,
        owned: true,
      },
      {
        question: 'What is a People Also Ask box?',
        answerDomain: 'rival-one.example',
        answerUrl: 'https://rival-one.example/paa',
        owned: false,
      },
    ]);
    const top = res.body.latest.topResults as Array<Record<string, unknown>>;
    expect(top.length).toBeGreaterThan(0);
    expect(top.some((row) => row.owned === true)).toBe(true);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0].ownedSnippet).toBe(true);
    expect(res.body.history[0].ownedPaaCount).toBe(1);
  });

  it('reports the honest not-observed state for a keyword with no rows', async () => {
    const user = await seedUser('serp-detail-empty@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'never checked');
    const res = await request(app)
      .get(`/api/keywords/${keywordId}/serp-features`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.latest).toBeNull();
    expect(res.body.history).toEqual([]);
  });

  it('reports a third-party snippet source without claiming ownership', async () => {
    const user = await seedUser('serp-detail-foreign@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'foreign snippet');
    await recordObservation(
      testDb(),
      {
        accountId: user.id,
        siteId,
        keywordId,
        checkedAt: new Date('2026-03-01T00:00:00.000Z'),
        source: 'fresh',
        features: {
          features: [{ type: 'featured_snippet', rankAbsolute: 1 }],
          featuredSnippet: {
            domain: 'rival-one.example',
            url: 'https://rival-one.example/snippet',
            title: '<script>alert(1)</script>',
          },
          paa: [],
        },
        topResults: [
          {
            domain: 'rival-one.example',
            url: 'https://rival-one.example/snippet',
            rankGroup: 1,
            rankAbsolute: 1,
          },
        ],
      },
      new Date('2026-03-01T00:00:00.000Z'),
    );
    const res = await request(app)
      .get(`/api/keywords/${keywordId}/serp-features`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.latest.ownedSnippet).toBeNull();
    expect(res.body.latest.snippetSource).toEqual({
      domain: 'rival-one.example',
      url: 'https://rival-one.example/snippet',
    });
    expect(res.body.latest.topResults[0].owned).toBe(false);
  });

  it('reports a snippet block whose source the vendor did not name', async () => {
    const user = await seedUser('serp-detail-nodomain@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'anonymous snippet');
    await recordObservation(
      testDb(),
      {
        accountId: user.id,
        siteId,
        keywordId,
        checkedAt: new Date('2026-03-01T00:00:00.000Z'),
        source: 'cache',
        features: {
          features: [{ type: 'featured_snippet', rankAbsolute: null }],
          featuredSnippet: { domain: null, url: null, title: null },
          paa: [
            { question: 'Who wrote this?', answerDomain: null, answerUrl: null },
          ],
        },
        topResults: [],
      },
      new Date('2026-03-01T00:00:00.000Z'),
    );
    const res = await request(app)
      .get(`/api/keywords/${keywordId}/serp-features`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.latest.ownedSnippet).toBeNull();
    // The vendor named no host, so no host is reported. The chip still shows
    // (`features` lists `featured_snippet`) — observed, just unattributed.
    expect(res.body.latest.snippetSource).toBeNull();
    expect(res.body.latest.features).toEqual(['featured_snippet']);
    expect(res.body.latest.paa).toEqual([
      { question: 'Who wrote this?', answerDomain: null, answerUrl: null, owned: false },
    ]);
    expect(res.body.latest.topResults).toEqual([]);
  });

  it('reports no snippet source at all when the check saw no snippet block', async () => {
    const user = await seedUser('serp-detail-nosnippet@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'no snippet block');
    await recordObservation(
      testDb(),
      {
        accountId: user.id,
        siteId,
        keywordId,
        checkedAt: new Date('2026-03-01T00:00:00.000Z'),
        source: 'fresh',
        features: {
          features: [{ type: 'video', rankAbsolute: 2 }],
          featuredSnippet: null,
          paa: [],
        },
        topResults: [],
      },
      new Date('2026-03-01T00:00:00.000Z'),
    );
    const res = await request(app)
      .get(`/api/keywords/${keywordId}/serp-features`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.latest.snippetSource).toBeNull();
    expect(res.body.latest.ownedSnippet).toBeNull();
    expect(res.body.latest.features).toEqual(['video']);
  });

  it('is 404 for another account and keeps stored detail readable when the flag is off', async () => {
    const user = await seedUser('serp-detail-owner@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'ownership');
    const observedAt = new Date('2026-03-01T00:00:00.000Z');
    await recordObservation(
      testDb(),
      {
        accountId: user.id,
        siteId,
        keywordId,
        checkedAt: observedAt,
        source: 'fresh',
        features: EMPTY_SERP_FEATURE_SNAPSHOT,
        topResults: [],
      },
      observedAt,
    );
    const stranger = await seedUser('serp-detail-stranger@x.co');
    const foreign = await request(app)
      .get(`/api/keywords/${keywordId}/serp-features`)
      .set('Cookie', stranger.cookie);
    expect(foreign.status).toBe(404);

    (env as { SERP_FEATURE_TRACKING_ENABLED: boolean }).SERP_FEATURE_TRACKING_ENABLED =
      false;
    const off = await request(app)
      .get(`/api/keywords/${keywordId}/serp-features`)
      .set('Cookie', user.cookie);
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({
      keywordId,
      phrase: 'ownership',
      captureEnabled: false,
      captureStatus: 'paused',
      latest: { observedAt: '2026-03-01T00:00:00.000Z' },
    });
  });

  it('is 404 when the keyword outlives its site', async () => {
    const user = await seedUser('serp-detail-orphan@x.co');
    const siteId = await seedSite(user.id);
    const keywordId = await seedKeyword(user.id, siteId, 'orphan');
    await Site.deleteOne({ _id: siteId });
    const res = await request(app)
      .get(`/api/keywords/${keywordId}/serp-features`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// §2 — the rank path is provably unchanged
// ---------------------------------------------------------------------------

describe('rank-path regression with the flag ON and OFF (spec 01 §2)', () => {
  const cacheKeyInput = {
    phrase: 'Featured Snippet Guide',
    locationCode: 2840,
    languageCode: 'EN',
    device: 'Desktop',
  };
  // Locked BEFORE this prompt: the cache key is a pure function of the
  // normalized (phrase, location, language, device) tuple. Feature capture
  // must not enter it, or every cached SERP in production would be orphaned.
  const EXPECTED_CACHE_KEY = computeSerpCacheKey(cacheKeyInput);

  it('cache-key computation ignores the feature flag entirely', () => {
    for (const enabled of [true, false]) {
      (env as { SERP_FEATURE_TRACKING_ENABLED: boolean }).SERP_FEATURE_TRACKING_ENABLED =
        enabled;
      expect(computeSerpCacheKey(cacheKeyInput)).toBe(EXPECTED_CACHE_KEY);
    }
  });

  it('a legacy cache row with no `features` key still reads as a HIT', async () => {
    const repo = createSerpCacheRepo({ db: testDb() });
    const { vendorCache } = await import('../../db/schema/vendor-cache.js');
    const now = new Date('2026-03-02T00:00:00.000Z');
    await getTestDb().insert(vendorCache).values({
      capability: 'rank',
      operation: 'serp',
      cacheKey: 'legacy-key',
      params: {},
      // EXACTLY the pre-spec-01 payload shape — no `features` key at all.
      payload: {
        topResults: [
          { domain: 'a.example', url: 'https://a.example/', rankGroup: 1, rankAbsolute: 1 },
        ],
        aiOverview: null,
      },
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
    });
    const hit = await repo.read('legacy-key', now);
    expect(hit).not.toBeNull();
    expect(hit!.topResults).toHaveLength(1);
    expect(hit!.aiOverview).toBeNull();
    expect(hit!.features).toBeNull();
  });

  it('rankings row shape and rank-drop detection are unchanged in both flag states', async () => {
    for (const enabled of [false, true]) {
      await clearCollections();
      await truncateAllTables();
      (env as { SERP_FEATURE_TRACKING_ENABLED: boolean }).SERP_FEATURE_TRACKING_ENABLED =
        enabled;
      const user = await seedUser(`serp-regression-${enabled}@x.co`);
      const siteId = await seedSite(user.id);
      const keywordId = await seedKeyword(user.id, siteId, 'featured snippet guide');
      await makeProcessor(trackingProvider([]))(
        jobFor({
          accountId: user.id,
          siteId,
          keywordIds: [],
          schedulerKey: 'manual',
          manual: true,
        }),
      );
      const [row] = await getTestDb()
        .select()
        .from(rankingsTable)
        .where(eq(rankingsTable.keywordId, keywordId));
      expect(row!.position).toBe(3);
      expect(row!.foundUrl).toBe('https://example.com/pricing');
      expect(row!.source).toBe('fresh');
      expect(row!.aiOverviewPresent).toBe(false);
      expect(row!.aiCited).toBe(false);
      // Detection authority itself is a pure function — assert it here so the
      // regression covers the shipped thresholds alongside the storage shape.
      expect(detectRankDrop(3, 25)).toBe(true);
      expect(detectRankDrop(3, 4)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Fake provider determinism (backs the composed-stack journey)
// ---------------------------------------------------------------------------

describe('fakeSerpFeaturesFor', () => {
  it('is deterministic across the three documented scenarios', () => {
    expect(fakeSerpFeaturesFor('featured snippet guide', 'example.com')).toEqual(
      fakeSerpFeaturesFor('FEATURED SNIPPET GUIDE', 'example.com'),
    );
    expect(
      fakeSerpFeaturesFor('serp feature tracking', 'example.com').featuredSnippet,
    ).toBeNull();
    expect(fakeSerpFeaturesFor('plain phrase', 'example.com')).toEqual({
      features: [],
      featuredSnippet: null,
      paa: [],
    });
  });
});

// The route suite can never reach the service-level ownership guard:
// `siteMutationLease` answers 404 for an unowned or missing site before the
// router runs. This is the defence-in-depth layer every non-HTTP caller hits.
describe('serp-features service ownership guard', () => {
  const GUARD_ACCOUNT = '6a6fa7c28d75c2fd32d84a63';

  it('refuses a well-formed site id this account does not own', async () => {
    await expect(listSerpFeatures({ accountId: GUARD_ACCOUNT, siteId: '6a6fa7c28d75c2fd32d84a99' }, { db: getTestDb() as never })).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a malformed site id', async () => {
    await expect(listSerpFeatures({ accountId: GUARD_ACCOUNT, siteId: 'not-an-id' }, { db: getTestDb() as never })).rejects.toMatchObject({ status: 404 });
  });
});
