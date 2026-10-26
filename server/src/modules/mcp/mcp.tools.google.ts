/**
 * Stored-data Google read tools: Search Console summary,
 * top queries, top pages and the GA4 summary.
 *
 * Every tool reads ONLY the Postgres snapshots the daily/audit syncs already
 * wrote, through the same readers (and the same binding-generation scoped
 * dependency builders) as `GET /api/sites/:siteId/google/*`. They never call
 * Google, never enqueue a sync,and never spend.
 *
 * Scope contract (consistent with the Google tab / #3):
 *   - `range` is the requested window (7d | 28d | 90d, default 28d).
 *   - `asOf` is the snapshot date the numbers were read from; the window is the
 *     `range` days inclusive ending on `asOf`, so `startDate = asOf - (days - 1)`
 *     and `endDate = asOf` — exactly what the Google tab prints.
 *   - Search Console reports its days in Pacific Time, hence `timezone`.
 *   - Site totals add up the stored query rows. The page/country/device
 *     tables only add up their own rows, so they can differ from the site
 *     total (`scopeNote`).
 *   - `ctr` values are fractions (0.05 = 5%); `position` is the average
 *     Search Console position.
 */
import { HttpError } from '../../shared/utils/http-error.js';
import { translate } from '../../shared/i18n/index.js';
import {
  SCOPE_GA4,
  buildGa4SummaryReadDeps,
  buildGscSummaryDeps,
  getAnalyticsSummaryFor,
  getConnection,
  getGoogleConnectionsDb,
  getSearchAnalyticsDetailFor,
  getSearchSummaryFor,
  type GoogleAnalyticsSummary,
  type GscRange,
} from '../google-connections/index.js';
import {
  clampRows,
  runSiteStoredRead,
  type StoredReadAccountEnv,
  type StoredReadEnv,
  type StoredReadOutcome,
  type StoredReadReason,
} from './mcp.read-kit.js';
import {
  READ_RANGE_DEFAULT,
  getGa4SummaryInputSchema,
  getGscSearchSummaryInputSchema,
  listGscTopPagesInputSchema,
  listGscTopQueriesInputSchema,
  type ReadRange,
} from './mcp.read-schemas.js';
import { MCP_PAGE_LIMIT_DEFAULT } from './mcp.schema.js';
import type { McpToolContext, McpToolResult } from './mcp.tools.js';

/** Search Console reports calendar days in Pacific Time. */
export const GSC_REPORT_TIMEZONE = 'America/Los_Angeles';
const GA4_SOURCE = 'google_analytics_4';
const GSC_SOURCE = 'search_console';
const DAY_MS = 86_400_000;

const RANGE_DAYS: Readonly<Record<ReadRange, number>> = { '7d': 7, '28d': 28, '90d': 90 };

/** Service HttpError message keys that mean "no stored data", by reason. */
const SERVICE_REASON: Readonly<Record<string, StoredReadReason>> = {
  'google.noDataYet': 'snapshotMissing',
  'google.reconnectToSeeData': 'googleReconnect',
  'google.analyticsNotEnabled': 'ga4NotLinked',
};

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Inclusive window start: `days - 1` before `asOf` (what the Google tab prints). */
export function windowStart(asOf: string, days: number): string {
  return isoDay(new Date(new Date(`${asOf}T00:00:00.000Z`).getTime() - (days - 1) * DAY_MS));
}

/** Connection-level reason a Google read cannot be answered, else null. */
async function connectionReason(accountId: string): Promise<{
  reason: StoredReadReason | null;
  scopes: readonly string[];
}> {
  const connection = await getConnection(accountId);
  if (connection?.status === 'needs_reconnect') {
    return { reason: 'googleReconnect', scopes: [] };
  }
  if (!connection || connection.status !== 'connected') {
    return { reason: 'googleNotConnected', scopes: [] };
  }
  return { reason: null, scopes: connection.scopes };
}

