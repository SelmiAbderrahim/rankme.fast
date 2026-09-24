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
import { dataForSeoRequest, type DataForSeoConfig } from '../http.js';
import { VendorMalformedError, VendorUnavailableError, } from '../errors.js';
import type { AuditPage, AuditPageTiming, AuditProvider, AuditResult, AuditStatus, StartAuditInput, } from '../types.js';
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
const summaryResultSchema = z
    .array(z
    .object({
    crawl_progress: z.string().optional(),
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
export interface DataForSeoOnPageProviderConfig extends DataForSeoConfig {
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
        async getAuditResult(vendorTaskId: string): Promise<AuditResult> {
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
            // Paginate /on_page/pages — vendor total exposed via `crawl_status.pages_crawled`
            // or `page_metrics.checks`. Guard with a bound to avoid infinite loops.
            /* c8 ignore next -- pages_crawled is present on every finished summary; the fallback exists so a defensive missing field doesn't cap pages at 0. */
            const total = summary.crawl_status?.pages_crawled ?? Number.MAX_SAFE_INTEGER;
            const pages: AuditPage[] = [];
            let offset = 0;
            const maxPagesLoops = 100;
            for (let loop = 0; loop < maxPagesLoops; loop += 1) {
                const outcomes = await dataForSeoRequest(cfg, '/on_page/pages', [{ id: vendorTaskId, limit: pagesPerRequest, offset }], pagesResultSchema, { operation: 'on-page-pages' });
                const outcome = outcomes[0];
                if (!outcome || outcome.status !== 'ok') {
                    throw new VendorMalformedError('on_page/pages not ok', {
                        ...ctx,
                        operation: 'on-page-pages',
                    });
                }
                /* c8 ignore next -- items is nullable in schema; every real response either has items or an empty array. */
                /* c8 ignore next -- items is nullable in schema; every real response either has items or an empty array. */
                const items = outcome.result[0]!.items ?? [];
                if (items.length === 0)
                    break;
                for (const item of items) {
                    pages.push(normalizePage(item));
                }
                offset += items.length;
                if (items.length < pagesPerRequest || pages.length >= total)
                    break;
            }
            // Overlay broken links per URL.
            const brokenByUrl = await fetchBrokenLinks(cfg, vendorTaskId, pagesPerRequest);
            // Overlay non-indexable reasons per URL.
            const nonIndexableByUrl = await fetchNonIndexable(cfg, vendorTaskId, pagesPerRequest);
            for (const page of pages) {
                const broken = brokenByUrl.get(page.url);
                if (broken)
                    page.brokenLinks = broken;
                const reason = nonIndexableByUrl.get(page.url);
                if (reason !== undefined) {
                    page.isIndexable = false;
                    page.nonIndexableReason = reason;
                }
            }
            return { domainChecks, pages };
        },
    };
}
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
    return {
        robotsTxtFound: bool('robots_txt'),
        sitemapFound: bool('sitemap'),
        httpsEnforced: bool('ssl') || bool('http_to_https_redirect'),
        canonicalizationOk: bool('canonicalization'),
    };
}
function normalizePage(item: z.infer<typeof pageItemSchema>): AuditPage {
    const meta = item.meta ?? {};
    const checks = item.checks ?? {};
    const timing = normalizeTiming(item.page_timing ?? undefined);
    const hasStructuredData = checks.has_micromarkup === true;
    const structuredDataErrors: string[] = checks.has_micromarkup_errors === true
        ? ['micromarkup errors reported by vendor']
        : [];
    const isIndexable = checks.is_broken !== true;
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
        ...(timing ? { timing } : {}),
    };
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
