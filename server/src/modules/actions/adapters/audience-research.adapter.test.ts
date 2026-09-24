/**
 * Audience-research Next Actions source adapter tests.
 *
 * The adapter surfaces accepted product/seo signal decisions as candidate
 * actions, reading the persisted `downstreamId` (never recomputing the
 * digest) and citing the immutable audience-research run sources as evidence.
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
} from 'vitest';
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
import { audienceResearchSignalDecisionEvents } from '../../../db/schema/index.js';
import { AudienceResearchRun } from '../../audience-research/audience-research.model.js';
import { decideAudienceResearchSignal } from '../../audience-research/audience-research.decisions.js';
import { Site } from '../../sites/index.js';
import { listActionsForSite } from '../actions.service.js';
import { registerBuiltInActionAdapters } from './index.js';
import { audienceResearchActionAdapter } from './audience-research.adapter.js';

let mongoUri: string;

const HOSTILE_EXCERPT = 'hostile-excerpt-SECRET-visitor-quote';

function observationMeta(observedAt: string) {
  return {
    sourceKind: 'forum',
    sourceLabel: null,
    observedAt,
    freshUntil: null,
    freshness: 'fresh',
    market: null,
    sampleCount: 1,
    coverageNoteKey: null,
  };
}

async function seedRun(opts: {
  accountId?: string;
  siteId?: string;
  routes: readonly ('product' | 'seo' | 'content')[];
  mostRecentSourceObservedAt?: string | null;
}) {
  const accountId =
    opts.accountId ?? new mongoose.Types.ObjectId().toHexString();
  const siteId = opts.siteId ?? new mongoose.Types.ObjectId().toHexString();

  await Site.create({
    _id: new mongoose.Types.ObjectId(siteId),
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${siteId.slice(0, 8)}.test`,
    domain: `${siteId.slice(0, 8)}.test`,
    displayName: 'Example',
  });

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
    sources: ['src-1', 'src-2'].map((sourceId, i) => ({
      sourceId,
      canonicalUrl: `https://ex-${i}.test/page`,
      title: `Title ${i}`,
      sourceType: 'forum',
      registrableDomain: `ex-${i}.test`,
      observedAt: null,
      contentHash: `hash-${i}`,
      excerpt: HOSTILE_EXCERPT,
      observationMeta: observationMeta(new Date().toISOString()),
      discoveryQueryIds: ['q-1'],
    })),
    signals: opts.routes.map((route, i) => ({
      signalId: `signal-${i + 1}`,
      type: 'question',
      title: `Signal title ${i + 1}`,
      summary: 'Sample summary.',
      suggestedRoute: route,
      citedSourceIds: ['src-1'],
      independentDomainCount: 1,
      sourceTypeCount: 1,
      mostRecentSourceObservedAt: opts.mostRecentSourceObservedAt ?? null,
      confidence: 'medium',
    })),
    terminal: { state: 'completed', reasonCode: 'ok', completedAt: new Date() },
    completedAt: new Date(),
  });

  return { accountId, siteId, runId: String(run._id) };
}

async function acceptSignal(input: {
  accountId: string;
  siteId: string;
  runId: string;
  signalId: string;
  destination: 'product' | 'seo';
  idempotencyKey: string;
}) {
  return decideAudienceResearchSignal(getTestDb(), {
    ...input,
    decision: 'accepted',
    decidedByUserId: input.accountId,
  });
}

beforeAll(async () => {
  mongoUri = await startMemoryMongo();
  await mongoose.connect(mongoUri);
  await startTestPostgres();
  registerBuiltInActionAdapters();
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
});

// Duck-typed drizzle stub — used only for rows that the DB check constraints
// make unreachable through the real write path.
function stubDbReturning(rows: unknown[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => rows,
          }),
        }),
      }),
    }),
  } as never;
}

describe('audienceResearchActionAdapter', () => {
  it('returns an empty available result when no decision exists', async () => {
    const seed = await seedRun({ routes: ['product'] });
    const result = await audienceResearchActionAdapter({
      accountId: seed.accountId,
      siteId: seed.siteId,
      db: getTestDb(),
    });
    expect(result).toEqual({ actions: [], status: 'available' });
  });

  it('emits accepted product and seo signals with the persisted downstreamId', async () => {
    const observed = '2026-07-01T00:00:00.000Z';
    const seed = await seedRun({
      routes: ['product', 'seo'],
      mostRecentSourceObservedAt: observed,
    });
    const product = await acceptSignal({
      ...seed,
      signalId: 'signal-1',
      destination: 'product',
      idempotencyKey: 'idem-adapter-001',
    });
    const seo = await acceptSignal({
      ...seed,
      signalId: 'signal-2',
      destination: 'seo',
      idempotencyKey: 'idem-adapter-002',
    });

    const result = await audienceResearchActionAdapter({
      accountId: seed.accountId,
      siteId: seed.siteId,
      db: getTestDb(),
    });

    expect(result.status).toBe('available');
    expect(result.actions).toHaveLength(2);
    const ids = result.actions.map((a) => a.sourceId);
    expect(ids).toContain(product.downstreamId);
    expect(ids).toContain(seo.downstreamId);

    // Newest decision first drives lastObservedAt.
    expect(result.lastObservedAt).toBe(result.actions[0]!.observedAt);

    const first = result.actions.find(
      (a) => a.sourceId === product.downstreamId,
    )!;
    expect(first.sourceType).toBe('audience_research');
    expect(first.confidence).toBe('medium');
    expect(first.severity).toBe('info');
    expect(first.firstPartyImpact).toBe('none');
    expect(first.effort).toBe('medium');
    expect(first.sourceState).toBe('open');
    expect(first.retestAvailable).toBe(false);
    expect(first.retestReasonKey).toBe('actions.errors.retestUnsupported');
    expect(first.copyVars).toEqual({ title: 'Signal title 1' });
    expect(first.lastVerifiedAt).toBe(observed);
    expect(first.evidence).toEqual([
      {
        sourceRef: 'src-1',
        url: 'https://ex-0.test/page',
        observation: expect.objectContaining({ sourceKind: 'forum' }),
      },
    ]);
    expect(first.affectedUrls).toEqual(['https://ex-0.test/page']);

    // The bounded source excerpt must never leave the run document.
    expect(JSON.stringify(result)).not.toContain(HOSTILE_EXCERPT);
  });

  it('excludes dismissed signals and content-destination accepts', async () => {
    const seed = await seedRun({ routes: ['content', 'product'] });
    await decideAudienceResearchSignal(getTestDb(), {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: 'signal-1',
      decision: 'accepted',
      destination: 'content',
      idempotencyKey: 'idem-adapter-010',
      decidedByUserId: seed.accountId,
    });
    await decideAudienceResearchSignal(getTestDb(), {
      accountId: seed.accountId,
      siteId: seed.siteId,
      runId: seed.runId,
      signalId: 'signal-2',
      decision: 'dismissed',
      dismissReason: 'not_relevant',
      idempotencyKey: 'idem-adapter-011',
      decidedByUserId: seed.accountId,
    });

    const result = await audienceResearchActionAdapter({
      accountId: seed.accountId,
      siteId: seed.siteId,
      db: getTestDb(),
    });
    expect(result.actions).toEqual([]);
  });

  it('never leaks another account or site', async () => {
    const seed = await seedRun({ routes: ['product'] });
    await acceptSignal({
      ...seed,
      signalId: 'signal-1',
      destination: 'product',
      idempotencyKey: 'idem-adapter-020',
    });

    const otherAccount = await audienceResearchActionAdapter({
      accountId: new mongoose.Types.ObjectId().toHexString(),
      siteId: seed.siteId,
      db: getTestDb(),
    });
    expect(otherAccount.actions).toEqual([]);

    const otherSite = await audienceResearchActionAdapter({
      accountId: seed.accountId,
      siteId: new mongoose.Types.ObjectId().toHexString(),
      db: getTestDb(),
    });
    expect(otherSite.actions).toEqual([]);
  });

  it('skips decisions whose run no longer exists', async () => {
    const seed = await seedRun({ routes: ['product'] });
    await acceptSignal({
      ...seed,
      signalId: 'signal-1',
      destination: 'product',
      idempotencyKey: 'idem-adapter-030',
    });
    await AudienceResearchRun.deleteOne({ _id: seed.runId });

    const result = await audienceResearchActionAdapter({
      accountId: seed.accountId,
      siteId: seed.siteId,
      db: getTestDb(),
    });
    expect(result.actions).toEqual([]);
    expect(result.status).toBe('available');
  });

  it('skips decisions whose signal was removed from the run', async () => {
    const seed = await seedRun({ routes: ['product'] });
    await acceptSignal({
      ...seed,
      signalId: 'signal-1',
      destination: 'product',
      idempotencyKey: 'idem-adapter-040',
    });
    await AudienceResearchRun.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(seed.runId) },
      { $set: { signals: [] } },
    );

    const result = await audienceResearchActionAdapter({
      accountId: seed.accountId,
      siteId: seed.siteId,
      db: getTestDb(),
    });
    expect(result.actions).toEqual([]);
  });

  it('tolerates raw run documents with missing arrays and cited ids', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const siteId = new mongoose.Types.ObjectId().toHexString();
    const runWithoutSources = new mongoose.Types.ObjectId();
    const runWithoutCitations = new mongoose.Types.ObjectId();

    // Bypass the schema on purpose: legacy/degraded documents must not crash
    // the adapter.
    await AudienceResearchRun.collection.insertMany([
      {
        _id: runWithoutSources,
        accountId: new mongoose.Types.ObjectId(accountId),
        siteId: new mongoose.Types.ObjectId(siteId),
        deterministicInputHash: 'raw-hash-no-sources',
        signals: [
          {
            signalId: 'sig-a',
            title: 'No sources',
            confidence: 'low',
            citedSourceIds: ['src-1'],
          },
        ],
      },
      {
        _id: runWithoutCitations,
        accountId: new mongoose.Types.ObjectId(accountId),
        siteId: new mongoose.Types.ObjectId(siteId),
        deterministicInputHash: 'raw-hash-no-citations',
        signals: [{ signalId: 'sig-b', title: 'No citations', confidence: 'low' }],
        sources: [
          {
            sourceId: 'src-1',
            canonicalUrl: 'https://raw.test/page',
            observationMeta: observationMeta('2026-07-01T00:00:00.000Z'),
          },
        ],
      },
    ]);

    await getTestDb()
      .insert(audienceResearchSignalDecisionEvents)
      .values([
        {
          accountId,
          siteId,
          runId: runWithoutSources.toHexString(),
          signalId: 'sig-a',
          decision: 'accepted',
          destination: 'product',
          downstreamId: 'product:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          deepLinkPath: null,
          idempotencyKey: 'idem-adapter-050',
          decidedByUserId: accountId,
        },
        {
          accountId,
          siteId,
          runId: runWithoutCitations.toHexString(),
          signalId: 'sig-b',
          decision: 'accepted',
          destination: 'seo',
          downstreamId: 'seo:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          deepLinkPath: null,
          idempotencyKey: 'idem-adapter-051',
          decidedByUserId: accountId,
        },
      ]);

    const result = await audienceResearchActionAdapter({
      accountId,
      siteId,
      db: getTestDb(),
    });
    // Both survive with empty evidence: missing sources array and missing
    // citedSourceIds both degrade to zero-evidence candidates.
    expect(result.actions).toHaveLength(2);
    for (const action of result.actions) {
      expect(action.evidence).toEqual([]);
      expect(action.affectedUrls).toEqual([]);
      expect(action.lastVerifiedAt).toBeNull();
    }
  });

  it('skips rows without a downstreamId and non-ObjectId run ids defensively', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const siteId = new mongoose.Types.ObjectId().toHexString();
    const rows = [
      {
        runId: 'not-an-object-id',
        signalId: 'sig-x',
        downstreamId: 'product:cccccccccccccccccccccccccccccccc',
        decidedAt: new Date('2026-07-02T00:00:00.000Z'),
      },
      {
        runId: new mongoose.Types.ObjectId().toHexString(),
        signalId: 'sig-y',
        downstreamId: null,
        decidedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ];

    const result = await audienceResearchActionAdapter({
      accountId,
      siteId,
      db: stubDbReturning(rows),
    });
    expect(result.actions).toEqual([]);
    expect(result.status).toBe('available');
    expect(result.lastObservedAt).toBe('2026-07-02T00:00:00.000Z');
  });

  it('emits nothing when the persisted run carries no signals array at all', async () => {
    const seed = await seedRun({ routes: ['product'] });
    await acceptSignal({
      ...seed,
      signalId: 'signal-1',
      destination: 'product',
      idempotencyKey: 'idem-adapter-signals-unset',
    });
    // A run document written before the signals field existed (or stripped by
    // a partial write) reads back with `signals === undefined`. The adapter
    // must degrade to "no candidate", never throw on the missing array.
    await AudienceResearchRun.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(seed.runId) },
      { $unset: { signals: '' } },
    );

    const result = await audienceResearchActionAdapter({
      accountId: seed.accountId,
      siteId: seed.siteId,
      db: getTestDb(),
    });

    expect(result.actions).toEqual([]);
    expect(result.status).toBe('available');
    expect(result.lastObservedAt).toBeDefined();
  });
});

describe('audience_research end to end through the actions list', () => {
  it('surfaces an accepted product signal as a listed action', async () => {
    const seed = await seedRun({ routes: ['product'] });
    const accepted = await acceptSignal({
      ...seed,
      signalId: 'signal-1',
      destination: 'product',
      idempotencyKey: 'idem-adapter-060',
    });

    const list = await listActionsForSite({
      accountId: seed.accountId,
      siteId: seed.siteId,
      locale: 'en',
      db: getTestDb(),
    });

    const item = list.items.find(
      (i) => i.sourceType === 'audience_research',
    );
    expect(item).toBeDefined();
    expect(item!.sourceId).toBe(accepted.downstreamId);
    expect(item!.state).toBe('open');
    expect(item!.problem).toContain('Signal title 1');
    expect(item!.retest).toEqual({
      available: false,
      reason: 'Only audit findings can be retested.',
      code: 'RETEST_UNSUPPORTED',
      messageKey: 'actions.errors.retestUnsupported',
    });
    // The deep link minted at accept time targets exactly this action.
    const url = new URL(`https://x.test${accepted.deepLinkPath}`);
    expect(url.searchParams.get('action')).toBe(item!.sourceId);
    expect(list.sourceStatus.audience_research).toEqual({
      status: 'available',
      lastObservedAt: item!.observedAt,
    });
  });
});
