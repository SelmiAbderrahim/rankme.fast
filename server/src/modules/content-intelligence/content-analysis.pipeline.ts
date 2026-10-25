/**
 * Content Intelligence — pipeline stage handlers.
 *
 * Each stage is a pure function of its injected deps + the current analysis
 * document. Handlers RETURN a discriminated outcome; they do NOT decide
 * terminal statuses (the processor owns that decision).
 *
 * Every I/O boundary crosses a provider capability interface — never a
 * vendor SDK. Every crawled URL is validated via `assertPublicUrlSafe`.
 * Every AI call flows through the shared profile runner.
 */
import { countWords } from '../../shared/utils/text-length.js';
import { createHash } from 'node:crypto';
import type { ContentDocument, ContentSourceProvider, } from '../../shared/providers/content-source.js';
import type { KeywordProvider, RankProvider, SerpDevice, } from '../../shared/providers/types.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/runner.js';
import { assertPublicUrlSafe, UnsafeUrlError } from '../../shared/security/url-safety.js';
import type { PageProbeResult, PageProber } from '../../shared/security/site-probe.js';
import type { RedirectHop } from '../../shared/providers/types.js';
import { ProviderError, VendorAuthError, VendorMalformedError, VendorTimeoutError, } from '../../shared/providers/errors.js';
import type { ContentAnalysisFailureReason } from './content-analysis.model.js';
import { ownedPageFactsSchema, keywordEvidenceSchema, serpEvidenceSchema, competitorEvidenceSchema, competitorFailureSchema, type CompetitorEvidence, type CompetitorFailure, type KeywordEvidence, type OwnedPageFacts, type SerpEvidence, } from './content-analysis.schemas.js';
import { selectCompetitorCandidates } from './content-analysis.selectors.js';
// ---------------------------------------------------------------------------
// Deps + helpers
// ---------------------------------------------------------------------------
export interface StageContext {
    accountId: string;
    siteId: string;
    analysisId: string;
    ownedUrl: string;
    keyword: string;
    locale: 'en' | 'ar' | 'fr' | 'de' | 'es' | 'ru' | 'zh';
    ownedDomain: string;
    correlationId: string;
    reviewedCompetitorUrls?: readonly string[];
}
export interface PipelineDeps {
    /**
     * First-party prober (SSRF-guarded, up to five redirects). When present the
     * owned page is requested BEFORE the paid scrape: a redirect loop, an
     * over-long chain, a non-HTML address, or a missing page fails early with
     * its real cause, and a redirected page is scraped at its final address.
     */
    pageProber?: PageProber;
    contentSource: ContentSourceProvider;
    keyword: KeywordProvider;
    rank: RankProvider;
    ai: AiProfileRunner;
    now: () => Date;
    aiProviderOrder: readonly ('fake' | 'glm' | 'deepseek' | 'kimi' | 'openai' | 'google' | 'anthropic')[];
}
export type StageOutcome<T> = {
    ok: true;
    artifact: T;
    costMicros: number;
    aiCostMicros?: number;
} | {
    ok: false;
    code: string;
    /** Bounded internal diagnostic (logs only) — never persisted or returned. */
    reason: string;
    /** Safe, user-facing failure category (owned stage only). */
    failureReason?: ContentAnalysisFailureReason;
    /** The owned page's own HTTP status, only with `failureReason: 'http_error'`. */
    httpStatus?: number;
    /** What our own request to the owned page saw (owned stage only). */
    fetchEvidence?: OwnedFetchEvidence;
};
/** Final address, redirect chain, and media type seen by our own request. */
export interface OwnedFetchEvidence {
    finalUrl?: string;
    redirectChain?: RedirectHop[];
    contentType?: string;
}
export function hashInputs(...parts: readonly string[]): string {
    return createHash('sha256').update(parts.join('|')).digest('hex');
}
const SCRAPE_MAX_CHARS = 200000;
const SCRAPE_TIMEOUT_MS = 60000;
function truncate(input: string, max: number): string {
    return input.length > max ? input.slice(0, max) : input;
}
function sanitizeExcerpt(markdown: string): string {
    // Drop HTML markers, control chars (SEC-OUT / SEC-INJECT). ReDoS-safe:
    // linear replaces, bounded input.
    const bounded = truncate(markdown, 32000);
    return bounded
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B-\u001F\u007F]+/g, ' ')
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ')
        .replace(/<!doctype[^>]*>/gi, ' ')
        .slice(0, 8000);
}
function factsFromDocument(doc: ContentDocument, url: string): OwnedPageFacts {
    const excerpt = sanitizeExcerpt(doc.markdown);
    const wordCount = countWords(excerpt, doc.language);
    const links = doc.links ?? [];
    const internal = links.filter((l) => !l.external).length;
    const external = links.filter((l) => l.external).length;
    const schemaTypes = Array.from(new Set((doc.structuredData ?? []).map((s) => s.type).filter(Boolean))).slice(0, 50);
    return {
        url,
        title: doc.title ?? null,
        description: doc.description ?? null,
        canonical: doc.canonical ?? null,
        language: doc.language ?? null,
        wordCount,
        headingCount: (doc.headings ?? []).length,
        schemaTypes,
        hasSchemaOrgArticle: schemaTypes.includes('Article'),
        internalLinkCount: internal,
        externalLinkCount: external,
        contentHash: doc.contentHash,
        excerpt,
    };
}
function competitorFromDocument(doc: ContentDocument, url: string, sourceId: string): CompetitorEvidence {
    const excerpt = sanitizeExcerpt(doc.markdown);
    const wordCount = countWords(excerpt, doc.language);
    const schemaTypes = Array.from(new Set((doc.structuredData ?? []).map((s) => s.type).filter(Boolean))).slice(0, 50);
    // Snippet: short bounded citation only — never substantial competitor prose.
    const snippet = excerpt.slice(0, 400);
    return competitorEvidenceSchema.parse({
        sourceId,
        url,
        title: doc.title ?? null,
        wordCount,
        headingCount: (doc.headings ?? []).length,
        schemaTypes,
        hasSchemaOrgArticle: schemaTypes.includes('Article'),
        snippet,
        contentHash: doc.contentHash,
    });
}
function isUsableOwned(facts: OwnedPageFacts): boolean {
    // "Usable" = enough signal to score. Title OR body text of any length
    // combined with at least a few words. An empty page (word count 0, no
    // title, no headings) is unusable → owned_page_unusable.
    const hasTitle = !!facts.title && facts.title.trim().length > 0;
    const hasHeadings = facts.headingCount > 0;
    return hasTitle || hasHeadings || facts.wordCount >= 20;
}
function usageMicros(usage: {
    estimatedCostMicros: bigint;
}): number {
    const n = Number(usage.estimatedCostMicros);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}
