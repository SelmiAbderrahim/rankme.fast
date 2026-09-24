import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Logger } from 'pino';
import {
  actionEvents,
  aiTrackedPrompts,
  audienceResearchSignalDecisionEvents,
  gscSearchAppearance,
  keywords,
  rankDropConfirmations,
  rankings,
  sitePulseSubscriptions,
  teamMembers,
  user,
  weeklyPulseDigestProjections,
  weeklyPulseRuns,
} from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import type { ActionItem, ListActionsResult } from '../actions/index.js';
import { Site } from '../sites/sites.model.js';
import type { DeliverPulseDigestDeps } from './delivery.service.js';
import type { DigestRendererDeps } from './digest.renderer.js';
import {
  createWeeklyPulseProductionPorts,
  WEEKLY_PULSE_COMPARISON_WINDOW_MS,
} from './production.ports.js';

const ACCOUNT_A = '111111111111111111111111';
const ACCOUNT_B = '222222222222222222222222';
const ACCOUNT_C = '333333333333333333333333';
const SITE_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SITE_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const WINDOW_END = new Date('2026-07-15T12:00:00.000Z');

function logger(): Logger {
  const noop = () => undefined;
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => logger(),
  } as unknown as Logger;
}

function item(
  id: string,
  state: ActionItem['state'],
  affectedUrls: readonly string[] = [`https://example.com/${id}`],
): ActionItem {
  return {
    id,
    siteId: SITE_A,
    sourceType: 'audit_finding',
    sourceId: `source-${id}`,
    sourceLink: `/sites/${SITE_A}?tab=actions&action=${id}`,
    problem: `Problem ${id}`,
    whyItMatters: `Why ${id}`,
    nextStep: `Fix ${id}`,
    copy: {
      problem: {
        messageKey: 'weeklyPulse.actions.targetUnavailable',
        ...(id === 'action-open' ? { messageVars: { count: 1 } } : {}),
      },
      whyItMatters: { messageKey: 'weeklyPulse.actions.open' },
      nextStep: {
        messageKey: 'weeklyPulse.actions.open',
        ...(id === 'action-regressed' ? { messageVars: { count: 1 } } : {}),
      },
    },
    affectedUrls,
    evidence: [],
    severity: 'warning',
    firstPartyImpact: 'medium',
    confidence: 'high',
    effort: 'low',
    state,
    version: 1,
    reappearedAfterFix: false,
    observedAt: '2026-07-14T00:00:00.000Z',
    lastVerifiedAt: null,
    retest: { available: false },
  };
}

let mongoUri: string;

beforeAll(async () => {
  mongoUri = await startMemoryMongo();
  await mongoose.connect(mongoUri);
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
  await Site.create([
    {
      _id: new mongoose.Types.ObjectId(SITE_A),
      accountId: new mongoose.Types.ObjectId(ACCOUNT_A),
      url: 'https://example.com',
      domain: 'example.com',
      displayName: 'Example A',
      gscPropertyUrl: 'sc-domain:example.com',
    },
    {
      _id: new mongoose.Types.ObjectId(SITE_B),
      accountId: new mongoose.Types.ObjectId(ACCOUNT_B),
      url: 'https://example.org',
      domain: 'example.org',
      displayName: 'Example B',
    },
  ]);
});

