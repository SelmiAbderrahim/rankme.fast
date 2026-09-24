/**
 * Content Intelligence — worker processor.
 *
 * Orchestrates the full analysis pipeline over the stage handlers in
 * `content-analysis.pipeline.ts`:
 *
 *   queued → collecting_owned → collecting_serp → collecting_competitors →
 *   scoring → generating_brief → generating_draft → completed | partial
 *
 * Invariants inherited from the pipeline foundation:
 *   1. The payload is re-validated via `parseConsumedPayload` so a malformed
 *      job goes straight to the dead-letter queue as an `UnrecoverableError`
 *      (no retry attempts burned).
 *   2. Terminal analyses (cancelled / completed / failed / partial) are
 *      no-ops on replay — the worker never re-executes work that has a
 *      terminal state. Concurrent cancellation between stages is re-checked
 *      at every stage boundary and stops the run quietly.
 *   3. Every status transition goes through `advanceContentAnalysisStage` /
 *      `assertContentAnalysisTransition` — stages advance only.
 *   4. Ownership is re-verified at consume time: an analysis whose owning
 *      account was deleted between enqueue and processing is dropped.
 *
 * Pipeline decision rules:
 *   - Owned-page failure fails the run: it is marked `failed` with an
 *     owned-stage category (status + error saved, then the `failed` event
 *     recorded).
 *   - SERP failure degrades the run (warning + eventual `partial`) but never
 *     fails it. Competitor failures are never fatal.
 *   - A scoring throw fails the run (`scoring_failed`).
 *   - AI budget (sub-budget + overall ceiling) is checked BEFORE the brief
 *     and BEFORE the draft; insufficient headroom skips the remaining AI
 *     stages with a warning and finishes `partial`.
 *   - `completed` only when scorecard + brief + draft are all present and no
 *     degradation occurred; every other scored terminal is `partial`. Both
 *     terminal-success shapes record one `completed` event.
 *   - Replay/crash recovery: a stage whose artifact is present AND whose
 *     stage-ledger has an `ok` entry with a matching input hash is skipped —
 *     vendor-cost work is never repeated.
 *
 * SEC-REDACT: crawled and AI-generated text NEVER reaches the logger — only
 * ids, statuses, codes, and counts are logged.
 */
import type { Job, Processor } from 'bullmq';
import type { Logger } from 'pino';
import { env } from '../../config/env.js';
import type { ContentSourceProvider } from '../../shared/providers/content-source.js';
import type { KeywordProvider, RankProvider } from '../../shared/providers/types.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
import { resolveAiTaskProfile } from '../../shared/ai-profiles/index.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { contentAnalysisJobSchema, parseConsumedPayload, type ContentAnalysisJob, } from '../../shared/queue/index.js';
import { ContentAnalysis, type ContentAnalysisErrorCategory, type ContentAnalysisHydrated, type ContentAnalysisStatus, } from './content-analysis.model.js';
import { CONTENT_SNAPSHOT_MAX_EXCERPT_CHARS, ContentSnapshot, } from './content-snapshot.model.js';
import { CONTENT_ANALYSIS_STAGE_ORDER, assertContentAnalysisTransition, isTerminalStatus, } from './content-analysis.state.js';
import { recordContentAnalysisEvent } from './content-analysis.events.js';
import { hashInputs, runBriefStage, runCompetitorsStage, runDraftStage, runOwnedStage, runSerpStage, type BriefStageArtifact, type PipelineDeps, type StageContext, } from './content-analysis.pipeline.js';
import { competitorEvidenceSchema, competitorFailureSchema, keywordEvidenceSchema, ownedPageFactsSchema, scorecardSchema, serpEvidenceSchema, stageLedgerEntrySchema, type CompetitorEvidence, type CompetitorFailure, type KeywordEvidence, type OwnedPageFacts, type SerpEvidence, type StageLedgerEntry, } from './content-analysis.schemas.js';
import { buildScorecard } from './content-analysis.score.js';
export interface ContentAnalysisProcessorDeps {
    db: ApplicationDb;
    contentSource: ContentSourceProvider;
    keyword: KeywordProvider;
    rank: RankProvider;
    ai: AiProfileRunner;
    aiProviderOrder: readonly AiGenerationProviderKey[];
    logger: Logger;
    /** Test seams — env-derived defaults, overridable without touching env. */
    now?: () => Date;
    costCeilingMicros?: number;
    aiBudgetMicros?: number;
    snapshotTtlDays?: number;
}
/**
 * Small, unit-testable transition helper. Isolates the "load doc + stamp
 * next stage + save" mechanics so the pipeline can call it from every stage
 * boundary without re-deriving the guards.
 */
