/**
 * Audience Research pipeline.
 *
 * State machine (locked): queued → discovering → selecting → collecting →
 * clustering → completed | partial | failed.
 *
 * Load-bearing invariants:
 *   1. Cost stops — the pipeline halts before starting any paid stage whose
 *      configured worst-case cost would push actual-so-far past the
 *      250_000-micro direct-cost ceiling (140_000-micro AI sub-budget).
 *   2. Crash-safe AI dispatch — the clustering pass claims a stable
 *      idempotency key (sha256(runId|profileVersion)) via atomic Mongo update
 *      BEFORE dispatch. A worker replay that finds `claimedAt != null` but
 *      `resolvedAt == null` short-circuits to `partial` with reason code
 *      `ai_dispatch_indeterminate` — never a second paid dispatch.
 *   3. Privacy — raw HTML / full-text / vendor envelopes / prompts / model
 *      output NEVER touch persistence. Only bounded metadata + 500-char
 *      output-encoded excerpts + `contentHash` land on the Mongo doc.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { UnrecoverableError } from 'bullmq';
import type { ContentSourceProvider, ScrapePageResult, } from '../../shared/providers/content-source.js';
import type { PublicPageDiscoveryResult, PublicPageDiscoveryRow, RankProvider, } from '../../shared/providers/types.js';
import type { SiteMarket } from '../../shared/observations/types.js';
import { isSupportedLocale, type SupportedLocale, } from '../../shared/i18n/locales.js';
import { VendorMalformedError, VendorQuotaError, VendorTimeoutError, VendorUnavailableError, } from '../../shared/providers/errors.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { AiInvalidInputError, AiMalformedOutputError, type AiGenerationProviderKey, } from '../../shared/providers/ai-generation.js';
import { AudienceResearchRun, type AudienceResearchRunDocument, type AudienceResearchRunHydrated, } from './audience-research.model.js';
import { assertTransition, isTerminal, type AudienceResearchState } from './audience-research.state.js';
import { generateQueries, PER_QUERY_LIMIT } from './query-templates.js';
import { selectCandidates, dedupeByContentHash, MAX_CANDIDATES } from './selection.js';
import { computeConfidence } from './confidence.js';
import { buildEvidenceExcerpt } from './excerpt.js';
import { assertPublicUrlSafe, UnsafeUrlError } from '../../shared/security/url-safety.js';
export const AI_CLUSTER_PROFILE_NAME = 'audience_research_cluster' as const;
export const AI_CLUSTER_PROFILE_VERSION = '1.0.0';
/** Runtime hard ceilings. */
export const TOTAL_COST_CEILING_MICROS = 250000;
export const AI_COST_CEILING_MICROS = 140000;
/** Vendor cost estimates used for worst-case pre-flight checks. */
export const DISCOVERY_COST_PER_QUERY_MICROS = 750;
export const COLLECT_COST_PER_PAGE_MICROS = 3000;
export const AI_CALL_ESTIMATE_MICROS = 5000;
/** Firecrawl request bounds. */
const FIRECRAWL_TIMEOUT_MS = 30000;
const FIRECRAWL_MAX_CHARS = 24000;
const FIRECRAWL_FORMATS = ['markdown', 'metadata'] as const;
const SOURCE_ID_PREFIX = 'src-';
export interface AudienceResearchPipelineDeps {
    rankProvider: RankProvider;
    contentSource: ContentSourceProvider;
    aiRunner: AiProfileRunner;
    aiProviderOrder: readonly AiGenerationProviderKey[];
    logger: Logger;
    /** Test seams. */
    now?: () => Date;
    urlSafety?: (url: string) => Promise<void> | void;
}
export interface RunAudienceResearchPipelineInput {
    runId: string;
    accountId: string;
    siteId: string;
    outputLocale: SupportedLocale;
}
export interface RunAudienceResearchPipelineResult {
    terminal: 'completed' | 'partial' | 'failed';
    reasonCode: string;
    sourceCount: number;
    signalCount: number;
}
interface StageBudget {
    actualSoFar: number;
    aiSoFar: number;
}
function remainingTotal(budget: StageBudget): number {
    return Math.max(0, TOTAL_COST_CEILING_MICROS - budget.actualSoFar);
}
function remainingAi(budget: StageBudget): number {
    return Math.max(0, AI_COST_CEILING_MICROS - budget.aiSoFar);
}
function sourceIdFor(index: number): string {
    return `${SOURCE_ID_PREFIX}${String(index + 1).padStart(3, '0')}`;
}
/**
 * Mongoose hands back a hydrated SUBDOCUMENT for `run.input.siteMarket`, not
 * a plain object: it carries `$__`, `_doc`, `save`, … as own properties.
 * Provider inputs are parsed by strict zod schemas, which reject every one of
 * those as an unrecognized key — the whole job then dead-lettered before a
 * single query ran. Project the five contract fields explicitly.
 */