describe('Weekly Pulse production collection ports', () => {
  it('scopes market, cohort, ranks, actions, and audience decisions by account/site/window', async () => {
    const db = getTestDb();
    const [keywordA, keywordB] = await db
      .insert(keywords)
      .values([
        {
          accountId: ACCOUNT_A,
          siteId: SITE_A,
          phrase: 'owned keyword',
          locationCode: 2840,
          languageCode: 'en',
          device: 'mobile',
          engine: 'google',
        },
        {
          accountId: ACCOUNT_B,
          siteId: SITE_B,
          phrase: 'foreign keyword',
          locationCode: 2276,
          languageCode: 'de',
          device: 'desktop',
          engine: 'google',
        },
      ])
      .returning();
    await db.insert(aiTrackedPrompts).values([
      { accountId: ACCOUNT_A, siteId: SITE_A, prompt: 'owned prompt' },
      { accountId: ACCOUNT_B, siteId: SITE_B, prompt: 'foreign prompt' },
    ]);
    await db.insert(keywords).values({
      accountId: ACCOUNT_A,
      siteId: 'cccccccccccccccccccccccc',
      phrase: 'US German keyword',
      locationCode: 2840,
      languageCode: 'de',
      device: 'desktop',
      engine: 'google',
    });
    const [rankingA, rankingB] = await db
      .insert(rankings)
      .values([
        {
          keywordId: keywordA!.id,
          position: 12,
          rankAbsolute: 12,
          checkedAt: new Date('2026-07-14T00:00:00.000Z'),
          source: 'fresh',
          engine: 'google',
        },
        {
          keywordId: keywordB!.id,
          position: 20,
          rankAbsolute: 20,
          checkedAt: new Date('2026-07-14T00:00:00.000Z'),
          source: 'fresh',
          engine: 'google',
        },
      ])
      .returning();
    await db.insert(rankDropConfirmations).values([
      {
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        keywordId: keywordA!.id,
        rankingId: rankingA!.id,
        state: 'confirmed',
        reason: null,
        previousPosition: 3,
        candidatePosition: 12,
        confirmationPosition: 11,
        candidateObservedAt: new Date('2026-07-13T00:00:00.000Z'),
        confirmationObservedAt: new Date('2026-07-14T00:00:00.000Z'),
        locationCode: 2840,
        languageCode: 'en',
        device: 'mobile',
        attemptReservedAt: new Date('2026-07-13T00:00:00.000Z'),
        settledAt: new Date('2026-07-14T00:00:00.000Z'),
      },
      {
        accountId: ACCOUNT_B,
        siteId: SITE_B,
        keywordId: keywordB!.id,
        rankingId: rankingB!.id,
        state: 'confirmed',
        reason: null,
        previousPosition: 2,
        candidatePosition: 20,
        confirmationPosition: 19,
        candidateObservedAt: new Date('2026-07-13T00:00:00.000Z'),
        confirmationObservedAt: new Date('2026-07-14T00:00:00.000Z'),
        locationCode: 2276,
        languageCode: 'de',
        device: 'desktop',
        attemptReservedAt: new Date('2026-07-13T00:00:00.000Z'),
        settledAt: new Date('2026-07-14T00:00:00.000Z'),
      },
    ]);
    await db.insert(actionEvents).values([
      {
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        actionId: 'action-complete',
        sourceType: 'audit_finding',
        sourceIdRef: 'a'.repeat(64),
        priorState: 'open',
        newState: 'completed',
        eventKind: 'complete',
        actorUserId: ACCOUNT_A,
        ordinal: 1,
        idempotencyKey: 'pulse-action-complete',
        createdAt: new Date('2026-07-14T01:00:00.000Z'),
      },
      {
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        actionId: 'missing-regressed',
        sourceType: 'audit_finding',
        sourceIdRef: 'd'.repeat(64),
        priorState: 'completed',
        newState: 'planned',
        eventKind: 'plan',
        actorUserId: ACCOUNT_A,
        ordinal: 1,
        idempotencyKey: 'pulse-action-missing-regressed',
        createdAt: new Date('2026-07-14T01:30:00.000Z'),
      },
      {
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        actionId: 'missing-completed',
        sourceType: 'audit_finding',
        sourceIdRef: 'e'.repeat(64),
        priorState: 'open',
        newState: 'completed',
        eventKind: 'complete',
        actorUserId: ACCOUNT_A,
        ordinal: 1,
        idempotencyKey: 'pulse-action-missing-completed',
        createdAt: new Date('2026-07-14T00:30:00.000Z'),
      },
      {
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        actionId: 'ignored-action',
        sourceType: 'audit_finding',
        sourceIdRef: 'f'.repeat(64),
        priorState: 'open',
        newState: 'planned',
        eventKind: 'plan',
        actorUserId: ACCOUNT_A,
        ordinal: 1,
        idempotencyKey: 'pulse-action-ignored',
        createdAt: new Date('2026-07-14T00:15:00.000Z'),
      },
      {
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        actionId: 'action-complete',
        sourceType: 'audit_finding',
        sourceIdRef: 'a'.repeat(64),
        priorState: 'planned',
        newState: 'completed',
        eventKind: 'complete',
        actorUserId: ACCOUNT_A,
        ordinal: 2,
        idempotencyKey: 'pulse-action-complete-older',
        createdAt: new Date('2026-07-13T00:00:00.000Z'),
      },
      {
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        actionId: 'action-regressed',
        sourceType: 'audit_finding',
        sourceIdRef: 'b'.repeat(64),
        priorState: 'completed',
        newState: 'open',
        eventKind: 'reopen',
        actorUserId: ACCOUNT_A,
        ordinal: 1,
        idempotencyKey: 'pulse-action-regressed',
        createdAt: new Date('2026-07-14T02:00:00.000Z'),
      },
      {
        accountId: ACCOUNT_B,
        siteId: SITE_B,
        actionId: 'foreign-action',
        sourceType: 'audit_finding',
        sourceIdRef: 'c'.repeat(64),
        priorState: 'open',
        newState: 'completed',
        eventKind: 'complete',
        actorUserId: ACCOUNT_B,
        ordinal: 1,
        idempotencyKey: 'pulse-action-foreign',
        createdAt: new Date('2026-07-14T01:00:00.000Z'),
      },
    ]);
    await db.insert(audienceResearchSignalDecisionEvents).values([
      {
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        runId: 'run-owned',
        signalId: 'signal-owned',
        decision: 'accepted',
        destination: 'seo',
        downstreamId: 'seo:owned',
        idempotencyKey: 'pulse-decision-owned',
        decidedByUserId: ACCOUNT_A,
        decidedAt: new Date('2026-07-14T03:00:00.000Z'),
      },
      {
        accountId: ACCOUNT_B,
        siteId: SITE_B,
        runId: 'run-foreign',
        signalId: 'signal-foreign',
        decision: 'accepted',
        destination: 'seo',
        downstreamId: 'seo:foreign',
        idempotencyKey: 'pulse-decision-foreign',
        decidedByUserId: ACCOUNT_B,
        decidedAt: new Date('2026-07-14T03:00:00.000Z'),
      },
    ]);

    const listActions = vi.fn(async (input: {
      accountId: string;
      siteId: string;
      filters?: { state?: readonly string[] };
      limit?: number;
    }): Promise<ListActionsResult> => {
      expect(input.accountId).toBe(ACCOUNT_A);
      expect(input.siteId).toBe(SITE_A);
      const all = [
        item('action-complete', 'completed'),
        item('action-regressed', 'open', []),
        item('action-open', 'open', []),
      ];
      const items = input.filters?.state
        ? all.filter((action) => input.filters!.state!.includes(action.state))
        : all;
      return { items: items.slice(0, input.limit), sourceStatus: {}, nextCursor: null };
    });
    const production = createWeeklyPulseProductionPorts({
      db,
      logger: logger(),
      listActions: listActions as never,
      loadStoredBrandRadarScans: async () => ({ inWindow: [], baselines: [] }),
    });

    await expect(production.resolveSite({ accountId: ACCOUNT_A, siteId: SITE_A }))
      .resolves.toEqual({ siteDomain: 'example.com' });
    await expect(production.resolveSite({ accountId: ACCOUNT_B, siteId: SITE_A }))
      .resolves.toBeNull();
    await expect(production.collection.loadSiteMarket({ accountId: ACCOUNT_A, siteId: SITE_A }))
      .resolves.toEqual({
        value: {
          country: 'US',
          region: null,
          city: null,
          language: 'en',
          device: 'mobile',
        },
      });
    const cohort = await production.collection.loadPromptCohort({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
    });
    expect(cohort?.prompts).toEqual(['owned prompt']);
    expect(cohort?.id).toMatch(/^tracked-prompts:[0-9a-f]{64}$/);
    await expect(production.collection.loadCoverage({ accountId: ACCOUNT_A, siteId: SITE_A }))
      .resolves.toMatchObject({
        cells: [
          { engine: 'google', supported: true },
          { engine: 'chat_gpt', supported: true },
        ],
      });
    await expect(production.collection.loadCoverage({ accountId: ACCOUNT_B, siteId: SITE_B }))
      .resolves.toMatchObject({
        cells: [
          { engine: 'google', supported: false, reason: 'unsupported_market' },
          { engine: 'chat_gpt', supported: false, reason: 'unsupported_market' },
        ],
      });
    await expect(production.collection.loadCoverage({
      accountId: ACCOUNT_A,
      siteId: 'cccccccccccccccccccccccc',
    })).resolves.toMatchObject({
      cells: [
        { supported: false, reason: 'unsupported_market' },
        { supported: false, reason: 'unsupported_market' },
      ],
    });
    await expect(production.collection.loadSiteMarket({
      accountId: ACCOUNT_A,
      siteId: 'dddddddddddddddddddddddd',
    })).resolves.toBeNull();
    await expect(production.collection.loadPromptCohort({
      accountId: ACCOUNT_A,
      siteId: 'dddddddddddddddddddddddd',
    })).resolves.toBeNull();
    await expect(production.collection.loadCoverage({
      accountId: ACCOUNT_A,
      siteId: 'dddddddddddddddddddddddd',
    })).resolves.toEqual({ cells: [] });

    const drops = await production.collection.loadConfirmedRankDrops({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      windowEnd: WINDOW_END,
    });
    expect(drops).toEqual([
      {
        keyword: 'owned keyword',
        priorRank: 3,
        currentRank: 11,
        confirmedAt: '2026-07-14T00:00:00.000Z',
      },
    ]);
    const open = await production.collection.loadTopOpenActions({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      limit: 3,
    });
    expect(open.map((action) => action.actionId)).toEqual([
      'action-regressed',
      'action-open',
    ]);
    expect(open[1]).toMatchObject({
      targetUrl: null,
      targetMessageKey: 'weeklyPulse.actions.targetUnavailable',
    });
    await expect(production.collection.loadTopOpenActions({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      limit: 1,
    })).resolves.toHaveLength(1);
    const transitions = await production.collection.loadActionTransitions({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      windowEnd: WINDOW_END,
    });
    expect(transitions.map((action) => [action.actionId, action.state])).toEqual([
      ['action-regressed', 'regressed'],
      ['missing-regressed', 'regressed'],
      ['action-complete', 'completed'],
      ['missing-completed', 'completed'],
    ]);
    expect(transitions.find((action) => action.actionId === 'missing-regressed'))
      .toMatchObject({
        messageKey: 'weeklyPulse.actions.regressed',
        targetMessageKey: 'weeklyPulse.actions.targetUnavailable',
      });
    expect(transitions.find((action) => action.actionId === 'missing-completed'))
      .toMatchObject({
        messageKey: 'weeklyPulse.actions.completed',
        targetMessageKey: 'weeklyPulse.actions.targetUnavailable',
      });
    await expect(production.collection.loadActionTransitions({
      accountId: ACCOUNT_A,
      siteId: 'dddddddddddddddddddddddd',
      windowEnd: WINDOW_END,
    })).resolves.toEqual([]);
    const decisions = await production.collection.loadAudienceDecisions({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      windowEnd: WINDOW_END,
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.acceptedAt).toBe('2026-07-14T03:00:00.000Z');
    await expect(production.collection.loadAudienceDecisions({
      accountId: ACCOUNT_A,
      siteId: 'dddddddddddddddddddddddd',
      windowEnd: WINDOW_END,
    })).resolves.toEqual([]);
    expect(WEEKLY_PULSE_COMPARISON_WINDOW_MS).toBe(604_800_000);

    await Site.updateOne({ _id: SITE_A }, { $set: { paused: true } });
    await expect(production.resolveSite({ accountId: ACCOUNT_A, siteId: SITE_A }))
      .resolves.toBeNull();
  });
});

describe('Weekly Pulse production digest/delivery hand-off', () => {
  it('wires stored GSC/site/recipient reads and invokes render then delivery', async () => {
    const db = getTestDb();
    await db.insert(gscSearchAppearance).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      bindingGenerationId: 'legacy',
      property: 'sc-domain:example.com',
      snapshotDate: '2026-07-14',
      windowDays: 28,
      rawAppearance: 'AI_OVERVIEWS',
      classificationSlug: 'ai_overviews',
      classifiedGenerative: true,
      clicks: 4,
      impressions: 100,
      ctr: 0.04,
      position: 3,
      observationMeta: {},
    });
    await db.insert(user).values([
      { id: ACCOUNT_A, name: 'Owner', email: 'owner@example.com', emailVerified: true },
      { id: ACCOUNT_B, name: 'Member', email: 'member@example.com', emailVerified: true },
      { id: ACCOUNT_C, name: 'Admin', email: 'admin@example.com', emailVerified: true },
    ]);
    await db.insert(teamMembers).values([
      {
        teamId: ACCOUNT_A,
        userId: ACCOUNT_B,
        email: 'member@example.com',
        role: 'member',
        inviteTokenHash: 'pulse-member-token',
        invitedBy: ACCOUNT_A,
        acceptedAt: new Date('2026-07-01T00:00:00.000Z'),
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      {
        // Digest eligibility keys off acceptance, never off the team role —
        // the `admin` role added in rankme-enterprise-orgs 02 must resolve
        // exactly like `member` here.
        teamId: ACCOUNT_A,
        userId: ACCOUNT_C,
        email: 'admin@example.com',
        role: 'admin',
        inviteTokenHash: 'pulse-admin-token',
        invitedBy: ACCOUNT_A,
        acceptedAt: new Date('2026-07-01T00:00:00.000Z'),
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);

    let rendererDeps: DigestRendererDeps | null = null;
    let deliveryDeps: DeliverPulseDigestDeps | null = null;
    const renderDigest = vi.fn(async (_runId: string, injected: DigestRendererDeps) => {
      rendererDeps = injected;
      return {} as never;
    });
    const deliverDigest = vi.fn(async (_runId: string, injected: DeliverPulseDigestDeps) => {
      deliveryDeps = injected;
      return { runId: _runId, attempted: 2, delivered: 2, suppressed: 0, errors: 0 };
    });
    const production = createWeeklyPulseProductionPorts({
      db,
      logger: logger(),
      listActions: vi.fn(async () => ({ items: [], sourceStatus: {}, nextCursor: null })) as never,
      renderDigest: renderDigest as never,
      deliverDigest: deliverDigest as never,
      sendDigestEmail: vi.fn(async () => ({ delivered: true })),
      emailTransportAvailable: () => true,
      loadStoredBrandRadarScans: async () => ({ inWindow: [], baselines: [] }),
    });
    const runId = '11111111-1111-4111-8111-111111111111';
    const outcome = await production.projectAndDeliver(runId);
    expect(outcome.delivered).toBe(2);
    expect(renderDigest).toHaveBeenCalledOnce();
    expect(deliverDigest).toHaveBeenCalledOnce();
    expect(rendererDeps).not.toBeNull();
    await expect(rendererDeps!.loadSiteLabel({ accountId: ACCOUNT_A, siteId: SITE_A }))
      .resolves.toBe('Example A');
    const gsc = await rendererDeps!.loadGscAppearance({ accountId: ACCOUNT_A, siteId: SITE_A });
    expect(gsc).toMatchObject({
      status: 'available',
      rows: [{ rawAppearance: 'AI_OVERVIEWS', isGenerative: true, clicks: 4 }],
    });
    await expect(rendererDeps!.loadSiteLabel({ accountId: ACCOUNT_A, siteId: SITE_B }))
      .resolves.toBe(SITE_B);
    await expect(rendererDeps!.loadGscAppearance({ accountId: ACCOUNT_A, siteId: SITE_B }))
      .resolves.toBeNull();
    await expect(rendererDeps!.loadGscAppearance({ accountId: ACCOUNT_B, siteId: SITE_B }))
      .resolves.toEqual({ status: 'reconnect_required', window: null, rows: [] });
    await Site.updateOne(
      { _id: SITE_B },
      {
        $set: { gscPropertyUrl: 'sc-domain:example.org' },
        $unset: { displayName: '' },
      },
    );
    await expect(rendererDeps!.loadSiteLabel({ accountId: ACCOUNT_B, siteId: SITE_B }))
      .resolves.toBe('example.org');
    await expect(rendererDeps!.loadGscAppearance({ accountId: ACCOUNT_B, siteId: SITE_B }))
      .resolves.toEqual({ status: 'unavailable', window: null, rows: [] });

    await db.insert(weeklyPulseRuns).values([
      {
        id: '22222222-2222-4222-8222-222222222222',
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        isoWeek: '2026-W29',
        status: 'completed',
        marketSnapshot: {},
        promptCohortId: 'cohort-started',
        promptCohortVersion: 1,
        engineSurfaceSet: [],
        observationMeta: {},
        usageReference: {},
        counts: {},
        startedAt: WINDOW_END,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        isoWeek: '2026-W28',
        status: 'partial',
        marketSnapshot: {},
        promptCohortId: 'cohort-finished',
        promptCohortVersion: 1,
        engineSurfaceSet: [],
        observationMeta: {},
        usageReference: {},
        counts: {},
        finishedAt: WINDOW_END,
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        isoWeek: '2026-W27',
        status: 'completed',
        marketSnapshot: {},
        promptCohortId: 'cohort-epoch',
        promptCohortVersion: 1,
        engineSurfaceSet: [],
        observationMeta: {},
        usageReference: {},
        counts: {},
      },
    ]);
    await expect(rendererDeps!.loadConfirmedRankDrops({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      isoWeek: '2026-W29',
    })).resolves.toEqual([]);
    await expect(rendererDeps!.loadActionTransitions({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      isoWeek: '2026-W28',
    })).resolves.toEqual([]);
    await expect(rendererDeps!.loadConfirmedRankDrops({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      isoWeek: '2026-W27',
    })).resolves.toEqual([]);
    await expect(rendererDeps!.loadTopOpenActions({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      limit: 3,
    })).resolves.toEqual([]);
    await expect(rendererDeps!.loadBrandRadarScans({
      accountId: ACCOUNT_A,
      siteId: new mongoose.Types.ObjectId().toHexString(),
      windowStart: new Date(WINDOW_END.getTime() - WEEKLY_PULSE_COMPARISON_WINDOW_MS),
      windowEnd: WINDOW_END,
    })).resolves.toEqual({ inWindow: [], baselines: [] });
    expect(deliveryDeps).not.toBeNull();
    await expect(deliveryDeps!.resolveRecipient({ accountId: ACCOUNT_A, userId: ACCOUNT_A }))
      .resolves.toEqual({ email: 'owner@example.com', membership: 'active' });
    await expect(deliveryDeps!.resolveRecipient({ accountId: ACCOUNT_A, userId: ACCOUNT_B }))
      .resolves.toEqual({ email: 'member@example.com', membership: 'active' });
    await expect(deliveryDeps!.resolveRecipient({
      accountId: ACCOUNT_A,
      userId: ACCOUNT_B,
      siteId: SITE_A,
    })).resolves.toEqual({ email: 'member@example.com', membership: 'active' });
    await expect(deliveryDeps!.resolveRecipient({
      accountId: ACCOUNT_B,
      userId: ACCOUNT_A,
      siteId: SITE_A,
    })).resolves.toEqual({ email: 'owner@example.com', membership: 'removed' });
    await expect(deliveryDeps!.resolveRecipient({ accountId: ACCOUNT_A, userId: ACCOUNT_C }))
      .resolves.toEqual({ email: 'admin@example.com', membership: 'active' });
    await expect(deliveryDeps!.resolveRecipient({ accountId: ACCOUNT_B, userId: ACCOUNT_A }))
      .resolves.toEqual({ email: 'owner@example.com', membership: 'removed' });
    await expect(deliveryDeps!.resolveRecipient({
      accountId: ACCOUNT_A,
      userId: '555555555555555555555555',
    })).resolves.toBeNull();
  });

  it('uses the real renderer, stored Brand Radar reader, and replay-safe delivery defaults', async () => {
    const db = getTestDb();
    const runId = '66666666-6666-4666-8666-666666666666';
    await db.insert(user).values({
      id: ACCOUNT_A,
      name: 'Owner',
      email: 'owner@example.com',
      emailVerified: true,
    });
    await db.insert(weeklyPulseRuns).values({
      id: runId,
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      isoWeek: '2026-W30',
      status: 'completed',
      marketSnapshot: {
        country: 'US',
        region: null,
        city: null,
        language: 'en',
        device: 'mobile',
      },
      promptCohortId: 'tracked-prompts:production-defaults',
      promptCohortVersion: 1,
      engineSurfaceSet: [
        { engine: 'google', surface: 'mentions', supported: true, reason: null },
      ],
      observationMeta: {},
      usageReference: {},
      counts: {},
      startedAt: WINDOW_END,
      finishedAt: WINDOW_END,
    });
    await db.insert(sitePulseSubscriptions).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      userId: ACCOUNT_A,
      locale: 'en',
      enabledAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    const production = createWeeklyPulseProductionPorts({ db, logger: logger() });
    await expect(production.projectAndDeliver(runId)).resolves.toMatchObject({
      runId,
      attempted: 1,
      delivered: 0,
      suppressed: 1,
      errors: 0,
    });
    const projections = await db.select().from(weeklyPulseDigestProjections);
    expect(projections).toHaveLength(1);

    // The retry consumes the frozen projection and the existing delivery
    // claim; it neither re-renders source data nor attempts a second email.
    await expect(production.projectAndDeliver(runId)).resolves.toMatchObject({
      runId,
      attempted: 1,
      delivered: 0,
      suppressed: 1,
      errors: 0,
    });
    await expect(db.select().from(weeklyPulseDigestProjections))
      .resolves.toHaveLength(1);
  });

  it('worker composition contains no null/empty Weekly Pulse placeholder ports', () => {
    const worker = readFileSync(new URL('../../worker.ts', import.meta.url), 'utf8');
    const start = worker.indexOf('const weeklyPulsePorts');
    const end = worker.indexOf('const weeklyPulseWorker', start);
    const wiring = worker.slice(start, end);
    expect(wiring).toContain('createWeeklyPulseProductionPorts');
    expect(wiring).toContain('projectAndDeliver: weeklyPulsePorts.projectAndDeliver');
    expect(wiring).not.toMatch(/load\w+:\s*async\s*\(.*\)\s*=>\s*(?:null|\[\])/);
  });
});
