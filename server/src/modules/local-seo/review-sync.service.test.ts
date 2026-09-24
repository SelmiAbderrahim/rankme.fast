/**
 * Review Intelligence service/preview unit tests.
 *
 * Exercises the seams the route tests cannot reach: injected clocks, the
 * enqueue-failure rollback, and the serializer branches that only appear once
 * the theme pass fills the AI fields.
 */
import type { Queue } from 'bullmq';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { persistUnseenRows } from './review-sync.processor.js';
import { previewReviewSyncSpend } from './review-sync.preview.js';
import { resolveOwnedReviewSourceSiteId } from './review-sync.service.js';
import {
  LocalSeoReviewRow,
  LocalSeoReviewSource,
  LocalSeoReviewSyncRun,
} from './review-sync.model.js';
import {
  deleteReviewSource,
  enqueueReviewSync as enqueueReviewSyncImpl,
  resolveReviewOutputLocale,
  serializeReviewRun,
  settleReviewSyncRun,
} from './review-sync.service.js';

const NOW = new Date('2026-04-01T12:00:00.000Z');

function enqueueReviewSync(
  accountId: Parameters<typeof enqueueReviewSyncImpl>[0],
  input: Omit<Parameters<typeof enqueueReviewSyncImpl>[1], 'outputLocale'> & {
    outputLocale?: Parameters<typeof enqueueReviewSyncImpl>[1]['outputLocale'];
  },
  deps: Parameters<typeof enqueueReviewSyncImpl>[2],
) {
  return enqueueReviewSyncImpl(
    accountId,
    { ...input, outputLocale: input.outputLocale ?? 'en' },
    deps,
  );
}
const ACCOUNT_ID = new mongoose.Types.ObjectId().toString();

function queueStub(): Queue {
  return { add: vi.fn().mockResolvedValue({ id: 'job' }) } as unknown as Queue;
}

async function seedProfile(): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(ACCOUNT_ID),
    url: 'https://example.com',
    domain: 'example.com',
  });
  const profileId = String(site._id);
  await LocalSeoReviewSource.create({
    accountId: ACCOUNT_ID,
    profileId,
    source: 'google',
    target: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  });
  return profileId;
}

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  (env as { REVIEW_INTELLIGENCE_ENABLED: boolean }).REVIEW_INTELLIGENCE_ENABLED = false;
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  (env as { REVIEW_INTELLIGENCE_ENABLED: boolean }).REVIEW_INTELLIGENCE_ENABLED = true;
});

