/**
 * Graceful worker shutdown.
 *
 * SIGTERM/SIGINT → close workers (waits for in-flight jobs), close queues,
 * quit Redis, close the health server, disconnect Mongo/Postgres, exit 0.
 * A force timer (default 30s) closes workers with `close(true)` — dropping
 * in-flight jobs back to the queue — and exits 1 if the graceful path
 * hangs. All process-level effects (exit, timers) are injected for tests.
 */
import type { Logger } from 'pino';
export interface CloseableWorker {
    close(force?: boolean): Promise<void>;
}
export interface CloseableServer {
    close(onClosed?: () => void): unknown;
}
export interface QuittableConnection {
    quit(): Promise<unknown>;
}
export interface WorkerShutdownDeps {
    workers: CloseableWorker[];
    queues: {
        close(): Promise<void>;
    };
    connections: QuittableConnection[];
    healthServer?: CloseableServer;
    closeDatastores: () => Promise<void>;
    logger: Logger;
    exit: (code: number) => void;
    forceTimeoutMs?: number;
    setTimeoutFn?: typeof setTimeout;
    clearTimeoutFn?: typeof clearTimeout;
}
export const FORCE_SHUTDOWN_TIMEOUT_MS = 30000;
/** Api process: 10s. api handles user traffic; force sooner. */
export const API_FORCE_SHUTDOWN_TIMEOUT_MS = 10000;
export interface ApiShutdownDeps {
    /** HTTP server to close (Express `listen()` return value). */
    server: CloseableServer;
    /** api-side QueueEvents watcher — null when Redis is not configured. */
    queueEvents: {
        close(): Promise<void>;
    } | null;
    /** BullMQ `Queues` bundle used by producers — null when Redis is not configured. */
    queues: {
        close(): Promise<void>;
    } | null;
    /** ioredis producer connections that must `quit()` before exit. */
    connections: QuittableConnection[];
    closeDatastores: () => Promise<void>;
    /** Fires AFTER queues close but BEFORE datastores/exit — production wires
     * this to reset the process-local queue holders so a late request cannot
     * enqueue against a closed queue. */
    onQueuesClosed?: () => void;
    logger: Logger;
    exit: (code: number) => void;
    forceTimeoutMs?: number;
    setTimeoutFn?: typeof setTimeout;
    clearTimeoutFn?: typeof clearTimeout;
}
/**
 * Api-process graceful shutdown. Mirrors `createWorkerShutdown` in shape so
 * both entrypoints follow the same idioms — re-entrant on a second signal,
 * force-timer backstop, close ordering explicit.
 *
 * Order: queueEvents → queues → connections → server.close → datastores → exit(0).
 */
export function createApiShutdown(deps: ApiShutdownDeps): (signal: string) => void {
    const forceTimeoutMs = deps.forceTimeoutMs ?? API_FORCE_SHUTDOWN_TIMEOUT_MS;
    const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
    const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
    let shuttingDown = false;
    return (signal: string): void => {
        if (shuttingDown)
            return; // second signal — graceful path already running
        shuttingDown = true;
        deps.logger.info({ signal }, 'api shutting down');
        const forceTimer = setTimeoutFn(() => {
            deps.logger.error({ forceTimeoutMs }, 'api graceful shutdown timed out — forcing');
            deps.exit(1);
        }, forceTimeoutMs);
        (forceTimer as {
            unref?: () => void;
        }).unref?.();
        void (async () => {
            if (deps.queueEvents) {
                await deps.queueEvents.close();
            }
            if (deps.queues) {
                await deps.queues.close();
            }
            await Promise.allSettled(deps.connections.map((c) => c.quit()));
            deps.onQueuesClosed?.();
            await new Promise<void>((resolve) => {
                deps.server.close(() => resolve());
            });
            await deps.closeDatastores();
            clearTimeoutFn(forceTimer);
            deps.logger.info('api shutdown complete');
            deps.exit(0);
        })().catch((err: unknown) => {
            deps.logger.error({ err }, 'api graceful shutdown failed');
            clearTimeoutFn(forceTimer);
            deps.exit(1);
        });
    };
}
export function createWorkerShutdown(deps: WorkerShutdownDeps): (signal: string) => void {
    const forceTimeoutMs = deps.forceTimeoutMs ?? FORCE_SHUTDOWN_TIMEOUT_MS;
    const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
    const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
    let shuttingDown = false;
    return (signal: string): void => {
        if (shuttingDown)
            return; // second signal — graceful path already running
        shuttingDown = true;
        deps.logger.info({ signal }, 'worker shutting down');
        const forceTimer = setTimeoutFn(() => {
            deps.logger.error({ forceTimeoutMs }, 'graceful shutdown timed out — forcing');
            void Promise.allSettled(deps.workers.map((w) => w.close(true))).then(() => deps.exit(1));
        }, forceTimeoutMs);
        (forceTimer as {
            unref?: () => void;
        }).unref?.();
        void (async () => {
            // close() without force waits for in-flight jobs to finish.
            await Promise.all(deps.workers.map((w) => w.close()));
            await deps.queues.close();
            await Promise.allSettled(deps.connections.map((c) => c.quit()));
            if (deps.healthServer) {
                await new Promise<void>((resolve) => {
                    deps.healthServer!.close(() => resolve());
                });
            }
            await deps.closeDatastores();
            clearTimeoutFn(forceTimer);
            deps.logger.info('worker shutdown complete');
            deps.exit(0);
        })().catch((err: unknown) => {
            deps.logger.error({ err }, 'graceful shutdown failed');
            clearTimeoutFn(forceTimer);
            deps.exit(1);
        });
    };
}
