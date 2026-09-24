/**
 * Brand Radar — scan pipeline.
 *
 * Pure orchestration: probe → run stage → probe → run stage. It owns no
 * Mongo scan-document write and no Postgres write; it RETURNS the
 * terminal decision plus the cost/event rows the processor persists. That
 * split is what makes every truth-table row testable without a queue.
 *
 * Rolling ceiling: the run budget is 150 000 micros USD and each stage is
 * probed BEFORE dispatch with `spent + stageWorstCase > 150_000 → halt`. A
 * halt keeps whatever evidence is already retained and settles the scan
 * `completed_partial`; it never discards a retained row.
 *
 * Stage 3 (`brand_digest`, 20 000 micros) is the AI pass. It is
 * probed against the same rolling ceiling and dispatched ONLY after stages 1
 * and 2 both succeed with at least one retained row — a digest with nothing to
 * cite is not worth a generation.
 */
import type { BrandRadarEventKind, BrandRadarEventStage, } from '../../db/schema/brand-radar-events.js';
import { captureVendorCost } from '../../shared/providers/cost-capture.js';
import { ProviderError } from '../../shared/providers/errors.js';
import type { ContentAnalysisMentionSummary, ContentAnalysisProvider, } from '../../shared/providers/types.js';
import { computeBrandRadarAggregates, type BrandRadarAggregates, } from './brand-radar.aggregates.js';
import type { BrandRadarDigestResult, BrandRadarDigestSentence, RunBrandRadarDigestInput, } from './brand-radar.digest.js';
import { BRAND_RADAR_MAX_RETAINED_ROWS, type BrandRadarDigestState, type BrandRadarHaltReason, type BrandRadarHaltStage, } from './brand-radar.model.js';
import { persistMentionRows, persistMentionSummary, readMentionRows, } from './brand-radar.rows.model.js';
import type { SupportedLocale } from '../../shared/i18n/locales.js';
/** Frozen — do not recompute. */
export const BRAND_RADAR_RUN_BUDGET_MICROS = 150000;
/** Frozen — per-stage worst case in micros USD. */
export const BRAND_RADAR_STAGE_WORST_CASE_MICROS = {
    search: 60000,
    summary: 60000,
    brand_digest: 20000,
} as const;
export type BrandRadarVendorStage = keyof typeof BRAND_RADAR_STAGE_WORST_CASE_MICROS;
/** Halt reason recorded on a ceiling stop. Non-identifying by construction. */
export const BRAND_RADAR_CEILING_REASON = 'cost_ceiling';
export type BrandRadarPipelineStatus = 'completed' | 'completed_empty' | 'completed_partial' | 'failed';
/**
 * Pre-dispatch rolling-ceiling probe. `true` = the stage may run.
 * `spent + worstCase > budget` halts — equality is affordable.
 */
export function canAffordStage(spentMicros: number, stage: BrandRadarVendorStage): boolean {
    return (spentMicros + BRAND_RADAR_STAGE_WORST_CASE_MICROS[stage] <=
        BRAND_RADAR_RUN_BUDGET_MICROS);
}
export interface BrandRadarCostEvent {
    stage: BrandRadarEventStage;
    event: BrandRadarEventKind;
    costMicros: number;
    metadata: Record<string, unknown>;
}
export interface BrandRadarPipelineTerminal {
    status: BrandRadarPipelineStatus;
    totalCostMicros: number;
    /** Reason code (never user text). Null on a clean completion. */
    reason: string | null;
    /**
     * Stage the pipeline stopped at (the halt contract).
     * Null on every clean terminal (`completed` / `completed_empty`), set on
     * every halted/failed one so the client can say WHICH stage and WHY.
     */
    haltedStage: BrandRadarVendorStage | null;
}
/**
 * Bounded halt disclosure persisted on the scan document. Raw provider error
 * names keep flowing into the events table; the document only ever stores this
 * fixed taxonomy.
 */
