import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from '../../db/client.js';
import type { GscSearchAnalyticsSnapshotRow, PagePerformanceKeyword, PagePerformanceSnapshot } from '../../db/schema/index.js';
import { readLatestAuditPageDetail, readLatestCompletedPageInventory, resolveCrawlState, type AuditPageDetail, type AuditPageInventory, type AuditPageInventoryRow, } from '../audits/index.js';
import type { CoverageProbe } from '../../shared/providers/index.js';
import type { SupportedLocale } from '../../shared/i18n/index.js';
import { resolveStoredPagesGscState, type StoredPagesGscState, } from '../google-connections/index.js';
import { readLatestGscSyncRun, readLatestPagesGscSnapshot, readPagesGscHistory, readPagesGscSnapshotAtDate, readPreviousPagesGscSnapshot, type PagesGscSnapshot, } from '../gsc-snapshots/index.js';
import { SITE_RANKED_KEYWORD_CACHE_TTL_MS } from '../ranks/index.js';
import { loadOwnedSite } from '../sites/index.js';
import { DEFAULT_PAGES_DIRECTIONS, PAGES_INSIGHTS, type PagesInsight, type PagesListQuery, type PagesRange, type PagesSort, } from './pages.schema.js';
import { createPagesRepository, type PagesRepository, } from './pages.repository.js';
import type { PagesFallbackRefreshService } from './fallback-refresh.service.js';
import { resolvePagesFallbackMarket, type PagesFallbackMarket, type PagesSiteMarket, } from './market-resolver.js';
import { canonicalizePageUrl } from './url-normalizer.js';
import { describePositionChange } from '../../shared/utils/position-change.js';
import type { PageAssociatedQueryState, PageDeltas, PageMetrics, PageQueryRow, PageRow, PagesCoverage, PagesDetailResponse, PagesEnvelope, PagesFallbackReason, PagesListResponse, PagesRefreshResponse, PagesSource, PagesStatus, TrendPoint, } from './pages.types.js';
const DAY_MS = 24 * 60 * 60 * 1000;
const GSC_STALE_MS = 48 * 60 * 60 * 1000;
const CURSOR_TTL_MS = DAY_MS;
const GSC_SEPARATOR = '\u001f';
export type PagesErrorCode = 'PAGES_INVALID_REQUEST' | 'PAGES_INVALID_CURSOR' | 'PAGES_SITE_NOT_FOUND' | 'PAGES_PAGE_NOT_FOUND' | 'PAGES_RATE_LIMITED' | 'PAGES_CAP_EXCEEDED' | 'PAGES_GSC_UNAVAILABLE' | 'PAGES_PROVIDER_UNAVAILABLE' | 'PAGES_REFRESH_FAILED';
export class PagesError extends Error {
    constructor(readonly status: number, readonly code: PagesErrorCode, readonly messageKey: string, readonly details?: Record<string, unknown>, readonly state?: PagesListResponse) {
        super(messageKey);
        this.name = 'PagesError';
    }
}
interface SiteShape {
    id: string;
    url: string;
    domain: string;
    /** The site's default market drives the fallback snapshot market. */
    defaultMarket?: PagesSiteMarket | null;
}
interface MaterialPage extends Omit<PageRow, 'associatedQueryState'> {
    /**
     * pageId of the listed page this URL is another address of (a redirect
     * source, or the un-prefixed twin of a locale page). Such a row stays in
     * the list, labelled, but is not a separate page in the inventory count.
     */
    aliasOf?: string;
    associated: PageQueryRow[];
    searchText: string;
    weight: number;
    previousClicks: number | null;
}
interface SourceMaterial {
    site: SiteShape;
    envelope: PagesEnvelope;
    pages: MaterialPage[];
    inventoryFingerprint: string;
    sourceSnapshot: PagesGscSnapshot | PagePerformanceSnapshot | null;
    fallbackContext: PagesFallbackMarket | null;
    auditRunId: string | null;
}
interface CursorPayload {
    v: 1;
    q: string;
    i: string;
    n: boolean;
    p: string | number | null;
    u: string;
    id: string;
    iat: number;
    exp: number;
}
export interface PagesServiceDeps {
    db: Db;
    cursorSecret: string;
    providerSelection: 'fake' | 'dataforseo';
    fallbackRefresh: PagesFallbackRefreshService;
    now?: () => Date;
    repository?: PagesRepository;
    loadSite?: (accountId: string, siteId: string) => Promise<SiteShape>;
    resolveGscState?: (accountId: string, siteId: string, siteUrl: string) => Promise<StoredPagesGscState>;
    readAudit?: (accountId: string, siteId: string) => Promise<AuditPageInventory>;
    /** One page's crawl facts and open audit findings; `isPage` matches stored addresses to the page. */
    readAuditPageDetail?: (accountId: string, siteId: string, isPage: (url: string) => boolean, locale: SupportedLocale) => Promise<AuditPageDetail | null>;
    syncGsc?: (input: {
        accountId: string;
        siteId: string;
        domain: string;
        propertyUrlHash: string;
        bindingGenerationId: string;
    }) => Promise<{
        status: 'ok' | 'no-data' | 'not-connected' | 'needs-reconnect' | 'unavailable';
        snapshotDate: string | null;
    }>;
    telemetry?: (event: string, fields: Record<string, unknown>) => void;
}
export interface PagesService {
    list(accountId: string, siteId: string, query: PagesListQuery): Promise<PagesListResponse>;
    detail(accountId: string, siteId: string, pageId: string, range: PagesRange, locale?: SupportedLocale): Promise<PagesDetailResponse>;
    refresh(accountId: string, siteId: string): Promise<PagesRefreshResponse>;
}
function nullMetrics(source: PagesSource = 'none'): PageMetrics {
    return {
        clicks: source === 'gsc' ? 0 : null,
        impressions: source === 'gsc' ? 0 : null,
        ctr: null,
        averagePosition: null,
        bestPosition: null,
        keywordCount: null,
        searchVolume: null,
        difficulty: null,
        estimatedTraffic: null,
        associatedQueryCount: null,
    };
}
function hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
/** Inclusive `[endDate - (days - 1), endDate]` window of a GSC snapshot. */
function gscDataWindow(endDate: string, days: number): {
    startDate: string;
    endDate: string;
} {
    const end = new Date(`${endDate}T00:00:00.000Z`);
    const start = new Date(end.getTime() - (days - 1) * 86_400_000);
    return { startDate: start.toISOString().slice(0, 10), endDate };
}
function rangeDays(range: PagesRange): 7 | 28 | 90 {
    return Number.parseInt(range, 10) as 7 | 28 | 90;
}
function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}
function finite(value: number): number | null {
    return Number.isFinite(value) ? value : null;
}
function sumKnown(values: readonly (number | null)[]): number | null {
    const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
    return known.length ? finite(known.reduce((sum, value) => sum + value, 0)) : null;
}
function weightedAverage(rows: readonly {
    value: number;
    weight: number;
}[]): number | null {
    const positive = rows.filter((row) => row.weight > 0 && Number.isFinite(row.value));
    if (positive.length > 0) {
        const weight = positive.reduce((sum, row) => sum + row.weight, 0);
        return finite(positive.reduce((sum, row) => sum + row.value * row.weight, 0) / weight);
    }
    const known = rows.filter((row) => Number.isFinite(row.value));
    return known.length
        ? finite(known.reduce((sum, row) => sum + row.value, 0) / known.length)
        : null;
}
/**
 * `positionChange` stays `previous − current` (positive = closer to #1) for the
 * sort and the insight rules; `position` is the explicit contract the UI
 * renders, so no reader has to guess which way the signed number points.
 */
