import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contentRecommendationEvents,
  contentRecommendationOutcomes,
  gscSearchAnalytics,
  keywords,
  rankings,
} from '../../db/schema/index.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { makeIdempotencyKey, NOTE_MAX_LENGTH } from '../../shared/security/index.js';
import { ContentAnalysis } from './content-analysis.model.js';
import { Site } from '../sites/index.js';
import {
  getRecommendationOutcome,
  getStoredRecommendationOutcome,
  createContentOutcomeRefreshProcessor,
  refreshAllRecommendationOutcomes,
  refreshRecommendationOutcome,
} from './content-recommendation-outcomes.service.js';
import {
  getRecommendationApplicationCheck,
  createRecommendationForAudienceResearchSignal,
  createRecommendationForKeywordCluster,
  listRecommendationHistory,
  mutateRecommendation,
  recommendationStatesForAnalysis,
} from './content-recommendation.service.js';
import {
  recommendationMutationBodySchema,
  recommendationParamsSchema,
} from './content-intelligence.schema.js';
import { SCHEMA_VERSION } from './content-analysis.schemas.js';

const accountId = new Types.ObjectId().toString();
const otherAccountId = new Types.ObjectId().toString();
const siteId = new Types.ObjectId().toString();
const recommendationId = 'rec_coverage_add';
const ownedUrl = 'https://example.com/guide';
const anchor = new Date('2026-06-15T12:00:00.000Z');

function db(): ApplicationDb {
  return getTestDb() as unknown as ApplicationDb;
}

function facts(hash = 'analysis-hash') {
  return {
    url: ownedUrl,
    title: 'Guide',
    description: 'Description',
    canonical: ownedUrl,
    language: 'en',
    wordCount: 500,
    headingCount: 5,
    schemaTypes: ['Article'],
    hasSchemaOrgArticle: true,
    internalLinkCount: 3,
    externalLinkCount: 1,
    contentHash: hash,
    excerpt: 'Bounded evidence excerpt.',
  };
}

async function seedAnalysis(input: {
  owner?: string;
  status?: 'completed' | 'partial' | 'failed';
  hash?: string | null;
  completedAt?: Date;
  url?: string;
  locale?: 'en' | 'zh';
  evidence?: 'valid' | 'invalid' | 'missing';
} = {}) {
  const owner = input.owner ?? accountId;
  return ContentAnalysis.create({
    accountId: owner,
    ownerUserId: owner,
    siteId,
    ownedUrl: input.url ?? ownedUrl,
    keyword: 'content audit',
    locale: input.locale ?? 'en',
    status: input.status ?? 'completed',
    stages: [],
    inputFingerprint: new Types.ObjectId().toString(),
    idempotencyKey: `idem_${new Types.ObjectId().toString()}`,
    providerRefs: { snapshotIds: [] },
    recommendations: [{
      id: recommendationId,
      section: 'coverage',
      ruleId: 'add-topic',
      direction: 'add',
      confidence: 0.9,
      messageKey: 'contentIntelligence.recs.coverage.addTopic',
      evidenceSourceIds: ['owned'],
    }],
    recommendationStates: [],
    owned: input.hash === null ? null : facts(input.hash),
    evidence: input.evidence === 'missing' ? null : input.evidence === 'invalid' ? {} : {
      keyword: {
        keyword: 'content audit',
        locationCode: 2840,
        languageCode: 'en',
        volume: 100,
        difficulty: 20,
        intent: 'informational',
      },
      serp: {
        device: 'desktop',
        ownedPosition: 8,
        topUrls: [],
      },
    },
    requestedAt: new Date('2026-06-01T00:00:00Z'),
    completedAt: input.completedAt ?? new Date('2026-06-14T00:00:00Z'),
  });
}

function mutation(
  analysisId: string,
  action: 'accept' | 'dismiss' | 'apply' | 'undo',
  expectedVersion: number,
  clientKey: string,
  note?: string,
) {
  return {
    accountId,
    actorUserId: accountId,
    analysisId,
    recommendationId,
    analysisVersion: SCHEMA_VERSION,
    expectedVersion,
    clientKey,
    action,
    ...(note ? { note } : {}),
    ...(action === 'apply' ? { confirm: true as const } : {}),
  };
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  await Site.create({
    _id: siteId,
    accountId,
    url: 'https://example.com',
    domain: 'example.com',
    displayName: 'Example',
    gscPropertyUrl: 'sc-domain:example.com',
    gscBindingGenerationId: 'legacy',
  });
});

