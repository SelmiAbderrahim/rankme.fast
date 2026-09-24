import { UnrecoverableError, type Job } from 'bullmq';
import { Types } from 'mongoose';
import type { Logger } from 'pino';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { keywords as keywordsTable } from '../../db/schema/keywords.js';
import { serpObservations } from '../../db/schema/serp-observations.js';
import { eq } from 'drizzle-orm';
import {
  AiAvailabilityError,
  AiMalformedOutputError,
} from '../../shared/providers/ai-generation.js';
import type { KeywordClusterJob } from '../../shared/queue/index.js';
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
import { KeywordClusterAiOutputContractError } from './keyword-clusters.ai-contract.js';
import { SerpClusterRun } from './keyword-clusters.model.js';
import { readKeywordClusterReadiness } from './keyword-clusters.readiness.js';
import {
  createKeywordClustersProcessor,
  isKeywordClusterAiRejection,
  selectClustersForLabelling,
} from './keyword-clusters.processor.js';
import {
  KEYWORD_CLUSTER_MAX_AI_CLUSTERS,
  KEYWORD_CLUSTER_MIN_SHARED_URLS,
  KEYWORD_CLUSTER_RULES_VERSION,
  KEYWORD_CLUSTER_TOP_URLS,
  type KeywordCluster,
} from './keyword-clusters.schemas.js';

const NOW = new Date('2026-08-04T12:00:00.000Z');
const url = (n: number): string => `https://serp-${n}.example/page`;

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function job(data: unknown): Job<KeywordClusterJob> {
  return { data } as Job<KeywordClusterJob>;
}

function aiResult(object: object) {
  return {
    trust: 'untrusted' as const,
    status: 'complete' as const,
    object,
    warnings: [],
    qualityFlags: ['complete'] as const,
    provenance: {
      task: 'cluster_labels' as const,
      profileVersion: '1.0.0',
      outputSchemaVersion: '1',
      promptTemplateId: 'cluster-labels',
      promptTemplateVersion: '1',
      provider: 'fake' as const,
      model: 'fixture',
      finishReason: 'stop',
      attempts: 1,
      fallbackUsed: false,
      latencyMs: 1,
      actualOrEstimatedCostMicros: 400n,
    },
    classification: {
      generatedFields: 'untrusted' as const,
      renderAs: 'text_only' as const,
    },
  };
}

function ai(
  implementation: (input: Record<string, unknown>) => Promise<unknown>,
): AiProfileRunner {
  return {
    preflight: vi.fn(),
    run: vi.fn(implementation),
  } as unknown as AiProfileRunner;
}

/** A runner that must never be reached (proves the zero-dispatch paths). */
const throwingAi = (): AiProfileRunner =>
  ai(async () => {
    throw new Error('the AI runner must not be called');
  });

const accountId = new Types.ObjectId().toString();
const siteId = new Types.ObjectId().toString();

async function seedKeyword(input: {
  phrase: string;
  urls?: readonly number[];
  checkedAt?: Date;
}): Promise<string> {
  const db = getTestDb();
  const [row] = await db
    .insert(keywordsTable)
    .values({
      accountId,
      siteId,
      phrase: input.phrase,
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
      engine: 'google',
      active: true,
    })
    .returning({ id: keywordsTable.id });
  const keywordId = row!.id;
  if (input.urls) {
    await db.insert(serpObservations).values({
      accountId,
      siteId,
      keywordId,
      engine: 'google',
      checkedAt: input.checkedAt ?? NOW,
      source: 'fresh',
      features: { features: [], featuredSnippet: null, paa: [] },
      topResults: input.urls.map((n, index) => ({
        domain: `serp-${n}.example`,
        url: url(n),
        rankGroup: index + 1,
        rankAbsolute: index + 1,
      })),
    });
  }
  return keywordId;
}

async function seedRun(keywordIds: readonly string[], overrides: object = {}) {
  const { ready } = await readKeywordClusterReadiness(getTestDb() as never, {
    siteId,
    keywordIds,
    now: NOW,
  });
  const run = await SerpClusterRun.create({
    accountId: new Types.ObjectId(accountId),
    siteId: new Types.ObjectId(siteId),
    locale: 'en',
    status: 'queued',
    aiStatus: 'pending',
    rulesVersion: KEYWORD_CLUSTER_RULES_VERSION,
    minSharedUrls: KEYWORD_CLUSTER_MIN_SHARED_URLS,
    topUrlWindow: KEYWORD_CLUSTER_TOP_URLS,
    keywordCount: keywordIds.length,
    blockedCount: 0,
    keywordIds: [...keywordIds],
    inputs: ready.map((input) => ({
      ...input,
      observedAt: new Date(input.observedAt),
      topUrls: input.topUrls.slice(0, KEYWORD_CLUSTER_TOP_URLS),
    })),
    blocked: [],
    clusters: [],
    requestedAt: NOW,
    ...overrides,
  });
  return String(run._id);
}

