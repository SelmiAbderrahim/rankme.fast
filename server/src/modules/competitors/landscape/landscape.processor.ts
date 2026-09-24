import type { Job, Queue } from 'bullmq';
import type { Logger } from 'pino';
import { Types } from 'mongoose';
import { captureVendorCost, ProviderError, VendorMalformedError, VendorQuotaError, VendorTimeoutError, type CompetitorProvider, type DomainComparisonResult, type DomainComparisonRow, } from '../../../shared/providers/index.js';
import { competitorLandscapeJobSchema, enqueueCompetitorLandscapeJob, parseConsumedPayload, } from '../../../shared/queue/index.js';
import { createVendorCacheRepo, type VendorCacheRepo, } from '../../../shared/vendor-cache/index.js';
import { Site } from '../../sites/index.js';
import { aggregateLandscape } from './landscape.aggregate.js';
import { landscapeCacheKey, LANDSCAPE_CACHE_OPERATION, nextUtcMidnight, } from './landscape.cache.js';
import { landscapeContentHash, sha256CanonicalLandscape, } from './landscape.canonical.js';
import { CompetitorLandscapeLegCheckpoint, CompetitorLandscapeReportPage, CompetitorLandscapeRun, LANDSCAPE_SCHEMA_VERSION, type CompetitorLandscapeRunHydrated, } from './landscape.model.js';
import { LANDSCAPE_LEGS, LANDSCAPE_TERMINAL_STATES, landscapeProvenanceSchema, normalizedLandscapeRowSchema, type LandscapeLeg, type LandscapeProvenance, type NormalizedLandscapeRow, } from './landscape.schemas.js';
const terminalStates = new Set<string>(LANDSCAPE_TERMINAL_STATES);
const LANDSCAPE_PROVIDER_VERSION = 'domain-comparison/1';
const LEG_FALLBACK_TASK_MICROS = 12000n;
const LEG_FALLBACK_ROW_MICROS = 120n;
export interface LandscapeProcessorDeps {
    db: ApplicationDb;
    provider: Pick<CompetitorProvider, 'compareDomains'>;
    logger: Logger;
    cache?: VendorCacheRepo;
    now?: () => Date;
    /** Injectable failure seam for exhausted-job settlement tests. */
    publishFn?: (runId: string) => Promise<void>;
    /** Deterministic concurrency seam before the terminal exhausted-run CAS. */
    beforeExhaustedSettlement?: () => Promise<void>;
}
interface LiveLeg {
    leg: LandscapeLeg;
    rows: NormalizedLandscapeRow[];
    provenance: LandscapeProvenance;
}
function safeFailureCode(error: unknown): string {
    if (error instanceof VendorTimeoutError)
        return 'TIMEOUT';
    if (error instanceof VendorQuotaError)
        return 'QUOTA';
    if (error instanceof VendorMalformedError)
        return 'MALFORMED';
    if (error instanceof Error && error.name === 'ZodError')
        return 'MALFORMED';
    if (error instanceof ProviderError)
        return error.retryable ? 'PROVIDER_FAILED' : 'MALFORMED';
    return 'PROVIDER_FAILED';
}
function failureProvenance(leg: LandscapeLeg, error: unknown): LandscapeProvenance {
    const code = safeFailureCode(error);
    return landscapeProvenanceSchema.parse({
        provider: 'competitor',
        operation: 'domain_intersection_live',
        leg,
        intersections: leg === 'shared',
        targetOrder: leg === 'competitor_only' ? 'competitor_owned' : 'owned_competitor',
        itemTypes: ['organic'],
        limit: 100,
        cache: 'miss',
        status: code === 'TIMEOUT'
            ? 'timeout'
            : code === 'QUOTA'
                ? 'quota'
                : code === 'MALFORMED'
                    ? 'malformed'
                    : 'failed',
        capturedAt: null,
        returnedRows: 0,
        truncated: false,
    });
}
function normalizedProviderRow(row: DomainComparisonRow): NormalizedLandscapeRow {
    return normalizedLandscapeRowSchema.parse({
        keyword: row.keyword,
        normalizedKeyword: row.normalizedKeyword,
        ownedPosition: row.ownedPosition,
        competitorPosition: row.competitorPosition,
        ownedRankAbsolute: row.ownedRankAbsolute,
        competitorRankAbsolute: row.competitorRankAbsolute,
        ownedUrl: row.ownedUrl,
        competitorUrl: row.competitorUrl,
        searchVolume: row.searchVolume,
        keywordDifficulty: row.keywordDifficulty,
        intent: row.intent,
    });
}
function resultRows(result: DomainComparisonResult, leg: LandscapeLeg): DomainComparisonRow[] {
    if (leg === 'shared')
        return result.shared;
    if (leg === 'owned_only')
        return result.ownedOnly;
    return result.competitorOnly;
}
function sourceDate(rows: readonly DomainComparisonRow[], fallback: Date): string {
    const dates = rows
        .map((row) => row.observationMeta.observedAt)
        .filter((value) => !Number.isNaN(Date.parse(value)))
        .sort();
    return dates.at(-1) ?? fallback.toISOString();
}
function providerLabel(rows: readonly DomainComparisonRow[]): string {
    return rows.find((row) => row.observationMeta.sourceLabel)?.observationMeta
        .sourceLabel ?? 'dataforseo';
}
function buildProvenance(leg: LandscapeLeg, rows: readonly DomainComparisonRow[], capturedAt: Date, cache: 'hit' | 'miss'): LandscapeProvenance {
    return landscapeProvenanceSchema.parse({
        provider: providerLabel(rows),
        operation: 'domain_intersection_live',
        leg,
        intersections: leg === 'shared',
        targetOrder: leg === 'competitor_only' ? 'competitor_owned' : 'owned_competitor',
        itemTypes: ['organic'],
        limit: 100,
        cache,
        status: 'success',
        capturedAt: sourceDate(rows, capturedAt),
        returnedRows: Math.min(rows.length, 100),
        truncated: rows.length >= 100,
    });
}
function cacheAddress(input: {
    accountId: string;
    siteId: string;
    ownedDomain: string;
    competitorDomain: string;
    locationCode: number;
    languageCode: string;
    leg: LandscapeLeg;
}) {
    return {
        capability: 'competitor' as const,
        operation: LANDSCAPE_CACHE_OPERATION,
        cacheKey: landscapeCacheKey({
            ...input,
            providerVersion: LANDSCAPE_PROVIDER_VERSION,
            schemaVersion: LANDSCAPE_SCHEMA_VERSION,
        }),
    };
}
function cacheParams(input: {
    accountId: string;
    siteId: string;
    ownedDomain: string;
    competitorDomain: string;
    locationCode: number;
    languageCode: string;
    leg: LandscapeLeg;
}) {
    return {
        accountId: input.accountId,
        siteId: input.siteId,
        ownedDomain: input.ownedDomain,
        competitorDomain: input.competitorDomain,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        leg: input.leg,
        itemTypes: ['organic'],
        limit: 100,
        providerVersion: LANDSCAPE_PROVIDER_VERSION,
        schemaVersion: LANDSCAPE_SCHEMA_VERSION,
    };
}
async function stillRunnable(runId: string): Promise<boolean> {
    const run = await CompetitorLandscapeRun.findOne({ _id: runId, state: { $in: ['queued', 'collecting', 'aggregating'] } }, { accountId: 1, siteId: 1, cancelRequestedAt: 1 }).lean();
    if (!run || run.cancelRequestedAt)
        return false;
    const site = await Site.exists({
        _id: run.siteId,
        accountId: run.accountId,
        deletionStartedAt: null,
        paused: { $ne: true },
    });
    return site !== null;
}
async function cancelUnavailableRun(runId: string, deps: LandscapeProcessorDeps): Promise<void> {
    const now = (deps.now ?? (() => new Date()))();
    await CompetitorLandscapeRun.updateOne({
        _id: runId,
        state: { $in: ['queued', 'collecting', 'aggregating'] },
    }, {
        $set: {
            state: 'cancelled',
            'progress.stage': 'cancelled',
            cancelRequestedAt: now,
            completedAt: now,
            safeFailureCode: 'SITE_UNAVAILABLE',
        },
    });
    await CompetitorLandscapeReportPage.deleteMany({ runId });
}
async function refreshRunProgress(runId: string, stage: 'collecting' | 'aggregating') {
    const checkpoints = await CompetitorLandscapeLegCheckpoint.find({ runId })
        .sort({ competitorProfileId: 1, leg: 1 })
        .lean();
    await CompetitorLandscapeRun.updateOne({ _id: runId, state: { $in: ['queued', 'collecting', 'aggregating'] } }, {
        $set: {
            state: stage,
            'progress.stage': stage,
            'progress.completedLegs': checkpoints.filter((checkpoint) => ['succeeded', 'failed'].includes(checkpoint.state)).length,
            stageSummary: checkpoints.map((checkpoint) => ({
                competitorProfileId: checkpoint.competitorProfileId,
                leg: checkpoint.leg,
                state: checkpoint.state,
                returnedRows: checkpoint.rows.length,
            })),
        },
    });
}
async function persistSucceededLeg(checkpointId: unknown, leg: LiveLeg, cache: 'hit' | 'miss'): Promise<void> {
    await CompetitorLandscapeLegCheckpoint.updateOne({ _id: checkpointId, state: { $in: ['pending', 'dispatched'] } }, {
        $set: {
            state: 'succeeded',
            cache,
            safeErrorCode: null,
            provenance: leg.provenance,
            rows: leg.rows,
        },
    });
}
async function persistFailedLeg(checkpointId: unknown, leg: LandscapeLeg, error: unknown, safeErrorCode = safeFailureCode(error)): Promise<void> {
    await CompetitorLandscapeLegCheckpoint.updateOne({ _id: checkpointId, state: { $in: ['pending', 'dispatched'] } }, {
        $set: {
            state: 'failed',
            safeErrorCode,
            provenance: failureProvenance(leg, error),
            rows: [],
        },
    });
}
async function readCachedLeg(cache: VendorCacheRepo, input: Parameters<typeof cacheAddress>[0], now: Date): Promise<LiveLeg | null> {
    const hit = await cache.read(cacheAddress(input), now);
    if (!hit || !hit.payload || typeof hit.payload !== 'object')
        return null;
    try {
        const payload = hit.payload as {
            rows?: unknown;
            provenance?: unknown;
        };
        const rows = Array.isArray(payload.rows)
            ? payload.rows.map((row) => normalizedLandscapeRowSchema.parse(row))
            : null;
        if (rows === null || rows.length > 100)
            return null;
        const provenance = landscapeProvenanceSchema.parse({
            ...(payload.provenance as Record<string, unknown>),
            cache: 'hit',
        });
        return { leg: input.leg, rows, provenance };
    }
    catch {
        return null;
    }
}
async function archiveLiveLeg(cache: VendorCacheRepo, input: Parameters<typeof cacheAddress>[0], live: LiveLeg, capturedAt: Date, costMicros: bigint): Promise<void> {
    const address = cacheAddress(input);
    const params = cacheParams(input);
    const payload = { rows: live.rows, provenance: live.provenance };
    await cache.upsert({
        ...address,
        accountId: input.accountId,
        siteId: input.siteId,
        params,
        payload,
        fetchedAt: capturedAt,
        expiresAt: nextUtcMidnight(capturedAt),
    });
    await cache.appendResponse({
        ...address,
        accountId: input.accountId,
        siteId: input.siteId,
        params,
        payload: {
            leg: input.leg,
            status: 'success',
            returnedRows: live.rows.length,
            capturedAt: live.provenance.capturedAt,
        },
        costMicros,
        fetchedAt: capturedAt,
    });
}
async function archiveFailedLeg(cache: VendorCacheRepo, input: Parameters<typeof cacheAddress>[0], error: unknown, fetchedAt: Date, costMicros: bigint): Promise<void> {
    const address = cacheAddress(input);
    await cache.appendResponse({
        ...address,
        accountId: input.accountId,
        siteId: input.siteId,
        params: cacheParams(input),
        payload: {
            leg: input.leg,
            status: failureProvenance(input.leg, error).status,
            returnedRows: 0,
            capturedAt: null,
        },
        costMicros,
        fetchedAt,
    });
}
async function collectCompetitor(run: CompetitorLandscapeRunHydrated, competitor: {
    profileId: string;
    domain: string;
}, deps: LandscapeProcessorDeps, cache: VendorCacheRepo): Promise<void> {
    const now = (deps.now ?? (() => new Date()))();
    const accountId = String(run.accountId);
    const siteId = String(run.siteId);
    const checkpoints = await CompetitorLandscapeLegCheckpoint.find({
        runId: run._id,
        accountId,
        competitorProfileId: competitor.profileId,
    });
    const byLeg = new Map(checkpoints.map((checkpoint) => [checkpoint.leg, checkpoint]));
    const pending: Array<(typeof checkpoints)[number]> = [];
    for (const leg of LANDSCAPE_LEGS) {
        if (!(await stillRunnable(String(run._id))))
            return;
        const checkpoint = byLeg.get(leg);
        if (!checkpoint || checkpoint.state === 'succeeded' || checkpoint.state === 'failed')
            continue;
        if (checkpoint.state === 'dispatched') {
            await persistFailedLeg(checkpoint._id, checkpoint.leg, new Error('unknown post-dispatch outcome'));
            continue;
        }
        const keyInput = {
            accountId,
            siteId,
            ownedDomain: run.ownedDomain,
            competitorDomain: competitor.domain,
            locationCode: run.market.locationCode,
            languageCode: run.market.languageCode,
            leg,
        };
        const cached = await readCachedLeg(cache, keyInput, now);
        if (cached) {
            await persistSucceededLeg(checkpoint._id, cached, 'hit');
        }
        else {
            pending.push(checkpoint);
        }
    }
    if (pending.length === 0)
        return;
    const claimed: Array<(typeof checkpoints)[number]> = [];
    for (const checkpoint of pending) {
        if (!(await stillRunnable(String(run._id))))
            return;
        const markedAt = (deps.now ?? (() => new Date()))();
        const claim = await CompetitorLandscapeLegCheckpoint.findOneAndUpdate({ _id: checkpoint._id, state: 'pending', attempt: 0 }, {
            $set: {
                state: 'dispatched',
                attempt: 1,
                dispatchMarkedAt: markedAt,
                cache: 'miss',
            },
        }, { new: true });
        if (claim)
            claimed.push(claim);
    }
    if (claimed.length === 0)
        return;
    await CompetitorLandscapeRun.updateOne({ _id: run._id, firstProviderDispatchAt: null }, {
        $set: {
            firstProviderDispatchAt: (deps.now ?? (() => new Date()))(),
            startedAt: run.startedAt ?? (deps.now ?? (() => new Date()))(),
        },
    });
    await refreshRunProgress(String(run._id), 'collecting');
    const compareDomains = deps.provider.compareDomains;
    if (!compareDomains) {
        for (const checkpoint of claimed) {
            await persistFailedLeg(checkpoint._id, checkpoint.leg, new VendorMalformedError('domain comparison capability unavailable', {
                provider: 'competitor',
                operation: 'domain-comparison',
            }));
        }
        return;
    }
    const capturedAt = (deps.now ?? (() => new Date()))();
    const captured = await captureVendorCost(async () => {
        try {
            return {
                ok: true as const,
                result: await compareDomains({
                    ownedDomain: run.ownedDomain,
                    ownedOrigin: `https://${run.ownedDomain}`,
                    competitorDomain: competitor.domain,
                    competitorOrigin: `https://${competitor.domain}`,
                    locationCode: run.market.locationCode,
                    languageCode: run.market.languageCode,
                }),
            };
        }
        catch (error) {
            return { ok: false as const, error };
        }
    });
    if (!captured.value.ok) {
        const failureCost = captured.costMicros ?? LEG_FALLBACK_TASK_MICROS * BigInt(claimed.length);
        const failureDivisor = BigInt(claimed.length);
        for (const [index, checkpoint] of claimed.entries()) {
            await persistFailedLeg(checkpoint._id, checkpoint.leg, captured.value.error);
            try {
                await archiveFailedLeg(cache, {
                    accountId,
                    siteId,
                    ownedDomain: run.ownedDomain,
                    competitorDomain: competitor.domain,
                    locationCode: run.market.locationCode,
                    languageCode: run.market.languageCode,
                    leg: checkpoint.leg,
                }, captured.value.error, capturedAt, failureCost / failureDivisor +
                    (BigInt(index) < failureCost % failureDivisor ? 1n : 0n));
            }
            catch {
                deps.logger.warn({
                    runId: String(run._id),
                    competitorProfileId: competitor.profileId,
                    leg: checkpoint.leg,
                    code: 'COST_ARCHIVE_FAILED',
                }, 'competitor landscape cost archive failed');
            }
        }
        deps.logger.warn({
            event: 'competitor_landscape_provider_cost',
            runId: String(run._id),
            competitorProfileId: competitor.profileId,
            provider: 'dataforseo',
            outcome: 'failed',
            requestedLegs: claimed.length,
            returnedRows: 0,
            costMicros: failureCost.toString(),
            code: safeFailureCode(captured.value.error),
        }, 'competitor landscape comparison failed');
        return;
    }
    const result = captured.value.result;
    const totalCost = captured.costMicros ??
        claimed.reduce((sum, checkpoint) => sum +
            LEG_FALLBACK_TASK_MICROS +
            LEG_FALLBACK_ROW_MICROS *
                BigInt(Math.min(resultRows(result, checkpoint.leg).length, 100)), 0n);
    const divisor = BigInt(claimed.length);
    for (const [index, checkpoint] of claimed.entries()) {
        if (!(await stillRunnable(String(run._id))))
            return;
        try {
            const rawRows = resultRows(result, checkpoint.leg).slice(0, 100);
            const rows = rawRows.map(normalizedProviderRow);
            const provenance = buildProvenance(checkpoint.leg, rawRows, capturedAt, 'miss');
            const live = { leg: checkpoint.leg, rows, provenance };
            const cost = totalCost / divisor + (BigInt(index) < totalCost % divisor ? 1n : 0n);
            await archiveLiveLeg(cache, {
                accountId,
                siteId,
                ownedDomain: run.ownedDomain,
                competitorDomain: competitor.domain,
                locationCode: run.market.locationCode,
                languageCode: run.market.languageCode,
                leg: checkpoint.leg,
            }, live, capturedAt, cost);
            await persistSucceededLeg(checkpoint._id, live, 'miss');
        }
        catch (error) {
            await persistFailedLeg(checkpoint._id, checkpoint.leg, error);
        }
    }
    deps.logger.info({
        event: 'competitor_landscape_provider_cost',
        runId: String(run._id),
        competitorProfileId: competitor.profileId,
        provider: 'dataforseo',
        outcome: 'completed',
        requestedLegs: claimed.length,
        returnedRows: claimed.reduce((sum, checkpoint) => sum + Math.min(resultRows(result, checkpoint.leg).length, 100), 0),
        costMicros: totalCost.toString(),
    }, 'competitor landscape provider cost recorded');
}
export async function publishLandscape(runId: string, deps: LandscapeProcessorDeps): Promise<void> {
    const run = await CompetitorLandscapeRun.findById(runId);
    if (!run || terminalStates.has(run.state))
        return;
    if (!(await stillRunnable(runId))) {
        await cancelUnavailableRun(runId, deps);
        return;
    }
    await refreshRunProgress(runId, 'aggregating');
    const checkpoints = await CompetitorLandscapeLegCheckpoint.find({ runId })
        .sort({ competitorProfileId: 1, leg: 1 })
        .lean();
    const completedAt = (deps.now ?? (() => new Date()))();
    const aggregation = aggregateLandscape({
        ownedDomain: run.ownedDomain,
        locale: run.locale,
        market: {
            locationCode: run.market.locationCode,
            languageCode: run.market.languageCode,
            source: run.market.source,
            eligibleTrackedKeywords: run.market.eligibleTrackedKeywords,
        },
        competitors: run.competitors.map((competitor) => ({
            profileId: competitor.profileId,
            domain: competitor.domain,
        })),
        checkpoints: checkpoints.map((checkpoint) => ({
            competitorProfileId: checkpoint.competitorProfileId,
            leg: checkpoint.leg,
            state: checkpoint.state,
            safeErrorCode: checkpoint.safeErrorCode ?? null,
            provenance: checkpoint.provenance as LandscapeProvenance | null,
            rows: checkpoint.rows as NormalizedLandscapeRow[],
        })),
        completedAt,
    });
    const pageRows = Array.from({ length: Math.ceil(aggregation.rows.length / 100) }, (_, pageIndex) => aggregation.rows.slice(pageIndex * 100, pageIndex * 100 + 100));
    for (const [pageIndex, rows] of pageRows.entries()) {
        const pageHash = sha256CanonicalLandscape(rows);
        const existing = await CompetitorLandscapeReportPage.findOne({
            accountId: run.accountId,
            runId: run._id,
            pageIndex,
        }).lean();
        if (existing) {
            if (existing.pageHash !== pageHash)
                throw new Error('landscape report page hash conflict');
            continue;
        }
        await CompetitorLandscapeReportPage.create({
            accountId: run.accountId,
            siteId: run.siteId,
            runId: run._id,
            pageIndex,
            rows,
            rowCount: rows.length,
            pageHash,
            expiresAt: null,
        });
    }
    const storedPages = await CompetitorLandscapeReportPage.find({
        accountId: run.accountId,
        runId: run._id,
    })
        .sort({ pageIndex: 1 })
        .lean();
    if (storedPages.length !== pageRows.length ||
        storedPages.some((page, index) => page.pageIndex !== index)) {
        throw new Error('landscape report pages are not contiguous');
    }
    const contentHash = landscapeContentHash(aggregation.manifest, storedPages.map((page) => ({
        pageIndex: page.pageIndex,
        rows: page.rows,
        rowCount: page.rowCount,
        pageHash: page.pageHash,
    })));
    const state = aggregation.usableCompetitors === 0
        ? 'failed'
        : aggregation.hasFailures
            ? 'partial'
            : 'completed';
    const published = await CompetitorLandscapeRun.updateOne({ _id: run._id, state: 'aggregating', cancelRequestedAt: null }, {
        $set: {
            state,
            'progress.stage': state,
            'progress.completedLegs': checkpoints.length,
            reportManifest: state === 'failed' ? null : aggregation.manifest,
            contentHash: state === 'failed' ? null : contentHash,
            safeFailureCode: state === 'failed' ? 'ZERO_USABLE_PROVIDER_FAILURE' : null,
            completedAt,
        },
    });
    if (published.modifiedCount === 0) {
        const winner = await CompetitorLandscapeRun.findById(run._id).lean();
        if (!winner || !terminalStates.has(winner.state)) {
            throw new Error('landscape terminal publish lost compare-and-set');
        }
        if (winner.state === 'cancelled') {
            await CompetitorLandscapeReportPage.deleteMany({ runId: run._id });
        }
        return;
    }
    if (state === 'failed') {
        await CompetitorLandscapeReportPage.deleteMany({ runId: run._id });
    }
    deps.logger.info({
        event: 'competitor_landscape_settled',
        runId,
        state,
        requestedCompetitors: aggregation.manifest.coverage.requestedCompetitors,
        usableCompetitors: aggregation.manifest.coverage.usableCompetitors,
        requestedLegs: aggregation.manifest.coverage.requestedLegs,
        succeededLegs: aggregation.manifest.coverage.succeededLegs,
        failedLegs: aggregation.manifest.coverage.failedLegs,
        truncatedLegs: aggregation.manifest.coverage.truncatedLegs,
        rows: aggregation.rows.length,
        partialCompetitors: aggregation.manifest.warnings
            .filter((warning) => warning.code === 'PARTIAL_COMPETITOR').length,
    }, 'competitor landscape settled');
}
export function createCompetitorLandscapeProcessor(deps: LandscapeProcessorDeps) {
    const cache = deps.cache ?? createVendorCacheRepo(deps.db as never);
    return async (job: Job): Promise<{
        state: string;
        replayed: boolean;
    }> => {
        const payload = parseConsumedPayload(competitorLandscapeJobSchema, job.data);
        const run = await CompetitorLandscapeRun.findById(payload.runId);
        if (!run)
            return { state: 'missing', replayed: true };
        if (terminalStates.has(run.state))
            return { state: run.state, replayed: true };
        if (!(await stillRunnable(payload.runId))) {
            await cancelUnavailableRun(payload.runId, deps);
            return { state: 'cancelled', replayed: false };
        }
        for (const competitor of [...run.competitors].sort((left, right) => left.profileId.localeCompare(right.profileId))) {
            if (!(await stillRunnable(payload.runId))) {
                await cancelUnavailableRun(payload.runId, deps);
                return { state: 'cancelled', replayed: false };
            }
            await collectCompetitor(run, competitor, deps, cache);
            await refreshRunProgress(payload.runId, 'collecting');
        }
        await publishLandscape(payload.runId, deps);
        const settled = await CompetitorLandscapeRun.findById(payload.runId, { state: 1 }).lean();
        return { state: settled?.state ?? 'missing', replayed: false };
    };
}
/** Re-enqueues only durable active runs that have no Redis job. */
export async function reconcileCompetitorLandscapeRuns(queue: Queue, limit = 100): Promise<{
    examined: number;
    enqueued: number;
}> {
    const runs = await CompetitorLandscapeRun.find({
        state: { $in: ['queued', 'collecting', 'aggregating'] },
    })
        .sort({ createdAt: 1, _id: 1 })
        .limit(Math.min(Math.max(limit, 1), 500))
        .lean();
    let enqueued = 0;
    for (const run of runs) {
        const existing = await queue.getJob(run.queueJobId);
        if (existing)
            continue;
        await enqueueCompetitorLandscapeJob(queue, { runId: String(run._id) });
        enqueued += 1;
    }
    return { examined: runs.length, enqueued };
}
export async function onCompetitorLandscapeJobExhausted(job: Job, deps?: LandscapeProcessorDeps): Promise<void> {
    const parsed = competitorLandscapeJobSchema.safeParse(job.data);
    if (!parsed.success || !Types.ObjectId.isValid(parsed.data.runId))
        return;
    const checkpoints = await CompetitorLandscapeLegCheckpoint.find({
        runId: parsed.data.runId,
        state: { $in: ['pending', 'dispatched'] },
    });
    for (const checkpoint of checkpoints) {
        const dispatched = checkpoint.state === 'dispatched';
        await persistFailedLeg(checkpoint._id, checkpoint.leg, new Error(dispatched
            ? 'unknown post-dispatch outcome'
            : 'worker exhausted before dispatch'), dispatched ? 'UNKNOWN_AFTER_DISPATCH' : 'WORKER_EXHAUSTED');
    }
    if (!deps)
        return;
    if (!(await stillRunnable(parsed.data.runId))) {
        await cancelUnavailableRun(parsed.data.runId, deps);
        return;
    }
    try {
        await (deps.publishFn ?? ((runId) => publishLandscape(runId, deps)))(parsed.data.runId);
    }
    catch {
        await deps.beforeExhaustedSettlement?.();
        const completedAt = (deps.now ?? (() => new Date()))();
        await CompetitorLandscapeRun.updateOne({
            _id: parsed.data.runId,
            state: { $in: ['queued', 'collecting', 'aggregating'] },
        }, {
            $set: {
                state: 'failed',
                'progress.stage': 'failed',
                safeFailureCode: 'WORKER_EXHAUSTED',
                reportManifest: null,
                contentHash: null,
                completedAt,
            },
        });
        await CompetitorLandscapeReportPage.deleteMany({ runId: parsed.data.runId });
        deps.logger.error({ runId: parsed.data.runId, state: 'failed', code: 'WORKER_EXHAUSTED' }, 'competitor landscape exhausted without a publishable report');
    }
}