function deltas(current: PageMetrics, previous: PageMetrics | null, range: PagesRange): PageDeltas {
    const previousPosition = previous?.averagePosition ?? null;
    const positionChange = current.averagePosition !== null && previousPosition !== null
        ? previousPosition - current.averagePosition
        : null;
    const clickChangePct = current.clicks !== null && previous?.clicks !== null && previous?.clicks !== undefined && previous.clicks !== 0
        ? (current.clicks - previous.clicks) / previous.clicks
        : null;
    return {
        positionChange,
        clickChangePct,
        position: describePositionChange(current.averagePosition, previousPosition, { range, comparison: 'previous_sync' }),
    };
}
/**
 * Below this many observed Search Console impressions, with no click, a page
 * has too little evidence for a movement label: a three-position swing at
 * position 50 on three impressions is noise, not a win or a loss.
 */
export const PAGES_MIN_EVIDENCE_IMPRESSIONS = 20;
/** A position-driven "winning" label needs a first-page result or a real click. */
export const PAGES_WINNING_MAX_POSITION = 10;
export function classifyPageInsights(row: Pick<PageRow, 'performanceSource' | 'isIndexable' | 'metrics'> & {
    deltas: Pick<PageDeltas, 'positionChange' | 'clickChangePct'>;
}, previousClicks: number | null): PagesInsight[] {
    const { metrics, deltas: change } = row;
    const insights: PagesInsight[] = [];
    const lowData = row.performanceSource === 'gsc' &&
        (metrics.clicks ?? 0) <= 0 &&
        (metrics.impressions ?? 0) < PAGES_MIN_EVIDENCE_IMPRESSIONS;
    if (metrics.averagePosition !== null &&
        metrics.averagePosition > 3 &&
        metrics.averagePosition <= 20 &&
        ((metrics.impressions ?? -1) >= 100 || (metrics.searchVolume ?? -1) >= 100))
        insights.push('striking_distance');
    if (row.performanceSource === 'gsc' &&
        (metrics.impressions ?? -1) >= 100 &&
        metrics.averagePosition !== null &&
        metrics.averagePosition <= 10 &&
        metrics.ctr !== null &&
        metrics.ctr < 0.02)
        insights.push('low_ctr');
    if (!lowData && ((change.positionChange !== null && change.positionChange <= -3) ||
        (row.performanceSource === 'gsc' && previousClicks !== null && previousClicks >= 10 && change.clickChangePct !== null && change.clickChangePct <= -0.2)))
        insights.push('declining');
    if (!lowData && ((change.positionChange !== null &&
        change.positionChange >= 3 &&
        ((metrics.averagePosition !== null && metrics.averagePosition <= PAGES_WINNING_MAX_POSITION) ||
            (metrics.clicks ?? 0) > 0)) ||
        (row.performanceSource === 'gsc' && previousClicks !== null && previousClicks >= 10 && change.clickChangePct !== null && change.clickChangePct >= 0.2)))
        insights.push('winning');
    if (row.isIndexable === false && row.performanceSource !== null)
        insights.push('non_indexable_visibility');
    if (lowData)
        insights.push('low_data');
    if (row.performanceSource === null)
        insights.push('unmeasured');
    return PAGES_INSIGHTS.filter((insight) => insights.includes(insight));
}
function aggregateFallback(rows: readonly PagePerformanceKeyword[]): PageMetrics {
    const volumeWeights = rows.map((row) => ({ value: row.position, weight: Math.max(row.searchVolume ?? 0, 0) }));
    const difficulties = rows
        .filter((row): row is PagePerformanceKeyword & {
        difficulty: number;
    } => row.difficulty !== null)
        .map((row) => ({ value: row.difficulty, weight: Math.max(row.searchVolume ?? 0, 0) }));
    return {
        clicks: null,
        impressions: null,
        ctr: null,
        averagePosition: weightedAverage(volumeWeights),
        bestPosition: Math.min(...rows.map((row) => row.position)),
        keywordCount: rows.length,
        searchVolume: sumKnown(rows.map((row) => row.searchVolume)),
        difficulty: weightedAverage(difficulties),
        estimatedTraffic: sumKnown(rows.map((row) => row.estimatedTraffic)),
        associatedQueryCount: rows.length,
    };
}
function aggregateGsc(rows: readonly GscSearchAnalyticsSnapshotRow[]): PageMetrics {
    const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    return {
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : null,
        averagePosition: weightedAverage(rows.map((row) => ({ value: row.position, weight: row.impressions }))),
        bestPosition: null,
        keywordCount: null,
        searchVolume: null,
        difficulty: null,
        estimatedTraffic: null,
        // Filled by the caller once it knows whether per-query rows were stored.
        associatedQueryCount: null,
    };
}
function associatedFallback(rows: readonly PagePerformanceKeyword[]): PageQueryRow[] {
    return rows.map((row) => ({
        query: row.keyword,
        position: row.position,
        clicks: null,
        impressions: null,
        ctr: null,
        searchVolume: row.searchVolume,
        difficulty: row.difficulty,
        estimatedTraffic: row.estimatedTraffic,
    }));
}
function associatedGsc(rows: readonly GscSearchAnalyticsSnapshotRow[]): PageQueryRow[] {
    return rows
        .map((row) => ({
        query: row.dimensionKey.split(GSC_SEPARATOR)[0]!,
        position: row.position,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.impressions > 0 ? row.clicks / row.impressions : null,
        searchVolume: null,
        difficulty: null,
        estimatedTraffic: null,
    }))
        .sort((left, right) => right.clicks! - left.clicks! ||
        right.impressions! - left.impressions! ||
        left.query.localeCompare(right.query));
}
function groupByPageHash<T extends {
    pageHash: string;
}>(rows: readonly T[]): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
        const group = groups.get(row.pageHash) ?? [];
        group.push(row);
        groups.set(row.pageHash, group);
    }
    return groups;
}
function emptyCoverage(source: PagesSource): PagesCoverage {
    return {
        reportingLagDays: source === 'gsc' ? 3 : null,
        sampled: source === 'gsc' ? null : null,
        sourceRowsFetched: source === 'gsc' ? null : 0,
        sourceRowsAccepted: 0,
        sourceRowsDropped: 0,
        dropped: { malformedUrl: 0, offsiteUrl: 0, duplicateUrl: 0, invalidMetric: 0 },
        sourceLimit: source === 'gsc' ? 1000 : 100,
        sourceTruncated: false,
        auditRowsFetched: 0,
        auditRowsAccepted: 0,
        auditRowsDropped: 0,
        auditTruncated: false,
        inventoryPages: 0,
        redirectPages: 0,
        measuredPages: 0,
        unmeasuredPages: 0,
        lastCrawl: null,
    };
}
function fallbackStatus(snapshot: PagePerformanceSnapshot, now: Date): PagesStatus {
    if (snapshot.successfulEmpty)
        return 'empty';
    return now.getTime() >= snapshot.cacheFetchedAt.getTime() + SITE_RANKED_KEYWORD_CACHE_TTL_MS
        ? 'stale'
        : 'ready';
}
function materialCacheState(material: SourceMaterial): 'hit' | 'miss' | 'not_applicable' {
    return material.sourceSnapshot && 'cacheStatus' in material.sourceSnapshot
        ? material.sourceSnapshot.cacheStatus
        : 'not_applicable';
}
/** What the last completed crawl knows about each URL, keyed by page hash. */
interface CrawlContext {
    hasCompletedCrawl: boolean;
    rows: Map<string, {
        row: AuditPageInventoryRow;
        displayUrl: string;
    }>;
    probes: Map<string, CoverageProbe>;
}
function mergeAudit(pages: Map<string, MaterialPage>, audit: AuditPageInventory, siteUrl: string, coverage: PagesCoverage, range: PagesRange): CrawlContext {
    const crawl: CrawlContext = {
        hasCompletedCrawl: audit.runId !== null,
        rows: new Map(),
        probes: new Map(),
    };
    coverage.lastCrawl = audit.lastCrawl ?? null;
    const seen = new Set<string>();
    for (const row of audit.rows) {
        const canonical = canonicalizePageUrl(row.url, siteUrl);
        if (!canonical.ok) {
            coverage.auditRowsDropped += 1;
            continue;
        }
        if (seen.has(canonical.value.pageHash)) {
            coverage.auditRowsDropped += 1;
            continue;
        }
        seen.add(canonical.value.pageHash);
        crawl.rows.set(canonical.value.pageHash, { row, displayUrl: canonical.value.displayUrl });
        coverage.auditRowsAccepted += 1;
        const existing = pages.get(canonical.value.pageHash);
        if (existing) {
            existing.title = row.title;
            existing.isIndexable = row.isIndexable;
            existing.nonIndexableReason = row.nonIndexableReason;
            existing.onPageScore = row.onPageScore;
            continue;
        }
        if (!row.isIndexable)
            continue;
        pages.set(canonical.value.pageHash, {
            pageId: canonical.value.pageHash,
            url: canonical.value.canonicalUrl,
            displayUrl: canonical.value.displayUrl,
            title: row.title,
            performanceSource: null,
            isIndexable: true,
            nonIndexableReason: row.nonIndexableReason,
            onPageScore: row.onPageScore,
            crawlState: 'no_crawl',
            crawlEvidence: null,
            metrics: nullMetrics(),
            deltas: { positionChange: null, clickChangePct: null, position: describePositionChange(null, null, { range, comparison: 'previous_sync' }) },
            insights: ['unmeasured'],
            associated: [],
            searchText: '',
            weight: 0,
            previousClicks: null,
        });
    }
    joinLocaleTwins(pages, audit, siteUrl);
    for (const probe of audit.coverageProbes ?? []) {
        const canonical = canonicalizePageUrl(probe.url, siteUrl);
        if (canonical.ok)
            crawl.probes.set(canonical.value.pageHash, probe);
    }
    return crawl;
}
/** `/en`, `/en-us`, `/pt-BR`: a leading locale segment. */
const LOCALE_SEGMENT = /^\/[a-z]{2}(?:-[a-z]{2,4})?(?=\/|$)/i;
function pathOf(url: string): string {
    return new URL(url).pathname;
}
/**
 * Search engines often report the un-prefixed URL (`/pricing`) of a site
 * that redirects to a locale (`/en/pricing`), while the crawl only records
 * the locale page. When exactly one crawled indexable page is that URL with
 * a locale segment in front, borrow its title and name it, so the measured
 * row is not an anonymous untitled page. Ambiguous twins (several locales)
 * are left alone.
 */
