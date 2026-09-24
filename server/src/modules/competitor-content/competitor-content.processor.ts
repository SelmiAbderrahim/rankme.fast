/**
 * Competitor content intelligence — worker processor.
 *
 * Orchestrates one competitor content run:
 *
 *   queued → collecting → comparing → completed | partial | failed | cancelled
 *
 * Invariants:
 *   1. The payload is re-validated via `parseConsumedPayload` so a malformed
 *      job goes straight to the dead-letter queue as an `UnrecoverableError`.
 *   2. Terminal runs are no-ops on replay — the worker never re-executes work
 *      that reached a terminal state, and a concurrent cancel between stages is
 *      re-checked at every boundary.
 *   3. Ownership is re-verified at consume time (`{ _id, accountId }`).
 *   4. Pages persist INCREMENTALLY as they are scraped (derived facts + a
 *      sanitized snippet on a 7-day TTL — never raw HTML), and a single failed
 *      competitor never aborts the run (— an access failure is never a
 *      weakness).
 *   5. The deterministic comparison (`compareCompetitors`) needs NO AI. The
 *      optional `competitor_comparison` pass is bounded by an AI sub-budget +
 *      the overall ceiling AND gated by the n-gram copy-similarity guard: output
 *      that reproduces substantial competitor prose is rejected and dropped, and
 *      the deltas/opportunities stand on their own.
 *   6. Every terminal stop records exactly one terminal event with the run's
 *      direct vendor + AI cost.
 *
 * SEC-REDACT: crawled + AI-generated text NEVER reaches the logger — only ids,
 * statuses, codes, and counts are logged.
 */
import type { Job, Processor } from 'bullmq';
import type { Logger } from 'pino';
import type { ContentSourceProvider } from '../../shared/providers/content-source.js';
import type { PublicUrlResolver } from '../../shared/security/url-safety.js';
import { assertPublicUrlSafe } from '../../shared/security/url-safety.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
import { resolveAiTaskProfile } from '../../shared/ai-profiles/index.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { competitorContentJobSchema, parseConsumedPayload, type CompetitorContentJob, } from '../../shared/queue/index.js';
import { CompetitorContentRun, CompetitorContentSnapshot, CompetitorPageFacts, type CompetitorContentErrorCategory, type CompetitorContentRunHydrated, type CompetitorContentStatus, } from './competitor-content.model.js';
import { assertCompetitorContentTransition, isCompetitorContentTerminalStatus, } from './competitor-content.state.js';
import { recordCompetitorContentEvent } from './competitor-content.events.js';
import { collectPages, stripHtmlMarkers, type CollectedPage, } from './competitor-content.collect.js';
import { compareReviewedPairs, type CompetitorPageInput, } from './competitor-content.delta.js';
import { frozenCompetitorPageMatchSchema } from './competitor-content.schemas.js';
import { loadActiveCompetitorProfiles, registrableDomainKey } from './competitor-content.profiles.service.js';
import { Site } from '../sites/index.js';
import { evaluateCopySimilarity } from './competitor-content.ngram.js';
import type { CompetitorContentFindings, CompetitorPageFacts as CompetitorPageFactsShape, } from './competitor-content.schemas.js';
export interface CompetitorContentProcessorDeps {
    db: ApplicationDb;
    contentSource: ContentSourceProvider;
    ai: AiProfileRunner;
    aiProviderOrder: readonly AiGenerationProviderKey[];
    logger: Logger;
    /** Test seams — literal defaults so tests never touch env. */
    now?: () => Date;
    resolver?: PublicUrlResolver;
    /** Cancellation signal forwarded to collection (unused in production). */
    signal?: AbortSignal;
    costCeilingMicros?: number;
    aiBudgetMicros?: number;
    snapshotTtlDays?: number;
    maxCharacters?: number;
    timeoutMs?: number;
}
function sameNormalizedPageUrl(left: string | null, right: string): boolean {
    if (!left)
        return false;
    try {
        return new URL(left).toString() === new URL(right).toString();
    }
    catch {
        return false;
    }
}
function parseFrozenPageMatches(values: readonly unknown[]) {
    return values.flatMap((value) => {
        const parsed = frozenCompetitorPageMatchSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
    });
}
export const competitorContentProcessorTestables = {
    parseFrozenPageMatches,
    sameNormalizedPageUrl,
};
export function addWarning(doc: CompetitorContentRunHydrated, code: string, messageKey: string): void {
    if (doc.warnings.some((w) => w.code === code))
        return;
    doc.warnings.push({ code, messageKey });
}
/** Advance a non-terminal run to `next`; null when it went terminal / vanished. */
export async function advance(runId: string, next: CompetitorContentStatus, now: () => Date): Promise<CompetitorContentRunHydrated | null> {
    const doc = await CompetitorContentRun.findById(runId);
    if (!doc || isCompetitorContentTerminalStatus(doc.status))
        return null;
    if (doc.status === next)
        return doc;
    assertCompetitorContentTransition(doc.status, next);
    const at = now();
    const idx = doc.stages.findIndex((s) => s.name === doc.status && s.completedAt === null);
    if (idx >= 0)
        doc.stages[idx]!.completedAt = at;
    doc.stages.push({ name: next, startedAt: at, completedAt: null, error: null });
    doc.status = next;
    if (next === 'collecting' && !doc.startedAt)
        doc.startedAt = at;
    await doc.save();
    return doc;
}
interface FinalizeInput {
    db: ApplicationDb;
    payload: CompetitorContentJob;
    status: 'completed' | 'partial' | 'failed' | 'cancelled';
    category?: CompetitorContentErrorCategory;
    messageKey?: string;
    now: () => Date;
}
/**
 * Terminal transition + event. Idempotent: a concurrent terminal winner
 * short-circuits, and the event insert is unique per `(key, kind)`.
 */