describe('enqueueReviewSync', () => {
  it('honours an injected clock when it has to fail a run after an enqueue error', async () => {
    const profileId = await seedProfile();
    const queue = { add: vi.fn().mockRejectedValue(new Error('redis down')) } as unknown as Queue;

    await expect(
      enqueueReviewSync(
        ACCOUNT_ID,
        { profileId, sources: ['google'], depth: 10 },
        { queue, now: () => NOW },
      ),
    ).rejects.toMatchObject({ status: 503 });

    const run = await LocalSeoReviewSyncRun.findOne({ accountId: ACCOUNT_ID });
    expect(run?.status).toBe('failed');
    expect(run?.completedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('propagates a run-row creation failure without enqueueing', async () => {
    const profileId = await seedProfile();
    const queue = queueStub();
    const create = vi
      .spyOn(LocalSeoReviewSyncRun, 'create')
      .mockRejectedValueOnce(new Error('mongo down') as never);

    await expect(
      enqueueReviewSync(
        ACCOUNT_ID,
        { profileId, sources: ['google'], depth: 10 },
        { queue },
      ),
    ).rejects.toThrow('mongo down');
    create.mockRestore();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('refuses a source whose target was never configured', async () => {
    const profileId = await seedProfile();
    await expect(
      enqueueReviewSync(
        ACCOUNT_ID,
        { profileId, sources: ['trustpilot'], depth: 10 },
        { queue: queueStub() },
      ),
    ).rejects.toMatchObject({ status: 400, details: { source: 'trustpilot' } });
  });

  it('rejects a malformed profile id with 404 before creating a run', async () => {
    await expect(
      enqueueReviewSync(
        ACCOUNT_ID,
        { profileId: 'not-an-object-id', sources: ['google'], depth: 10 },
        { queue: queueStub() },
      ),
    ).rejects.toBeInstanceOf(HttpError);
    expect(await LocalSeoReviewSyncRun.countDocuments()).toBe(0);
  });
});

describe('settleReviewSyncRun', () => {
  it('settles a full-failure run as failed', async () => {
    const profileId = await seedProfile();
    const run = await LocalSeoReviewSyncRun.create({
      accountId: ACCOUNT_ID,
      profileId,
      sources: ['google'],
      depth: 10,
      status: 'running',
    });

    const settled = await settleReviewSyncRun({
      accountId: ACCOUNT_ID,
      runId: String(run._id),
      outcomes: [{ source: 'google', outcome: 'failed', retained: 0, errorCode: null }],
      completedAt: NOW,
    });
    expect(settled).toEqual({ status: 'failed' });
    const stored = await LocalSeoReviewSyncRun.findById(run._id);
    expect(stored?.status).toBe('failed');
    expect(stored?.completedAt?.toISOString()).toBe(NOW.toISOString());
  });
});

describe('review source mutations', () => {
  it('returns the ownership-preserving 404 when a source disappears during deletion', async () => {
    const profileId = await seedProfile();
    const source = await LocalSeoReviewSource.findOne({ profileId });
    const deleteOne = vi
      .spyOn(LocalSeoReviewSource, 'findOneAndDelete')
      .mockResolvedValueOnce(null);

    await expect(
      deleteReviewSource(ACCOUNT_ID, String(source?._id)),
    ).rejects.toMatchObject({ status: 404 });
    deleteOne.mockRestore();
  });
});

describe('serializeReviewRun', () => {
  it('surfaces the theme-pass AI fields once they are populated', async () => {
    const profileId = await seedProfile();
    const run = await LocalSeoReviewSyncRun.create({
      accountId: ACCOUNT_ID,
      profileId,
      sources: ['google'],
      depth: 10,
      status: 'succeeded',
      perSourceOutcomes: [{ source: 'google', outcome: 'ok', retained: 2 }],
      retainedCount: 2,
      aiTerminalState: 'themes-ok',
      aiCostMicros: 12_500,
      aiThemes: [{
        kind: 'complaint',
        label: 'Legacy theme',
        summary: 'Historically generated in English.',
        citedReviewIds: [
          new mongoose.Types.ObjectId().toString(),
          new mongoose.Types.ObjectId().toString(),
        ],
      }],
      completedAt: NOW,
    });
    const serialized = serializeReviewRun(run);
    expect(serialized).toMatchObject({
      status: 'succeeded',
      outputLocale: 'en',
      aiTerminalState: 'themes-ok',
      aiCostMicros: 12_500,
      completedAt: NOW.toISOString(),
    });
    // `errorCode` is absent on a success outcome and normalizes to null.
    expect(serialized.perSourceOutcomes[0]?.errorCode).toBeNull();
  });

  it('does not invent a locale for a completed legacy run without generated prose', async () => {
    const profileId = await seedProfile();
    const run = await LocalSeoReviewSyncRun.create({
      accountId: ACCOUNT_ID,
      profileId,
      sources: ['google'],
      depth: 10,
      status: 'succeeded',
      perSourceOutcomes: [{ source: 'google', outcome: 'zeroNew', retained: 0 }],
      retainedCount: 0,
      aiTerminalState: 'no-reliable-themes',
      completedAt: NOW,
    });

    expect(serializeReviewRun(run).outputLocale).toBeNull();
  });

  it('resolves a serialized legacy theme DTO without rewriting it', () => {
    const legacyDto = {
      outputLocale: null,
      status: 'partial',
      aiTerminalState: 'themes-ok',
      aiThemeCount: 1,
    };

    expect(resolveReviewOutputLocale(legacyDto as never)).toBe('en');
    expect(legacyDto.outputLocale).toBeNull();
    expect(
      resolveReviewOutputLocale({
        outputLocale: null,
        status: 'partial',
        aiTerminalState: 'themes-ok',
        aiThemeCount: null,
      } as never),
    ).toBeNull();
  });
});

describe('review theme persistence bounds', () => {
  function runWithCitations(citedReviewIds: string[]) {
    return new LocalSeoReviewSyncRun({
      accountId: ACCOUNT_ID,
      profileId: new mongoose.Types.ObjectId(),
      sources: ['google'],
      depth: 10,
      status: 'succeeded',
      aiTerminalState: 'themes-ok',
      aiThemes: [{
        kind: 'praise',
        label: 'Bounded theme',
        summary: 'Bounded theme summary.',
        citedReviewIds,
      }],
    });
  }

  it('rejects a persisted theme with fewer than two stored review ids', async () => {
    await expect(
      runWithCitations([new mongoose.Types.ObjectId().toString()]).validate(),
    ).rejects.toThrow('theme citations must contain two to twenty stored review ids');
  });

  it('rejects a persisted theme with more than twenty stored review ids', async () => {
    await expect(
      runWithCitations(
        Array.from({ length: 21 }, () => new mongoose.Types.ObjectId().toString()),
      ).validate(),
    ).rejects.toThrow('theme citations must contain two to twenty stored review ids');
  });

  it('rejects a fractional AI input count at the persistence boundary', async () => {
    const run = runWithCitations([
      new mongoose.Types.ObjectId().toString(),
      new mongoose.Types.ObjectId().toString(),
    ]);
    run.aiInputCount = 1.5;
    await expect(run.validate()).rejects.toThrow('AI input count must be an integer');
  });
});

describe('persistUnseenRows', () => {
  it('rethrows an insert failure that is not a duplicate-key rejection', async () => {
    const insertMany = vi.spyOn(LocalSeoReviewRow, 'insertMany').mockRejectedValueOnce(
      new Error('mongo down') as never,
    );
    await expect(
      persistUnseenRows({
        accountId: ACCOUNT_ID,
        profileId: new mongoose.Types.ObjectId().toString(),
        runId: new mongoose.Types.ObjectId().toString(),
        source: 'google',
        rows: [
          {
            rating: 5,
            title: null,
            text: 'ok',
            authorDisplayName: null,
            language: null,
            reviewedAt: null,
            sourceReviewId: 'g-1',
          },
        ],
        fetchedAt: NOW,
      }),
    ).rejects.toThrow('mongo down');
    insertMany.mockRestore();
  });
});

describe('previewReviewSyncSpend', () => {
  it('stamps the preview with the injected clock', async () => {
    const profileId = await seedProfile();
    const preview = await previewReviewSyncSpend(
      ACCOUNT_ID,
      { profileId, sources: ['google', 'trustpilot', 'tripadvisor'] },
      { now: () => NOW },
    );
    expect(preview).toMatchObject({ deploymentMode: 'community', capacityEnforced: false, productUnits: 1 });
    expect(preview.estimatedAt).toBe(NOW.toISOString());
    expect(preview.breakdown?.[0]?.operationKey).toBe(
      'review-sync:google+trustpilot+tripadvisor',
    );
  });
});

describe('resolveOwnedReviewSourceSiteId', () => {
  // The lease middleware never calls the resolver with a malformed id, so this
  // guard exists for every other caller.
  it('returns null for a malformed source id without querying Mongo', async () => {
    await expect(
      resolveOwnedReviewSourceSiteId('6a6fa7c28d75c2fd32d84a63', 'not-an-id'),
    ).resolves.toBeNull();
  });

  it('returns null for a well-formed source id this account does not own', async () => {
    await expect(
      resolveOwnedReviewSourceSiteId('6a6fa7c28d75c2fd32d84a63', '6a6fa7c28d75c2fd32d84a99'),
    ).resolves.toBeNull();
  });
});
