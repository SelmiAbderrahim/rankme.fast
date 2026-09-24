/**
 * Brand Radar — BullMQ processor.
 *
 * Envelope around `runBrandRadarPipeline`:
 *   1. Payload validation — a malformed job is an `UnrecoverableError`
 *      (dead-letter, no retry burn).
 *   2. Missing / cross-account scan → drop with a warning; no throw, so
 *      BullMQ does not retry a job that can never succeed.
 *   3. Already-terminal scan → no-op (idempotent replay; never a second
 *      vendor fan-out).
 *   4. Run the pipeline, persist its cost/event rows, write the terminal
 *      Mongo state, then record the scan-level terminal event.
 *
 * Kill switch: the processor deliberately does NOT read `BRAND_RADAR_ENABLED`.
 * New scans are blocked at the router; a scan that is already queued
 * or running when the flag flips finishes to a consistent terminal state
 * instead of aborting mid-write.
 */
import { UnrecoverableError, type Job, type Processor } from 'bullmq';
import type { Logger } from 'pino';
import { Types } from 'mongoose';
import { brandRadarScanJobSchema, type BrandRadarScanJob, } from '../../shared/queue/index.js';
import { isSupportedLocale } from '../../shared/i18n/locales.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
import type { ContentAnalysisProvider } from '../../shared/providers/types.js';
import { computeTrendVsPrevious, isTrendAbsent } from './brand-radar.aggregates.js';
import { runBrandRadarDigest } from './brand-radar.digest.js';
import { BrandRadarScan } from './brand-radar.model.js';
import { recordBrandRadarEvent } from './brand-radar.events.js';
import { normalizeBrandRadarHalt, runBrandRadarPipeline, type BrandRadarPipelineDeps, type BrandRadarPipelineResult, } from './brand-radar.pipeline.js';
/** Statuses a replayed job must not re-run. */
const TERMINAL_STATUSES = [
    'completed',
    'completed_empty',
    'completed_partial',
    'failed',
] as const;
export interface BrandRadarProcessorDeps extends BrandRadarPipelineDeps {
    db: ApplicationDb;
    provider: ContentAnalysisProvider;
    logger: Logger;
    now?: () => Date;
    /**
     * Stage-3 AI seam. Supplying BOTH turns the `brand_digest` stage on;
     * omitting them runs the vendor-only pipeline, which settles honestly with
     * `digestState: 'digest_absent'` rather than pretending a digest failed.
     */
    ai?: AiProfileRunner;
    aiProviderOrder?: readonly AiGenerationProviderKey[];
}
async function persistCostEvents(deps: BrandRadarProcessorDeps, accountId: string, scanId: string, result: BrandRadarPipelineResult): Promise<void> {
    for (const event of result.costEvents) {
        await recordBrandRadarEvent(deps.db, {
            accountId,
            scanId,
            stage: event.stage,
            event: event.event,
            costMicros: event.costMicros,
            metadata: event.metadata,
        });
    }
}
/**
 * Trend against the scan's linked predecessor. `priorScanId` was frozen at
 * creation time, so a later scan of the same query cannot retroactively
 * change this one's comparison. A prior scan that no longer exists resolves to
 * absence — never a fabricated zero.
 */
