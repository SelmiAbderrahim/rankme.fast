import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { env } from '../../../config/env.js';
import { competitorProfiles, keywords } from '../../../db/schema/index.js';
import { SUPPORTED_LOCALES, translate } from '../../../shared/i18n/index.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../../shared/testing/postgres.js';
import { Site } from '../../sites/index.js';
import {
  CompetitorLandscapeLegCheckpoint,
  CompetitorLandscapeReportPage,
  CompetitorLandscapeRun,
} from './landscape.model.js';
import {
  exportLandscapeRuns,
  getLandscapeRun,
  listLandscapeRuns,
  purgeLandscapeRuns,
} from './landscape.repository.js';
import {
  cancelLandscape,
  landscapeServiceTestables,
  loadOwnedLandscapeSite,
  previewLandscape,
  startLandscape,
} from './landscape.service.js';

const ACCOUNT = '000000000000000000000abc';
const OTHER_ACCOUNT = '000000000000000000000def';
const db = (): ApplicationDb => getTestDb() as unknown as ApplicationDb;
const queue = (): Queue => ({ add: vi.fn(async () => ({ id: 'queued' })) } as unknown as Queue);

async function seedSite(accountId = ACCOUNT): Promise<string> {
  const site = await Site.create({
    accountId,
    url: 'https://example.com',
    domain: 'example.com',
    label: 'Example',
  });
  return String(site._id);
}

async function seedProfiles(
  siteId: string,
  count: number,
  accountId = ACCOUNT,
  offset = 0,
): Promise<string[]> {
  const rows = await db()
    .insert(competitorProfiles)
    .values(
      Array.from({ length: count }, (_, index) => ({
        accountId,
        siteId,
        origin: `https://competitor-${index + offset}.test`,
        registrableDomain: `competitor-${index + offset}.test`,
        source: 'manual' as const,
        status: 'active' as const,
      })),
    )
    .returning({ id: competitorProfiles.id });
  return rows.map((row) => row.id);
}

function input(profileIds: string[], idempotencyKey = 'landscape-idem') {
  return { competitorProfileIds: profileIds, locale: 'en' as const, idempotencyKey };
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  await CompetitorLandscapeRun.syncIndexes();
});

afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});

afterEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { COMPETITOR_INTELLIGENCE_ENABLED: boolean }).COMPETITOR_INTELLIGENCE_ENABLED = true;
});

