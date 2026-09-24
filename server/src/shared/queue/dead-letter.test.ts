import { EventEmitter } from 'node:events';
import { UnrecoverableError, type Job, type Queue, type Worker } from 'bullmq';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createDeadLetterHandler, isExhausted, wireDeadLetter } from './index.js';

const logger = pino({ level: 'silent' });

function fakeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'audit-abc',
    data: { runId: 'abc' },
    attemptsMade: 3,
    opts: { attempts: 3 },
    ...overrides,
  } as unknown as Job;
}

function fakeDlq() {
  return { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue & {
    add: ReturnType<typeof vi.fn>;
  };
}

describe('isExhausted', () => {
  it('true when attemptsMade reached the configured attempts', () => {
    expect(isExhausted(fakeJob(), new Error('x'))).toBe(true);
    expect(isExhausted(fakeJob({ attemptsMade: 1 } as Partial<Job>), new Error('x'))).toBe(false);
  });

  it('defaults attempts to 1 when unset', () => {
    const job = fakeJob({ attemptsMade: 1, opts: {} } as Partial<Job>);
    expect(isExhausted(job, new Error('x'))).toBe(true);
  });

  it('true for UnrecoverableError even with attempts left', () => {
    const job = fakeJob({ attemptsMade: 1 } as Partial<Job>);
    expect(isExhausted(job, new UnrecoverableError('permanent'))).toBe(true);
  });
});

describe('createDeadLetterHandler', () => {
  it('archives the original payload with queue, error, and timestamp', async () => {
    const dlq = fakeDlq();
    const onExhausted = vi.fn().mockResolvedValue(undefined);
    const failedAt = new Date('2026-07-02T12:00:00Z');
    const handler = createDeadLetterHandler({
      deadLetterQueue: dlq,
      sourceQueueName: 'audits',
      logger,
      onExhausted,
      now: () => failedAt,
    });

    const job = fakeJob();
    const err = new Error('vendor exploded');
    await handler(job, err);

    expect(dlq.add).toHaveBeenCalledWith('dead-letter', {
      original: { runId: 'abc' },
      queue: 'audits',
      err: 'vendor exploded',
      failedAt: failedAt.toISOString(),
    });
    expect(onExhausted).toHaveBeenCalledWith(job, err);
  });

  it('uses the real clock when no seam is injected', async () => {
    const dlq = fakeDlq();
    const before = Date.now();
    const handler = createDeadLetterHandler({
      deadLetterQueue: dlq,
      sourceQueueName: 'audits',
      logger,
    });
    await handler(fakeJob(), new Error('x'));
    const entry = dlq.add.mock.calls[0]?.[1] as { failedAt: string };
    expect(Date.parse(entry.failedAt)).toBeGreaterThanOrEqual(before);
  });

  it('skips jobs that still have attempts left', async () => {
    const dlq = fakeDlq();
    const handler = createDeadLetterHandler({
      deadLetterQueue: dlq,
      sourceQueueName: 'audits',
      logger,
    });
    await handler(fakeJob({ attemptsMade: 1 } as Partial<Job>), new Error('transient'));
    expect(dlq.add).not.toHaveBeenCalled();
  });

  it('honors an async durable-state predicate after BullMQ attempts are exhausted', async () => {
    const dlq = fakeDlq();
    const shouldDeadLetter = vi.fn().mockResolvedValue(false);
    const onExhausted = vi.fn().mockResolvedValue(undefined);
    const handler = createDeadLetterHandler({
      deadLetterQueue: dlq,
      sourceQueueName: 'content-monitor',
      logger,
      shouldDeadLetter,
      onExhausted,
    });
    const job = fakeJob();
    const err = new Error('transport failure within durable retry budget');

    await handler(job, err);

    expect(shouldDeadLetter).toHaveBeenCalledWith(job, err);
    expect(dlq.add).not.toHaveBeenCalled();
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it('uses a deterministic DLQ job id on repeated terminal failed events', async () => {
    const dlq = fakeDlq();
    const handler = createDeadLetterHandler({
      deadLetterQueue: dlq,
      sourceQueueName: 'content-monitor',
      logger,
      shouldDeadLetter: async () => true,
      deadLetterJobId: (job) => `content-monitor-terminal-${job.id}`,
    });
    const job = fakeJob({ id: 'receipt-123' });
    const err = new UnrecoverableError('durably terminal');

    await handler(job, err);
    await handler(job, err);

    expect(dlq.add).toHaveBeenCalledTimes(2);
    for (const call of dlq.add.mock.calls) {
      expect(call[0]).toBe('dead-letter');
      expect(call[2]).toEqual({
        jobId: 'content-monitor-terminal-receipt-123',
      });
    }
  });

  it('logs and returns when BullMQ emits failed without a job handle', async () => {
    const dlq = fakeDlq();
    const errorSpy = vi.spyOn(logger, 'error');
    const handler = createDeadLetterHandler({
      deadLetterQueue: dlq,
      sourceQueueName: 'audits',
      logger,
    });
    await handler(undefined, new Error('lock lost'));
    expect(dlq.add).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('wireDeadLetter', () => {
  it('routes worker failed events through the handler', async () => {
    const emitter = new EventEmitter();
    const dlq = fakeDlq();
    wireDeadLetter(emitter as unknown as Worker, {
      deadLetterQueue: dlq,
      sourceQueueName: 'ranks',
      logger,
    });

    emitter.emit('failed', fakeJob(), new Error('boom'));
    await vi.waitFor(() => expect(dlq.add).toHaveBeenCalledTimes(1));
  });

  it('logs (never throws) when the dead-letter write itself fails', async () => {
    const emitter = new EventEmitter();
    const dlq = fakeDlq();
    dlq.add.mockRejectedValue(new Error('redis down'));
    const errorSpy = vi.spyOn(logger, 'error');
    wireDeadLetter(emitter as unknown as Worker, {
      deadLetterQueue: dlq,
      sourceQueueName: 'ranks',
      logger,
    });

    emitter.emit('failed', fakeJob(), new Error('boom'));
    await vi.waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queue: 'ranks' }),
        'dead-letter handler failed',
      ),
    );
    errorSpy.mockRestore();
  });
});