function joinLocaleTwins(pages: Map<string, MaterialPage>, audit: AuditPageInventory, siteUrl: string): void {
    const byUnprefixedPath = new Map<string, Array<{
        pageId: string;
        displayUrl: string;
        title: string | null;
    }>>();
    for (const row of audit.rows) {
        if (!row.isIndexable)
            continue;
        const canonical = canonicalizePageUrl(row.url, siteUrl);
        if (!canonical.ok)
            continue;
        const path = pathOf(canonical.value.canonicalUrl);
        const locale = LOCALE_SEGMENT.exec(path);
        if (!locale)
            continue;
        const unprefixed = path.slice(locale[0].length) || '/';
        const twins = byUnprefixedPath.get(unprefixed) ?? [];
        twins.push({ pageId: canonical.value.pageHash, displayUrl: canonical.value.displayUrl, title: row.title });
        byUnprefixedPath.set(unprefixed, twins);
    }
    for (const page of pages.values()) {
        if (page.performanceSource === null || page.isIndexable !== null)
            continue;
        const twins = byUnprefixedPath.get(pathOf(page.url));
        if (twins?.length !== 1)
            continue;
        const twin = twins[0]!;
        page.title = twin.title;
        page.crawledAs = twin.displayUrl;
        page.aliasOf = twin.pageId;
    }
}
function finishPages(pages: Map<string, MaterialPage>, coverage: PagesCoverage, crawl: CrawlContext, siteUrl: string): MaterialPage[] {
    const result = [...pages.values()];
    for (const page of result) {
        const crawled = crawl.rows.get(page.pageId);
        const probe = crawled ? undefined : crawl.probes.get(page.pageId);
        const resolved = resolveCrawlState({
            hasCompletedCrawl: crawl.hasCompletedCrawl,
            row: crawled?.row ?? null,
            probe: probe ?? null,
        });
        page.crawlState = resolved.state;
        page.crawlEvidence = resolved.evidence;
        // A URL that redirects to a page the crawl DID return is that page: name
        // it, and borrow its title when we have none (root `/` → `/en`).
        if (probe?.finalUrl && !page.crawledAs) {
            const target = canonicalizePageUrl(probe.finalUrl, siteUrl);
            const destination = target.ok ? crawl.rows.get(target.value.pageHash) : undefined;
            if (destination) {
                page.crawledAs = destination.displayUrl;
                page.redirectsTo = destination.displayUrl;
                // `destination` is only found through a parsed target.
                page.aliasOf = (target as {
                    value: {
                        pageHash: string;
                    };
                }).value.pageHash;
                // A page with no crawledAs yet has no twin-borrowed title either.
                page.title = destination.row.title;
            }
        }
        // The crawl itself fetched this URL and was redirected to a page it also
        // fetched: one page, two addresses.
        const crawledTarget = crawled?.row.finalUrl ? canonicalizePageUrl(crawled.row.finalUrl, siteUrl) : null;
        if (crawledTarget?.ok && crawledTarget.value.pageHash !== page.pageId) {
            const destination = crawl.rows.get(crawledTarget.value.pageHash);
            if (destination) {
                page.redirectsTo = destination.displayUrl;
                page.aliasOf = crawledTarget.value.pageHash;
                page.title ??= destination.row.title;
            }
        }
        page.insights = classifyPageInsights(page, page.previousClicks);
        page.searchText = [
            page.url,
            page.displayUrl,
            page.title ?? '',
            ...page.associated.map((row) => row.query),
        ].join('\u0000').normalize('NFKC').toLowerCase();
    }
    // Inventory = unique canonical pages: a redirect source (or un-prefixed
    // twin) of a listed page is the same page and is not counted twice. Its
    // search data still counts toward the page it leads to.
    const listed = new Set(result.map((page) => page.pageId));
    const canonicalOf = (page: MaterialPage): string => page.aliasOf !== undefined && listed.has(page.aliasOf)
        ? page.aliasOf
        : page.pageId;
    const canonical = new Set(result.map(canonicalOf));
    const measured = new Set(result.filter((page) => page.performanceSource !== null).map(canonicalOf));
    coverage.inventoryPages = canonical.size;
    coverage.redirectPages = result.length - canonical.size;
    coverage.measuredPages = measured.size;
    coverage.unmeasuredPages = canonical.size - measured.size;
    return result;
}
/**
 * Why a page's `associatedQueryCount` reads the way it does:
 * - `unavailable`: nothing stored lets us count queries for this page (an
 *   audit-only page, or Search Console page rows without a query snapshot);
 *   the count is `null`, never a fake zero.
 * - `anonymized`: Search Console reported impressions or clicks for the page
 *   but no query text (Google withholds rare, privacy-sensitive queries), so
 *   the count is a real 0 *visible* queries.
 * - `observed`: the count is the number of stored query/keyword rows.
 */
