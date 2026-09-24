/**
 * End-to-end job semantics against real Redis + real BullMQ Workers
 *: retries with backoff, dead-lettering on exhaustion,
 * consume-side validation that fails the job without killing the worker,
 * and graceful close waiting for in-flight jobs.
 */
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueueConnection, flushTestRedis } from '../testing/redis.js';
import {
  AUDITS_QUEUE,
  auditJobSchema,
  createQueues,
  parseConsumedPayload,
  wireDeadLetter,
  type DeadLetterEntry,
  type Queues,
} from './index.js';

const logger = pino({ level: 'silent' });
const hex = (n: number) => n.toString(16).padStart(24, '0');

// Small backoff so retry tests run in milliseconds; semantics identical.
const FAST_OPTS = { attempts: 3, backoff: { type: 'fixed' as const, delay: 25 } };

let connection: Redis;
let queues: Queues;
const workers: Worker[] = [];

beforeAll(() => {
  connection = createTestQueueConnection();
});

afterAll(async () => {
  await connection.quit();
});

beforeEach(async () => {
  await flushTestRedis(connection);
  queues = createQueues(connection);
});

afterEach(async () => {
  await Promise.all(workers.splice(0).map((w) => w.close(true)));
  await queues.close();
});

function startWorker(processor: (job: Job) => Promise<unknown>): Worker {
  const worker = new Worker(AUDITS_QUEUE, processor, {
    connection: createTestQueueConnection(),
    concurrency: 5,
  });
  workers.push(worker);
  return worker;
}

function waitForDeadLetter(): Promise<DeadLetterEntry> {
  return vi.waitFor(
    async () => {
      const jobs = await queues.deadLetter.getJobs(['waiting', 'completed', 'delayed']);
      expect(jobs.length).toBeGreaterThan(0);
      return jobs[0]!.data as DeadLetterEntry;
    },
    { timeout: 15_000 },
  );
}

describe('retry semantics', () => {
  it('a retryable failure re-enters the queue and succeeds on a later attempt', async () => {
    const attempts: number[] = [];
    const worker = startWorker(async (job) => {
      attempts.push(job.attemptsMade);
      if (attempts.length < 2) {
        throw new Error('transient vendor 5xx');
      }
      return 'ok';
    });

    const completed = new Promise<Job>((resolve) => {
      worker.on('completed', (job) => resolve(job));
    });
    await queues.audits.add('audit', { try: 'retry' }, { ...FAST_OPTS, jobId: 'audit-retry' });

    const job = await completed;
    expect(job.attemptsMade).toBe(2);
    // attemptsMade increments across attempts: 0 on the first, 1 on the retry.
    expect(attempts).toEqual([0, 1]);
    expect(await queues.deadLetter.count()).toBe(0);
  });

  it('exhausted attempts land in dead-letter with the original payload', async () => {
    const worker = startWorker(async () => {
      throw new Error('vendor permanently sad');
    });
    wireDeadLetter(worker, {
      deadLetterQueue: queues.deadLetter,
      sourceQueueName: AUDITS_QUEUE,
      logger,
    });

    const payload = { accountId: hex(1), runId: hex(2) };
    await queues.audits.add('audit', payload, { ...FAST_OPTS, jobId: 'audit-exhaust' });

    const entry = await waitForDeadLetter();
    expect(entry).toEqual({
      original: payload,
      queue: AUDITS_QUEUE,
      err: 'vendor permanently sad',
      failedAt: expect.any(String),
    });
  });
});

describe('consume-side validation (trust boundary)', () => {
  it('a crafted malformed payload fails the job without crashing the worker', async () => {
    const worker = startWorker(async (job) => {
      const payload = parseConsumedPayload(auditJobSchema, job.data);
      return { runId: payload.runId };
    });
    wireDeadLetter(worker, {
      deadLetterQueue: queues.deadLetter,
      sourceQueueName: AUDITS_QUEUE,
      logger,
    });
    const failed = new Promise<string>((resolve) => {
      worker.on('failed', (_job, err) => resolve(err.message));
    });

    // Crafted directly — bypasses the validating enqueue helper.
    await queues.audits.add('audit', { evil: true }, { ...FAST_OPTS, jobId: 'audit-crafted' });
    expect(await failed).toMatch(/malformed job payload/);

    // UnrecoverableError skipped the remaining attempts and dead-lettered.
    const entry = await waitForDeadLetter();
    expect(entry.original).toEqual({ evil: true });

    // The worker process survived and keeps consuming.
    const completed = new Promise<void>((resolve) => {
      worker.on('completed', () => resolve());
    });
    const valid = { accountId: hex(1), siteId: hex(2), runId: hex(3), pageCap: 10 };
    await queues.audits.add('audit', valid, { ...FAST_OPTS, jobId: `audit-${valid.runId}` });
    await completed;
  });
});

describe('graceful close', () => {
  it('worker.close() resolves only after the in-flight job finishes', async () => {
    let releaseJob!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseJob = resolve;
    });
    let jobFinished = false;

    const worker = startWorker(async () => {
      await gate;
      jobFinished = true;
      return 'ok';
    });

    await queues.audits.add('audit', {}, { jobId: 'audit-inflight' });
    // Wait until the job is actually active before closing.
    await vi.waitFor(async () => {
      expect(await queues.audits.getActiveCount()).toBe(1);
    });

    const closing = worker.close();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(false); // still waiting on the in-flight job

    releaseJob();
    await closing;
    expect(jobFinished).toBe(true);
  });
});
