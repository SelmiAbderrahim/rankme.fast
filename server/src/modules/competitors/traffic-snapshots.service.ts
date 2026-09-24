import type { Queue } from 'bullmq';
import { and, desc, eq, gte, inArray, isNull, lte, lt, or, type SQL, } from 'drizzle-orm';
import { Types } from 'mongoose';
import { z } from 'zod';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { parseTrafficSnapshotPayload, trafficSnapshots, type TrafficSnapshotPayload, } from '../../db/schema/index.js';
import { enqueueTrafficSnapshotJob, } from '../../shared/queue/index.js';
import { createVendorCacheRepo, probeReadThrough, } from '../../shared/vendor-cache/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { trafficProviderBundleSchema, type CreateTrafficSnapshotInput, type TrafficRetainedOps, type TrafficSnapshotListQuery, } from './traffic-snapshots.schema.js';
import { TrafficSnapshotRun, type TrafficSnapshotRunHydrated, } from './traffic-snapshots.model.js';
export const TRAFFIC_SNAPSHOT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const TRAFFIC_SNAPSHOT_UNAVAILABLE_KEY = 'trafficInsights.errors.productUnavailable';
export const TRAFFIC_SNAPSHOT_NOT_FOUND_KEY = 'trafficInsights.errors.notFound';
export interface TrafficSnapshotServiceDeps {
    db: Db;
    queue: Queue | null;
    now?: () => Date;
}
async function loadOwnedSite(accountId: string, siteId: string): Promise<void> {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'TRAFFIC_SNAPSHOT_NOT_FOUND', messageKey: TRAFFIC_SNAPSHOT_NOT_FOUND_KEY });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'TRAFFIC_SNAPSHOT_NOT_FOUND', messageKey: TRAFFIC_SNAPSHOT_NOT_FOUND_KEY });
    // Sole caller is the vendor-call path (`enqueueSnapshot`) — a paused site
    // must not enqueue a snapshot run.
    assertSiteNotPaused(site);
}
function serializeRun(run: TrafficSnapshotRunHydrated) {
    return {
        id: String(run._id),
        siteId: run.siteId ? String(run.siteId) : null,
        targetDomain: run.targetDomain,
        inputs: {
            locationCode: run.inputs.locationCode,
            languageCode: run.inputs.languageCode,
            historyMonths: run.inputs.historyMonths,
        },
        status: run.status,
        retainedOps: {
            traffic: run.retainedOps.traffic,
            rankOverview: run.retainedOps.rankOverview,
            history: run.retainedOps.history,
        },
        createdAt: run.createdAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
    };
}
/** Parse is done by the controller; this preserves own → probe → run → enqueue. */
export async function enqueueSnapshot(accountId: string, input: CreateTrafficSnapshotInput, deps: TrafficSnapshotServiceDeps) {
    if (input.siteId)
        await loadOwnedSite(accountId, input.siteId);
    if (!env.TRAFFIC_INSIGHTS_ENABLED || !deps.queue) {
        throw new HttpError(503, { code: 'TRAFFIC_SNAPSHOT_UNAVAILABLE', messageKey: TRAFFIC_SNAPSHOT_UNAVAILABLE_KEY });
    }
    const now = (deps.now ?? (() => new Date()))();
    const cacheProbe = await probeReadThrough(createVendorCacheRepo(deps.db), {
        capability: 'competitor',
        operation: 'traffic',
        cacheKey: input.targetDomain,
        params: { targetDomain: input.targetDomain },
        payloadSchema: trafficProviderBundleSchema,
        now,
    });
    const run = await TrafficSnapshotRun.create({
        accountId,
        siteId: input.siteId ?? null,
        targetDomain: input.targetDomain,
        inputs: {
            locationCode: input.locationCode,
            languageCode: input.languageCode,
            historyMonths: input.historyMonths,
        },
        status: 'queued',
        retainedOps: { traffic: false, rankOverview: false, history: false },
        completedAt: null,
    });
    try {
        await enqueueTrafficSnapshotJob(deps.queue, {
            accountId,
            runId: String(run._id),
        });
    }
    catch (error) {
        await TrafficSnapshotRun.updateOne({ _id: run._id, accountId }, { $set: { status: 'failed', completedAt: now } });
        throw new HttpError(503, { code: 'TRAFFIC_SNAPSHOT_UNAVAILABLE', messageKey: TRAFFIC_SNAPSHOT_UNAVAILABLE_KEY }, undefined, {
            cause: error,
        });
    }
    return {
        runId: String(run._id),
        status: 'queued' as const,
        targetDomain: input.targetDomain,
        cached: cacheProbe.cached,
    };
}
export interface SettleTrafficSnapshotInput {
    accountId: string;
    runId: string;
    retainedOps: TrafficRetainedOps;
    payload: TrafficSnapshotPayload | null;
    capturedAt: Date;
}
export async function settleRun(input: SettleTrafficSnapshotInput, deps: Pick<TrafficSnapshotServiceDeps, 'db'>) {
    const retainedCount = Object.values(input.retainedOps).filter(Boolean).length;
    const status = retainedCount === 3 ? 'succeeded' : retainedCount > 0 ? 'partial' : 'failed';
    if (retainedCount > 0) {
        if (!input.payload) {
            throw new Error('retained traffic snapshot operations require a payload');
        }
        const run = await TrafficSnapshotRun.findOne({
            _id: input.runId,
            accountId: input.accountId,
        });
        if (!run)
            throw HttpError.notFound({ code: 'TRAFFIC_SNAPSHOT_NOT_FOUND', messageKey: TRAFFIC_SNAPSHOT_NOT_FOUND_KEY });
        const parsedPayload = parseTrafficSnapshotPayload(input.payload);
        await deps.db
            .insert(trafficSnapshots)
            .values({
            accountId: input.accountId,
            runId: input.runId,
            siteId: run.siteId ? String(run.siteId) : null,
            targetDomain: run.targetDomain,
            payload: parsedPayload,
            capturedAt: input.capturedAt,
        })
            .onConflictDoNothing({
            target: [trafficSnapshots.accountId, trafficSnapshots.runId],
        });
        await TrafficSnapshotRun.updateOne({
            _id: input.runId,
            accountId: input.accountId,
            status: { $in: ['queued', 'running'] },
        }, {
            $set: {
                status,
                retainedOps: input.retainedOps,
                completedAt: input.capturedAt,
            },
        });
        return { status };
    }
    await TrafficSnapshotRun.updateOne({
        _id: input.runId,
        accountId: input.accountId,
        status: { $in: ['queued', 'running'] },
    }, {
        $set: {
            status: 'failed',
            retainedOps: input.retainedOps,
            completedAt: input.capturedAt,
        },
    });
    return { status: 'failed' as const };
}
export async function getSnapshot(accountId: string, runId: string, db: Db, siteId?: string) {
    const run = await TrafficSnapshotRun.findOne({
        _id: runId,
        accountId,
        ...(siteId ? { siteId } : {}),
    });
    if (!run)
        throw HttpError.notFound({ code: 'TRAFFIC_SNAPSHOT_NOT_FOUND', messageKey: TRAFFIC_SNAPSHOT_NOT_FOUND_KEY });
    const rows = await db
        .select()
        .from(trafficSnapshots)
        .where(and(eq(trafficSnapshots.accountId, accountId), eq(trafficSnapshots.runId, runId), ...(siteId ? [eq(trafficSnapshots.siteId, siteId)] : [])))
        .limit(1);
    const snapshot = rows[0];
    return {
        ...serializeRun(run),
        snapshot: snapshot
            ? {
                capturedAt: snapshot.capturedAt.toISOString(),
                payload: parseTrafficSnapshotPayload(snapshot.payload),
            }
            : null,
    };
}
/** Site-linked snapshots inherit Site deletion; account-wide snapshots remain readable. */
export async function resolveOwnedTrafficSnapshotSiteId(accountId: string, runId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(runId))
        return null;
    const run = await TrafficSnapshotRun.findOne({ _id: runId, accountId }, { siteId: 1 }).lean();
    return run?.siteId ? String(run.siteId) : null;
}
interface SnapshotCursor {
    capturedAt: string;
    id: string;
}
export function encodeTrafficSnapshotCursor(cursor: SnapshotCursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
export function decodeTrafficSnapshotCursor(cursor: string): SnapshotCursor {
    try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
        const schema = trafficSnapshotCursorSchema.safeParse(parsed);
        if (!schema.success)
            throw new Error('invalid cursor');
        return schema.data;
    }
    catch {
        throw HttpError.badRequest({ code: 'TRAFFIC_INSIGHTS_ERRORS_INVALID_CURSOR', messageKey: 'trafficInsights.errors.invalidCursor' });
    }
}
const trafficSnapshotCursorSchema = z
    .object({
    capturedAt: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
})
    .strict();
