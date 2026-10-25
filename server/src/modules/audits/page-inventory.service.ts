import { Types } from 'mongoose';
import { hasTranslationKey, localizeSemanticCopy, type SupportedLocale, } from '../../shared/i18n/index.js';
import { isNotEvaluatedFinding } from '../../shared/audit-findings.js';
import type { CoverageProbe, PageFetchFailure, RedirectHop } from '../../shared/providers/index.js';
import { AuditRun } from './audit-run.model.js';
import { AuditedPage } from './audited-page.model.js';
import { ReportSnapshot } from './report-snapshot.model.js';
import { readStopReason, type AuditRunStopReason, type AuditStopReasonSource } from './crawl-stop-reason.js';
export const PAGES_AUDIT_INVENTORY_MAX = 5000;
export interface AuditPageInventoryRow {
    url: string;
    title: string | null;
    isIndexable: boolean;
    nonIndexableReason: string | null;
    onPageScore: number | null;
    /** HTTP status the crawl recorded for the row. */
    statusCode?: number;
    /** Fetch evidence; all absent on runs that predate it. */
    finalUrl?: string | null;
    redirectChain?: RedirectHop[];
    contentType?: string | null;
    fetchFailure?: PageFetchFailure | null;
}
/**
 * What the last completed crawl recorded about itself, so a small inventory
 * can say why it is small. Every field is evidence the run stored; `null` =
 * not recorded (an older run, or not reported).
 */
