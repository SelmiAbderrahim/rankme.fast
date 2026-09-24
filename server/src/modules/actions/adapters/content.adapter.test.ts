/**
 * Content Intelligence Next Actions source adapter tests.
 *
 * Locked contract under test: Content Intelligence state stays authoritative
 * (suggested→open, accepted→planned, dismissed→dismissed, applied→completed);
 * sourceId is `analysisId:recommendationId`; accepted citation gaps surface
 * as `citation_gap` from the same adapter; nothing is mutated or metered.
 */
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../../shared/testing/mongo.js';
import { ContentAnalysis } from '../../content-intelligence/content-analysis.model.js';
import { CITATION_GAP_RECOMMENDATION_PREFIX } from '../../content-intelligence/index.js';
import { contentActionAdapter } from './content.adapter.js';

const HOSTILE_EXCERPT = 'hostile-owned-page-SECRET-excerpt';

// The content adapter never touches Postgres.
const unusedDb = {} as never;

function ids() {
  return {
    accountId: new Types.ObjectId().toHexString(),
    siteId: new Types.ObjectId().toHexString(),
  };
}

function recommendation(input: {
  id: string;
  confidence?: number;
  evidenceSourceIds?: string[];
  ruleId?: string;
  messageKey?: string;
}) {
  return {
    id: input.id,
    section: 'coverage',
    ruleId: input.ruleId ?? 'add-topic',
    direction: 'add',
    confidence: input.confidence ?? 0.9,
    messageKey: input.messageKey ?? 'contentIntelligence.recs.coverage.addTopic',
    evidenceSourceIds: input.evidenceSourceIds ?? [],
  };
}

async function seedAnalysis(input: {
  accountId: string;
  siteId: string;
  status?: 'completed' | 'failed' | 'queued';
  ownedUrl?: string;
  keyword?: string;
  requestedAt?: Date;
  completedAt?: Date | null;
  recommendations?: unknown[];
  recommendationStates?: Array<{
    recommendationId: string;
    state: 'suggested' | 'accepted' | 'dismissed' | 'applied';
  }>;
  citations?: Array<{ sourceId: string; url: string; title?: string }>;
}) {
  const actor = new Types.ObjectId();
  return ContentAnalysis.create({
    accountId: input.accountId,
    ownerUserId: input.accountId,
    siteId: input.siteId,
    ownedUrl: input.ownedUrl ?? 'https://ex.test/guide',
    keyword: input.keyword ?? 'seo checklist',
    locale: 'en',
    status: input.status ?? 'completed',
    stages: [],
    inputFingerprint: new Types.ObjectId().toString(),
    idempotencyKey: `idem_${new Types.ObjectId().toString()}`,
    providerRefs: { snapshotIds: [] },
    recommendations: input.recommendations ?? [],
    recommendationStates: (input.recommendationStates ?? []).map((entry, i) => ({
      recommendationId: entry.recommendationId,
      analysisVersion: 'v2',
      state: entry.state,
      version: i + 1,
      actorUserId: actor,
      stateChangedAt: new Date('2026-07-05T00:00:00.000Z'),
    })),
    citations: input.citations ?? [],
    owned: { excerpt: HOSTILE_EXCERPT },
    requestedAt: input.requestedAt ?? new Date('2026-06-01T00:00:00Z'),
    completedAt:
      input.completedAt === undefined
        ? new Date('2026-06-14T00:00:00.000Z')
        : input.completedAt,
  });
}

beforeAll(async () => {
  await mongoose.connect(await startMemoryMongo());
});

afterAll(async () => {
  await mongoose.disconnect();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
});

afterEach(async () => {
  await clearCollections();
});

