/**
 * GA4 sync + summary readers — the analytics side of the Google connection.
 *
 * Kept out of `google-connections.service.ts` (which owns the token
 * lifecycle + GSC) so the two capabilities stay readable. Shares the SAME
 * credential record: one refresh token, one status. The shared GA4 scope and
 * the Site's chosen `ga4PropertyId` gate everything here.
 *
 * Sync shape mirrors `runGscSync`: coalesced in-flight per (account, site),
 * NEVER throws — every failure degrades to a status. Snapshots land in the
 * `ga4-snapshots` module (REPLACE-on-conflict per
 * `(siteId, bindingGenerationId, snapshotDate, dimensionSet, windowDays)`).
 */
import type { Logger } from 'pino';
import { GscReconnectRequiredError } from '../../shared/providers/index.js';
import type { Ga4Provider } from '../../shared/providers/index.js';
import type { GoogleGscProvider } from '../../shared/providers/google/gsc.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { enqueueGa4SyncJob } from '../../shared/queue/index.js';
import { getGa4SyncQueue } from './ga4-sync-queue.js';
import { getConnection, resolveAccessToken, toIsoDate, } from './google-connections.service.js';
import { SCOPE_GA4 } from './google-connections.schema.js';
// ---------------------------------------------------------------------------
// Windows + dimension/metric catalog
// ---------------------------------------------------------------------------
/** Snapshot windows synced per run — the `?range=` options. */
export const GA4_WINDOWS = [7, 28, 90] as const;
export type Ga4Window = (typeof GA4_WINDOWS)[number];
/** The `date` dimension is fetched once at the widest window and sliced. */
export const GA4_DATE_WINDOW: Ga4Window = 90;
/** GA4 export lag default — standard properties finalize within ~24-48h. */
export const GA4_DEFAULT_LAG_DAYS = 1;
const DAY_MS = 86400000;
/** Product-side dimension → GA4 Data API dimension name. */
export const GA4_API_DIMENSIONS = {
    date: 'date',
    channel: 'sessionDefaultChannelGroup',
    page: 'pagePath',
    country: 'country',
    device: 'deviceCategory',
} as const;
export type Ga4ProductDimension = keyof typeof GA4_API_DIMENSIONS;
/** The aggregate dimensions fetched per window (date is handled separately). */
const GA4_WINDOWED_DIMENSIONS = ['channel', 'page', 'country', 'device'] as const;
/** Fixed metric order everywhere: sessions, activeUsers, engagedSessions, keyEvents. */
export const GA4_METRICS = [
    'sessions',
    'activeUsers',
    'engagedSessions',
    'keyEvents',
] as const;
function rowLimitForGa4Dimension(dimension: Ga4ProductDimension): number {
    return dimension === 'page' ? 1000 : 25000;
}
/** Normalize GA4 `YYYYMMDD` date keys to ISO `YYYY-MM-DD`. */
export function normalizeGa4DateKey(key: string): string {
    return /^\d{8}$/.test(key)
        ? `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`
        : key;
}
function ga4Window(fetchedAt: Date, windowDays: number, lagDays: number): {
    startDate: string;
    endDate: string;
} {
    const endDate = toIsoDate(new Date(fetchedAt.getTime() - lagDays * DAY_MS));
    const startDate = toIsoDate(new Date(fetchedAt.getTime() - (lagDays + windowDays - 1) * DAY_MS));
    return { startDate, endDate };
}
// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------
export interface Ga4MetricRowLike {
    key: string;
    sessions: number;
    activeUsers: number;
    engagedSessions: number;
    keyEvents: number;
}
/** Persistence seam — wired to the `ga4-snapshots` module by the caller. */
export interface Ga4SyncPersistence {
    upsertGa4Metrics(input: {
        siteId: string;
        accountId: string;
        bindingGenerationId?: string;
        snapshotDate: string;
        dimensionSet: string;
        windowDays: number;
        rows: readonly Ga4MetricRowLike[];
    }): Promise<void>;
}
/** Vendor-response archiver — GA4 is PRIVATE per-account data, archive-only. */
export type Ga4VendorArchive = (input: {
    capability: 'ga4';
    operation: string;
    params: Record<string, unknown>;
    payload: unknown;
    accountId: string;
    fetchedAt: Date;
}) => Promise<void>;
export interface Ga4SyncDeps {
    ga4Provider: Ga4Provider;
    /** Token lifecycle lives on the GSC provider — the one OAuth client. */
    gscProvider: GoogleGscProvider;
    persist: Ga4SyncPersistence;
    archive?: Ga4VendorArchive;
    logger?: Logger;
    /** Clock seam for tests. */
    now?: () => Date;
    /** Env `GA4_LAG_DAYS`; default 1. */
    lagDays?: number;
}
export interface Ga4SyncResult {
    status: 'ok' | 'no-data' | 'not-connected' | 'not-enabled' | 'needs-reconnect' | 'unavailable';
    /** Snapshot date written, or null when nothing was persisted. */
    snapshotDate: string | null;
    counts: Record<Ga4ProductDimension, number>;
}
const ZERO_GA4_COUNTS: Record<Ga4ProductDimension, number> = {
    date: 0,
    channel: 0,
    page: 0,
    country: 0,
    device: 0,
};
/** In-flight coalescer: concurrent syncs for one (account, site) share a run. */
const ga4SyncInFlight = new Map<string, Promise<Ga4SyncResult>>();
/**
 * Sync every GA4 dimension×window snapshot for one site. Used by the manual
 * refresh endpoint (inline) and the `ga4-sync` queue consumer. Free Google
 * quota; never throws — degrades to a status. Concurrent calls for the same
 * site are coalesced so a double-click makes one Google round-trip.
 */