export interface AuditLastCrawl {
    finishedAt: string | null;
    /** Page limit the audit ran with. */
    pageCap: number;
    /** Pages stored for the run. */
    pagesStored: number | null;
    /** Pages the crawl vendor said it crawled. */
    vendorPagesCrawled: number | null;
    /**
     * Why the crawl stopped. Older runs that stored no reason get one derived
     * from their counts (`stopReasonSource: 'derived'`); `null` = not recorded
     * and not derivable.
     */
    stopReason: AuditRunStopReason | null;
    stopReasonSource: AuditStopReasonSource | null;
    /** A sitemap was found; `null` when the check could not tell. */
    sitemapFound: boolean | null;
}
export interface AuditPageInventory {
    runId: string | null;
    rows: AuditPageInventoryRow[];
    fetchedCount: number;
    truncated: boolean;
    /**
     * Requests we made for URLs the crawl did not return. `null` = the run
     * predates this evidence (or there is no run), so absence from the crawl
     * has no recorded cause; `[]` = nothing was missing.
     */
    coverageProbes?: CoverageProbe[] | null;
    /** The crawl's own record; `null` when there is no completed crawl. */
    lastCrawl?: AuditLastCrawl | null;
}
/** Bounded account/site-scoped projection used by Pages through this module's barrel. */
export async function readLatestCompletedPageInventory(accountId: string, siteId: string, limit = PAGES_AUDIT_INVENTORY_MAX): Promise<AuditPageInventory> {
    if (!Types.ObjectId.isValid(accountId) || !Types.ObjectId.isValid(siteId)) {
        return { runId: null, rows: [], fetchedCount: 0, truncated: false, coverageProbes: null, lastCrawl: null };
    }
    const run = await AuditRun.findOne({
        accountId,
        siteId,
        kind: 'site',
        status: 'succeeded',
    })
        .sort({ _id: -1 })
        .select({
        _id: 1,
        coverageProbes: 1,
        pageCap: 1,
        pagesCrawled: 1,
        vendorPagesCrawled: 1,
        crawlStopReason: 1,
        finishedAt: 1,
        'result.domainChecks.sitemapFound': 1,
        'result.domainChecks.sitemapUnconfirmed': 1,
    })
        .lean();
    if (!run) {
        return { runId: null, rows: [], fetchedCount: 0, truncated: false, coverageProbes: null, lastCrawl: null };
    }
    const bounded = Math.min(Math.max(limit, 1), PAGES_AUDIT_INVENTORY_MAX);
    const docs = await AuditedPage.find({ runId: run._id }, {
        _id: 0,
        url: 1,
        title: 1,
        isIndexable: 1,
        nonIndexableReason: 1,
        onPageScore: 1,
        statusCode: 1,
        finalUrl: 1,
        redirectChain: 1,
        contentType: 1,
        fetchFailure: 1,
    })
        .sort({ url: 1, _id: 1 })
        .limit(bounded + 1)
        .lean();
    return {
        runId: String(run._id),
        fetchedCount: docs.length,
        truncated: docs.length > bounded,
        coverageProbes: run.coverageProbes ? run.coverageProbes.map(toCoverageProbe) : null,
        lastCrawl: toLastCrawl(run),
        rows: docs.slice(0, bounded).map((row) => ({
            url: row.url,
            title: row.title ?? null,
            isIndexable: row.isIndexable,
            nonIndexableReason: row.nonIndexableReason ?? null,
            onPageScore: Number.isFinite(row.onPageScore) ? row.onPageScore : null,
            statusCode: row.statusCode,
            finalUrl: row.finalUrl ?? null,
            redirectChain: (row.redirectChain ?? []).map((hop) => ({ url: hop.url, status: hop.status })),
            contentType: row.contentType ?? null,
            fetchFailure: row.fetchFailure ? toFetchFailure(row.fetchFailure) : null,
        })),
    };
}
export function toLastCrawl(run: {
    pageCap: number;
    pagesCrawled?: number | null;
    vendorPagesCrawled?: number | null;
    crawlStopReason?: AuditRunStopReason | null;
    finishedAt?: Date | null;
    result?: unknown;
}): AuditLastCrawl {
    const checks = (run.result as {
        domainChecks?: {
            sitemapFound?: unknown;
            sitemapUnconfirmed?: unknown;
        };
    } | null)?.domainChecks;
    return {
        finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
        pageCap: run.pageCap,
        pagesStored: run.pagesCrawled ?? null,
        vendorPagesCrawled: run.vendorPagesCrawled ?? null,
        ...readStopReason(run),
        // The vendor's "no sitemap" alone is not proof when our probe could not tell.
        sitemapFound: typeof checks?.sitemapFound === 'boolean' && checks.sitemapUnconfirmed !== true
            ? checks.sitemapFound
            : null,
    };
}
function toFetchFailure(stored: {
    kind: PageFetchFailure['kind'];
    statusCode?: number | null | undefined;
    contentType?: string | null | undefined;
}): PageFetchFailure {
    return {
        kind: stored.kind,
        ...(typeof stored.statusCode === 'number' ? { statusCode: stored.statusCode } : {}),
        ...(typeof stored.contentType === 'string' ? { contentType: stored.contentType } : {}),
    };
}
function toCoverageProbe(stored: {
    url: string;
    source: CoverageProbe['source'];
    statusCode?: number | null | undefined;
    finalUrl?: string | null | undefined;
    redirectChain?: Array<{
        url: string;
        status: number;
    }> | null | undefined;
    contentType?: string | null | undefined;
    failure?: Parameters<typeof toFetchFailure>[0] | null | undefined;
}): CoverageProbe {
    return {
        url: stored.url,
        source: stored.source,
        statusCode: stored.statusCode ?? null,
        finalUrl: stored.finalUrl ?? null,
        redirectChain: (stored.redirectChain ?? []).map((hop) => ({ url: hop.url, status: hop.status })),
        contentType: stored.contentType ?? null,
        failure: stored.failure ? toFetchFailure(stored.failure) : null,
    };
}
/**
 * The one definition of "a page" for every reader of a crawl (Pages, Schema
 * markup, AI visibility evidence): a stored row that answered 2xx, is
 * indexable and had no fetch failure. Redirect sources, errors and non-HTML
 * files are crawled URLs, not pages. Locale versions such as `/ar/` and
 * `/de/` are distinct pages.
 */
export const INVENTORY_PAGE_FILTER = {
    statusCode: { $gte: 200, $lt: 300 },
    isIndexable: { $ne: false },
    fetchFailure: null,
} as const;
/**
 * Identity of a page across protocol, `www.`, letter case of the host and a
 * trailing slash: the same address crawled twice is one page.
 */