/** GSC availability before touching snapshots; maps to an `unavailable` marker. */
async function gscUnavailable(
  env: Pick<StoredReadEnv, 'accountId' | 'site'>,
  range: ReadRange,
): Promise<StoredReadOutcome | null> {
  const { reason } = await connectionReason(env.accountId);
  if (reason) return { status: 'unavailable', reason, data: { source: GSC_SOURCE, range } };
  if (!env.site.gscPropertyUrl) {
    // Google IS connected here (connectionReason ruled out the other states), so
    // the one next step is choosing a property on the site's Google tab.
    return {
      status: 'unavailable',
      reason: 'gscNotLinked',
      data: { source: GSC_SOURCE, range, setupPath: `/sites/${String(env.site._id)}?tab=google` },
    };
  }
  return null;
}

/** Run a service read; a "no stored data" ladder 404 becomes an `unavailable` marker. */
async function withStoredFallback<T>(
  source: string,
  range: ReadRange,
  read: () => Promise<T>,
  map: (value: T) => StoredReadOutcome,
): Promise<StoredReadOutcome> {
  try {
    return map(await read());
  } catch (error) {
    const reason = error instanceof HttpError ? SERVICE_REASON[error.messageKey] : undefined;
    if (reason) return { status: 'unavailable', reason, data: { source, range } };
    throw error;
  }
}

function scopeNote(env: Pick<StoredReadAccountEnv, 'locale'>): string {
  return translate(env.locale, 'mcp.scope.gscDimensionTotals');
}

// ---------------------------------------------------------------------------
// get_gsc_search_summary
// ---------------------------------------------------------------------------

export function toolGetGscSearchSummary(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runSiteStoredRead(
    {
      name: 'get_gsc_search_summary',
      schema: getGscSearchSummaryInputSchema,
      read: async (input, env) => {
        const range = input.range ?? READ_RANGE_DEFAULT;
        const blocked = await gscUnavailable(env, range);
        if (blocked) return blocked;
        const siteId = String(env.site._id);
        const deps = buildGscSummaryDeps(
          getGoogleConnectionsDb(),
          env.site.gscBindingGenerationId ?? 'legacy',
        );
        return withStoredFallback(
          GSC_SOURCE,
          range,
          () => getSearchSummaryFor(env.accountId, siteId, deps, range as GscRange),
          (summary) => {
            const series = clampRows(summary.timeseries);
            return {
              status: 'ok',
              count: 1,
              data: {
                source: GSC_SOURCE,
                range,
                startDate: windowStart(summary.asOf, RANGE_DAYS[range]),
                endDate: summary.asOf,
                asOf: summary.asOf,
                timezone: GSC_REPORT_TIMEZONE,
                totals: {
                  clicks: summary.totalClicks,
                  impressions: summary.totalImpressions,
                  ctr: summary.averageCtr,
                  position: summary.averagePosition,
                },
                previousPeriod: summary.previousPeriod
                  ? {
                      clicks: summary.previousPeriod.totalClicks,
                      impressions: summary.previousPeriod.totalImpressions,
                    }
                  : null,
                dimensionTotals: summary.dimensionTotals,
                scopeNoteKey: 'dimensionTotalsMayDiffer',
                scopeNote: scopeNote(env),
                topQueries: summary.topQueries,
                topPages: summary.topPages,
                countries: summary.countries,
                devices: summary.devices,
                dailySeries: series.rows,
              },
              truncated: series.truncated,
            };
          },
        );
      },
    },
    rawInput,
    context,
  );
}

// ---------------------------------------------------------------------------
// list_gsc_top_queries / list_gsc_top_pages
// ---------------------------------------------------------------------------

interface DetailRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function byClicksThenImpressions(a: DetailRow, b: DetailRow): number {
  return b.clicks - a.clicks || b.impressions - a.impressions || a.key.localeCompare(b.key);
}

