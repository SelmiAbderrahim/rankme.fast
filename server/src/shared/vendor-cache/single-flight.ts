/**
 * In-process single-flight: concurrent misses on the same key share one
 * Promise, so exactly one vendor call happens per (key, TTL window) per
 * process. Cross-process safety is enforced downstream by the ON CONFLICT
 * DO UPDATE contract on the cache upsert — the loser overwrites the
 * winner's row, never inserts a duplicate.
 *
 * Extracted from the original SERP cache repo so every capability shares
 * the same gate.
 */
export interface SingleFlight {
    run<T>(key: string, task: () => Promise<T>): Promise<T>;
    /**
     * Leader-aware variant. Returns `{ value, joined: false }` for the leader
     * (the caller that actually invoked `task`) and `{ value, joined: true }`
     * for every concurrent caller that awaited the leader's promise.
     * Callers that need to distinguish the two — e.g. read-through cache
     * metering — use this instead of `run`.
     */
    runLeaderAware<T>(key: string, task: () => Promise<T>): Promise<{
        value: T;
        joined: boolean;
    }>;
}
export function createSingleFlight(): SingleFlight {
    const inFlight = new Map<string, Promise<unknown>>();
    const runLeaderAware = <T,>(key: string, task: () => Promise<T>): Promise<{
        value: T;
        joined: boolean;
    }> => {
        const existing = inFlight.get(key);
        if (existing) {
            return (existing as Promise<T>).then((value) => ({ value, joined: true }));
        }
        const promise = (async () => {
            try {
                return await task();
            }
            finally {
                inFlight.delete(key);
            }
        })();
        inFlight.set(key, promise);
        return promise.then((value) => ({ value, joined: false }));
    };
    return {
        run<T>(key: string, task: () => Promise<T>): Promise<T> {
            return runLeaderAware(key, task).then((r) => r.value);
        },
        runLeaderAware,
    };
}
