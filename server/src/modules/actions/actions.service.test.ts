/**
 * Actions read-model service + append-only events repo tests.
 *
 * Exercises the source-reader registry seam directly (stub readers) so every
 * service branch — id hashing, link building, localization, event overlay,
 * content-state authority, filters, ordering, pagination, degraded sources —
 * is provable without a vendor call or a queue.
 */
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { Site } from '../sites/index.js';
import {
  appendActionEvent,
  deleteAllEventsForAccount,
  exportAllEventsForAccount,
  findLatestEventForAction,
  findLatestEventsForActions,
  listSiteEventHistory,
} from './actions.events.repo.js';
import { hashActionId, hashSourceIdRef } from './actions.identity.js';
import {
  clearSourceRegistry,
  getSourceReaders,
  registerSource,
} from './actions.registry.js';
import { getActionHistory, listActionsForSite } from './actions.service.js';
import { mutateActionState } from './actions.state.service.js';
import type { CandidateAction } from './actions.types.js';

function candidate(over: Partial<CandidateAction> = {}): CandidateAction {
  return {
    sourceType: 'confirmed_rank_drop',
    sourceId: 'cand-1',
    affectedUrls: [],
    evidence: [],
    severity: 'warning',
    firstPartyImpact: 'none',
    confidence: 'high',
    effort: 'low',
    sourceState: 'open',
    observedAt: '2026-07-01T00:00:00.000Z',
    lastVerifiedAt: null,
    retestAvailable: false,
    retestReasonKey: 'actions.errors.retestUnsupported',
    copyKeys: {
      problem: 'actions.rankDrop.problem',
      whyItMatters: 'actions.rankDrop.whyItMatters',
      nextStep: 'actions.rankDrop.nextStep',
    },
    copyVars: { keyword: 'best shoes' },
    ...over,
  };
}

async function seedSite() {
  const accountId = new Types.ObjectId().toHexString();
  const siteId = new Types.ObjectId().toHexString();
  await Site.create({
    _id: new Types.ObjectId(siteId),
    accountId: new Types.ObjectId(accountId),
    url: `https://${siteId.slice(0, 8)}.test`,
    domain: `${siteId.slice(0, 8)}.test`,
    displayName: 'Example',
  });
  return { accountId, siteId };
}

function registerStub(
  sourceType: CandidateAction['sourceType'],
  actions: CandidateAction[],
  lastObservedAt?: string,
) {
  registerSource(sourceType, async () => ({
    actions,
    status: 'available',
    ...(lastObservedAt ? { lastObservedAt } : {}),
  }));
}

beforeAll(async () => {
  await mongoose.connect(await startMemoryMongo());
  await startTestPostgres();
});

afterAll(async () => {
  await mongoose.disconnect();
  await stopMemoryMongo();
  await stopTestPostgres();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  clearSourceRegistry();
});

afterEach(async () => {
  clearSourceRegistry();
  await clearCollections();
  await truncateAllTables();
});