export function inventoryPageKey(url: string): string {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : '/';
        return `${host}${path}${parsed.search}`;
    }
    catch {
        return url;
    }
}
/** Inventory pages of one run, one row per page (first by URL wins), bounded. */
export async function readInventoryPages<T extends {
    url: string;
}>(runId: unknown, projection: Record<string, 0 | 1>, limit: number): Promise<{
    pages: T[];
    total: number;
}> {
    const rows = (await AuditedPage.find({ runId, ...INVENTORY_PAGE_FILTER })
        .sort({ url: 1, _id: 1 })
        .limit(PAGES_AUDIT_INVENTORY_MAX)
        .select({ ...projection, url: 1 })
        .lean()) as unknown as T[];
    const seen = new Set<string>();
    const pages: T[] = [];
    for (const row of rows) {
        const key = inventoryPageKey(row.url);
        if (seen.has(key))
            continue;
        seen.add(key);
        pages.push(row);
    }
    return { pages: pages.slice(0, limit), total: pages.length };
}
/** Page facts the deep crawl recorded for one page. */
export interface AuditPageCrawlFacts {
    clickDepth?: number;
    inboundInternalLinks?: number;
    pageSizeBytes?: number;
    serverResponseMs?: number;
}
/** One open finding of the latest audit that names this page. */
export interface AuditPageIssue {
    ruleId: string;
    bucket: 'fix-now' | 'watch';
    severity: 'critical' | 'warning' | 'info';
    /** The rule's localized title, as the report shows it. */
    title: string;
}
export interface AuditPageDetail {
    runId: string;
    facts: AuditPageCrawlFacts;
    issues: AuditPageIssue[];
}
const PAGE_FACT_KEYS = ['clickDepth', 'inboundInternalLinks', 'pageSizeBytes', 'serverResponseMs'] as const;
/**
 * The latest completed audit's view of one page: the crawl facts stored for
 * it and the open findings that list it — directly, or through a resource the
 * page loads. Same findings the report shows, read from the frozen snapshot;
 * `null` when there is no completed audit or the page was not crawled.
 *
 * `isPage` decides whether a stored address is this page, so the caller's one
 * address-matching authority (the Pages module) stays the only one.
 */
export async function readLatestAuditPageDetail(accountId: string, siteId: string, isPage: (url: string) => boolean, locale: SupportedLocale): Promise<AuditPageDetail | null> {
    if (!Types.ObjectId.isValid(accountId) || !Types.ObjectId.isValid(siteId))
        return null;
    const run = await AuditRun.findOne({ accountId, siteId, kind: 'site', status: 'succeeded' })
        .sort({ _id: -1 })
        .select({ _id: 1 })
        .lean();
    if (!run)
        return null;
    const candidates = await AuditedPage.find({ runId: run._id, ...INVENTORY_PAGE_FILTER })
        .sort({ url: 1, _id: 1 })
        .limit(PAGES_AUDIT_INVENTORY_MAX)
        .select({ url: 1, ...Object.fromEntries(PAGE_FACT_KEYS.map((fact) => [fact, 1])) })
        .lean();
    const stored = candidates.find((row) => isPage(row.url));
    if (!stored)
        return null;
    const facts: AuditPageCrawlFacts = {};
    for (const fact of PAGE_FACT_KEYS) {
        const value = stored[fact];
        if (typeof value === 'number')
            facts[fact] = value;
    }
    const snapshot = await ReportSnapshot.findOne({ runId: run._id }).select({ findings: 1 }).lean();
    const issues: AuditPageIssue[] = [];
    for (const finding of snapshot?.findings ?? []) {
        if (finding.bucket === 'passed' || isNotEvaluatedFinding(finding))
            continue;
        if (!findingNamesPage(finding, isPage))
            continue;
        // A stored id this release no longer ships has no copy to show.
        const titleKey = `auditRules.${finding.ruleId}.title`;
        if (!hasTranslationKey(titleKey))
            continue;
        issues.push({
            ruleId: finding.ruleId,
            bucket: finding.bucket,
            severity: finding.severity,
            title: localizeSemanticCopy(locale, titleKey).message,
        });
    }
    return { runId: String(run._id), facts, issues };
}
/** A finding lists the page itself, or a resource whose `usedOn` includes it. */
function findingNamesPage(finding: {
    affectedUrls: string[];
    meta?: unknown;
}, isPage: (url: string) => boolean): boolean {
    if (finding.affectedUrls.some(isPage))
        return true;
    const resources = (finding.meta as {
        resources?: unknown;
    } | null | undefined)?.resources;
    if (!Array.isArray(resources))
        return false;
    return resources.some((resource) => {
        const usedOn = (resource as {
            usedOn?: unknown;
        } | null)?.usedOn;
        return Array.isArray(usedOn) && usedOn.some((used) => typeof used === 'string' && isPage(used));
    });
}
