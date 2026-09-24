/**
 * Prompt 10e — HTTP-side service invariants.
 *
 * Exercises `audience-research.service.ts` directly (real memory Mongo) so the
 * read/list/start compensation paths that the router smoke test cannot reach
 * are pinned:
 *
 *   - preview returns the community spend preview after the ownership check.
 *   - start-order compensation: 503 with no queue, duplicate short-circuit,
 *     create failures (duplicate key with and without a visible racing row),
 *     and delete when the enqueue itself fails.
 *   - read endpoints: malformed ids and cross-account ids are 404, never a
 *     500 and never an existence leak.
 *   - the status/result projections stay total — a sparse persisted document
 *     (missing ledger, discovery, terminal, evidence) still serializes.
 *   - cursor pagination round-trips and a forged cursor is a 400.
 */
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, Queue } from 'bullmq';
import { Types } from 'mongoose';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { Site } from '../sites/index.js';
import { AudienceResearchRun } from './audience-research.model.js';
import type { AudienceResearchInput } from './audience-research.schemas.js';
import { computeDeterministicInputHash } from './deterministic-input-hash.js';
import {
  getAudienceResearchRun,
  getAudienceResearchRunResult,
  listAudienceResearchRuns,
  previewAudienceResearchRun,
  resolveAudienceResearchOutputLocale,
  startAudienceResearchRun as startAudienceResearchRunImpl,
} from './audience-research.service.js';

function startAudienceResearchRun(
  input: Omit<Parameters<typeof startAudienceResearchRunImpl>[0], 'outputLocale'> & {
    outputLocale?: Parameters<typeof startAudienceResearchRunImpl>[0]['outputLocale'];
  },
  deps: Parameters<typeof startAudienceResearchRunImpl>[1],
) {
  return startAudienceResearchRunImpl(
    { ...input, outputLocale: input.outputLocale ?? 'en' },
    deps,
  );
}

