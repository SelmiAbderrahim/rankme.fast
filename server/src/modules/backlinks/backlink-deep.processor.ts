import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { backlinkDeepPayloadSchemas, backlinkDeepSnapshots, type BacklinkDeepSnapshotPayloadByType, } from '../../db/schema/index.js';
import type { BacklinkProvider, BacklinkReferringDomainRow, } from '../../shared/providers/index.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
import { VendorUnavailableError, } from '../../shared/providers/index.js';
import { backlinkDeepJobSchema, parseConsumedPayload, type BacklinkDeepJob, } from '../../shared/queue/index.js';
import { createReadThrough, createSingleFlight, createVendorCacheRepo, } from '../../shared/vendor-cache/index.js';
import { BacklinkPullRun, type BacklinkPullType, } from './backlink-runs.model.js';
import { createLinkGapProcessor } from './link-gap.processor.js';
import { deepVendorCacheParams, deepVendorOperation, } from './backlink-vendor-operations.js';
import { createToxicityReviewProcessor } from './toxicity-review.processor.js';
export const BACKLINK_DEEP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export interface BacklinkDeepProcessorDeps {
    db: Db;
    provider: BacklinkProvider;
    ai?: AiProfileRunner;
    aiProviderOrder?: readonly AiGenerationProviderKey[];
    now?: () => Date;
}
const deepSingleFlight = createSingleFlight();
function missingOperation(type: BacklinkPullType): VendorUnavailableError {
    return new VendorUnavailableError(`backlink deep operation unavailable: ${type}`, {
        provider: 'backlink',
        operation: type,
    });
}
function serializeReferringDomains(rows: BacklinkReferringDomainRow[]) {
    return rows.map((row) => ({
        ...row,
        firstSeen: row.firstSeen?.toISOString() ?? null,
        lastSeen: row.lastSeen?.toISOString() ?? null,
    }));
}
async function fetchDeepPayload<Type extends BacklinkPullType>(type: Type, run: {
    domain: string;
    inputs: {
        limit?: number | null;
        domains?: string[];
    };
}, provider: BacklinkProvider): Promise<BacklinkDeepSnapshotPayloadByType[Type]> {
    let payload: unknown;
    switch (type) {
        case 'refDomains': {
            if (!provider.getReferringDomains)
                throw missingOperation(type);
            payload = serializeReferringDomains(await provider.getReferringDomains(run.domain, { limit: run.inputs.limit ?? 500 }));
            break;
        }
        case 'anchors': {
            if (!provider.getAnchors)
                throw missingOperation(type);
            payload = await provider.getAnchors(run.domain, { limit: run.inputs.limit ?? 500 });
            break;
        }
        case 'history': {
            if (!provider.getHistory)
                throw missingOperation(type);
            payload = await provider.getHistory(run.domain, { limit: run.inputs.limit ?? 24 });
            break;
        }
        case 'bulkRanks': {
            if (!provider.getBulkRanks)
                throw missingOperation(type);
            payload = await provider.getBulkRanks(run.inputs.domains ?? []);
            break;
        }
    }
    return backlinkDeepPayloadSchemas[type].parse(payload) as BacklinkDeepSnapshotPayloadByType[Type];
}
export function createBacklinkDeepProcessor(deps: BacklinkDeepProcessorDeps) {
    return async (job: Job<BacklinkDeepJob>): Promise<void> => {
        const payload = parseConsumedPayload(backlinkDeepJobSchema, job.data);
        if (payload.operation === 'toxicity_review') {
            await createToxicityReviewProcessor(deps)(job);
            return;
        }
        if (payload.operation === 'link_gap') {
            await createLinkGapProcessor(deps)(job);
            return;
        }
        const run = await BacklinkPullRun.findOne({
            _id: payload.runId,
            accountId: payload.accountId,
            siteId: payload.siteId,
        });
        if (!run) {
            await createLinkGapProcessor(deps)(job);
            return;
        }
        if (run.status === 'succeeded' || run.status === 'failed')
            return;
        const existing = await deps.db
            .select({ id: backlinkDeepSnapshots.id })
            .from(backlinkDeepSnapshots)
            .where(and(eq(backlinkDeepSnapshots.accountId, payload.accountId), eq(backlinkDeepSnapshots.runId, payload.runId), eq(backlinkDeepSnapshots.type, run.type)))
            .limit(1);
        if (existing.length > 0) {
            await BacklinkPullRun.updateOne({ _id: run._id, accountId: payload.accountId }, { $set: { status: 'succeeded', completedAt: (deps.now ?? (() => new Date()))() } });
            return;
        }
        run.status = 'running';
        await run.save();
        const now = deps.now ?? (() => new Date());
        const readThrough = createReadThrough({
            repo: createVendorCacheRepo(deps.db),
            singleFlight: deepSingleFlight,
            clock: now,
        });
        try {
            const fetched = await readThrough({
                capability: 'backlink',
                operation: deepVendorOperation(run.type),
                params: deepVendorCacheParams({
                    type: run.type,
                    domain: run.domain,
                    limit: run.inputs.limit,
                    domains: run.inputs.domains,
                }),
                ttlMs: BACKLINK_DEEP_CACHE_TTL_MS,
                payloadSchema: backlinkDeepPayloadSchemas[run.type],
                now: now(),
                clock: now,
                fetch: () => fetchDeepPayload(run.type, run, deps.provider),
            });
            const retainedCount = fetched.value.length;
            const retainedAt = fetched.fetchedAt;
            await deps.db
                .insert(backlinkDeepSnapshots)
                .values({
                accountId: payload.accountId,
                siteId: payload.siteId,
                runId: payload.runId,
                type: run.type,
                domain: run.domain,
                payload: fetched.value,
                retainedCount,
                retainedAt,
            })
                .onConflictDoNothing();
            await BacklinkPullRun.updateOne({ _id: run._id, accountId: payload.accountId }, {
                $set: {
                    status: 'succeeded',
                    retainedCount,
                    completedAt: now(),
                },
            });
        }
        catch (error) {
            await BacklinkPullRun.updateOne({ _id: run._id, accountId: payload.accountId }, { $set: { status: 'failed', retainedCount: 0, completedAt: now() } });
            throw error;
        }
    };
}
export { fetchDeepPayload };