function toPlainSiteMarket(value: unknown): SiteMarket {
    const market = (value ?? {}) as Partial<SiteMarket>;
    return {
        country: String(market.country ?? ''),
        region: market.region ?? null,
        city: market.city ?? null,
        language: String(market.language ?? ''),
        device: market.device ?? 'all',
    };
}
async function safeUrl(deps: AudienceResearchPipelineDeps, url: string): Promise<boolean> {
    try {
        if (deps.urlSafety) {
            await deps.urlSafety(url);
        }
        else {
            await assertPublicUrlSafe(url);
        }
        return true;
    }
    catch (err) {
        if (err instanceof UnsafeUrlError)
            return false;
        // Any other unexpected error is treated as an unsafe URL — err on the safe
        // side per the SSRF rule.
        return false;
    }
}
/**
 * Advance the workflow document to the next stage. Idempotent — same-stage
 * re-entry is a no-op (a worker replay may resume the current stage).
 */
async function advanceStage(runId: string, next: AudienceResearchState, now: Date): Promise<AudienceResearchRunHydrated | null> {
    const doc = await AudienceResearchRun.findById(runId);
    if (!doc)
        return null;
    if (isTerminal(doc.state as AudienceResearchState))
        return doc;
    if (doc.state === next)
        return doc;
    assertTransition(doc.state as AudienceResearchState, next);
    doc.state = next;
    if (next === 'discovering' && !doc.startedAt) {
        doc.startedAt = now;
    }
    await doc.save();
    return doc;
}
/**
 * Record one ledger entry. Never records URLs, prompts, tokens,
 * excerpts, headers, task ids — only operation name, integer counts,
 * micro-cost, timestamps, outcome.
 */
async function appendLedger(runId: string, entry: {
    stage: 'discovery' | 'collect' | 'cluster';
    operationCounts: Record<string, number>;
    estimatedCostMicros: number;
    actualCostMicros: number;
    startedAt: Date;
    endedAt: Date;
    outcome: 'ok' | 'ceiling_stop' | 'provider_error' | 'unavailable';
}): Promise<void> {
    await AudienceResearchRun.updateOne({ _id: runId }, {
        $push: {
            costLedger: entry,
        },
    });
}
interface DiscoveryOutcome {
    rows: PublicPageDiscoveryRow[];
    cost: number;
    outcome: 'ok' | 'ceiling_stop' | 'provider_error' | 'unavailable';
    queries: ReturnType<typeof generateQueries>;
}
/**
 * A stage that ended on a vendor fault must surface as `processing_failure`,
 * never as `no_usable_public_evidence` — a transient outage is not proof the
 * user's niche has no public evidence (production regression 2026-07-20).
 */
