import type { AuditLastCrawl, AuditPageDetail, CrawlEvidence, CrawlState } from '../audits/index.js';
import type { PagesInsight, PagesRange } from './pages.schema.js';
import type { PositionChange } from '../../shared/utils/position-change.js';
export type PagesSource = 'gsc' | 'dataforseo' | 'demo' | 'none';
export type PagesStatus = 'ready' | 'syncing' | 'empty' | 'unavailable' | 'stale';
export type PagesFallbackReason = 'gsc_not_connected' | 'gsc_needs_reconnect' | 'gsc_revoked' | 'gsc_property_unmatched';
export type PagesPerformanceSource = Exclude<PagesSource, 'none'> | null;
export interface PagesMarket {
    locationCode: number;
    languageCode: string;
    selection: 'site_default' | 'tracked_keyword_mode' | 'default';
}
export interface PagesCoverage {
    reportingLagDays: 3 | null;
    sampled: boolean | null;
    sourceRowsFetched: number | null;
    sourceRowsAccepted: number;
    sourceRowsDropped: number;
    dropped: {
        malformedUrl: number;
        offsiteUrl: number;
        duplicateUrl: number;
        invalidMetric: number;
    };
    sourceLimit: number | null;
    sourceTruncated: boolean;
    /**
     * URLs the last audit's crawl fetched: canonical pages plus redirects,
     * non-canonical duplicates and non-HTML files (the report's `pagesCrawled`).
     */
    auditRowsFetched: number;
    auditRowsAccepted: number;
    auditRowsDropped: number;
    auditTruncated: boolean;
    /**
     * Unique canonical pages the product knows: indexable crawled pages plus
     * pages with search data, each counted once. A redirect source (or the
     * un-prefixed twin of a locale page) is listed with `redirectsTo` /
     * `crawledAs` but counted as the page it leads to.
     */
    inventoryPages: number;
    /** Listed rows that are another address of an inventory page (not counted in it). */
    redirectPages: number;
    /** Inventory pages with search data (their own, or through an address that leads to them). */
    measuredPages: number;
    unmeasuredPages: number;
    /**
     * What the last completed crawl recorded about itself (page limit, pages
     * stored, why it stopped, sitemap), so a small inventory can say why.
     * `null` = no completed crawl.
     */
    lastCrawl: AuditLastCrawl | null;
}
export interface PageMetrics {
    clicks: number | null;
    impressions: number | null;
    ctr: number | null;
    averagePosition: number | null;
    bestPosition: number | null;
    keywordCount: number | null;
    searchVolume: number | null;
    difficulty: number | null;
    estimatedTraffic: number | null;
    /**
     * Stored query (Search Console) or keyword (ranking estimate) rows counted
     * for the page. `null` means nothing stored lets us count them (an
     * audit-only page, or page rows without a query snapshot), never a zero.
     * Read `PageRow.associatedQueryState` for the reason behind a 0.
     */
    associatedQueryCount: number | null;
}
export type PageAssociatedQueryState = 'observed' | 'anonymized' | 'unavailable';
export interface PageDeltas {
    /** `previous − current` average position; kept for sorting and insights. */
    positionChange: number | null;
    clickChangePct: number | null;
    /** The explicit position-change contract: render this, not `positionChange`. */
    position: PositionChange;
}
export interface PageRow {
    pageId: string;
    url: string;
    displayUrl: string;
    title: string | null;
    performanceSource: PagesPerformanceSource;
    isIndexable: boolean | null;
    nonIndexableReason: string | null;
    onPageScore: number | null;
    /**
     * THE crawl state of this URL (see `audits/crawl-state.ts`): the list label
     * and the inspector both render from this single field, so they cannot
     * disagree. `isIndexable` stays for filters; read `crawlState` for wording.
     */
    crawlState: CrawlState;
    /** What the crawl (or our own request) recorded for the URL; `null` when nothing was. */
    crawlEvidence: CrawlEvidence | null;
    metrics: PageMetrics;
    /**
     * How to read `metrics.associatedQueryCount`: `observed` (a real count),
     * `anonymized` (Search Console reported impressions or clicks but no query
     * text, so 0 is "0 visible queries"), or `unavailable` (count is `null`).
     */
    associatedQueryState: PageAssociatedQueryState;
    deltas: PageDeltas;
    insights: PagesInsight[];
    /**
     * A measured URL the crawl did not visit, joined to the single crawled
     * locale-prefixed twin it most likely redirects to (`/pricing` →
     * `/en/pricing`). The title comes from that page; indexability stays
     * unknown because this exact URL was not crawled.
     */
    crawledAs?: string;
    /**
     * The listed page this URL redirects to, when a request proved it (the
     * crawl or our own coverage probe). The row is the same page as its target
     * and is not counted separately in `coverage.inventoryPages`.
     */
    redirectsTo?: string;
}
export interface PagesEnvelope {
    source: PagesSource;
    status: PagesStatus;
    fallbackReason: PagesFallbackReason | null;
    observedAt: string | null;
    staleAt: string | null;
    range: PagesRange;
    rangeSemantics: 'rolling_window' | 'point_in_time';
    comparison: {
        label: 'since_previous_sync';
        previousObservedAt: string | null;
    };
    /**
     * Inclusive Search Console window (lag-adjusted, YYYY-MM-DD) the headline
     * metrics were read from; null when no GSC snapshot backs the response.
     * The Google tab's site totals cover the same window, so the UI can name the
     * dates and explain that per-page totals differ by aggregation, not window.
     */
    dataWindow: {
        startDate: string;
        endDate: string;
    } | null;
    market: PagesMarket | null;
    coverage: PagesCoverage;
}
export interface PagesListResponse {
    envelope: PagesEnvelope;
    summary: PageMetrics;
    items: PageRow[];
    pageInfo: {
        limit: 25 | 50 | 100;
        hasNext: boolean;
        nextCursor: string | null;
        totalFiltered: number;
        totalInventory: number;
        totalMeasured: number;
    };
}
export interface PageQueryRow {
    query: string;
    position: number | null;
    clicks: number | null;
    impressions: number | null;
    ctr: number | null;
    searchVolume: number | null;
    difficulty: number | null;
    estimatedTraffic: number | null;
}
export interface TrendPoint {
    observedAt: string;
    source: Exclude<PagesSource, 'none'>;
    range: PagesRange;
    market: PagesMarket | null;
    metrics: PageMetrics;
}
export interface PagesDetailResponse {
    envelope: PagesEnvelope;
    page: PageRow;
    associated: {
        kind: 'queries' | 'keywords' | 'none';
        rows: PageQueryRow[];
        total: number;
        truncated: boolean;
    };
    trend: TrendPoint[];
    /**
     * What the latest completed audit recorded for this page: crawl facts and
     * the open findings that list it. `null` when there is no completed audit
     * or the audit did not crawl this page.
     */
    audit: AuditPageDetail | null;
}
export interface PagesRefreshResponse {
    refresh: {
        outcome: 'refreshed' | 'empty';
        source: Exclude<PagesSource, 'none'>;
        cache: 'hit' | 'miss' | 'not_applicable';
        observedAt: string;
    };
    state: PagesListResponse;
}