export function runGa4Sync(accountId: string, siteId: string, deps: Ga4SyncDeps): Promise<Ga4SyncResult> {
    const key = `${accountId}:${siteId}`;
    const existing = ga4SyncInFlight.get(key);
    if (existing)
        return existing;
    const promise = runGa4SyncInner(accountId, siteId, deps).finally(() => {
        ga4SyncInFlight.delete(key);
    });
    ga4SyncInFlight.set(key, promise);
    return promise;
}
function degraded(status: Ga4SyncResult['status']): Ga4SyncResult {
    return { status, snapshotDate: null, counts: { ...ZERO_GA4_COUNTS } };
}
async function runGa4SyncInner(accountId: string, siteId: string, deps: Ga4SyncDeps): Promise<Ga4SyncResult> {
    const { ga4Provider, gscProvider, persist, archive, logger } = deps;
    const now = deps.now ?? (() => new Date());
    const lagDays = deps.lagDays ?? GA4_DEFAULT_LAG_DAYS;
    const { Site } = await import('../sites/index.js');
    const [connection, site] = await Promise.all([
        getConnection(accountId),
        Site.findOne({ _id: siteId, accountId, deletionStartedAt: null }).select('ga4PropertyId ga4BindingGenerationId'),
    ]);
    if (!connection || connection.status === 'revoked') {
        return degraded('not-connected');
    }
    if (connection.status === 'needs_reconnect') {
        return degraded('needs-reconnect');
    }
    if (!connection.scopes.includes(SCOPE_GA4) || !site?.ga4PropertyId) {
        return degraded('not-enabled');
    }
    const propertyId = site.ga4PropertyId;
    const bindingGenerationId = site.ga4BindingGenerationId ?? 'legacy';
    let accessToken: string;
    try {
        accessToken = await resolveAccessToken(accountId, gscProvider, logger);
    }
    catch (err) {
        if (err instanceof GscReconnectRequiredError) {
            return degraded('needs-reconnect');
        }
        logger?.warn({ accountId, err: (err as Error).message }, 'ga4 access-token resolution failed');
        return degraded('unavailable');
    }
    const fetchedAt = now();
    const { endDate } = ga4Window(fetchedAt, 7, lagDays);
    const counts: Record<Ga4ProductDimension, number> = { ...ZERO_GA4_COUNTS };
    const archiveSafely = async (operation: string, params: Record<string, unknown>, payload: unknown) => {
        if (!archive)
            return;
        try {
            await archive({
                capability: 'ga4',
                operation,
                params,
                payload,
                accountId,
                fetchedAt,
            });
        }
        catch (err) {
            logger?.warn({ err: (err as Error).message, operation }, 'ga4 vendor-response archive failed');
        }
    };
    try {
        // Aggregate dimensions: one runReport per (dimension, window).
        for (const dimension of GA4_WINDOWED_DIMENSIONS) {
            for (const windowDays of GA4_WINDOWS) {
                const { startDate } = ga4Window(fetchedAt, windowDays, lagDays);
                const result = await ga4Provider.runReport({ accessToken }, {
                    propertyId,
                    startDate,
                    endDate,
                    dimensions: [GA4_API_DIMENSIONS[dimension]],
                    metrics: [...GA4_METRICS],
                    limit: rowLimitForGa4Dimension(dimension),
                });
                await archiveSafely('run-report', { propertyId, dimension, windowDays, startDate, endDate }, result);
                const rows = result.rows.map((row) => ({
                    key: row.dimensionValues[0] ?? '',
                    sessions: row.metricValues[0] ?? 0,
                    activeUsers: row.metricValues[1] ?? 0,
                    engagedSessions: row.metricValues[2] ?? 0,
                    keyEvents: row.metricValues[3] ?? 0,
                }));
                await persist.upsertGa4Metrics({
                    siteId,
                    accountId,
                    bindingGenerationId,
                    snapshotDate: endDate,
                    dimensionSet: dimension,
                    windowDays,
                    rows,
                });
                if (windowDays === 28)
                    counts[dimension] = rows.length;
            }
        }
        // Daily time series: one fetch at the widest window; ranges slice it.
        const { startDate } = ga4Window(fetchedAt, GA4_DATE_WINDOW, lagDays);
        const dateResult = await ga4Provider.runReport({ accessToken }, {
            propertyId,
            startDate,
            endDate,
            dimensions: [GA4_API_DIMENSIONS.date],
            metrics: [...GA4_METRICS],
            limit: rowLimitForGa4Dimension('date'),
        });
        await archiveSafely('run-report', {
            propertyId,
            dimension: 'date',
            windowDays: GA4_DATE_WINDOW,
            startDate,
            endDate,
        }, dateResult);
        const dateRows = dateResult.rows.map((row) => ({
            key: normalizeGa4DateKey(row.dimensionValues[0] ?? ''),
            sessions: row.metricValues[0] ?? 0,
            activeUsers: row.metricValues[1] ?? 0,
            engagedSessions: row.metricValues[2] ?? 0,
            keyEvents: row.metricValues[3] ?? 0,
        }));
        await persist.upsertGa4Metrics({
            siteId,
            accountId,
            bindingGenerationId,
            snapshotDate: endDate,
            dimensionSet: 'date',
            windowDays: GA4_DATE_WINDOW,
            rows: dateRows,
        });
        counts.date = dateRows.length;
    }
    catch (err) {
        if (err instanceof GscReconnectRequiredError) {
            const { markNeedsReconnect } = await import('./google-connections.service.js');
            await markNeedsReconnect(accountId);
            return degraded('needs-reconnect');
        }
        logger?.warn({ accountId, siteId, err: (err as Error).message }, 'ga4 sync failed');
        return degraded('unavailable');
    }
    return {
        status: counts.channel === 0 ? 'no-data' : 'ok',
        snapshotDate: endDate,
        counts,
    };
}
/**
 * Best-effort: enqueue a `ga4-sync` job for every GA4-bound site. Called
 * from legacy account-level triggers during the migration window so cards fill without
 * waiting. Never throws into the request — a missing queue (no Redis) or a
 * Mongo hiccup just skips + logs. The deterministic per-day jobId dedupes.
 */