describe('recommendation lifecycle', () => {
  it('creates deterministic audience and cluster recommendation identifiers', () => {
    const audience = createRecommendationForAudienceResearchSignal({
      accountId,
      siteId: 'site/id with space',
      runId: 'audience-run',
      signalId: 'signal-1',
      destination: 'content',
      citedSourceIds: ['source-1'],
      operationKey: 'operation-1',
    });
    expect(audience.recommendationId).toMatch(/^audience-research:/);
    expect(audience.deepLinkPath).toContain('/sites/site%2Fid%20with%20space?tab=content&recommendation=');
    expect(createRecommendationForAudienceResearchSignal({
      accountId,
      siteId: 'site/id with space',
      runId: 'audience-run',
      signalId: 'signal-1',
      destination: 'content',
      citedSourceIds: ['source-1'],
      operationKey: 'operation-1',
    })).toEqual(audience);

    const cluster = createRecommendationForKeywordCluster({
      accountId,
      siteId,
      runId: 'cluster-run',
      clusterId: 'cluster-1',
      memberKeywords: ['one', 'two'],
      suggestedRoute: 'brief',
      aiProfile: { name: 'keyword_cluster', version: '1' },
    });
    expect(cluster.recommendationId).toMatch(/^keyword-cluster:/);
  });

  it('enforces the transition matrix and records undo without rewriting history', async () => {
    const analysis = await seedAnalysis();
    const id = String(analysis._id);
    expect(recommendationStatesForAnalysis(analysis)[0]).toMatchObject({ state: 'suggested', version: 0 });

    await mutateRecommendation(db(), mutation(id, 'dismiss', 0, 'dismiss_1'), new Date('2026-06-15T12:01:00Z'));
    await mutateRecommendation(db(), mutation(id, 'accept', 1, 'accept_1'), new Date('2026-06-15T12:02:00Z'));
    await mutateRecommendation(db(), mutation(id, 'apply', 2, 'apply_1', 'Confirmed after editing.'), new Date('2026-06-15T12:03:00Z'));
    await expect(
      mutateRecommendation(db(), mutation(id, 'accept', 3, 'accept_after_apply')),
    ).rejects.toMatchObject({ status: 409 });
    const undone = await mutateRecommendation(db(), mutation(id, 'undo', 3, 'undo_1'), new Date('2026-06-15T12:04:00Z'));
    expect(undone).toMatchObject({ state: 'accepted', version: 4, contentHash: null });
    const dismissed = await mutateRecommendation(db(), mutation(id, 'dismiss', 4, 'dismiss_2'), new Date('2026-06-15T12:05:00Z'));
    expect(dismissed.state).toBe('dismissed');

    const history = await listRecommendationHistory(db(), {
      accountId,
      analysisId: id,
      recommendationId,
    });
    expect(history.map((event) => event.eventKind)).toEqual([
      'dismissed',
      'accepted',
      'applied',
      'undo_applied',
      'dismissed',
    ]);
    expect(history[2]).toMatchObject({ hashStatus: 'same', note: 'Confirmed after editing.' });
    expect(history[3]).toMatchObject({ hashStatus: 'same' });
  });

  it('supports suggested to accepted, idempotent replay, and optimistic conflicts', async () => {
    const analysis = await seedAnalysis();
    const id = String(analysis._id);
    const accepted = await mutateRecommendation(db(), mutation(id, 'accept', 0, 'same_key'));
    const replay = await mutateRecommendation(db(), mutation(id, 'accept', 0, 'same_key'));
    expect(accepted).toMatchObject({ state: 'accepted', version: 1 });
    expect(replay).toMatchObject({ state: 'accepted', version: 1 });
    await expect(
      mutateRecommendation(db(), mutation(id, 'dismiss', 0, 'stale_version')),
    ).rejects.toMatchObject({ status: 409 });
    const rows = await db().select().from(contentRecommendationEvents);
    expect(rows).toHaveLength(1);
  });

  it('rejects invalid, stale-analysis, terminal, missing, and cross-account updates', async () => {
    const analysis = await seedAnalysis();
    const id = String(analysis._id);
    await expect(
      mutateRecommendation(db(), mutation(id, 'apply', 0, 'invalid_apply', 'note')),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      mutateRecommendation(db(), mutation(id, 'undo', 0, 'invalid_undo')),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      mutateRecommendation(db(), { ...mutation(id, 'accept', 0, 'stale_schema'), analysisVersion: 'old' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      mutateRecommendation(db(), { ...mutation(id, 'accept', 0, 'cross'), accountId: otherAccountId, actorUserId: otherAccountId }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      mutateRecommendation(db(), mutation(new Types.ObjectId().toString(), 'accept', 0, 'missing')),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      mutateRecommendation(db(), { ...mutation(id, 'accept', 0, 'missing_rec'), recommendationId: 'not_there' }),
    ).rejects.toMatchObject({ status: 404 });
    const failed = await seedAnalysis({ status: 'failed' });
    await expect(
      mutateRecommendation(db(), mutation(String(failed._id), 'accept', 0, 'terminal')),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('requires a recent hash and an explanatory note when the hash is unchanged', async () => {
    const missing = await seedAnalysis({ hash: null });
    await mutateRecommendation(db(), mutation(String(missing._id), 'accept', 0, 'accept_missing'));
    await expect(
      mutateRecommendation(db(), mutation(String(missing._id), 'apply', 1, 'apply_missing', 'note'), anchor),
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      getRecommendationApplicationCheck({
        accountId,
        analysisId: String(missing._id),
        recommendationId,
      }, anchor),
    ).resolves.toMatchObject({ available: false, hashStatus: 'unavailable' });

  });

  it('requires confirmation and an explanatory note for an unchanged hash', async () => {
    const same = await seedAnalysis();
    await expect(
      getRecommendationApplicationCheck({
        accountId,
        analysisId: String(same._id),
        recommendationId,
      }, anchor),
    ).resolves.toMatchObject({
      available: true,
      hashStatus: 'same',
      noteRequired: true,
      contentHash: 'analysis-hash',
    });
    await mutateRecommendation(db(), mutation(String(same._id), 'accept', 0, 'accept_same'));
    await expect(
      mutateRecommendation(db(), mutation(String(same._id), 'apply', 1, 'apply_same'), anchor),
    ).rejects.toMatchObject({ status: 409, message: 'contentIntelligence.recommendations.errors.unchangedHashNoteRequired' });
    const withoutConfirm = mutation(String(same._id), 'apply', 1, 'apply_no_confirm', 'note');
    delete (withoutConfirm as { confirm?: true }).confirm;
    await expect(mutateRecommendation(db(), withoutConfirm, anchor)).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a changed hash without a note and identifies the changed anchor', async () => {
    const original = await seedAnalysis({ completedAt: new Date('2026-06-12T00:00:00Z') });
    await seedAnalysis({ hash: 'new-hash', completedAt: new Date('2026-06-14T00:00:00Z') });
    await mutateRecommendation(db(), mutation(String(original._id), 'accept', 0, 'accept_changed'));
    const applied = await mutateRecommendation(
      db(),
      mutation(String(original._id), 'apply', 1, 'apply_changed'),
      anchor,
    );
    expect(applied).toMatchObject({ state: 'applied', hashStatus: 'changed', contentHash: 'new-hash' });
    const history = await listRecommendationHistory(db(), {
      accountId,
      analysisId: String(original._id),
      recommendationId,
    });
    expect(history.find((event) => event.eventKind === 'applied')?.hashStatus).toBe('changed');
    await expect(
      getRecommendationApplicationCheck({
        accountId,
        analysisId: String(original._id),
        recommendationId,
      }, anchor),
    ).resolves.toMatchObject({
      available: true,
      hashStatus: 'changed',
      noteRequired: false,
      contentHash: 'new-hash',
    });
  });

  it('reports an optimistic conflict when the Mongo compare-and-swap loses', async () => {
    const analysis = await seedAnalysis();
    const spy = vi.spyOn(ContentAnalysis, 'findOneAndUpdate').mockResolvedValueOnce(null);
    await expect(
      mutateRecommendation(db(), mutation(String(analysis._id), 'accept', 0, 'cas_lost')),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db().select().from(contentRecommendationEvents)).toHaveLength(0);
    spy.mockRestore();
  });

  it('localizes a concurrent state-version uniqueness conflict from a different client key', async () => {
    const analysis = await seedAnalysis();
    const id = String(analysis._id);
    await db().insert(contentRecommendationEvents).values({
      accountId,
      siteId,
      analysisId: id,
      recommendationId,
      analysisVersion: SCHEMA_VERSION,
      eventKind: 'accepted',
      priorState: 'suggested',
      newState: 'accepted',
      stateVersion: 1,
      actorUserId: accountId,
      idempotencyKey: 'concurrent-winner-key',
      recordedAt: new Date('2026-06-15T12:00:00Z'),
    });

    await expect(
      mutateRecommendation(db(), mutation(id, 'accept', 0, 'concurrent_loser')),
    ).rejects.toMatchObject({
      status: 409,
      message: 'contentIntelligence.recommendations.errors.versionConflict',
    });
    expect(await db().select().from(contentRecommendationEvents)).toHaveLength(1);
  });

  it('reloads the projection when the same idempotency key wins between the pre-read and insert', async () => {
    const analysis = await seedAnalysis();
    const id = String(analysis._id);
    const clientKey = 'same_racing_key';
    const scope = createHash('sha256')
      .update(`content-recommendation:${id}:${recommendationId}:accept`)
      .digest('hex');
    const scopedKey = makeIdempotencyKey(accountId, scope, clientKey);
    await db().insert(contentRecommendationEvents).values({
      accountId,
      siteId,
      analysisId: id,
      recommendationId,
      analysisVersion: SCHEMA_VERSION,
      eventKind: 'accepted',
      priorState: 'suggested',
      newState: 'accepted',
      stateVersion: 1,
      actorUserId: accountId,
      idempotencyKey: scopedKey,
      recordedAt: anchor,
    });

    const realDb = db();
    vi.spyOn(realDb, 'select').mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    } as never);
    await expect(
      mutateRecommendation(realDb, mutation(id, 'accept', 0, clientKey)),
    ).resolves.toMatchObject({ state: 'suggested', version: 0 });
  });

  it('restores the prior Mongo projection when the SQL transaction fails after the CAS', async () => {
    const analysis = await seedAnalysis();
    const id = String(analysis._id);
    const realDb = db();
    const realTransaction = realDb.transaction.bind(realDb);
    vi.spyOn(realDb, 'transaction').mockImplementationOnce(async (callback) =>
      realTransaction(async (tx) => {
        await callback(tx);
        throw new Error('simulated commit failure');
      }) as never,
    );

    await expect(
      mutateRecommendation(realDb, mutation(id, 'accept', 0, 'commit_failure')),
    ).rejects.toThrow('simulated commit failure');
    const reloaded = await ContentAnalysis.findById(id);
    expect(reloaded?.recommendationStates).toHaveLength(0);
    expect(await realDb.select().from(contentRecommendationEvents)).toHaveLength(0);
  });

  it('preserves unrelated recommendation projections with nullable and populated anchors', async () => {
    const analysis = await seedAnalysis();
    await ContentAnalysis.updateOne({ _id: analysis._id }, {
      $set: {
        recommendationStates: [
          {
            recommendationId: 'other_nullable', analysisVersion: SCHEMA_VERSION,
            state: 'accepted', version: 1, actorUserId: accountId, stateChangedAt: anchor,
            appliedAt: null, baselineAnchorAt: null, contentHash: null, analysisContentHash: null,
          },
          {
            recommendationId: 'other_applied', analysisVersion: SCHEMA_VERSION,
            state: 'applied', version: 2, actorUserId: accountId, stateChangedAt: anchor,
            appliedAt: anchor, baselineAnchorAt: anchor,
            contentHash: 'current', analysisContentHash: 'analysis',
          },
        ],
      },
    });
    await mutateRecommendation(
      db(),
      mutation(String(analysis._id), 'accept', 0, 'preserve_other_states'),
    );
    const reloaded = await ContentAnalysis.findById(analysis._id);
    expect(reloaded?.recommendationStates).toHaveLength(3);
  });

  it('rejects when the analysis site was removed and reports an invalid latest hash snapshot', async () => {
    const orphan = await seedAnalysis();
    await Site.deleteOne({ _id: siteId });
    await expect(
      mutateRecommendation(db(), mutation(String(orphan._id), 'accept', 0, 'orphan_site')),
    ).rejects.toMatchObject({ status: 404 });

    await Site.create({
      _id: siteId, accountId, url: 'https://example.com', domain: 'example.com', displayName: 'Example',
      gscPropertyUrl: 'sc-domain:example.com', gscBindingGenerationId: 'legacy',
    });
    const original = await seedAnalysis({ completedAt: new Date('2026-06-10T00:00:00Z') });
    await seedAnalysis({ hash: null, completedAt: new Date('2026-06-15T11:00:00Z') });
    await expect(
      getRecommendationApplicationCheck({
        accountId, analysisId: String(original._id), recommendationId,
      }, anchor),
    ).resolves.toMatchObject({ available: false, hashStatus: 'unavailable' });
  });

  it('bounds and strips notes and neutralizes operator-shaped recommendation ids', () => {
    expect(
      recommendationMutationBodySchema.parse({
        analysisVersion: SCHEMA_VERSION,
        expectedVersion: 0,
        clientKey: 'key',
        note: ' hello\u0000 ',
      }).note,
    ).toBe('hello');
    expect(() => recommendationMutationBodySchema.parse({
      analysisVersion: SCHEMA_VERSION,
      expectedVersion: 0,
      clientKey: 'key',
      note: 'a'.repeat(NOTE_MAX_LENGTH + 1),
    })).toThrow();
    expect(() => recommendationParamsSchema.parse({
      analysisId: new Types.ObjectId().toString(),
      recommendationId: '$ne',
    })).toThrow();
  });

  it('omits malformed recommendation rows from the public state projection', async () => {
    const analysis = await seedAnalysis();
    analysis.recommendations.push({ malformed: true });
    expect(recommendationStatesForAnalysis(analysis)).toHaveLength(1);
  });
});

describe('28-day correlated outcomes', () => {
  async function seedAppliedEvent(
    analysisId: string,
    overrides: Partial<typeof contentRecommendationEvents.$inferInsert> = {},
  ) {
    const rows = await db().insert(contentRecommendationEvents).values({
      accountId,
      siteId,
      analysisId,
      recommendationId,
      analysisVersion: SCHEMA_VERSION,
      eventKind: 'applied',
      priorState: 'accepted',
      newState: 'applied',
      stateVersion: 2,
      actorUserId: accountId,
      note: 'Applied by owner',
      contentHash: 'analysis-hash',
      analysisContentHash: 'analysis-hash',
      appliedAt: anchor,
      baselineAnchorAt: anchor,
      idempotencyKey: `idem_${new Types.ObjectId().toString()}`,
      recordedAt: anchor,
      ...overrides,
    }).returning();
    return rows[0]!;
  }

  it('uses the legacy binding generation for an older bound site', async () => {
    await Site.updateOne(
      { _id: siteId },
      { $unset: { gscBindingGenerationId: 1 } },
    );
    const analysis = await seedAnalysis();
    const event = await seedAppliedEvent(String(analysis._id));
    await expect(refreshRecommendationOutcome(db(), event)).resolves.toBe(0);
  });

  it('uses an unbound sentinel when the site has no Search Console property', async () => {
    await Site.updateOne(
      { _id: siteId },
      {
        $unset: {
          gscPropertyUrl: 1,
          gscBindingGenerationId: 1,
        },
      },
    );
    const analysis = await seedAnalysis();
    const event = await seedAppliedEvent(String(analysis._id));
    await expect(refreshRecommendationOutcome(db(), event)).resolves.toBe(0);
  });

  it('aggregates available GSC/rank observations idempotently with UTC boundaries', async () => {
    const analysis = await seedAnalysis();
    const event = await seedAppliedEvent(String(analysis._id));
    expect(await getStoredRecommendationOutcome(db(), {
      accountId,
      analysisId: String(analysis._id),
      recommendationId,
    }, anchor)).toMatchObject({ available: true, dataAvailable: false });
    await db().insert(gscSearchAnalytics).values([
      { accountId, siteId, bindingGenerationId: 'legacy', snapshotDate: '2026-06-14', dimensionSet: 'query', windowDays: 28, dimensionKey: 'content audit', clicks: 8, impressions: 80, ctr: 0.1, position: 10 },
      { accountId, siteId, bindingGenerationId: 'legacy', snapshotDate: '2026-06-14', dimensionSet: 'page', windowDays: 28, dimensionKey: ownedUrl, clicks: 9, impressions: 90, ctr: 0.1, position: 9 },
      { accountId, siteId, bindingGenerationId: 'legacy', snapshotDate: '2026-06-14', dimensionSet: 'query,page', windowDays: 28, dimensionKey: `content audit\u001f${ownedUrl}`, clicks: 10, impressions: 100, ctr: 0.1, position: 8 },
      { accountId, siteId, bindingGenerationId: 'legacy', snapshotDate: '2026-06-14', dimensionSet: 'query,page', windowDays: 28, dimensionKey: `other\u001f${ownedUrl}`, clicks: 50, impressions: 500, ctr: 0.1, position: 2 },
      { accountId, siteId, bindingGenerationId: 'legacy', snapshotDate: '2026-06-14', dimensionSet: 'query,page', windowDays: 7, dimensionKey: `content audit\u001f${ownedUrl}`, clicks: 999, impressions: 999, ctr: 1, position: 1 },
      { accountId, siteId, bindingGenerationId: 'legacy', snapshotDate: '2026-06-15', dimensionSet: 'query,page', windowDays: 28, dimensionKey: `content audit\u001f${ownedUrl}`, clicks: 14, impressions: 120, ctr: 0.12, position: 6 },
      { accountId, siteId, bindingGenerationId: 'legacy', snapshotDate: '2026-07-13', dimensionSet: 'page', windowDays: 28, dimensionKey: ownedUrl, clicks: 99, impressions: 999, ctr: 0.2, position: 4 },
    ]);
    const keyword = await db().insert(keywords).values({
      accountId,
      siteId,
      phrase: 'content audit',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    }).returning();
    const distractorKeyword = await db().insert(keywords).values({
      accountId,
      siteId,
      phrase: 'content audit',
      locationCode: 2276,
      languageCode: 'en',
      device: 'mobile',
    }).returning();
    await db().insert(rankings).values([
      { keywordId: keyword[0]!.id, position: 9, checkedAt: new Date('2026-06-14T20:00:00Z'), source: 'fresh' },
      { keywordId: keyword[0]!.id, position: 7, checkedAt: new Date('2026-06-15T20:00:00Z'), source: 'fresh' },
      { keywordId: keyword[0]!.id, position: 6, checkedAt: new Date('2026-06-15T22:00:00Z'), source: 'fresh' },
      { keywordId: keyword[0]!.id, position: 3, checkedAt: new Date('2026-07-13T00:00:00Z'), source: 'fresh' },
      { keywordId: distractorKeyword[0]!.id, position: 1, checkedAt: new Date('2026-06-15T23:00:00Z'), source: 'fresh' },
    ]);

    expect(await refreshRecommendationOutcome(db(), event)).toBe(4);
    expect(await refreshRecommendationOutcome(db(), event)).toBe(4);
    const stored = await db().select().from(contentRecommendationOutcomes);
    expect(stored).toHaveLength(4);
    const outcome = await getRecommendationOutcome(db(), {
      accountId,
      analysisId: String(analysis._id),
      recommendationId,
    }, new Date('2026-07-20T00:00:00Z'));
    expect(outcome).toMatchObject({
      available: true,
      hashStatus: 'same',
      window: { complete: true, followingEnd: '2026-07-13T00:00:00.000Z' },
      coverage: {
        gsc: { completeness: 'partial', followingDays: 1 },
        rank: { completeness: 'partial', followingDays: 1 },
      },
      laterEdit: false,
    });
    if (outcome.available) {
      expect(outcome.metrics.clicks.delta.absolute).toBe(4);
      expect(outcome.metrics.rankPosition.following).toBe(6);
    }
  });

  it('reports unavailable rather than zero, annotates later edits, and rejects cross-account reads', async () => {
    const analysis = await seedAnalysis();
    const event = await seedAppliedEvent(String(analysis._id));
    expect(await refreshRecommendationOutcome(db(), { ...event, eventKind: 'accepted' })).toBe(0);
    expect(await refreshRecommendationOutcome(db(), { ...event, appliedAt: null })).toBe(0);
    expect(await refreshRecommendationOutcome(db(), { ...event, analysisId: new Types.ObjectId().toString() })).toBe(0);
    expect(await refreshRecommendationOutcome(db(), { ...event, contentHash: null })).toBe(0);

    const empty = await getRecommendationOutcome(db(), {
      accountId,
      analysisId: String(analysis._id),
      recommendationId,
    }, anchor);
    expect(empty).toMatchObject({
      available: true,
      dataAvailable: false,
      coverage: { gsc: { completeness: 'unavailable' }, rank: { completeness: 'unavailable' } },
    });
    if (empty.available) expect(empty.metrics.clicks.baseline).toBeNull();

    await seedAnalysis({ hash: null, completedAt: new Date('2026-06-17T00:00:00Z') });
    await seedAnalysis({ hash: 'analysis-hash', completedAt: new Date('2026-06-18T00:00:00Z') });
    await seedAnalysis({ hash: 'later-hash', completedAt: new Date('2026-06-20T00:00:00Z') });
    await db().insert(gscSearchAnalytics).values({
      accountId,
      siteId,
      bindingGenerationId: 'legacy',
      snapshotDate: '2026-06-21',
      dimensionSet: 'page',
      windowDays: 28,
      dimensionKey: ownedUrl,
      clicks: 2,
      impressions: 20,
      ctr: 0.1,
      position: 5,
    });
    await refreshRecommendationOutcome(db(), event);
    const later = await db().select().from(contentRecommendationOutcomes).where(
      and(
        eq(contentRecommendationOutcomes.appliedEventId, event.id),
        eq(contentRecommendationOutcomes.source, 'gsc'),
      ),
    );
    expect(later[0]?.laterEdit).toBe(1);
    await expect(getRecommendationOutcome(db(), {
      accountId: otherAccountId,
      analysisId: String(analysis._id),
      recommendationId,
    })).rejects.toMatchObject({ status: 404 });
  });

  it('uses half-open UTC day windows at both 28-day boundaries', async () => {
    const analysis = await seedAnalysis();
    const event = await seedAppliedEvent(String(analysis._id), {
      appliedAt: new Date('2026-06-15T23:59:59.999Z'),
      baselineAnchorAt: new Date('2026-06-15T23:59:59.999Z'),
    });
    await db().insert(gscSearchAnalytics).values([
      { accountId, siteId, bindingGenerationId: 'legacy', snapshotDate: '2026-05-17', dimensionSet: 'page', windowDays: 28, dimensionKey: ownedUrl, clicks: 1, impressions: 10, ctr: 0.1, position: 10 },
      { accountId, siteId, bindingGenerationId: 'legacy', snapshotDate: '2026-05-18', dimensionSet: 'page', windowDays: 28, dimensionKey: ownedUrl, clicks: 2, impressions: 20, ctr: 0.1, position: 9 },
      { accountId, siteId, bindingGenerationId: 'legacy', snapshotDate: '2026-06-15', dimensionSet: 'page', windowDays: 28, dimensionKey: ownedUrl, clicks: 3, impressions: 30, ctr: 0.1, position: 8 },
      { accountId, siteId, bindingGenerationId: 'legacy', snapshotDate: '2026-07-12', dimensionSet: 'page', windowDays: 28, dimensionKey: ownedUrl, clicks: 4, impressions: 40, ctr: 0.1, position: 7 },
      { accountId, siteId, bindingGenerationId: 'legacy', snapshotDate: '2026-07-13', dimensionSet: 'page', windowDays: 28, dimensionKey: ownedUrl, clicks: 5, impressions: 50, ctr: 0.1, position: 6 },
    ]);

    expect(await refreshRecommendationOutcome(db(), event)).toBe(3);
    const rows = await db().select().from(contentRecommendationOutcomes);
    expect(rows.map((row) => [
      row.observedDate.toISOString().slice(0, 10),
      row.phase,
    ])).toEqual([
      ['2026-05-18', 'baseline'],
      ['2026-06-15', 'following'],
      ['2026-07-12', 'following'],
    ]);
  });

  it.each([
    { days: 12, confidence: 'medium', completeness: 'partial' },
    { days: 28, confidence: 'high', completeness: 'complete' },
  ] as const)('computes $confidence confidence from $days days of complete source coverage', async ({ days, confidence, completeness }) => {
    const analysis = await seedAnalysis();
    await seedAppliedEvent(String(analysis._id));
    const snapshots: Array<typeof gscSearchAnalytics.$inferInsert> = [];
    for (let offset = -days; offset < days; offset += 1) {
      const observed = new Date(Date.UTC(2026, 5, 15 + offset));
      snapshots.push({
        accountId,
        siteId,
        bindingGenerationId: 'legacy',
        snapshotDate: observed.toISOString().slice(0, 10),
        dimensionSet: 'page',
        windowDays: 28,
        dimensionKey: ownedUrl,
        clicks: offset < 0 ? 0 : 1,
        impressions: 10,
        ctr: offset < 0 ? 0 : 0.1,
        position: offset < 0 ? 10 : 8,
      });
    }
    await db().insert(gscSearchAnalytics).values(snapshots);
    const result = await getRecommendationOutcome(db(), {
      accountId,
      analysisId: String(analysis._id),
      recommendationId,
    }, new Date('2026-07-20T00:00:00Z'));
    expect(result).toMatchObject({
      available: true,
      coverage: { gsc: { confidence, completeness } },
      hashStatus: 'same',
    });
    if (result.available) expect(result.metrics.clicks.delta.relative).toBeNull();
    expect(await refreshAllRecommendationOutcomes(db())).toMatchObject({ events: 1 });
  });

  it('reports unavailable and changed hash anchors without manufacturing metrics', async () => {
    const analysis = await seedAnalysis();
    await seedAppliedEvent(String(analysis._id), {
      contentHash: null,
      analysisContentHash: null,
    });
    let result = await getRecommendationOutcome(db(), {
      accountId,
      analysisId: String(analysis._id),
      recommendationId,
    });
    expect(result).toMatchObject({ available: true, hashStatus: 'unavailable' });

    await truncateAllTables();
    await seedAppliedEvent(String(analysis._id), {
      contentHash: 'changed-hash',
      analysisContentHash: 'analysis-hash',
    });
    result = await getRecommendationOutcome(db(), {
      accountId,
      analysisId: String(analysis._id),
      recommendationId,
    });
    expect(result).toMatchObject({ available: true, hashStatus: 'changed' });
  });

  it('returns unavailable before any application event', async () => {
    const analysis = await seedAnalysis();
    await expect(listRecommendationHistory(db(), {
      accountId: otherAccountId,
      analysisId: String(analysis._id),
      recommendationId,
    })).rejects.toMatchObject({ status: 404 });
    await expect(listRecommendationHistory(db(), {
      accountId,
      analysisId: String(analysis._id),
      recommendationId: 'missing',
    })).rejects.toMatchObject({ status: 404 });
    await expect(listRecommendationHistory(db(), {
      accountId,
      analysisId: 'invalid',
      recommendationId,
    })).rejects.toMatchObject({ status: 404 });
    const outcome = await getRecommendationOutcome(db(), {
      accountId,
      analysisId: String(analysis._id),
      recommendationId,
    });
    expect(outcome).toEqual({ available: false });
    expect(await getStoredRecommendationOutcome(db(), {
      accountId,
      analysisId: String(analysis._id),
      recommendationId,
    }, anchor)).toEqual({ available: false });
    await expect(getRecommendationOutcome(db(), {
      accountId,
      analysisId: String(analysis._id),
      recommendationId: 'missing',
    })).rejects.toMatchObject({ status: 404 });
    const refreshed = await refreshAllRecommendationOutcomes(db());
    expect(refreshed).toEqual({ events: 0, observations: 0 });
    expect(await createContentOutcomeRefreshProcessor(db())()).toEqual({ events: 0, observations: 0 });
  });

  it('uses the locale fallback rank scope when evidence is missing or malformed', async () => {
    const missing = await seedAnalysis({ locale: 'zh', evidence: 'missing' });
    const missingEvent = await seedAppliedEvent(String(missing._id));
    const malformed = await seedAnalysis({ evidence: 'invalid' });
    const malformedEvent = await seedAppliedEvent(String(malformed._id), {
      idempotencyKey: `idem_${new Types.ObjectId().toString()}`,
    });
    const zhKeyword = await db().insert(keywords).values({
      accountId, siteId, phrase: 'content audit', locationCode: 2840,
      languageCode: 'zh-CN', device: 'desktop',
    }).returning();
    const enKeyword = await db().insert(keywords).values({
      accountId, siteId, phrase: 'content audit', locationCode: 2840,
      languageCode: 'en', device: 'desktop',
    }).returning();
    await db().insert(rankings).values([
      { keywordId: zhKeyword[0]!.id, position: 9, checkedAt: new Date('2026-06-16T12:00:00Z'), source: 'fresh' },
      { keywordId: enKeyword[0]!.id, position: 8, checkedAt: new Date('2026-06-16T12:00:00Z'), source: 'fresh' },
    ]);
    expect(await refreshRecommendationOutcome(db(), missingEvent)).toBe(1);
    expect(await refreshRecommendationOutcome(db(), malformedEvent)).toBe(1);

    const keywordOnly = await seedAnalysis();
    keywordOnly.evidence = {
      keyword: {
        keyword: 'content audit', locationCode: 2840, languageCode: 'en',
        volume: null, difficulty: null, intent: null,
      },
    };
    await keywordOnly.save();
    const keywordOnlyEvent = await seedAppliedEvent(String(keywordOnly._id), {
      idempotencyKey: `idem_${new Types.ObjectId().toString()}`,
    });
    expect(await refreshRecommendationOutcome(db(), keywordOnlyEvent)).toBe(1);
  });

  it('marks rank observations after a later content edit and rejects a removed site', async () => {
    const analysis = await seedAnalysis();
    const event = await seedAppliedEvent(String(analysis._id));
    await seedAnalysis({ hash: 'later-rank-hash', completedAt: new Date('2026-06-16T00:00:00Z') });
    const keyword = await db().insert(keywords).values({
      accountId, siteId, phrase: 'content audit', locationCode: 2840,
      languageCode: 'en', device: 'desktop',
    }).returning();
    await db().insert(rankings).values({
      keywordId: keyword[0]!.id, position: 7,
      checkedAt: new Date('2026-06-17T12:00:00Z'), source: 'fresh',
    });
    await refreshRecommendationOutcome(db(), event);
    const rows = await db().select().from(contentRecommendationOutcomes).where(
      eq(contentRecommendationOutcomes.source, 'rank'),
    );
    expect(rows[0]?.laterEdit).toBe(1);

    await Site.deleteOne({ _id: siteId });
    await expect(getRecommendationOutcome(db(), {
      accountId, analysisId: String(analysis._id), recommendationId,
    })).rejects.toMatchObject({ status: 404 });
  });
});
