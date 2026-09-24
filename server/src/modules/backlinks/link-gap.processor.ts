import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { backlinkDeepPayloadSchemas, linkGapSnapshotPayloadSchema, linkGapSnapshots, type LinkGapSnapshotPayload, } from '../../db/schema/index.js';
import { VendorUnavailableError, type BacklinkProvider, } from '../../shared/providers/index.js';
import { backlinkDeepJobSchema, parseConsumedPayload, type BacklinkDeepJob, } from '../../shared/queue/index.js';
import { createReadThrough, createSingleFlight, createVendorCacheRepo, } from '../../shared/vendor-cache/index.js';
import { backlinkDeepDomainSchema } from './backlink-deep.schema.js';
import { BACKLINK_VENDOR_OPERATIONS, backlinkBulkRanksCacheParams, backlinkCompetitorsCacheParams, } from './backlink-vendor-operations.js';
import { BACKLINK_PULL_MAX_ROWS, LinkGapRun, type LinkGapLegStatus, } from './backlink-runs.model.js';
export interface LinkGapProcessorDeps {
    db: Db;
    provider: BacklinkProvider;
    now?: () => Date;
}
const gapSingleFlight = createSingleFlight();
export const LINK_GAP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
function missingGapOperation(operation: 'competitors' | 'bulkRanks'): VendorUnavailableError {
    return new VendorUnavailableError(`backlink gap operation unavailable: ${operation}`, {
        provider: 'backlink',
        operation: BACKLINK_VENDOR_OPERATIONS[operation],
    });
}
async function fetchGapCandidates(competitor: string, provider: BacklinkProvider): Promise<LinkGapSnapshotPayload> {
    if (!provider.getBacklinkCompetitors)
        throw missingGapOperation('competitors');
    const rows = await provider.getBacklinkCompetitors(competitor, {
        limit: BACKLINK_PULL_MAX_ROWS,
    });
    const deduped = new Map<string, LinkGapSnapshotPayload[number]>();
    for (const row of rows) {
        const domain = backlinkDeepDomainSchema.parse(row.domain);
        if (!deduped.has(domain)) {
            deduped.set(domain, {
                domain,
                intersections: row.intersections,
                rank: row.rank,
                firstSeen: null,
            });
        }
    }
    return linkGapSnapshotPayloadSchema.parse([...deduped.values()].slice(0, BACKLINK_PULL_MAX_ROWS));
}
function filterOwnDomain(rows: LinkGapSnapshotPayload, ownDomain: string): LinkGapSnapshotPayload {
    const normalizedOwn = backlinkDeepDomainSchema.parse(ownDomain);
    return rows.filter((row) => row.domain !== normalizedOwn);
}
async function fetchGapBulkRanks(domains: string[], provider: BacklinkProvider) {
    if (!provider.getBulkRanks)
        throw missingGapOperation('bulkRanks');
    return backlinkDeepPayloadSchemas.bulkRanks.parse(await provider.getBulkRanks(domains));
}
function mergeGapRanks(rows: LinkGapSnapshotPayload, ranks: Array<{
    domain: string;
    rank: number | null;
}>): LinkGapSnapshotPayload {
    const byDomain = new Map(ranks.map((row) => [row.domain, row.rank]));
    return rows.map((row) => ({
        ...row,
        rank: byDomain.has(row.domain) ? byDomain.get(row.domain)! : row.rank,
    }));
}
export async function fetchLinkGapPayload(ownDomain: string, competitor: string, provider: BacklinkProvider): Promise<LinkGapSnapshotPayload> {
    const candidates = filterOwnDomain(await fetchGapCandidates(competitor, provider), ownDomain);
    const rankDomains = candidates.slice(0, 100).map((row) => row.domain);
    if (rankDomains.length === 0)
        return candidates;
    return mergeGapRanks(candidates, await fetchGapBulkRanks(rankDomains, provider));
}
export async function settleLinkGapLeg(runId: string, accountId: string, outcome: {
    competitor: string;
    status: LinkGapLegStatus;
    retainedCount: number;
}): Promise<boolean> {
    const result = await LinkGapRun.updateOne({
        _id: runId,
        accountId,
        'perLegOutcomes.competitor': { $ne: outcome.competitor },
    }, {
        $push: { perLegOutcomes: outcome },
    });
    return result.modifiedCount === 1;
}
async function storedLeg(db: Db, accountId: string, runId: string, competitor: string) {
    const rows = await db
        .select()
        .from(linkGapSnapshots)
        .where(and(eq(linkGapSnapshots.accountId, accountId), eq(linkGapSnapshots.runId, runId), eq(linkGapSnapshots.competitor, competitor)))
        .limit(1);
    return rows[0];
}
export function createLinkGapProcessor(deps: LinkGapProcessorDeps) {
    return async (job: Job<BacklinkDeepJob>): Promise<void> => {
        const payload = parseConsumedPayload(backlinkDeepJobSchema, job.data);
        const run = await LinkGapRun.findOne({
            _id: payload.runId,
            accountId: payload.accountId,
            siteId: payload.siteId,
        });
        if (!run || run.status === 'succeeded' || run.status === 'failed')
            return;
        if (run.status === 'queued') {
            run.status = 'running';
            await run.save();
        }
        const now = deps.now ?? (() => new Date());
        const readThrough = createReadThrough({
            repo: createVendorCacheRepo(deps.db),
            singleFlight: gapSingleFlight,
            clock: now,
        });
        let firstError: unknown;
        for (const competitor of run.competitors) {
            if (run.perLegOutcomes.some((outcome) => outcome.competitor === competitor))
                continue;
            const existing = await storedLeg(deps.db, payload.accountId, payload.runId, competitor);
            if (existing) {
                await settleLinkGapLeg(payload.runId, payload.accountId, {
                    competitor,
                    status: existing.retainedCount === 0 ? 'zeroRetained' : 'ok',
                    retainedCount: existing.retainedCount,
                });
                continue;
            }
            try {
                const competitorFetched = await readThrough({
                    capability: 'backlink',
                    operation: BACKLINK_VENDOR_OPERATIONS.competitors,
                    params: backlinkCompetitorsCacheParams(competitor, BACKLINK_PULL_MAX_ROWS),
                    ttlMs: LINK_GAP_CACHE_TTL_MS,
                    payloadSchema: linkGapSnapshotPayloadSchema,
                    now: now(),
                    clock: now,
                    fetch: () => fetchGapCandidates(competitor, deps.provider),
                });
                const candidates = filterOwnDomain(linkGapSnapshotPayloadSchema.parse(competitorFetched.value), run.ownDomain);
                const rankDomains = candidates.slice(0, 100).map((row) => row.domain);
                let value = candidates;
                let retainedAt = competitorFetched.fetchedAt;
                if (rankDomains.length > 0) {
                    const bulkFetched = await readThrough({
                        capability: 'backlink',
                        operation: BACKLINK_VENDOR_OPERATIONS.bulkRanks,
                        params: backlinkBulkRanksCacheParams(rankDomains),
                        ttlMs: LINK_GAP_CACHE_TTL_MS,
                        payloadSchema: backlinkDeepPayloadSchemas.bulkRanks,
                        now: now(),
                        clock: now,
                        fetch: () => fetchGapBulkRanks(rankDomains, deps.provider),
                    });
                    value = mergeGapRanks(candidates, bulkFetched.value);
                    if (bulkFetched.fetchedAt.getTime() > retainedAt.getTime()) {
                        retainedAt = bulkFetched.fetchedAt;
                    }
                }
                await deps.db
                    .insert(linkGapSnapshots)
                    .values({
                    accountId: payload.accountId,
                    siteId: payload.siteId,
                    runId: payload.runId,
                    ownDomain: run.ownDomain,
                    competitor,
                    payload: value,
                    retainedCount: value.length,
                    retainedAt,
                })
                    .onConflictDoNothing();
                await settleLinkGapLeg(payload.runId, payload.accountId, {
                    competitor,
                    status: value.length === 0 ? 'zeroRetained' : 'ok',
                    retainedCount: value.length,
                });
            }
            catch (error) {
                await settleLinkGapLeg(payload.runId, payload.accountId, {
                    competitor,
                    status: 'failed',
                    retainedCount: 0,
                });
                firstError ??= error;
            }
        }
        const settled = await LinkGapRun.findOne({
            _id: payload.runId,
            accountId: payload.accountId,
        });
        if (!settled)
            return;
        const complete = settled.perLegOutcomes.length === settled.competitors.length;
        if (complete) {
            await LinkGapRun.updateOne({ _id: settled._id, accountId: payload.accountId }, {
                $set: {
                    status: settled.perLegOutcomes.some((outcome) => outcome.status === 'failed')
                        ? 'failed'
                        : 'succeeded',
                    completedAt: now(),
                },
            });
        }
        if (firstError)
            throw firstError;
    };
}