/** Two keywords sharing three results, plus one that shares nothing. */
async function seedTypicalSet(): Promise<string[]> {
  return [
    await seedKeyword({ phrase: 'aaa shoes', urls: [1, 2, 3, 4] }),
    await seedKeyword({ phrase: 'bbb shoes', urls: [1, 2, 3, 9] }),
    await seedKeyword({ phrase: 'ccc boots', urls: [50, 51, 52] }),
  ];
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
});

describe('selectClustersForLabelling', () => {
  it('sends only multi-member clusters, bounded to the profile ceiling', () => {
    const clusters: KeywordCluster[] = Array.from({ length: 60 }, (_, index) => ({
      id: `cluster-${index + 1}`,
      size: index % 2 === 0 ? 2 : 1,
      pivotKeywordId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      sharedUrls: [],
      members: [],
      label: null,
      labelSource: null,
    }));
    const selected = selectClustersForLabelling(clusters);
    expect(selected.every((cluster) => cluster.size > 1)).toBe(true);
    expect(selected.length).toBeLessThanOrEqual(KEYWORD_CLUSTER_MAX_AI_CLUSTERS);
  });
});

describe('isKeywordClusterAiRejection', () => {
  it('separates contract/output rejections from provider outages', () => {
    expect(isKeywordClusterAiRejection(new KeywordClusterAiOutputContractError())).toBe(true);
    expect(isKeywordClusterAiRejection(new AiMalformedOutputError())).toBe(true);
    expect(isKeywordClusterAiRejection(new AiAvailabilityError())).toBe(false);
    expect(isKeywordClusterAiRejection(new Error('boom'))).toBe(false);
  });
});