export async function enqueueGa4SyncForAccount(accountId: string, logger?: Logger): Promise<void> {
    const queue = getGa4SyncQueue();
    if (!queue)
        return;
    try {
        const { Site } = await import('../sites/index.js');
        // Paused sites are excluded from the connect-time sync fan-out.
        const sites = await Site.find({
            accountId,
            paused: { $ne: true },
            deletionStartedAt: null,
            ga4PropertyId: { $type: 'string', $ne: '' },
        });
        const day = toIsoDate(new Date());
        for (const site of sites) {
            await enqueueGa4SyncJob(queue, { accountId, siteId: String(site._id) }, day);
        }
    }
    catch (err) {
        logger?.warn({ err: (err as Error).message }, 'ga4-sync enqueue on connect/property-change failed');
    }
}
// ---------------------------------------------------------------------------
// ?tab=google analytics summary + drill-in reads
// ---------------------------------------------------------------------------
export type AnalyticsRange = '7d' | '28d' | '90d';
export function rangeToWindowDays(range: AnalyticsRange): Ga4Window {
    return range === '7d' ? 7 : range === '90d' ? 90 : 28;
}
interface Ga4StoredRow {
    dimensionKey: string;
    sessions: number;
    activeUsers: number;
    engagedSessions: number;
    keyEvents: number;
}
export interface Ga4SummaryReadDeps {
    readLatest(siteId: string, dimensionSet: string, windowDays: number): Promise<string | null>;
    readRows(siteId: string, dimensionSet: string, windowDays: number, range: {
        since?: string;
        until?: string;
    }): Promise<Ga4StoredRow[]>;
    readPreviousTotals(siteId: string, dimensionSet: string, windowDays: number, beforeDate: string): Promise<{
        sessions: number;
        activeUsers: number;
        engagedSessions: number;
        keyEvents: number;
    } | null>;
}
export interface GoogleAnalyticsSummary {
    totalSessions: number;
    totalActiveUsers: number;
    totalEngagedSessions: number;
    totalKeyEvents: number;
    /** engagedSessions / sessions, 0 when sessions is 0. */
    engagementRate: number;
    timeseries: Array<{
        date: string;
        sessions: number;
        activeUsers: number;
        engagedSessions: number;
        keyEvents: number;
    }>;
    channels: Array<{
        channel: string;
        sessions: number;
        activeUsers: number;
        engagedSessions: number;
        keyEvents: number;
    }>;
    topPages: Array<{
        url: string;
        sessions: number;
        activeUsers: number;
        engagedSessions: number;
        keyEvents: number;
    }>;
    countries: Array<{
        country: string;
        sessions: number;
        activeUsers: number;
        engagedSessions: number;
        keyEvents: number;
    }>;
    devices: Array<{
        device: string;
        sessions: number;
        activeUsers: number;
        engagedSessions: number;
        keyEvents: number;
    }>;
    asOf: string;
    previousPeriod: {
        totalSessions: number;
        totalActiveUsers: number;
        totalEngagedSessions: number;
        totalKeyEvents: number;
    } | null;
}
/**
 * Shared 404 ladder for analytics reads: site ownership → connection status →
 * GA4 enablement (scope + chosen property). Distinct from the GSC ladder only
 * in the final `google.analyticsNotEnabled` step.
 */
