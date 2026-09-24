/**
 * Competitor content intelligence — bounded page collection.
 *
 * Scrapes each reviewed owned/ranking-page pair through the
 * `ContentSourceProvider`, turning each returned
 * document into DERIVED FACTS + a bounded, sanitized snippet — never raw HTML.
 * Every scraped URL is re-validated through `assertPublicUrlSafe` (SEC-URL)
 * before it is admitted, and collection stops on cancellation, the hard cost
 * budget, provider quota, deadline, or the requested page limit.
 *
 * Failure tolerance: a single competitor that fails (unsafe URL, provider
 * error) increments `competitorsFailed` + `partialDomains` and NEVER aborts the
 * run — an access failure is never treated as a weakness. A provider
 * quota signal stops collection with whatever pages were already gathered.
 *
 * SEC-INJECT: term derivation uses a SINGLE FIXED split class, never a regex
 * built from crawled content, and every string is length-capped before use.
 */
import type { Logger } from 'pino';
import { assertPublicUrlSafe, type PublicUrlResolver, } from '../../shared/security/url-safety.js';
import { VendorQuotaError } from '../../shared/providers/errors.js';
import type { ContentDocument, ContentSourceProvider, } from '../../shared/providers/content-source.js';
import type { CompetitorPageFacts } from './competitor-content.schemas.js';
const TERM_SPLIT = /[^a-z0-9]+/;
const HTML_MARKER = /<\/?script\b|<\/?iframe\b|<!doctype/gi;
const HTML_MARKER_TEST = /<\/?script\b|<\/?iframe\b|<!doctype/i;
// A single FIXED control-char class — strips C0 controls (keeping TAB + LF) and
// DEL, never derived from crawled content.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]+/g;
export type CollectCompletion = 'complete' | 'partial' | 'cancelled' | 'quota' | 'budget';
export function stripHtmlMarkers(input: string): string {
    let out = input;
    for (let pass = 0; pass < 5 && HTML_MARKER_TEST.test(out); pass += 1) {
        out = out.replace(HTML_MARKER, '');
    }
    return HTML_MARKER_TEST.test(out) ? out.replace(/[<>]/g, ' ') : out;
}
/** Sanitize + length-cap a snippet (control chars + HTML markers removed). */
export function sanitizeSnippet(text: string): string {
    let out = text.replace(CONTROL_CHARS, ' ');
    out = stripHtmlMarkers(out);
    return out.trim().slice(0, COMPETITOR_CONTENT_SNIPPET_MAX_CHARS);
}
function cap(value: string | null, max: number): string | null {
    if (value === null)
        return null;
    return value.length > max ? value.slice(0, max) : value;
}
function tokenize(source: string, maxChars: number, maxTerms: number): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of source.slice(0, maxChars).toLowerCase().split(TERM_SPLIT)) {
        if (raw.length < 4 || seen.has(raw))
            continue;
        seen.add(raw);
        out.push(raw);
        if (out.length >= maxTerms)
            break;
    }
    return out;
}
function countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}
/** Turn a provider document into derived facts + a bounded snippet. */
export function documentToFacts(doc: ContentDocument, role: 'owned' | 'competitor', competitorDomain: string | null): CompetitorPageFacts {
    const headings = doc.headings
        .map((h) => cap(h.text, 1024)!)
        .filter((h) => h.length > 0)
        .slice(0, 200);
    const schemaTypes = [...new Set(doc.structuredData.map((s) => s.type))]
        .map((t) => cap(t, 200)!)
        .filter((t) => t.length > 0)
        .slice(0, 50);
    const internalLinks = doc.links.filter((l) => !l.external);
    const externalLinks = doc.links.filter((l) => l.external);
    const title = cap(doc.title, 1024);
    return {
        url: doc.sourceUrl.slice(0, 2048),
        role,
        competitorDomain,
        statusCode: doc.statusCode,
        title,
        description: cap(doc.description, 4000),
        headings,
        wordCount: countWords(doc.text),
        schemaTypes,
        hasSchemaOrgArticle: schemaTypes.includes('Article'),
        internalLinkCount: internalLinks.length,
        externalLinkCount: externalLinks.length,
        contentHash: doc.contentHash.slice(0, 128),
        primaryTopics: tokenize(title ?? '', 1024, 5),
        secondaryTopics: tokenize(headings.join(' '), 4000, 10),
        snippet: sanitizeSnippet(doc.text),
    };
}
export interface CollectedPage {
    facts: CompetitorPageFacts;
    excerpt: string;
    contentHash: string;
    domain: string | null;
    costMicros: number;
    /** Frozen leg key; present for reviewed/explicit ranking-page collection. */
    legKey?: string;
}
export interface CollectCompetitorTarget {
    /** Registrable competitor domain (from the confirmed profile). */
    domain: string;
    /** Reviewed ranking URL. `origin` is retained only for readable old fixtures. */
    url?: string;
    origin?: string;
    /** Reviewed owned page paired with this ranking URL. */
    ownedUrl?: string;
    legKey?: string;
}
export interface CollectInput {
    ownedUrl: string;
    competitors: readonly CollectCompetitorTarget[];
    pageLimit: number;
}
export interface CollectBounds {
    maxCharacters: number;
    timeoutMs: number;
    costCeilingMicros: number;
}
export interface CollectDeps {
    contentSource: ContentSourceProvider;
    resolver?: PublicUrlResolver;
    now?: () => number;
    signal?: AbortSignal;
    onOwned?: (page: CollectedPage) => Promise<void>;
    onCompetitor?: (page: CollectedPage) => Promise<void>;
    logger?: Logger;
}
export interface CollectResult {
    owned: CollectedPage | null;
    /** True when the owned page could not be read. */
    ownedUnusable: boolean;
    competitors: CollectedPage[];
    /** Successful like-for-like reviewed pairs. */
    pairs: Array<{
        owned: CollectedPage;
        competitor: CollectedPage;
        legKey: string;
    }>;
    partialDomains: string[];
    pagesScraped: number;
    competitorsProcessed: number;
    competitorsFailed: number;
    costMicros: number;
    completion: CollectCompletion;
}
function markPartialDomain(result: CollectResult, domain: string): void {
    if (!result.partialDomains.includes(domain))
        result.partialDomains.push(domain);
}
/** Scrape one URL, returning the derived page + its cost, or null on failure. */
async function scrapeOne(url: string, role: 'owned' | 'competitor', domain: string | null, bounds: CollectBounds, deps: CollectDeps, resolverOpts: {
    resolver?: PublicUrlResolver;
}, legKey?: string): Promise<CollectedPage | 'quota' | null> {
    let safe: URL;
    try {
        safe = await assertPublicUrlSafe(url, resolverOpts);
    }
    catch {
        return null;
    }
    let scraped;
    try {
        scraped = await deps.contentSource.scrapePage({
            url: safe.toString(),
            formats: ['markdown', 'metadata'],
            timeoutMs: bounds.timeoutMs,
            maxCharacters: bounds.maxCharacters,
        });
    }
    catch (err) {
        if (err instanceof VendorQuotaError)
            return 'quota';
        return null;
    }
    const facts = documentToFacts(scraped.document, role, domain);
    return {
        facts,
        excerpt: sanitizeSnippet(scraped.document.text),
        contentHash: facts.contentHash,
        domain,
        costMicros: Number(scraped.usage.estimatedCostMicros),
        ...(legKey ? { legKey } : {}),
    };
}
/**
 * Collect the owned page + bounded competitor pages. Deterministic given the
 * provider's responses; incrementally invokes the persistence callbacks.
 */
