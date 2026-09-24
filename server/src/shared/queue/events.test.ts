/**
 * QueueEvents consumer tests — real Redis + a real Worker so
 * the completed/failed events flow through BullMQ's actual event stream.
 */
import { UnrecoverableError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueueConnection, flushTestRedis } from '../testing/redis.js';
import {
  AUDITS_QUEUE,
  RANKS_QUEUE,
  createQueues,
  runIdFromAuditJobId,
  startQueueStatusEvents,
  type QueueStatusEvents,
  type Queues,
} from './index.js';

const logger = pino({ level: 'silent' });

describe('runIdFromAuditJobId', () => {
  it('extracts the runId from helper-shaped ids', () => {
    expect(runIdFromAuditJobId('audit-abc123')).toBe('abc123');
  });

  it('returns null for foreign or empty ids', () => {
    expect(runIdFromAuditJobId('rank-site-2026-W27')).toBeNull();
    expect(runIdFromAuditJobId('audit-')).toBeNull();
    expect(runIdFromAuditJobId('12')).toBeNull();
  });
});

describe('startQueueStatusEvents', () => {
  let connection: Redis;
  let queues: Queues;
  let events: QueueStatusEvents | null = null;
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
    await Promise.all(workers.splice(0).map((w) => w.close()));
    if (events) {
      await events.close();
      events = null;
    }
    await queues.close();
  });

  async function startWorker(queueName: string, processor: () => Promise<unknown>): Promise<Worker> {
    const worker = new Worker(queueName, processor, {
      connection: createTestQueueConnection(),
    });
    workers.push(worker);
    await worker.waitUntilReady();
    return worker;
  }

  async function startEvents(
    overrides: Partial<Parameters<typeof startQueueStatusEvents>[0]> = {},
  ) {
    events = startQueueStatusEvents({
      createConnection: () => createTestQueueConnection(),
      logger,
      onAuditCompleted: async () => {},
      onAuditFailed: async () => {},
      ...overrides,
    });
    // Streams only see events emitted after subscription — wait for it.
    await events.ready();
    return events;
  }

  it('invokes onAuditCompleted when an audit job completes', async () => {
    const onAuditCompleted = vi.fn().mockResolvedValue(undefined);
    await startEvents({ onAuditCompleted });
    await startWorker(AUDITS_QUEUE, async () => 'done');

    await queues.audits.add('audit', {}, { jobId: 'audit-run-1' });
    await vi.waitFor(
      () =>
        expect(onAuditCompleted).toHaveBeenCalledWith(
          expect.objectContaining({ jobId: 'audit-run-1' }),
        ),
      { timeout: 15_000 },
    );
  });

  it('invokes onAuditFailed when an audit job terminally fails', async () => {
    const onAuditFailed = vi.fn().mockResolvedValue(undefined);
    await startEvents({ onAuditFailed });
    await startWorker(AUDITS_QUEUE, async () => {
      throw new UnrecoverableError('permanent');
    });

    await queues.audits.add('audit', {}, { jobId: 'audit-run-2' });
    await vi.waitFor(
      () =>
        expect(onAuditFailed).toHaveBeenCalledWith(
          expect.objectContaining({ jobId: 'audit-run-2', failedReason: 'permanent' }),
        ),
      { timeout: 15_000 },
    );
  });

  it('logs handler rejections instead of crashing the api', async () => {
    const errorSpy = vi.spyOn(logger, 'error');
    await startEvents({ onAuditCompleted: async () => Promise.reject(new Error('db down')) });
    await startWorker(AUDITS_QUEUE, async () => 'done');

    await queues.audits.add('audit', {}, { jobId: 'audit-run-3' });
    await vi.waitFor(
      () =>
        expect(errorSpy).toHaveBeenCalledWith(
          expect.objectContaining({ jobId: 'audit-run-3' }),
          'audit completed handler failed',
        ),
      { timeout: 15_000 },
    );
    errorSpy.mockRestore();
  });

  it('logs failed handler rejections too', async () => {
    const errorSpy = vi.spyOn(logger, 'error');
    await startEvents({ onAuditFailed: async () => Promise.reject(new Error('db down')) });
    await startWorker(AUDITS_QUEUE, async () => {
      throw new UnrecoverableError('permanent');
    });

    await queues.audits.add('audit', {}, { jobId: 'audit-run-4' });
    await vi.waitFor(
      () =>
        expect(errorSpy).toHaveBeenCalledWith(
          expect.objectContaining({ jobId: 'audit-run-4' }),
          'audit failed handler failed',
        ),
      { timeout: 15_000 },
    );
    errorSpy.mockRestore();
  });

  it('logs rank completed / failed events for operators', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    const warnSpy = vi.spyOn(logger, 'warn');
    await startEvents();
    let first = true;
    await startWorker(RANKS_QUEUE, async () => {
      if (first) {
        first = false;
        return 'ok';
      }
      throw new UnrecoverableError('rank vendor down');
    });

    await queues.ranks.add('rank', {}, { jobId: 'rank-site-1' });
    await vi.waitFor(
      () =>
        expect(infoSpy).toHaveBeenCalledWith(
          expect.objectContaining({ jobId: 'rank-site-1' }),
          'rank job completed',
        ),
      { timeout: 15_000 },
    );

    await queues.ranks.add('rank', {}, { jobId: 'rank-site-2' });
    await vi.waitFor(
      () =>
        expect(warnSpy).toHaveBeenCalledWith(
          expect.objectContaining({ jobId: 'rank-site-2', failedReason: 'rank vendor down' }),
          'rank job failed',
        ),
      { timeout: 15_000 },
    );
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