async function resolveTrend(scanPriorId: unknown, accountId: string, mentionCount: number): Promise<number | null> {
    if (!scanPriorId)
        return null;
    const prior = await BrandRadarScan.findOne({
        _id: scanPriorId,
        accountId,
    }).select({ mentionCount: 1 });
    const trend = computeTrendVsPrevious(mentionCount, prior ? { mentionCount: prior.mentionCount } : null);
    return isTrendAbsent(trend) ? null : trend.delta;
}
export function createBrandRadarProcessor(deps: BrandRadarProcessorDeps): Processor<BrandRadarScanJob, void> {
    const nowFn = deps.now ?? (() => new Date());
    const ai = deps.ai;
    const aiProviderOrder = deps.aiProviderOrder;
    const digest = deps.digest ??
        (ai && aiProviderOrder
            ? (input: Parameters<NonNullable<BrandRadarPipelineDeps['digest']>>[0]) => runBrandRadarDigest(input, { ai, aiProviderOrder })
            : undefined);
    const failInvalidLocaleJob = async (data: unknown): Promise<never> => {
        const candidate = data as Partial<Record<'accountId' | 'scanId', unknown>> | null;
        if (candidate &&
            typeof candidate.accountId === 'string' &&
            typeof candidate.scanId === 'string' &&
            Types.ObjectId.isValid(candidate.accountId) &&
            Types.ObjectId.isValid(candidate.scanId)) {
            const terminalAt = nowFn();
            const claimed = await BrandRadarScan.findOneAndUpdate({
                _id: candidate.scanId,
                accountId: candidate.accountId,
                status: { $in: ['queued', 'running'] },
            }, {
                $set: {
                    status: 'failed',
                    digestState: 'digest_absent',
                    halt: { stage: 'scan', reason: 'processing_failure' },
                    terminalAt,
                },
            }, { new: true });
            if (claimed) {
                await recordBrandRadarEvent(deps.db, {
                    accountId: candidate.accountId,
                    scanId: candidate.scanId,
                    stage: 'scan',
                    event: 'failed',
                    costMicros: 0,
                    metadata: { reason: 'processing_failure' },
                });
            }
        }
        throw new UnrecoverableError('brand-radar job has no valid frozen output locale');
    };
    return async (job: Job<BrandRadarScanJob>) => {
        const parsed = brandRadarScanJobSchema.safeParse(job.data);
        if (!parsed.success)
            return failInvalidLocaleJob(job.data);
        const payload = parsed.data;
        const scan = await BrandRadarScan.findOne({
            _id: payload.scanId,
            accountId: payload.accountId,
        });
        if (!scan) {
            deps.logger.warn({ scanId: payload.scanId, accountId: payload.accountId }, 'brand-radar processor: scan not found; dropping job');
            return;
        }
        if ((TERMINAL_STATUSES as readonly string[]).includes(scan.status)) {
            deps.logger.info({ scanId: payload.scanId, status: scan.status }, 'brand-radar processor: terminal scan on replay; no-op');
            return;
        }
        if (!isSupportedLocale(scan.outputLocale) || scan.outputLocale !== payload.outputLocale) {
            return failInvalidLocaleJob(payload);
        }
        scan.status = 'running';
        await scan.save();
        await recordBrandRadarEvent(deps.db, {
            accountId: payload.accountId,
            scanId: payload.scanId,
            stage: 'scan',
            event: 'started',
            costMicros: 0,
            metadata: {},
        });
        const result = await runBrandRadarPipeline({
            accountId: payload.accountId,
            siteId: payload.siteId,
            scanId: payload.scanId,
            outputLocale: payload.outputLocale,
            brandQuery: scan.brandQuery,
            language: scan.language ?? null,
            countryCode: scan.countryCode ?? null,
        }, { ...deps, digest });
        await persistCostEvents(deps, payload.accountId, payload.scanId, result);
        const terminalAt = nowFn();
        const trendVsPrevious = await resolveTrend(scan.priorScanId, payload.accountId, result.aggregates.mentionCount);
        await BrandRadarScan.updateOne({ _id: payload.scanId, accountId: payload.accountId }, {
            $set: {
                status: result.status,
                retainedRowIds: result.retainedRowIds,
                retainedRowCount: result.retainedRowIds.length,
                mentionSummaryId: result.mentionSummaryId,
                mentionCount: result.aggregates.mentionCount,
                sentimentDistribution: result.aggregates.sentimentDistribution,
                topDomains: result.aggregates.topDomains,
                trendVsPrevious,
                digestState: result.digestState,
                digestSentences: result.digestSentences,
                halt: normalizeBrandRadarHalt(result.terminal),
                terminalAt,
            },
        });
        const failed = result.status === 'failed';
        if (failed) {
            deps.logger.warn({
                scanId: payload.scanId,
                accountId: payload.accountId,
                reason: result.terminal.reason,
            }, 'brand-radar processor: scan failed with no retained evidence');
        }
        // One scan-level terminal row carrying the run's total direct cost.
        await recordBrandRadarEvent(deps.db, {
            accountId: payload.accountId,
            scanId: payload.scanId,
            stage: 'scan',
            event: failed ? 'failed' : 'succeeded',
            costMicros: result.terminal.totalCostMicros,
            metadata: {
                status: result.status,
                retainedRows: result.retainedRowIds.length,
                ...(result.terminal.reason ? { reason: result.terminal.reason } : {}),
            },
        });
    };
}