describe('keyword-cluster processor', () => {
  it('groups stored observations and applies accepted labels', async () => {
    const ids = await seedTypicalSet();
    const runId = await seedRun(ids);
    const runner = ai(async () =>
      aiResult({
        labels: [{ clusterId: 'cluster-1', label: 'Shoes' }],
        citations: ['cluster-1'],
      }),
    );
    const processor = createKeywordClustersProcessor({
      db: getTestDb() as never,
      ai: runner,
      aiProviderOrder: ['fake'],
      logger: logger(),
      now: () => NOW,
    });

    await processor(job({ accountId, siteId, runId }));

    const stored = await SerpClusterRun.findById(runId).lean();
    expect(stored?.status).toBe('completed');
    expect(stored?.aiStatus).toBe('applied');
    expect(stored?.aiCostMicros).toBe(400);
    expect(stored?.clusters).toHaveLength(2);
    expect(stored?.clusters[0]?.size).toBe(2);
    expect(stored?.clusters[0]?.label).toBe('Shoes');
    expect(stored?.clusters[0]?.labelSource).toBe('ai');
    expect(stored?.clusters[1]?.size).toBe(1);
    expect(stored?.clusters[1]?.label).toBeNull();
    // Evidence travelled with every grouped member.
    expect(stored?.clusters[0]?.members[1]?.sharedUrlCount).toBe(3);
    expect(stored?.clusters[0]?.members[1]?.sharedUrls).toEqual([
      url(1),
      url(2),
      url(3),
    ]);
  });

  it('sends the model only phrases and shared URLs — never ids or observation dates', async () => {
    const ids = await seedTypicalSet();
    const runId = await seedRun(ids);
    let captured: unknown = null;
    const runner = ai(async (input) => {
      captured = input;
      return aiResult({ labels: [], citations: [] });
    });
    await createKeywordClustersProcessor({
      db: getTestDb() as never,
      ai: runner,
      aiProviderOrder: ['fake'],
      logger: logger(),
      now: () => NOW,
    })(job({ accountId, siteId, runId }));

    const sent = captured as { profile: string; input: { clusters: unknown[] } };
    expect(sent.profile).toBe('cluster_labels');
    expect(sent.input.clusters).toEqual([
      {
        id: 'cluster-1',
        keywords: ['aaa shoes', 'bbb shoes'],
        sharedUrls: [url(1), url(2), url(3)],
      },
    ]);
    expect(JSON.stringify(sent.input)).not.toContain(ids[0]);
    expect(JSON.stringify(sent.input)).not.toContain('2026-08-04T12:00:00');
  });

  it('completes unlabeled when the model returns a hostile response', async () => {
    const ids = await seedTypicalSet();
    const runId = await seedRun(ids);
    const runner = ai(async () =>
      aiResult({
        labels: [{ clusterId: 'cluster-99', label: 'Invented' }],
        citations: [],
      }),
    );
    await createKeywordClustersProcessor({
      db: getTestDb() as never,
      ai: runner,
      aiProviderOrder: ['fake'],
      logger: logger(),
      now: () => NOW,
    })(job({ accountId, siteId, runId }));

    const stored = await SerpClusterRun.findById(runId).lean();
    expect(stored?.status).toBe('completed');
    expect(stored?.aiStatus).toBe('output_rejected');
    expect(stored?.clusters).toHaveLength(2);
    expect(stored?.clusters.every((cluster) => cluster.label === null)).toBe(true);
  });

  it('completes unlabeled when the provider fails — and never refunds', async () => {
    const ids = await seedTypicalSet();
    const runId = await seedRun(ids);
    const runner = ai(async () => {
      throw new AiAvailabilityError();
    });
    await createKeywordClustersProcessor({
      db: getTestDb() as never,
      ai: runner,
      aiProviderOrder: ['fake'],
      logger: logger(),
      now: () => NOW,
    })(job({ accountId, siteId, runId }));

    const stored = await SerpClusterRun.findById(runId).lean();
    expect(stored?.status).toBe('completed');
    expect(stored?.aiStatus).toBe('provider_failed');
    expect(stored?.clusters).toHaveLength(2);
    expect(stored?.aiCostMicros).toBe(0);
  });

  it('skips labelling entirely when every cluster is a singleton', async () => {
    const ids = [
      await seedKeyword({ phrase: 'aaa alone', urls: [1, 2, 3] }),
      await seedKeyword({ phrase: 'bbb alone', urls: [40, 41, 42] }),
    ];
    const runId = await seedRun(ids);
    await createKeywordClustersProcessor({
      db: getTestDb() as never,
      ai: throwingAi(),
      aiProviderOrder: ['fake'],
      logger: logger(),
      now: () => NOW,
    })(job({ accountId, siteId, runId }));

    const stored = await SerpClusterRun.findById(runId).lean();
    expect(stored?.status).toBe('completed');
    expect(stored?.aiStatus).toBe('skipped');
    expect(stored?.clusters).toHaveLength(2);
  });

  it('honours the run-frozen threshold, not the current constant', async () => {
    const ids = [
      await seedKeyword({ phrase: 'aaa two shared', urls: [1, 2, 30] }),
      await seedKeyword({ phrase: 'bbb two shared', urls: [1, 2, 31] }),
    ];
    const runId = await seedRun(ids, { minSharedUrls: 2 });
    await createKeywordClustersProcessor({
      db: getTestDb() as never,
      ai: ai(async () => aiResult({ labels: [], citations: [] })),
      aiProviderOrder: ['fake'],
      logger: logger(),
      now: () => NOW,
    })(job({ accountId, siteId, runId }));

    const stored = await SerpClusterRun.findById(runId).lean();
    expect(stored?.clusters).toHaveLength(1);
    expect(stored?.clusters[0]?.size).toBe(2);
  });

  it('uses accepted evidence even when an observation changes before execution', async () => {
    const ids = [
      await seedKeyword({ phrase: 'aaa fresh', urls: [1, 2, 3] }),
      await seedKeyword({ phrase: 'bbb fresh', urls: [1, 2, 3] }),
      await seedKeyword({ phrase: 'ccc accepted', urls: [1, 2, 3] }),
    ];
    const runId = await seedRun(ids);
    await getTestDb()
      .update(serpObservations)
      .set({
        checkedAt: new Date(NOW.getTime() - 30 * 86_400_000),
        topResults: [],
      })
      .where(eq(serpObservations.keywordId, ids[2]!));
    await createKeywordClustersProcessor({
      db: getTestDb() as never,
      ai: ai(async () => aiResult({ labels: [], citations: [] })),
      aiProviderOrder: ['fake'],
      logger: logger(),
      now: () => NOW,
    })(job({ accountId, siteId, runId }));

    const stored = await SerpClusterRun.findById(runId).lean();
    expect(stored?.clusters).toHaveLength(1);
    expect(stored?.clusters[0]?.members).toHaveLength(3);
    expect(stored?.clusters[0]?.members[2]?.phrase).toBe('ccc accepted');
  });

  it('stamps the run with the production clock when none is injected', async () => {
    const ids = await seedTypicalSet();
    const runId = await seedRun(ids);
    const before = Date.now();
    // No `now` dependency: the processor falls back to its production clock.
    await createKeywordClustersProcessor({
      db: getTestDb() as never,
      ai: ai(async () => aiResult({ labels: [], citations: [] })),
      aiProviderOrder: ['fake'],
      logger: logger(),
    })(job({ accountId, siteId, runId }));

    const stored = await SerpClusterRun.findById(runId).lean();
    expect(stored?.status).toBe('completed');
    expect(stored?.completedAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('drops a job whose run is missing', async () => {
    const log = logger();
    await createKeywordClustersProcessor({
      db: getTestDb() as never,
      ai: throwingAi(),
      aiProviderOrder: ['fake'],
      logger: log,
      now: () => NOW,
    })(job({ accountId, siteId, runId: new Types.ObjectId().toString() }));
    expect(log.warn).toHaveBeenCalled();
  });

  it('does no work when another delivery wins the queued-run claim', async () => {
    const ids = await seedTypicalSet();
    const runId = await seedRun(ids);
    const runner = throwingAi();
    const claim = vi
      .spyOn(SerpClusterRun, 'findOneAndUpdate')
      .mockResolvedValueOnce(null as never);

    await createKeywordClustersProcessor({
      db: getTestDb() as never,
      ai: runner,
      aiProviderOrder: ['fake'],
      logger: logger(),
      now: () => NOW,
    })(job({ accountId, siteId, runId }));

    expect(runner.run).not.toHaveBeenCalled();
    claim.mockRestore();
    const stored = await SerpClusterRun.findById(runId).lean();
    expect(stored?.status).toBe('queued');
    expect(stored?.clusters).toHaveLength(0);
  });

  it('rebuilds accepted evidence for a legacy run without frozen inputs', async () => {
    const ids = await seedTypicalSet();
    const runId = await seedRun(ids, { inputs: [] });

    await createKeywordClustersProcessor({
      db: getTestDb() as never,
      ai: ai(async () => aiResult({ labels: [], citations: [] })),
      aiProviderOrder: ['fake'],
      logger: logger(),
      now: () => NOW,
    })(job({ accountId, siteId, runId }));

    const stored = await SerpClusterRun.findById(runId).lean();
    expect(stored?.status).toBe('completed');
    expect(stored?.clusters).toHaveLength(2);
    expect(stored?.clusters[0]?.members.map((member) => member.phrase)).toEqual([
      'aaa shoes',
      'bbb shoes',
    ]);
  });

  it.each(['completed', 'failed'] as const)(
    'no-ops on replay of a %s run',
    async (status) => {
      const ids = await seedTypicalSet();
      const runId = await seedRun(ids, { status });
      const log = logger();
      await createKeywordClustersProcessor({
        db: getTestDb() as never,
        ai: throwingAi(),
        aiProviderOrder: ['fake'],
        logger: log,
        now: () => NOW,
      })(job({ accountId, siteId, runId }));

      const stored = await SerpClusterRun.findById(runId).lean();
      expect(stored?.status).toBe(status);
      expect(stored?.clusters).toHaveLength(0);
      expect(log.info).toHaveBeenCalled();
    },
  );

  it('resumes a run already marked processing without re-stamping startedAt', async () => {
    const ids = await seedTypicalSet();
    const started = new Date(NOW.getTime() - 60_000);
    const runId = await seedRun(ids, { status: 'processing', startedAt: started });
    await createKeywordClustersProcessor({
      db: getTestDb() as never,
      ai: ai(async () => aiResult({ labels: [], citations: [] })),
      aiProviderOrder: ['fake'],
      logger: logger(),
      now: () => NOW,
    })(job({ accountId, siteId, runId }));

    const stored = await SerpClusterRun.findById(runId).lean();
    expect(stored?.status).toBe('completed');
    expect(stored?.startedAt?.toISOString()).toBe(started.toISOString());
  });

  it('marks the run failed and rethrows unrecoverably on a terminal fault', async () => {
    const ids = await seedTypicalSet();
    const runId = await seedRun(ids);
    const save = vi
      .spyOn(SerpClusterRun.prototype, 'save')
      .mockRejectedValueOnce(new Error('mongo write unavailable'));
    const log = logger();
    await expect(
      createKeywordClustersProcessor({
        db: getTestDb() as never,
        ai: throwingAi(),
        aiProviderOrder: ['fake'],
        logger: log,
        now: () => NOW,
      })(job({ accountId, siteId, runId })),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    const stored = await SerpClusterRun.findById(runId).lean();
    expect(stored?.status).toBe('failed');
    expect(stored?.error?.category).toBe('processing_failed');
    expect(stored?.error?.messageKey).toBe('keywordClusters.errors.processingFailed');
    expect(log.error).toHaveBeenCalled();
    save.mockRestore();
  });

  it('rejects a malformed job payload before touching the database', async () => {
    await expect(
      createKeywordClustersProcessor({
        db: getTestDb() as never,
        ai: throwingAi(),
        aiProviderOrder: ['fake'],
        logger: logger(),
        now: () => NOW,
      })(job({ accountId, siteId })),
    ).rejects.toThrow();
  });
});