export function normalizeBrandRadarHalt(terminal: BrandRadarPipelineTerminal): {
    stage: BrandRadarHaltStage;
    reason: BrandRadarHaltReason;
} | null {
    if (terminal.reason === null || terminal.haltedStage === null)
        return null;
    const reason: BrandRadarHaltReason = terminal.reason === BRAND_RADAR_CEILING_REASON
        ? 'cost_ceiling'
        : terminal.reason === 'digest_absent' ||
            terminal.reason === 'no_reliable_digest'
            ? 'digest_failed'
            : 'provider_error';
    return { stage: terminal.haltedStage, reason };
}
export interface BrandRadarPipelineResult {
    status: BrandRadarPipelineStatus;
    retainedRowIds: string[];
    mentionSummaryId: string | null;
    costEvents: BrandRadarCostEvent[];
    terminal: BrandRadarPipelineTerminal;
    /** Deterministic, computed over the STORED rows — never AI-supplied. */
    aggregates: BrandRadarAggregates;
    digestState: BrandRadarDigestState;
    digestSentences: BrandRadarDigestSentence[];
}
export interface BrandRadarPipelineInput {
    accountId: string;
    /** Owning site — threaded to the digest so AI cost attribution is real. */
    siteId: string;
    scanId: string;
    outputLocale: SupportedLocale;
    brandQuery: string;
    language?: string | null;
    /** ISO publisher-domain registration country; null means worldwide. */
    countryCode?: string | null;
    /** Rows-per-call ceiling; clamped to the 1000-row spec bound. */
    rowLimit?: number;
}
export interface BrandRadarPipelineDeps {
    provider: ContentAnalysisProvider;
    persistRows?: typeof persistMentionRows;
    persistSummary?: typeof persistMentionSummary;
    readRows?: typeof readMentionRows;
    /**
     * Stage-3 seam. Absent means the run has no AI stage configured at all — the
     * scan still settles honestly, it simply carries no digest. Present means
     * the stage is attempted, and its outcome participates in the terminal
     * status per the truth table.
     */
    digest?: (input: RunBrandRadarDigestInput) => Promise<BrandRadarDigestResult>;
}
const EMPTY_AGGREGATES: BrandRadarAggregates = {
    mentionCount: 0,
    sentimentDistribution: { positive: 0, neutral: 0, negative: 0, unknown: 0 },
    topDomains: [],
};
function errorCodeOf(error: unknown): string {
    return error instanceof ProviderError ? error.name : 'UnknownError';
}
/** Vendor-reported bigint micros → the non-negative integer the ledger stores. */
function microsOf(costMicros: bigint | null): number {
    return costMicros === null ? 0 : Math.max(0, Number(costMicros));
}
export async function runBrandRadarPipeline(input: BrandRadarPipelineInput, deps: BrandRadarPipelineDeps): Promise<BrandRadarPipelineResult> {
    const persistRows = deps.persistRows ?? persistMentionRows;
    const persistSummary = deps.persistSummary ?? persistMentionSummary;
    const readRows = deps.readRows ?? readMentionRows;
    const costEvents: BrandRadarCostEvent[] = [];
    const limit = Math.min(Math.max(1, Math.floor(input.rowLimit ?? BRAND_RADAR_MAX_RETAINED_ROWS)), BRAND_RADAR_MAX_RETAINED_ROWS);
    const query = {
        query: input.brandQuery,
        ...(input.language ? { language: input.language } : {}),
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        limit,
    };
    let spent = 0;
    const settle = (status: BrandRadarPipelineStatus, retainedRowIds: string[], mentionSummaryId: string | null, reason: string | null, haltedStage: BrandRadarVendorStage | null, aggregates: BrandRadarAggregates = EMPTY_AGGREGATES, digestState: BrandRadarDigestState = 'digest_absent', digestSentences: BrandRadarDigestSentence[] = []): BrandRadarPipelineResult => ({
        status,
        retainedRowIds,
        mentionSummaryId,
        costEvents,
        terminal: {
            status,
            totalCostMicros: spent,
            reason,
            haltedStage,
        },
        aggregates,
        digestState,
        digestSentences,
    });
    // ---- Stage 1: search -----------------------------------------------------
    // The first probe can never fail at a zero starting spend (60_000 ≤ 150_000),
    // but it is written as a probe so the arithmetic has exactly one shape.
    costEvents.push({
        stage: 'search',
        event: 'started',
        costMicros: 0,
        metadata: { rowLimit: limit },
    });
    let rows;
    try {
        const captured = await captureVendorCost(() => deps.provider.searchMentions(query));
        spent += microsOf(captured.costMicros);
        rows = captured.value.slice(0, limit);
        costEvents.push({
            stage: 'search',
            event: 'succeeded',
            costMicros: microsOf(captured.costMicros),
            metadata: { retainedRows: rows.length },
        });
    }
    catch (error) {
        const reason = errorCodeOf(error);
        costEvents.push({
            stage: 'search',
            event: 'failed',
            costMicros: 0,
            metadata: { reason },
        });
        // The search stage terminated with a vendor error and zero rows were
        // retained, so the scan produced nothing.
        return settle('failed', [], null, reason, 'search');
    }
    if (rows.length === 0) {
        // Search worked; the brand simply has no mentions. That is real signal,
        // not a failure.
        return settle('completed_empty', [], null, null, null);
    }
    const retainedRowIds = await persistRows({
        accountId: input.accountId,
        scanId: input.scanId,
        rows,
    });
    // Read back what was actually STORED. Every aggregate and the whole digest
    // input are derived from this — never from the vendor envelope above, so a
    // number we report is always a number we can point at a stored row for.
    const storedRows = await readRows({
        accountId: input.accountId,
        scanId: input.scanId,
    });
    const aggregates = computeBrandRadarAggregates(storedRows);
    // ---- Stage 2: summary ----------------------------------------------------
    if (!canAffordStage(spent, 'summary')) {
        costEvents.push({
            stage: 'summary',
            event: 'halted',
            costMicros: 0,
            metadata: { reason: BRAND_RADAR_CEILING_REASON, spentMicros: spent },
        });
        return settle('completed_partial', retainedRowIds, null, BRAND_RADAR_CEILING_REASON, 'summary', aggregates);
    }
    costEvents.push({
        stage: 'summary',
        event: 'started',
        costMicros: 0,
        metadata: {},
    });
    let mentionSummaryId: string;
    let summary: ContentAnalysisMentionSummary;
    try {
        const captured = await captureVendorCost(() => deps.provider.getMentionSummary(query));
        spent += microsOf(captured.costMicros);
        summary = captured.value;
        mentionSummaryId = await persistSummary({
            accountId: input.accountId,
            scanId: input.scanId,
            summary,
        });
        costEvents.push({
            stage: 'summary',
            event: 'succeeded',
            costMicros: microsOf(captured.costMicros),
            metadata: { totalMentions: summary.totalMentions },
        });
    }
    catch (error) {
        const reason = errorCodeOf(error);
        costEvents.push({
            stage: 'summary',
            event: 'failed',
            costMicros: 0,
            metadata: { reason },
        });
        // Rows were retained before the summary ran — the scan still carries
        // real evidence.
        return settle('completed_partial', retainedRowIds, null, reason, 'summary', aggregates);
    }
    // ---- Stage 3: brand_digest ----------------------------------------------
    // No AI seam configured: the run has no stage 3 at all, so search + summary
    // both succeeding is a clean completion that simply carries no digest.
    if (!deps.digest) {
        return settle('completed', retainedRowIds, mentionSummaryId, null, null, aggregates);
    }
    if (!canAffordStage(spent, 'brand_digest')) {
        costEvents.push({
            stage: 'brand_digest',
            event: 'halted',
            costMicros: 0,
            metadata: { reason: BRAND_RADAR_CEILING_REASON, spentMicros: spent },
        });
        return settle('completed_partial', retainedRowIds, mentionSummaryId, BRAND_RADAR_CEILING_REASON, 'brand_digest', aggregates);
    }
    costEvents.push({
        stage: 'brand_digest',
        event: 'started',
        costMicros: 0,
        metadata: { mentionRows: storedRows.length },
    });
    const digest = await deps.digest({
        accountId: input.accountId,
        siteId: input.siteId,
        scanId: input.scanId,
        outputLocale: input.outputLocale,
        rows: storedRows,
        summary,
    });
    spent += Math.max(0, Math.round(digest.costMicros ?? 0));
    costEvents.push({
        stage: 'brand_digest',
        event: digest.digestState === 'digest_present' ? 'succeeded' : 'failed',
        costMicros: Math.max(0, Math.round(digest.costMicros ?? 0)),
        // Sentence COUNT only — sentence text never reaches an event row.
        metadata: {
            digestState: digest.digestState,
            sentences: digest.digestSentences.length,
        },
    });
    // Truth table: a digest that could not be produced or did not
    // survive citation enforcement settles `completed_partial` — the retained
    // mentions are still there.
    return settle(digest.digestState === 'digest_present' ? 'completed' : 'completed_partial', retainedRowIds, mentionSummaryId, digest.digestState === 'digest_present' ? null : digest.digestState, digest.digestState === 'digest_present' ? null : 'brand_digest', aggregates, digest.digestState, digest.digestSentences);
}