async function assertGa4EnabledFor(accountId: string, siteId: string): Promise<void> {
    const { Site } = await import('../sites/index.js');
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    const connection = await getConnection(accountId);
    if (connection?.status === 'needs_reconnect') {
        throw HttpError.notFound({ code: 'GOOGLE_RECONNECT_TO_SEE_DATA', messageKey: 'google.reconnectToSeeData' });
    }
    if (!connection || connection.status !== 'connected') {
        throw HttpError.notFound({ code: 'GOOGLE_NO_DATA_YET', messageKey: 'google.noDataYet' });
    }
    if (!connection.scopes.includes(SCOPE_GA4) || !site.ga4PropertyId) {
        throw HttpError.notFound({ code: 'GOOGLE_ANALYTICS_NOT_ENABLED', messageKey: 'google.analyticsNotEnabled' });
    }
}
/** Stored-export access seam: ownership and readable GA4 connection only. */
export async function assertGa4StoredReadAccess(accountId: string, siteId: string): Promise<void> {
    await assertGa4EnabledFor(accountId, siteId);
}
function metricShape(row: Ga4StoredRow) {
    return {
        sessions: row.sessions,
        activeUsers: row.activeUsers,
        engagedSessions: row.engagedSessions,
        keyEvents: row.keyEvents,
    };
}
/** ISO date `days - 1` before `endDate` (inclusive window start). */
function windowStartFor(endDate: string, days: number): string {
    const end = new Date(`${endDate}T00:00:00.000Z`);
    return toIsoDate(new Date(end.getTime() - (days - 1) * DAY_MS));
}
/**
 * Read the latest persisted GA4 snapshot for a site — a pure Postgres read;
 * NEVER a vendor call. 404 paths: see `assertGa4EnabledFor`, plus no snapshot
 * for the requested window → `google.noDataYet`.
 */