function isVendorFault(outcome: 'ok' | 'ceiling_stop' | 'provider_error' | 'unavailable'): boolean {
    return outcome === 'unavailable' || outcome === 'provider_error';
}
async function runDiscovery(runId: string, doc: AudienceResearchRunDocument, deps: AudienceResearchPipelineDeps, budget: StageBudget): Promise<DiscoveryOutcome> {
    const queries = generateQueries({
        seedTopics: doc.input.seedTopics ?? [],
        competitorDomains: doc.input.competitorDomains ?? [],
    });
    if (queries.length === 0) {
        return { rows: [], cost: 0, outcome: 'ok', queries };
    }
    const worstCase = queries.length * DISCOVERY_COST_PER_QUERY_MICROS;
    if (worstCase > remainingTotal(budget)) {
        return { rows: [], cost: 0, outcome: 'ceiling_stop', queries };
    }
    try {
        const result: PublicPageDiscoveryResult = await deps.rankProvider.searchPublicPages({
            queries: queries.map((q) => ({ id: q.id, text: q.text })),
            siteMarket: toPlainSiteMarket(doc.input.siteMarket),
            perQueryLimit: PER_QUERY_LIMIT,
        });
        // Direct-cost estimate is deterministic per query; adapters that surface
        // real cost via a captured ledger will refine this in a later prompt.
        const cost = queries.length * DISCOVERY_COST_PER_QUERY_MICROS;
        return { rows: result.rows, cost, outcome: 'ok', queries };
    }
    catch (err) {
        if (err instanceof VendorQuotaError ||
            err instanceof VendorTimeoutError ||
            err instanceof VendorUnavailableError) {
            deps.logger.warn({ runId, error: (err as Error).name }, 'audience-research discovery vendor outage');
            return { rows: [], cost: 0, outcome: 'unavailable', queries };
        }
        if (err instanceof VendorMalformedError) {
            deps.logger.warn({ runId, error: err.name }, 'audience-research discovery provider error');
            return { rows: [], cost: 0, outcome: 'provider_error', queries };
        }
        throw err;
    }
}
interface CollectedSource {
    sourceId: string;
    canonicalUrl: string;
    title: string;
    sourceType: 'forum' | 'review' | 'comparison' | 'question' | 'other';
    registrableDomain: string;
    observedAt: string | null;
    contentHash: string;
    excerpt: string;
    discoveryQueryIds: string[];
    observationMeta: unknown;
}
interface CollectOutcome {
    sources: CollectedSource[];
    cost: number;
    outcome: 'ok' | 'ceiling_stop' | 'provider_error' | 'unavailable';
    scraped: number;
}
async function runCollect(candidates: ReturnType<typeof selectCandidates>, discoveryRows: readonly PublicPageDiscoveryRow[], deps: AudienceResearchPipelineDeps, budget: StageBudget): Promise<CollectOutcome> {
    const rowByCanonical = new Map<string, PublicPageDiscoveryRow>();
    for (const r of discoveryRows)
        rowByCanonical.set(r.canonicalUrl, r);
    const sources: CollectedSource[] = [];
    let cost = 0;
    let scraped = 0;
    let outcome: CollectOutcome['outcome'] = 'ok';
    for (let i = 0; i < Math.min(candidates.length, MAX_CANDIDATES); i += 1) {
        const c = candidates[i]!;
        // Reserve AI sub-budget before every collect attempt so a downstream
        // clustering pass always has room to run.
        const totalHeadroom = remainingTotal(budget) - remainingAi(budget);
        if (COLLECT_COST_PER_PAGE_MICROS > totalHeadroom) {
            outcome = 'ceiling_stop';
            break;
        }
        if (!(await safeUrl(deps, c.canonicalUrl))) {
            // Skip an SSRF-blocked URL silently — never fetch, never bill.
            continue;
        }
        let scrape: ScrapePageResult;
        try {
            scrape = await deps.contentSource.scrapePage({
                url: c.canonicalUrl,
                formats: [...FIRECRAWL_FORMATS],
                timeoutMs: FIRECRAWL_TIMEOUT_MS,
                maxCharacters: FIRECRAWL_MAX_CHARS,
            });
        }
        catch (err) {
            if (err instanceof VendorQuotaError ||
                err instanceof VendorTimeoutError ||
                err instanceof VendorUnavailableError) {
                outcome = 'unavailable';
                break;
            }
            if (err instanceof VendorMalformedError) {
                // Skip this URL, keep going.
                continue;
            }
            throw err;
        }
        scraped += 1;
        const spent = Number(scrape.usage?.estimatedCostMicros ?? 0n) || COLLECT_COST_PER_PAGE_MICROS;
        cost += spent;
        budget.actualSoFar += spent;
        const bodyText = scrape.document?.text ?? scrape.document?.markdown ?? '';
        if (bodyText.length === 0)
            continue;
        const excerpt = buildEvidenceExcerpt(bodyText);
        const contentHash = scrape.document?.contentHash ??
            createHash('sha256').update(bodyText).digest('hex');
        const originRow = rowByCanonical.get(c.canonicalUrl);
        const observationMeta = originRow?.observationMeta ?? null;
        const collected: CollectedSource = {
            sourceId: sourceIdFor(sources.length),
            canonicalUrl: c.canonicalUrl,
            title: c.title,
            sourceType: c.sourceType,
            registrableDomain: c.registrableDomain,
            observedAt: c.observedAt,
            contentHash,
            excerpt,
            discoveryQueryIds: c.discoveryQueryIds,
            observationMeta,
        };
        sources.push(collected);
        if (sources.length >= MAX_CANDIDATES) {
            break;
        }
    }
    const deduped = dedupeByContentHash(sources).map((s, idx) => ({
        ...s,
        sourceId: sourceIdFor(idx),
    }));
    return { sources: deduped, cost, outcome, scraped };
}
interface ClusterInputSource {
    id: string;
    title: string;
    sourceType: 'forum' | 'review' | 'comparison' | 'question' | 'other';
    observedAt: string | null;
    excerpt: string;
}
interface ClusterAiOutput {
    signals: Array<{
        type: 'complaint' | 'request' | 'question' | 'competitor_gap';
        title: string;
        summary: string;
        suggestedRoute: 'content' | 'comparison_page' | 'product' | 'seo';
        citedSourceIds: string[];
    }>;
    citations: string[];
}
interface ClusterOutcome {
    signals: Array<{
        signalId: string;
        type: ClusterAiOutput['signals'][number]['type'];
        title: string;
        summary: string;
        suggestedRoute: ClusterAiOutput['signals'][number]['suggestedRoute'];
        citedSourceIds: string[];
        independentDomainCount: number;
        sourceTypeCount: number;
        mostRecentSourceObservedAt: string | null;
        confidence: 'high' | 'medium' | 'low';
    }>;
    cost: number;
    outcome: 'ok' | 'ceiling_stop' | 'provider_error' | 'unavailable';
    dispatched: boolean;
    digest: string | null;
}
async function runClustering(runId: string, doc: AudienceResearchRunHydrated, sources: readonly CollectedSource[], deps: AudienceResearchPipelineDeps, now: Date, budget: StageBudget, outputLocale: SupportedLocale): Promise<ClusterOutcome> {
    // `sources` is guaranteed non-empty: the only caller finalizes the run as
    // `no_usable_public_evidence` before clustering when collect retained none.
    if (remainingAi(budget) < AI_CALL_ESTIMATE_MICROS) {
        return { signals: [], cost: 0, outcome: 'ceiling_stop', dispatched: false, digest: null };
    }
    const idempotencyKey = createHash('sha256')
        .update(`${runId}|${AI_CLUSTER_PROFILE_VERSION}`)
        .digest('hex');
    // Crash-safe single-dispatch claim. Atomic Mongo update — only
    // the first caller with `claimedAt: null` wins the claim; every retry after
    // dispatch sees `claimedAt != null` and short-circuits.
    const claimed = await AudienceResearchRun.updateOne({
        _id: runId,
        $or: [
            { 'aiClustering.claimedAt': null },
            { 'aiClustering.claimedAt': { $exists: false } },
        ],
    }, {
        $set: {
            'aiClustering.claimedAt': now,
            'aiClustering.idempotencyKey': idempotencyKey,
            'aiClustering.profileVersion': AI_CLUSTER_PROFILE_VERSION,
        },
    });
    if (claimed.matchedCount === 0) {
        // Someone else already claimed. If they RESOLVED, mirror their result;
        // otherwise this is the ambiguous crash window.
        const reload = await AudienceResearchRun.findById(runId);
        if (!reload) {
            return { signals: [], cost: 0, outcome: 'provider_error', dispatched: false, digest: null };
        }
        if (reload.aiClustering?.resolvedAt) {
            return {
                signals: (reload.signals ?? []).map((s) => ({
                    signalId: s.signalId,
                    type: s.type as ClusterAiOutput['signals'][number]['type'],
                    title: s.title,
                    summary: s.summary,
                    suggestedRoute: s.suggestedRoute as ClusterAiOutput['signals'][number]['suggestedRoute'],
                    citedSourceIds: [...(s.citedSourceIds ?? [])],
                    independentDomainCount: Number(s.independentDomainCount ?? 0),
                    sourceTypeCount: Number(s.sourceTypeCount ?? 0),
                    mostRecentSourceObservedAt: s.mostRecentSourceObservedAt ?? null,
                    confidence: s.confidence as 'high' | 'medium' | 'low',
                })),
                cost: 0,
                outcome: 'ok',
                dispatched: false,
                digest: reload.aiClustering.resultDigest ?? null,
            };
        }
        // Ambiguous crash window — DO NOT dispatch again. Signal callers to
        // terminate as `partial` with `ai_dispatch_indeterminate`.
        return {
            signals: [],
            cost: 0,
            outcome: 'provider_error',
            dispatched: false,
            digest: null,
        };
    }
    const aiInput = {
        market: {
            country: String((doc.input?.siteMarket as {
                country?: string;
            })?.country ?? ''),
            language: String((doc.input?.siteMarket as {
                language?: string;
            })?.language ?? ''),
        },
        sources: sources.map<ClusterInputSource>((s) => ({
            id: s.sourceId,
            title: s.title,
            sourceType: s.sourceType,
            observedAt: s.observedAt,
            excerpt: s.excerpt,
        })),
    };
    let generation;
    try {
        generation = await deps.aiRunner.run<ClusterAiOutput>({
            profile: AI_CLUSTER_PROFILE_NAME,
            input: aiInput,
            locale: outputLocale,
            correlationId: `ar-cluster-${randomUUID()}`,
            usage: { accountId: String(doc.accountId), siteId: String(doc.siteId), jobId: runId },
            configuredProviderOrder: deps.aiProviderOrder,
        });
    }
    catch (err) {
        if (err instanceof AiMalformedOutputError || err instanceof AiInvalidInputError) {
            return { signals: [], cost: 0, outcome: 'provider_error', dispatched: true, digest: null };
        }
        return { signals: [], cost: 0, outcome: 'unavailable', dispatched: true, digest: null };
    }
    const cost = Number(generation.provenance.actualOrEstimatedCostMicros ?? 0n);
    budget.aiSoFar += cost;
    budget.actualSoFar += cost;
    const sourceById = new Map(sources.map((s) => [s.sourceId, s] as const));
    const validSignals: ClusterOutcome['signals'] = [];
    let signalOrdinal = 0;
    for (const s of generation.object.signals) {
        const cited = Array.from(new Set(s.citedSourceIds)).filter((id) => sourceById.has(id));
        if (cited.length === 0)
            continue;
        // Membership was just filtered above, so every lookup resolves. The
        // source already carries the classifier's verdict from selection, so the
        // context is a projection — no second URL parse, no fallbacks that could
        // never fire.
        const citedContext = cited.map((id) => {
            const source = sourceById.get(id)!;
            return {
                registrableDomain: source.registrableDomain,
                sourceType: source.sourceType,
                observedAt: source.observedAt,
            };
        });
        const confidence = computeConfidence({
            citedSources: citedContext,
            runCreatedAt: (doc.createdAt as Date) ?? now,
        });
        signalOrdinal += 1;
        validSignals.push({
            signalId: `sig-${String(signalOrdinal).padStart(3, '0')}`,
            type: s.type,
            title: s.title.slice(0, 120),
            summary: buildEvidenceExcerpt(s.summary),
            suggestedRoute: s.suggestedRoute,
            citedSourceIds: cited,
            independentDomainCount: confidence.independentDomainCount,
            sourceTypeCount: confidence.sourceTypeCount,
            mostRecentSourceObservedAt: confidence.mostRecentSourceObservedAt,
            confidence: confidence.confidence,
        });
    }
    const digest = createHash('sha256')
        .update(JSON.stringify({ signals: validSignals }))
        .digest('hex');
    await AudienceResearchRun.updateOne({ _id: runId }, {
        $set: {
            'aiClustering.resolvedAt': now,
            'aiClustering.resultDigest': digest,
        },
    });
    return { signals: validSignals, cost, outcome: 'ok', dispatched: true, digest };
}
/**
 * Run one audience-research job end-to-end. Idempotent under BullMQ replay:
 *   - a terminal run returns early;
 *   - the state machine forbids backward transitions;
 *   - the AI dispatch claim guarantees at most ONE paid AI call per run.
 */