describe('contentActionAdapter', () => {
  it('returns empty for non-ObjectId ids and when no completed analysis exists', async () => {
    expect(
      await contentActionAdapter({ accountId: 'x', siteId: 'y', db: unusedDb }),
    ).toEqual({ actions: [], status: 'available' });

    const { accountId, siteId } = ids();
    await seedAnalysis({ accountId, siteId, status: 'queued' });
    expect(
      await contentActionAdapter({ accountId, siteId, db: unusedDb }),
    ).toEqual({ actions: [], status: 'available' });
  });

  it('emits schema-valid recommendations with evidence, state mapping, and confidence tiers', async () => {
    const { accountId, siteId } = ids();
    const doc = await seedAnalysis({
      accountId,
      siteId,
      recommendations: [
        recommendation({ id: 'rec-open', confidence: 0.9, evidenceSourceIds: ['cite-1', 'cite-missing'] }),
        recommendation({ id: 'rec-planned', confidence: 0.6 }),
        recommendation({ id: 'rec-dismissed', confidence: 0.3 }),
        recommendation({ id: 'rec-completed', confidence: 0.75 }),
        { totally: 'invalid' },
      ],
      recommendationStates: [
        { recommendationId: 'rec-planned', state: 'accepted' },
        { recommendationId: 'rec-dismissed', state: 'dismissed' },
        { recommendationId: 'rec-completed', state: 'applied' },
      ],
      citations: [{ sourceId: 'cite-1', url: 'https://source.test/a', title: 'Source A' }],
    });

    const result = await contentActionAdapter({ accountId, siteId, db: unusedDb });
    expect(result.status).toBe('available');
    expect(result.lastObservedAt).toBe('2026-06-14T00:00:00.000Z');
    expect(result.actions).toHaveLength(4);

    const analysisId = String(doc._id);
    const byId = new Map(result.actions.map((a) => [a.sourceId, a]));
    const open = byId.get(`${analysisId}:rec-open`)!;
    expect(open.sourceType).toBe('content_recommendation');
    expect(open.sourceState).toBe('open');
    expect(open.confidence).toBe('high');
    expect(open.severity).toBe('info');
    expect(open.firstPartyImpact).toBe('none');
    expect(open.effort).toBe('medium');
    expect(open.affectedUrls).toEqual(['https://ex.test/guide']);
    expect(open.retestAvailable).toBe(false);
    expect(open.retestReasonKey).toBe('actions.errors.retestUnsupported');
    expect(open.copyVars).toEqual({
      url: 'https://ex.test/guide',
      keyword: 'seo checklist',
    });
    // Evidence: only citations that exist; missing ids skipped silently.
    expect(open.evidence).toEqual([
      {
        sourceRef: 'cite-1',
        url: 'https://source.test/a',
        observation: expect.objectContaining({
          sourceKind: 'provider_observation',
        }),
      },
    ]);

    expect(byId.get(`${analysisId}:rec-planned`)!.sourceState).toBe('planned');
    expect(byId.get(`${analysisId}:rec-planned`)!.confidence).toBe('medium');
    expect(byId.get(`${analysisId}:rec-dismissed`)!.sourceState).toBe('dismissed');
    expect(byId.get(`${analysisId}:rec-dismissed`)!.confidence).toBe('low');
    expect(byId.get(`${analysisId}:rec-completed`)!.sourceState).toBe('completed');
    expect(byId.get(`${analysisId}:rec-completed`)!.confidence).toBe('high');

    // Owned-page excerpt must never leave the analysis document.
    expect(JSON.stringify(result)).not.toContain(HOSTILE_EXCERPT);
  });

  it('surfaces prefix-matched recommendation states as citation_gap actions', async () => {
    const { accountId, siteId } = ids();
    const gapId = `${CITATION_GAP_RECOMMENDATION_PREFIX}aaaabbbbccccddddeeeeffff00001111`;
    await seedAnalysis({
      accountId,
      siteId,
      keyword: 'ai answers',
      recommendationStates: [
        { recommendationId: gapId, state: 'accepted' },
        { recommendationId: 'plain-state-no-recommendation', state: 'accepted' },
      ],
    });

    const result = await contentActionAdapter({ accountId, siteId, db: unusedDb });
    expect(result.actions).toHaveLength(1);
    const gap = result.actions[0]!;
    expect(gap.sourceType).toBe('citation_gap');
    expect(gap.sourceId).toBe(gapId);
    expect(gap.sourceState).toBe('planned');
    expect(gap.confidence).toBe('medium');
    expect(gap.severity).toBe('info');
    expect(gap.observedAt).toBe('2026-07-05T00:00:00.000Z');
    expect(gap.lastVerifiedAt).toBeNull();
    expect(gap.copyVars).toEqual({ keyword: 'ai answers' });
    expect(gap.evidence).toEqual([
      {
        sourceRef: gapId,
        observation: expect.objectContaining({ sourceKind: 'first_party' }),
      },
    ]);
  });

  it('adds code-fix metadata from the allowlisted rule id, not stored message copy', async () => {
    const { accountId, siteId } = ids();
    await seedAnalysis({
      accountId,
      siteId,
      recommendations: [
        recommendation({
          id: 'technical',
          ruleId: 'add-title',
          messageKey: 'contentIntelligence.rules.expand-content',
        }),
        recommendation({ id: 'content-only', ruleId: 'expand-content' }),
      ],
    });

    const result = await contentActionAdapter({ accountId, siteId, db: unusedDb });
    const byId = new Map(result.actions.map((action) => [action.sourceId.split(':').at(-1), action]));

    expect(byId.get('technical')?.codeFixPrompt).toEqual({
      reference: 'add-title',
      recommendedFixKey: 'contentIntelligence.rules.add-title',
      affectedUrlCount: 1,
    });
    expect(byId.get('content-only')?.codeFixPrompt).toBeUndefined();
  });

  it('keeps only the newest completed analysis per owned URL and dedupes citation gaps', async () => {
    const { accountId, siteId } = ids();
    const gapId = `${CITATION_GAP_RECOMMENDATION_PREFIX}dedupe0000000000000000000000abcd`;
    const older = await seedAnalysis({
      accountId,
      siteId,
      requestedAt: new Date('2026-05-01T00:00:00Z'),
      completedAt: new Date('2026-05-02T00:00:00Z'),
      recommendations: [recommendation({ id: 'old-rec' })],
      recommendationStates: [{ recommendationId: gapId, state: 'applied' }],
    });
    const newer = await seedAnalysis({
      accountId,
      siteId,
      requestedAt: new Date('2026-06-01T00:00:00Z'),
      recommendations: [recommendation({ id: 'new-rec' })],
      recommendationStates: [{ recommendationId: gapId, state: 'accepted' }],
    });
    const otherUrl = await seedAnalysis({
      accountId,
      siteId,
      ownedUrl: 'https://ex.test/other',
      requestedAt: new Date('2026-05-15T00:00:00Z'),
      recommendations: [recommendation({ id: 'other-rec' })],
    });

    const result = await contentActionAdapter({ accountId, siteId, db: unusedDb });
    const sourceIds = result.actions.map((a) => a.sourceId);
    expect(sourceIds).toContain(`${String(newer._id)}:new-rec`);
    expect(sourceIds).toContain(`${String(otherUrl._id)}:other-rec`);
    expect(sourceIds).not.toContain(`${String(older._id)}:old-rec`);
    // Citation gap deduped: the newest analysis carrying it wins (accepted).
    const gaps = result.actions.filter((a) => a.sourceType === 'citation_gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.sourceState).toBe('planned');
  });

  it('falls back to requestedAt when completedAt is absent', async () => {
    const { accountId, siteId } = ids();
    await seedAnalysis({
      accountId,
      siteId,
      completedAt: null,
      requestedAt: new Date('2026-06-20T00:00:00.000Z'),
      recommendations: [recommendation({ id: 'rec-1' })],
    });
    const result = await contentActionAdapter({ accountId, siteId, db: unusedDb });
    expect(result.lastObservedAt).toBe('2026-06-20T00:00:00.000Z');
    expect(result.actions[0]!.observedAt).toBe('2026-06-20T00:00:00.000Z');
  });

  it('treats a recommendation with no stored state row as the implicit suggested/open state', async () => {
    const { accountId, siteId } = ids();
    const analysis = await seedAnalysis({
      accountId,
      siteId,
      recommendations: [
        recommendation({ id: 'never-touched' }),
        recommendation({ id: 'dismissed-rec' }),
      ],
      // Only the second recommendation has ever been acted on.
      recommendationStates: [
        { recommendationId: 'dismissed-rec', state: 'dismissed' },
      ],
    });

    const result = await contentActionAdapter({ accountId, siteId, db: unusedDb });

    const byId = new Map(result.actions.map((a) => [a.sourceId, a]));
    expect(byId.get(`${String(analysis._id)}:never-touched`)!.sourceState).toBe(
      'open',
    );
    expect(byId.get(`${String(analysis._id)}:dismissed-rec`)!.sourceState).toBe(
      'dismissed',
    );
  });

  it('dedupes one citation gap tracked across two different owned URLs', async () => {
    const { accountId, siteId } = ids();
    const gapId = `${CITATION_GAP_RECOMMENDATION_PREFIX}crossurl000000000000000000001234`;
    // Two analyses for DIFFERENT owned URLs — both survive the per-URL filter,
    // so the gap id is genuinely seen twice and the newest analysis must win.
    await seedAnalysis({
      accountId,
      siteId,
      ownedUrl: 'https://ex.test/newer',
      requestedAt: new Date('2026-06-10T00:00:00Z'),
      recommendationStates: [{ recommendationId: gapId, state: 'accepted' }],
    });
    await seedAnalysis({
      accountId,
      siteId,
      ownedUrl: 'https://ex.test/older',
      requestedAt: new Date('2026-06-01T00:00:00Z'),
      recommendationStates: [{ recommendationId: gapId, state: 'applied' }],
    });

    const result = await contentActionAdapter({ accountId, siteId, db: unusedDb });

    const gaps = result.actions.filter((a) => a.sourceType === 'citation_gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.sourceId).toBe(gapId);
    // Newest analysis wins: `accepted` → planned, not the older `applied`.
    expect(gaps[0]!.sourceState).toBe('planned');
    expect(gaps[0]!.affectedUrls).toEqual(['https://ex.test/newer']);
  });

  it('never leaks another account or site', async () => {
    const { accountId, siteId } = ids();
    await seedAnalysis({
      accountId,
      siteId,
      recommendations: [recommendation({ id: 'rec-1' })],
    });

    const otherAccount = await contentActionAdapter({
      accountId: new Types.ObjectId().toHexString(),
      siteId,
      db: unusedDb,
    });
    expect(otherAccount.actions).toEqual([]);

    const otherSite = await contentActionAdapter({
      accountId,
      siteId: new Types.ObjectId().toHexString(),
      db: unusedDb,
    });
    expect(otherSite.actions).toEqual([]);
  });
});