async function readDimensionRows(
  dimension: 'query' | 'page',
  input: { range?: ReadRange | undefined; limit?: number | undefined },
  env: StoredReadEnv,
): Promise<StoredReadOutcome> {
  const range = input.range ?? READ_RANGE_DEFAULT;
  const blocked = await gscUnavailable(env, range);
  if (blocked) return blocked;
  const siteId = String(env.site._id);
  const deps = buildGscSummaryDeps(
    getGoogleConnectionsDb(),
    env.site.gscBindingGenerationId ?? 'legacy',
  );
  return withStoredFallback(
    GSC_SOURCE,
    range,
    () => getSearchAnalyticsDetailFor(env.accountId, siteId, dimension, deps, range as GscRange),
    (detail) => {
      const sorted = [...detail.rows].sort(byClicksThenImpressions);
      const page = clampRows(sorted, input.limit ?? MCP_PAGE_LIMIT_DEFAULT);
      const label = dimension === 'query' ? 'query' : 'url';
      return {
        status: 'ok',
        count: page.rows.length,
        data: {
          source: GSC_SOURCE,
          range,
          dimension,
          startDate: windowStart(detail.asOf, RANGE_DAYS[range]),
          endDate: detail.asOf,
          asOf: detail.asOf,
          timezone: GSC_REPORT_TIMEZONE,
          scopeNoteKey: 'dimensionTotalsMayDiffer',
          scopeNote: scopeNote(env),
          rowsAvailable: sorted.length,
          rows: page.rows.map((row) => ({
            [label]: row.key,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          })),
        },
        truncated: page.truncated,
      };
    },
  );
}

export function toolListGscTopQueries(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runSiteStoredRead(
    {
      name: 'list_gsc_top_queries',
      schema: listGscTopQueriesInputSchema,
      read: (input, env) => readDimensionRows('query', input, env),
    },
    rawInput,
    context,
  );
}

export function toolListGscTopPages(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runSiteStoredRead(
    {
      name: 'list_gsc_top_pages',
      schema: listGscTopPagesInputSchema,
      read: (input, env) => readDimensionRows('page', input, env),
    },
    rawInput,
    context,
  );
}

// ---------------------------------------------------------------------------
// get_ga4_summary
// ---------------------------------------------------------------------------

export function toolGetGa4Summary(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runSiteStoredRead(
    {
      name: 'get_ga4_summary',
      schema: getGa4SummaryInputSchema,
      read: async (input, env) => {
        const range = input.range ?? READ_RANGE_DEFAULT;
        const { reason, scopes } = await connectionReason(env.accountId);
        if (reason) {
          return { status: 'unavailable', reason, data: { source: GA4_SOURCE, range } };
        }
        if (!scopes.includes(SCOPE_GA4) || !env.site.ga4PropertyId) {
          return {
            status: 'unavailable',
            reason: 'ga4NotLinked',
            data: { source: GA4_SOURCE, range },
          };
        }
        const deps = buildGa4SummaryReadDeps(
          getGoogleConnectionsDb(),
          env.site.ga4BindingGenerationId ?? 'legacy',
          env.site.ga4LastSyncedAt,
        );
        return withStoredFallback(
          GA4_SOURCE,
          range,
          () => getAnalyticsSummaryFor(env.accountId, String(env.site._id), range, deps),
          (summary) => ga4Outcome(range, summary),
        );
      },
    },
    rawInput,
    context,
  );
}

function ga4Outcome(range: ReadRange, summary: GoogleAnalyticsSummary): StoredReadOutcome {
  const series = clampRows(summary.timeseries);
  return {
    status: 'ok',
    count: 1,
    data: {
      source: GA4_SOURCE,
      range,
      startDate: windowStart(summary.asOf, RANGE_DAYS[range]),
      endDate: summary.asOf,
      asOf: summary.asOf,
      freshness: summary.freshness,
      totals: {
        sessions: summary.totalSessions,
        activeUsers: summary.totalActiveUsers,
        engagedSessions: summary.totalEngagedSessions,
        keyEvents: summary.totalKeyEvents,
        engagementRate: summary.engagementRate,
      },
      previousPeriod: summary.previousPeriod
        ? {
            sessions: summary.previousPeriod.totalSessions,
            activeUsers: summary.previousPeriod.totalActiveUsers,
            engagedSessions: summary.previousPeriod.totalEngagedSessions,
            keyEvents: summary.previousPeriod.totalKeyEvents,
          }
        : null,
      channels: summary.channels,
      topPages: summary.topPages,
      countries: summary.countries,
      devices: summary.devices,
      dailySeries: series.rows,
    },
    truncated: series.truncated,
  };
}
