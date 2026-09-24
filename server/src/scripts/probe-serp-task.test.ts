import { describe, expect, it } from 'vitest';
import {
  VendorAuthError,
  VendorUnavailableError,
} from '../shared/providers/errors.js';
import type { dataForSeoRequest } from '../shared/providers/http.js';
import type { DataForSeoConfig } from '../shared/providers/http.js';
import { formatSerpTaskProbe, probeSerpTask } from './probe-serp-task.js';

/** Minimal provider-error context; the probe only reads name + message. */
const ctx = { provider: 'dataforseo', operation: 'probe' };

const cfg: DataForSeoConfig = {
  login: 'login',
  password: 'password',
  baseUrl: 'https://api.example.test/v3',
};

/** Deterministic clock: every read advances by a fixed step. */
function stepClock(stepMs: number): () => number {
  let value = 0;
  return () => {
    const current = value;
    value += stepMs;
    return current;
  };
}

interface Call {
  path: string;
  method: string | undefined;
}

/**
 * Scripted stand-in for `dataForSeoRequest`. Each entry is either a value to
 * resolve or an error to throw, consumed in order.
 */
function scriptedRequest(script: Array<unknown | Error>): {
  request: typeof dataForSeoRequest;
  calls: Call[];
} {
  const calls: Call[] = [];
  let index = 0;
  const request = (async (_cfg, path, _tasks, _schema, opts) => {
    calls.push({ path, method: opts?.method });
    const next = script[Math.min(index, script.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    return next;
  }) as typeof dataForSeoRequest;
  return { request, calls };
}

const waits: number[] = [];
const wait = async (ms: number): Promise<void> => {
  waits.push(ms);
};

describe('probeSerpTask', () => {
  it('reports timings and result count when the task completes', async () => {
    const { request, calls } = scriptedRequest([
      [{ status: 'created', taskId: 'task-1', costUsd: 0.0006 }],
      [{ status: 'in_queue', taskId: 'task-1' }],
      [{ status: 'ok', taskId: 'task-1', costUsd: 0.0006, result: [{ a: 1 }, { b: 2 }] }],
    ]);

    const result = await probeSerpTask(
      { cfg, now: stepClock(1_000), wait, request },
      { keyword: '1099 worker', pollIntervalMs: 5, maxPollAttempts: 10 },
    );

    expect(result.outcome).toBe('ok');
    expect(result.taskId).toBe('task-1');
    expect(result.resultCount).toBe(2);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.taskStatus).toBe('in_queue');
    expect(result.attempts[1]?.taskStatus).toBe('ok');
    expect(result.postElapsedMs).toBeGreaterThan(0);
    expect(calls[0]?.path).toBe('/serp/google/organic/task_post');
    expect(calls[1]?.method).toBe('GET');
  });

  it('defaults depth, location, language and device to the production shape', async () => {
    let posted: unknown;
    const request = (async (_cfg, path, tasks) => {
      if (path === '/serp/google/organic/task_post') {
        posted = tasks[0];
        return [{ status: 'created', taskId: 't', costUsd: null }];
      }
      return [{ status: 'ok', taskId: 't', costUsd: null, result: [] }];
    }) as typeof dataForSeoRequest;

    const result = await probeSerpTask({ cfg, now: stepClock(1), wait, request }, { keyword: 'k' });

    expect(posted).toEqual({
      keyword: 'k',
      location_code: 2840,
      language_code: 'en',
      device: 'desktop',
      depth: 100,
    });
    expect(result.depth).toBe(100);
    expect(result.resultCount).toBe(0);
  });

  it('honours explicit input overrides', async () => {
    let posted: unknown;
    const request = (async (_cfg, path, tasks) => {
      if (path === '/serp/google/organic/task_post') {
        posted = tasks[0];
        return [{ status: 'created', taskId: 't', costUsd: null }];
      }
      return [{ status: 'ok', taskId: 't', costUsd: null, result: [{}] }];
    }) as typeof dataForSeoRequest;

    await probeSerpTask(
      { cfg, now: stepClock(1), wait, request },
      {
        keyword: 'k',
        locationCode: 2826,
        languageCode: 'fr',
        device: 'mobile',
        depth: 20,
      },
    );

    expect(posted).toEqual({
      keyword: 'k',
      location_code: 2826,
      language_code: 'fr',
      device: 'mobile',
      depth: 20,
    });
  });

  it('captures a task_post failure instead of throwing', async () => {
    const { request } = scriptedRequest([new VendorAuthError('credentials rejected (HTTP 401)', ctx)]);

    const result = await probeSerpTask(
      { cfg, now: stepClock(10), wait, request },
      { keyword: 'k' },
    );

    expect(result.outcome).toBe('error');
    expect(result.errorClass).toBe('VendorAuthError');
    expect(result.errorMessage).toContain('401');
    expect(result.attempts).toEqual([]);
  });

  it('reports a post that returns no task id', async () => {
    const { request } = scriptedRequest([[{ status: 'created', taskId: null, costUsd: null }]]);

    const result = await probeSerpTask({ cfg, now: stepClock(3), wait, request }, { keyword: 'k' });

    expect(result.outcome).toBe('error');
    expect(result.errorClass).toBe('NoTaskId');
    expect(result.taskId).toBeNull();
  });

  it('reports an empty task_post response as a missing task id', async () => {
    const { request } = scriptedRequest([[]]);

    const result = await probeSerpTask({ cfg, now: stepClock(3), wait, request }, { keyword: 'k' });

    expect(result.outcome).toBe('error');
    expect(result.errorClass).toBe('NoTaskId');
  });

  it('stops polling on a non-retryable poll failure', async () => {
    const { request, calls } = scriptedRequest([
      [{ status: 'created', taskId: 'task-1', costUsd: null }],
      new VendorAuthError('credentials rejected (HTTP 401)', ctx),
    ]);

    const result = await probeSerpTask(
      { cfg, now: stepClock(7), wait, request },
      { keyword: 'k', maxPollAttempts: 5, pollIntervalMs: 1 },
    );

    expect(result.outcome).toBe('error');
    expect(result.errorClass).toBe('VendorAuthError');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.errorClass).toBe('VendorAuthError');
    // post + exactly one poll — the loop did not keep hammering.
    expect(calls).toHaveLength(2);
  });

  it('keeps polling through a retryable poll failure', async () => {
    let call = 0;
    const request = (async () => {
      call += 1;
      if (call === 1) return [{ status: 'created', taskId: 't', costUsd: null }];
      if (call === 2) throw new VendorUnavailableError('vendor unavailable (HTTP 503)', ctx);
      return [{ status: 'ok', taskId: 't', costUsd: null, result: [{}] }];
    }) as typeof dataForSeoRequest;

    const result = await probeSerpTask(
      { cfg, now: stepClock(4), wait, request },
      { keyword: 'k', maxPollAttempts: 5, pollIntervalMs: 2 },
    );

    expect(result.outcome).toBe('ok');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.errorClass).toBe('VendorUnavailableError');
  });

  it('keeps polling after an empty fetch and defaults a missing result to zero', async () => {
    const { request } = scriptedRequest([
      [{ status: 'created', taskId: 'task-1', costUsd: null }],
      [],
      [{ status: 'ok', taskId: 'task-1', costUsd: null }],
    ]);

    const result = await probeSerpTask(
      { cfg, now: stepClock(1), wait, request },
      { keyword: 'k', maxPollAttempts: 2, pollIntervalMs: 1 },
    );

    expect(result.outcome).toBe('ok');
    expect(result.attempts[0]?.taskStatus).toBeNull();
    expect(result.resultCount).toBe(0);
  });

  it('reports exhaustion when the queue outlives the attempt budget', async () => {
    waits.length = 0;
    const { request } = scriptedRequest([
      [{ status: 'created', taskId: 'task-1', costUsd: null }],
      [{ status: 'in_queue', taskId: 'task-1' }],
    ]);

    const result = await probeSerpTask(
      { cfg, now: stepClock(1_000), wait, request },
      { keyword: 'k', maxPollAttempts: 3, pollIntervalMs: 50 },
    );

    expect(result.outcome).toBe('exhausted');
    expect(result.attempts).toHaveLength(3);
    expect(result.resultCount).toBeNull();
    // No sleep after the FINAL attempt — the budget ends the loop immediately.
    expect(waits).toEqual([50, 50]);
  });

  it('records a non-Error rejection without losing the run', async () => {
    const request = (async (_cfg, path) => {
      if (path === '/serp/google/organic/task_post') {
        return [{ status: 'created', taskId: 't', costUsd: null }];
      }
      throw 'socket exploded';
    }) as typeof dataForSeoRequest;

    const result = await probeSerpTask(
      { cfg, now: stepClock(2), wait, request },
      { keyword: 'k', maxPollAttempts: 1, pollIntervalMs: 1 },
    );

    expect(result.outcome).toBe('exhausted');
    expect(result.attempts[0]?.errorClass).toBe('UnknownError');
    expect(result.attempts[0]?.errorMessage).toBe('socket exploded');
  });
});

