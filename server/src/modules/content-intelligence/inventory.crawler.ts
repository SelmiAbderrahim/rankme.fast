/**
 * Content inventory — bounded owned-site crawl orchestration.
 *
 * Wraps the `ContentSourceProvider` (crawlSite for bulk discovery + scrapePage
 * for explicit sitemap seeds) and turns each returned document into DERIVED
 * FACTS + a sanitized excerpt — never raw HTML. Every discovered/seed URL is
 * re-validated through `assertPublicUrlSafe` (SEC-URL) and the same-origin +
 * allow/exclude + default-denylist policy before it is admitted, and the crawl
 * stops on cancellation, hard cost budget, provider quota, deadline, the
 * requested page limit, or terminal completion.
 *
 * Failure tolerance: a single bad page (unsafe URL, provider scrape error)
 * increments `pagesFailed` and never aborts the crawl. A provider-level quota
 * signal stops the whole crawl with whatever pages were already collected.
 *
 * SEC-INJECT: term derivation uses a single FIXED split class, never a regex
 * built from crawled content, and every string is length-capped before use.
 */
import type { Logger } from 'pino';
import { assertPublicUrlSafe, type PublicUrlResolver } from '../../shared/security/url-safety.js';
import { VendorQuotaError } from '../../shared/providers/errors.js';
import type { ContentDocument, ContentSourceProvider, } from '../../shared/providers/content-source.js';
import { normalizeUrlKey } from './inventory.analysis.js';
import { CONTENT_INVENTORY_SNAPSHOT_MAX_EXCERPT_CHARS, } from './inventory.model.js';
import type { InventoryPageFacts } from './inventory.schemas.js';
/** Paths that are never crawled by default (operator-safe, not per-user). */
export const CONTENT_INVENTORY_DEFAULT_DENYLIST: readonly string[] = [
    '/login',
    '/account',
    '/admin',
    '/cart',
    '/checkout',
    '/search',
];
const TERM_SPLIT = /[^a-z0-9]+/;
const HTML_MARKER = /<\/?script\b|<\/?iframe\b|<!doctype/gi;
const HTML_MARKER_TEST = /<\/?script\b|<\/?iframe\b|<!doctype/i;
// A single fixed control-char class - strips C0 controls (keeping TAB + LF)
// and DEL, never derived from crawled content. Mirrors the pipeline sanitizer.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]+/g;
export type CrawlCompletion = 'complete' | 'partial' | 'cancelled' | 'quota' | 'budget';
export interface CrawledInventoryPage {
    facts: InventoryPageFacts;
    /** Sanitized, length-capped excerpt for the 7-day TTL snapshot. */
    excerpt: string;
    contentHash: string;
    costMicros: number;
}
export interface CrawlInventoryInput {
    origin: string;
    pageLimit: number;
    allowedPaths: readonly string[];
    excludedPaths: readonly string[];
    sitemapSeeds: readonly string[];
}
export interface CrawlInventoryBounds {
    maxCharacters: number;
    timeoutMs: number;
    costCeilingMicros: number;
    depth: number;
    concurrency: number;
}
export interface CrawlInventoryDeps {
    contentSource: ContentSourceProvider;
    resolver?: PublicUrlResolver;
    now?: () => number;
    signal?: AbortSignal;
    onPage?: (page: CrawledInventoryPage) => Promise<void>;
    logger?: Logger;
}
export interface CrawlInventoryResult {
    pages: CrawledInventoryPage[];
    pagesProcessed: number;
    pagesFailed: number;
    pagesSkipped: number;
    completion: CrawlCompletion;
    costMicros: number;
}
function cap(value: string | null, max: number): string | null {
    if (value === null)
        return null;
    return value.length > max ? value.slice(0, max) : value;
}
function sanitizeExcerpt(text: string): string {
    let out = text.replace(CONTROL_CHARS, ' ');
    for (let pass = 0; pass < 5 && HTML_MARKER_TEST.test(out); pass += 1) {
        out = out.replace(HTML_MARKER, '');
    }
    if (HTML_MARKER_TEST.test(out))
        out = out.replace(/[<>]/g, ' ');
    return out.slice(0, CONTENT_INVENTORY_SNAPSHOT_MAX_EXCERPT_CHARS);
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
/** True when `path` is at/under `prefix` (a trailing `*` glob is stripped). */
function pathMatchesPrefix(path: string, prefix: string): boolean {
    const p = prefix.endsWith('*') ? prefix.slice(0, -1) : prefix;
    return path.startsWith(p);
}
function isCrawlableUrl(url: URL, origin: URL, allowedPaths: readonly string[], excludedPaths: readonly string[]): boolean {
    if (url.origin !== origin.origin)
        return false;
    const path = url.pathname;
    if (CONTENT_INVENTORY_DEFAULT_DENYLIST.some((deny) => pathMatchesPrefix(path, deny))) {
        return false;
    }
    if (excludedPaths.some((prefix) => pathMatchesPrefix(path, prefix)))
        return false;
    if (allowedPaths.length > 0 && !allowedPaths.some((prefix) => pathMatchesPrefix(path, prefix))) {
        return false;
    }
    return true;
}
function toFacts(doc: ContentDocument, origin: URL, allowedPaths: readonly string[], excludedPaths: readonly string[]): InventoryPageFacts {
    const headings = doc.headings.map((h) => cap(h.text, 1024)!).filter((h) => h.length > 0).slice(0, 200);
    const schemaTypes = [...new Set(doc.structuredData.map((s) => s.type))]
        .map((t) => cap(t, 200)!)
        .filter((t) => t.length > 0)
        .slice(0, 50);
    const internalLinks = doc.links.filter((l) => !l.external);
    const externalLinks = doc.links.filter((l) => l.external);
    const internalOutLinks: string[] = [];
    for (const link of internalLinks) {
        let parsed: URL;
        try {
            parsed = new URL(link.url);
        }
        catch {
            continue;
        }
        if (parsed.origin !== origin.origin)
            continue;
        if (!isCrawlableUrl(parsed, origin, allowedPaths, excludedPaths))
            continue;
        internalOutLinks.push(parsed.toString().slice(0, 2048));
        if (internalOutLinks.length >= 500)
            break;
    }
    const title = cap(doc.title, 1024);
    const robots = doc.robots.map((r) => cap(r, 64)!).filter((r) => r.length > 0).slice(0, 20);
    const qualityFlags: InventoryPageFacts['qualityFlags'] = [];
    if (robots.some((r) => r.toLowerCase() === 'noindex'))
        qualityFlags.push('noindex');
    if (!title || title.length === 0)
        qualityFlags.push('missing_title');
    const primaryTopics = tokenize(title ?? '', 1024, 5);
    const secondaryTopics = tokenize(headings.join(' '), 4000, 10);
    const canonicalRaw = doc.canonical ? cap(doc.canonical, 2048) : null;
    return {
        url: doc.sourceUrl.slice(0, 2048),
        canonical: canonicalRaw,
        statusCode: doc.statusCode,
        robots,
        language: cap(doc.language, 32),
        title,
        description: cap(doc.description, 4000),
        headings,
        wordCount: countWords(doc.text),
        schemaTypes,
        hasSchemaOrgArticle: schemaTypes.includes('Article'),
        internalLinkCount: internalLinks.length,
        externalLinkCount: externalLinks.length,
        internalOutLinks,
        contentHash: doc.contentHash.slice(0, 128),
        primaryTopics,
        secondaryTopics,
        targetQueries: [],
        qualityFlags: qualityFlags.slice(0, 10),
    };
}
/**
 * Run the bounded owned-site crawl. Deterministic given the provider's
 * responses; incrementally invokes `deps.onPage` as each page is admitted.
 */
export async function crawlInventory(input: CrawlInventoryInput, bounds: CrawlInventoryBounds, deps: CrawlInventoryDeps): Promise<CrawlInventoryResult> {
    const now = deps.now ?? (() => Date.now());
    const deadline = now() + bounds.timeoutMs;
    const origin = new URL(input.origin);
    const resolverOpts = deps.resolver ? { resolver: deps.resolver } : {};
    const pages: CrawledInventoryPage[] = [];
    const seen = new Set<string>();
    let processed = 0;
    let failed = 0;
    let skipped = 0;
    let cost = 0;
    const finalize = (completion: CrawlCompletion): CrawlInventoryResult => ({
        pages,
        pagesProcessed: processed,
        pagesFailed: failed,
        pagesSkipped: skipped,
        completion,
        costMicros: cost,
    });
    // Admit one document. Returns a stop-completion when the crawl must end, or
    // null to continue with the next document.
    const handleDoc = async (doc: ContentDocument, docCost: number): Promise<CrawlCompletion | null> => {
        if (deps.signal?.aborted)
            return 'cancelled';
        if (now() >= deadline)
            return 'partial';
        let safe: URL;
        try {
            safe = await assertPublicUrlSafe(doc.sourceUrl, resolverOpts);
        }
        catch {
            failed += 1;
            return null;
        }
        if (!isCrawlableUrl(safe, origin, input.allowedPaths, input.excludedPaths)) {
            skipped += 1;
            return null;
        }
        const key = normalizeUrlKey(doc.canonical ?? doc.sourceUrl);
        if (seen.has(key)) {
            skipped += 1;
            return null;
        }
        if (processed >= input.pageLimit)
            return 'complete';
        if (cost + docCost > bounds.costCeilingMicros)
            return 'budget';
        seen.add(key);
        const facts = toFacts(doc, origin, input.allowedPaths, input.excludedPaths);
        const page: CrawledInventoryPage = {
            facts,
            excerpt: sanitizeExcerpt(doc.text),
            contentHash: facts.contentHash,
            costMicros: docCost,
        };
        cost += docCost;
        processed += 1;
        pages.push(page);
        await deps.onPage?.(page);
        return null;
    };
    // Phase 1 — bulk crawl from the verified origin.
    let crawlResult;
    try {
        crawlResult = await deps.contentSource.crawlSite({
            origin: origin.toString(),
            allowlistedPaths: [...input.allowedPaths],
            maxPages: input.pageLimit,
            depth: bounds.depth,
            concurrency: bounds.concurrency,
            timeoutMs: bounds.timeoutMs,
            ...(deps.signal ? { signal: deps.signal } : {}),
        });
    }
    catch (err) {
        if (err instanceof VendorQuotaError)
            return finalize('quota');
        throw err;
    }
    if (crawlResult.completion === 'cancelled')
        return finalize('cancelled');
    const completion: CrawlCompletion = crawlResult.failures.length > 0 ? 'partial' : 'complete';
    failed += crawlResult.failures.length;
    const crawlDocs = crawlResult.documents;
    const perPageCost = crawlDocs.length > 0
        ? Math.ceil(Number(crawlResult.usage.estimatedCostMicros) / crawlDocs.length)
        : 0;
    for (const doc of crawlDocs) {
        const stop = await handleDoc(doc, perPageCost);
        if (stop)
            return finalize(stop);
    }
    // Phase 2 — explicit sitemap seeds via scrapePage (each independently safe).
    for (const seed of input.sitemapSeeds) {
        if (deps.signal?.aborted)
            return finalize('cancelled');
        if (now() >= deadline)
            return finalize('partial');
        let safe: URL;
        try {
            safe = await assertPublicUrlSafe(seed, resolverOpts);
        }
        catch {
            failed += 1;
            continue;
        }
        if (!isCrawlableUrl(safe, origin, input.allowedPaths, input.excludedPaths)) {
            skipped += 1;
            continue;
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
                return finalize('quota');
            failed += 1;
            continue;
        }
        const stop = await handleDoc(scraped.document, Number(scraped.usage.estimatedCostMicros));
        if (stop)
            return finalize(stop);
    }
    return finalize(completion);
}