export interface AdvanceStageInput {
    analysisId: string;
    nextStatus: ContentAnalysisStatus;
    onEnter?: (doc: InstanceType<typeof ContentAnalysis>) => void;
}
export async function advanceContentAnalysisStage(input: AdvanceStageInput): Promise<{
    outcome: 'advanced';
    status: ContentAnalysisStatus;
} | {
    outcome: 'terminal';
    status: ContentAnalysisStatus;
} | {
    outcome: 'not_found';
}> {
    const doc = await ContentAnalysis.findById(input.analysisId);
    if (!doc)
        return { outcome: 'not_found' };
    if (isTerminalStatus(doc.status)) {
        return { outcome: 'terminal', status: doc.status };
    }
    if (doc.status === input.nextStatus) {
        // Already in this stage — nothing to do (idempotent replay).
        return { outcome: 'advanced', status: doc.status };
    }
    assertContentAnalysisTransition(doc.status, input.nextStatus);
    const now = new Date();
    // Close out the current stage.
    const currentIdx = doc.stages.findIndex((s) => s.name === doc.status && s.completedAt === null);
    if (currentIdx >= 0) {
        doc.stages[currentIdx]!.completedAt = now;
    }
    doc.stages.push({
        name: input.nextStatus,
        startedAt: now,
        completedAt: null,
        error: null,
    });
    doc.status = input.nextStatus;
    if (input.nextStatus === 'collecting_owned' && !doc.startedAt) {
        doc.startedAt = now;
    }
    input.onEnter?.(doc);
    await doc.save();
    return { outcome: 'advanced', status: input.nextStatus };
}
type OwnedFailureCode = 'owned_page_unusable' | 'owned_fetch_failed' | 'provider_unavailable';
const OWNED_FAILURES: Record<OwnedFailureCode, {
    category: ContentAnalysisErrorCategory;
    messageKey: string;
    retryable: boolean;
}> = {
    owned_page_unusable: {
        category: 'owned_page_unusable',
        messageKey: 'contentIntelligence.errors.ownedPageUnusable',
        retryable: false,
    },
    owned_fetch_failed: {
        category: 'owned_fetch_failed',
        messageKey: 'contentIntelligence.errors.ownedFetchFailed',
        retryable: true,
    },
    provider_unavailable: {
        category: 'provider_unavailable',
        messageKey: 'contentIntelligence.errors.providerUnavailable',
        retryable: false,
    },
};
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
const STAGE_INDEX = new Map<string, number>(CONTENT_ANALYSIS_STAGE_ORDER.map((s, i) => [s, i]));
/** The pipeline default SERP location (US) — mirrored from the serp stage. */
const FALLBACK_LOCATION_CODE = 2840;
const HTML_MARKER_TEST = /<\/?script\b|<\/?iframe\b|<!doctype/i;
/**
 * Strip the HTML markers that the model pre-validate hooks reject
 * (`<script`, `<iframe`, `<!doctype`). Bounded fixed-point loop so nested
 * fragments cannot rebuild a marker after one pass; anything still matching
 * after the loop has its angle brackets neutralized outright.
 */
