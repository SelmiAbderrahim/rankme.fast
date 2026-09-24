import { UnrecoverableError, type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { parseTrafficSnapshotPayload, trafficSnapshots, type TrafficSnapshotPayload, } from '../../db/schema/index.js';
import { buildObservationMeta, marketFromDataForSeo, } from '../../shared/observations/observations.js';
import { ProviderError, VendorUnavailableError, type CompetitorProvider, type DomainRankOverviewRow, type HistoricalRankOverviewResult, type TrafficEstimationRow, } from '../../shared/providers/index.js';
import { parseConsumedPayload, trafficSnapshotJobSchema, type TrafficSnapshotJob, } from '../../shared/queue/index.js';
import { createReadThrough, createSingleFlight, createVendorCacheRepo, } from '../../shared/vendor-cache/index.js';
import { TrafficSnapshotRun } from './traffic-snapshots.model.js';
import { trafficProviderBundleSchema, type TrafficProviderBundle, type TrafficRetainedOps, } from './traffic-snapshots.schema.js';
import { settleRun, TRAFFIC_SNAPSHOT_CACHE_TTL_MS, } from './traffic-snapshots.service.js';
import { captureTrafficSnapshotOperationCost, recordCachedTrafficSnapshotCosts, type TrafficSnapshotCostDeps, } from './traffic-snapshots.cost.js';
export interface TrafficSnapshotProcessorDeps {
    db: Db;
    provider: CompetitorProvider;
    now?: () => Date;
}
type TrafficOperation = 'traffic' | 'rankOverview' | 'history';
interface OperationOutcome<T> {
    value: T | null;
    error: unknown | null;
}
export class AllTrafficOperationsFailedError extends Error {
    readonly errors: Record<TrafficOperation, unknown>;
    constructor(errors: Record<TrafficOperation, unknown>) {
        super('all traffic snapshot provider operations failed');
        this.name = 'AllTrafficOperationsFailedError';
        this.errors = errors;
    }
}
function missingOperation(operation: TrafficOperation): VendorUnavailableError {
    return new VendorUnavailableError(`traffic snapshot operation unavailable: ${operation}`, {
        provider: 'competitor',
        operation,
    });
}
async function captureOutcome<T>(call: () => Promise<T>): Promise<OperationOutcome<T>> {
    try {
        return { value: await call(), error: null };
    }
    catch (error) {
        return { value: null, error };
    }
}
function retryability(error: unknown): boolean {
    return error instanceof ProviderError ? error.retryable : false;
}
export async function fetchTrafficProviderBundle(run: {
    targetDomain: string;
    inputs: {
        locationCode: number;
        languageCode: string;
        historyMonths: number;
    };
}, provider: CompetitorProvider, costDeps?: TrafficSnapshotCostDeps): Promise<TrafficProviderBundle> {
    const options = {
        locationCode: run.inputs.locationCode,
        languageCode: run.inputs.languageCode,
    };
    const traffic = await captureOutcome(() => {
        if (!provider.getTrafficEstimation)
            throw missingOperation('traffic');
        const call = () => provider.getTrafficEstimation!([run.targetDomain], options);
        return costDeps
            ? captureTrafficSnapshotOperationCost(costDeps, {
                targetDomain: run.targetDomain,
                subOperation: 'traffic-estimation',
                fallbackItems: 1,
                itemsFromValue: () => 1,
            }, call)
            : call();
    });
    const rankOverview = await captureOutcome(() => {
        if (!provider.getDomainRankOverview)
            throw missingOperation('rankOverview');
        const call = () => provider.getDomainRankOverview!(run.targetDomain, options);
        return costDeps
            ? captureTrafficSnapshotOperationCost(costDeps, {
                targetDomain: run.targetDomain,
                subOperation: 'rank-overview',
                fallbackItems: 1,
                itemsFromValue: () => 1,
            }, call)
            : call();
    });
    const history = await captureOutcome(() => {
        if (!provider.getHistoricalRankOverview)
            throw missingOperation('history');
        const call = () => provider.getHistoricalRankOverview!(run.targetDomain, {
            ...options,
            limit: run.inputs.historyMonths,
        });
        return costDeps
            ? captureTrafficSnapshotOperationCost(costDeps, {
                targetDomain: run.targetDomain,
                subOperation: 'rank-overview-history',
                fallbackItems: run.inputs.historyMonths,
                itemsFromValue: (value) => value.points.length,
            }, call)
            : call();
    });
    const retainedOps: TrafficRetainedOps = {
        traffic: traffic.error === null,
        rankOverview: rankOverview.error === null,
        history: history.error === null,
    };
    if (!retainedOps.traffic && !retainedOps.rankOverview && !retainedOps.history) {
        throw new AllTrafficOperationsFailedError({
            traffic: traffic.error,
            rankOverview: rankOverview.error,
            history: history.error,
        });
    }
    const trafficRow = traffic.value?.find((row) => row.domain === run.targetDomain) ??
        traffic.value?.[0];
    return trafficProviderBundleSchema.parse({
        traffic: traffic.error === null && trafficRow
            ? [{ ...trafficRow, domain: run.targetDomain }]
            : traffic.error === null
                ? []
                : null,
        rankOverview: rankOverview.value,
        history: history.value,
        retainedOps,
        retryableFailures: {
            traffic: traffic.error === null ? null : retryability(traffic.error),
            rankOverview: rankOverview.error === null ? null : retryability(rankOverview.error),
            history: history.error === null ? null : retryability(history.error),
        },
    });
}
function newestTraffic(bundle: TrafficProviderBundle): number {
    const direct = bundle.traffic?.[0]?.monthlyOrganicVisits;
    if (direct !== undefined)
        return direct;
    if (bundle.rankOverview)
        return bundle.rankOverview.estimatedMonthlyOrganicVisits;
    return bundle.history?.points.at(-1)?.organicEtv ?? 0;
}
function observationFor(capturedAt: Date, run: {
    inputs: {
        locationCode: number;
        languageCode: string;
    };
}, retainedOps: TrafficRetainedOps) {
    const partial = Object.values(retainedOps).some((retained) => !retained);
    return buildObservationMeta({
        sourceKind: 'estimate',
        observedAt: capturedAt,
        freshUntil: new Date(capturedAt.getTime() + TRAFFIC_SNAPSHOT_CACHE_TTL_MS),
        market: marketFromDataForSeo({
            locationCode: run.inputs.locationCode,
            languageCode: run.inputs.languageCode,
            device: 'all',
        }),
        coverageNoteKey: 'observations.coverage.estimateOnly',
        ...(partial ? { status: 'partial' as const } : {}),
    });
}
export function buildTrafficSnapshotPayload(bundle: TrafficProviderBundle, run: {
    inputs: {
        locationCode: number;
        languageCode: string;
    };
}, capturedAt: Date): TrafficSnapshotPayload {
    const observation = observationFor(capturedAt, run, bundle.retainedOps);
    const estimated = (value: number) => ({ value, observation });
    const estimatedNullable = (value: number | null) => ({ value, observation });
    return parseTrafficSnapshotPayload({
        monthlyOrganicVisits: estimated(newestTraffic(bundle)),
        topCountries: (bundle.traffic?.[0]?.topCountries ?? []).slice(0, 10).map((country) => ({
            countryCode: country.countryCode,
            visits: estimated(country.visits),
        })),
        domainRank: estimatedNullable(bundle.rankOverview?.rank ?? null),
        keywordCount: estimatedNullable(bundle.rankOverview?.keywordsCount ?? null),
        history: (bundle.history?.points ?? []).slice(-24).map((point) => ({
            capturedAt: new Date(Date.UTC(point.year, point.month - 1, 1)).toISOString(),
            rank: estimatedNullable(point.rank),
            traffic: estimated(point.organicEtv),
            keywordCount: estimated(point.organicKeywords),
        })),
        retained: bundle.retainedOps,
    });
}
function firstRetryableError(error: AllTrafficOperationsFailedError): ProviderError {
    // This helper is called only after `hasNonRetryableError` proved every
    // captured operation error is a retryable ProviderError.
    return error.errors.traffic as ProviderError;
}
function hasNonRetryableError(error: AllTrafficOperationsFailedError): boolean {
    return Object.values(error.errors).some((candidate) => !(candidate instanceof ProviderError) || !candidate.retryable);
}
function hasAttemptsRemaining(job: Job<TrafficSnapshotJob>): boolean {
    const attempts = job.opts?.attempts;
    return (typeof attempts === 'number' &&
        attempts > 0 &&
        job.attemptsMade + 1 < attempts);
}
function hasNonRetryableFailure(bundle: TrafficProviderBundle): boolean {
    return Object.values(bundle.retryableFailures).some((retryable) => retryable === false);
}
const trafficSingleFlight = createSingleFlight();
export function createTrafficSnapshotProcessor(deps: TrafficSnapshotProcessorDeps) {
    return async (job: Job<TrafficSnapshotJob>): Promise<void> => {
        const data = parseConsumedPayload(trafficSnapshotJobSchema, job.data);
        const run = await TrafficSnapshotRun.findOne({
            _id: data.runId,
            accountId: data.accountId,
        });
        if (!run || ['succeeded', 'partial', 'failed'].includes(run.status))
            return;
        const stored = await deps.db
            .select()
            .from(trafficSnapshots)
            .where(and(eq(trafficSnapshots.accountId, data.accountId), eq(trafficSnapshots.runId, data.runId)))
            .limit(1);
        if (stored[0]) {
            const payload = parseTrafficSnapshotPayload(stored[0].payload);
            const retainedCount = Object.values(payload.retained).filter(Boolean).length;
            await TrafficSnapshotRun.updateOne({ _id: run._id, accountId: data.accountId }, {
                $set: {
                    status: retainedCount === 3 ? 'succeeded' : 'partial',
                    retainedOps: payload.retained,
                    completedAt: stored[0].capturedAt,
                },
            });
            return;
        }
        run.status = 'running';
        await run.save();
        const now = deps.now ?? (() => new Date());
        const readThrough = createReadThrough({
            repo: createVendorCacheRepo(deps.db),
            singleFlight: trafficSingleFlight,
            clock: now,
        });
        try {
            const fetched = await readThrough({
                capability: 'competitor',
                operation: 'traffic',
                cacheKey: run.targetDomain,
                params: { targetDomain: run.targetDomain },
                ttlMs: TRAFFIC_SNAPSHOT_CACHE_TTL_MS,
                payloadSchema: trafficProviderBundleSchema,
                now: now(),
                clock: now,
                fetch: () => fetchTrafficProviderBundle(run, deps.provider, {
                    db: deps.db,
                    now,
                }),
            });
            if (fetched.cached) {
                await recordCachedTrafficSnapshotCosts({ db: deps.db, now }, run.targetDomain, fetched.value);
            }
            await settleRun({
                accountId: data.accountId,
                runId: data.runId,
                retainedOps: fetched.value.retainedOps,
                payload: buildTrafficSnapshotPayload(fetched.value, run, fetched.fetchedAt),
                capturedAt: fetched.fetchedAt,
            }, { db: deps.db });
            if (hasNonRetryableFailure(fetched.value)) {
                throw new UnrecoverableError('traffic snapshot contains a non-retryable provider failure');
            }
        }
        catch (error) {
            if (error instanceof AllTrafficOperationsFailedError) {
                if (!hasNonRetryableError(error) && hasAttemptsRemaining(job)) {
                    throw firstRetryableError(error);
                }
                const capturedAt = now();
                await settleRun({
                    accountId: data.accountId,
                    runId: data.runId,
                    retainedOps: {
                        traffic: false,
                        rankOverview: false,
                        history: false,
                    },
                    payload: null,
                    capturedAt,
                }, { db: deps.db });
                if (hasNonRetryableError(error)) {
                    throw new UnrecoverableError(error.message);
                }
                throw firstRetryableError(error);
            }
            throw error;
        }
    };
}
export type { DomainRankOverviewRow, HistoricalRankOverviewResult, TrafficEstimationRow, };
