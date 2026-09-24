import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { backlinkDeepSnapshots, parseBacklinkDeepSnapshotPayload, } from '../../db/schema/index.js';
import { enqueueBacklinkDeepJob } from '../../shared/queue/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/sites.model.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { BacklinkPullRun, type BacklinkPullRunHydrated, type BacklinkPullType, } from './backlink-runs.model.js';
import type { BacklinkRunsQuery, BulkRanksBody, } from './backlink-deep.schema.js';
export const LINK_INTEL_UNAVAILABLE_KEY = 'backlinks.errors.unavailable';
export interface BacklinkDeepServiceDeps {
    queue: Queue | null;
    now?: () => Date;
}
export interface StartBacklinkDeepPullInput {
    accountId: string;
    type: BacklinkPullType;
    siteId: string;
    limit?: number;
    domains?: BulkRanksBody['domains'];
}
async function loadOwnedSite(accountId: string, siteId: string) {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' });
    return site;
}
/** Parse happens in the controller. This service preserves own → flag → run → enqueue. */
export async function startBacklinkDeepPull(input: StartBacklinkDeepPullInput, deps: BacklinkDeepServiceDeps) {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    assertSiteNotPaused(site);
    if (!env.LINK_INTELLIGENCE_ENABLED) {
        throw new HttpError(503, { code: 'LINK_INTEL_UNAVAILABLE', messageKey: LINK_INTEL_UNAVAILABLE_KEY });
    }
    if (!deps.queue) {
        throw new HttpError(503, { code: 'LINK_INTEL_UNAVAILABLE', messageKey: LINK_INTEL_UNAVAILABLE_KEY });
    }
    const run: BacklinkPullRunHydrated = await BacklinkPullRun.create({
        accountId: input.accountId,
        siteId: input.siteId,
        type: input.type,
        domain: site.domain,
        inputs: {
            limit: input.limit ?? null,
            domains: input.domains ?? [],
        },
        status: 'queued',
        retainedCount: 0,
        completedAt: null,
    });
    try {
        await enqueueBacklinkDeepJob(deps.queue, {
            accountId: input.accountId,
            siteId: input.siteId,
            runId: String(run._id),
            operation: 'deep_pull',
        });
    }
    catch (error) {
        await BacklinkPullRun.updateOne({ _id: run._id, accountId: input.accountId }, { $set: { status: 'failed', completedAt: (deps.now ?? (() => new Date()))() } });
        throw new HttpError(503, { code: 'LINK_INTEL_UNAVAILABLE', messageKey: LINK_INTEL_UNAVAILABLE_KEY }, undefined, { cause: error });
    }
    return {
        runId: String(run._id),
        siteId: input.siteId,
        type: input.type,
        status: 'queued' as const,
    };
}
function serializeRun(run: BacklinkPullRunHydrated) {
    return {
        runId: String(run._id),
        siteId: String(run.siteId),
        type: run.type,
        domain: run.domain,
        inputs: {
            limit: run.inputs.limit ?? null,
            domains: run.inputs.domains,
        },
        status: run.status,
        retainedCount: run.retainedCount,
        createdAt: run.createdAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
    };
}
export async function listBacklinkDeepRuns(accountId: string, query: BacklinkRunsQuery) {
    await loadOwnedSite(accountId, query.siteId);
    const filter: Record<string, unknown> = {
        accountId,
        siteId: query.siteId,
        ...(query.type ? { type: query.type } : {}),
        ...(query.cursor ? { _id: { $lt: query.cursor } } : {}),
    };
    const docs = await BacklinkPullRun.find(filter)
        .sort({ _id: -1 })
        .limit(query.limit + 1);
    const hasMore = docs.length > query.limit;
    const page = hasMore ? docs.slice(0, query.limit) : docs;
    return {
        runs: page.map(serializeRun),
        nextCursor: hasMore && page.length > 0 ? String(page.at(-1)!._id) : null,
    };
}
export async function getBacklinkDeepRun(accountId: string, runId: string, db: Db) {
    const run = await BacklinkPullRun.findOne({ _id: runId, accountId });
    if (!run)
        throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' });
    const rows = await db
        .select()
        .from(backlinkDeepSnapshots)
        .where(and(eq(backlinkDeepSnapshots.accountId, accountId), eq(backlinkDeepSnapshots.runId, runId)))
        .limit(1);
    const snapshot = rows[0];
    return {
        ...serializeRun(run),
        result: snapshot
            ? {
                rows: parseBacklinkDeepSnapshotPayload(snapshot.type, snapshot.payload),
                observation: {
                    capturedAt: snapshot.retainedAt.toISOString(),
                    source: 'provider_observation' as const,
                },
            }
            : null,
    };
}
export async function resolveOwnedBacklinkDeepRunSiteId(accountId: string, runId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(runId))
        return null;
    const run = await BacklinkPullRun.findOne({ _id: runId, accountId }, { siteId: 1 }).lean();
    return run ? String(run.siteId) : null;
}
