/**
 * Rate-limit metrics sink.
 *
 * The sink is a fire-and-forget insert into `rate_limit_hits` — a metrics
 * write failure MUST NOT mask the 429 or throw into the request. The Drizzle
 * client is set at boot via `setRateLimitDb(db)` (mirrors the other module
 * holders). When unset (test bootstrap, self-host without postgres) recording
 * silently no-ops.
 */
import { count, gte, lt } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../../db/client.js';
import { RATE_LIMIT_ROUTES, rateLimitHits, type RateLimitRoute } from '../../db/schema/rate-limit-hits.js';
let currentDb: Db | null = null;
let currentLogger: Logger | null = null;
export function setRateLimitMetricsDb(db: Db | null): void {
    currentDb = db;
}
export function setRateLimitMetricsLogger(logger: Logger | null): void {
    currentLogger = logger;
}
export interface RecordRateLimitHitInput {
    route: RateLimitRoute;
    ip?: string | null;
    accountId?: string | null;
}
/**
 * Fire-and-forget insert. Returns a promise for tests but callers never await
 * it — see rateLimitHandler for the (void _)-then-log pattern.
 */
export async function recordRateLimitHit(input: RecordRateLimitHitInput): Promise<void> {
    if (!currentDb)
        return;
    try {
        await currentDb.insert(rateLimitHits).values({
            route: input.route,
            ip: input.ip ?? null,
            accountId: input.accountId ?? null,
        });
    }
    catch (err) {
        // Never rethrow — metrics is best-effort. Log so operators still see it.
        currentLogger?.warn({ err, route: input.route }, 'rate-limit metrics insert failed');
    }
}
export interface RateLimitPressureRow {
    route: RateLimitRoute;
    count: number;
}
/**
 * Rolling-window aggregation over `rate_limit_hits`. Returns one row per known
 * route (zero-filled) so the admin panel always shows both cards even when a
 * route has never been rate-limited.
 */
export async function loadRateLimitPressure(windowMs: number, db: Db | null = currentDb): Promise<RateLimitPressureRow[]> {
    const routes: readonly RateLimitRoute[] = RATE_LIMIT_ROUTES;
    if (!db) {
        return routes.map((route) => ({ route, count: 0 }));
    }
    const cutoff = new Date(Date.now() - windowMs);
    const rows = await db
        .select({ route: rateLimitHits.route, total: count() })
        .from(rateLimitHits)
        .where(gte(rateLimitHits.hitAt, cutoff))
        .groupBy(rateLimitHits.route);
    const byRoute = new Map<string, number>();
    for (const row of rows)
        byRoute.set(String(row.route), Number(row.total));
    return routes.map((route) => ({ route, count: byRoute.get(route) ?? 0 }));
}
/**
 * Periodic prune. `rate_limit_hits` is row-per-429
 * over-time; keeping every row forever is billing us for pressure that lasted
 * a week. Retention is the aggregation window (default 30 days). `accountId`
 * is null on every pre-auth 429 — kept as an operator hook in case a future
 * post-auth limiter wants to attribute pressure to an account.
 */
export const RATE_LIMIT_PRUNE_QUEUE = 'rate-limit-prune';
export const RATE_LIMIT_PRUNE_JOB = 'sweep';
export const RATE_LIMIT_PRUNE_SCHEDULER_KEY = 'rate-limit-prune-sweep';
/** Once a day. */
export const RATE_LIMIT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Rows older than 30 days are dropped. */
export const RATE_LIMIT_PRUNE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export interface RateLimitPruneDeps {
    db: Db;
    logger?: Logger;
    now?: () => Date;
    retentionMs?: number;
}
export async function pruneOldRateLimitHits(deps: RateLimitPruneDeps): Promise<number> {
    const now = (deps.now ?? (() => new Date()))();
    const retentionMs = deps.retentionMs ?? RATE_LIMIT_PRUNE_RETENTION_MS;
    const cutoff = new Date(now.getTime() - retentionMs);
    const result = await deps.db
        .delete(rateLimitHits)
        .where(lt(rateLimitHits.hitAt, cutoff))
        .returning({ id: rateLimitHits.id });
    const pruned = result.length;
    deps.logger?.info({ cutoff, pruned }, 'rate-limit-hits pruned');
    return pruned;
}
/**
 * BullMQ processor. Registered on the worker; runs `pruneOldRateLimitHits`
 * every `RATE_LIMIT_PRUNE_INTERVAL_MS`.
 */
export function createRateLimitPruneProcessor(deps: RateLimitPruneDeps) {
    return async (): Promise<{
        pruned: number;
    }> => ({
        pruned: await pruneOldRateLimitHits(deps),
    });
}