export async function finalize(input: FinalizeInput): Promise<void> {
    const doc = await CompetitorContentRun.findById(input.payload.runId);
    if (!doc || isCompetitorContentTerminalStatus(doc.status))
        return;
    assertCompetitorContentTransition(doc.status, input.status);
    const at = input.now();
    const idx = doc.stages.findIndex((s) => s.name === doc.status && s.completedAt === null);
    if (idx >= 0)
        doc.stages[idx]!.completedAt = at;
    doc.status = input.status;
    doc.completedAt = at;
    if (input.status === 'cancelled')
        doc.cancelledAt = at;
    if (input.category && input.messageKey) {
        doc.error = {
            category: input.category,
            messageKey: input.messageKey,
            retryable: false,
            terminal: true,
        };
    }
    await doc.save();
    const kind = input.status === 'failed'
        ? 'failed'
        : input.status === 'cancelled'
            ? 'cancelled'
            : 'completed';
    await recordCompetitorContentEvent(input.db, {
        accountId: input.payload.accountId,
        siteId: input.payload.siteId,
        runId: input.payload.runId,
        reservationKey: doc.idempotencyKey,
        kind,
        units: 0,
        costMicros: Number(doc.costMicros),
        aiCostMicros: Number(doc.aiCostMicros),
        errorCategory: input.category ?? null,
    });
}
/**
 * Optional AI comparison explanation. Budget-gated, failure-tolerant, AND
 * copy-similarity-guarded: a plausible model that echoes a
 * competitor snippet is REJECTED and dropped — the deterministic findings are
 * already complete, so a skip only adds a warning.
 */