// ---------------------------------------------------------------------------
// Stage: collect_owned
// ---------------------------------------------------------------------------
/**
 * Map a content-source rejection onto a safe, user-actionable category. The
 * vendor message is only pattern-matched here (robots / access denial are
 * reported as plain-error metadata by the adapters); it never leaves this
 * function. Credential rejections have no page-level reason.
 */
export function classifyOwnedFetchError(err: unknown): ContentAnalysisFailureReason | undefined {
    if (err instanceof VendorAuthError)
        return undefined;
    if (err instanceof UnsafeUrlError)
        return 'unsafe_url';
    if (err instanceof VendorTimeoutError)
        return 'timeout';
    if (err instanceof ProviderError && err.retryable)
        return 'temporarily_unavailable';
    const message = err instanceof Error ? err.message : '';
    if (/robots/i.test(message))
        return 'robots_blocked';
    if (/forbidden|access denied/i.test(message))
        return 'access_denied';
    if (err instanceof VendorMalformedError && /byte ceiling/i.test(message))
        return 'too_large';
    return 'unreadable';
}
/** Probe failures that decide the outcome on their own, before any paid scrape. */
function conclusiveProbeFailure(probe: PageProbeResult): {
    reason: ContentAnalysisFailureReason;
    httpStatus?: number;
} | null {
    const failure = probe.failure;
    if (!failure)
        return null;
    switch (failure.kind) {
        case 'redirect_loop':
        case 'redirect_limit':
        case 'unsafe_redirect':
        case 'non_html':
            return { reason: failure.kind };
        case 'http_error':
            // 404/410 after our HEAD→GET check: the page is gone. Other statuses
            // (403, 429, 5xx) may be bot protection or a blip the scraper gets past.
            return failure.statusCode === 404 || failure.statusCode === 410
                ? { reason: 'http_error', httpStatus: failure.statusCode }
                : null;
        default:
            return null;
    }
}
function fetchEvidenceOf(probe: PageProbeResult): OwnedFetchEvidence {
    return {
        ...(probe.redirectChain.length > 0 && probe.finalUrl ? { finalUrl: probe.finalUrl } : {}),
        ...(probe.redirectChain.length > 0 ? { redirectChain: probe.redirectChain } : {}),
        ...(probe.contentType ? { contentType: probe.contentType } : {}),
    };
}
/**
 * When the scraper could not say why, our own request may know: a robots.txt
 * exclusion or an HTTP status it saw. Anything the scraper classified more
 * specifically wins.
 */