export function stripHtmlMarkers(input: string): string {
    let out = input;
    // Removal (not space-substitution) is what allows a split fragment to
    // rebuild a marker — which is exactly what the fixed-point loop resolves.
    for (let pass = 0; pass < 10 && HTML_MARKER_TEST.test(out); pass += 1) {
        out = out.replace(/<\/?script\b|<\/?iframe\b|<!doctype/gi, '');
    }
    return HTML_MARKER_TEST.test(out) ? out.replace(/[<>]/g, ' ') : out;
}
function countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}
function addWarning(doc: ContentAnalysisHydrated, code: string, messageKey: string): void {
    if (doc.warnings.some((w) => w.code === code))
        return;
    doc.warnings.push({ code, messageKey });
}
function ledgerEntries(doc: ContentAnalysisHydrated, stage: string, inputHash: string): StageLedgerEntry[] {
    return (doc.stageLedger ?? []).flatMap((raw) => {
        const parsed = stageLedgerEntrySchema.safeParse(raw);
        return parsed.success &&
            parsed.data.stage === stage &&
            parsed.data.inputHash === inputHash
            ? [parsed.data]
            : [];
    });
}
function hasOkLedgerEntry(doc: ContentAnalysisHydrated, stage: string, inputHash: string): boolean {
    return ledgerEntries(doc, stage, inputHash).some((e) => e.result === 'ok');
}
function pushLedgerEntry(doc: ContentAnalysisHydrated, entry: StageLedgerEntry): void {
    doc.stageLedger.push(stageLedgerEntrySchema.parse(entry));
    doc.markModified('stageLedger');
}
function readOwnedFacts(doc: ContentAnalysisHydrated): OwnedPageFacts | null {
    const parsed = ownedPageFactsSchema.safeParse(doc.owned);
    return parsed.success ? parsed.data : null;
}
interface EvidenceState {
    keyword: KeywordEvidence | null;
    serp: SerpEvidence | null;
    competitorUrls: string[];
    competitors: CompetitorEvidence[];
    competitorFailures: CompetitorFailure[];
}
function readEvidence(doc: ContentAnalysisHydrated): EvidenceState {
    const raw = (doc.evidence ?? {}) as Record<string, unknown>;
    const keyword = keywordEvidenceSchema.safeParse(raw.keyword);
    const serp = serpEvidenceSchema.safeParse(raw.serp);
    const competitorUrls = Array.isArray(raw.competitorUrls)
        ? raw.competitorUrls.filter((u): u is string => typeof u === 'string')
        : [];
    const competitors = Array.isArray(raw.competitors)
        ? raw.competitors.flatMap((c) => {
            const parsed = competitorEvidenceSchema.safeParse(c);
            return parsed.success ? [parsed.data] : [];
        })
        : [];
    const competitorFailures = Array.isArray(raw.competitorFailures)
        ? raw.competitorFailures.flatMap((c) => {
            const parsed = competitorFailureSchema.safeParse(c);
            return parsed.success ? [parsed.data] : [];
        })
        : [];
    return {
        keyword: keyword.success ? keyword.data : null,
        serp: serp.success ? serp.data : null,
        competitorUrls,
        competitors,
        competitorFailures,
    };
}
function writeEvidence(doc: ContentAnalysisHydrated, ev: EvidenceState): void {
    doc.set('evidence', {
        keyword: ev.keyword,
        serp: ev.serp,
        competitorUrls: ev.competitorUrls,
        competitors: ev.competitors,
        competitorFailures: ev.competitorFailures,
    });
    doc.markModified('evidence');
}
/**
 * Evidence-free keyword shape for the AI stages when the SERP stage was
 * degraded — the brief/draft profiles only consume the keyword STRING (an
 * analysis input, not vendor evidence), so a missing lookup never blocks
 * generation.
 */
function fallbackKeywordEvidence(ctx: StageContext): KeywordEvidence {
    return {
        keyword: ctx.keyword,
        locationCode: FALLBACK_LOCATION_CODE,
        languageCode: ctx.locale === 'zh' ? 'zh-CN' : ctx.locale,
        volume: null,
        difficulty: null,
        intent: null,
    };
}
function hasAiHeadroom(doc: ContentAnalysisHydrated, worstCaseMicros: number, aiBudgetMicros: number, costCeilingMicros: number): boolean {
    const spentAi = Number(doc.aiCostMicros ?? 0);
    const spentTotal = Number(doc.costMicros ?? 0);
    return (spentAi + worstCaseMicros <= aiBudgetMicros &&
        spentTotal + worstCaseMicros <= costCeilingMicros);
}
/**
 * Advance into `target` unless the run went terminal (concurrent cancel) or
 * disappeared. Already-at-or-past-target replays return the fresh document
 * without touching the state machine.
 */
async function enterStage(analysisId: string, target: (typeof CONTENT_ANALYSIS_STAGE_ORDER)[number]): Promise<ContentAnalysisHydrated | null> {
    const doc = await ContentAnalysis.findById(analysisId);
    if (!doc)
        return null;
    if (isTerminalStatus(doc.status))
        return null;
    const currentIdx = STAGE_INDEX.get(doc.status) ?? -1;
    const targetIdx = STAGE_INDEX.get(target)!;
    if (currentIdx >= targetIdx)
        return doc;
    const advanced = await advanceContentAnalysisStage({
        analysisId,
        nextStatus: target,
    });
    if (advanced.outcome !== 'advanced')
        return null;
    return ContentAnalysis.findById(analysisId);
}
/**
 * Terminal failure: status + error saved FIRST, then the idempotent `failed`
 * event. A concurrent terminal state that won the race stops quietly.
 */
async function finalizeFailure(db: ApplicationDb, payload: ContentAnalysisJob, category: ContentAnalysisErrorCategory, messageKey: string, now: () => Date, retryable = false): Promise<void> {
    const advanced = await advanceContentAnalysisStage({
        analysisId: payload.analysisId,
        nextStatus: 'failed',
        onEnter: (doc) => {
            doc.error = { category, messageKey, retryable, terminal: true };
            doc.completedAt = now();
            // `advanceContentAnalysisStage` pushed the terminal stage entry right
            // before invoking this hook, so the array is never empty here.
            doc.stages[doc.stages.length - 1]!.error = category;
        },
    });
    if (advanced.outcome !== 'advanced')
        return;
    const doc = await ContentAnalysis.findById(payload.analysisId);
    if (!doc)
        return;
    await recordContentAnalysisEvent(db, {
        accountId: payload.accountId,
        siteId: payload.siteId,
        analysisId: payload.analysisId,
        reservationKey: doc.idempotencyKey,
        kind: 'failed',
        units: 0,
        costMicros: Number(doc.costMicros ?? 0),
        aiCostMicros: Number(doc.aiCostMicros ?? 0),
        errorCategory: category,
    });
}
/**
 * Terminal success (`completed` | `partial`). Both shapes record one
 * idempotent `completed` event.
 */