describe('landscape preview and start', () => {
  it('rejects malformed or unowned site coordinates and orders markets deterministically', async () => {
    await expect(loadOwnedLandscapeSite(ACCOUNT, 'invalid')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      loadOwnedLandscapeSite(ACCOUNT, '000000000000000000000001'),
    ).rejects.toMatchObject({ status: 404 });

    expect(
      landscapeServiceTestables.compareLandscapeMarkets(
        { count: 2, locationCode: 2, languageCode: 'en' },
        { count: 1, locationCode: 1, languageCode: 'ar' },
      ),
    ).toBeLessThan(0);
    expect(
      landscapeServiceTestables.compareLandscapeMarkets(
        { count: 1, locationCode: 1, languageCode: 'en' },
        { count: 1, locationCode: 2, languageCode: 'ar' },
      ),
    ).toBeLessThan(0);
    expect(
      landscapeServiceTestables.compareLandscapeMarkets(
        { count: 1, locationCode: 1, languageCode: 'ar' },
        { count: 1, locationCode: 1, languageCode: 'en' },
      ),
    ).toBeLessThan(0);
    expect(
      landscapeServiceTestables.compareLandscapeMarkets(
        { count: 1, locationCode: 1, languageCode: 'en' },
        { count: 1, locationCode: 1, languageCode: 'en' },
      ),
    ).toBe(0);
    for (const value of [null, undefined, 0, 'error', {}, { code: 1 }, { name: 'Other' }]) {
      expect(landscapeServiceTestables.isDuplicateKeyError(value)).toBe(false);
    }
    expect(landscapeServiceTestables.isDuplicateKeyError({ code: 11000 })).toBe(true);
    expect(
      landscapeServiceTestables.isDuplicateKeyError({ name: 'MongoServerError' }),
    ).toBe(true);
  });

  it('owns the site, verifies active profiles, and resolves the modal market', async () => {
    const siteId = await seedSite();
    const [profileId] = await seedProfiles(siteId, 1);
    await db().insert(keywords).values([
      { accountId: ACCOUNT, siteId, phrase: 'one', locationCode: 2276, languageCode: 'de', device: 'desktop', engine: 'google' },
      { accountId: ACCOUNT, siteId, phrase: 'two', locationCode: 2276, languageCode: 'de', device: 'mobile', engine: 'google' },
      { accountId: ACCOUNT, siteId, phrase: 'three', locationCode: 2840, languageCode: 'en', device: 'desktop', engine: 'google' },
    ]);
    const preview = await previewLandscape(
      { competitorProfileIds: [profileId!] },
      { accountId: ACCOUNT, siteId },
      { db: db() },
    );
    expect(preview).toMatchObject({
      unitsRequired: 1,
      maxRows: 300,
      market: { locationCode: 2276, languageCode: 'de', source: 'tracked_keyword_mode', eligibleTrackedKeywords: 3 },
      deploymentMode: 'community',
      capacityEnforced: false,
      competitorLimit: 10,
      startAllowed: true,
    });
    expect(preview).not.toHaveProperty('usage');
    expect(await CompetitorLandscapeRun.countDocuments()).toBe(0);

    await expect(
      previewLandscape(
        { competitorProfileIds: [profileId!] },
        { accountId: OTHER_ACCOUNT, siteId },
        { db: db() },
      ),
    ).rejects.toMatchObject({ status: 404 });
    await db().update(competitorProfiles).set({ status: 'archived' }).where(eq(competitorProfiles.id, profileId!));
    await expect(
      previewLandscape(
        { competitorProfileIds: [profileId!] },
        { accountId: ACCOUNT, siteId },
        { db: db() },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('permits only one concurrent active fingerprint', async () => {
    const siteId = await seedSite();
    const profiles = await seedProfiles(siteId, 1);
    const context = { accountId: ACCOUNT, requestedByUserId: ACCOUNT, siteId };
    const starts = await Promise.all(
      Array.from({ length: 6 }, () =>
        startLandscape(input(profiles, 'race'), context, { db: db(), queue: queue() }),
      ),
    );
    expect(new Set(starts.map((result) => result.runId)).size).toBe(1);
    expect(await CompetitorLandscapeRun.countDocuments()).toBe(1);
  });

  it('keeps history readable while the new-run kill switch is off', async () => {
    const siteId = await seedSite();
    const profiles = await seedProfiles(siteId, 1);
    const started = await startLandscape(input(profiles), { accountId: ACCOUNT, requestedByUserId: ACCOUNT, siteId }, { db: db(), queue: queue() });
    (env as { COMPETITOR_INTELLIGENCE_ENABLED: boolean }).COMPETITOR_INTELLIGENCE_ENABLED = false;
    expect((await listLandscapeRuns({ accountId: ACCOUNT, siteId })).items).toHaveLength(1);
    await expect(getLandscapeRun({ accountId: ACCOUNT, siteId, runId: started.runId })).resolves.toMatchObject({ run: { id: started.runId } });
    await CompetitorLandscapeRun.updateOne(
      { _id: started.runId },
      { $set: { state: 'failed', 'progress.stage': 'failed', completedAt: new Date(), safeFailureCode: 'RETAINED_EVIDENCE' } },
    );
    await expect(startLandscape(input(profiles, 'disabled'), { accountId: ACCOUNT, requestedByUserId: ACCOUNT, siteId }, { db: db(), queue: queue() })).rejects.toMatchObject({ status: 503 });
  });

  it('requires a configured queue before creating a run', async () => {
    const siteId = await seedSite();
    const profiles = await seedProfiles(siteId, 1);
    await expect(
      startLandscape(
        input(profiles, 'missing-queue'),
        { accountId: ACCOUNT, requestedByUserId: ACCOUNT, siteId },
        { db: db(), queue: null },
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(await CompetitorLandscapeRun.countDocuments()).toBe(0);
  });

  it('rethrows run-creation failures that have no durable winner', async () => {
    const siteId = await seedSite();
    const profiles = await seedProfiles(siteId, 1);
    const context = { accountId: ACCOUNT, requestedByUserId: ACCOUNT, siteId };
    const create = vi.spyOn(CompetitorLandscapeRun, 'create');
    try {
      const failure = new Error('create failed');
      create.mockRejectedValueOnce(failure);
      await expect(
        startLandscape(input(profiles, 'create-failure'), context, { db: db(), queue: queue() }),
      ).rejects.toBe(failure);
      const collision = { code: 11000, name: 'MongoServerError' };
      create.mockRejectedValueOnce(collision);
      await expect(
        startLandscape(input(profiles, 'collision-without-winner'), context, { db: db(), queue: queue() }),
      ).rejects.toBe(collision);
    } finally {
      create.mockRestore();
    }
    expect(await CompetitorLandscapeRun.countDocuments()).toBe(0);
  });

  it('replays a cancel on a terminal run without rewriting it', async () => {
    const siteId = await seedSite();
    const profiles = await seedProfiles(siteId, 1);
    const run = await startLandscape(
      input(profiles, 'cancel-replay'),
      { accountId: ACCOUNT, requestedByUserId: ACCOUNT, siteId },
      { db: db(), queue: queue() },
    );
    await expect(
      cancelLandscape({ accountId: ACCOUNT, siteId, runId: run.runId }),
    ).resolves.toMatchObject({ state: 'cancelled', duplicate: false });
    await expect(
      cancelLandscape({ accountId: ACCOUNT, siteId, runId: run.runId }),
    ).resolves.toMatchObject({ state: 'cancelled', duplicate: true });
  });

  it('returns the durable race winner to a duplicate-key loser', async () => {
    const siteId = await seedSite();
    const profiles = await seedProfiles(siteId, 1);
    const context = {
      accountId: ACCOUNT,
      requestedByUserId: ACCOUNT,
      siteId,
    };
    const winner = await startLandscape(
      input(profiles, 'race-winner'),
      context,
      { db: db(), queue: queue() },
    );
    const winnerDocument = await CompetitorLandscapeRun.findById(winner.runId);
    expect(winnerDocument).not.toBeNull();

    const create = vi.spyOn(CompetitorLandscapeRun, 'create');
    const findOne = vi.spyOn(CompetitorLandscapeRun, 'findOne');
    try {
      findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winnerDocument);
      create.mockRejectedValueOnce({ code: 11000, name: 'MongoServerError' });

      await expect(
        startLandscape(
          input(profiles, 'race-loser'),
          context,
          { db: db(), queue: queue() },
        ),
      ).resolves.toEqual({
        runId: winner.runId,
        state: 'queued',
        duplicate: true,
      });
    } finally {
      findOne.mockRestore();
      create.mockRestore();
    }

    expect(await CompetitorLandscapeRun.countDocuments()).toBe(1);
  });
});

describe('landscape compensation and lifecycle', () => {
  it('marks the run failed when enqueue fails', async () => {
    const siteId = await seedSite();
    const profiles = await seedProfiles(siteId, 1);
    await expect(
      startLandscape(input(profiles), { accountId: ACCOUNT, requestedByUserId: ACCOUNT, siteId }, {
        db: db(), queue: queue(), enqueueFn: vi.fn(async () => { throw new Error('redis down'); }) as never,
      }),
    ).rejects.toMatchObject({ status: 503 });
    const failed = await CompetitorLandscapeRun.findOne();
    expect(failed).toMatchObject({ state: 'failed', safeFailureCode: 'ENQUEUE_FAILED' });
  });

  it('fails cancellation closed for invalid, missing, and lost ownership races', async () => {
    await expect(
      cancelLandscape(
        { accountId: ACCOUNT, siteId: 'invalid', runId: 'invalid' },
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      cancelLandscape(
        {
          accountId: ACCOUNT,
          siteId: '000000000000000000000001',
          runId: '000000000000000000000001',
        },
      ),
    ).rejects.toMatchObject({ status: 404 });

    const siteId = await seedSite();
    const profiles = await seedProfiles(siteId, 1);
    const lost = await startLandscape(
      input(profiles, 'lost-cancel'),
      { accountId: ACCOUNT, requestedByUserId: ACCOUNT, siteId },
      { db: db(), queue: queue() },
    );
    await expect(
      cancelLandscape(
        { accountId: ACCOUNT, siteId, runId: lost.runId },
        {
          beforeCancelWrite: async () => {
            await CompetitorLandscapeRun.deleteOne({ _id: lost.runId });
          },
          findWinnerFn: async () => null,
        },
      ),
    ).rejects.toMatchObject({ status: 404 });

    const won = await startLandscape(
      input(profiles, 'won-cancel'),
      { accountId: ACCOUNT, requestedByUserId: ACCOUNT, siteId },
      { db: db(), queue: queue() },
    );
    const result = await cancelLandscape(
      { accountId: ACCOUNT, siteId, runId: won.runId },
      {
        beforeCancelWrite: async () => {
          await CompetitorLandscapeRun.updateOne(
            { _id: won.runId },
            {
              $set: {
                state: 'completed',
                'progress.stage': 'completed',
                completedAt: new Date(),
              },
            },
          );
        },
      },
    );
    expect(result).toMatchObject({ state: 'completed', duplicate: true });
  });

  it('localizes legacy manifests in every locale without changing identity, evidence, or queue activity', async () => {
    const siteId = await seedSite();
    const [profileId] = await seedProfiles(siteId, 1);
    const add = vi.fn(async () => ({ id: 'queued' }));
    const q = { add } as unknown as Queue;
    const started = await startLandscape(
      input([profileId!], 'legacy-locales'),
      { accountId: ACCOUNT, requestedByUserId: ACCOUNT, siteId },
      { db: db(), queue: q },
    );
    const completedAt = '2026-08-08T12:00:00.000Z';
    const evidenceRow = {
      id: 'legacy-evidence-row',
      keyword: 'seo guide',
      normalizedKeyword: 'seo guide',
      ownedPosition: 12,
      competitorPosition: 3,
      ownedRankAbsolute: 13,
      competitorRankAbsolute: 4,
      ownedUrl: 'https://example.com/seo-guide',
      competitorUrl: 'https://competitor-0.test/seo-guide',
      searchVolume: 100,
      keywordDifficulty: 40,
      intent: 'informational',
      class: 'shared_behind',
      competitorProfileId: profileId!,
      competitorDomain: 'competitor-0.test',
      positionDelta: 9,
      competitorCoverage: 1,
      provenanceIndexes: [],
    };
    const legacyManifest = {
      reportVersion: 1,
      schemaVersion: 'competitor-landscape/1',
      taxonomyVersion: '2026-08-08.1',
      ownedDomain: 'example.com',
      locale: 'en',
      market: {
        locationCode: 2840,
        languageCode: 'en',
        source: 'default',
        eligibleTrackedKeywords: 0,
      },
      competitors: [{ profileId: profileId!, domain: 'competitor-0.test' }],
      coverage: {
        requestedCompetitors: 1,
        usableCompetitors: 1,
        requestedLegs: 3,
        succeededLegs: 3,
        failedLegs: 0,
        truncatedLegs: 1,
        unclassifiedSharedRows: 0,
        rowsByClass: { shared_behind: 1 },
      },
      provenance: [],
      warnings: [{
        code: 'LEG_TRUNCATED',
        competitorProfileId: profileId!,
        leg: 'shared',
        count: 1,
      }],
      errors: [],
      pageSuggestions: [],
      opportunities: [{
        id: 'legacy-opportunity',
        kind: 'ranking_deficit',
        title: 'Frozen English title',
        recommendation: 'Frozen English recommendation',
        competitorProfileIds: [profileId!],
        keywordKeys: ['seo guide'],
        evidenceRowIds: ['legacy-evidence-row'],
        confidence: 'high',
        labels: { evidence: 'observed', conclusion: 'derived', prose: 'generated' },
      }],
      sourceDates: [],
      pageCount: 1,
      rowCount: 1,
      completedAt,
    };
    await CompetitorLandscapeRun.collection.updateOne(
      { _id: new Types.ObjectId(started.runId) },
      {
        $set: {
          state: 'completed',
          'progress.completedLegs': 3,
          'progress.stage': 'completed',
          completedAt: new Date(completedAt),
          reportManifest: legacyManifest,
        },
      },
    );
    await CompetitorLandscapeReportPage.collection.insertOne({
      accountId: new Types.ObjectId(ACCOUNT),
      siteId: new Types.ObjectId(siteId),
      runId: new Types.ObjectId(started.runId),
      pageIndex: 0,
      rows: [evidenceRow],
      rowCount: 1,
      pageHash: 'a'.repeat(64),
      createdAt: new Date(completedAt),
    });

    add.mockClear();
    const evidenceIdentities: string[] = [];
    const titles: string[] = [];
    for (const locale of SUPPORTED_LOCALES) {
      const detail = await getLandscapeRun({
        accountId: ACCOUNT,
        siteId,
        runId: started.runId,
        locale,
      });
      const opportunity = detail.manifest!.opportunities[0]!;
      expect(opportunity).toMatchObject({
        id: 'legacy-opportunity',
        titleKey: 'competitors.landscape.opportunities.behindTitle',
        titleVars: { count: 1 },
        recommendationKey: 'competitors.landscape.opportunities.behindRecommendation',
        recommendationVars: { count: 1, url: 'https://example.com/seo-guide' },
        title: translate(locale, 'competitors.landscape.opportunities.behindTitle', { count: 1 }),
        recommendation: translate(
          locale,
          'competitors.landscape.opportunities.behindRecommendation',
          { count: 1, url: 'https://example.com/seo-guide' },
        ),
        evidenceRowIds: ['legacy-evidence-row'],
      });
      expect(opportunity.title).not.toMatch(/\{\{|competitors\.landscape\./u);
      expect(detail.manifest!.warnings[0]).toMatchObject({
        code: 'LEG_TRUNCATED',
        messageKey: 'competitors.landscape.warnings.legTruncated',
      });
      evidenceIdentities.push(JSON.stringify(opportunity.evidenceRowIds));
      titles.push(opportunity.title);
    }
    expect(new Set(evidenceIdentities)).toEqual(new Set(['["legacy-evidence-row"]']));
    expect(new Set(titles).size).toBeGreaterThan(1);
    expect(titles[SUPPORTED_LOCALES.indexOf('ar')]).toMatch(/[\u0600-\u06ff]/u);
    expect(add).not.toHaveBeenCalled();
  });

  it('returns cross-account 404s, exposes only allowlisted DTOs, and purges children', async () => {
    const siteId = await seedSite();
    const profiles = await seedProfiles(siteId, 1);
    const started = await startLandscape(input(profiles), { accountId: ACCOUNT, requestedByUserId: ACCOUNT, siteId }, { db: db(), queue: queue() });
    await expect(getLandscapeRun({ accountId: OTHER_ACCOUNT, siteId, runId: started.runId })).rejects.toMatchObject({ status: 404 });
    const detail = await getLandscapeRun({ accountId: ACCOUNT, siteId, runId: started.runId });
    expect(detail.run).not.toHaveProperty('accountId');
    expect(detail.run).not.toHaveProperty('idempotencyKey');
    expect(detail.run).not.toHaveProperty('safeFailureCode');
    await CompetitorLandscapeRun.updateOne(
      { _id: started.runId },
      { $set: { state: 'failed', 'progress.stage': 'failed', completedAt: new Date(), safeFailureCode: 'RETAINED_EVIDENCE' } },
    );
    const second = await startLandscape(input(profiles, 'history-two'), { accountId: ACCOUNT, requestedByUserId: ACCOUNT, siteId }, { db: db(), queue: queue() });
    const firstPage = await listLandscapeRuns({ accountId: ACCOUNT, siteId, limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    const nextPage = await listLandscapeRuns({ accountId: ACCOUNT, siteId, limit: 1, cursor: firstPage.nextCursor! });
    expect(nextPage.items).toHaveLength(1);
    expect(nextPage.items[0]!.id).not.toBe(firstPage.items[0]!.id);
    expect((await exportLandscapeRuns(ACCOUNT)).map((item) => item.id)).toEqual(
      expect.arrayContaining([started.runId, second.runId]),
    );
    expect(JSON.stringify(await exportLandscapeRuns(ACCOUNT))).not.toContain('idempotencyKey');
    expect(await purgeLandscapeRuns({ accountId: ACCOUNT, siteId })).toBe(2);
    expect(await CompetitorLandscapeRun.countDocuments()).toBe(0);
    expect(await CompetitorLandscapeLegCheckpoint.countDocuments()).toBe(0);
  });
});
