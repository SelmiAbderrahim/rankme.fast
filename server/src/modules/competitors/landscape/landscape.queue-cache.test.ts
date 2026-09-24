import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import {
  COMPETITOR_LANDSCAPES_QUEUE,
  COMPETITOR_LANDSCAPE_JOB_NAME,
  DEFAULT_JOB_OPTIONS,
  competitorLandscapeJobId,
  competitorLandscapeJobSchema,
  enqueueCompetitorLandscapeJob,
} from '../../../shared/queue/index.js';
import { landscapeCacheKey, nextUtcMidnight } from './landscape.cache.js';
import {
  getCompetitorLandscapeDb,
  getCompetitorLandscapeQueue,
  setCompetitorLandscapeDb,
  setCompetitorLandscapeQueue,
} from './landscape.holder.js';
import { createCompetitorLandscapeConsumerRegistration } from './index.js';

const RUN_ID = '507f1f77bcf86cd799439011';

afterEach(() => {
  setCompetitorLandscapeDb(null);
  setCompetitorLandscapeQueue(null);
});

describe('competitor landscape queue and cache contracts', () => {
  it('uses a strict identity-only payload and deterministic job id', async () => {
    expect(competitorLandscapeJobSchema.parse({ runId: RUN_ID })).toEqual({ runId: RUN_ID });
    expect(() => competitorLandscapeJobSchema.parse({ runId: RUN_ID, accountId: 'secret' })).toThrow();
    expect(() => competitorLandscapeJobSchema.parse({ runId: 'not-an-object-id' })).toThrow();
    expect(competitorLandscapeJobId(RUN_ID)).toBe(`competitor-landscape-${RUN_ID}`);

    const add = vi.fn(async () => ({ id: 'job' }));
    await enqueueCompetitorLandscapeJob({ add } as unknown as Queue, { runId: RUN_ID });
    expect(add).toHaveBeenCalledWith(
      COMPETITOR_LANDSCAPE_JOB_NAME,
      { runId: RUN_ID },
      { jobId: `competitor-landscape-${RUN_ID}` },
    );
  });

  it('pins retry retention and exposes a bounded consumer registration seam', () => {
    expect(DEFAULT_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 5000 },
    });
    const registration = createCompetitorLandscapeConsumerRegistration(99);
    expect(registration).toMatchObject({
      queueName: COMPETITOR_LANDSCAPES_QUEUE,
      jobName: COMPETITOR_LANDSCAPE_JOB_NAME,
      concurrency: 5,
    });
    expect(registration.parsePayload({ runId: RUN_ID })).toEqual({ runId: RUN_ID });
    expect(() => registration.parsePayload({ runId: RUN_ID, widened: true })).toThrow();
  });

  it('wires holders explicitly and scopes cache keys by owner and site', () => {
    const q = {} as Queue;
    const database = {} as never;
    setCompetitorLandscapeQueue(q);
    setCompetitorLandscapeDb(database);
    expect(getCompetitorLandscapeQueue()).toBe(q);
    expect(getCompetitorLandscapeDb()).toBe(database);

    const base = {
      accountId: 'account-a',
      siteId: 'site-a',
      ownedDomain: 'example.com',
      competitorDomain: 'competitor.test',
      locationCode: 2840,
      languageCode: 'EN',
      leg: 'shared' as const,
      providerVersion: 'dataforseo-v3',
      schemaVersion: 'competitor-landscape/1',
    };
    expect(landscapeCacheKey(base)).toBe(landscapeCacheKey({ ...base, languageCode: 'en' }));
    expect(landscapeCacheKey(base)).not.toBe(landscapeCacheKey({ ...base, accountId: 'account-b' }));
    expect(landscapeCacheKey(base)).not.toBe(landscapeCacheKey({ ...base, siteId: 'site-b' }));
    expect(nextUtcMidnight(new Date('2026-08-09T23:59:59.999Z')).toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });
});
