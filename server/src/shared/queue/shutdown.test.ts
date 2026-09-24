import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import {
  API_FORCE_SHUTDOWN_TIMEOUT_MS,
  createApiShutdown,
  createWorkerShutdown,
  FORCE_SHUTDOWN_TIMEOUT_MS,
} from './index.js';

const logger = pino({ level: 'silent' });

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakeDeps() {
  const order: string[] = [];
  return {
    order,
    workers: [
      {
        close: vi.fn(async (force?: boolean) => {
          order.push(force ? 'worker.close(force)' : 'worker.close');
        }),
      },
    ],
    queues: {
      close: vi.fn(async () => {
        order.push('queues.close');
      }),
    },
    connections: [
      {
        quit: vi.fn(async () => {
          order.push('redis.quit');
        }),
      },
    ],
    healthServer: {
      close: (onClosed?: () => void) => {
        order.push('health.close');
        onClosed?.();
      },
    },
    closeDatastores: vi.fn(async () => {
      order.push('datastores.close');
    }),
    logger,
    exit: vi.fn((code: number) => {
      order.push(`exit(${code})`);
    }),
  };
}

describe('createWorkerShutdown', () => {
  it('closes workers → queues → redis → health → datastores, then exits 0', async () => {
    const deps = fakeDeps();
    const shutdown = createWorkerShutdown(deps);

    shutdown('SIGTERM');
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));

    expect(deps.order).toEqual([
      'worker.close',
      'queues.close',
      'redis.quit',
      'health.close',
      'datastores.close',
      'exit(0)',
    ]);
  });

  it('waits for the in-flight job: close() resolves only after the job finishes', async () => {
    const deps = fakeDeps();
    const inFlight = deferred();
    let jobFinished = false;
    deps.workers[0]!.close = vi.fn(async (force?: boolean) => {
      if (!force) {
        await inFlight.promise; // worker.close() waits for active jobs
        deps.order.push('worker.close');
      }
    });
    const shutdown = createWorkerShutdown(deps);

    shutdown('SIGTERM');
    // Nothing past the worker may close while the job is still running.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(deps.queues.close).not.toHaveBeenCalled();
    expect(deps.exit).not.toHaveBeenCalled();

    jobFinished = true;
    inFlight.resolve();
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(jobFinished).toBe(true);
    expect(deps.order[0]).toBe('worker.close');
  });

  it('ignores a second signal while shutting down', async () => {
    const deps = fakeDeps();
    const shutdown = createWorkerShutdown(deps);
    shutdown('SIGTERM');
    shutdown('SIGINT');
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledTimes(1));
    expect(deps.workers[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('force-closes and exits 1 when the graceful path hangs past the timeout', async () => {
    const deps = fakeDeps();
    const never = new Promise<void>(() => {});
    deps.workers[0]!.close = vi.fn((force?: boolean) => {
      if (force) {
        deps.order.push('worker.close(force)');
        return Promise.resolve();
      }
      return never; // graceful close hangs forever
    });

    let forceCallback: (() => void) | null = null;
    const setTimeoutFn = vi.fn((cb: () => void, ms?: number) => {
      expect(ms).toBe(FORCE_SHUTDOWN_TIMEOUT_MS);
      forceCallback = cb;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;

    const shutdown = createWorkerShutdown({ ...deps, setTimeoutFn, clearTimeoutFn: vi.fn() });
    shutdown('SIGTERM');
    expect(forceCallback).not.toBeNull();

    forceCallback!();
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(1));
    expect(deps.workers[0]!.close).toHaveBeenCalledWith(true);
  });

  it('honors a custom forceTimeoutMs', () => {
    const deps = fakeDeps();
    const setTimeoutFn = vi.fn(() => 0 as unknown as ReturnType<typeof setTimeout>);
    createWorkerShutdown({
      ...deps,
      forceTimeoutMs: 5_000,
      setTimeoutFn: setTimeoutFn as unknown as typeof setTimeout,
    })('SIGTERM');
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 5_000);
  });

  it('exits 1 when a close step rejects', async () => {
    const deps = fakeDeps();
    deps.queues.close = vi.fn(async () => {
      throw new Error('redis already gone');
    });
    const shutdown = createWorkerShutdown(deps);
    shutdown('SIGTERM');
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(1));
  });

  it('works without a health server', async () => {
    const deps = fakeDeps();
    const { healthServer: _healthServer, ...rest } = deps;
    const shutdown = createWorkerShutdown(rest);
    shutdown('SIGTERM');
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(deps.order).not.toContain('health.close');
  });
});

