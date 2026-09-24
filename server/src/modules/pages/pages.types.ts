import type { PagesInsight, PagesRange } from './pages.schema.js';
export type PagesSource = 'gsc' | 'dataforseo' | 'demo' | 'none';
export type PagesStatus = 'ready' | 'syncing' | 'empty' | 'unavailable' | 'stale';
export type PagesFallbackReason = 'gsc_not_connected' | 'gsc_needs_reconnect' | 'gsc_revoked' | 'gsc_property_unmatched';
export type PagesPerformanceSource = Exclude<PagesSource, 'none'> | null;
export interface PagesMarket {
    locationCode: number;
    languageCode: string;
    selection: 'tracked_keyword_mode' | 'default';
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
    auditRowsFetched: number;
    auditRowsAccepted: number;
    auditRowsDropped: number;
    auditTruncated: boolean;
    inventoryPages: number;
    measuredPages: number;
    unmeasuredPages: number;
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
    associatedQueryCount: number;
}
export interface PageDeltas {
    positionChange: number | null;
    clickChangePct: number | null;
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
    metrics: PageMetrics;
    deltas: PageDeltas;
    insights: PagesInsight[];
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
