/**
 * DataForSEO On-Page adapter.
 *
 * Implements the vendor-neutral AuditProvider over the
 * DataForSEO v3 On-Page API. Vendor performs the crawl on its own
 * infrastructure; we drive:
 *   startAudit         → POST /on_page/task_post
 *   getAuditStatus     → GET  /on_page/summary/{id}
 *   getAuditResult     → summary + paginated pages + broken links + non-indexable
 *
 * Fallback note: Ahrefs Site Audit implements the same interface later if
 * ever needed — no pre-building.
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { dataForSeoRequest } from '../http.js';
import { VendorMalformedError, VendorUnavailableError, } from '../errors.js';
import type { AuditCrawlStopReason, AuditPage, AuditPageTiming, AuditProvider, AuditResult, AuditResultOptions, AuditStatus, PageFetchFailure, StartAuditInput, } from '../types.js';
import { normalizeDeepPageFields } from './onpage-checks.js';
import { readExtraSignals, type ExtraReadsConfig } from './onpage-extras.js';
import { collectPaged } from './onpage-paging.js';
/**
 * Vendor accepts a bare host — no scheme, no `www.`, no trailing slash.
 * The caller passes a Site.domain (already lowercase, host-only) so the
 * strip is defence-in-depth.
 */
export function toDataForSeoTarget(domain: string): string {
    return domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();
}
// ---------------------------------------------------------------------------
// Schemas — vendor payloads. Anything unexpected → VendorMalformedError via
// dataForSeoRequest; adapter code only ever reads validated fields.
// ---------------------------------------------------------------------------
const taskPostResultSchema = z
    .array(z.object({}).passthrough())
    .nullable()
    .optional();
const summaryCheckSchema = z.record(z.string(), z.unknown());
/**
 * `crawl_stop_reason` as documented for /on_page/summary: `limit_exceeded`
 * (the `max_crawl_pages` limit was reached), `empty_queue` (every queued URL
 * was crawled), `force_stopped` (halted via force stop), `unexpected_exception`
 * (an internal crawler error).
 */
