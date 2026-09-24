/**
 * Worker health endpoint (extended).
 *
 * A minimal `node:http` server — no Express, no middleware chain — serving
 * `GET /healthz` for the compose healthcheck and `GET /health` for a fuller
 * report including queue depths and dead-letter-queue size.
 * Checks + queue-snapshot are injected so this stays dependency-free and
 * unit-testable (the worker composition root wires the redis/mongo/postgres
 * probes and the BullMQ queue handles).
 */
import http from 'node:http';
import type { Logger } from 'pino';
export type HealthCheck = () => Promise<boolean>;
export interface QueueDepthSnapshot {
    waiting: number;
    active: number;
    failed: number;
    /** Oldest waiting or delayed job. Null when the queue has no pending work. */
    oldestPendingAt?: string | null;
}
export interface DeadLetterSnapshot {
    size: number;
    oldest: string | null;
}
export interface QueueSnapshot {
    audits: QueueDepthSnapshot;
    ranks: QueueDepthSnapshot;
    audienceResearch: QueueDepthSnapshot;
    weeklyPulse: QueueDepthSnapshot;
    competitorLandscapes?: QueueDepthSnapshot;
    market?: Partial<Record<'backlink-deep' | 'traffic-snapshots' | 'review-sync' | 'brand-radar', QueueDepthSnapshot>>;
    dlq: DeadLetterSnapshot;
}
export type QueueSnapshotProvider = () => Promise<QueueSnapshot>;
export interface HealthReport {
    status: 'ok' | 'degraded';
    checks: Record<string, boolean>;
    queues?: {
        audits: QueueDepthSnapshot;
        ranks: QueueDepthSnapshot;
        audienceResearch: QueueDepthSnapshot;
        weeklyPulse: QueueDepthSnapshot;
        competitorLandscapes?: QueueDepthSnapshot;
    };
    dlq?: DeadLetterSnapshot;
}
export async function runHealthChecks(checks: Record<string, HealthCheck>): Promise<HealthReport> {
    const entries = await Promise.all(Object.entries(checks).map(async ([name, check]): Promise<[
        string,
        boolean
    ]> => {
        try {
            return [name, (await check()) === true];
        }
        catch {
            return [name, false];
        }
    }));
    const results = Object.fromEntries(entries);
    const healthy = entries.every(([, ok]) => ok);
    return { status: healthy ? 'ok' : 'degraded', checks: results };
}
/**
 * Full health payload — same status roll-up as `runHealthChecks`, plus queue
 * depths and DLQ size when a `queueSnapshot` provider is wired. The status
 * roll-up is driven ONLY by the datastore pings so an empty queue never marks
 * the worker degraded and a full queue never marks it healthy.
 */
export async function runHealthReport(deps: {
    checks: Record<string, HealthCheck>;
    queueSnapshot?: QueueSnapshotProvider;
}): Promise<HealthReport> {
    const base = await runHealthChecks(deps.checks);
    if (!deps.queueSnapshot)
        return base;
    try {
        const snapshot = await deps.queueSnapshot();
        return {
            ...base,
            queues: {
                audits: snapshot.audits,
                ranks: snapshot.ranks,
                audienceResearch: snapshot.audienceResearch,
                weeklyPulse: snapshot.weeklyPulse,
                ...(snapshot.competitorLandscapes
                    ? { competitorLandscapes: snapshot.competitorLandscapes }
                    : {}),
            },
            dlq: snapshot.dlq,
        };
    }
    catch {
        // A queue-read failure MUST NOT flip status: BullMQ hiccups are not the
        // same as datastore outages, and the compose healthcheck reads /healthz.
        return base;
    }
}
export interface HealthServerDeps {
    checks: Record<string, HealthCheck>;
    logger: Logger;
    queueSnapshot?: QueueSnapshotProvider;
}
export function createHealthListener(deps: HealthServerDeps): http.RequestListener {
    return (req, res) => {
        if (req.method !== 'GET') {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
            return;
        }
        if (req.url === '/healthz') {
            // Backward-compatible liveness probe — datastore pings only, no queues.
            runHealthChecks(deps.checks).then((report) => {
                res.writeHead(report.status === 'ok' ? 200 : 503, {
                    'content-type': 'application/json',
                });
                res.end(JSON.stringify(report));
            });
            return;
        }
        if (req.url === '/health') {
            // Full report — queue depths + DLQ appended when a snapshot provider
            // is wired. Status still tracks the datastore pings.
            const snapshotDeps: {
                checks: Record<string, HealthCheck>;
                queueSnapshot?: QueueSnapshotProvider;
            } = { checks: deps.checks };
            /* c8 ignore next -- queueSnapshot is always wired in the worker; the guard handles the naked createHealthHandler() call where it is absent. */
            if (deps.queueSnapshot)
                snapshotDeps.queueSnapshot = deps.queueSnapshot;
            runHealthReport(snapshotDeps).then((report) => {
                res.writeHead(report.status === 'ok' ? 200 : 503, {
                    'content-type': 'application/json',
                });
                res.end(JSON.stringify(report));
            });
            return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
    };
}
export function startHealthServer(deps: HealthServerDeps & {
    port: number;
}): Promise<http.Server> {
    return new Promise((resolve) => {
        const server = http.createServer(createHealthListener(deps));
        server.listen(deps.port, () => {
            deps.logger.info({ port: deps.port }, 'worker health endpoint up');
            resolve(server);
        });
    });
}