export function associatedQueryState(row: Pick<PageRow, 'performanceSource' | 'metrics'>): PageAssociatedQueryState {
    const { associatedQueryCount, impressions, clicks } = row.metrics;
    if (row.performanceSource === null || associatedQueryCount === null)
        return 'unavailable';
    if (associatedQueryCount === 0 && ((impressions ?? 0) > 0 || (clicks ?? 0) > 0))
        return 'anonymized';
    return 'observed';
}
function publicPage(page: MaterialPage): PageRow {
    return {
        pageId: page.pageId,
        url: page.url,
        displayUrl: page.displayUrl,
        title: page.title,
        performanceSource: page.performanceSource,
        isIndexable: page.isIndexable,
        nonIndexableReason: page.nonIndexableReason,
        onPageScore: page.onPageScore,
        crawlState: page.crawlState,
        crawlEvidence: page.crawlEvidence,
        metrics: page.metrics,
        associatedQueryState: associatedQueryState(page),
        deltas: page.deltas,
        insights: page.insights,
        ...(page.crawledAs ? { crawledAs: page.crawledAs } : {}),
        ...(page.redirectsTo ? { redirectsTo: page.redirectsTo } : {}),
    };
}
function summaryFor(pages: readonly MaterialPage[], source: PagesSource): PageMetrics {
    if (pages.length === 0)
        return nullMetrics(source);
    const measured = pages.filter((page) => page.performanceSource !== null);
    if (source === 'none' && measured.length === 0)
        return nullMetrics();
    const clicks = source === 'gsc' ? measured.reduce((sum, page) => sum + page.metrics.clicks!, 0) : null;
    const impressions = source === 'gsc' ? measured.reduce((sum, page) => sum + page.metrics.impressions!, 0) : null;
    return {
        clicks,
        impressions,
        ctr: impressions !== null && clicks !== null && impressions > 0 ? clicks / impressions : null,
        averagePosition: weightedAverage(measured
            .filter((page) => page.metrics.averagePosition !== null)
            .map((page) => ({ value: page.metrics.averagePosition!, weight: page.weight }))),
        bestPosition: source === 'gsc' ? null : measured.length ? Math.min(...measured.map((page) => page.metrics.bestPosition!)) : null,
        keywordCount: source === 'gsc' ? null : measured.reduce((sum, page) => sum + page.metrics.keywordCount!, 0),
        searchVolume: source === 'gsc' ? null : sumKnown(measured.map((page) => page.metrics.searchVolume)),
        difficulty: source === 'gsc' ? null : weightedAverage(measured.filter((page) => page.metrics.difficulty !== null).map((page) => ({ value: page.metrics.difficulty!, weight: page.metrics.searchVolume ?? 0 }))),
        estimatedTraffic: source === 'gsc' ? null : sumKnown(measured.map((page) => page.metrics.estimatedTraffic)),
        associatedQueryCount: sumKnown(measured.map((page) => page.metrics.associatedQueryCount)),
    };
}
/**
 * Opportunity tiers, most urgent first. Only actionable flags earn a tier;
 * `low_data` and a measured page without flags share tier 0, and an
 * unmeasured page has no opportunity score at all (null sorts last in both
 * directions), so audit-only rows never outrank measured pages.
 */
const OPPORTUNITY_TIERS: Partial<Record<PagesInsight, number>> = {
    non_indexable_visibility: 5,
    declining: 4,
    striking_distance: 3,
    low_ctr: 2,
    winning: 1,
};
/**
 * Tier plus a bounded evidence fraction in [0, 1): within one tier the page
 * with more observed impressions (or, for ranking estimates, search volume or
 * estimated traffic) ranks first, and a zero-evidence page ranks last.
 */