function fakeApiDeps() {
  const order: string[] = [];
  return {
    order,
    server: {
      close: (cb?: () => void) => {
        order.push('server.close');
        cb?.();
      },
    },
    queueEvents: {
      close: vi.fn(async () => {
        order.push('queueEvents.close');
      }),
    },
    queues: {
      close: vi.fn(async () => {
        order.push('queues.close');
      }),
    },
    connections: [
      {
        quit: vi.fn(async () => {
          order.push('redis.quit');
        }),
      },
    ],
    closeDatastores: vi.fn(async () => {
      order.push('datastores.close');
    }),
    onQueuesClosed: vi.fn(() => {
      order.push('onQueuesClosed');
    }),
    logger,
    exit: vi.fn((code: number) => {
      order.push(`exit(${code})`);
    }),
  };
}

describe('createApiShutdown', () => {
  it('closes queueEvents → queues → connections → server → datastores, then exits 0', async () => {
    const deps = fakeApiDeps();
    const shutdown = createApiShutdown(deps);
    shutdown('SIGTERM');
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(deps.order).toEqual([
      'queueEvents.close',
      'queues.close',
      'redis.quit',
      'onQueuesClosed',
      'server.close',
      'datastores.close',
      'exit(0)',
    ]);
  });

  it('a second signal is a no-op', async () => {
    const deps = fakeApiDeps();
    const shutdown = createApiShutdown(deps);
    shutdown('SIGTERM');
    shutdown('SIGINT');
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledTimes(1));
    expect(deps.queueEvents.close).toHaveBeenCalledTimes(1);
  });

  it('null queueEvents and queues are skipped without crashing', async () => {
    const deps = fakeApiDeps();
    const shutdown = createApiShutdown({
      ...deps,
      queueEvents: null,
      queues: null,
      onQueuesClosed: undefined,
    });
    shutdown('SIGTERM');
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(deps.order).toEqual([
      'redis.quit',
      'server.close',
      'datastores.close',
      'exit(0)',
    ]);
  });

  it('force-timer exits 1 when the graceful path hangs', async () => {
    const deps = fakeApiDeps();
    deps.queues.close = vi.fn(() => new Promise<void>(() => {}));
    let forceCb: (() => void) | null = null;
    const setTimeoutFn = vi.fn((cb: () => void, ms?: number) => {
      expect(ms).toBe(API_FORCE_SHUTDOWN_TIMEOUT_MS);
      forceCb = cb;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const shutdown = createApiShutdown({
      ...deps,
      setTimeoutFn,
      clearTimeoutFn: vi.fn(),
    });
    shutdown('SIGTERM');
    expect(forceCb).not.toBeNull();
    forceCb!();
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(1));
  });

  it('exits 1 when a close step rejects', async () => {
    const deps = fakeApiDeps();
    deps.queues.close = vi.fn(async () => {
      throw new Error('redis already gone');
    });
    const shutdown = createApiShutdown(deps);
    shutdown('SIGTERM');
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(1));
  });

  it('honors a custom forceTimeoutMs', () => {
    const deps = fakeApiDeps();
    const setTimeoutFn = vi.fn(() => 0 as unknown as ReturnType<typeof setTimeout>);
    createApiShutdown({
      ...deps,
      forceTimeoutMs: 5_000,
      setTimeoutFn: setTimeoutFn as unknown as typeof setTimeout,
    })('SIGTERM');
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 5_000);
  });
});
