/**
 * Content inventory + cannibalization — worker processor.
 *
 * Orchestrates one inventory run:
 *
 *   queued → crawling → analyzing → completed | partial | failed | cancelled
 *
 * Invariants:
 *   1. The payload is re-validated via `parseConsumedPayload` so a malformed
 *      job goes straight to the dead-letter queue as an `UnrecoverableError`.
 *   2. Terminal runs are no-ops on replay — the worker never re-executes work
 *      that reached a terminal state, and a concurrent cancel between stages is
 *      re-checked at every boundary.
 *   3. Ownership is re-verified at consume time (`{ _id, accountId }`).
 *   4. Pages persist INCREMENTALLY as the crawler yields them (derived facts +
 *      a sanitized 7-day-TTL excerpt — never raw HTML), and a single bad page
 *      never aborts the run.
 *   5. The deterministic analysis (`analyzeInventory`) needs NO AI. The optional
 *      `opportunity_explanation` pass is bounded by an AI sub-budget + the
 *      overall ceiling and is skipped-with-a-warning on budget/failure — the
 *      findings are complete without it.
 *   6. Every terminal stop records one lifecycle event, idempotent by the
 *      events unique `(reservationKey, kind)` index.
 *
 * SEC-REDACT: crawled + AI-generated text NEVER reaches the logger — only ids,
 * statuses, codes, and counts are logged.
 */
import type { Job, Processor } from 'bullmq';
import type { Logger } from 'pino';
import type { ContentSourceProvider } from '../../shared/providers/content-source.js';
import type { PublicUrlResolver } from '../../shared/security/url-safety.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
import { resolveAiTaskProfile } from '../../shared/ai-profiles/index.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { contentInventoryJobSchema, parseConsumedPayload, type ContentInventoryJob, } from '../../shared/queue/index.js';
import { ContentInventoryPage, ContentInventoryRun, ContentInventorySnapshot, type ContentInventoryErrorCategory, type ContentInventoryRunHydrated, type ContentInventoryStatus, } from './inventory.model.js';
import { assertContentInventoryTransition, isInventoryTerminalStatus, } from './inventory.state.js';
import { recordContentInventoryEvent } from './inventory.events.js';
import { crawlInventory } from './inventory.crawler.js';
import { loadInventoryEvidence } from './inventory.evidence.js';
import { analyzeInventory } from './inventory.analysis.js';
import { inventoryPageFactsSchema, type InventoryFindings, type InventoryPageFacts, } from './inventory.schemas.js';
const HTML_MARKER_TEST = /<\/?script\b|<\/?iframe\b|<!doctype/i;
const HTML_MARKER = /<\/?script\b|<\/?iframe\b|<!doctype/gi;
export function stripHtmlMarkers(input: string): string {
    let out = input;
    for (let pass = 0; pass < 5 && HTML_MARKER_TEST.test(out); pass += 1) {
        out = out.replace(HTML_MARKER, '');
    }
    return HTML_MARKER_TEST.test(out) ? out.replace(/[<>]/g, ' ') : out;
}
export interface ContentInventoryProcessorDeps {
    db: ApplicationDb;
    contentSource: ContentSourceProvider;
    ai: AiProfileRunner;
    aiProviderOrder: readonly AiGenerationProviderKey[];
    logger: Logger;
    /** Test seams — literal defaults so tests never touch env. */
    now?: () => Date;
    resolver?: PublicUrlResolver;
    costCeilingMicros?: number;
    aiBudgetMicros?: number;
    snapshotTtlDays?: number;
    maxCharacters?: number;
    timeoutMs?: number;
    crawlDepth?: number;
    crawlConcurrency?: number;
}
export function addWarning(doc: ContentInventoryRunHydrated, code: string, messageKey: string): void {
    if (doc.warnings.some((w) => w.code === code))
        return;
    doc.warnings.push({ code, messageKey });
}
/** Advance a non-terminal run to `next`; returns the fresh doc or null when the
 *  run went terminal (concurrent cancel) / disappeared. */