export async function runAiComparison(deps: CompetitorContentProcessorDeps, doc: CompetitorContentRunHydrated, owned: CompetitorPageFactsShape, competitorPages: readonly CollectedPage[], aiBudgetMicros: number, costCeilingMicros: number): Promise<{
    explanation: string | null;
    aiCostMicros: number;
}> {
    const profile = resolveAiTaskProfile('competitor_comparison');
    const worstCase = Number(profile.maxCostMicros);
    const spentAi = Number(doc.aiCostMicros);
    const spentTotal = Number(doc.costMicros);
    if (spentAi + worstCase > aiBudgetMicros || spentTotal + worstCase > costCeilingMicros) {
        addWarning(doc, 'competitor_ai_skipped', 'contentIntelligence.competitorContent.warnings.aiBudgetExhausted');
        return { explanation: null, aiCostMicros: 0 };
    }
    const snippets = competitorPages.map((p) => ({
        id: `snippet:${p.domain ?? p.facts.url}`,
        text: p.facts.snippet,
    }));
    if (snippets.length === 0) {
        return { explanation: null, aiCostMicros: 0 };
    }
    const ownedFacts = JSON.stringify({
        url: owned.url,
        title: owned.title,
        wordCount: owned.wordCount,
        headingCount: owned.headings.length,
        schemaTypes: owned.schemaTypes,
        topics: [...owned.primaryTopics, ...owned.secondaryTopics],
    }).slice(0, 12000);
    let result;
    try {
        result = await deps.ai.run<{
            comparison: string;
            citations: string[];
        }>({
            profile: 'competitor_comparison',
            locale: doc.locale,
            correlationId: `competitor-content-${String(doc._id)}`,
            usage: {
                accountId: String(doc.accountId),
                siteId: String(doc.siteId),
                jobId: String(doc._id),
            },
            configuredProviderOrder: deps.aiProviderOrder,
            input: { ownedFacts, competitorSnippets: snippets },
        });
    }
    catch {
        addWarning(doc, 'competitor_ai_skipped', 'contentIntelligence.competitorContent.warnings.aiUnavailable');
        return { explanation: null, aiCostMicros: 0 };
    }
    const aiCostMicros = Number(result.provenance.actualOrEstimatedCostMicros ?? 0n);
    const raw = stripHtmlMarkers(result.object.comparison).slice(0, 8000).trim();
    // Copy-similarity guard — reject output too close to ANY competitor snippet.
    const guard = evaluateCopySimilarity(raw, competitorPages.map((p) => p.facts.snippet));
    if (guard.rejected) {
        addWarning(doc, 'competitor_ai_rejected', 'contentIntelligence.competitorContent.warnings.aiCopyRejected');
        // Cost is still incurred (the model ran) — count it, drop the text.
        return { explanation: null, aiCostMicros };
    }
    return { explanation: raw.length > 0 ? raw : null, aiCostMicros };
}
export function createCompetitorContentProcessor(deps: CompetitorContentProcessorDeps): Processor<CompetitorContentJob, void> {
    const now = deps.now ?? (() => new Date());
    const costCeilingMicros = deps.costCeilingMicros ?? 250000;
    const aiBudgetMicros = deps.aiBudgetMicros ?? 140000;
    const snapshotTtlDays = deps.snapshotTtlDays ?? 7;
    const maxCharacters = deps.maxCharacters ?? 50000;
    const timeoutMs = deps.timeoutMs ?? 120000;
    return async (job: Job<CompetitorContentJob>) => {
        const payload = parseConsumedPayload(competitorContentJobSchema, job.data);
        const run = await CompetitorContentRun.findOne({
            _id: payload.runId,
            accountId: payload.accountId,
        });
        if (!run) {
            deps.logger.warn({ runId: payload.runId, accountId: payload.accountId }, 'competitor-content processor: run not found; dropping job');
            return;
        }
        if (isCompetitorContentTerminalStatus(run.status)) {
            deps.logger.info({ runId: payload.runId, status: run.status }, 'competitor-content processor: terminal run on replay; no-op');
            return;
        }
        // Stage 1 — collecting.
        const collectingDoc = await advance(payload.runId, 'collecting', now);
        if (!collectingDoc)
            return;
        // Consume-time authority: never trust the queued snapshot alone. Repeat
        // site/profile ownership and public URL checks before any vendor spend.
        const frozenMatches = parseFrozenPageMatches(collectingDoc.input.pageMatches);
        const site = await Site.findOne({
            _id: payload.siteId,
            accountId: payload.accountId,
            deletionStartedAt: null,
        }).lean();
        const profileIds = [...new Set(frozenMatches.map((match) => match.competitorProfileId))];
        const activeProfiles = await loadActiveCompetitorProfiles(deps.db, {
            accountId: payload.accountId,
            siteId: payload.siteId,
            competitorIds: profileIds,
        });
        const profileById = new Map(activeProfiles.map((profile) => [profile.id, profile]));
        let targetsSafe = Boolean(site) && frozenMatches.length > 0 && activeProfiles.length === profileIds.length;
        if (targetsSafe) {
            const ownedSiteOrigin = new URL(site!.url).origin;
            for (const match of frozenMatches) {
                const profile = profileById.get(match.competitorProfileId);
                try {
                    const [selected, owned] = await Promise.all([
                        assertPublicUrlSafe(match.selectedUrl, deps.resolver ? { resolver: deps.resolver } : {}),
                        assertPublicUrlSafe(match.ownedUrl!, deps.resolver ? { resolver: deps.resolver } : {}),
                    ]);
                    if (!profile ||
                        registrableDomainKey(selected.hostname) !== profile.registrableDomain ||
                        profile.registrableDomain !== match.competitorDomain ||
                        owned.origin !== ownedSiteOrigin) {
                        targetsSafe = false;
                        break;
                    }
                }
                catch {
                    targetsSafe = false;
                    break;
                }
            }
        }
        if (!targetsSafe) {
            await finalize({
                db: deps.db,
                payload,
                status: 'failed',
                category: 'no_confirmed_competitors',
                messageKey: 'contentIntelligence.competitorContent.errors.reviewedTargetsInvalid',
                now,
            });
            return;
        }
        const persistPage = async (page: CollectedPage): Promise<void> => {
            try {
                await CompetitorPageFacts.updateOne({ runId: run._id, url: page.facts.url }, {
                    $set: {
                        accountId: payload.accountId,
                        siteId: payload.siteId,
                        role: page.facts.role,
                        facts: page.facts,
                        contentHash: page.contentHash,
                        createdAtMs: now().getTime(),
                    },
                }, { upsert: true });
                const excerpt = stripHtmlMarkers(page.excerpt).trim();
                if (excerpt.length > 0) {
                    const retrievedAt = now();
                    await CompetitorContentSnapshot.create({
                        runId: run._id,
                        sourceUrl: page.facts.url,
                        excerpt,
                        contentHash: page.contentHash,
                        retrievedAt,
                        expiryAt: new Date(retrievedAt.getTime() + snapshotTtlDays * 24 * 60 * 60 * 1000),
                    });
                }
            }
            catch {
                deps.logger.warn({ runId: payload.runId }, 'competitor-content processor: page persist failed; continuing');
            }
        };
        const matchByLeg = new Map<string, (typeof frozenMatches)[number]>();
        const competitorTargets = frozenMatches.map((match, index) => {
            const legKey = `${match.suggestionId ?? 'explicit'}:${index}`;
            matchByLeg.set(legKey, match);
            return {
                domain: match.competitorDomain,
                url: match.selectedUrl,
                ownedUrl: match.ownedUrl!,
                legKey,
            };
        });
        let collectResult;
        try {
            collectResult = await collectPages({
                ownedUrl: run.ownedUrl,
                competitors: competitorTargets,
                pageLimit: run.input.pageLimit,
            }, { maxCharacters, timeoutMs, costCeilingMicros }, {
                contentSource: deps.contentSource,
                ...(deps.resolver ? { resolver: deps.resolver } : {}),
                ...(deps.signal ? { signal: deps.signal } : {}),
                now: () => now().getTime(),
                onOwned: persistPage,
                onCompetitor: persistPage,
                logger: deps.logger,
            });
        }
        catch {
            deps.logger.error({ runId: payload.runId }, 'competitor-content processor: collection failed; run failed');
            await finalize({
                db: deps.db,
                payload,
                status: 'failed',
                category: 'collection_failed',
                messageKey: 'contentIntelligence.competitorContent.errors.collectionFailed',
                now,
            });
            return;
        }
        // A user may have cancelled while collection ran — respect terminal state.
        const afterCollect = await CompetitorContentRun.findById(payload.runId);
        if (!afterCollect || isCompetitorContentTerminalStatus(afterCollect.status))
            return;
        afterCollect.progress.competitorsProcessed = collectResult.competitorsProcessed;
        afterCollect.progress.competitorsFailed = collectResult.competitorsFailed;
        afterCollect.progress.pagesScraped = collectResult.pagesScraped;
        afterCollect.costMicros = collectResult.costMicros;
        await afterCollect.save();
        if (collectResult.completion === 'cancelled') {
            await finalize({
                db: deps.db,
                payload,
                status: 'cancelled',
                category: 'cancelled',
                messageKey: 'contentIntelligence.competitorContent.errors.cancelledByUser',
                now,
            });
            return;
        }
        if (collectResult.ownedUnusable || !collectResult.owned) {
            await finalize({
                db: deps.db,
                payload,
                status: 'failed',
                category: 'owned_page_unusable',
                messageKey: 'contentIntelligence.competitorContent.errors.ownedPageUnusable',
                now,
            });
            return;
        }
        if (collectResult.competitorsProcessed === 0) {
            await finalize({
                db: deps.db,
                payload,
                status: 'failed',
                category: 'no_comparable_pages',
                messageKey: 'contentIntelligence.competitorContent.errors.noComparablePages',
                now,
            });
            return;
        }
        // Stage 2 — comparing (deterministic; no AI required).
        const comparingDoc = await advance(payload.runId, 'comparing', now);
        if (!comparingDoc)
            return;
        const pairedInputs = collectResult.pairs.map((pair) => {
            const match = matchByLeg.get(pair.legKey)!;
            const comparableEvidence = match.keywordEvidence.filter((item) => sameNormalizedPageUrl(item.competitorUrl, match.selectedUrl) &&
                sameNormalizedPageUrl(item.ownedUrl, match.ownedUrl!));
            const linkedShared = comparableEvidence.map((item) => item.keyword);
            const linkedDemand = comparableEvidence.map((item) => ({
                query: item.keyword,
                searchVolume: item.searchVolume,
            }));
            const competitor: CompetitorPageInput = {
                facts: pair.competitor.facts,
                // Landscape-reviewed legs never borrow domain-wide evidence: only the
                // exact observed ranking-page pair proves comparable intent/page type.
                // Explicit legacy URLs have no linked landscape evidence and therefore
                // retain facts/deltas without generating unsupported gap claims.
                sharedQueries: linkedShared,
                demandQueries: linkedDemand,
                match: {
                    ownedUrl: pair.owned.facts.url,
                    landscapeReportId: match.landscapeReportId,
                    landscapeOpportunityId: match.landscapeOpportunityId,
                    suggestionId: match.suggestionId,
                    keywordEvidence: match.keywordEvidence,
                },
            };
            return { owned: pair.owned.facts, competitor };
        });
        let findings: CompetitorContentFindings;
        try {
            findings = compareReviewedPairs(pairedInputs, collectResult.partialDomains, comparingDoc.keyword ?? null);
        }
        catch {
            deps.logger.error({ runId: payload.runId }, 'competitor-content processor: comparison failed; run failed');
            await finalize({
                db: deps.db,
                payload,
                status: 'failed',
                category: 'comparison_failed',
                messageKey: 'contentIntelligence.competitorContent.errors.comparisonFailed',
                now,
            });
            return;
        }
        // Optional AI explanation — deterministic findings are complete without it.
        const ai = await runAiComparison(deps, comparingDoc, collectResult.owned.facts, collectResult.competitors, aiBudgetMicros, costCeilingMicros);
        findings.aiExplanation = ai.explanation;
        // Degradation warnings.
        if (collectResult.completion === 'partial' || collectResult.competitorsFailed > 0) {
            addWarning(comparingDoc, 'competitor_partial', 'contentIntelligence.competitorContent.warnings.partialPortfolio');
        }
        if (collectResult.completion === 'budget' || collectResult.completion === 'quota') {
            addWarning(comparingDoc, 'competitor_stopped_early', 'contentIntelligence.competitorContent.warnings.stoppedEarly');
        }
        comparingDoc.set('findings', findings);
        comparingDoc.markModified('findings');
        comparingDoc.aiCostMicros = Number(comparingDoc.aiCostMicros) + ai.aiCostMicros;
        comparingDoc.costMicros = Number(comparingDoc.costMicros) + ai.aiCostMicros;
        await comparingDoc.save();
        const complete = collectResult.completion === 'complete' &&
            collectResult.competitorsFailed === 0 &&
            collectResult.partialDomains.length === 0;
        await finalize({
            db: deps.db,
            payload,
            status: complete ? 'completed' : 'partial',
            now,
        });
        deps.logger.info({ runId: payload.runId, status: complete ? 'completed' : 'partial' }, 'competitor-content processor: run finished');
    };
}