export async function collectPages(input: CollectInput, bounds: CollectBounds, deps: CollectDeps): Promise<CollectResult> {
    const now = deps.now ?? (() => Date.now());
    const deadline = now() + bounds.timeoutMs;
    const resolverOpts = deps.resolver ? { resolver: deps.resolver } : {};
    const result: CollectResult = {
        owned: null,
        ownedUnusable: false,
        competitors: [],
        pairs: [],
        partialDomains: [],
        pagesScraped: 0,
        competitorsProcessed: 0,
        competitorsFailed: 0,
        costMicros: 0,
        completion: 'complete',
    };
    // The first owned page preserves historical serialization semantics.
    const firstOwnedUrl = input.competitors[0]?.ownedUrl ?? input.ownedUrl;
    const owned = await scrapeOne(firstOwnedUrl, 'owned', null, bounds, deps, resolverOpts);
    if (owned === null || owned === 'quota') {
        result.ownedUnusable = true;
        if (owned === 'quota')
            result.completion = 'quota';
        return result;
    }
    result.owned = owned;
    if (owned.costMicros > bounds.costCeilingMicros) {
        result.owned = null;
        result.ownedUnusable = true;
        result.completion = 'budget';
        return result;
    }
    result.costMicros += owned.costMicros;
    result.pagesScraped += 1;
    await deps.onOwned?.(owned);
    const ownedByUrl = new Map<string, CollectedPage>([[new URL(firstOwnedUrl).toString(), owned]]);
    for (const [targetIndex, target] of input.competitors.entries()) {
        if (deps.signal?.aborted) {
            result.completion = 'cancelled';
            return result;
        }
        if (now() >= deadline) {
            result.completion = 'partial';
            return result;
        }
        if (result.competitorsProcessed >= input.pageLimit) {
            result.completion = 'complete';
            break;
        }
        const targetUrl = target.url ?? target.origin;
        if (!targetUrl) {
            result.competitorsFailed += 1;
            markPartialDomain(result, target.domain);
            continue;
        }
        const legKey = target.legKey ?? `legacy:${targetIndex}`;
        const pairOwnedUrl = target.ownedUrl ?? input.ownedUrl;
        let pairOwnedKey: string;
        try {
            pairOwnedKey = new URL(pairOwnedUrl).toString();
        }
        catch {
            result.competitorsFailed += 1;
            markPartialDomain(result, target.domain);
            continue;
        }
        let pairOwned = ownedByUrl.get(pairOwnedKey);
        if (!pairOwned) {
            const collectedOwned = await scrapeOne(pairOwnedUrl, 'owned', null, bounds, deps, resolverOpts, legKey);
            if (collectedOwned === 'quota') {
                result.completion = 'quota';
                return result;
            }
            if (collectedOwned === null) {
                result.competitorsFailed += 1;
                markPartialDomain(result, target.domain);
                continue;
            }
            if (result.costMicros + collectedOwned.costMicros > bounds.costCeilingMicros) {
                result.completion = 'budget';
                return result;
            }
            pairOwned = collectedOwned;
            ownedByUrl.set(pairOwnedKey, pairOwned);
            result.costMicros += pairOwned.costMicros;
            result.pagesScraped += 1;
            await deps.onOwned?.(pairOwned);
        }
        const page = await scrapeOne(targetUrl, 'competitor', target.domain, bounds, deps, resolverOpts, legKey);
        if (page === 'quota') {
            result.completion = 'quota';
            return result;
        }
        if (page === null) {
            result.competitorsFailed += 1;
            markPartialDomain(result, target.domain);
            continue;
        }
        // Budget guard — stop before admitting a page that would exceed the ceiling.
        if (result.costMicros + page.costMicros > bounds.costCeilingMicros) {
            result.completion = 'budget';
            return result;
        }
        result.costMicros += page.costMicros;
        result.competitorsProcessed += 1;
        result.pagesScraped += 1;
        result.competitors.push(page);
        result.pairs.push({ owned: pairOwned, competitor: page, legKey });
        await deps.onCompetitor?.(page);
    }
    if (result.completion === 'complete' && result.competitorsFailed > 0) {
        result.completion = 'partial';
    }
    return result;
}
import { COMPETITOR_CONTENT_SNIPPET_MAX_CHARS } from '../../shared/safety/feature-limits.js';