function refineWithProbe(failureReason: ContentAnalysisFailureReason | undefined, probe: PageProbeResult | undefined): {
    failureReason?: ContentAnalysisFailureReason;
    httpStatus?: number;
} {
    const vague = failureReason === undefined || failureReason === 'unreadable' || failureReason === 'empty_content';
    const failure = probe?.failure;
    if (vague && failure?.kind === 'robots_blocked')
        return { failureReason: 'robots_blocked' };
    if (vague && failure?.kind === 'http_error') {
        return { failureReason: 'http_error', ...(failure.statusCode ? { httpStatus: failure.statusCode } : {}) };
    }
    if (vague && failure?.kind === 'timeout')
        return { failureReason: 'timeout' };
    return failureReason ? { failureReason } : {};
}
export async function runOwnedStage(ctx: StageContext, deps: PipelineDeps): Promise<StageOutcome<OwnedPageFacts>> {
    let scrapeUrl = ctx.ownedUrl;
    let probe: PageProbeResult | undefined;
    let evidence: OwnedFetchEvidence | undefined;
    if (deps.pageProber) {
        probe = await deps.pageProber.probe(ctx.ownedUrl);
        evidence = fetchEvidenceOf(probe);
        const conclusive = conclusiveProbeFailure(probe);
        if (conclusive) {
            return {
                ok: false,
                code: 'owned_page_unusable',
                reason: `owned page request: ${probe.failure!.kind}`,
                failureReason: conclusive.reason,
                ...(conclusive.httpStatus === undefined ? {} : { httpStatus: conclusive.httpStatus }),
                fetchEvidence: evidence,
            };
        }
        // A redirected page is read at its final address, not the entry address.
        if (probe.finalUrl && probe.redirectChain.length > 0 && !probe.failure)
            scrapeUrl = probe.finalUrl;
    }
    try {
        const result = await deps.contentSource.scrapePage({
            url: scrapeUrl,
            formats: ['markdown', 'metadata'],
            timeoutMs: SCRAPE_TIMEOUT_MS,
            maxCharacters: SCRAPE_MAX_CHARS,
        });
        const status = result.document.statusCode;
        if (status >= 400) {
            // The page answered with an error status: scoring its error page would
            // be meaningless. 429 / 5xx are usually transient → retryable fetch
            // failure; other 4xx (404, 410, 401, 403 …) need the owner to act.
            const transient = status === 429 || status >= 500;
            return {
                ok: false,
                code: transient ? 'owned_fetch_failed' : 'owned_page_unusable',
                reason: `owned page returned HTTP ${status}`,
                failureReason: 'http_error',
                httpStatus: status,
                ...(evidence ? { fetchEvidence: evidence } : {}),
            };
        }
        const facts = factsFromDocument(result.document, ctx.ownedUrl);
        const parsed = ownedPageFactsSchema.parse({
            ...facts,
            ...(evidence?.finalUrl && evidence.redirectChain
                ? { finalUrl: evidence.finalUrl, redirectChain: evidence.redirectChain }
                : {}),
        });
        if (!isUsableOwned(parsed)) {
            const refined = refineWithProbe('empty_content', probe);
            return {
                ok: false,
                code: 'owned_page_unusable',
                reason: 'no usable content',
                ...(refined.failureReason ? { failureReason: refined.failureReason } : {}),
                ...(refined.httpStatus === undefined ? {} : { httpStatus: refined.httpStatus }),
                ...(evidence ? { fetchEvidence: evidence } : {}),
            };
        }
        return { ok: true, artifact: parsed, costMicros: usageMicros(result.usage) };
    }
    catch (err) {
        // A retryable vendor fault (timeout / quota / 5xx) is NOT a bad owned page —
        // classify it as `owned_fetch_failed` so the run is marked retryable and the
        // user is told to try again, not that their page is unusable. A vendor
        // credential rejection (401/403) is an operator misconfiguration, not the
        // user's page either → `provider_unavailable`. Other non-retryable throws
        // (malformed, robots-block) stay `owned_page_unusable`.
        const code = err instanceof VendorAuthError
            ? 'provider_unavailable'
            : err instanceof ProviderError && err.retryable
                ? 'owned_fetch_failed'
                : 'owned_page_unusable';
        const refined = refineWithProbe(classifyOwnedFetchError(err), probe);
        return {
            ok: false,
            code,
            reason: err instanceof Error ? err.message.slice(0, 200) : 'scrape failed',
            ...(refined.failureReason ? { failureReason: refined.failureReason } : {}),
            ...(refined.httpStatus === undefined ? {} : { httpStatus: refined.httpStatus }),
            ...(evidence ? { fetchEvidence: evidence } : {}),
        };
    }
}
// ---------------------------------------------------------------------------
// Stage: collect_keyword_serp
// ---------------------------------------------------------------------------
export interface SerpStageArtifact {
    keyword: KeywordEvidence;
    serp: SerpEvidence;
    competitorUrls: string[];
}
// Small default location — US en; the API layer accepts overrides in future
// prompts but the pipeline only needs A location code.
const DEFAULT_LOCATION = 2840;
export async function runSerpStage(ctx: StageContext, deps: PipelineDeps): Promise<StageOutcome<SerpStageArtifact>> {
    const device: SerpDevice = 'desktop';
    const languageCode = ctx.locale === 'zh' ? 'zh-CN' : ctx.locale;
    let metrics;
    let intents;
    try {
        metrics = await deps.keyword.getMetrics([ctx.keyword], DEFAULT_LOCATION, languageCode);
        intents = await deps.keyword.classifyIntent([ctx.keyword], DEFAULT_LOCATION, languageCode);
    }
    catch (err) {
        return {
            ok: false,
            code: 'keyword_unavailable',
            reason: err instanceof Error ? err.message.slice(0, 200) : 'keyword lookup failed',
        };
    }
    let serpResult;
    try {
        serpResult = await deps.rank.checkRank({
            keyword: ctx.keyword,
            domain: ctx.ownedDomain,
            locationCode: DEFAULT_LOCATION,
            languageCode,
            device,
        });
    }
    catch (err) {
        return {
            ok: false,
            code: 'serp_unavailable',
            reason: err instanceof Error ? err.message.slice(0, 200) : 'serp fetch failed',
        };
    }
    const m = metrics[0] ?? null;
    const i = intents[0] ?? null;
    const keywordEvidence = keywordEvidenceSchema.parse({
        keyword: ctx.keyword,
        locationCode: DEFAULT_LOCATION,
        languageCode,
        volume: m?.searchVolume ?? null,
        difficulty: m?.difficulty ?? null,
        intent: i?.intent ?? null,
    });
    const topUrls = (serpResult.serpTopUrls ?? []).slice(0, 20);
    const serpEvidence = serpEvidenceSchema.parse({
        device,
        ownedPosition: serpResult.position ?? null,
        topUrls,
    });
    // Filter competitors via the pure selector. Ceiling = 3 (product decision).
    const selection = await selectCompetitorCandidates({
        serpTopUrls: ctx.reviewedCompetitorUrls?.length ? ctx.reviewedCompetitorUrls : topUrls,
        ownedDomain: ctx.ownedDomain,
        ceiling: 3,
        assertSafe: (u) => assertPublicUrlSafe(u),
    });
    return {
        ok: true,
        artifact: {
            keyword: keywordEvidence,
            serp: serpEvidence,
            competitorUrls: selection.selected.map((s) => s.url),
        },
        // Keyword + SERP evidence is operator-side vendor spend outside the
        // analysis budget, so this stage records 0 direct-cost.
        costMicros: 0,
    };
}
// ---------------------------------------------------------------------------
// Stage: collect_competitors
// ---------------------------------------------------------------------------
export interface CompetitorsStageArtifact {
    competitors: CompetitorEvidence[];
    failures: CompetitorFailure[];
}
export interface CollectCompetitorsInput {
    urls: readonly string[];
    budgetMicros: number;
}
export async function runCompetitorsStage(ctx: StageContext, deps: PipelineDeps, input: CollectCompetitorsInput): Promise<StageOutcome<CompetitorsStageArtifact>> {
    const competitors: CompetitorEvidence[] = [];
    const failures: CompetitorFailure[] = [];
    let spent = 0;
    let index = 0;
    const AGGREGATE_MAX_CHARS = 20000;
    let aggregateChars = 0;
    for (const url of input.urls) {
        index += 1;
        if (spent >= input.budgetMicros) {
            failures.push(competitorFailureSchema.parse({ url, reason: 'unavailable' }));
            continue;
        }
        try {
            const result = await deps.contentSource.scrapePage({
                url,
                formats: ['markdown', 'metadata'],
                timeoutMs: SCRAPE_TIMEOUT_MS,
                maxCharacters: SCRAPE_MAX_CHARS,
            });
            const sourceId = `competitor-${index}`;
            const evidence = competitorFromDocument(result.document, url, sourceId);
            aggregateChars += evidence.snippet.length;
            if (aggregateChars > AGGREGATE_MAX_CHARS) {
                failures.push(competitorFailureSchema.parse({ url, reason: 'unavailable' }));
                continue;
            }
            competitors.push(evidence);
            spent += usageMicros(result.usage);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            let reason: CompetitorFailure['reason'] = 'unavailable';
            if (/timeout/i.test(msg))
                reason = 'timeout';
            else if (/quota/i.test(msg))
                reason = 'quota';
            else if (/malformed/i.test(msg))
                reason = 'malformed';
            else if (/unsafe|private|blocked/i.test(msg))
                reason = 'unsafe';
            failures.push(competitorFailureSchema.parse({ url, reason }));
        }
        void ctx; // suppress unused var — ctx is reserved for future per-competitor logging.
    }
    return {
        ok: true,
        artifact: { competitors, failures },
        costMicros: spent,
    };
}
// ---------------------------------------------------------------------------
// Stage: generate brief + first draft
// ---------------------------------------------------------------------------
export interface BriefStageArtifact {
    text: string;
    citations: string[];
    profileVersion: string;
    provider: string;
    costMicros: number;
}
export async function runBriefStage(ctx: StageContext, deps: PipelineDeps, input: {
    facts: OwnedPageFacts;
    keyword: KeywordEvidence;
    competitors: readonly CompetitorEvidence[];
}): Promise<StageOutcome<BriefStageArtifact>> {
    try {
        const derivedFacts = JSON.stringify({
            owned: {
                title: input.facts.title,
                wordCount: input.facts.wordCount,
                headingCount: input.facts.headingCount,
                schemaTypes: input.facts.schemaTypes,
            },
            keyword: input.keyword,
            competitorCount: input.competitors.length,
        }).slice(0, 15000);
        const competitorSnippets = input.competitors.map((c) => ({
            id: c.sourceId,
            text: c.snippet.slice(0, 600),
        }));
        const result = await deps.ai.run<{
            title: string;
            audience: string;
            outline: string[];
            citations: string[];
        }>({
            profile: 'content_brief',
            locale: ctx.locale,
            correlationId: ctx.correlationId,
            usage: { accountId: ctx.accountId, siteId: ctx.siteId, jobId: ctx.analysisId },
            configuredProviderOrder: deps.aiProviderOrder,
            input: {
                keyword: input.keyword.keyword,
                audience: 'general readers searching for this term',
                derivedFacts,
                competitorSnippets,
            },
        });
        const text = JSON.stringify({
            title: result.object.title,
            audience: result.object.audience,
            outline: result.object.outline,
        });
        return {
            ok: true,
            artifact: {
                text,
                citations: [...result.object.citations],
                profileVersion: result.provenance.profileVersion,
                provider: result.provenance.provider,
                costMicros: Number(result.provenance.actualOrEstimatedCostMicros ?? 0n),
            },
            costMicros: Number(result.provenance.actualOrEstimatedCostMicros ?? 0n),
            aiCostMicros: Number(result.provenance.actualOrEstimatedCostMicros ?? 0n),
        };
    }
    catch (err) {
        return {
            ok: false,
            code: 'brief_failed',
            reason: err instanceof Error ? err.message.slice(0, 200) : 'brief failed',
        };
    }
}
export interface DraftStageArtifact {
    text: string;
    citations: string[];
    profileVersion: string;
    provider: string;
    costMicros: number;
}
export async function runDraftStage(ctx: StageContext, deps: PipelineDeps, input: {
    facts: OwnedPageFacts;
    keyword: KeywordEvidence;
    brief: BriefStageArtifact;
    competitors: readonly CompetitorEvidence[];
}): Promise<StageOutcome<DraftStageArtifact>> {
    try {
        const competitorSnippets = input.competitors.map((c) => ({
            id: c.sourceId,
            text: c.snippet.slice(0, 600),
        }));
        const result = await deps.ai.run<{
            title: string;
            body: string;
            citations: string[];
        }>({
            profile: 'content_first_draft',
            locale: ctx.locale,
            correlationId: ctx.correlationId,
            usage: { accountId: ctx.accountId, siteId: ctx.siteId, jobId: ctx.analysisId },
            configuredProviderOrder: deps.aiProviderOrder,
            input: {
                keyword: input.keyword.keyword,
                brief: input.brief.text.slice(0, 15000),
                derivedFacts: JSON.stringify({
                    wordCount: input.facts.wordCount,
                    schemaTypes: input.facts.schemaTypes,
                }),
                competitorSnippets,
            },
        });
        return {
            ok: true,
            artifact: {
                text: result.object.body,
                citations: [...result.object.citations],
                profileVersion: result.provenance.profileVersion,
                provider: result.provenance.provider,
                costMicros: Number(result.provenance.actualOrEstimatedCostMicros ?? 0n),
            },
            costMicros: Number(result.provenance.actualOrEstimatedCostMicros ?? 0n),
            aiCostMicros: Number(result.provenance.actualOrEstimatedCostMicros ?? 0n),
        };
    }
    catch (err) {
        return {
            ok: false,
            code: 'draft_failed',
            reason: err instanceof Error ? err.message.slice(0, 200) : 'draft failed',
        };
    }
}
