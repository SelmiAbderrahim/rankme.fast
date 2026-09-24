import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { env } from '../../config/env.js';
import type { GoogleGscProvider } from '../../shared/providers/google/gsc.js';
import type { Logger } from 'pino';
import { extractIp, recordAudit } from '../audit/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import type { Db } from '../../db/client.js';
import { buildGenerativeAppearanceRead, readLatestSnapshotDate, readPreviousSnapshotTotals, readSearchAnalytics, readSearchAppearance, readSitemaps, upsertSearchAnalytics, upsertSitemaps, } from '../gsc-snapshots/index.js';
import { readGa4Metrics, readLatestGa4SnapshotDate, readPreviousGa4Totals, upsertGa4Metrics, } from '../ga4-snapshots/index.js';
import { analyticsDetailQuerySchema, analyticsRefreshSchema, analyticsSummaryQuerySchema, completeConnectionSchema, generativeAppearanceQuerySchema, searchAnalyticsQuerySchema, searchRefreshSchema, searchSummaryQuerySchema, setSiteBindingsSchema, siteGoogleParamsSchema, revokeGoogleCredentialSchema, sitemapsQuerySchema, SCOPE_GSC, } from './google-connections.schema.js';
import { getAnalyticsDetailFor, getAnalyticsSummaryFor, runGa4Sync, type Ga4SummaryReadDeps, } from './google-analytics.service.js';
import type { Ga4Provider } from '../../shared/providers/index.js';
import { getConnection, getGoogleConnectionsDb, getSearchAnalyticsDetailFor, getSearchSummaryFor, getSitemapsFor, resolveGoogleAccountFromBetterAuth, runGscSync, upsertConnection, } from './google-connections.service.js';
import { getSiteGoogleConfiguration, listSiteGa4Properties, listSiteGscProperties, loadOwnedGoogleSite, revokeAccountGoogleCredential, setSiteGoogleBindings, unlinkSiteGoogleBindings, } from './site-google.service.js';
import { scheduleGoogleSiteAutoMatch } from './google-site-auto-match.processor.js';
import { enqueueGa4SyncJob, enqueueGscSyncJob, } from '../../shared/queue/index.js';
import { getGscSyncQueue } from './gsc-sync-queue.js';
import { getGa4SyncQueue } from './ga4-sync-queue.js';
import { toIsoDate } from './google-connections.service.js';
export interface GoogleConnectionsControllerDeps {
    gscProvider: GoogleGscProvider;
    /** Wired when the api boots with Google OAuth creds; GA4 handlers 503 without it. */
    ga4Provider?: Ga4Provider | null;
    logger?: Logger;
}
export function createGoogleConnectionsController(deps: GoogleConnectionsControllerDeps) {
    const requireGa4Provider = (): Ga4Provider => {
        if (!deps.ga4Provider) {
            throw HttpError.internal({ code: 'GOOGLE_ERRORS_UNAVAILABLE', messageKey: 'google.errors.unavailable' });
        }
        return deps.ga4Provider;
    };
    const enqueueChangedSiteSyncs = async (accountId: string, site: Awaited<ReturnType<typeof loadOwnedGoogleSite>>, changes: {
        gscChanged: boolean;
        ga4Changed: boolean;
    }): Promise<void> => {
        const day = toIsoDate(new Date());
        const siteId = String(site._id);
        const gscQueue = getGscSyncQueue();
        if (changes.gscChanged && site.gscPropertyUrl && gscQueue) {
            await enqueueGscSyncJob(gscQueue, { accountId, siteId, domain: site.domain }, day);
        }
        const ga4Queue = getGa4SyncQueue();
        if (changes.ga4Changed && site.ga4PropertyId && ga4Queue) {
            await enqueueGa4SyncJob(ga4Queue, { accountId, siteId }, day);
        }
    };
    const complete: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const actorUserId = requireUserId(req.user);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        await loadOwnedGoogleSite(accountId, siteId);
        const body = completeConnectionSchema.parse(req.body);
        // Real OAuth flow: the client sends empty placeholders and the server
        // resolves the refresh token + email + scopes from the Better Auth
        // `account` row. The client-supplied override is accepted only by unit
        // tests and by an explicitly selected fake GSC provider. The fake adapter
        // never reaches Google, so composed E2E/self-host demo stacks can exercise
        // the real connect → sync path without opening a token-injection seam when
        // the live Google adapter is selected.
        const allowBodyOverride = env.NODE_ENV === 'test' || env.PROVIDER_GSC === 'fake';
        let refreshToken = allowBodyOverride ? body.refreshToken : undefined;
        let googleAccountEmail = allowBodyOverride ? body.googleAccountEmail : undefined;
        let scopes = allowBodyOverride ? body.scopes : [];
        if (!refreshToken || !googleAccountEmail) {
            const resolved = await resolveGoogleAccountFromBetterAuth(actorUserId);
            refreshToken ??= resolved.refreshToken;
            googleAccountEmail ??= resolved.googleAccountEmail;
            scopes = [...new Set([...scopes, ...resolved.scopes])];
        }
        if (!scopes.includes(SCOPE_GSC)) {
            throw HttpError.badRequest({ code: 'GOOGLE_ERRORS_MISSING_SCOPE', messageKey: 'google.errors.missingScope' });
        }
        await upsertConnection({
            accountId,
            googleAccountEmail,
            refreshToken,
            scopes,
            ...(deps.logger ? { logger: deps.logger } : {}),
        });
        await recordAudit({
            actorUserId,
            action: 'google.connect',
            targetType: 'site',
            targetId: siteId,
            ip: extractIp(req),
            metadata: { googleAccountEmail },
        });
        await scheduleGoogleSiteAutoMatch(accountId, siteId, deps.logger);
        const configuration = await getSiteGoogleConfiguration(accountId, siteId);
        res.status(201).json({ configuration });
    });
    const configuration: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        res.status(200).json({
            configuration: await getSiteGoogleConfiguration(accountId, siteId),
        });
    });
    const searchProperties: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        const properties = await listSiteGscProperties(accountId, siteId, deps.gscProvider, deps.logger);
        res.status(200).json({ properties });
    });
    const setBindings: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const actorUserId = requireUserId(req.user);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        const body = setSiteBindingsSchema.parse(req.body);
        const changed = await setSiteGoogleBindings(accountId, siteId, body, {
            gscProvider: deps.gscProvider,
            ga4Provider: deps.ga4Provider,
            ...(deps.logger ? { logger: deps.logger } : {}),
        });
        await enqueueChangedSiteSyncs(accountId, changed.site, changed);
        await recordAudit({
            actorUserId,
            action: 'google.set_site_bindings',
            targetType: 'site',
            targetId: siteId,
            ip: extractIp(req),
            metadata: {
                ...(body.gscPropertyUrl !== undefined
                    ? { gscPropertyUrl: body.gscPropertyUrl }
                    : {}),
                ...(body.ga4PropertyId !== undefined
                    ? { ga4PropertyId: body.ga4PropertyId }
                    : {}),
            },
        });
        res.status(200).json({
            configuration: await getSiteGoogleConfiguration(accountId, siteId),
        });
    });
    /**
     * GET /api/sites/:siteId/google/analytics-properties — GA4 property
     * summaries for the Site property picker. Requires the GA4 scope on the
     * connection (400 `google.errors.missingGa4Scope` otherwise).
     */
    const analyticsProperties: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        const properties = await listSiteGa4Properties(accountId, siteId, requireGa4Provider(), deps.gscProvider, deps.logger);
        res.status(200).json({ properties });
    });
    const unlinkBindings: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const actorUserId = requireUserId(req.user);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        await unlinkSiteGoogleBindings(accountId, siteId);
        await recordAudit({
            actorUserId,
            action: 'google.unlink_site',
            targetType: 'site',
            targetId: siteId,
            ip: extractIp(req),
        });
        res.status(200).json({
            configuration: await getSiteGoogleConfiguration(accountId, siteId),
        });
    });
    const revokeCredential: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const actorUserId = requireUserId(req.user);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        revokeGoogleCredentialSchema.parse(req.body);
        await loadOwnedGoogleSite(accountId, siteId);
        const existing = await getConnection(accountId);
        if (!existing) {
            throw HttpError.notFound({ code: 'GOOGLE_ERRORS_NOT_CONNECTED', messageKey: 'google.errors.notConnected' });
        }
        const affectedSiteCount = await revokeAccountGoogleCredential(accountId, deps.gscProvider, deps.logger);
        await recordAudit({
            actorUserId,
            action: 'google.disconnect',
            targetType: 'user',
            targetId: accountId,
            ip: extractIp(req),
        });
        res.status(200).json({ ok: true, affectedSiteCount });
    });
    /**
     * GET /api/sites/:siteId/google/search-summary. Pure Postgres read
     * of the latest audit-written snapshot — never a vendor call. Cross-account
     * siteIds 404 (`sites.errors.notFound`), no data yet 404 (`google.noDataYet`).
     */
    const buildSummaryDeps = (db: Db, bindingGenerationId: string) => ({
        readLatestSnapshotDate: (site: string, dimensionSet: string, windowDays: number) => readLatestSnapshotDate(db, site, dimensionSet, windowDays, bindingGenerationId),
        readSearchAnalytics: (site: string, dimensionSet: string, range: {
            since?: string;
            until?: string;
        }, windowDays: number) => readSearchAnalytics(db, site, dimensionSet, range, windowDays, bindingGenerationId),
        readPreviousTotals: async (site: string, beforeDate: string, windowDays: number) => {
            const totals = await readPreviousSnapshotTotals(db, site, 'query', beforeDate, windowDays, bindingGenerationId);
            return totals
                ? { clicks: totals.clicks, impressions: totals.impressions }
                : null;
        },
    });
    const buildGa4ReadDeps = (db: Db, bindingGenerationId: string): Ga4SummaryReadDeps => ({
        readLatest: (site, dimensionSet, windowDays) => readLatestGa4SnapshotDate(db, site, dimensionSet, windowDays, bindingGenerationId),
        readRows: (site, dimensionSet, windowDays, range) => readGa4Metrics(db, site, dimensionSet, windowDays, range, bindingGenerationId),
        readPreviousTotals: async (site, dimensionSet, windowDays, beforeDate) => {
            const totals = await readPreviousGa4Totals(db, site, dimensionSet, windowDays, beforeDate, bindingGenerationId);
            return totals
                ? {
                    sessions: totals.sessions,
                    activeUsers: totals.activeUsers,
                    engagedSessions: totals.engagedSessions,
                    keyEvents: totals.keyEvents,
                }
                : null;
        },
    });
    const searchSummary: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        const { range } = searchSummaryQuerySchema.parse(req.query);
        const db = getGoogleConnectionsDb();
        const site = await loadOwnedGoogleSite(accountId, siteId);
        const bindingGenerationId = site.gscBindingGenerationId ?? 'legacy';
        const summary = await getSearchSummaryFor(accountId, siteId, buildSummaryDeps(db, bindingGenerationId), range);
        res.status(200).json({ summary });
    });
    /**
     * POST /api/sites/:siteId/google/search-refresh. Re-syncs the Site's Search
     * Analytics snapshot (all five dimension sets + sitemaps) on demand — GSC is
     * free Google quota, so it runs inline. Returns the SAME shape as the GET
     * (`{ summary }`), including its no-data / needs-reconnect 404s, so the
     * client treats a refresh exactly like a reload. Cross-account siteIds 404.
     */
    const searchRefresh: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        const { range } = searchRefreshSchema.parse(req.body);
        const site = await loadOwnedGoogleSite(accountId, siteId);
        assertSiteNotPaused(site);
        const db = getGoogleConnectionsDb();
        await runGscSync(accountId, siteId, site.domain, {
            gscProvider: deps.gscProvider,
            persist: {
                upsertSearchAnalytics: (input) => upsertSearchAnalytics(db, input),
                upsertSitemaps: (input) => upsertSitemaps(db, input),
                /* c8 ignore start -- runGscSync never invokes readPreviousTotals (getSearchSummaryFor computes the delta separately, right after); supplied only to satisfy the GscInsightsPersistence type. */
                readPreviousTotals: async (s, beforeDate, bindingGenerationId) => {
                    const totals = await readPreviousSnapshotTotals(db, s, 'query', beforeDate, 28, bindingGenerationId);
                    return totals
                        ? { clicks: totals.clicks, impressions: totals.impressions }
                        : null;
                },
                /* c8 ignore stop */
            },
            ...(deps.logger ? { logger: deps.logger } : {}),
        });
        const summary = await getSearchSummaryFor(accountId, siteId, buildSummaryDeps(db, site.gscBindingGenerationId ?? 'legacy'), range);
        res.status(200).json({ summary });
    });
    /**
     * GET /api/sites/:siteId/google/search-analytics?dimension=query|page|country|device
     * Full latest snapshot for one dimension set — the "View all" drill-in.
     * Pure Postgres read (≤1000 rows); the client filters/sorts locally.
     */
    const searchAnalytics: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        const { dimension, range } = searchAnalyticsQuerySchema.parse(req.query);
        const db = getGoogleConnectionsDb();
        const site = await loadOwnedGoogleSite(accountId, siteId);
        const detail = await getSearchAnalyticsDetailFor(accountId, siteId, dimension, buildSummaryDeps(db, site.gscBindingGenerationId ?? 'legacy'), range);
        res.status(200).json({ detail });
    });
    /**
     * GET /api/sites/:siteId/google/sitemaps — latest sitemap snapshot. An empty
     * list is a 200 (connected site with no sitemaps); only the ownership /
     * connection ladder 404s.
     */
    const sitemaps: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        sitemapsQuerySchema.parse(req.query);
        const db = getGoogleConnectionsDb();
        const site = await loadOwnedGoogleSite(accountId, siteId);
        const result = await getSitemapsFor(accountId, siteId, {
            readSitemaps: (siteIdValue) => readSitemaps(db, siteIdValue, undefined, site.gscBindingGenerationId ?? 'legacy'),
        });
        res.status(200).json(result);
    });
    /**
     * GET /api/sites/:siteId/google/generative-appearance.
     *
     * First-party generative-AI appearance read for a site. Reads persisted
     * snapshots only — never calls the vendor. Cross-account siteIds 404 via
     * the ownership check. When no snapshot exists the read DTO returns
     * `status='unavailable'` with a null window — not a 404 — so the UI can
     * render an honest empty state.
     */
    const generativeAppearance: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        generativeAppearanceQuerySchema.parse(req.query);
        const site = await loadOwnedGoogleSite(accountId, siteId);
        const db = getGoogleConnectionsDb();
        if (!site.gscPropertyUrl) {
            res.status(200).json({
                appearance: buildGenerativeAppearanceRead([]),
            });
            return;
        }
        const property = site.gscPropertyUrl;
        const rows = await readSearchAppearance(db, siteId, property, {
            bindingGenerationId: site.gscBindingGenerationId ?? 'legacy',
        });
        const read = buildGenerativeAppearanceRead(rows);
        res.status(200).json({ appearance: read });
    });
    /**
     * GET /api/sites/:siteId/google/analytics-summary?range=… (Pro+). Pure Postgres
     * read of the latest GA4 snapshot — never a vendor call. 404 ladder adds
     * `google.analyticsNotEnabled` when the scope/property is missing.
     */
    const analyticsSummary: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        const { range } = analyticsSummaryQuerySchema.parse(req.query);
        const db = getGoogleConnectionsDb();
        const site = await loadOwnedGoogleSite(accountId, siteId);
        const summary = await getAnalyticsSummaryFor(accountId, siteId, range, buildGa4ReadDeps(db, site.ga4BindingGenerationId ?? 'legacy'));
        res.status(200).json({ summary });
    });
    /** GET /api/sites/:siteId/google/analytics-detail?dimension=…&range=… (Pro+). */
    const analyticsDetail: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        const { dimension, range } = analyticsDetailQuerySchema.parse(req.query);
        const db = getGoogleConnectionsDb();
        const site = await loadOwnedGoogleSite(accountId, siteId);
        const detail = await getAnalyticsDetailFor(accountId, siteId, dimension, range, buildGa4ReadDeps(db, site.ga4BindingGenerationId ?? 'legacy'));
        res.status(200).json({ detail });
    });
    /**
     * POST /api/sites/:siteId/google/analytics-refresh (Pro+). Re-syncs the Site's GA4
     * snapshots on demand (free Google quota, coalesced per site) and returns
     * the same `{ summary }` shape as the GET, including its 404s.
     */
    const analyticsRefresh: RequestHandler = asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = siteGoogleParamsSchema.parse(req.params);
        const { range } = analyticsRefreshSchema.parse(req.body);
        const site = await loadOwnedGoogleSite(accountId, siteId);
        assertSiteNotPaused(site);
        const db = getGoogleConnectionsDb();
        await runGa4Sync(accountId, siteId, {
            ga4Provider: requireGa4Provider(),
            gscProvider: deps.gscProvider,
            persist: {
                upsertGa4Metrics: (input) => upsertGa4Metrics(db, input),
            },
            ...(deps.logger ? { logger: deps.logger } : {}),
        });
        const summary = await getAnalyticsSummaryFor(accountId, siteId, range, buildGa4ReadDeps(db, site.ga4BindingGenerationId ?? 'legacy'));
        res.status(200).json({ summary });
    });
    return {
        complete,
        configuration,
        searchProperties,
        setBindings,
        unlinkBindings,
        revokeCredential,
        searchSummary,
        searchRefresh,
        searchAnalytics,
        sitemaps,
        generativeAppearance,
        analyticsProperties,
        analyticsSummary,
        analyticsDetail,
        analyticsRefresh,
    };
}