export async function advance(runId: string, next: ContentInventoryStatus, now: () => Date): Promise<ContentInventoryRunHydrated | null> {
    const doc = await ContentInventoryRun.findById(runId);
    if (!doc || isInventoryTerminalStatus(doc.status))
        return null;
    if (doc.status === next)
        return doc;
    assertContentInventoryTransition(doc.status, next);
    const at = now();
    const idx = doc.stages.findIndex((s) => s.name === doc.status && s.completedAt === null);
    if (idx >= 0)
        doc.stages[idx]!.completedAt = at;
    doc.stages.push({ name: next, startedAt: at, completedAt: null, error: null });
    doc.status = next;
    if (next === 'crawling' && !doc.startedAt)
        doc.startedAt = at;
    await doc.save();
    return doc;
}
interface FinalizeInput {
    db: ApplicationDb;
    payload: ContentInventoryJob;
    status: 'completed' | 'partial' | 'failed' | 'cancelled';
    category?: ContentInventoryErrorCategory;
    messageKey?: string;
    now: () => Date;
}
/**
 * Terminal transition + event. Idempotent: a concurrent terminal winner
 * short-circuits, and the event write is a no-op under replay.
 */
export async function finalize(input: FinalizeInput): Promise<void> {
    const doc = await ContentInventoryRun.findById(input.payload.runId);
    if (!doc || isInventoryTerminalStatus(doc.status))
        return;
    assertContentInventoryTransition(doc.status, input.status);
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
    await recordContentInventoryEvent(input.db, {
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
/** Load the persisted per-page derived facts for the deterministic analysis. */
async function loadPersistedFacts(runId: string, accountId: string): Promise<InventoryPageFacts[]> {
    const rows = await ContentInventoryPage.find({ runId, accountId }).sort({ url: 1 });
    return rows.flatMap((row) => {
        const parsed = inventoryPageFactsSchema.safeParse(row.facts);
        return parsed.success ? [parsed.data] : [];
    });
}
/**
 * Optional plain-language explanation. Budget-gated and failure-tolerant — the
 * findings are already complete, so a skip only adds a warning.
 */
async function runOpportunityExplanation(deps: ContentInventoryProcessorDeps, doc: ContentInventoryRunHydrated, findings: InventoryFindings, aiBudgetMicros: number, costCeilingMicros: number): Promise<{
    explanation: string | null;
    aiCostMicros: number;
}> {
    const profile = resolveAiTaskProfile('opportunity_explanation');
    const worstCase = Number(profile.maxCostMicros);
    const spentAi = Number(doc.aiCostMicros);
    const spentTotal = Number(doc.costMicros);
    if (spentAi + worstCase > aiBudgetMicros || spentTotal + worstCase > costCeilingMicros) {
        addWarning(doc, 'inventory_explanation_skipped', 'contentIntelligence.inventory.warnings.explanationSkipped');
        return { explanation: null, aiCostMicros: 0 };
    }
    const sources = [
        ...findings.cannibalization.slice(0, 10).map((c) => ({ id: c.id, text: c.query })),
        ...findings.gaps.slice(0, 10).map((g) => ({ id: g.id, text: g.query })),
    ].slice(0, 20);
    const derivedFacts = JSON.stringify({
        clusters: findings.clusters.length,
        duplicates: findings.duplicates.length,
        thinPages: findings.thinPages.length,
        orphanPages: findings.orphanPages.length,
        cannibalization: findings.cannibalization.map((c) => ({ query: c.query, confidence: c.confidence })),
        gaps: findings.gaps.map((g) => ({ query: g.query, confidence: g.confidence })),
    }).slice(0, 12000);
    try {
        const result = await deps.ai.run<{
            explanation: string;
            citations: string[];
        }>({
            profile: 'opportunity_explanation',
            locale: doc.locale,
            correlationId: `content-inventory-${String(doc._id)}`,
            usage: {
                accountId: String(doc.accountId),
                siteId: String(doc.siteId),
                jobId: String(doc._id),
            },
            configuredProviderOrder: deps.aiProviderOrder,
            input: { derivedFacts, sources },
        });
        const explanation = stripHtmlMarkers(result.object.explanation).slice(0, 6000);
        const aiCostMicros = Number(result.provenance.actualOrEstimatedCostMicros ?? 0n);
        return { explanation: explanation.trim().length > 0 ? explanation : null, aiCostMicros };
    }
    catch {
        addWarning(doc, 'inventory_explanation_skipped', 'contentIntelligence.inventory.warnings.explanationSkipped');
        return { explanation: null, aiCostMicros: 0 };
    }
}
export function createContentInventoryProcessor(deps: ContentInventoryProcessorDeps): Processor<ContentInventoryJob, void> {
    const now = deps.now ?? (() => new Date());
    const costCeilingMicros = deps.costCeilingMicros ?? 250000;
    const aiBudgetMicros = deps.aiBudgetMicros ?? 140000;
    const snapshotTtlDays = deps.snapshotTtlDays ?? 7;
    const maxCharacters = deps.maxCharacters ?? 50000;
    const timeoutMs = deps.timeoutMs ?? 120000;
    const crawlDepth = deps.crawlDepth ?? 2;
    const crawlConcurrency = deps.crawlConcurrency ?? 3;
    return async (job: Job<ContentInventoryJob>) => {
        const payload = parseConsumedPayload(contentInventoryJobSchema, job.data);
        const run = await ContentInventoryRun.findOne({
            _id: payload.runId,
            accountId: payload.accountId,
        });
        if (!run) {
            deps.logger.warn({ runId: payload.runId, accountId: payload.accountId }, 'content-inventory processor: run not found; dropping job');
            return;
        }
        if (isInventoryTerminalStatus(run.status)) {
            deps.logger.info({ runId: payload.runId, status: run.status }, 'content-inventory processor: terminal run on replay; no-op');
            return;
        }
        // Stage 1 — crawling.
        const crawlingDoc = await advance(payload.runId, 'crawling', now);
        if (!crawlingDoc)
            return;
        // Persist each admitted page incrementally (derived facts + TTL excerpt).
        const persistPage = async (page: {
            facts: InventoryPageFacts;
            excerpt: string;
            contentHash: string;
        }): Promise<void> => {
            try {
                await ContentInventoryPage.updateOne({ runId: run._id, url: page.facts.url }, {
                    $set: {
                        accountId: payload.accountId,
                        siteId: payload.siteId,
                        facts: page.facts,
                        contentHash: page.contentHash,
                        createdAtMs: now().getTime(),
                    },
                }, { upsert: true });
                const excerpt = stripHtmlMarkers(page.excerpt).trim();
                if (excerpt.length > 0) {
                    const retrievedAt = now();
                    await ContentInventorySnapshot.create({
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
                // A single page-persist failure must never abort the crawl.
                deps.logger.warn({ runId: payload.runId }, 'content-inventory processor: page persist failed; continuing');
            }
        };
        let crawlResult;
        try {
            crawlResult = await crawlInventory({
                origin: run.origin,
                pageLimit: run.input.pageLimit,
                allowedPaths: run.input.allowedPaths,
                excludedPaths: run.input.excludedPaths,
                sitemapSeeds: run.input.sitemapSeeds,
            }, {
                maxCharacters,
                timeoutMs,
                costCeilingMicros,
                depth: crawlDepth,
                concurrency: crawlConcurrency,
            }, {
                contentSource: deps.contentSource,
                ...(deps.resolver ? { resolver: deps.resolver } : {}),
                now: () => now().getTime(),
                onPage: persistPage,
                logger: deps.logger,
            });
        }
        catch {
            deps.logger.error({ runId: payload.runId }, 'content-inventory processor: crawl failed; run failed');
            await finalize({
                db: deps.db,
                payload,
                status: 'failed',
                category: 'crawl_failed',
                messageKey: 'contentIntelligence.inventory.errors.crawlFailed',
                now,
            });
            return;
        }
        // A user may have cancelled while the crawl ran — respect the terminal state.
        const afterCrawl = await ContentInventoryRun.findById(payload.runId);
        if (!afterCrawl || isInventoryTerminalStatus(afterCrawl.status))
            return;
        afterCrawl.progress.pagesProcessed = crawlResult.pagesProcessed;
        afterCrawl.progress.pagesFailed = crawlResult.pagesFailed;
        afterCrawl.costMicros = crawlResult.costMicros;
        await afterCrawl.save();
        if (crawlResult.completion === 'cancelled') {
            await finalize({
                db: deps.db,
                payload,
                status: 'cancelled',
                category: 'cancelled',
                messageKey: 'contentIntelligence.inventory.errors.cancelledByUser',
                now,
            });
            return;
        }
        if (crawlResult.pagesProcessed === 0) {
            await finalize({
                db: deps.db,
                payload,
                status: 'failed',
                category: 'no_pages_crawled',
                messageKey: 'contentIntelligence.inventory.errors.noPages',
                now,
            });
            return;
        }
        // Stage 2 — analyzing (deterministic; no AI required).
        const analyzingDoc = await advance(payload.runId, 'analyzing', now);
        if (!analyzingDoc)
            return;
        const facts = await loadPersistedFacts(payload.runId, payload.accountId);
        const evidence = await loadInventoryEvidence(deps.db, {
            accountId: payload.accountId,
            siteId: payload.siteId,
        });
        let findings: InventoryFindings;
        try {
            findings = analyzeInventory(facts, evidence);
        }
        catch {
            deps.logger.error({ runId: payload.runId }, 'content-inventory processor: analysis failed; run failed');
            await finalize({
                db: deps.db,
                payload,
                status: 'failed',
                category: 'analysis_failed',
                messageKey: 'contentIntelligence.inventory.errors.analysisFailed',
                now,
            });
            return;
        }
        // Optional AI explanation — findings are already complete without it.
        const explanation = await runOpportunityExplanation(deps, analyzingDoc, findings, aiBudgetMicros, costCeilingMicros);
        findings.opportunityExplanation = explanation.explanation;
        // Degradation warnings.
        if (crawlResult.completion === 'partial' || crawlResult.pagesFailed > 0) {
            addWarning(analyzingDoc, 'inventory_partial_crawl', 'contentIntelligence.inventory.warnings.partialCrawl');
        }
        if (crawlResult.completion === 'budget' || crawlResult.completion === 'quota') {
            addWarning(analyzingDoc, 'inventory_stopped_early', 'contentIntelligence.inventory.warnings.stoppedEarly');
        }
        if (evidence.gscByUrl.size === 0) {
            addWarning(analyzingDoc, 'inventory_evidence_missing', 'contentIntelligence.inventory.warnings.evidenceMissing');
        }
        analyzingDoc.set('findings', findings);
        analyzingDoc.markModified('findings');
        analyzingDoc.aiCostMicros = Number(analyzingDoc.aiCostMicros) + explanation.aiCostMicros;
        analyzingDoc.costMicros = Number(analyzingDoc.costMicros) + explanation.aiCostMicros;
        await analyzingDoc.save();
        const complete = crawlResult.completion === 'complete' && crawlResult.pagesFailed === 0;
        await finalize({
            db: deps.db,
            payload,
            status: complete ? 'completed' : 'partial',
            now,
        });
        deps.logger.info({ runId: payload.runId, status: complete ? 'completed' : 'partial' }, 'content-inventory processor: run finished');
    };
}