export async function runAudienceResearchPipeline(input: RunAudienceResearchPipelineInput, deps: AudienceResearchPipelineDeps): Promise<RunAudienceResearchPipelineResult> {
    const now = deps.now ?? (() => new Date());
    const loaded = await AudienceResearchRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
        siteId: input.siteId,
    });
    if (!loaded) {
        throw new UnrecoverableError(`audience-research pipeline: run not found or ownership mismatch (${input.runId})`);
    }
    if (isTerminal(loaded.state as AudienceResearchState)) {
        return terminalMirror(loaded);
    }
    if (!isSupportedLocale(loaded.input?.outputLocale) ||
        loaded.input.outputLocale !== input.outputLocale) {
        throw new UnrecoverableError(`audience-research pipeline: invalid frozen output locale (${input.runId})`);
    }
    const budget: StageBudget = {
        actualSoFar: (loaded.costLedger ?? []).reduce((sum, e) => sum + Number(e.actualCostMicros ?? 0), 0),
        aiSoFar: (loaded.costLedger ?? [])
            .filter((e) => e.stage === 'cluster')
            .reduce((sum, e) => sum + Number(e.actualCostMicros ?? 0), 0),
    };
    // ---- Discovering ------------------------------------------------------
    let doc = await advanceStage(input.runId, 'discovering', now());
    if (!doc) {
        throw new UnrecoverableError(`audience-research pipeline: run vanished mid-run (${input.runId})`);
    }
    if (isTerminal(doc.state as AudienceResearchState)) {
        return terminalMirror(doc);
    }
    const stageStart = now();
    const discovery = await runDiscovery(input.runId, doc, deps, budget);
    budget.actualSoFar += discovery.cost;
    await AudienceResearchRun.updateOne({ _id: input.runId }, {
        $set: {
            'discovery.queries': discovery.queries,
            'discovery.resultCount': discovery.rows.length,
            'discovery.costMicros': discovery.cost,
        },
    });
    await appendLedger(input.runId, {
        stage: 'discovery',
        operationCounts: { searchPublicPages: discovery.queries.length },
        estimatedCostMicros: discovery.queries.length * DISCOVERY_COST_PER_QUERY_MICROS,
        actualCostMicros: discovery.cost,
        startedAt: stageStart,
        endedAt: now(),
        outcome: discovery.outcome,
    });
    if (discovery.rows.length === 0) {
        // Only an OK-but-empty SERP earns `no_usable_public_evidence`; a vendor
        // fault surfaces as `processing_failure` so the user retries instead of
        // trusting a false negative.
        return finalizeTerminal({
            runId: input.runId,
            terminal: 'failed',
            reasonCode: isVendorFault(discovery.outcome)
                ? 'processing_failure'
                : 'no_usable_public_evidence',
            completedAt: now(),
        });
    }
    // ---- Selecting --------------------------------------------------------
    doc = await advanceStage(input.runId, 'selecting', now());
    if (!doc || isTerminal(doc.state as AudienceResearchState)) {
        return doc ? terminalMirror(doc) : { terminal: 'failed', reasonCode: 'processing_failure', sourceCount: 0, signalCount: 0 };
    }
    const candidates = selectCandidates({
        rows: discovery.rows,
        queries: discovery.queries.map((q) => ({ id: q.id, text: q.text })),
    });
    await AudienceResearchRun.updateOne({ _id: input.runId }, {
        $set: {
            candidates: candidates.map((c) => ({
                canonicalUrl: c.canonicalUrl,
                title: c.title,
                sourceType: c.sourceType,
                registrableDomain: c.registrableDomain,
                observedAt: c.observedAt,
                organicPosition: c.organicPosition,
                discoveryQueryIds: c.discoveryQueryIds,
            })),
        },
    });
    if (candidates.length === 0) {
        return finalizeTerminal({
            runId: input.runId,
            terminal: 'failed',
            reasonCode: 'no_usable_public_evidence',
            completedAt: now(),
        });
    }
    // ---- Collecting -------------------------------------------------------
    doc = await advanceStage(input.runId, 'collecting', now());
    if (!doc || isTerminal(doc.state as AudienceResearchState)) {
        return doc ? terminalMirror(doc) : { terminal: 'failed', reasonCode: 'processing_failure', sourceCount: 0, signalCount: 0 };
    }
    const collectStart = now();
    const collected = await runCollect(candidates, discovery.rows, deps, budget);
    await AudienceResearchRun.updateOne({ _id: input.runId }, {
        $set: {
            sources: collected.sources.map((s) => ({
                sourceId: s.sourceId,
                canonicalUrl: s.canonicalUrl,
                title: s.title,
                sourceType: s.sourceType,
                registrableDomain: s.registrableDomain,
                observedAt: s.observedAt,
                contentHash: s.contentHash,
                excerpt: s.excerpt,
                observationMeta: s.observationMeta ?? {
                    sourceKind: 'vendor',
                    sourceLabel: null,
                    observedAt: collectStart.toISOString(),
                    freshUntil: null,
                    freshness: 'unknown',
                    market: null,
                    sampleCount: 1,
                    coverageNoteKey: null,
                },
                discoveryQueryIds: s.discoveryQueryIds,
            })),
        },
    });
    await appendLedger(input.runId, {
        stage: 'collect',
        operationCounts: { 'firecrawl.scrapePage': collected.scraped },
        estimatedCostMicros: candidates.length * COLLECT_COST_PER_PAGE_MICROS,
        actualCostMicros: collected.cost,
        startedAt: collectStart,
        endedAt: now(),
        outcome: collected.outcome,
    });
    if (collected.sources.length === 0) {
        // Same discrimination as the discovery terminal: a vendor fault that left
        // zero sources is a processing failure, not proof of missing evidence.
        return finalizeTerminal({
            runId: input.runId,
            terminal: 'failed',
            reasonCode: isVendorFault(collected.outcome)
                ? 'processing_failure'
                : 'no_usable_public_evidence',
            completedAt: now(),
        });
    }
    // ---- Clustering (single dispatch) ------------------------------------
    doc = await advanceStage(input.runId, 'clustering', now());
    if (!doc || isTerminal(doc.state as AudienceResearchState)) {
        return doc ? terminalMirror(doc) : { terminal: 'failed', reasonCode: 'processing_failure', sourceCount: 0, signalCount: 0 };
    }
    const clusterStart = now();
    const cluster = await runClustering(input.runId, doc, collected.sources, deps, clusterStart, budget, input.outputLocale);
    await appendLedger(input.runId, {
        stage: 'cluster',
        operationCounts: { 'ai.cluster': cluster.dispatched ? 1 : 0 },
        estimatedCostMicros: AI_CALL_ESTIMATE_MICROS,
        actualCostMicros: cluster.cost,
        startedAt: clusterStart,
        endedAt: now(),
        outcome: cluster.outcome,
    });
    if (cluster.signals.length > 0) {
        await AudienceResearchRun.updateOne({ _id: input.runId }, { $set: { signals: cluster.signals } });
    }
    // Terminal-state selection:
    //  - AI dispatch indeterminate (crash-window)          → partial
    //  - AI dispatched, cost ceiling stopped signals load  → partial
    //  - Any collect/discovery ceiling_stop had sources    → partial
    //  - AI succeeded, ≥1 valid signal                     → completed
    //  - AI succeeded, 0 valid signals but ≥1 source       → completed (evidence-only)
    //  - AI provider error, ≥1 source                      → partial
    const claimedButUnresolved = cluster.outcome === 'provider_error' && !cluster.dispatched;
    let terminal: 'completed' | 'partial' | 'failed' = 'completed';
    let reasonCode = 'ok';
    if (claimedButUnresolved) {
        terminal = 'partial';
        reasonCode = 'ai_dispatch_indeterminate';
    }
    else if (cluster.outcome === 'ceiling_stop') {
        terminal = 'partial';
        reasonCode = 'cost_ceiling_partial';
    }
    else if (cluster.outcome === 'unavailable' || cluster.outcome === 'provider_error') {
        terminal = 'partial';
        reasonCode = 'processing_failure';
    }
    else if (collected.outcome === 'ceiling_stop' ||
        collected.outcome === 'unavailable' ||
        discovery.outcome === 'ceiling_stop' ||
        discovery.outcome === 'unavailable') {
        terminal = 'partial';
        reasonCode = 'cost_ceiling_partial';
    }
    return finalizeTerminal({
        runId: input.runId,
        terminal,
        reasonCode,
        completedAt: now(),
    });
}
interface FinalizeInput {
    runId: string;
    terminal: 'completed' | 'partial' | 'failed';
    reasonCode: string;
    completedAt: Date;
}
async function finalizeTerminal(input: FinalizeInput): Promise<RunAudienceResearchPipelineResult> {
    const doc = await AudienceResearchRun.findById(input.runId);
    if (!doc) {
        return {
            terminal: input.terminal,
            reasonCode: input.reasonCode,
            sourceCount: 0,
            signalCount: 0,
        };
    }
    // Never regress a terminal state.
    if (isTerminal(doc.state as AudienceResearchState)) {
        return terminalMirror(doc);
    }
    try {
        assertTransition(doc.state as AudienceResearchState, input.terminal);
    }
    catch {
        return terminalMirror(doc);
    }
    doc.state = input.terminal;
    doc.terminal = {
        state: input.terminal,
        reasonCode: input.reasonCode as never,
        completedAt: input.completedAt,
    } as never;
    doc.completedAt = input.completedAt;
    await doc.save();
    return {
        terminal: input.terminal,
        reasonCode: input.reasonCode,
        sourceCount: (doc.sources ?? []).length,
        signalCount: (doc.signals ?? []).length,
    };
}
function terminalMirror(doc: AudienceResearchRunDocument | AudienceResearchRunHydrated): RunAudienceResearchPipelineResult {
    return {
        terminal: (doc.state ?? 'completed') as 'completed' | 'partial' | 'failed',
        reasonCode: doc.terminal?.reasonCode ?? 'ok',
        sourceCount: (doc.sources ?? []).length,
        signalCount: (doc.signals ?? []).length,
    };
}
