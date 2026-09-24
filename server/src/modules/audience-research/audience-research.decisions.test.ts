/**
 * Prompt 11a — signal decision service tests.
 *
 * Focused unit tests against `decideAudienceResearchSignal`:
 *   - accept path (content + comparison_page + product + seo)
 *   - dismiss path (with and without reason)
 *   - cross-account 404 on run/signal
 *   - signal-not-in-run 404
 *   - destination mismatch 400 (invalidDestination)
 *   - cited-source-missing 404
 *   - idempotent replay returns duplicate: true
 *   - conflicting decision returns 409 (terminalConflict)
 *   - deterministic downstreamId for both CI and Next Actions paths
 */
import mongoose from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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
import { AudienceResearchRun } from './audience-research.model.js';
import { Site } from '../sites/index.js';
import { decideAudienceResearchSignal } from './audience-research.decisions.js';
import { audienceResearchSignalDecisionEvents } from '../../db/schema/index.js';
import {
  AUDIENCE_RESEARCH_RECOMMENDATION_PREFIX,
  createRecommendationForAudienceResearchSignal,
} from '../content-intelligence/index.js';
import type * as ContentIntelligenceModule from '../content-intelligence/index.js';

vi.mock('../content-intelligence/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ContentIntelligenceModule>();
  return {
    ...actual,
    createRecommendationForAudienceResearchSignal: vi.fn(
      actual.createRecommendationForAudienceResearchSignal,
    ),
  };
});

let mongoUri: string;

async function seedRunWithSignals(opts?: {
  accountId?: string;
  siteId?: string;
  suggestedRoute?: 'content' | 'comparison_page' | 'product' | 'seo';
  citedSourceIds?: readonly string[];
  runSourceIds?: readonly string[];
}) {
  const accountId = opts?.accountId ?? new mongoose.Types.ObjectId().toHexString();
  const siteId = opts?.siteId ?? new mongoose.Types.ObjectId().toHexString();

  await Site.create({
    _id: new mongoose.Types.ObjectId(siteId),
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${siteId.slice(0, 8)}.test`,
    domain: `${siteId.slice(0, 8)}.test`,
    displayName: 'Example',
  });

  const runSourceIds = opts?.runSourceIds ?? ['src-1', 'src-2'];
  const citedSourceIds = opts?.citedSourceIds ?? ['src-1'];
  const suggestedRoute = opts?.suggestedRoute ?? 'content';

  const run = await AudienceResearchRun.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    siteId: new mongoose.Types.ObjectId(siteId),
    state: 'completed',
    input: {
      siteMarket: { country: 'US', language: 'en-US', device: 'desktop' },
      competitorDomains: [],
      seedTopics: ['topic-a'],
      queryTemplateVersion: 1,
    },
    deterministicInputHash: `hash-${accountId}-${siteId}`,
    sources: runSourceIds.map((sourceId, i) => ({
      sourceId,
      canonicalUrl: `https://ex-${i}.test/page`,
      title: `Title ${i}`,
      sourceType: 'forum',
      registrableDomain: `ex-${i}.test`,
      observedAt: null,
      contentHash: `hash-${i}`,
      excerpt: 'Safe excerpt.',
      observationMeta: {
        sourceKind: 'forum',
        sourceLabel: null,
        observedAt: new Date().toISOString(),
        freshUntil: null,
        freshness: 'fresh',
        market: null,
        sampleCount: 1,
        coverageNoteKey: null,
      },
      discoveryQueryIds: ['q-1'],
    })),
    signals: [
      {
        signalId: 'signal-1',
        type: 'question',
        title: 'Sample title',
        summary: 'Sample summary.',
        suggestedRoute,
        citedSourceIds,
        independentDomainCount: citedSourceIds.length,
        sourceTypeCount: 1,
        mostRecentSourceObservedAt: null,
        confidence: 'medium',
      },
    ],
    terminal: { state: 'completed', reasonCode: 'ok', completedAt: new Date() },
    completedAt: new Date(),
  });

  return { accountId, siteId, runId: String(run._id), signalId: 'signal-1' };
}

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
});

afterEach(async () => {
  await clearCollections();
  await truncateAllTables();
  vi.restoreAllMocks();
});

