import { and, count, desc, eq, inArray, lte } from 'drizzle-orm';
import { Types } from 'mongoose';
import type { Db } from '../../db/client.js';
import { gscSearchAnalytics } from '../../db/schema/gsc.js';
import { keywords } from '../../db/schema/keywords.js';
import { freshnessStateFor } from '../../shared/observations/freshness-policy.js';
import { AuditRun, ReportSnapshot } from '../audits/index.js';
import { getConnection, readSitesGoogleReadiness } from '../google-connections/index.js';
import { Site } from '../sites/index.js';
import { readRankMovementForSite } from '../ranks/rank-movement.service.js';

export const SITE_SUMMARY_MAX_IDS = 100;

export type LastAuditMetric =
  | { state: 'value' | 'stale'; finishedAt: string; asOf: string; status: 'succeeded' | 'failed' | 'unavailable' }
  | { state: 'unavailable'; reason: 'no_audit' };
export type OpenFixNowMetric =
  | { state: 'value' | 'stale'; count: number; asOf: string }
  | { state: 'unavailable'; reason: 'no_audit' | 'report_missing' };
export interface SiteSummaryRow {
  id: string;
  lastAudit: LastAuditMetric;
  openFixNow: OpenFixNowMetric;
  trackedKeywords: number;
}
export interface SiteSummaryInput {
  accountId: string;
  allowedSiteIds: readonly string[] | null;
  siteIds: readonly string[];
}

/** Stored-only summaries for the Sites list; unknown and foreign ids are omitted. */
export async function getSiteSummaries(input: SiteSummaryInput, db: Db, now = new Date()): Promise<{ summaries: SiteSummaryRow[] }> {
  const allowed = input.allowedSiteIds === null ? null : new Set(input.allowedSiteIds);
  const requested = [...new Set(input.siteIds)]
    .filter((id) => Types.ObjectId.isValid(id) && (allowed === null || allowed.has(id)));
  if (requested.length === 0) return { summaries: [] };
  const owned = await Site.find({ _id: { $in: requested }, accountId: input.accountId, deletionStartedAt: null }, { _id: 1 })
    .lean<Array<{ _id: Types.ObjectId }>>();
  const ids = owned.map((site) => String(site._id));
  if (ids.length === 0) return { summaries: [] };

  type FinishedStatus = 'succeeded' | 'failed' | 'unavailable';
  type RunRef = { _id: Types.ObjectId; status: FinishedStatus; finishedAt: Date | null };
  const runs = await AuditRun.aggregate<{ _id: { siteId: Types.ObjectId; status: FinishedStatus };
    runId: Types.ObjectId; finishedAt: Date | null }>([
    { $match: { accountId: new Types.ObjectId(input.accountId), siteId: { $in: ids.map((id) => new Types.ObjectId(id)) },
      kind: 'site', status: { $in: ['succeeded', 'failed', 'unavailable'] } } },
    { $sort: { _id: -1 } },
    { $group: { _id: { siteId: '$siteId', status: '$status' }, runId: { $first: '$_id' },
      finishedAt: { $first: '$finishedAt' } } },
  ]);
  const latest = new Map<string, RunRef>();
  const succeeded = new Map<string, RunRef>();
  for (const run of runs) {
    const id = String(run._id.siteId);
    const ref: RunRef = { _id: run.runId, status: run._id.status, finishedAt: run.finishedAt };
    if (ref.status === 'succeeded') succeeded.set(id, ref);
    const previous = latest.get(id);
    if (!previous || String(ref._id) > String(previous._id)) latest.set(id, ref);
  }
  const snapshots = succeeded.size === 0 ? [] : await ReportSnapshot.find({ accountId: input.accountId,
    runId: { $in: [...succeeded.values()].map((run) => run._id) } },
  { runId: 1, createdAt: 1, 'findings.ruleId': 1, 'findings.bucket': 1 })
    .lean<Array<{ runId: Types.ObjectId; createdAt: Date;
      findings: Array<{ ruleId: string; bucket: string }> }>>();
  const byRun = new Map(snapshots.map((snapshot) => [String(snapshot.runId), snapshot]));
  const counts = await db.select({ siteId: keywords.siteId, total: count() }).from(keywords)
    .where(and(eq(keywords.accountId, input.accountId), eq(keywords.active, true), inArray(keywords.siteId, ids)))
    .groupBy(keywords.siteId);
  const tracked = new Map(counts.map((row) => [row.siteId, row.total]));

  return { summaries: ids.map((id) => {
    const last = latest.get(id);
    const lastAudit: LastAuditMetric = last?.finishedAt
      ? { state: freshnessStateFor('audit', last.finishedAt, now),
        finishedAt: last.finishedAt.toISOString(), asOf: last.finishedAt.toISOString(), status: last.status }
      : { state: 'unavailable', reason: 'no_audit' };
    const success = succeeded.get(id);
    const snapshot = success ? byRun.get(String(success._id)) : undefined;
    const asOf = success?.finishedAt ?? snapshot?.createdAt;
    const openFixNow: OpenFixNowMetric = !success ? { state: 'unavailable', reason: 'no_audit' }
      : !snapshot || !asOf ? { state: 'unavailable', reason: 'report_missing' }
        : { state: freshnessStateFor('audit', asOf, now),
          count: new Set(snapshot.findings.filter((finding) => finding.bucket === 'fix-now')
            .map((finding) => finding.ruleId)).size,
          asOf: asOf.toISOString() };
    return { id, lastAudit, openFixNow, trackedKeywords: tracked.get(id) ?? 0 };
  }) };
}