const CRAWL_STOP_REASONS: Readonly<Record<string, AuditCrawlStopReason>> = {
    limit_exceeded: 'page_limit',
    empty_queue: 'no_more_links',
    force_stopped: 'stopped',
    unexpected_exception: 'crawler_error',
};
const summaryResultSchema = z
    .array(z
    .object({
    crawl_progress: z.string().optional(),
    // `null` while the crawl runs; documented values are mapped below and
    // anything else is kept out of the normalized result.
    crawl_stop_reason: z.string().nullable().optional(),
    crawl_status: z
        .object({
        pages_crawled: z.number().optional(),
        pages_in_queue: z.number().optional(),
        max_crawl_pages: z.number().optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
    domain_info: z
        .object({
        checks: summaryCheckSchema.optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
    page_metrics: z
        .object({
        checks: summaryCheckSchema.optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
})
    .passthrough())
    .min(1);
const pageMetaSchema = z
    .object({
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    canonical: z.string().nullable().optional(),
    htags: z
        .object({
        h1: z.array(z.string()).nullable().optional(),
        h2: z.array(z.string()).nullable().optional(),
        h3: z.array(z.string()).nullable().optional(),
        h4: z.array(z.string()).nullable().optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
    content: z
        .object({
        plain_text_word_count: z.number().nullable().optional(),
        // UTF-8 byte size of the plain text; measures no-space languages.
        plain_text_size: z.number().nullable().optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
})
    .passthrough();
const pageChecksSchema = z
    .object({
    no_title: z.boolean().optional(),
    no_description: z.boolean().optional(),
    no_h1_tag: z.boolean().optional(),
    duplicate_title: z.boolean().optional(),
    title_too_long: z.boolean().optional(),
    has_micromarkup: z.boolean().optional(),
    has_micromarkup_errors: z.boolean().optional(),
    is_broken: z.boolean().optional(),
    canonical: z.boolean().optional(),
    no_micromarkup: z.boolean().optional(),
})
    .passthrough();
const pageTimingSchema = z
    .object({
    time_to_interactive: z.number().nullable().optional(),
    fetch_time: z.string().nullable().optional(),
    duration_time: z.number().nullable().optional(),
})
    .passthrough()
    .nullable()
    .optional();
const pageItemSchema = z
    .object({
    url: z.string(),
    status_code: z.number(),
    /** Redirect target of a 3xx row; `null` on every other row. */
    location: z.string().nullable().optional(),
    /** Media type the server answered with (`text/html`). */
    media_type: z.string().nullable().optional(),
    meta: pageMetaSchema.nullable().optional(),
    checks: pageChecksSchema.nullable().optional(),
    onpage_score: z.number().nullable().optional(),
    page_timing: pageTimingSchema,
})
    .passthrough();
const pagesResultSchema = z
    .array(z
    .object({
    items: z.array(pageItemSchema).nullable().optional(),
    items_count: z.number().optional(),
    total_items_count: z.number().optional(),
})
    .passthrough())
    .min(1);
const linksResultSchema = z
    .array(z
    .object({
    items: z
        .array(z
        .object({
        link_from: z.string().optional(),
        link_to: z.string().optional(),
        direction: z.enum(['internal', 'external']),
        type: z.string().optional(),
        is_broken: z.boolean().optional(),
    })
        .passthrough())
        .nullable()
        .optional(),
})
    .passthrough())
    .min(1);
const nonIndexableResultSchema = z
    .array(z
    .object({
    items: z
        .array(z
        .object({
        url: z.string().optional(),
        reason: z.string().optional(),
    })
        .passthrough())
        .nullable()
        .optional(),
})
    .passthrough())
    .min(1);
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export interface DataForSeoOnPageProviderConfig extends ExtraReadsConfig {
    /** Max pages to pull per pages endpoint call (vendor cap ≥ 1000). */
    pagesPerRequest?: number;
    logger?: Logger;
}
const DEFAULT_PAGES_PER_REQUEST = 1000;
// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export function createDataForSeoOnPageAuditProvider(cfg: DataForSeoOnPageProviderConfig): AuditProvider {
    const pagesPerRequest = cfg.pagesPerRequest ?? DEFAULT_PAGES_PER_REQUEST;
    const ctx = { provider: 'dataforseo', operation: 'on_page' };
    return {
        async startAudit(input: StartAuditInput): Promise<{
            vendorTaskId: string;
        }> {
            const target = toDataForSeoTarget(input.domain);
            // `max_crawl_pages` is a spending CEILING, not the billing basis: the
            // vendor bills per actually-crawled page ($0.00015 basic) and
            // auto-refunds the unused difference. Rendering flags are deliberately
            // never sent — `enable_javascript` is ~10× the base page price and
            // `enable_browser_rendering` ~34× ($0.0051/page), which the margin
            // model does not budget for. The body-shape contract test pins this.
            const body: Record<string, unknown> = {
                target,
                max_crawl_pages: input.pageCap,
                respect_sitemap: true,
                ...(input.resourceScan === true ? { load_resources: true } : {}),
            };
            const outcomes = await dataForSeoRequest(cfg, '/on_page/task_post', [body], taskPostResultSchema, { operation: 'on-page-task-post' });
            const outcome = outcomes[0];
            if (!outcome) {
                throw new VendorMalformedError('on_page/task_post returned no tasks', {
                    ...ctx,
                    operation: 'on-page-task-post',
                });
            }
            if (outcome.status === 'in_queue') {
                // Vendor never posts task_post as 40602 — but code path exists for defense.
                throw new VendorUnavailableError('on_page/task_post reported in_queue', {
                    ...ctx,
                    operation: 'on-page-task-post',
                });
            }
            if (!outcome.taskId) {
                throw new VendorMalformedError('on_page/task_post missing task id', {
                    ...ctx,
                    operation: 'on-page-task-post',
                });
            }
            return { vendorTaskId: outcome.taskId };
        },
        async getAuditStatus(vendorTaskId: string): Promise<AuditStatus> {
            const outcomes = await dataForSeoRequest(cfg, `/on_page/summary/${encodeURIComponent(vendorTaskId)}`, [], summaryResultSchema, { operation: 'on-page-summary', method: 'GET' });
            const outcome = outcomes[0];
            if (!outcome) {
                throw new VendorMalformedError('on_page/summary returned no tasks', {
                    ...ctx,
                    operation: 'on-page-summary',
                });
            }
            if (outcome.status === 'in_queue') {
                return { state: 'queued' };
            }
            if (outcome.status !== 'ok') {
                throw new VendorMalformedError('on_page/summary returned unexpected status', {
                    ...ctx,
                    operation: 'on-page-summary',
                });
            }
            const summary = outcome.result[0]!;
            /* c8 ignore next -- crawl_progress is required in every real vendor response; `?? 'in_progress'` is a defensive fallback. */
            const progress = summary.crawl_progress ?? 'in_progress';
            const pagesCrawled = summary.crawl_status?.pages_crawled;
            if (progress === 'finished') {
                return { state: 'finished', pagesCrawled };
            }
            return { state: 'crawling', pagesCrawled };
        },
        async getAuditResult(vendorTaskId: string, options?: AuditResultOptions): Promise<AuditResult> {
            const summaryOutcomes = await dataForSeoRequest(cfg, `/on_page/summary/${encodeURIComponent(vendorTaskId)}`, [], summaryResultSchema, { operation: 'on-page-summary', method: 'GET' });
            const summaryOutcome = summaryOutcomes[0];
            if (!summaryOutcome || summaryOutcome.status !== 'ok') {
                throw new VendorMalformedError('on_page/summary not ok at result time', {
                    ...ctx,
                    operation: 'on-page-summary',
                });
            }
            const summary = summaryOutcome.result[0]!;
            const domainChecks = normalizeDomainChecks(summary.domain_info?.checks);
            const vendorPagesCrawled = summary.crawl_status?.pages_crawled;
            const stopReason = summary.crawl_stop_reason;
            const crawlStopReason = stopReason && Object.hasOwn(CRAWL_STOP_REASONS, stopReason)
                ? CRAWL_STOP_REASONS[stopReason]
                : undefined;
            const crawled = await collectPaged<z.infer<typeof pageItemSchema>>({
                keyOf: (item) => item.url,
                fetchPage: async (offset) => {
                    const outcomes = await dataForSeoRequest(cfg, '/on_page/pages',
                        [{ id: vendorTaskId, limit: pagesPerRequest, offset }], pagesResultSchema,
                        { operation: 'on-page-pages' });
                    const outcome = outcomes[0];
                    if (!outcome || outcome.status !== 'ok') {
                        throw new VendorMalformedError('on_page/pages not ok', { ...ctx, operation: 'on-page-pages' });
                    }
                    const result = outcome.result[0]!;
                    return { items: result.items ?? [], total: result.total_items_count ?? vendorPagesCrawled };
                },
            });
            const pages = crawled.items.map(normalizePage);
            // Overlay broken links per URL.
            const brokenByUrl = await fetchBrokenLinks(cfg, vendorTaskId, pagesPerRequest);
            // Overlay non-indexable reasons per URL.
            const nonIndexableByUrl = await fetchNonIndexable(cfg, vendorTaskId, pagesPerRequest);
            for (const page of pages) {
                const broken = brokenByUrl.get(page.url);
                if (broken)
                    page.brokenLinks = broken;
                const reason = nonIndexableByUrl.get(page.url);
                // A locale page whose canonical names itself (up to protocol, `www.`,
                // case or a trailing slash) is its own page, not a canonicalised
                // duplicate of another locale.
                if (reason !== undefined && !(/canonical/i.test(reason) && isSelfCanonical(page))) {
                    page.isIndexable = false;
                    page.nonIndexableReason = reason;
                    // A robots.txt exclusion is a recorded cause in its own
                    // right; it never overwrites a fetch failure the row carries.
                    if (!page.fetchFailure && /robots/i.test(reason)) {
                        page.fetchFailure = { kind: 'robots_blocked' };
                    }
                }
            }
            const resourceScan = options?.resourceScan === true;
            const extras = await readExtraSignals(cfg, vendorTaskId, pages, { pagesPerRequest, resourceScan });
            return { domainChecks, pages, ...(vendorPagesCrawled !== undefined ? { vendorPagesCrawled } : {}),
                ...(crawlStopReason ? { crawlStopReason } : {}),
                capabilities: { resourceScan }, ...extras };
        },
    };
}
const NON_VISITOR_LINK_TYPES: ReadonlySet<string> = new Set([
    'alternate',
    'canonical',
    'link',
    'meta',
    'redirect',
]);
async function fetchBrokenLinks(cfg: DataForSeoOnPageProviderConfig, vendorTaskId: string, pagesPerRequest: number): Promise<Map<string, string[]>> {
    const byUrl = new Map<string, string[]>();
    let offset = 0;
    const maxLoops = 100;
    for (let loop = 0; loop < maxLoops; loop += 1) {
        const outcomes = await dataForSeoRequest(cfg, '/on_page/links', [
            {
                id: vendorTaskId,
                limit: pagesPerRequest,
                offset,
                filters: [
                    ['is_broken', '=', true],
                    'and',
                    ['direction', '=', 'internal'],
                ],
            },
        ], linksResultSchema, { operation: 'on-page-links' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('on_page/links not ok', {
                provider: 'dataforseo',
                operation: 'on-page-links',
            });
        }
        /* c8 ignore next -- items is nullable in schema; every real response either has items or an empty array. */
        const items = outcome.result[0]!.items ?? [];
        if (items.length === 0)
            break;
        for (const item of items) {
            if (!item.is_broken || item.direction !== 'internal')
                continue;
            // Only links a visitor follows count. hreflang/alternate, canonical and
            // other <link> or <meta> references, and the crawler's own redirect
            // hops, are not "broken links on the page".
            if (typeof item.type === 'string' && NON_VISITOR_LINK_TYPES.has(item.type))
                continue;
            const from = item.link_from;
            const to = item.link_to;
            if (!from || !to)
                continue;
            const existing = byUrl.get(from);
            if (existing)
                existing.push(to);
            else
                byUrl.set(from, [to]);
        }
        offset += items.length;
        if (items.length < pagesPerRequest)
            break;
    }
    return byUrl;
}
/** True when the page's canonical tag points at the page itself. */
function isSelfCanonical(page: AuditPage): boolean {
    if (!page.canonical)
        return false;
    const key = (raw: string): string | null => {
        try {
            const url = new URL(raw, page.url);
            const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '/';
            return `${url.hostname.toLowerCase().replace(/^www\./, '')}${path}${url.search}`;
        }
        catch {
            return null;
        }
    };
    return key(page.url) === key(page.canonical);
}
async function fetchNonIndexable(cfg: DataForSeoOnPageProviderConfig, vendorTaskId: string, pagesPerRequest: number): Promise<Map<string, string>> {
    const byUrl = new Map<string, string>();
    let offset = 0;
    const maxLoops = 100;
    for (let loop = 0; loop < maxLoops; loop += 1) {
        const outcomes = await dataForSeoRequest(cfg, '/on_page/non_indexable', [{ id: vendorTaskId, limit: pagesPerRequest, offset }], nonIndexableResultSchema, { operation: 'on-page-non-indexable' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('on_page/non_indexable not ok', {
                provider: 'dataforseo',
                operation: 'on-page-non-indexable',
            });
        }
        /* c8 ignore next -- items is nullable in schema; every real response either has items or an empty array. */
        const items = outcome.result[0]!.items ?? [];
        if (items.length === 0)
            break;
        for (const item of items) {
            if (!item.url)
                continue;
            byUrl.set(item.url, item.reason ?? 'unknown');
        }
        offset += items.length;
        /* c8 ignore next -- the FALSE path (full page → continue) requires a full-page fixture; not exercised in current tests. */
        if (items.length < pagesPerRequest)
            break;
    }
    return byUrl;
}
function normalizeDomainChecks(checks: Record<string, unknown> | undefined): AuditResult['domainChecks'] {
    const bool = (key: string): boolean => checks?.[key] === true;
    const httpsRedirect = typeof checks?.test_https_redirect === 'boolean'
        ? checks.test_https_redirect
        : typeof checks?.http_to_https_redirect === 'boolean'
            ? checks.http_to_https_redirect
            : undefined;
    return {
        robotsTxtFound: bool('robots_txt'),
        sitemapFound: bool('sitemap'),
        httpsEnforced: bool('ssl') || httpsRedirect === true,
        canonicalizationOk: typeof checks?.test_www_redirect === 'boolean'
            ? checks.test_www_redirect
            : bool('canonicalization'),
        ...(httpsRedirect === undefined ? {} : { httpsRedirect }),
    };
}
const HTML_MEDIA_TYPES: ReadonlySet<string> = new Set(['text/html', 'application/xhtml+xml']);
/** Resolves a redirect `location` against the row URL; `undefined` when it is not a URL. */
function resolveLocation(location: string | null | undefined, base: string): string | undefined {
    if (!location)
        return undefined;
    try {
        return new URL(location, base).toString();
    }
    catch {
        return undefined;
    }
}
/**
 * Fetch evidence the crawler row itself records: the redirect target of a 3xx
 * row (`location`), the served media type, and an error status. Nothing is
 * inferred; a row without these fields yields no evidence.
 */
function fetchEvidence(item: z.infer<typeof pageItemSchema>): Pick<AuditPage, 'finalUrl' | 'redirectChain' | 'contentType' | 'fetchFailure'> {
    const status = item.status_code;
    const media = item.media_type?.split(';')[0]?.trim().toLowerCase();
    const contentType = media ? media : undefined;
    const target = status >= 300 && status < 400 ? resolveLocation(item.location, item.url) : undefined;
    let fetchFailure: PageFetchFailure | undefined;
    if (status >= 400) {
        fetchFailure = { kind: 'http_error', statusCode: status };
    }
    else if (status >= 200 && status < 300 && contentType && !HTML_MEDIA_TYPES.has(contentType)) {
        fetchFailure = { kind: 'non_html', contentType };
    }
    return {
        ...(target ? { finalUrl: target, redirectChain: [{ url: item.url, status }] } : {}),
        ...(contentType ? { contentType } : {}),
        ...(fetchFailure ? { fetchFailure } : {}),
    };
}
function normalizePage(item: z.infer<typeof pageItemSchema>): AuditPage {
    const meta = item.meta ?? {};
    const checks = item.checks ?? {};
    const timing = normalizeTiming(item.page_timing ?? undefined);
    // `has_micromarkup` covers inline HTML microdata only; pages that ship
    // JSON-LD are re-checked by the audit processor's structured-data probe.
    const hasStructuredData = checks.has_micromarkup === true;
    const structuredDataErrors: string[] = checks.has_micromarkup_errors === true
        ? ['micromarkup errors reported by vendor']
        : [];
    const isIndexable = checks.is_broken !== true;
    // Content signals only describe a page that served a body: a redirect or
    // error row reports a zero word count that would read as "thin".
    const servedBody = Math.floor(item.status_code / 100) === 2;
    const wordCount = servedBody ? meta.content?.plain_text_word_count : undefined;
    const textSize = servedBody ? meta.content?.plain_text_size : undefined;
    // Only a page the vendor described (served body + meta) can answer the FAQ
    // question; a served page with no headings has no FAQ headings either,
    // while a missing meta block stays "not evaluated".
    const hasFaqSignals = servedBody && item.meta ? (meta.htags ? hasQuestionHeadings(meta.htags) : false) : undefined;
    return {
        url: item.url,
        statusCode: item.status_code,
        title: meta.title ?? null,
        metaDescription: meta.description ?? null,
        h1: meta.htags?.h1 ?? [],
        h2: meta.htags?.h2 ?? [],
        canonical: meta.canonical ?? null,
        hasStructuredData,
        structuredDataErrors,
        isIndexable,
        brokenLinks: [],
        onPageScore: item.onpage_score ?? 0,
        ...(typeof wordCount === 'number' ? { wordCount: Math.round(wordCount) } : {}),
        ...(typeof textSize === 'number' ? { textSize: Math.round(textSize) } : {}),
        ...(hasFaqSignals !== undefined ? { hasFaqSignals } : {}),
        ...(timing ? { timing } : {}),
        ...fetchEvidence(item),
        ...normalizeDeepPageFields(item),
    };
}
/** Question marks in the scripts the product ships (Latin, CJK full-width, Arabic). */
const QUESTION_HEADING = /[?？؟]\s*$/;
/**
 * FAQ / Q&A signal from the crawled heading outline: a page with at least one
 * question-style heading answers a buyer question on the page.
 */
function hasQuestionHeadings(htags: NonNullable<z.infer<typeof pageMetaSchema>['htags']>): boolean {
    return [htags.h1, htags.h2, htags.h3, htags.h4].some((level) => (level ?? []).some((heading) => QUESTION_HEADING.test(heading)));
}
function normalizeTiming(timing: z.infer<typeof pageTimingSchema>): AuditPageTiming | undefined {
    if (!timing)
        return undefined;
    const out: AuditPageTiming = {};
    if (typeof timing.time_to_interactive === 'number') {
        out.timeToInteractiveMs = timing.time_to_interactive;
    }
    if (typeof timing.duration_time === 'number') {
        out.fetchMs = timing.duration_time;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}
