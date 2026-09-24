/**
 * In-process cooldown: a timestamp per key. Used by the manual refresh
 * endpoints to keep a double-click or a rapid retry loop from double-billing
 * a real vendor call (design constraint 6).
 *
 * In-process ONLY (a plain Map, no Redis) — the single-api-process deployment
 * is the common case for the self-hosted stack. Multi-process deployments
 * defer to a Redis-backed implementation in a later prompt; the interface is
 * the seam.
 */
export class CooldownError extends Error {
    readonly retryAfterMs: number;
    constructor(retryAfterMs: number) {
        super('cooldown active');
        this.name = 'CooldownError';
        this.retryAfterMs = retryAfterMs;
    }
}
export interface Cooldown {
    /** Throws `CooldownError` (with `retryAfterMs`) if `key` is inside its window. */
    assert(key: string, ms?: number): void;
    /** Record "now" as the start of `key`'s window. */
    touch(key: string): void;
    /** Forget `key` entirely — the next `assert` passes. */
    clear(key: string): void;
}
export interface CreateInMemoryCooldownInput {
    /** Window length applied when `assert` gets no per-call override. */
    defaultMs: number;
    /** Clock, injectable so tests can advance time deterministically. */
    now?: () => number;
}
export function createInMemoryCooldown(input: CreateInMemoryCooldownInput): Cooldown {
    const nowFn = input.now ?? (() => Date.now());
    const touched = new Map<string, number>();
    return {
        assert(key, ms) {
            const last = touched.get(key);
            if (last === undefined)
                return;
            const window = ms ?? input.defaultMs;
            const elapsed = nowFn() - last;
            if (elapsed < window)
                throw new CooldownError(window - elapsed);
        },
        touch(key) {
            touched.set(key, nowFn());
        },
        clear(key) {
            touched.delete(key);
        },
    };
}