beforeAll(async () => {
  await startMemoryMongo();
});
afterAll(async () => {
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function baseInput(overrides: Partial<AudienceResearchInput> = {}): AudienceResearchInput {
  return {
    siteMarket: {
      country: 'US',
      region: null,
      city: null,
      language: 'en',
      device: 'desktop',
    },
    competitorDomains: ['acme.example'],
    seedTopics: ['project management tools'],
    ...overrides,
  } as AudienceResearchInput;
}

async function seedAccount() {
  const accountId = new Types.ObjectId().toHexString();
  const site = await Site.create({
    accountId: new Types.ObjectId(accountId),
    url: 'https://example.test',
    domain: 'example.test',
    displayName: 'Example',
  });
  return { accountId, siteId: String(site._id) };
}

interface EnqueuedJob {
  name: string;
  data: unknown;
  opts: { jobId?: string };
}

function fakeQueue() {
  const jobs: EnqueuedJob[] = [];
  const queue = {
    async add(name: string, data: unknown, opts: { jobId?: string }): Promise<Job> {
      jobs.push({ name, data, opts });
      return { id: opts.jobId } as Job;
    },
  } as unknown as Queue;
  return { queue, jobs };
}

function throwingQueue(): Queue {
  return {
    async add(): Promise<Job> {
      throw new Error('redis unreachable');
    },
  } as unknown as Queue;
}

/**
 * Stub the run lookup with a raw projection object. Persisted documents always
 * carry mongoose-applied defaults, so a genuinely sparse document (a row
 * written by an older schema revision, or a partially-applied update) can only
 * be reproduced by handing the projection layer the bare shape directly.
 */
function stubRunLookup(raw: Record<string, unknown>) {
  return vi
    .spyOn(AudienceResearchRun, 'findOne')
    .mockResolvedValueOnce({ toObject: () => raw } as never);
}

async function seedRunDoc(
  accountId: string,
  siteId: string,
  overrides: Record<string, unknown> = {},
) {
  return AudienceResearchRun.create({
    accountId: new Types.ObjectId(accountId),
    siteId: new Types.ObjectId(siteId),
    state: 'queued',
    input: {
      outputLocale: 'en',
      siteMarket: { country: 'US', language: 'en', device: 'desktop' },
      competitorDomains: ['acme.example'],
      seedTopics: ['topic'],
      queryTemplateVersion: 1,
    },
    deterministicInputHash: `hash-${Math.random().toString(16).slice(2)}`,
    requestedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

describe('previewAudienceResearchRun', () => {
  it('returns the community spend preview without any side-effect', async () => {
    const { accountId, siteId } = await seedAccount();
    await expect(
      previewAudienceResearchRun({ accountId, siteId, input: baseInput() }),
    ).resolves.toEqual({ deploymentMode: 'community', capacityEnforced: false });
    expect(await AudienceResearchRun.countDocuments()).toBe(0);
  });

  it('404s a malformed site id without touching the database', async () => {
    const { accountId } = await seedAccount();
    await expect(
      previewAudienceResearchRun({ accountId, siteId: 'not-an-object-id', input: baseInput() }),
    ).rejects.toMatchObject({ status: 404, message: 'sites.errors.notFound' });
  });

  it('404s a site owned by another account', async () => {
    const { siteId } = await seedAccount();
    const stranger = new Types.ObjectId().toHexString();
    await expect(
      previewAudienceResearchRun({ accountId: stranger, siteId, input: baseInput() }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('startAudienceResearchRun — compensation ordering', () => {
  it('503s before persisting anything when no queue is wired', async () => {
    const { accountId, siteId } = await seedAccount();
    await expect(
      startAudienceResearchRun({ accountId, siteId, input: baseInput() }, { queue: null }),
    ).rejects.toMatchObject({
      status: 503,
      message: 'audienceResearch.errors.processingFailure',
    });
    expect(await AudienceResearchRun.countDocuments()).toBe(0);
  });

  it('creates once and enqueues with the deterministic job id', async () => {
    const { accountId, siteId } = await seedAccount();
    const { queue, jobs } = fakeQueue();
    const started = await startAudienceResearchRun(
      { accountId, siteId, input: baseInput() },
      { queue },
    );
    expect(started.duplicate).toBe(false);
    expect(started.status).toBe('queued');
    expect(started.outputLocale).toBe('en');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.opts.jobId).toBe(`audience-research-${started.runId}`);
    expect(jobs[0]!.data).toMatchObject({ outputLocale: 'en' });
  });

  it('uses output locale in v2 identity while keeping market language unchanged', async () => {
    const { accountId, siteId } = await seedAccount();
    const { queue, jobs } = fakeQueue();
    const french = await startAudienceResearchRun(
      { accountId, siteId, input: baseInput(), outputLocale: 'fr' },
      { queue },
    );
    const german = await startAudienceResearchRun(
      { accountId, siteId, input: baseInput(), outputLocale: 'de' },
      { queue },
    );

    expect(french.runId).not.toBe(german.runId);
    expect(jobs.map((job) => job.data)).toEqual([
      expect.objectContaining({ outputLocale: 'fr' }),
      expect.objectContaining({ outputLocale: 'de' }),
    ]);
    const docs = await AudienceResearchRun.find({ accountId }).sort({ requestedAt: 1 });
    expect(docs.map((doc) => doc.input.outputLocale)).toEqual(['fr', 'de']);
    expect(docs.map((doc) => doc.input.siteMarket.language)).toEqual(['en', 'en']);
    expect(docs[0]?.deterministicInputHash).not.toBe(docs[1]?.deterministicInputHash);
  });

  it('probes the legacy v1 identity for English without rewriting the historical run', async () => {
    const { accountId, siteId } = await seedAccount();
    const legacyInput = baseInput();
    const legacy = await AudienceResearchRun.create({
      accountId: new Types.ObjectId(accountId),
      siteId: new Types.ObjectId(siteId),
      state: 'completed',
      input: { ...legacyInput, queryTemplateVersion: 1 },
      deterministicInputHash: computeDeterministicInputHash({
        accountId,
        siteId,
        ...legacyInput,
        queryTemplateVersion: 1,
      }),
      sources: [],
      signals: [
        {
          signalId: 'legacy-signal',
          type: 'complaint',
          title: 'Historical English title',
          summary: 'Historical English summary',
          suggestedRoute: 'content',
          citedSourceIds: [],
          independentDomainCount: 1,
          sourceTypeCount: 1,
          mostRecentSourceObservedAt: null,
          confidence: 'medium',
        },
      ],
      costLedger: [],
      requestedAt: new Date('2025-01-01T00:00:00.000Z'),
      terminal: {
        state: 'completed',
        reasonCode: 'ok',
        completedAt: new Date('2025-01-01T00:01:00.000Z'),
      },
    });
    await AudienceResearchRun.collection.updateOne(
      { _id: legacy._id },
      { $unset: { 'input.outputLocale': 1 } },
    );
    const { queue, jobs } = fakeQueue();
    const duplicate = await startAudienceResearchRun(
      { accountId, siteId, input: legacyInput, outputLocale: 'en' },
      { queue },
    );

    expect(duplicate).toMatchObject({
      runId: String(legacy._id),
      duplicate: true,
      outputLocale: 'en',
    });
    expect(jobs).toHaveLength(0);
    const unchanged = await AudienceResearchRun.collection.findOne({ _id: legacy._id });
    expect(unchanged?.input?.outputLocale).toBeUndefined();
    await expect(
      getAudienceResearchRun({ accountId, siteId, runId: String(legacy._id) }),
    ).resolves.toMatchObject({ outputLocale: 'en' });
    await expect(
      getAudienceResearchRunResult({ accountId, siteId, runId: String(legacy._id) }),
    ).resolves.toMatchObject({ outputLocale: 'en', input: { outputLocale: 'en' } });
  });

  it('returns the existing run on a duplicate hash', async () => {
    const { accountId, siteId } = await seedAccount();
    const { queue, jobs } = fakeQueue();
    const first = await startAudienceResearchRun(
      { accountId, siteId, input: baseInput() },
      { queue },
    );
    const second = await startAudienceResearchRun(
      { accountId, siteId, input: baseInput() },
      { queue },
    );
    expect(second.duplicate).toBe(true);
    expect(second.runId).toBe(first.runId);
    // The duplicate never enqueued a second job.
    expect(jobs).toHaveLength(1);
  });

  it('returns the racing writer’s run when the unique index rejects the create', async () => {
    const { accountId, siteId } = await seedAccount();
    const { queue } = fakeQueue();
    // autoIndex builds asynchronously; the race below needs the unique index.
    await AudienceResearchRun.init();
    const winner = await startAudienceResearchRun(
      { accountId, siteId, input: baseInput() },
      { queue },
    );
    // Hide the winner from the fast-path pre-read so the create itself trips
    // the `(accountId, deterministicInputHash)` unique index — the exact race
    // two concurrent API workers hit.
    vi.spyOn(AudienceResearchRun, 'findOne').mockResolvedValueOnce(null as never);
    const raced = await startAudienceResearchRun(
      { accountId, siteId, input: baseInput() },
      { queue },
    );
    expect(raced.duplicate).toBe(true);
    expect(raced.runId).toBe(winner.runId);
    expect(await AudienceResearchRun.countDocuments()).toBe(1);
  });

  it('re-raises a duplicate-key create when the racing row is not visible', async () => {
    const { accountId, siteId } = await seedAccount();
    const { queue } = fakeQueue();
    vi.spyOn(AudienceResearchRun, 'findOne').mockResolvedValue(null as never);
    vi.spyOn(AudienceResearchRun, 'create').mockRejectedValueOnce(
      Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
    );
    await expect(
      startAudienceResearchRun({ accountId, siteId, input: baseInput() }, { queue }),
    ).rejects.toThrow('E11000 duplicate key');
  });

  it('treats a MongoServerError name as a duplicate signal', async () => {
    const { accountId, siteId } = await seedAccount();
    const { queue } = fakeQueue();
    const existing = await seedRunDoc(accountId, siteId, { state: 'collecting' });
    vi.spyOn(AudienceResearchRun, 'findOne')
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(existing as never);
    vi.spyOn(AudienceResearchRun, 'create').mockRejectedValueOnce(
      Object.assign(new Error('write conflict'), { name: 'MongoServerError' }),
    );
    const raced = await startAudienceResearchRun(
      { accountId, siteId, input: baseInput() },
      { queue },
    );
    expect(raced.duplicate).toBe(true);
    expect(raced.status).toBe('collecting');
  });

  it('re-raises a non-duplicate create failure', async () => {
    const { accountId, siteId } = await seedAccount();
    const { queue } = fakeQueue();
    vi.spyOn(AudienceResearchRun, 'create').mockRejectedValueOnce(new Error('disk full'));
    await expect(
      startAudienceResearchRun({ accountId, siteId, input: baseInput() }, { queue }),
    ).rejects.toThrow('disk full');
  });

  it('re-raises a non-object create rejection verbatim', async () => {
    const { accountId, siteId } = await seedAccount();
    const { queue } = fakeQueue();
    vi.spyOn(AudienceResearchRun, 'create').mockRejectedValueOnce('driver blew up');
    const caught = await startAudienceResearchRun(
      { accountId, siteId, input: baseInput() },
      { queue },
    ).then(
      () => 'resolved' as unknown,
      (err: unknown) => err,
    );
    expect(caught).toBe('driver blew up');
  });

  it('re-raises a null create rejection verbatim', async () => {
    const { accountId, siteId } = await seedAccount();
    const { queue } = fakeQueue();
    vi.spyOn(AudienceResearchRun, 'create').mockRejectedValueOnce(null);
    const caught = await startAudienceResearchRun(
      { accountId, siteId, input: baseInput() },
      { queue },
    ).then(
      () => 'resolved' as unknown,
      (err: unknown) => err,
    );
    expect(caught).toBeNull();
  });

  it('deletes the run when the enqueue fails', async () => {
    const { accountId, siteId } = await seedAccount();
    await expect(
      startAudienceResearchRun(
        { accountId, siteId, input: baseInput() },
        { queue: throwingQueue() },
      ),
    ).rejects.toMatchObject({
      status: 503,
      message: 'audienceResearch.errors.processingFailure',
    });
    expect(await AudienceResearchRun.countDocuments()).toBe(0);
  });

});

describe('getAudienceResearchRun / getAudienceResearchRunResult', () => {
  it('does not infer a locale for a legacy terminal run without generated signals', () => {
    expect(
      resolveAudienceResearchOutputLocale({
        input: null,
        state: 'completed',
        signals: null,
      }),
    ).toBeNull();
  });

  it('404s a malformed run id', async () => {
    const { accountId, siteId } = await seedAccount();
    await expect(
      getAudienceResearchRun({ accountId, siteId, runId: 'nope' }),
    ).rejects.toMatchObject({ status: 404, message: 'audienceResearch.errors.runNotFound' });
    await expect(
      getAudienceResearchRunResult({ accountId, siteId, runId: 'nope' }),
    ).rejects.toMatchObject({ status: 404, message: 'audienceResearch.errors.runNotFound' });
  });

  it('404s a run id that belongs to nobody', async () => {
    const { accountId, siteId } = await seedAccount();
    const ghost = new Types.ObjectId().toHexString();
    await expect(
      getAudienceResearchRun({ accountId, siteId, runId: ghost }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'audienceResearch.errors.noUsableEvidence',
    });
    await expect(
      getAudienceResearchRunResult({ accountId, siteId, runId: ghost }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'audienceResearch.errors.noUsableEvidence',
    });
  });

  it('projects a fully populated completed run', async () => {
    const { accountId, siteId } = await seedAccount();
    const observedAt = '2026-01-02T00:00:00.000Z';
    const run = await seedRunDoc(accountId, siteId, {
      state: 'completed',
      startedAt: new Date('2026-01-01T00:01:00.000Z'),
      completedAt: new Date('2026-01-01T00:05:00.000Z'),
      terminal: {
        state: 'completed',
        reasonCode: 'ok',
        completedAt: new Date('2026-01-01T00:05:00.000Z'),
      },
      discovery: {
        queries: [],
        resultCount: 3,
        costMicros: 750,
        coverage: {
          sourceKind: 'provider_observation',
          sourceLabel: 'fake',
          observedAt,
          freshUntil: null,
          freshness: 'fresh',
          market: null,
          sampleCount: 1,
          coverageNoteKey: 'audienceResearch.coverage.partial',
        },
      },
      candidates: [
        {
          canonicalUrl: 'https://forum.example.test/a',
          title: 'Candidate',
          sourceType: 'forum',
          registrableDomain: 'example.test',
          observedAt,
          organicPosition: 1,
          discoveryQueryIds: ['q-001'],
        },
      ],
      sources: [
        {
          sourceId: 'src-001',
          canonicalUrl: 'https://forum.example.test/a',
          title: 'Source',
          sourceType: 'forum',
          registrableDomain: 'example.test',
          observedAt,
          contentHash: 'a'.repeat(64),
          excerpt: 'Visitors say onboarding is slow.',
          observationMeta: {
            sourceKind: 'provider_observation',
            sourceLabel: 'fake',
            observedAt,
            freshUntil: null,
            freshness: 'fresh',
            market: null,
            sampleCount: 1,
            coverageNoteKey: null,
          },
          discoveryQueryIds: ['q-001'],
        },
      ],
      signals: [
        {
          signalId: 'sig-001',
          type: 'complaint',
          title: 'Onboarding is slow',
          summary: 'Visitors say onboarding is slow.',
          suggestedRoute: 'content',
          citedSourceIds: ['src-001'],
          independentDomainCount: 1,
          sourceTypeCount: 1,
          mostRecentSourceObservedAt: observedAt,
          confidence: 'medium',
        },
      ],
      costLedger: [
        {
          stage: 'discovery',
          operationCounts: { searchPublicPages: 1 },
          estimatedCostMicros: 750,
          actualCostMicros: 750,
          startedAt: new Date(),
          endedAt: new Date(),
          outcome: 'ok',
        },
        {
          stage: 'cluster',
          operationCounts: { 'ai.cluster': 1 },
          estimatedCostMicros: 5_000,
          actualCostMicros: 2_500,
          startedAt: new Date(),
          endedAt: new Date(),
          outcome: 'ok',
        },
      ],
    });

    const status = await getAudienceResearchRun({
      accountId,
      siteId,
      runId: String(run._id),
    });
    expect(status.state).toBe('completed');
    expect(status.stage).toBe('terminal');
    expect(status.progress.percent).toBe(100);
    expect(status.counts).toEqual({ candidates: 1, sources: 1, signals: 1 });
    expect(status.coverageNoteKey).toBe('audienceResearch.coverage.partial');
    expect(status.costMicros).toEqual({
      total: 3_250,
      byStage: { discovery: 750, cluster: 2_500 },
    });
    expect(status.terminal).toEqual({
      state: 'completed',
      reasonCode: 'ok',
      completedAt: '2026-01-01T00:05:00.000Z',
    });
    expect(status.requestedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(status.startedAt).toBe('2026-01-01T00:01:00.000Z');

    const result = await getAudienceResearchRunResult({
      accountId,
      siteId,
      runId: String(run._id),
    });
    expect(result.input.competitorDomains).toEqual(['acme.example']);
    expect(result.input.seedTopics).toEqual(['topic']);
    expect(result.input.queryTemplateVersion).toBe(1);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.observedAt).toBe(observedAt);
    expect(result.signals[0]!.citedSourceIds).toEqual(['src-001']);
    // AI spend is the `cluster` stage aggregate, not the run total.
    expect(result.ledgerSummary).toEqual({
      total: 3_250,
      ai: 2_500,
      byStage: { discovery: 750, cluster: 2_500 },
    });
  });

  it('nulls the optional evidence fields a mid-flight run has not filled in', async () => {
    const { accountId, siteId } = await seedAccount();
    const run = await seedRunDoc(accountId, siteId, {
      state: 'collecting',
      sources: [
        {
          sourceId: 'src-001',
          canonicalUrl: 'https://forum.example.test/a',
          title: 'Source',
          sourceType: 'other',
          registrableDomain: 'example.test',
          observedAt: null,
          contentHash: 'b'.repeat(64),
          excerpt: 'No observation timestamp.',
          observationMeta: {
            sourceKind: 'vendor',
            sourceLabel: null,
            observedAt: '2026-01-01T00:00:00.000Z',
            freshUntil: null,
            freshness: 'unknown',
            market: null,
            sampleCount: 1,
            coverageNoteKey: null,
          },
          discoveryQueryIds: [],
        },
      ],
      signals: [
        {
          signalId: 'sig-001',
          type: 'question',
          title: 'Open question',
          summary: 'Undated evidence.',
          suggestedRoute: 'seo',
          citedSourceIds: ['src-001'],
          independentDomainCount: 1,
          sourceTypeCount: 1,
          mostRecentSourceObservedAt: null,
          confidence: 'low',
        },
      ],
    });
    const result = await getAudienceResearchRunResult({
      accountId,
      siteId,
      runId: String(run._id),
    });
    expect(result.stage).toBe('collecting');
    expect(result.progress.percent).toBe(65);
    expect(result.coverageNoteKey).toBeNull();
    expect(result.terminal).toEqual({ state: null, reasonCode: null, completedAt: null });
    expect(result.startedAt).toBeNull();
    expect(result.completedAt).toBeNull();
    expect(result.sources[0]!.observedAt).toBeNull();
    expect(result.signals[0]!.mostRecentSourceObservedAt).toBeNull();
    // No `cluster` ledger rows yet — the AI aggregate is 0, not undefined.
    expect(result.ledgerSummary.ai).toBe(0);
  });

  it('serializes a sparse status document without throwing', async () => {
    const { accountId, siteId } = await seedAccount();
    stubRunLookup({
      _id: 'sparse-run',
      siteId: 'sparse-site',
      // An unrecognized state must not crash the projection.
      state: 'quarantined',
      // Stored as an ISO string rather than a BSON date.
      requestedAt: '2026-03-04T05:06:07.000Z',
      updatedAt: new Date('2026-03-04T05:06:08.000Z'),
      costLedger: [
        { stage: 'discovery', actualCostMicros: 900 },
        { stage: 'discovery' },
      ],
    });
    const status = await getAudienceResearchRun({
      accountId,
      siteId,
      runId: new Types.ObjectId().toHexString(),
    });
    expect(status.runId).toBe('sparse-run');
    expect(status.stage).toBe('terminal');
    expect(status.progress.percent).toBe(0);
    expect(status.counts).toEqual({ candidates: 0, sources: 0, signals: 0 });
    expect(status.coverageNoteKey).toBeNull();
    expect(status.terminal).toEqual({ state: null, reasonCode: null, completedAt: null });
    expect(status.requestedAt).toBe('2026-03-04T05:06:07.000Z');
    expect(status.startedAt).toBeNull();
    // Two `discovery` rows accumulate; the row with no recorded cost adds 0.
    expect(status.costMicros).toEqual({ total: 900, byStage: { discovery: 900 } });
  });

  it('serializes a sparse result document without throwing', async () => {
    const { accountId, siteId } = await seedAccount();
    stubRunLookup({
      _id: 'sparse-result',
      siteId: 'sparse-site',
      state: 'failed',
      updatedAt: new Date('2026-03-04T05:06:08.000Z'),
    });
    const result = await getAudienceResearchRunResult({
      accountId,
      siteId,
      runId: new Types.ObjectId().toHexString(),
    });
    expect(result.input).toEqual({
      siteMarket: null,
      competitorDomains: [],
      seedTopics: [],
      queryTemplateVersion: 1,
      outputLocale: null,
    });
    expect(result.outputLocale).toBeNull();
    expect(result.sources).toEqual([]);
    expect(result.signals).toEqual([]);
    expect(result.ledgerSummary).toEqual({ total: 0, ai: 0, byStage: {} });
  });

  it('defaults every optional evidence field missing from a sparse result', async () => {
    const { accountId, siteId } = await seedAccount();
    stubRunLookup({
      _id: 'sparse-evidence',
      siteId: 'sparse-site',
      state: 'partial',
      updatedAt: new Date('2026-03-04T05:06:08.000Z'),
      sources: [
        {
          sourceId: 'src-001',
          canonicalUrl: 'https://x.test/a',
          title: 'Bare',
          sourceType: 'other',
          registrableDomain: 'x.test',
          contentHash: 'c'.repeat(64),
          excerpt: 'bare',
        },
      ],
      signals: [
        {
          signalId: 'sig-001',
          type: 'request',
          title: 'Bare signal',
          summary: 'bare',
          suggestedRoute: 'product',
          confidence: 'low',
        },
      ],
    });
    const result = await getAudienceResearchRunResult({
      accountId,
      siteId,
      runId: new Types.ObjectId().toHexString(),
    });
    expect(result.progress.percent).toBe(100);
    expect(result.sources[0]).toMatchObject({ observedAt: null, observationMeta: null });
    expect(result.signals[0]).toMatchObject({
      citedSourceIds: [],
      independentDomainCount: 0,
      sourceTypeCount: 0,
      mostRecentSourceObservedAt: null,
    });
  });
});

describe('listAudienceResearchRuns', () => {
  it('returns an empty page for a site with no runs', async () => {
    const { accountId, siteId } = await seedAccount();
    const page = await listAudienceResearchRuns({ accountId, siteId, limit: 20 });
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it('maps every workflow state onto its stage and progress percentage', async () => {
    const { accountId, siteId } = await seedAccount();
    const states = [
      'queued',
      'discovering',
      'selecting',
      'collecting',
      'clustering',
      'completed',
      'partial',
      'failed',
    ] as const;
    for (const state of states) {
      await seedRunDoc(accountId, siteId, {
        state,
        deterministicInputHash: `hash-${state}`,
        ...(state === 'completed' || state === 'partial' || state === 'failed'
          ? { terminal: { state, reasonCode: 'ok', completedAt: new Date() } }
          : {}),
      });
    }
    const page = await listAudienceResearchRuns({ accountId, siteId, limit: 50 });
    expect(page.items).toHaveLength(8);
    const byState = new Map(page.items.map((item) => [item.state, item]));
    expect(byState.get('queued')).toMatchObject({ stage: 'queued', progress: { percent: 0 } });
    expect(byState.get('discovering')).toMatchObject({
      stage: 'discovering',
      progress: { percent: 15 },
    });
    expect(byState.get('selecting')).toMatchObject({
      stage: 'selecting',
      progress: { percent: 40 },
    });
    expect(byState.get('collecting')).toMatchObject({
      stage: 'collecting',
      progress: { percent: 65 },
    });
    expect(byState.get('clustering')).toMatchObject({
      stage: 'clustering',
      progress: { percent: 90 },
    });
    for (const terminal of ['completed', 'partial', 'failed'] as const) {
      expect(byState.get(terminal)).toMatchObject({
        stage: 'terminal',
        progress: { percent: 100 },
      });
    }
  });

  it('round-trips a signed cursor across pages and never repeats a run', async () => {
    const { accountId, siteId } = await seedAccount();
    const first = await seedRunDoc(accountId, siteId, { deterministicInputHash: 'h-1' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await seedRunDoc(accountId, siteId, { deterministicInputHash: 'h-2' });

    const pageOne = await listAudienceResearchRuns({ accountId, siteId, limit: 1 });
    expect(pageOne.items).toHaveLength(1);
    expect(pageOne.items[0]!.runId).toBe(String(second._id));
    expect(pageOne.nextCursor).toBeTruthy();

    const pageTwo = await listAudienceResearchRuns({
      accountId,
      siteId,
      limit: 1,
      cursor: pageOne.nextCursor!,
    });
    expect(pageTwo.items.map((i) => i.runId)).toEqual([String(first._id)]);
    expect(pageTwo.nextCursor).toBeNull();
  });

  it('400s a forged cursor rather than trusting it as a filter', async () => {
    const { accountId, siteId } = await seedAccount();
    await expect(
      listAudienceResearchRuns({ accountId, siteId, limit: 10, cursor: 'forged.cursor' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'audienceResearch.errors.processingFailure',
    });
  });

  it('404s a site the caller does not own', async () => {
    const { siteId } = await seedAccount();
    await expect(
      listAudienceResearchRuns({
        accountId: new Types.ObjectId().toHexString(),
        siteId,
        limit: 10,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