export const DASHBOARD_SITE_LIMIT = 10;
type SearchTrendMetric =
  | { state: 'value' | 'stale'; clicks: number; impressions: number; previousClicks: number | null;
    previousImpressions: number | null; asOf: string; source: 'date' | 'query' }
  | { state: 'unavailable'; reason: 'not_connected' | 'reconnect_needed' | 'no_property' | 'property_mismatch' | 'error' | 'no_data_yet' };
type RankMovementMetric =
  | { state: 'value' | 'stale'; improved: number; declined: number; unchanged: number; tracked: number;
    compared: number; notCompared: { failed: number; skipped: number; noPair: number }; asOf: string }
  | { state: 'unavailable'; reason: 'no_keywords' | 'no_checks' | 'single_check'; tracked: number };
export interface SiteHealthRow {
  id: string; domain: string; displayName: string; openFixNow: OpenFixNowMetric;
  lastAudit: LastAuditMetric; searchTrend: SearchTrendMetric; rankMovement: RankMovementMetric;
}
export interface SiteHealthResponse {
  generatedAt: string; limit: number; totalSites: number; activeSites: number; pausedSites: number;
  hasMore: boolean; sites: SiteHealthRow[];
  pausedList: Array<{ id: string; domain: string; displayName: string; pausedAt: string | null }>;
}
interface HealthSite {
  _id: Types.ObjectId; domain: string; displayName?: string | null; pausedAt?: Date | null;
  gscBindingGenerationId?: string | null;
}