export async function getAnalyticsSummaryFor(accountId: string, siteId: string, range: AnalyticsRange, deps: Ga4SummaryReadDeps): Promise<GoogleAnalyticsSummary> {
    await assertGa4EnabledFor(accountId, siteId);
    const windowDays = rangeToWindowDays(range);
    const asOf = await deps.readLatest(siteId, 'channel', windowDays);
    if (asOf === null)
        throw HttpError.notFound({ code: 'GOOGLE_NO_DATA_YET', messageKey: 'google.noDataYet' });
    const at = { since: asOf, until: asOf };
    const channelRows = await deps.readRows(siteId, 'channel', windowDays, at);
    const pageRows = await deps.readRows(siteId, 'page', windowDays, at);
    const countryRows = await deps.readRows(siteId, 'country', windowDays, at);
    const deviceRows = await deps.readRows(siteId, 'device', windowDays, at);
    // Daily series lives at the widest window only — slice the tail.
    const dateAsOf = await deps.readLatest(siteId, 'date', GA4_DATE_WINDOW);
    let timeseries: GoogleAnalyticsSummary['timeseries'] = [];
    if (dateAsOf !== null) {
        const dateRows = await deps.readRows(siteId, 'date', GA4_DATE_WINDOW, {
            since: dateAsOf,
            until: dateAsOf,
        });
        const from = windowStartFor(dateAsOf, windowDays);
        timeseries = dateRows
            .filter((row) => row.dimensionKey >= from)
            .sort((a, b) => (a.dimensionKey < b.dimensionKey ? -1 : 1))
            .map((row) => ({ date: row.dimensionKey, ...metricShape(row) }));
    }
    let totalSessions = 0;
    let totalActiveUsers = 0;
    let totalEngagedSessions = 0;
    let totalKeyEvents = 0;
    for (const row of channelRows) {
        totalSessions += row.sessions;
        totalActiveUsers += row.activeUsers;
        totalEngagedSessions += row.engagedSessions;
        totalKeyEvents += row.keyEvents;
    }
    const previous = await deps.readPreviousTotals(siteId, 'channel', windowDays, asOf);
    return {
        totalSessions,
        totalActiveUsers,
        totalEngagedSessions,
        totalKeyEvents,
        engagementRate: totalSessions === 0 ? 0 : totalEngagedSessions / totalSessions,
        timeseries,
        channels: channelRows.map((row) => ({
            channel: row.dimensionKey,
            ...metricShape(row),
        })),
        topPages: pageRows.slice(0, 10).map((row) => ({
            url: row.dimensionKey,
            ...metricShape(row),
        })),
        countries: countryRows.slice(0, 10).map((row) => ({
            country: row.dimensionKey,
            ...metricShape(row),
        })),
        devices: deviceRows.map((row) => ({
            device: row.dimensionKey,
            ...metricShape(row),
        })),
        asOf,
        previousPeriod: previous
            ? {
                totalSessions: previous.sessions,
                totalActiveUsers: previous.activeUsers,
                totalEngagedSessions: previous.engagedSessions,
                totalKeyEvents: previous.keyEvents,
            }
            : null,
    };
}
export interface GoogleAnalyticsDetail {
    asOf: string;
    rows: Array<{
        key: string;
        sessions: number;
        activeUsers: number;
        engagedSessions: number;
        keyEvents: number;
    }>;
}
/** Full latest snapshot for ONE aggregate dimension — the "View all" drill-in. */
export async function getAnalyticsDetailFor(accountId: string, siteId: string, dimension: 'channel' | 'page' | 'country' | 'device', range: AnalyticsRange, deps: Ga4SummaryReadDeps): Promise<GoogleAnalyticsDetail> {
    await assertGa4EnabledFor(accountId, siteId);
    const windowDays = rangeToWindowDays(range);
    const asOf = await deps.readLatest(siteId, dimension, windowDays);
    if (asOf === null)
        throw HttpError.notFound({ code: 'GOOGLE_NO_DATA_YET', messageKey: 'google.noDataYet' });
    const rows = await deps.readRows(siteId, dimension, windowDays, {
        since: asOf,
        until: asOf,
    });
    return {
        asOf,
        rows: rows.map((row) => ({ key: row.dimensionKey, ...metricShape(row) })),
    };
}