describe('listActionsForSite', () => {
  it('throws 404 for an unknown or cross-account site', async () => {
    await expect(
      listActionsForSite({
        accountId: new Types.ObjectId().toHexString(),
        siteId: new Types.ObjectId().toHexString(),
        locale: 'en',
        db: getTestDb(),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('skips the event-overlay read entirely when no source yields a candidate', async () => {
    const { accountId, siteId } = await seedSite();
    // A registered-but-empty source: the overlay query must not run, and the
    // source still reports its own honest status (absence is never an error).
    registerStub('confirmed_rank_drop', [], '2026-07-01T00:00:00.000Z');
    registerStub('audit_finding', []);

    const result = await listActionsForSite({
      accountId,
      siteId,
      locale: 'en',
      db: getTestDb(),
    });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(result.sourceStatus.confirmed_rank_drop).toEqual({
      status: 'available',
      lastObservedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(result.sourceStatus.audit_finding).toEqual({
      status: 'available',
      lastObservedAt: undefined,
    });
  });

  it('returns an empty list when no source is registered at all', async () => {
    const { accountId, siteId } = await seedSite();

    const result = await listActionsForSite({
      accountId,
      siteId,
      locale: 'en',
      db: getTestDb(),
    });

    expect(result).toEqual({ items: [], sourceStatus: {}, nextCursor: null });
  });

  it('maps a candidate into a localized, hashed, linked ActionItem', async () => {
    const { accountId, siteId } = await seedSite();
    registerStub('confirmed_rank_drop', [candidate()], '2026-07-01T00:00:00.000Z');

    const result = await listActionsForSite({
      accountId,
      siteId,
      locale: 'en',
      db: getTestDb(),
    });

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.id).toBe(
      hashActionId({
        accountId,
        siteId,
        sourceType: 'confirmed_rank_drop',
        sourceId: 'cand-1',
      }),
    );
    expect(item.sourceLink).toBe(`/sites/${siteId}/ranks/drops/cand-1`);
    expect(item.problem).toBe(
      'Your Google ranking for “best shoes” dropped, and a second check confirmed it.',
    );
    expect(item.copy).toEqual({
      problem: {
        messageKey: 'actions.rankDrop.problem',
        messageVars: { keyword: 'best shoes' },
      },
      whyItMatters: {
        messageKey: 'actions.rankDrop.whyItMatters',
        messageVars: { keyword: 'best shoes' },
      },
      nextStep: {
        messageKey: 'actions.rankDrop.nextStep',
        messageVars: { keyword: 'best shoes' },
      },
    });
    expect(item.state).toBe('open');
    expect(item.version).toBe(0);
    expect(item.retest).toEqual({
      available: false,
      reason: 'Only audit findings can be retested.',
      code: 'RETEST_UNSUPPORTED',
      messageKey: 'actions.errors.retestUnsupported',
    });
    expect(result.sourceStatus.confirmed_rank_drop).toEqual({
      status: 'available',
      lastObservedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(result.nextCursor).toBeNull();
  });

  it('localizes copy and retest reasons into the requested locale', async () => {
    const { accountId, siteId } = await seedSite();
    registerStub('confirmed_rank_drop', [candidate({
      codeFixPrompt: {
        reference: 'title-missing-or-weak',
        recommendedFixKey: 'auditRules.title-missing-or-weak.fix',
        affectedUrlCount: 3,
      },
    })]);

    const fr = await listActionsForSite({
      accountId,
      siteId,
      locale: 'fr',
      db: getTestDb(),
    });
    expect(fr.items[0]!.problem).toContain('best shoes');
    expect(fr.items[0]!.problem).toContain('Votre position Google');
    expect(fr.items[0]!.retest.reason).toBe(
      'Seules les découvertes d\'audit peuvent être re-testées.',
    );
    expect(fr.items[0]!.codeFixPrompt).toEqual({
      reference: 'title-missing-or-weak',
      recommendedFix:
        'Rédigez un titre unique et descriptif de 30 à 60 caractères pour chaque page listée. Placez les mots les plus importants près du début.',
      affectedUrlCount: 3,
    });
  });

  it('renders retest-available and reasonless-unavailable variants', async () => {
    const { accountId, siteId } = await seedSite();
    registerStub('audit_finding', [
      candidate({
        sourceType: 'audit_finding',
        sourceId: 'run1:rule1',
        retestAvailable: true,
        retestReasonKey: undefined,
        copyKeys: {
          problem: 'actions.rankDrop.problem',
          whyItMatters: 'actions.rankDrop.whyItMatters',
          nextStep: 'actions.rankDrop.nextStep',
        },
      }),
      candidate({
        sourceType: 'audit_finding',
        sourceId: 'run1:rule2',
        retestAvailable: false,
        retestReasonKey: undefined,
      }),
    ]);

    const result = await listActionsForSite({
      accountId,
      siteId,
      locale: 'en',
      db: getTestDb(),
    });
    const byId = new Map(result.items.map((i) => [i.sourceId, i]));
    expect(byId.get('run1:rule1')!.retest).toEqual({ available: true });
    expect(byId.get('run1:rule2')!.retest).toEqual({ available: false });
  });

  it('overlays the latest user event for non-content sources only', async () => {
    const { accountId, siteId } = await seedSite();
    registerStub('confirmed_rank_drop', [candidate({ sourceId: 'rank-1' })]);
    registerStub('content_recommendation', [
      candidate({
        sourceType: 'content_recommendation',
        sourceId: 'analysis1:rec1',
        sourceState: 'planned',
        copyKeys: {
          problem: 'actions.content.problem',
          whyItMatters: 'actions.content.whyItMatters',
          nextStep: 'actions.content.nextStep',
        },
        copyVars: { url: 'https://ex.test/a', keyword: 'kw' },
      }),
    ]);

    const rankActionId = hashActionId({
      accountId,
      siteId,
      sourceType: 'confirmed_rank_drop',
      sourceId: 'rank-1',
    });
    const contentActionId = hashActionId({
      accountId,
      siteId,
      sourceType: 'content_recommendation',
      sourceId: 'analysis1:rec1',
    });
    for (const [actionId, sourceType, sourceId] of [
      [rankActionId, 'confirmed_rank_drop', 'rank-1'],
      [contentActionId, 'content_recommendation', 'analysis1:rec1'],
    ] as const) {
      await appendActionEvent(getTestDb(), {
        accountId,
        siteId,
        actionId,
        sourceType,
        sourceIdRef: hashSourceIdRef({ accountId, sourceType, sourceId }),
        priorState: 'open',
        newState: 'dismissed',
        eventKind: 'dismiss',
        actorUserId: accountId,
        note: null,
        idempotencyKey: `idem-${actionId}`,
      });
    }

    const result = await listActionsForSite({
      accountId,
      siteId,
      locale: 'en',
      db: getTestDb(),
    });
    const byId = new Map(result.items.map((i) => [i.sourceType, i]));
    // Non-content: the event overlays the default open state.
    expect(byId.get('confirmed_rank_drop')!.state).toBe('dismissed');
    expect(byId.get('confirmed_rank_drop')!.version).toBe(1);
    // Content: source truth wins; a stray event never overlays it.
    expect(byId.get('content_recommendation')!.state).toBe('planned');
  });

  it('carries a run-scoped audit decision into the stable rule action', async () => {
    const { accountId, siteId } = await seedSite();
    const runId = new Types.ObjectId().toHexString();
    const sourceId = 'structured-data-missing';
    const legacySourceId = `${runId}:${sourceId}`;
    registerStub('audit_finding', [
      candidate({
        sourceType: 'audit_finding',
        sourceId,
        evidence: [
          {
            sourceRef: legacySourceId,
            observation: {
              sourceKind: 'provider_observation',
              sourceLabel: null,
              freshness: 'fresh',
              observedAt: '2026-07-01T00:00:00.000Z',
              freshUntil: null,
              market: null,
              sampleCount: 0,
              coverageNoteKey: null,
            },
          },
        ],
        retestAvailable: true,
      }),
    ]);

    const actionId = hashActionId({
      accountId,
      siteId,
      sourceType: 'audit_finding',
      sourceId,
    });
    const legacyActionId = hashActionId({
      accountId,
      siteId,
      sourceType: 'audit_finding',
      sourceId: legacySourceId,
    });
    await appendActionEvent(getTestDb(), {
      accountId,
      siteId,
      actionId: legacyActionId,
      sourceType: 'audit_finding',
      sourceIdRef: hashSourceIdRef({
        accountId,
        sourceType: 'audit_finding',
        sourceId: legacySourceId,
      }),
      priorState: 'open',
      newState: 'dismissed',
      eventKind: 'dismiss',
      actorUserId: accountId,
      note: 'legacy decision',
      idempotencyKey: 'legacy-audit-decision',
    });

    const base = { accountId, siteId, locale: 'en' as const, db: getTestDb() };
    const before = await listActionsForSite(base);
    expect(before.items[0]).toMatchObject({
      id: actionId,
      state: 'dismissed',
      version: 0,
      sourceLink: `/sites/${siteId}/report?finding=${sourceId}`,
    });
    expect(
      await getActionHistory({ ...base, actionId }),
    ).toMatchObject({ entries: [{ ordinal: 1, newState: 'dismissed' }] });

    await expect(
      mutateActionState({
        accountId,
        siteId,
        actionId,
        actorUserId: accountId,
        newState: 'open',
        expectedVersion: 0,
        note: null,
        clientKey: 'canonical-reopen',
        db: getTestDb(),
      }),
    ).resolves.toMatchObject({ actionId, state: 'open', version: 1 });

    const after = await listActionsForSite(base);
    expect(after.items[0]).toMatchObject({ id: actionId, state: 'open', version: 1 });
    expect(
      (await getActionHistory({ ...base, actionId })).entries.map((entry) => [
        entry.ordinal,
        entry.newState,
      ]),
    ).toEqual([
      [1, 'dismissed'],
      [2, 'open'],
    ]);
  });

  it('flags a completed action whose source still observes it after the fix was claimed', async () => {
    const { accountId, siteId } = await seedSite();
    // Same source, three findings: one observed long before the user marked
    // it fixed (the fix holds), one observed by a later audit (it does not),
    // and one still dismissed (no fix was ever claimed).
    registerStub('audit_finding', [
      candidate({
        sourceType: 'audit_finding',
        sourceId: 'held',
        observedAt: '2020-01-01T00:00:00.000Z',
      }),
      candidate({
        sourceType: 'audit_finding',
        sourceId: 'reappeared',
        observedAt: '2099-01-01T00:00:00.000Z',
      }),
      candidate({
        sourceType: 'audit_finding',
        sourceId: 'dismissed',
        observedAt: '2099-01-01T00:00:00.000Z',
      }),
    ]);
    // Content sources keep their own state authority — a `completed` source
    // state with no event row is never flagged.
    registerStub('content_recommendation', [
      candidate({
        sourceType: 'content_recommendation',
        sourceId: 'analysis1:rec1',
        sourceState: 'completed',
        observedAt: '2099-01-01T00:00:00.000Z',
        copyKeys: {
          problem: 'actions.content.problem',
          whyItMatters: 'actions.content.whyItMatters',
          nextStep: 'actions.content.nextStep',
        },
        copyVars: { url: 'https://ex.test/a', keyword: 'kw' },
      }),
    ]);

    for (const [sourceId, newState, eventKind] of [
      ['held', 'completed', 'complete'],
      ['reappeared', 'completed', 'complete'],
      ['dismissed', 'dismissed', 'dismiss'],
    ] as const) {
      const actionId = hashActionId({
        accountId,
        siteId,
        sourceType: 'audit_finding',
        sourceId,
      });
      await appendActionEvent(getTestDb(), {
        accountId,
        siteId,
        actionId,
        sourceType: 'audit_finding',
        sourceIdRef: hashSourceIdRef({
          accountId,
          sourceType: 'audit_finding',
          sourceId,
        }),
        priorState: 'open',
        newState,
        eventKind,
        actorUserId: accountId,
        note: null,
        idempotencyKey: `idem-${actionId}`,
      });
    }

    const result = await listActionsForSite({
      accountId,
      siteId,
      locale: 'en',
      db: getTestDb(),
    });
    const bySourceId = new Map(result.items.map((i) => [i.sourceId, i]));
    expect(bySourceId.get('held')!.reappearedAfterFix).toBe(false);
    expect(bySourceId.get('reappeared')!.reappearedAfterFix).toBe(true);
    expect(bySourceId.get('dismissed')!.reappearedAfterFix).toBe(false);
    expect(bySourceId.get('analysis1:rec1')!.state).toBe('completed');
    expect(bySourceId.get('analysis1:rec1')!.reappearedAfterFix).toBe(false);
  });

  it('sorts by the deterministic tuple and caps affected URLs at 20', async () => {
    const { accountId, siteId } = await seedSite();
    const manyUrls = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => `https://ex.test/${prefix}-${i}`);
    registerStub('audit_finding', [
      candidate({
        sourceType: 'audit_finding',
        sourceId: 'r:effort-high',
        severity: 'warning',
        effort: 'high',
        affectedUrls: manyUrls(25, 'a'),
      }),
      candidate({
        sourceType: 'audit_finding',
        sourceId: 'r:critical',
        severity: 'critical',
        effort: 'high',
      }),
      candidate({
        sourceType: 'audit_finding',
        sourceId: 'r:effort-low',
        severity: 'warning',
        effort: 'low',
        affectedUrls: manyUrls(21, 'b'),
      }),
      candidate({
        sourceType: 'audit_finding',
        sourceId: 'r:impact-high',
        severity: 'warning',
        firstPartyImpact: 'high',
      }),
    ]);

    const result = await listActionsForSite({
      accountId,
      siteId,
      locale: 'en',
      db: getTestDb(),
    });
    // critical first; then impact high; then the two warning/none candidates
    // — both have ≥20 urls capped equal, so effort low beats effort high.
    expect(result.items.map((i) => i.sourceId)).toEqual([
      'r:critical',
      'r:impact-high',
      'r:effort-low',
      'r:effort-high',
    ]);
    expect(result.items[2]!.affectedUrls).toHaveLength(20);
    expect(result.items[3]!.affectedUrls).toHaveLength(20);
  });

  it('applies state, source, severity, confidence, and effort filters before pagination', async () => {
    const { accountId, siteId } = await seedSite();
    registerStub('confirmed_rank_drop', [
      candidate({ sourceId: 'a', severity: 'critical', confidence: 'high', effort: 'low' }),
      candidate({ sourceId: 'b', severity: 'info', confidence: 'low', effort: 'high', sourceState: 'planned' }),
    ]);
    registerStub('gsc_decline', [
      candidate({
        sourceType: 'gsc_decline',
        sourceId: 'g',
        severity: 'warning',
        confidence: 'medium',
        effort: 'medium',
        copyKeys: {
          problem: 'actions.gscDecline.problem',
          whyItMatters: 'actions.gscDecline.whyItMatters',
          nextStep: 'actions.gscDecline.nextStep',
        },
        copyVars: { declinePct: 30, currentClicks: 70, baselineClicks: 100 },
      }),
    ]);

    const base = { accountId, siteId, locale: 'en' as const, db: getTestDb() };
    const byState = await listActionsForSite({ ...base, filters: { state: ['planned'] } });
    expect(byState.items.map((i) => i.sourceId)).toEqual(['b']);

    const bySource = await listActionsForSite({ ...base, filters: { source: ['gsc_decline'] } });
    expect(bySource.items.map((i) => i.sourceId)).toEqual(['g']);

    const bySeverity = await listActionsForSite({ ...base, filters: { severity: ['critical'] } });
    expect(bySeverity.items.map((i) => i.sourceId)).toEqual(['a']);

    const byConfidence = await listActionsForSite({ ...base, filters: { confidence: ['medium'] } });
    expect(byConfidence.items.map((i) => i.sourceId)).toEqual(['g']);

    const byEffort = await listActionsForSite({ ...base, filters: { effort: ['high'] } });
    expect(byEffort.items.map((i) => i.sourceId)).toEqual(['b']);

    const combined = await listActionsForSite({
      ...base,
      filters: { severity: ['critical', 'warning'], source: ['confirmed_rank_drop'] },
    });
    expect(combined.items.map((i) => i.sourceId)).toEqual(['a']);
  });

  it('paginates deterministically and caps the limit', async () => {
    const { accountId, siteId } = await seedSite();
    registerStub(
      'confirmed_rank_drop',
      Array.from({ length: 25 }, (_, i) =>
        candidate({ sourceId: `cand-${String(i).padStart(2, '0')}` }),
      ),
    );

    const base = { accountId, siteId, locale: 'en' as const, db: getTestDb() };
    const defaultPage = await listActionsForSite(base);
    expect(defaultPage.items).toHaveLength(20);
    expect(defaultPage.nextCursor).toBe('20');

    const small = await listActionsForSite({ ...base, limit: 5 });
    expect(small.items).toHaveLength(5);
    expect(small.nextCursor).toBe('5');

    const capped = await listActionsForSite({ ...base, limit: 100 });
    expect(capped.items).toHaveLength(25);
    expect(capped.nextCursor).toBeNull();

    // Cursor traversal: the second page resumes exactly where the first
    // stopped and never repeats an item.
    const secondPage = await listActionsForSite({
      ...base,
      cursor: defaultPage.nextCursor!,
    });
    expect(secondPage.items).toHaveLength(5);
    expect(secondPage.nextCursor).toBeNull();
    const firstIds = new Set(defaultPage.items.map((i) => i.id));
    for (const item of secondPage.items) {
      expect(firstIds.has(item.id)).toBe(false);
    }
    expect([...defaultPage.items, ...secondPage.items].map((i) => i.sourceId)).toEqual(
      capped.items.map((i) => i.sourceId),
    );
  });

  it('marks a throwing reader unavailable while other sources keep serving', async () => {
    const { accountId, siteId } = await seedSite();
    registerSource('gsc_decline', async () => {
      throw new Error('boom');
    });
    registerStub('confirmed_rank_drop', [candidate()]);

    const result = await listActionsForSite({
      accountId,
      siteId,
      locale: 'en',
      db: getTestDb(),
    });
    expect(result.sourceStatus.gsc_decline).toEqual({ status: 'unavailable' });
    expect(result.sourceStatus.confirmed_rank_drop?.status).toBe('available');
    expect(result.items).toHaveLength(1);
  });
});

describe('getActionHistory', () => {
  it('serves ordered history for a live owned action and 404s unknown hashes', async () => {
    const { accountId, siteId } = await seedSite();
    registerStub('confirmed_rank_drop', [candidate({ sourceId: 'rank-1' })]);
    const actionId = hashActionId({
      accountId,
      siteId,
      sourceType: 'confirmed_rank_drop',
      sourceId: 'rank-1',
    });

    await mutateActionState({
      accountId,
      siteId,
      actionId,
      actorUserId: accountId,
      newState: 'planned',
      expectedVersion: 0,
      note: 'start next sprint',
      clientKey: 'ck-1',
      db: getTestDb(),
    });
    await mutateActionState({
      accountId,
      siteId,
      actionId,
      actorUserId: accountId,
      newState: 'completed',
      expectedVersion: 1,
      note: null,
      clientKey: 'ck-2',
      db: getTestDb(),
    });

    const history = await getActionHistory({
      accountId,
      siteId,
      actionId,
      db: getTestDb(),
      locale: 'en',
    });
    expect(history.entries.map((e) => [e.ordinal, e.newState, e.eventKind])).toEqual([
      [1, 'planned', 'plan'],
      [2, 'completed', 'complete'],
    ]);
    expect(history.entries[0]!.priorState).toBe('open');
    expect(history.entries[0]!.note).toBe('start next sprint');
    expect(history.entries[0]!.actorUserId).toBe(accountId);
    expect(Date.parse(history.entries[0]!.createdAt)).not.toBeNaN();

    // Unknown / vanished action hash → 404, never an acknowledged empty list.
    await expect(
      getActionHistory({
        accountId,
        siteId,
        actionId: 'f'.repeat(64),
        db: getTestDb(),
        locale: 'en',
      }),
    ).rejects.toMatchObject({ status: 404 });

    // Cross-account site → 404 before any event read.
    await expect(
      getActionHistory({
        accountId: new Types.ObjectId().toHexString(),
        siteId,
        actionId,
        db: getTestDb(),
        locale: 'en',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('actions events repo', () => {
  it('replays the same idempotency key and rejects a mismatched reuse', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const input = {
      accountId,
      siteId: new Types.ObjectId().toHexString(),
      actionId: 'a'.repeat(64),
      sourceType: 'confirmed_rank_drop' as const,
      sourceIdRef: 'b'.repeat(64),
      priorState: 'open' as const,
      newState: 'planned' as const,
      eventKind: 'plan' as const,
      actorUserId: accountId,
      note: null,
      idempotencyKey: 'idem-repo-1',
    };
    const first = await appendActionEvent(getTestDb(), input);
    expect(first.replayed).toBe(false);
    expect(Number(first.row.ordinal)).toBe(1);

    const replay = await appendActionEvent(getTestDb(), input);
    expect(replay.replayed).toBe(true);
    expect(replay.row.id).toBe(first.row.id);

    await expect(
      appendActionEvent(getTestDb(), { ...input, newState: 'dismissed', eventKind: 'dismiss' }),
    ).rejects.toMatchObject({ status: 409 });

    const second = await appendActionEvent(getTestDb(), {
      ...input,
      priorState: 'planned',
      newState: 'completed',
      eventKind: 'complete',
      idempotencyKey: 'idem-repo-2',
    });
    expect(Number(second.row.ordinal)).toBe(2);

    const latest = await findLatestEventForAction(getTestDb(), accountId, input.actionId);
    expect(latest?.newState).toBe('completed');

    const latestMap = await findLatestEventsForActions(getTestDb(), accountId, [input.actionId]);
    expect(latestMap.get(input.actionId)?.newState).toBe('completed');
    expect(await findLatestEventsForActions(getTestDb(), accountId, [])).toEqual(new Map());

    const siteHistory = await listSiteEventHistory(getTestDb(), accountId, input.siteId);
    expect(siteHistory).toHaveLength(2);

    const exported = await exportAllEventsForAccount(getTestDb(), accountId);
    expect(exported.map((row) => Number(row.ordinal))).toEqual([1, 2]);

    expect(await deleteAllEventsForAccount(getTestDb(), accountId)).toBe(2);
    expect(await exportAllEventsForAccount(getTestDb(), accountId)).toEqual([]);
  });
});

describe('mutateActionState', () => {
  it('resolves through failing readers, blocks stale versions and invalid transitions, and no-ops same-state repeats', async () => {
    const { accountId, siteId } = await seedSite();
    // A throwing reader earlier in the registry must not hide later sources.
    registerSource('audit_finding', async () => {
      throw new Error('reader down');
    });
    registerStub('confirmed_rank_drop', [candidate({ sourceId: 'rank-1' })]);
    const actionId = hashActionId({
      accountId,
      siteId,
      sourceType: 'confirmed_rank_drop',
      sourceId: 'rank-1',
    });
    const base = {
      accountId,
      siteId,
      actionId,
      actorUserId: accountId,
      note: null,
      db: getTestDb(),
    };

    const planned = await mutateActionState({
      ...base,
      newState: 'planned',
      expectedVersion: 0,
      clientKey: 'ck-a',
    });
    expect(planned).toMatchObject({ state: 'planned', version: 1, replayed: false });

    // Same-state repeat at the current version → no-op replay, no new event.
    const repeat = await mutateActionState({
      ...base,
      newState: 'planned',
      expectedVersion: 1,
      clientKey: 'ck-b',
    });
    expect(repeat).toMatchObject({ state: 'planned', version: 1, replayed: true });

    // Stale expected version → 409.
    await expect(
      mutateActionState({
        ...base,
        newState: 'completed',
        expectedVersion: 0,
        clientKey: 'ck-c',
      }),
    ).rejects.toMatchObject({ status: 409, message: 'actions.errors.staleVersion' });

    // planned → dismissed → completed is not an allowed transition.
    await mutateActionState({
      ...base,
      newState: 'dismissed',
      expectedVersion: 1,
      clientKey: 'ck-d',
    });
    await expect(
      mutateActionState({
        ...base,
        newState: 'completed',
        expectedVersion: 2,
        clientKey: 'ck-e',
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'actions.errors.invalidTransition',
    });

    // Unknown action hash → 404.
    await expect(
      mutateActionState({
        ...base,
        actionId: 'e'.repeat(64),
        newState: 'planned',
        expectedVersion: 0,
        clientKey: 'ck-f',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('delegates content sources instead of double-writing action events', async () => {
    const { accountId, siteId } = await seedSite();
    registerStub('content_recommendation', [
      candidate({
        sourceType: 'content_recommendation',
        sourceId: 'analysis1:rec1',
        sourceState: 'open',
      }),
    ]);
    registerStub('citation_gap', [
      candidate({
        sourceType: 'citation_gap',
        sourceId: 'citation-gap:abc',
        sourceState: 'open',
      }),
    ]);

    for (const [sourceType, sourceId] of [
      ['content_recommendation', 'analysis1:rec1'],
      ['citation_gap', 'citation-gap:abc'],
    ] as const) {
      await expect(
        mutateActionState({
          accountId,
          siteId,
          actionId: hashActionId({ accountId, siteId, sourceType, sourceId }),
          actorUserId: accountId,
          newState: 'planned',
          expectedVersion: 0,
          note: null,
          clientKey: `ck-${sourceType}`,
          db: getTestDb(),
        }),
      ).rejects.toMatchObject({
        status: 409,
        message: 'actions.errors.contentDelegation',
      });
    }
    // No event was written for either content source.
    expect(await exportAllEventsForAccount(getTestDb(), accountId)).toEqual([]);
  });
});

describe('source registry', () => {
  it('registers, lists, and clears readers', async () => {
    expect(getSourceReaders().size).toBe(0);
    registerStub('audit_finding', []);
    expect(getSourceReaders().size).toBe(1);
    clearSourceRegistry();
    expect(getSourceReaders().size).toBe(0);
  });
});
