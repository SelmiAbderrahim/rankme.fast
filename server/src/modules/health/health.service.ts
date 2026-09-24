import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { env } from '../../config/env.js';
/** Minimal surface of a Redis client the probe needs — keeps it mockable. */
export interface RedisPingClient {
    ping: () => Promise<string>;
    quit: () => Promise<unknown>;
}
export type RedisClientFactory = (url: string) => RedisPingClient;
/* c8 ignore next 9 -- real ioredis socket; exercised in production, mocked in tests */
const defaultRedisFactory: RedisClientFactory = (url) => new Redis(url, {
    // Connect eagerly and let ping() queue until the socket is ready. Do NOT
    // combine lazyConnect with enableOfflineQueue:false — ping() would then
    // fire before the socket is writable and reject with "Stream isn't
    // writeable", making the probe always report Redis down.
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
});
/* c8 ignore stop */
/**
 * Ping Redis and confirm it answers `PONG`. Any connection/timeout error is a
 * failed probe (returns false) rather than a thrown error — the health route
 * must always answer. The client factory is injectable so the logic is unit
 * tested without a live Redis.
 */
export async function pingRedis(url: string, createClient: RedisClientFactory = defaultRedisFactory): Promise<boolean> {
    const client = createClient(url);
    try {
        const pong = await client.ping();
        return pong === 'PONG';
    }
    catch {
        return false;
        /* c8 ignore next -- the bare catch swallows everything, so the finally's abrupt-completion path is unreachable */
    }
    finally {
        await client.quit().catch(() => undefined);
    }
}
// Indirection so `defaultProbeRedis` can be covered with a mocked `pingRedis`.
export const redisProbe = { pingRedis };
export interface HealthCheckResult {
    status: 'ok' | 'degraded';
    db: boolean;
    redis: boolean;
    redisConfigured: boolean;
    timestamp: string;
}
export interface HealthDeps {
    probeDb?: () => boolean;
    probeRedis?: () => Promise<boolean>;
    now?: () => Date;
}
function defaultProbeDb(): boolean {
    return mongoose.connection.readyState === 1;
}
async function defaultProbeRedis(): Promise<boolean> {
    if (!env.REDIS_URL)
        return true; // not configured = not required
    return redisProbe.pingRedis(env.REDIS_URL);
}
export async function runHealthCheck(deps: HealthDeps = {}): Promise<HealthCheckResult> {
    const db = (deps.probeDb ?? defaultProbeDb)();
    const redis = await (deps.probeRedis ?? defaultProbeRedis)();
    const now = deps.now ? deps.now() : new Date();
    return {
        status: db && redis ? 'ok' : 'degraded',
        db,
        redis,
        redisConfigured: Boolean(env.REDIS_URL),
        timestamp: now.toISOString(),
    };
}