async function storedSearchTrend(accountId: string, site: HealthSite, db: Db,
  readiness: string, reconnect: boolean, now: Date): Promise<SearchTrendMetric> {
  if (reconnect) return { state: 'unavailable', reason: 'reconnect_needed' };
  if (readiness !== 'ok') return { state: 'unavailable', reason: readiness as 'not_connected' };
  const base = and(eq(gscSearchAnalytics.accountId, accountId), eq(gscSearchAnalytics.siteId, String(site._id)),
    eq(gscSearchAnalytics.bindingGenerationId, site.gscBindingGenerationId ?? 'legacy'));
  const latestDaily = await db.select({ snapshotDate: gscSearchAnalytics.snapshotDate })
    .from(gscSearchAnalytics).where(and(base, eq(gscSearchAnalytics.dimensionSet, 'date'),
      eq(gscSearchAnalytics.windowDays, 90))).orderBy(desc(gscSearchAnalytics.snapshotDate)).limit(1);
  const dailyDate = latestDaily[0]?.snapshotDate;
  if (dailyDate) {
    const daily = await db.select({ day: gscSearchAnalytics.dimensionKey,
    clicks: gscSearchAnalytics.clicks, impressions: gscSearchAnalytics.impressions })
    .from(gscSearchAnalytics).where(and(base, eq(gscSearchAnalytics.dimensionSet, 'date'),
      eq(gscSearchAnalytics.windowDays, 90), eq(gscSearchAnalytics.snapshotDate, dailyDate)));
    const asOf = dailyDate;
    const date = new Date(`${asOf}T00:00:00.000Z`);
    const dateBefore = (days: number) => new Date(date.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    const currentStart = dateBefore(27);
    const previousStart = dateBefore(55);
    const previousEnd = dateBefore(28);
    const sum = (rows: typeof daily) => rows.reduce((total, row) => ({
      clicks: total.clicks + row.clicks, impressions: total.impressions + row.impressions,
    }), { clicks: 0, impressions: 0 });
    const current = sum(daily.filter((row) => row.day >= currentStart && row.day <= asOf));
    const previousRows = daily.filter((row) => row.day >= previousStart && row.day <= previousEnd);
    const previous = previousRows.length > 0 ? sum(previousRows) : null;
    return { state: freshnessStateFor('search_console', date, now), ...current,
      previousClicks: previous?.clicks ?? null, previousImpressions: previous?.impressions ?? null,
      asOf, source: 'date' };
  }
  const queryScope = and(base, eq(gscSearchAnalytics.dimensionSet, 'query'), eq(gscSearchAnalytics.windowDays, 28));
  const latestQuery = await db.select({ snapshotDate: gscSearchAnalytics.snapshotDate }).from(gscSearchAnalytics)
    .where(queryScope).orderBy(desc(gscSearchAnalytics.snapshotDate)).limit(1);
  const asOf = latestQuery[0]?.snapshotDate;
  if (!asOf) return { state: 'unavailable', reason: 'no_data_yet' };
  const previousBefore = new Date(new Date(`${asOf}T00:00:00.000Z`).getTime() - 28 * 86_400_000)
    .toISOString().slice(0, 10);
  const previousQuery = await db.select({ snapshotDate: gscSearchAnalytics.snapshotDate }).from(gscSearchAnalytics)
    .where(and(queryScope, lte(gscSearchAnalytics.snapshotDate, previousBefore)))
    .orderBy(desc(gscSearchAnalytics.snapshotDate)).limit(1);
  const previousDate = previousQuery[0]?.snapshotDate;
  const wanted = previousDate ? [asOf, previousDate] : [asOf];
  const rows = await db.select({ snapshotDate: gscSearchAnalytics.snapshotDate, clicks: gscSearchAnalytics.clicks,
    impressions: gscSearchAnalytics.impressions }).from(gscSearchAnalytics)
    .where(and(queryScope, inArray(gscSearchAnalytics.snapshotDate, wanted)));
  const totals = (date: string) => rows.filter((row) => row.snapshotDate === date).reduce(
    (sum, row) => ({ clicks: sum.clicks + row.clicks, impressions: sum.impressions + row.impressions }),
    { clicks: 0, impressions: 0 });
  const current = totals(asOf);
  const previous = previousDate ? totals(previousDate) : null;
  return { state: freshnessStateFor('search_console', new Date(`${asOf}T00:00:00.000Z`), now),
    ...current, previousClicks: previous?.clicks ?? null, previousImpressions: previous?.impressions ?? null,
    asOf, source: 'query' };
}

async function storedRankMovement(accountId: string, siteId: string, db: Db, now: Date): Promise<RankMovementMetric> {
  const movement = await readRankMovementForSite(db, { accountId, siteId });
  if (movement.tracked === 0) return { state: 'unavailable', reason: 'no_keywords', tracked: 0 };
  const latest = movement.latestCheckedAt;
  if (!latest) return { state: 'unavailable', reason: 'no_checks', tracked: movement.tracked };
  if (movement.compared === 0 && movement.notCompared.failed === 0) {
    return { state: 'unavailable', reason: 'single_check', tracked: movement.tracked };
  }
  return { state: freshnessStateFor('rank_checks', latest, now, { cadence: movement.cadence }),
    improved: movement.improved, declined: movement.declined, unchanged: movement.unchanged,
    tracked: movement.tracked, compared: movement.compared,
    notCompared: { failed: movement.notCompared.failed, skipped: movement.notCompared.skipped,
      noPair: movement.notCompared.noPair + movement.notCompared.unranked }, asOf: latest.toISOString() };
}

/** Stored, account and selected-team scoped dashboard overview. */
export async function getSiteHealth(input: { accountId: string; allowedSiteIds: readonly string[] | null },
  db: Db, now = new Date()): Promise<SiteHealthResponse> {
  const scope: Record<string, unknown> = { accountId: input.accountId, deletionStartedAt: null };
  if (input.allowedSiteIds !== null) scope._id = { $in: input.allowedSiteIds.filter((id) => Types.ObjectId.isValid(id)) };
  const [totalSites, pausedSites, active, paused] = await Promise.all([
    Site.countDocuments(scope), Site.countDocuments({ ...scope, paused: true }),
    Site.find({ ...scope, paused: { $ne: true } }, { domain: 1, displayName: 1, gscBindingGenerationId: 1 })
      .sort({ _id: -1 }).limit(DASHBOARD_SITE_LIMIT).lean<HealthSite[]>(),
    Site.find({ ...scope, paused: true }, { domain: 1, displayName: 1, pausedAt: 1 })
      .sort({ _id: -1 }).limit(DASHBOARD_SITE_LIMIT).lean<HealthSite[]>(),
  ]);
  const response: SiteHealthResponse = { generatedAt: now.toISOString(), limit: DASHBOARD_SITE_LIMIT,
    totalSites, activeSites: totalSites - pausedSites, pausedSites, hasMore: totalSites - pausedSites > active.length,
    sites: [], pausedList: paused.map((site) => ({ id: String(site._id), domain: site.domain,
      displayName: site.displayName ?? '', pausedAt: site.pausedAt?.toISOString() ?? null })) };
  if (active.length === 0) return response;
  const ids = active.map((site) => String(site._id));
  const [summaries, readiness, connection] = await Promise.all([
    getSiteSummaries({ ...input, siteIds: ids }, db, now), readSitesGoogleReadiness(input.accountId, ids),
    getConnection(input.accountId),
  ]);
  const byId = new Map(summaries.summaries.map((summary) => [summary.id, summary]));
  response.sites = await Promise.all(active.filter((site) => byId.has(String(site._id))).map(async (site) => {
    const id = String(site._id);
    const summary = byId.get(id)!;
    const [searchTrend, rankMovement] = await Promise.all([
      storedSearchTrend(input.accountId, site, db, readiness.get(id)?.gsc.status ?? 'not_connected',
        connection?.status === 'needs_reconnect', now),
      storedRankMovement(input.accountId, id, db, now),
    ]);
    return { id, domain: site.domain, displayName: site.displayName ?? '', lastAudit: summary.lastAudit,
      openFixNow: summary.openFixNow, searchTrend, rankMovement };
  }));
  return response;
}