async function finalizeSuccess(db: ApplicationDb, payload: ContentAnalysisJob, target: 'completed' | 'partial', now: () => Date): Promise<void> {
    const advanced = await advanceContentAnalysisStage({
        analysisId: payload.analysisId,
        nextStatus: target,
        onEnter: (doc) => {
            doc.completedAt = now();
        },
    });
    if (advanced.outcome !== 'advanced')
        return;
    const doc = await ContentAnalysis.findById(payload.analysisId);
    if (!doc)
        return;
    await recordContentAnalysisEvent(db, {
        accountId: payload.accountId,
        siteId: payload.siteId,
        analysisId: payload.analysisId,
        reservationKey: doc.idempotencyKey,
        kind: 'completed',
        units: 0,
        costMicros: Number(doc.costMicros ?? 0),
        aiCostMicros: Number(doc.aiCostMicros ?? 0),
    });
}
/**
 * Persist the owned-page TTL snapshot (sanitized excerpt + derived facts).
 * Never fatal — a snapshot write failure degrades citations, not the run.
 */
async function persistOwnedSnapshot(doc: ContentAnalysisHydrated, facts: OwnedPageFacts, costMicros: number, now: () => Date, snapshotTtlDays: number, logger: Logger): Promise<void> {
    const excerpt = stripHtmlMarkers(facts.excerpt).slice(0, CONTENT_SNAPSHOT_MAX_EXCERPT_CHARS);
    if (excerpt.trim().length === 0)
        return;
    try {
        const retrievedAt = now();
        const snapshot = await ContentSnapshot.create({
            analysisId: doc._id,
            role: 'owned',
            sourceUrl: facts.url,
            excerpt,
            derivedFacts: {
                headings: [],
                links: [],
                wordCount: facts.wordCount,
                hasSchemaOrgArticle: facts.hasSchemaOrgArticle,
                canonical: facts.canonical,
            },
            contentHash: facts.contentHash,
            retrievedAt,
            retrievalCost: { micros: costMicros, provider: 'content_source', credits: null },
            expiryAt: new Date(retrievedAt.getTime() + snapshotTtlDays * 24 * 60 * 60 * 1000),
        });
        doc.providerRefs.snapshotIds.push(snapshot._id);
    }
    catch {
        logger.warn({ analysisId: String(doc._id) }, 'content-analysis processor: owned snapshot persist failed; continuing');
    }
}
// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------
export function createContentAnalysisProcessor(deps: ContentAnalysisProcessorDeps): Processor<ContentAnalysisJob, void> {
    const now = deps.now ?? (() => new Date());
    const costCeilingMicros = deps.costCeilingMicros ?? env.CONTENT_ANALYSIS_COST_CEILING_MICROS;
    const aiBudgetMicros = deps.aiBudgetMicros ?? env.CONTENT_ANALYSIS_AI_BUDGET_MICROS;
    const snapshotTtlDays = deps.snapshotTtlDays ?? env.CONTENT_ANALYSIS_SNAPSHOT_TTL_DAYS;
    const pipelineDeps: PipelineDeps = {
        contentSource: deps.contentSource,
        keyword: deps.keyword,
        rank: deps.rank,
        ai: deps.ai,
        now,
        aiProviderOrder: deps.aiProviderOrder,
    };
    return async (job: Job<ContentAnalysisJob>) => {
        const payload = parseConsumedPayload(contentAnalysisJobSchema, job.data);
        const doc = await ContentAnalysis.findOne({
            _id: payload.analysisId,
            accountId: payload.accountId,
        });
        if (!doc) {
            // Owning account may have been deleted between enqueue and processing.
            deps.logger.warn({ analysisId: payload.analysisId, accountId: payload.accountId }, 'content-analysis processor: analysis not found; dropping job');
            return;
        }
        if (isTerminalStatus(doc.status)) {
            // Idempotent replay — nothing to do.
            deps.logger.info({ analysisId: payload.analysisId, status: doc.status }, 'content-analysis processor: terminal analysis on replay; no-op');
            return;
        }
        const ctx: StageContext = {
            accountId: payload.accountId,
            siteId: payload.siteId,
            analysisId: payload.analysisId,
            ownedUrl: doc.ownedUrl,
            keyword: doc.keyword,
            locale: doc.locale as StageContext['locale'],
            ownedDomain: new URL(doc.ownedUrl).hostname,
            correlationId: `content-analysis-${payload.analysisId}`,
            reviewedCompetitorUrls: doc.reviewedCompetitorUrls,
        };
        // ---------------------------------------------------------------------
        // Stage 1 — collecting_owned
        // ---------------------------------------------------------------------
        let stageDoc = await enterStage(payload.analysisId, 'collecting_owned');
        if (!stageDoc) {
            deps.logger.info({ analysisId: payload.analysisId }, 'content-analysis processor: run went terminal before owned stage; stopping');
            return;
        }
        const ownedHash = hashInputs('collecting_owned', ctx.ownedUrl, ctx.keyword, ctx.locale);
        let facts = readOwnedFacts(stageDoc);
        if (!(facts && hasOkLedgerEntry(stageDoc, 'collecting_owned', ownedHash))) {
            const startedMs = now().getTime();
            const outcome = await runOwnedStage(ctx, pipelineDeps);
            if (!outcome.ok) {
                // A retryable fetch fault is a transient vendor error, not a bad page:
                // failed-but-retryable + "try again" message. A credential rejection is
                // an operator misconfiguration: terminal, not the user's page.
                const { category, messageKey, retryable } = OWNED_FAILURES[outcome.code in OWNED_FAILURES
                    ? (outcome.code as OwnedFailureCode)
                    : 'owned_page_unusable'];
                await finalizeFailure(deps.db, payload, category, messageKey, now, retryable);
                // Credential rejections surface at warn so operator misconfig is visible
                // at default log levels; the other two are user/transient noise.
                deps.logger[category === 'provider_unavailable' ? 'warn' : 'info']({
                    analysisId: payload.analysisId,
                    code: outcome.code,
                    // `reason` is 'no usable content' or a bounded vendor error string —
                    // never crawled/AI text (SEC-REDACT). It is the sole diagnostic datum.
                    reason: outcome.reason,
                }, 'content-analysis processor: owned stage failed; run failed');
                return;
            }
            facts = outcome.artifact;
            stageDoc.set('owned', facts);
            stageDoc.markModified('owned');
            stageDoc.costMicros = Number(stageDoc.costMicros ?? 0) + outcome.costMicros;
            pushLedgerEntry(stageDoc, {
                stage: 'collecting_owned',
                inputHash: ownedHash,
                result: 'ok',
                durationMs: Math.max(0, now().getTime() - startedMs),
                costMicros: outcome.costMicros,
                aiCostMicros: 0,
                reason: null,
            });
            await persistOwnedSnapshot(stageDoc, facts, outcome.costMicros, now, snapshotTtlDays, deps.logger);
            await stageDoc.save();
        }
        // ---------------------------------------------------------------------
        // Stage 2 — collecting_serp (failure degrades, never fails the run)
        // ---------------------------------------------------------------------
        stageDoc = await enterStage(payload.analysisId, 'collecting_serp');
        if (!stageDoc)
            return;
        const serpHash = hashInputs('collecting_serp', ctx.keyword, ctx.locale, ctx.ownedDomain);
        let evidence = readEvidence(stageDoc);
        let degraded = false;
        const serpStageEntries = ledgerEntries(stageDoc, 'collecting_serp', serpHash);
        const serpReusable = serpStageEntries.some((e) => e.result === 'ok') &&
            evidence.keyword !== null &&
            evidence.serp !== null;
        if (serpReusable) {
            // Replay — reuse the persisted evidence, never re-spend.
        }
        else if (serpStageEntries.some((e) => e.result === 'failed')) {
            // Replay of a run whose SERP stage already failed — stay degraded.
            degraded = true;
        }
        else {
            const startedMs = now().getTime();
            const outcome = await runSerpStage(ctx, pipelineDeps);
            if (outcome.ok) {
                evidence = {
                    ...evidence,
                    keyword: outcome.artifact.keyword,
                    serp: outcome.artifact.serp,
                    competitorUrls: outcome.artifact.competitorUrls,
                };
                writeEvidence(stageDoc, evidence);
                stageDoc.costMicros = Number(stageDoc.costMicros ?? 0) + outcome.costMicros;
                pushLedgerEntry(stageDoc, {
                    stage: 'collecting_serp',
                    inputHash: serpHash,
                    result: 'ok',
                    durationMs: Math.max(0, now().getTime() - startedMs),
                    costMicros: outcome.costMicros,
                    aiCostMicros: 0,
                    reason: null,
                });
            }
            else {
                degraded = true;
                addWarning(stageDoc, 'serp_unavailable', 'contentIntelligence.warnings.serpUnavailable');
                pushLedgerEntry(stageDoc, {
                    stage: 'collecting_serp',
                    inputHash: serpHash,
                    result: 'failed',
                    durationMs: Math.max(0, now().getTime() - startedMs),
                    costMicros: 0,
                    aiCostMicros: 0,
                    reason: outcome.code,
                });
            }
            await stageDoc.save();
        }
        // ---------------------------------------------------------------------
        // Stage 3 — collecting_competitors (failures never fatal)
        // ---------------------------------------------------------------------
        stageDoc = await enterStage(payload.analysisId, 'collecting_competitors');
        if (!stageDoc)
            return;
        evidence = readEvidence(stageDoc);
        const competitorUrls = evidence.competitorUrls;
        const competitorsHash = hashInputs('collecting_competitors', ...competitorUrls);
        const competitorsEntries = ledgerEntries(stageDoc, 'collecting_competitors', competitorsHash);
        if (competitorsEntries.some((e) => e.result === 'ok' || e.result === 'skipped')) {
            // Replay — reuse the persisted competitor evidence, never re-spend.
        }
        else if (competitorUrls.length === 0) {
            pushLedgerEntry(stageDoc, {
                stage: 'collecting_competitors',
                inputHash: competitorsHash,
                result: 'skipped',
                durationMs: 0,
                costMicros: 0,
                aiCostMicros: 0,
                reason: 'no_candidates',
            });
            await stageDoc.save();
        }
        else {
            const budgetMicros = Math.max(0, costCeilingMicros - Number(stageDoc.costMicros ?? 0));
            const startedMs = now().getTime();
            const outcome = await runCompetitorsStage(ctx, pipelineDeps, {
                urls: competitorUrls,
                budgetMicros,
            });
            if (outcome.ok) {
                evidence = {
                    ...evidence,
                    competitors: outcome.artifact.competitors,
                    competitorFailures: outcome.artifact.failures,
                };
                writeEvidence(stageDoc, evidence);
                stageDoc.costMicros = Number(stageDoc.costMicros ?? 0) + outcome.costMicros;
                if (outcome.artifact.failures.length > 0) {
                    addWarning(stageDoc, 'competitors_partial', 'contentIntelligence.warnings.competitorsPartial');
                }
                pushLedgerEntry(stageDoc, {
                    stage: 'collecting_competitors',
                    inputHash: competitorsHash,
                    result: 'ok',
                    durationMs: Math.max(0, now().getTime() - startedMs),
                    costMicros: outcome.costMicros,
                    aiCostMicros: 0,
                    reason: null,
                });
            }
            else {
                // Defensive — the competitors handler reports per-URL failures inside
                // an ok outcome; a whole-stage failure still never fails the run.
                addWarning(stageDoc, 'competitors_partial', 'contentIntelligence.warnings.competitorsPartial');
                pushLedgerEntry(stageDoc, {
                    stage: 'collecting_competitors',
                    inputHash: competitorsHash,
                    result: 'failed',
                    durationMs: Math.max(0, now().getTime() - startedMs),
                    costMicros: 0,
                    aiCostMicros: 0,
                    reason: outcome.code,
                });
            }
            await stageDoc.save();
        }
        // ---------------------------------------------------------------------
        // Stage 4 — scoring (deterministic; a throw fails the run CHARGED)
        // ---------------------------------------------------------------------
        stageDoc = await enterStage(payload.analysisId, 'scoring');
        if (!stageDoc)
            return;
        evidence = readEvidence(stageDoc);
        const scoringHash = hashInputs('scoring', facts.contentHash, ctx.keyword, String(evidence.serp?.ownedPosition ?? 'none'), ...evidence.competitors.map((c) => c.contentHash));
        const scorecardPresent = scorecardSchema.safeParse(stageDoc.scorecardV2).success;
        if (!(scorecardPresent && hasOkLedgerEntry(stageDoc, 'scoring', scoringHash))) {
            const startedMs = now().getTime();
            let output: ReturnType<typeof buildScorecard>;
            try {
                output = buildScorecard({
                    keyword: ctx.keyword,
                    owned: facts,
                    keywordEvidence: evidence.keyword,
                    serp: evidence.serp,
                    competitors: evidence.competitors,
                });
            }
            catch {
                deps.logger.error({ analysisId: payload.analysisId }, 'content-analysis processor: scoring failed; run failed');
                await finalizeFailure(deps.db, payload, 'scoring_failed', 'contentIntelligence.errors.scoringFailed', now);
                return;
            }
            stageDoc.set('scorecardV2', output.scorecard);
            stageDoc.markModified('scorecardV2');
            stageDoc.set('recommendations', output.recommendations);
            stageDoc.markModified('recommendations');
            stageDoc.set('citations', [
                { sourceId: 'owned', url: facts.url, title: facts.title },
                ...evidence.competitors.map((c) => ({
                    sourceId: c.sourceId,
                    url: c.url,
                    title: c.title,
                })),
            ]);
            if (output.stuffingSuspected) {
                addWarning(stageDoc, 'stuffing_suspected', 'contentIntelligence.warnings.stuffingSuspected');
            }
            pushLedgerEntry(stageDoc, {
                stage: 'scoring',
                inputHash: scoringHash,
                result: 'ok',
                durationMs: Math.max(0, now().getTime() - startedMs),
                costMicros: 0,
                aiCostMicros: 0,
                reason: null,
            });
            await stageDoc.save();
        }
        // ---------------------------------------------------------------------
        // Stage 5 — generating_brief (AI budget gate BEFORE the call)
        // ---------------------------------------------------------------------
        stageDoc = await enterStage(payload.analysisId, 'generating_brief');
        if (!stageDoc)
            return;
        evidence = readEvidence(stageDoc);
        const briefWorstCaseMicros = Number(resolveAiTaskProfile('content_brief').maxCostMicros);
        const draftWorstCaseMicros = Number(resolveAiTaskProfile('content_first_draft').maxCostMicros);
        const briefHash = hashInputs('generating_brief', facts.contentHash, ctx.keyword, ctx.locale);
        let briefArtifact: BriefStageArtifact;
        const storedBriefText = typeof stageDoc.brief?.text === 'string' && stageDoc.brief.text.length > 0
            ? stageDoc.brief.text
            : null;
        if (storedBriefText && hasOkLedgerEntry(stageDoc, 'generating_brief', briefHash)) {
            // Replay — reuse the persisted brief, never re-spend.
            briefArtifact = {
                text: storedBriefText,
                citations: [...(stageDoc.brief?.citations ?? [])],
                profileVersion: stageDoc.brief?.profileVersion ?? 'unknown',
                provider: stageDoc.brief?.provider ?? 'unknown',
                costMicros: 0,
            };
        }
        else {
            if (!hasAiHeadroom(stageDoc, briefWorstCaseMicros, aiBudgetMicros, costCeilingMicros)) {
                addWarning(stageDoc, 'ai_budget_exhausted', 'contentIntelligence.warnings.aiBudgetExhausted');
                pushLedgerEntry(stageDoc, {
                    stage: 'generating_brief',
                    inputHash: briefHash,
                    result: 'skipped',
                    durationMs: 0,
                    costMicros: 0,
                    aiCostMicros: 0,
                    reason: 'ai_budget_exhausted',
                });
                pushLedgerEntry(stageDoc, {
                    stage: 'generating_draft',
                    inputHash: hashInputs('generating_draft', facts.contentHash, ctx.keyword, 'skipped'),
                    result: 'skipped',
                    durationMs: 0,
                    costMicros: 0,
                    aiCostMicros: 0,
                    reason: 'ai_budget_exhausted',
                });
                await stageDoc.save();
                await finalizeSuccess(deps.db, payload, 'partial', now);
                deps.logger.info({ analysisId: payload.analysisId, status: 'partial' }, 'content-analysis processor: AI budget insufficient before brief; run partial');
                return;
            }
            const startedMs = now().getTime();
            const outcome = await runBriefStage(ctx, pipelineDeps, {
                facts,
                keyword: evidence.keyword ?? fallbackKeywordEvidence(ctx),
                competitors: evidence.competitors,
            });
            if (!outcome.ok) {
                // Failed brief → partial WITHOUT a draft attempt.
                addWarning(stageDoc, 'brief_failed', 'contentIntelligence.warnings.briefFailed');
                pushLedgerEntry(stageDoc, {
                    stage: 'generating_brief',
                    inputHash: briefHash,
                    result: 'failed',
                    durationMs: Math.max(0, now().getTime() - startedMs),
                    costMicros: 0,
                    aiCostMicros: 0,
                    reason: outcome.code,
                });
                await stageDoc.save();
                await finalizeSuccess(deps.db, payload, 'partial', now);
                deps.logger.info({ analysisId: payload.analysisId, status: 'partial' }, 'content-analysis processor: brief generation failed; run partial');
                return;
            }
            const sanitizedBrief = stripHtmlMarkers(outcome.artifact.text);
            stageDoc.set('brief', {
                versionId: outcome.artifact.profileVersion,
                sections: [],
                text: sanitizedBrief,
                citations: [...outcome.artifact.citations],
                profileVersion: outcome.artifact.profileVersion,
                provider: outcome.artifact.provider,
            });
            stageDoc.costMicros = Number(stageDoc.costMicros ?? 0) + outcome.costMicros;
            stageDoc.aiCostMicros =
                Number(stageDoc.aiCostMicros ?? 0) + (outcome.aiCostMicros ?? 0);
            pushLedgerEntry(stageDoc, {
                stage: 'generating_brief',
                inputHash: briefHash,
                result: 'ok',
                durationMs: Math.max(0, now().getTime() - startedMs),
                costMicros: outcome.costMicros,
                aiCostMicros: outcome.aiCostMicros ?? 0,
                reason: null,
            });
            await stageDoc.save();
            briefArtifact = { ...outcome.artifact, text: sanitizedBrief };
        }
        // ---------------------------------------------------------------------
        // Stage 6 — generating_draft (AI budget gate BEFORE the call)
        // ---------------------------------------------------------------------
        stageDoc = await enterStage(payload.analysisId, 'generating_draft');
        if (!stageDoc)
            return;
        const draftHash = hashInputs('generating_draft', facts.contentHash, ctx.keyword, briefArtifact.text);
        const storedDraft = typeof stageDoc.draft?.markdown === 'string' &&
            stageDoc.draft.markdown.length > 0;
        if (!(storedDraft && hasOkLedgerEntry(stageDoc, 'generating_draft', draftHash))) {
            if (!hasAiHeadroom(stageDoc, draftWorstCaseMicros, aiBudgetMicros, costCeilingMicros)) {
                // Draft skipped, brief kept → partial.
                addWarning(stageDoc, 'ai_budget_exhausted', 'contentIntelligence.warnings.aiBudgetExhausted');
                pushLedgerEntry(stageDoc, {
                    stage: 'generating_draft',
                    inputHash: draftHash,
                    result: 'skipped',
                    durationMs: 0,
                    costMicros: 0,
                    aiCostMicros: 0,
                    reason: 'ai_budget_exhausted',
                });
                await stageDoc.save();
                await finalizeSuccess(deps.db, payload, 'partial', now);
                deps.logger.info({ analysisId: payload.analysisId, status: 'partial' }, 'content-analysis processor: AI budget insufficient before draft; run partial');
                return;
            }
            evidence = readEvidence(stageDoc);
            const startedMs = now().getTime();
            const outcome = await runDraftStage(ctx, pipelineDeps, {
                facts,
                keyword: evidence.keyword ?? fallbackKeywordEvidence(ctx),
                brief: briefArtifact,
                competitors: evidence.competitors,
            });
            const sanitizedDraft = outcome.ok
                ? stripHtmlMarkers(outcome.artifact.text).slice(0, 30000)
                : '';
            if (!outcome.ok || sanitizedDraft.trim().length === 0) {
                // Failed draft → partial, KEEPING the brief.
                addWarning(stageDoc, 'draft_failed', 'contentIntelligence.warnings.draftFailed');
                pushLedgerEntry(stageDoc, {
                    stage: 'generating_draft',
                    inputHash: draftHash,
                    result: 'failed',
                    durationMs: Math.max(0, now().getTime() - startedMs),
                    costMicros: 0,
                    aiCostMicros: 0,
                    reason: outcome.ok ? 'draft_empty' : outcome.code,
                });
                await stageDoc.save();
                await finalizeSuccess(deps.db, payload, 'partial', now);
                deps.logger.info({ analysisId: payload.analysisId, status: 'partial' }, 'content-analysis processor: draft generation failed; run partial (brief kept)');
                return;
            }
            stageDoc.draft = {
                versionId: outcome.artifact.profileVersion,
                markdown: sanitizedDraft,
                wordCount: countWords(sanitizedDraft),
                text: null,
                citations: [...outcome.artifact.citations],
                profileVersion: outcome.artifact.profileVersion,
                provider: outcome.artifact.provider,
            };
            stageDoc.costMicros = Number(stageDoc.costMicros ?? 0) + outcome.costMicros;
            stageDoc.aiCostMicros =
                Number(stageDoc.aiCostMicros ?? 0) + (outcome.aiCostMicros ?? 0);
            pushLedgerEntry(stageDoc, {
                stage: 'generating_draft',
                inputHash: draftHash,
                result: 'ok',
                durationMs: Math.max(0, now().getTime() - startedMs),
                costMicros: outcome.costMicros,
                aiCostMicros: outcome.aiCostMicros ?? 0,
                reason: null,
            });
            await stageDoc.save();
        }
        // ---------------------------------------------------------------------
        // Terminal — completed only with scorecard + brief + draft and no
        // degradation; every other scored terminal is partial.
        // ---------------------------------------------------------------------
        const finalDoc = await ContentAnalysis.findById(payload.analysisId);
        if (!finalDoc || isTerminalStatus(finalDoc.status))
            return;
        const complete = scorecardSchema.safeParse(finalDoc.scorecardV2).success &&
            typeof finalDoc.brief?.text === 'string' &&
            finalDoc.brief.text.length > 0 &&
            typeof finalDoc.draft?.markdown === 'string' &&
            finalDoc.draft.markdown.length > 0 &&
            !degraded;
        const target = complete ? ('completed' as const) : ('partial' as const);
        await finalizeSuccess(deps.db, payload, target, now);
        deps.logger.info({ analysisId: payload.analysisId, status: target }, 'content-analysis processor: run finished');
    };
}