export function opportunityScore(row: Pick<PageRow, 'performanceSource' | 'insights' | 'metrics'>): number | null {
    if (row.performanceSource === null)
        return null;
    const tier = Math.max(0, ...row.insights.map((insight) => OPPORTUNITY_TIERS[insight] ?? 0));
    const evidence = Math.max(row.metrics.impressions ?? row.metrics.searchVolume ?? row.metrics.estimatedTraffic ?? 0, 0);
    // Capped below 1 so a huge value can never round up into the next tier.
    return tier + Math.min(evidence / (evidence + 1), 1 - 1e-9);
}
function primary(row: Pick<PageRow, 'url' | 'title' | 'metrics' | 'deltas' | 'performanceSource' | 'insights'>, sort: PagesSort): string | number | null {
    if (sort === 'opportunity')
        return opportunityScore(row);
    if (sort === 'url')
        return row.url;
    if (sort === 'title')
        return row.title;
    const metric: Record<Exclude<PagesSort, 'opportunity' | 'url' | 'title' | 'position_change' | 'click_change_pct'>, keyof PageMetrics> = {
        clicks: 'clicks', impressions: 'impressions', ctr: 'ctr', average_position: 'averagePosition',
        best_position: 'bestPosition', keyword_count: 'keywordCount', search_volume: 'searchVolume',
        difficulty: 'difficulty', estimated_traffic: 'estimatedTraffic',
    };
    if (sort === 'position_change')
        return row.deltas.positionChange;
    if (sort === 'click_change_pct')
        return row.deltas.clickChangePct;
    return row.metrics[metric[sort]] as number | null;
}
function sortPages(rows: MaterialPage[], sort: PagesSort, direction: 'asc' | 'desc'): MaterialPage[] {
    const sign = direction === 'asc' ? 1 : -1;
    return rows.sort((left, right) => {
        const a = primary(left, sort);
        const b = primary(right, sort);
        if (a === null && b !== null)
            return 1;
        if (a !== null && b === null)
            return -1;
        if (a !== null && b !== null) {
            const compared = typeof a === 'number' && typeof b === 'number'
                ? a - b
                : String(a).localeCompare(String(b));
            if (compared !== 0)
                return compared * sign;
        }
        return Buffer.compare(Buffer.from(`${left.url}\0${left.pageId}`, 'utf8'), Buffer.from(`${right.url}\0${right.pageId}`, 'utf8'));
    });
}
function filterPages(rows: readonly MaterialPage[], query: PagesListQuery): MaterialPage[] {
    const needle = query.q?.normalize('NFKC').toLowerCase();
    return rows.filter((row) => (!needle || row.searchText.includes(needle)) &&
        (!query.insight || row.insights.includes(query.insight)) &&
        (!query.indexability || (query.indexability === 'indexable' ? row.isIndexable === true : row.isIndexable === false)) &&
        (!query.visibility || (query.visibility === 'measured' ? row.performanceSource !== null : row.performanceSource === null)));
}
function queryFingerprint(accountId: string, siteId: string, query: PagesListQuery, direction: 'asc' | 'desc'): string {
    return hash(JSON.stringify({ accountId, siteId, range: query.range, q: query.q ?? null, insight: query.insight ?? null, indexability: query.indexability ?? null, visibility: query.visibility ?? null, sort: query.sort, direction, limit: query.limit }));
}
function cursorKey(secret: string): Buffer {
    return createHmac('sha256', secret).update('pages-cursor:v1', 'utf8').digest();
}
function signCursor(payload: CursorPayload, secret: string): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', cursorKey(secret)).update(body).digest('base64url');
    return `${body}.${signature}`;
}
function parseCursor(value: string, secret: string, expectedQuery: string, expectedInventory: string, now: Date): CursorPayload {
    try {
        const [body, signature, extra] = value.split('.');
        if (!body || !signature || extra)
            throw new Error('shape');
        const expected = createHmac('sha256', cursorKey(secret)).update(body).digest();
        const actual = Buffer.from(signature, 'base64url');
        if (actual.toString('base64url') !== signature || actual.length !== expected.length || !timingSafeEqual(actual, expected))
            throw new Error('signature');
        const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<CursorPayload>;
        if (parsed.v !== 1 || parsed.q !== expectedQuery || parsed.i !== expectedInventory ||
            typeof parsed.n !== 'boolean' ||
            (parsed.p !== null && typeof parsed.p !== 'string' && (typeof parsed.p !== 'number' || !Number.isFinite(parsed.p))) ||
            typeof parsed.u !== 'string' || typeof parsed.id !== 'string' ||
            typeof parsed.iat !== 'number' || typeof parsed.exp !== 'number' || parsed.exp <= now.getTime() || parsed.iat > now.getTime())
            throw new Error('binding');
        return parsed as CursorPayload;
    }
    catch {
        throw new PagesError(400, 'PAGES_INVALID_CURSOR', 'pages.errors.invalidCursor');
    }
}
export function createPagesService(deps: PagesServiceDeps): PagesService {
    const now = deps.now ?? (() => new Date());
    const repository = deps.repository ?? createPagesRepository(deps.db, { now });
    const loadSite = deps.loadSite ?? (async (accountId, siteId) => {
        try {
            const site = await loadOwnedSite(accountId, siteId, { allowPaused: true });
            const market = site.defaultMarket;
            return {
                id: String(site._id),
                url: site.url,
                domain: site.domain,
                defaultMarket: market
                    ? { locationCode: market.locationCode, languageCode: market.languageCode }
                    : null,
            };
        }
        catch {
            throw new PagesError(404, 'PAGES_SITE_NOT_FOUND', 'pages.errors.siteNotFound');
        }
    });
    const resolveGsc = deps.resolveGscState ?? resolveStoredPagesGscState;
    const readAudit = deps.readAudit ?? ((accountId, siteId) => readLatestCompletedPageInventory(accountId, siteId));
    const readAuditPageDetail = deps.readAuditPageDetail ?? readLatestAuditPageDetail;
    async function fallbackMaterial(accountId: string, site: SiteShape, range: PagesRange, gscState: StoredPagesGscState): Promise<SourceMaterial> {
        const market = await resolvePagesFallbackMarket(deps.db, accountId, site.id, site.defaultMarket);
        const source = deps.providerSelection === 'fake' ? 'demo' : 'dataforseo';
        const latest = await repository.readLatest({ accountId, siteId: site.id, source, ...market });
        const audit = await readAudit(accountId, site.id);
        const coverage = emptyCoverage(latest ? source : 'none');
        coverage.auditRowsFetched = audit.fetchedCount;
        coverage.auditTruncated = audit.truncated;
        if (!latest) {
            const pages = new Map<string, MaterialPage>();
            const crawl = mergeAudit(pages, audit, site.url, coverage, range);
            const finished = finishPages(pages, coverage, crawl, site.url);
            // Search Console not being usable is a configuration state the shared
            // Google readiness notice explains, not a source failure, so it never
            // renders as "unavailable".
            const status: PagesStatus = 'empty';
            return {
                site,
                envelope: {
                    source: 'none', status, fallbackReason: gscState.fallbackReason as PagesFallbackReason,
                    observedAt: null, staleAt: null, range, rangeSemantics: 'point_in_time',
                    comparison: { label: 'since_previous_sync', previousObservedAt: null },
                    dataWindow: null,
                    market, coverage,
                },
                pages: finished,
                inventoryFingerprint: hash(JSON.stringify(['none', market, audit.runId])),
                sourceSnapshot: null,
                fallbackContext: market,
                auditRunId: audit.runId,
            };
        }
        const previous = await repository.readPrevious({ accountId, siteId: site.id, source, ...market, beforeObservedAt: latest.observedAt, beforeSnapshotId: latest.id });
        const horizon = new Date(latest.observedAt.getTime() - rangeDays(range) * DAY_MS);
        const comparable = previous && previous.observedAt >= horizon ? previous : null;
        const [currentRows, previousRows] = await Promise.all([
            repository.readKeywords({ accountId, siteId: site.id, snapshotId: latest.id, limit: 100 }),
            comparable ? repository.readKeywords({ accountId, siteId: site.id, snapshotId: comparable.id, limit: 100 }) : Promise.resolve([]),
        ]);
        Object.assign(coverage, {
            sourceRowsFetched: latest.sourceRowsFetched,
            sourceRowsAccepted: latest.acceptedCount,
            sourceRowsDropped: latest.droppedCount,
            dropped: { malformedUrl: latest.malformedUrlCount, offsiteUrl: latest.offsiteUrlCount, duplicateUrl: latest.duplicateUrlCount, invalidMetric: latest.invalidMetricCount },
            sourceTruncated: latest.sourceTruncated,
        });
        const currentGroups = groupByPageHash(currentRows);
        const previousGroups = groupByPageHash(previousRows);
        const pages = new Map<string, MaterialPage>();
        for (const [pageId, rows] of currentGroups) {
            const metrics = aggregateFallback(rows);
            const previousMetrics = previousGroups.has(pageId) ? aggregateFallback(previousGroups.get(pageId)!) : null;
            const associated = associatedFallback(rows).sort((left, right) => (right.estimatedTraffic ?? Number.NEGATIVE_INFINITY) - (left.estimatedTraffic ?? Number.NEGATIVE_INFINITY) ||
                (right.searchVolume ?? Number.NEGATIVE_INFINITY) - (left.searchVolume ?? Number.NEGATIVE_INFINITY) || left.query.localeCompare(right.query));
            pages.set(pageId, {
                pageId, url: rows[0]!.canonicalUrl, displayUrl: rows[0]!.displayUrl, title: null,
                performanceSource: source, isIndexable: null, nonIndexableReason: null, onPageScore: null,
                crawlState: 'no_crawl', crawlEvidence: null,
                metrics, deltas: deltas(metrics, previousMetrics, range), insights: [], associated,
                searchText: '', weight: metrics.searchVolume ?? rows.length, previousClicks: null,
            });
        }
        const crawl = mergeAudit(pages, audit, site.url, coverage, range);
        const finished = finishPages(pages, coverage, crawl, site.url);
        const status = fallbackStatus(latest, now());
        return {
            site,
            envelope: {
                source, status, fallbackReason: gscState.fallbackReason as PagesFallbackReason,
                observedAt: latest.observedAt.toISOString(),
                staleAt: new Date(latest.cacheFetchedAt.getTime() + SITE_RANKED_KEYWORD_CACHE_TTL_MS).toISOString(),
                range, rangeSemantics: 'point_in_time',
                comparison: { label: 'since_previous_sync', previousObservedAt: comparable?.observedAt.toISOString() ?? null },
                dataWindow: null,
                market, coverage,
            },
            pages: finished,
            inventoryFingerprint: hash(JSON.stringify([source, latest.id, audit.runId])),
            sourceSnapshot: latest,
            fallbackContext: market,
            auditRunId: audit.runId,
        };
    }
    async function gscMaterial(accountId: string, site: SiteShape, range: PagesRange, gscState: StoredPagesGscState): Promise<SourceMaterial> {
        const windowDays = rangeDays(range);
        const key = {
            accountId,
            siteId: site.id,
            dimensionSet: 'page' as const,
            windowDays,
            bindingGenerationId: gscState.bindingGenerationId ?? 'legacy',
        };
        const [latest, syncRun, audit] = await Promise.all([
            readLatestPagesGscSnapshot(deps.db, key),
            readLatestGscSyncRun(deps.db, { accountId, siteId: site.id, propertyUrlHash: gscState.propertyUrlHash!, bindingGenerationId: gscState.bindingGenerationId ?? 'legacy' }),
            readAudit(accountId, site.id),
        ]);
        const current = syncRun?.status === 'empty' && (!latest || syncRun.snapshotDate === null || syncRun.snapshotDate >= latest.snapshotDate) ? null : latest;
        const querySnapshot = current
            ? await readPagesGscSnapshotAtDate(deps.db, { ...key, dimensionSet: 'query,page' }, current.snapshotDate)
            : null;
        const coverage = emptyCoverage('gsc');
        coverage.auditRowsFetched = audit.fetchedCount;
        coverage.auditTruncated = audit.truncated;
        let status: PagesStatus;
        if (!current) {
            status = syncRun?.status === 'empty' ? 'empty' : syncRun?.status === 'failed' ? 'unavailable' : 'syncing';
        }
        else if ((syncRun?.status === 'failed' &&
            (syncRun.completedAt ?? syncRun.startedAt).getTime() >= current.fetchedAt.getTime()) ||
            now().getTime() >= current.fetchedAt.getTime() + GSC_STALE_MS) {
            status = 'stale';
        }
        else {
            status = 'ready';
        }
        const previous = current ? await readPreviousPagesGscSnapshot(deps.db, { ...key, beforeDate: current.snapshotDate }) : null;
        const pages = new Map<string, MaterialPage>();
        let malformed = 0;
        let offsite = 0;
        const currentGroups = new Map<string, {
            canonical: ReturnType<typeof canonicalizePageUrl> & {
                ok: true;
            };
            rows: GscSearchAnalyticsSnapshotRow[];
        }>();
        for (const row of current?.rows ?? []) {
            const canonical = canonicalizePageUrl(row.dimensionKey, site.url);
            if (!canonical.ok) {
                if (canonical.reason === 'malformed_url')
                    malformed += 1;
                else
                    offsite += 1;
                continue;
            }
            const group = currentGroups.get(canonical.value.pageHash) ?? { canonical, rows: [] };
            group.rows.push(row);
            currentGroups.set(canonical.value.pageHash, group);
        }
        const previousGroups = new Map<string, GscSearchAnalyticsSnapshotRow[]>();
        for (const row of previous?.rows ?? []) {
            const canonical = canonicalizePageUrl(row.dimensionKey, site.url);
            if (!canonical.ok)
                continue;
            const group = previousGroups.get(canonical.value.pageHash) ?? [];
            group.push(row);
            previousGroups.set(canonical.value.pageHash, group);
        }
        const associatedGroups = new Map<string, GscSearchAnalyticsSnapshotRow[]>();
        for (const row of querySnapshot?.rows ?? []) {
            const parts = row.dimensionKey.split(GSC_SEPARATOR);
            const canonical = canonicalizePageUrl(parts[1] ?? '', site.url);
            if (!canonical.ok)
                continue;
            const group = associatedGroups.get(canonical.value.pageHash) ?? [];
            group.push(row);
            associatedGroups.set(canonical.value.pageHash, group);
        }
        const hasStoredQueries = (querySnapshot?.rows.length ?? 0) > 0;
        for (const [pageId, group] of currentGroups) {
            const metrics = aggregateGsc(group.rows);
            const previousMetrics = previousGroups.has(pageId) ? aggregateGsc(previousGroups.get(pageId)!) : null;
            const associated = associatedGsc(associatedGroups.get(pageId) ?? []);
            // An empty query snapshot means no query text was stored for the whole
            // site, so a page's count is unknown rather than zero.
            metrics.associatedQueryCount = hasStoredQueries ? associated.length : null;
            pages.set(pageId, {
                pageId, url: group.canonical.value.canonicalUrl, displayUrl: group.canonical.value.displayUrl,
                title: null, performanceSource: 'gsc', isIndexable: null, nonIndexableReason: null, onPageScore: null,
                crawlState: 'no_crawl', crawlEvidence: null,
                metrics, deltas: deltas(metrics, previousMetrics, range), insights: [], associated,
                searchText: '', weight: metrics.impressions!,
                previousClicks: previousMetrics?.clicks ?? null,
            });
        }
        coverage.sourceRowsAccepted = current?.rows.length ? current.rows.length - malformed - offsite : 0;
        coverage.sourceRowsDropped = malformed + offsite;
        coverage.dropped.malformedUrl = malformed;
        coverage.dropped.offsiteUrl = offsite;
        coverage.sourceTruncated = (current?.rows.length ?? 0) >= 1000 || (querySnapshot?.rows.length ?? 0) >= 1000;
        const crawl = mergeAudit(pages, audit, site.url, coverage, range);
        const finished = finishPages(pages, coverage, crawl, site.url);
        return {
            site,
            envelope: {
                source: 'gsc', status, fallbackReason: null,
                observedAt: current?.fetchedAt.toISOString() ?? syncRun?.lastSuccessAt?.toISOString() ?? null,
                staleAt: current ? new Date(current.fetchedAt.getTime() + GSC_STALE_MS).toISOString() : null,
                range, rangeSemantics: 'rolling_window',
                comparison: { label: 'since_previous_sync', previousObservedAt: previous?.fetchedAt.toISOString() ?? null },
                dataWindow: current ? gscDataWindow(current.snapshotDate, windowDays) : null,
                market: null, coverage,
            },
            pages: finished,
            inventoryFingerprint: hash(JSON.stringify(['gsc', current?.snapshotDate ?? syncRun?.generation ?? null, querySnapshot?.snapshotDate ?? null, audit.runId])),
            sourceSnapshot: current,
            fallbackContext: null,
            auditRunId: audit.runId,
        };
    }
    async function materialize(accountId: string, siteId: string, range: PagesRange): Promise<SourceMaterial> {
        const site = await loadSite(accountId, siteId);
        const gscState = await resolveGsc(accountId, site.id, site.url);
        return gscState.usable
            ? gscMaterial(accountId, site, range, gscState)
            : fallbackMaterial(accountId, site, range, gscState);
    }
    async function list(accountId: string, siteId: string, query: PagesListQuery): Promise<PagesListResponse> {
        const started = now().getTime();
        const material = await materialize(accountId, siteId, query.range);
        const direction = query.direction ?? DEFAULT_PAGES_DIRECTIONS[query.sort];
        const filtered = sortPages(filterPages(material.pages, query), query.sort, direction);
        const qFingerprint = queryFingerprint(accountId, siteId, query, direction);
        let offset = 0;
        if (query.cursor) {
            const cursor = parseCursor(query.cursor, deps.cursorSecret, qFingerprint, material.inventoryFingerprint, now());
            const index = filtered.findIndex((row) => row.pageId === cursor.id);
            const anchor = filtered[index];
            const anchorPrimary = anchor ? primary(anchor, query.sort) : null;
            if (index < 0 || !anchor || anchor.url !== cursor.u || anchorPrimary !== cursor.p || cursor.n !== (anchorPrimary === null)) {
                throw new PagesError(400, 'PAGES_INVALID_CURSOR', 'pages.errors.invalidCursor');
            }
            offset = index + 1;
        }
        const slice = filtered.slice(offset, offset + query.limit + 1);
        const hasNext = slice.length > query.limit;
        const items = slice.slice(0, query.limit);
        const anchor = items.at(-1);
        const currentNow = now().getTime();
        const nextCursor = hasNext && anchor
            ? signCursor({ v: 1, q: qFingerprint, i: material.inventoryFingerprint, n: primary(anchor, query.sort) === null, p: primary(anchor, query.sort), u: anchor.url, id: anchor.pageId, iat: currentNow, exp: currentNow + CURSOR_TTL_MS }, deps.cursorSecret)
            : null;
        deps.telemetry?.('pages.read.completed', {
            source: material.envelope.source, status: material.envelope.status, range: query.range,
            cache: materialCacheState(material),
            acceptedRows: material.envelope.coverage.sourceRowsAccepted,
            droppedRows: material.envelope.coverage.sourceRowsDropped,
            durationMs: now().getTime() - started,
        });
        return {
            envelope: material.envelope,
            summary: summaryFor(filtered, material.envelope.source),
            items: items.map(publicPage),
            pageInfo: {
                limit: query.limit as 25 | 50 | 100,
                hasNext,
                nextCursor,
                totalFiltered: filtered.length,
                totalInventory: material.pages.length,
                totalMeasured: material.pages.filter((row) => row.performanceSource !== null).length,
            },
        };
    }
    async function detail(accountId: string, siteId: string, pageId: string, range: PagesRange, locale: SupportedLocale = 'en'): Promise<PagesDetailResponse> {
        const started = now().getTime();
        const material = await materialize(accountId, siteId, range);
        const page = material.pages.find((row) => row.pageId === pageId);
        if (!page)
            throw new PagesError(404, 'PAGES_PAGE_NOT_FOUND', 'pages.errors.pageNotFound');
        const total = page.associated.length;
        const trend: TrendPoint[] = [];
        if (material.envelope.source === 'gsc' && material.sourceSnapshot && 'snapshotDate' in material.sourceSnapshot) {
            const source = material.sourceSnapshot as PagesGscSnapshot;
            const history = await readPagesGscHistory(deps.db, {
                accountId, siteId, dimensionSet: 'page', windowDays: rangeDays(range),
                since: isoDate(new Date(source.fetchedAt.getTime() - rangeDays(range) * DAY_MS)), until: source.snapshotDate, limit: 90,
            });
            for (const point of history) {
                const rows = point.rows.filter((row) => {
                    const canonical = canonicalizePageUrl(row.dimensionKey, material.site.url);
                    return canonical.ok && canonical.value.pageHash === pageId;
                });
                if (rows.length)
                    trend.push({ observedAt: point.fetchedAt.toISOString(), source: 'gsc', range, market: null, metrics: aggregateGsc(rows) });
            }
        }
        else if ((material.envelope.source === 'dataforseo' || material.envelope.source === 'demo') && material.sourceSnapshot && material.fallbackContext) {
            const snapshot = material.sourceSnapshot as PagePerformanceSnapshot;
            const history = await repository.readRange({
                accountId, siteId, source: material.envelope.source, ...material.fallbackContext,
                from: new Date(snapshot.observedAt.getTime() - rangeDays(range) * DAY_MS), to: snapshot.observedAt,
            });
            for (const point of history.slice(-90)) {
                const rows = await repository.readKeywords({ accountId, siteId, snapshotId: point.id, pageHash: pageId, limit: 100 });
                if (rows.length)
                    trend.push({ observedAt: point.observedAt.toISOString(), source: material.envelope.source, range, market: material.envelope.market, metrics: aggregateFallback(rows) });
            }
        }
        const response: PagesDetailResponse = {
            envelope: material.envelope,
            page: publicPage(page),
            associated: { kind: page.performanceSource === 'gsc' ? 'queries' : page.performanceSource ? 'keywords' : 'none', rows: page.associated.slice(0, 100), total, truncated: total > 100 },
            trend: trend.slice(-90),
            audit: await readAuditPageDetail(accountId, material.site.id, (candidate) => {
                const canonical = canonicalizePageUrl(candidate, material.site.url);
                return canonical.ok && canonical.value.pageHash === pageId;
            }, locale),
        };
        deps.telemetry?.('pages.read.completed', {
            operation: 'detail',
            source: material.envelope.source,
            status: material.envelope.status,
            range,
            cache: materialCacheState(material),
            acceptedRows: material.envelope.coverage.sourceRowsAccepted,
            droppedRows: material.envelope.coverage.sourceRowsDropped,
            durationMs: now().getTime() - started,
        });
        return response;
    }
    async function refresh(accountId: string, siteId: string): Promise<PagesRefreshResponse> {
        const started = now().getTime();
        const site = await loadSite(accountId, siteId);
        const gscState = await resolveGsc(accountId, site.id, site.url);
        deps.telemetry?.('pages.refresh.started', {
            source: gscState.usable ? 'gsc' : deps.providerSelection === 'fake' ? 'demo' : 'dataforseo',
            range: '28d',
            cache: 'not_started',
        });
        if (gscState.usable) {
            if (!deps.syncGsc || !gscState.propertyUrlHash) {
                deps.telemetry?.('pages.refresh.failed', { source: 'gsc', status: 'unavailable', range: '28d', cache: 'not_applicable', acceptedRows: 0, droppedRows: 0, errorClass: 'sync_unconfigured', durationMs: now().getTime() - started });
                throw new PagesError(503, 'PAGES_GSC_UNAVAILABLE', 'pages.errors.gscUnavailable');
            }
            let result: Awaited<ReturnType<NonNullable<PagesServiceDeps['syncGsc']>>>;
            try {
                result = await deps.syncGsc({ accountId, siteId, domain: site.domain, propertyUrlHash: gscState.propertyUrlHash, bindingGenerationId: gscState.bindingGenerationId ?? 'legacy' });
            }
            catch (error) {
                const state = await list(accountId, siteId, { range: '28d', sort: 'opportunity', limit: 25 });
                state.envelope.status = state.items.length ? 'stale' : 'unavailable';
                deps.telemetry?.('pages.refresh.failed', {
                    source: 'gsc',
                    status: state.envelope.status,
                    range: '28d',
                    cache: 'not_applicable',
                    acceptedRows: state.envelope.coverage.sourceRowsAccepted,
                    droppedRows: state.envelope.coverage.sourceRowsDropped,
                    errorClass: error instanceof Error ? error.name : 'unknown',
                    durationMs: now().getTime() - started,
                });
                throw new PagesError(503, 'PAGES_GSC_UNAVAILABLE', 'pages.errors.gscUnavailable', undefined, state.items.length ? state : undefined);
            }
            if (result.status !== 'ok' && result.status !== 'no-data') {
                const state = await list(accountId, siteId, { range: '28d', sort: 'opportunity', limit: 25 });
                state.envelope.status = state.items.length ? 'stale' : 'unavailable';
                deps.telemetry?.('pages.refresh.failed', { source: 'gsc', status: state.envelope.status, range: '28d', cache: 'not_applicable', acceptedRows: state.envelope.coverage.sourceRowsAccepted, droppedRows: state.envelope.coverage.sourceRowsDropped, errorClass: result.status, durationMs: now().getTime() - started });
                throw new PagesError(503, 'PAGES_GSC_UNAVAILABLE', 'pages.errors.gscUnavailable', undefined, state.items.length ? state : undefined);
            }
            const state = await list(accountId, siteId, { range: '28d', sort: 'opportunity', limit: 25 });
            if (result.status === 'no-data')
                state.envelope.status = 'empty';
            const observedAt = state.envelope.observedAt ?? now().toISOString();
            deps.telemetry?.('pages.refresh.completed', { source: 'gsc', status: state.envelope.status, range: '28d', cache: 'not_applicable', acceptedRows: state.envelope.coverage.sourceRowsAccepted, droppedRows: state.envelope.coverage.sourceRowsDropped, durationMs: now().getTime() - started });
            return { refresh: { outcome: result.status === 'no-data' ? 'empty' : 'refreshed', source: 'gsc', cache: 'not_applicable', observedAt }, state };
        }
        let result: Awaited<ReturnType<PagesFallbackRefreshService['refresh']>>;
        try {
            result = await deps.fallbackRefresh.refresh({
                accountId,
                siteId,
                domain: site.domain,
                siteUrl: site.url,
                siteMarket: site.defaultMarket ?? null,
            });
        }
        catch (error) {
            deps.telemetry?.('pages.refresh.failed', {
                source: deps.providerSelection === 'fake' ? 'demo' : 'dataforseo',
                status: 'unavailable',
                range: '28d',
                cache: 'not_started',
                acceptedRows: 0,
                droppedRows: 0,
                errorClass: error instanceof Error ? error.name : 'unknown',
                durationMs: now().getTime() - started,
            });
            throw error;
        }
        if (!result.ok) {
            const state = result.lastGood ? await list(accountId, siteId, { range: '28d', sort: 'opportunity', limit: 25 }) : undefined;
            if (state)
                state.envelope.status = 'stale';
            const providerFailure = result.failure === 'provider_unavailable';
            const failedStatus = state ? state.envelope.status : 'unavailable';
            deps.telemetry?.('pages.refresh.failed', { source: result.source, status: failedStatus, range: '28d', cache: 'unknown', acceptedRows: 0, droppedRows: 0, errorClass: result.failure, durationMs: now().getTime() - started });
            throw new PagesError(503, providerFailure ? 'PAGES_PROVIDER_UNAVAILABLE' : 'PAGES_REFRESH_FAILED', providerFailure ? 'pages.errors.providerUnavailable' : 'pages.errors.refreshFailed', undefined, state);
        }
        const state = await list(accountId, siteId, { range: '28d', sort: 'opportunity', limit: 25 });
        deps.telemetry?.('pages.refresh.completed', { source: result.source, status: state.envelope.status, range: '28d', cache: result.cache, acceptedRows: result.coverage.acceptedCount, droppedRows: result.coverage.droppedCount, durationMs: now().getTime() - started });
        return { refresh: { outcome: result.outcome, source: result.source, cache: result.cache, observedAt: result.observedAt.toISOString() }, state };
    }
    return { list, detail, refresh };
}