/** Persist a site so ownership resolves, then hand the service a raw run. */
async function seedSiteWithRawRun(run: Record<string, unknown>) {
  const accountId = new mongoose.Types.ObjectId().toHexString();
  const siteId = new mongoose.Types.ObjectId().toHexString();
  await Site.create({
    _id: new mongoose.Types.ObjectId(siteId),
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${siteId.slice(0, 8)}.test`,
    domain: `${siteId.slice(0, 8)}.test`,
    displayName: 'Example',
  });
  vi.spyOn(AudienceResearchRun, 'findOne').mockResolvedValueOnce(run as never);
  return { accountId, siteId, runId: new mongoose.Types.ObjectId().toHexString() };
}

interface StubbedDecisionRow {
  signalId: string;
  decision: 'accepted' | 'dismissed';
  destination: string | null;
  downstreamId: string | null;
  deepLinkPath: string | null;
  decidedAt: Date;
  decidedByUserId: string;
}

function decisionRow(overrides: Partial<StubbedDecisionRow> = {}): StubbedDecisionRow {
  return {
    signalId: 'signal-1',
    decision: 'accepted',
    destination: 'content',
    downstreamId: 'audience-research:deadbeef',
    deepLinkPath: '/sites/x?tab=content',
    decidedAt: new Date('2026-05-05T00:00:00.000Z'),
    decidedByUserId: 'user-1',
    ...overrides,
  };
}

/**
 * Duck-typed drizzle handle. The probe/insert/replay ordering below cannot be
 * produced against the real schema — the two probes already 409 on any row a
 * real concurrent writer would have committed, so the `onConflictDoNothing`
 * miss is only observable with an injected handle.
 */
function stubDecisionDb(opts: {
  probes?: unknown[][];
  onInsert?: () => unknown[];
}): ApplicationDb {
  const probes = opts.probes ?? [[], [], []];
  let probeIndex = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const rows = probes[probeIndex] ?? [];
            probeIndex += 1;
            return rows;
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => (opts.onInsert ? opts.onInsert() : []),
        }),
      }),
    }),
  } as unknown as ApplicationDb;
}

describe('decideAudienceResearchSignal — accept content path', () => {
  it('creates a Content Intelligence recommendation and returns a deep link', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    const db = getTestDb();
    const result = await decideAudienceResearchSignal(db, {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'accepted',
      destination: 'content',
      idempotencyKey: 'idem-key-000001',
      decidedByUserId: seed.accountId,
    });
    expect(result.terminalDecision).toBe('accepted');
    expect(result.destination).toBe('content');
    expect(result.downstreamId).toMatch(
      new RegExp(`^${AUDIENCE_RESEARCH_RECOMMENDATION_PREFIX}[0-9a-f]{32}$`),
    );
    expect(result.deepLinkPath).toContain(
      `?tab=content&recommendation=${encodeURIComponent(result.downstreamId!)}`,
    );
    expect(result.duplicate).toBe(false);
  });

  it('idempotent replay returns duplicate: true', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'comparison_page' });
    const db = getTestDb();
    const first = await decideAudienceResearchSignal(db, {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'accepted',
      destination: 'comparison_page',
      idempotencyKey: 'idem-key-000002',
      decidedByUserId: seed.accountId,
    });
    expect(first.duplicate).toBe(false);
    const replay = await decideAudienceResearchSignal(db, {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'accepted',
      destination: 'comparison_page',
      idempotencyKey: 'idem-key-000002',
      decidedByUserId: seed.accountId,
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.downstreamId).toBe(first.downstreamId);
    expect(replay.decidedAt).toBe(first.decidedAt);
  });
});

describe('decideAudienceResearchSignal — accept product/seo path (Next Actions)', () => {
  it('returns a deterministic Next Actions source id + deep link', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'product' });
    const db = getTestDb();
    const first = await decideAudienceResearchSignal(db, {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'accepted',
      destination: 'product',
      idempotencyKey: 'idem-key-000003',
      decidedByUserId: seed.accountId,
    });
    expect(first.downstreamId).toMatch(/^product:[0-9a-f]{32}$/);
    expect(first.deepLinkPath).toContain('?tab=actions&action=');
  });

  it('accepts the seo destination on the seo route', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'seo' });
    const db = getTestDb();
    const first = await decideAudienceResearchSignal(db, {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'accepted',
      destination: 'seo',
      idempotencyKey: 'idem-key-000004',
      decidedByUserId: seed.accountId,
    });
    expect(first.downstreamId).toMatch(/^seo:[0-9a-f]{32}$/);
  });
});

describe('decideAudienceResearchSignal — dismiss path', () => {
  it('records dismissal without a downstream write', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    const db = getTestDb();
    const first = await decideAudienceResearchSignal(db, {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'dismissed',
      dismissReason: 'not_relevant',
      idempotencyKey: 'idem-key-000005',
      decidedByUserId: seed.accountId,
    });
    expect(first.terminalDecision).toBe('dismissed');
    expect(first.destination).toBeNull();
    expect(first.downstreamId).toBeNull();
    expect(first.deepLinkPath).toBeNull();
  });

  it('idempotent dismiss replay returns duplicate: true', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    const db = getTestDb();
    const first = await decideAudienceResearchSignal(db, {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'dismissed',
      idempotencyKey: 'idem-key-000006',
      decidedByUserId: seed.accountId,
    });
    expect(first.duplicate).toBe(false);
    const replay = await decideAudienceResearchSignal(db, {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'dismissed',
      idempotencyKey: 'idem-key-000006',
      decidedByUserId: seed.accountId,
    });
    expect(replay.duplicate).toBe(true);
  });
});

describe('decideAudienceResearchSignal — 404 semantics', () => {
  it('cross-account site → 404', async () => {
    const seed = await seedRunWithSignals();
    const otherAccount = new mongoose.Types.ObjectId().toHexString();
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        accountId: otherAccount,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'dismissed',
        idempotencyKey: 'idem-key-000007',
        decidedByUserId: otherAccount,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('signal-not-in-run → 404 with signalNotFound key', async () => {
    const seed = await seedRunWithSignals();
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: 'ghost-signal',
        decision: 'dismissed',
        idempotencyKey: 'idem-key-000008',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'audienceResearch.errors.signalNotFound',
    });
  });

  it('cited source not in run.sources → 404 with citedSourceMissing', async () => {
    // signal cites src-99 but the run has only src-1/src-2.
    const seed = await seedRunWithSignals({
      suggestedRoute: 'content',
      citedSourceIds: ['src-99'],
    });
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'accepted',
        destination: 'content',
        idempotencyKey: 'idem-key-000009',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'audienceResearch.errors.citedSourceMissing',
    });
  });

  it('empty citedSourceIds → 404 with citedSourceMissing', async () => {
    const seed = await seedRunWithSignals({
      suggestedRoute: 'content',
      citedSourceIds: [],
    });
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'accepted',
        destination: 'content',
        idempotencyKey: 'idem-key-000010',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'audienceResearch.errors.citedSourceMissing',
    });
  });
});

describe('decideAudienceResearchSignal — destination guard', () => {
  it('rejects a destination that does not match suggestedRoute → 400', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'accepted',
        destination: 'seo',
        idempotencyKey: 'idem-key-000011',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'audienceResearch.errors.invalidDestination',
    });
  });

  it('accept without a destination → 400', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'accepted',
        idempotencyKey: 'idem-key-000012',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'audienceResearch.errors.invalidDestination',
    });
  });
});

describe('decideAudienceResearchSignal — conflict semantics', () => {
  it('a colliding signalId on a DIFFERENT account never conflicts (account-scoped terminality)', async () => {
    // Regression: the terminal-conflict probe and the
    // `arsde_signal_terminal_uq` index were keyed on `signal_id` alone, so
    // the FIRST account to decide a signal id blocked every other account's
    // first decision on a colliding id with a 409 — a cross-account
    // isolation defect. Terminality is per (accountId, signalId).
    const db = getTestDb();
    const first = await seedRunWithSignals({ suggestedRoute: 'content' });
    const second = await seedRunWithSignals({ suggestedRoute: 'content' });
    expect(first.signalId).toBe(second.signalId); // deliberate id collision
    const a = await decideAudienceResearchSignal(db, {
      accountId: first.accountId,
      siteId: first.siteId,
      runId: first.runId,
      signalId: first.signalId,
      decision: 'accepted',
      destination: 'content',
      idempotencyKey: 'idem-key-xacct-1',
      decidedByUserId: first.accountId,
    });
    expect(a.duplicate).toBe(false);
    const b = await decideAudienceResearchSignal(db, {
      accountId: second.accountId,
      siteId: second.siteId,
      runId: second.runId,
      signalId: second.signalId,
      decision: 'accepted',
      destination: 'content',
      idempotencyKey: 'idem-key-xacct-2',
      decidedByUserId: second.accountId,
    });
    expect(b.duplicate).toBe(false);
    expect(b.downstreamId).not.toBe(a.downstreamId);
  });

  it('dismiss-after-accept → 409 terminalConflict', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    await decideAudienceResearchSignal(getTestDb(), {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'accepted',
      destination: 'content',
      idempotencyKey: 'idem-key-000013',
      decidedByUserId: seed.accountId,
    });
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'dismissed',
        idempotencyKey: 'idem-key-000014',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'audienceResearch.errors.terminalConflict',
    });
  });

  it('reusing the same idempotency key with a different decision → 409', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    await decideAudienceResearchSignal(getTestDb(), {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'dismissed',
      idempotencyKey: 'idem-key-000015',
      decidedByUserId: seed.accountId,
    });
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'accepted',
        destination: 'content',
        idempotencyKey: 'idem-key-000015',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'audienceResearch.errors.terminalConflict',
    });
  });
});

describe('decideAudienceResearchSignal — malformed ids and sparse runs', () => {
  it('404s a malformed site id before any lookup', async () => {
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        accountId: new mongoose.Types.ObjectId().toHexString(),
        siteId: 'not-an-object-id',
        runId: new mongoose.Types.ObjectId().toHexString(),
        signalId: 'signal-1',
        decision: 'dismissed',
        idempotencyKey: 'idem-key-000020',
        decidedByUserId: 'user-1',
      }),
    ).rejects.toMatchObject({ status: 404, message: 'sites.errors.notFound' });
  });

  it('404s a malformed run id', async () => {
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        accountId: new mongoose.Types.ObjectId().toHexString(),
        siteId: new mongoose.Types.ObjectId().toHexString(),
        runId: 'not-an-object-id',
        signalId: 'signal-1',
        decision: 'dismissed',
        idempotencyKey: 'idem-key-000021',
        decidedByUserId: 'user-1',
      }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'audienceResearch.errors.signalNotFound',
    });
  });

  it('404s a run id that does not exist on an owned site', async () => {
    const seed = await seedRunWithSignals();
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: new mongoose.Types.ObjectId().toHexString(),
        signalId: 'signal-1',
        decision: 'dismissed',
        idempotencyKey: 'idem-key-000022',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'audienceResearch.errors.signalNotFound',
    });
  });

  it('404s when the run carries no signals at all', async () => {
    const seed = await seedSiteWithRawRun({});
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        ...seed,
        signalId: 'signal-1',
        decision: 'dismissed',
        idempotencyKey: 'idem-key-000023',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'audienceResearch.errors.signalNotFound',
    });
  });

  it('404s an accept when the run carries no retained sources', async () => {
    const seed = await seedSiteWithRawRun({
      signals: [
        { signalId: 'signal-1', suggestedRoute: 'content', citedSourceIds: ['src-1'] },
      ],
    });
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        ...seed,
        signalId: 'signal-1',
        decision: 'accepted',
        destination: 'content',
        idempotencyKey: 'idem-key-000024',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'audienceResearch.errors.citedSourceMissing',
    });
  });

  it('404s an accept when the signal carries no citation list', async () => {
    const seed = await seedSiteWithRawRun({
      signals: [{ signalId: 'signal-1', suggestedRoute: 'content' }],
      sources: [{ sourceId: 'src-1' }],
    });
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        ...seed,
        signalId: 'signal-1',
        decision: 'accepted',
        destination: 'content',
        idempotencyKey: 'idem-key-000025',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'audienceResearch.errors.citedSourceMissing',
    });
  });
});

describe('decideAudienceResearchSignal — append-only terminality', () => {
  it('409s a repeat accept of the same shape under a fresh idempotency key', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    await decideAudienceResearchSignal(getTestDb(), {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'accepted',
      destination: 'content',
      idempotencyKey: 'idem-key-000030',
      decidedByUserId: seed.accountId,
    });
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'accepted',
        destination: 'content',
        idempotencyKey: 'idem-key-000031',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'audienceResearch.errors.terminalConflict',
    });
  });

  it('409s a repeat dismiss under a fresh idempotency key', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    await decideAudienceResearchSignal(getTestDb(), {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'dismissed',
      idempotencyKey: 'idem-key-000032',
      decidedByUserId: seed.accountId,
    });
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'dismissed',
        idempotencyKey: 'idem-key-000033',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'audienceResearch.errors.terminalConflict',
    });
  });
});

describe('decideAudienceResearchSignal — downstream and write failures', () => {
  it('502s when the Content Intelligence write throws', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    vi.mocked(createRecommendationForAudienceResearchSignal).mockImplementationOnce(() => {
      throw new Error('content intelligence unavailable');
    });
    await expect(
      decideAudienceResearchSignal(getTestDb(), {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'accepted',
        destination: 'content',
        idempotencyKey: 'idem-key-000040',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: 'audienceResearch.errors.downstreamFailure',
    });
    // Nothing was appended — the event write never ran.
    const rows = await getTestDb().select().from(audienceResearchSignalDecisionEvents);
    expect(rows).toHaveLength(0);
  });

  it('502s when the event append itself throws', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    const db = stubDecisionDb({
      onInsert: () => {
        throw new Error('unique index unavailable');
      },
    });
    await expect(
      decideAudienceResearchSignal(db, {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'accepted',
        destination: 'content',
        idempotencyKey: 'idem-key-000041',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: 'audienceResearch.errors.downstreamFailure',
    });
  });

  it('mirrors a concurrent accept that won the insert race', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    const winner = decisionRow({ signalId: seed.signalId });
    const db = stubDecisionDb({ probes: [[], [], [winner]] });
    const result = await decideAudienceResearchSignal(db, {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'accepted',
      destination: 'content',
      idempotencyKey: 'idem-key-000042',
      decidedByUserId: seed.accountId,
    });
    expect(result.duplicate).toBe(true);
    expect(result.downstreamId).toBe(winner.downstreamId);
    expect(result.decidedAt).toBe(winner.decidedAt.toISOString());
  });

  it('mirrors a concurrent dismiss that won the insert race', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    const winner = decisionRow({
      signalId: seed.signalId,
      decision: 'dismissed',
      destination: null,
      downstreamId: null,
      deepLinkPath: null,
    });
    const db = stubDecisionDb({ probes: [[], [], [winner]] });
    const result = await decideAudienceResearchSignal(db, {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'dismissed',
      idempotencyKey: 'idem-key-000043',
      decidedByUserId: seed.accountId,
    });
    expect(result.duplicate).toBe(true);
    expect(result.destination).toBeNull();
  });

  it('409s when the insert race is lost and nothing is visible on replay', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    const db = stubDecisionDb({ probes: [[], [], []] });
    await expect(
      decideAudienceResearchSignal(db, {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'accepted',
        destination: 'content',
        idempotencyKey: 'idem-key-000044',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('409s when the replayed row belongs to a different signal', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    const db = stubDecisionDb({
      probes: [[], [], [decisionRow({ signalId: 'some-other-signal' })]],
    });
    await expect(
      decideAudienceResearchSignal(db, {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'accepted',
        destination: 'content',
        idempotencyKey: 'idem-key-000045',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('409s when the replayed row carries a different decision', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    const db = stubDecisionDb({
      probes: [
        [],
        [],
        [decisionRow({ signalId: seed.signalId, decision: 'dismissed', destination: null })],
      ],
    });
    await expect(
      decideAudienceResearchSignal(db, {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'accepted',
        destination: 'content',
        idempotencyKey: 'idem-key-000046',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('409s when the replayed accept routed to a different destination', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    const db = stubDecisionDb({
      probes: [
        [],
        [],
        [decisionRow({ signalId: seed.signalId, destination: 'comparison_page' })],
      ],
    });
    await expect(
      decideAudienceResearchSignal(db, {
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        signalId: seed.signalId,
        decision: 'accepted',
        destination: 'content',
        idempotencyKey: 'idem-key-000047',
        decidedByUserId: seed.accountId,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('decideAudienceResearchSignal — DB row shape', () => {
  it('accepted rows persist destination + downstreamId; dismissed rows persist neither', async () => {
    const seed = await seedRunWithSignals({ suggestedRoute: 'content' });
    await decideAudienceResearchSignal(getTestDb(), {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: seed.signalId,
      decision: 'accepted',
      destination: 'content',
      idempotencyKey: 'idem-key-000016',
      decidedByUserId: seed.accountId,
    });
    const rows = await getTestDb().select().from(audienceResearchSignalDecisionEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.decision).toBe('accepted');
    expect(rows[0]!.destination).toBe('content');
    expect(rows[0]!.downstreamId).toMatch(
      new RegExp(`^${AUDIENCE_RESEARCH_RECOMMENDATION_PREFIX}[0-9a-f]{32}$`),
    );
    expect(rows[0]!.dismissReason).toBeNull();
  });
});