export async function listSnapshots(accountId: string, query: TrafficSnapshotListQuery, db: Db, allowedSiteIds: readonly string[] | null = null) {
    const filters: SQL[] = [eq(trafficSnapshots.accountId, accountId)];
    const liveSites = await Site.find({ accountId, deletionStartedAt: null }, { _id: 1 }).lean();
    const grantedSiteIds = allowedSiteIds === null ? null : new Set(allowedSiteIds);
    const liveSiteIds = liveSites
        .map((site) => String(site._id))
        .filter((siteId) => grantedSiteIds === null || grantedSiteIds.has(siteId));
    if (query.siteId && !liveSiteIds.includes(query.siteId)) {
        throw HttpError.notFound({
            code: 'TRAFFIC_SNAPSHOT_NOT_FOUND',
            messageKey: TRAFFIC_SNAPSHOT_NOT_FOUND_KEY,
        });
    }
    // Unrestricted actors retain legacy account-wide snapshots (`siteId=null`).
    // Selected-scope actors see only live Site-bound rows in their exact grant.
    filters.push(allowedSiteIds === null
        ? liveSiteIds.length > 0
            ? or(isNull(trafficSnapshots.siteId), inArray(trafficSnapshots.siteId, liveSiteIds))!
            : isNull(trafficSnapshots.siteId)
        : liveSiteIds.length > 0
            ? inArray(trafficSnapshots.siteId, liveSiteIds)
            : eq(trafficSnapshots.siteId, '__no_accessible_site__'));
    if (query.siteId)
        filters.push(eq(trafficSnapshots.siteId, query.siteId));
    if (query.domain)
        filters.push(eq(trafficSnapshots.targetDomain, query.domain));
    if (query.from)
        filters.push(gte(trafficSnapshots.capturedAt, query.from));
    if (query.to)
        filters.push(lte(trafficSnapshots.capturedAt, query.to));
    if (query.cursor) {
        const cursor = decodeTrafficSnapshotCursor(query.cursor);
        const capturedAt = new Date(cursor.capturedAt);
        filters.push(or(lt(trafficSnapshots.capturedAt, capturedAt), and(eq(trafficSnapshots.capturedAt, capturedAt), lt(trafficSnapshots.id, cursor.id)))!);
    }
    const rows = await db
        .select()
        .from(trafficSnapshots)
        .where(and(...filters))
        .orderBy(desc(trafficSnapshots.capturedAt), desc(trafficSnapshots.id))
        .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
        snapshots: page.map((row) => ({
            id: row.runId,
            siteId: row.siteId,
            targetDomain: row.targetDomain,
            capturedAt: row.capturedAt.toISOString(),
            payload: parseTrafficSnapshotPayload(row.payload),
        })),
        nextCursor: hasMore && last
            ? encodeTrafficSnapshotCursor({
                capturedAt: last.capturedAt.toISOString(),
                id: last.id,
            })
            : null,
    };
}
export async function getSnapshotsForDomain(accountId: string, targetDomain: string, db: Db) {
    const liveSites = await Site.find({ accountId, deletionStartedAt: null }, { _id: 1 }).lean();
    const liveSiteIds = liveSites.map((site) => String(site._id));
    const rows = await db
        .select()
        .from(trafficSnapshots)
        .where(and(eq(trafficSnapshots.accountId, accountId), eq(trafficSnapshots.targetDomain, targetDomain), liveSiteIds.length > 0
        ? or(isNull(trafficSnapshots.siteId), inArray(trafficSnapshots.siteId, liveSiteIds))!
        : isNull(trafficSnapshots.siteId)))
        .orderBy(desc(trafficSnapshots.capturedAt));
    return rows.map((row) => ({
        ...row,
        payload: parseTrafficSnapshotPayload(row.payload),
    }));
}
