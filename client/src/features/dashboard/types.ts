export type HealthState = 'value' | 'stale';
export type OpenFixNowMetric =
  | { state: HealthState; count: number; asOf: string }
  | { state: 'unavailable'; reason: 'no_audit' | 'report_missing' };
export type LastAuditMetric =
  | { state: HealthState; finishedAt: string; asOf: string; status: 'succeeded' | 'failed' | 'unavailable' }
  | { state: 'unavailable'; reason: 'no_audit' };
export type SearchTrendMetric =
  | { state: HealthState; clicks: number; impressions: number; previousClicks: number | null;
    previousImpressions: number | null; asOf: string; source: 'date' | 'query' }
  | { state: 'unavailable'; reason: 'not_connected' | 'reconnect_needed' | 'no_data_yet' |
    'no_property' | 'property_mismatch' | 'error' };
export type RankMovementMetric =
  | { state: HealthState; improved: number; declined: number; unchanged: number; tracked: number;
    compared: number; notCompared: { failed: number; skipped: number; noPair: number }; asOf: string }
  | { state: 'unavailable'; reason: 'no_keywords' | 'no_checks' | 'single_check'; tracked: number };
export interface SiteHealthRow {
  id: string;
  domain: string;
  displayName: string;
  openFixNow: OpenFixNowMetric;
  lastAudit: LastAuditMetric;
  searchTrend: SearchTrendMetric;
  rankMovement: RankMovementMetric;
}
export interface PausedSiteRow { id: string; domain: string; displayName: string; pausedAt: string | null }
export interface SiteHealthResponse {
  generatedAt: string;
  limit: number;
  totalSites: number;
  activeSites: number;
  pausedSites: number;
  hasMore: boolean;
  sites: SiteHealthRow[];
  pausedList: PausedSiteRow[];
}
export interface SiteSummaryRow {
  id: string;
  lastAudit: LastAuditMetric;
  openFixNow: OpenFixNowMetric;
  trackedKeywords: number;
}
export interface DashboardState {
  health: SiteHealthResponse | null;
  loading: boolean;
  loadedAt: number | null;
  error: string;
}