describe('formatSerpTaskProbe', () => {
  it('renders timings, per-poll status and the outcome', () => {
    const text = formatSerpTaskProbe({
      keyword: '1099 worker',
      depth: 100,
      taskId: 'task-1',
      postElapsedMs: 320,
      attempts: [
        { attempt: 1, elapsedMs: 3_400, taskStatus: 'in_queue', errorClass: null, errorMessage: null },
        { attempt: 2, elapsedMs: 6_500, taskStatus: 'ok', errorClass: null, errorMessage: null },
      ],
      totalElapsedMs: 6_600,
      outcome: 'ok',
      resultCount: 1,
      errorClass: null,
      errorMessage: null,
    });

    expect(text).toContain('keyword: 1099 worker (depth 100)');
    expect(text).toContain('task_post: 320ms task_id=task-1');
    expect(text).toContain('poll 1: 3400ms status=in_queue');
    expect(text).toContain('outcome: ok after 6600ms (1 result blocks)');
    expect(text).not.toContain('error:');
  });

  it('renders the error line and a missing task id', () => {
    const text = formatSerpTaskProbe({
      keyword: 'k',
      depth: 100,
      taskId: null,
      postElapsedMs: 12,
      attempts: [
        { attempt: 1, elapsedMs: 20, taskStatus: null, errorClass: 'VendorAuthError', errorMessage: 'nope' },
      ],
      totalElapsedMs: 25,
      outcome: 'error',
      resultCount: null,
      errorClass: 'VendorAuthError',
      errorMessage: 'nope',
    });

    expect(text).toContain('task_id=none');
    expect(text).toContain('poll 1: 20ms status=- VendorAuthError: nope');
    expect(text).toContain('error: VendorAuthError: nope');
  });

  it('tolerates an attempt whose error message is absent', () => {
    const text = formatSerpTaskProbe({
      keyword: 'k',
      depth: 100,
      taskId: 't',
      postElapsedMs: 1,
      attempts: [
        { attempt: 1, elapsedMs: 2, taskStatus: null, errorClass: 'VendorAuthError', errorMessage: null },
      ],
      totalElapsedMs: 3,
      outcome: 'error',
      resultCount: null,
      errorClass: 'VendorAuthError',
      errorMessage: null,
    });

    expect(text).toContain('poll 1: 2ms status=- VendorAuthError: ');
    expect(text).toContain('error: VendorAuthError: ');
  });
});
