import express, { type Express, Router } from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { toNodeHandler } from 'better-auth/node';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { accessLogRequestSerializer } from './config/access-log.js';
import { errorHandler } from './shared/middleware/error-handler.js';
import { notFound } from './shared/middleware/not-found.js';
import { requestId } from './shared/middleware/request-id.js';
import { language } from './shared/middleware/language.js';
import { bearerLanguage } from './shared/middleware/bearer-language.js';
import { securityHeaders } from './shared/middleware/security-headers.js';
import { createApiIpRateLimiter, createApiRateLimiter, createAuthRateLimiter, createBatchRateLimiter, createContactRateLimiter, } from './shared/middleware/rate-limit.js';
import { issueCsrfToken, requireCsrf } from './shared/middleware/csrf.js';
import { getAuth, localizeBetterAuthResponse, requireClaimedAccount, requireVerified, } from './modules/auth/index.js';
import { requireAuth } from './shared/middleware/require-auth.js';
import { workspaceContext } from './shared/middleware/workspace-context.js';
import { requireTeamResourceSiteAccess, requireTeamSiteAccess, } from './shared/middleware/team-site-access.js';
import { requireAccountId } from './shared/utils/require-account-id.js';
import { requireWorkspaceOwner, } from './shared/middleware/require-team-role.js';
// Imported from the holder leaf, not the team barrel: the barrel pulls in the
// router/controller chain, and app.ts is imported by them (known cycle class).
import { getTeamDb } from './modules/team/team.holder.js';
import { communicationRouter } from './modules/communication/index.js';
import { usersRouter } from './modules/users/index.js';
import { auditRouter } from './modules/audit/index.js';
import { auditsRouter, auditsSiteRouter, resolveOwnedAuditRunSiteId, } from './modules/audits/index.js';
import { actionsSiteRouter, registerBuiltInActionAdapters } from './modules/actions/index.js';
import { healthRouter } from './modules/health/index.js';
import { seoRouter } from './modules/seo/index.js';
import { configureLegalController, getAccountPurgeQueue, legalRouter, } from './modules/legal/index.js';
import { bodySiteMutationLease, createSiteMutationLease, querySiteMutationLease, siteMutationLease, sitesRouter, } from './modules/sites/index.js';
import { getRanksDb, ranksKeywordRouter, ranksSiteRouter, resolveOwnedKeywordSiteId, } from './modules/ranks/index.js';
import { googleConnectionsRouter } from './modules/google-connections/index.js';
import { keywordResearchRouter, resolveOwnedTrendsRunSiteId, } from './modules/keyword-research/index.js';
import { createBacklinkDeepRouter, backlinksRouter, resolveOwnedBacklinkDeepRunSiteId, resolveOwnedLinkGapRunSiteId, resolveOwnedToxicityReviewSiteId, } from './modules/backlinks/index.js';
import { createCompetitorIntelligenceRouter, competitorsRouter, resolveOwnedTrafficSnapshotSiteId, } from './modules/competitors/index.js';
import { aiVisibilityRouter } from './modules/ai-visibility/index.js';
import { createReviewSyncRouter, localSeoRouter, resolveOwnedReviewRunSiteId, resolveOwnedReviewSourceSiteId, } from './modules/local-seo/index.js';
import { createBrandRadarRouter, createBrandRadarSiteRouter, resolveOwnedBrandRadarScanSiteId, } from './modules/brand-radar/index.js';
import { createCannibalizationReportRouter, createCannibalizationSiteRouter, resolveOwnedCannibalizationReportSiteId, } from './modules/cannibalization/index.js';
import { createSchemaGeneratorRouter, resolveOwnedSchemaGenerationSiteId, } from './modules/schema-generator/index.js';
import { createAlertsRouter, resolveOwnedAlertRuleSiteId, } from './modules/alerts/index.js';
import { createInternalLinksRunRouter, createInternalLinksSiteRouter, resolveOwnedInternalLinkRunSiteId, } from './modules/internal-links/index.js';
import { createKeywordClustersRunRouter, createKeywordClustersSiteRouter, resolveOwnedKeywordClusterRunSiteId, } from './modules/keyword-clusters/index.js';
import { createContentBriefRouter } from './modules/content-briefs/index.js';
import { createGeogridRouter } from './modules/geogrid/index.js';
import { teamActorInvitationRouter, teamPublicInvitationRouter, teamRouter, } from './modules/team/index.js';
import { createContentIntelligenceAnalysisRouter, createContentIntelligenceSiteRouter, createContentInventoryRouter, resolveOwnedAnalysisSiteId, } from './modules/content-intelligence/index.js';
import { createAudienceResearchSiteRouter } from './modules/audience-research/index.js';
import { createCompetitorContentRouter } from './modules/competitor-content/index.js';
import { createContentMonitoringRouter, monitorWebhookHandler, } from './modules/content-monitoring/index.js';
import { createWeeklyPulseSiteRouter } from './modules/weekly-pulse/index.js';
import { apiKeysRouter, getApiKeysDb } from './modules/api-keys/index.js';
import { createApiKeyAuth, v1Router } from './modules/public-api/index.js';
import { mcpRouter } from './modules/mcp/index.js';
import { mcpPermissionsRouter } from './modules/mcp-permissions/index.js';
import { createChatRouter, resolveOwnedConversationSiteId, } from './modules/chat/index.js';
import { accountPurgeJobId, enqueueAccountPurgeJob, } from './shared/queue/index.js';
import { createClientReportsRouter, createPublicClientPortalRouter, } from './modules/client-reports/index.js';
import { createPublicReportSharesRouter, createReportExportsRouter, } from './modules/report-exports/index.js';
import { createPagesRouter } from './modules/pages/index.js';
import { createAppSeoRouter } from './modules/app-seo/index.js';
import { marketCatalogRouter } from './modules/market-catalog/index.js';
export async function enqueueLegalAccountPurge(input: {
    userId: string;
    purgeAt: Date;
}): Promise<void> {
    const queue = getAccountPurgeQueue();
    if (!queue)
        throw new Error('account-purge queue unavailable (REDIS_URL unset)');
    await enqueueAccountPurgeJob(queue, { userId: input.userId }, input.purgeAt);
}
export async function cancelLegalAccountPurge(input: {
    userId: string;
}): Promise<void> {
    const queue = getAccountPurgeQueue();
    if (!queue)
        throw new Error('account-purge queue unavailable (REDIS_URL unset)');
    await queue.remove(accountPurgeJobId(input.userId));
}
export function resolveOwnedResourceSiteIdFromRequest(req: express.Request, resolveSiteId: (accountId: string, resourceId: string) => Promise<string | null>, parameter: string): Promise<string | null> {
    return resolveSiteId(requireAccountId(req), req.params[parameter] ?? '');
}
export function resolveAccountWideResourceSiteId(): null {
    return null;
}
export function createApp(): Express {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 1);
    app.use(requestId);
    // Security headers. Applied early so every response — even
    // errors from the raw-body webhook route below — carries them.
    app.use(securityHeaders);
    app.use(pinoHttp({
        logger,
        serializers: { req: accessLogRequestSerializer },
        customProps: (req: express.Request) => ({ reqId: req.id }),
    }));
    // CORS is locked to the exact public + app origins. No wildcard or dynamic
    // reflection; credentialed app requests may reach the apex API during a
    // split-domain deployment without trusting any other subdomain.
    app.use(cors({ origin: [...new Set([env.CLIENT_URL, env.APP_URL])], credentials: true }));
    // Language resolution must precede the auth rate limiter so its 429 body is
    // localized. Header/cookie based — never touches the request body.
    app.use(language);
    // Firecrawl monitor webhook — the batch's only unauthenticated
    // inbound surface. The per-IP `firecrawl_webhook` bucket runs FIRST so a flood/oversized body
    // is rejected before any HMAC work, then `express.raw` hands the handler the
    // untouched Buffer for signature verification. Mounted BEFORE express.json()
    // and OUTSIDE the requireCsrf/requireAuth/requireVerified chain — it
    // authenticates the delivery by HMAC, not by a session cookie or CSRF token.
    app.post('/api/firecrawl/webhook', createBatchRateLimiter('firecrawl_webhook'), express.raw({ type: '*/*', limit: '1mb' }), monitorWebhookHandler);
    // Better Auth handles every /api/auth/* route (sign-up, sign-in, sign-out,
    // password reset, email verification, Google OAuth). MUST mount BEFORE
    // express.json(): a consumed body stream breaks the fetch-style handler.
    // CSRF for these routes is Better Auth's Origin/trusted-origins validation —
    // no hand-rolled tokens, `disableCSRFCheck` stays unset. The rate limiter
    // runs first so sustained cracking attempts hit 429 before the handler.
    // `getAuth()` is resolved per request (not captured at wiring time) so the
    // test harness can swap in a PGlite-backed instance after createApp().
    // `.catch(next)` observes any rejection from the Better Auth handler and
    // forwards it to the global error handler → localized 500. Prior code
    // `void`-discarded the promise, so a DB hiccup during session lookup would
    // leave the request hanging AND surface as an unhandledRejection (process
    // exit on Node ≥15).
    app.all('/api/auth/*', createAuthRateLimiter(), (req, res, next) => {
        toNodeHandler({
            handler: async (request) => localizeBetterAuthResponse(request, await getAuth().handler(request)),
        })(req, res).catch(next);
    });
    app.use(express.json({ limit: '1mb' }));
    // CSRF token endpoint (double-submit). Cookie-authenticated surfaces call
    // this before any mutating request. Bearer-token API calls are exempt from
    // CSRF because they do not authenticate with ambient cookies.
    const securityRouter = Router();
    securityRouter.get('/csrf-token', issueCsrfToken);
    app.use('/api/security', securityRouter);
    // SEO endpoints (robots.txt, sitemaps) — top-level, public, no auth. Mounted
    // before the /api routers and before notFound so they resolve first.
    app.use('/', seoRouter);
    configureLegalController({
        queue: {
            enqueuePurge: enqueueLegalAccountPurge,
            cancelPurge: cancelLegalAccountPurge,
        },
    });
    app.use('/api', healthRouter);
    // GDPR export/deletion stays reachable even for unverified accounts (data
    // rights must not be gated); health/seo/security are public above.
    app.use('/api/legal', legalRouter);
    // Contact form — per-IP limiter fronts the unauthenticated
    // POST so a spam relay looping the endpoint hits 429 before any Resend
    // spend. Constructed here so tests can rebuild the MemoryStore via a
    // fresh createApp().
    app.use('/api/communication', createContactRateLimiter(), communicationRouter);
    // Reusable, hashed portal tokens are the only authority for this read-only
    // surface. It deliberately sits outside the cookie authentication chain.
    app.use('/api/client-portal', createPublicClientPortalRouter());
    // Immutable unified report shares use their own hash-only bearer. The
    // public router deliberately stays outside cookie auth; it performs strict
    // IP + proven-token limiting and returns one constant 404 for every denial.
    app.use('/api/report-shares', createPublicReportSharesRouter());
    // Invitation decisions must remain reachable before the verified product
    // chain: an invited account is intentionally unverified until it accepts,
    // and a rejection link is a public capability. Keep the limiter path-
    // specific so ordinary team-roster traffic retains its existing contract.
    for (const prefix of [
        '/api/team/invitations',
        '/api/team/accept',
        '/api/team/reject',
    ]) {
        app.use(prefix, createApiRateLimiter());
    }
    app.use('/api/team', teamPublicInvitationRouter);
    app.use('/api/team', teamActorInvitationRouter);
    // Product surfaces are hard-gated: an authenticated but unverified user is
    // blocked (403 EMAIL_NOT_VERIFIED) until they confirm their email.
    // `requireAuth` copies emailVerified off the session for `requireVerified`.
    // `requireCsrf` fronts the chain — every cookie-authed mutation must echo
    // the double-submit token; forged requests are rejected before a session
    // lookup burns DB time. Safe methods + bearer requests pass through.
    // `workspaceContext` closes the chain so EVERY product surface — including
    // the site-mutation leases below and the guards inside each router —
    // resolves the workspace owner rather than the calling member. It must stay
    // last: it needs `req.user` from `requireAuth`.
    const verified = [
        requireCsrf,
        requireAuth,
        requireClaimedAccount,
        requireVerified,
        workspaceContext(getTeamDb),
    ];
    app.use('/api/market-catalogs', verified, createApiRateLimiter(), marketCatalogRouter);
    // Unified Pages reads and its source refresh are explicitly allowed for
    // paused sites and workspace members. Mount before the broad site-mutation
    // lease so reads remain available while all handlers still receive the
    // verified account context and Pages' own read/refresh rate buckets.
    app.use('/api/sites/:siteId/pages', verified, requireTeamSiteAccess((req) => req.params.siteId), createPagesRouter());
    app.use('/api/sites/:siteId', verified, siteMutationLease);
    // Several older product surfaces accept the owning site in the JSON body
    // instead of nesting under `/api/sites/:siteId`. Give those spend/enqueue
    // paths the same durable lease boundary. Client reports does use a nested
    // path, but under its own prefix.
    app.use('/api/client-reports/sites/:siteId', verified, siteMutationLease);
    for (const prefix of [
        '/api/backlinks',
        '/api/competitors',
        '/api/local-seo',
        '/api/schema-generator',
        '/api/alerts',
        '/api/keyword-research',
        '/api/chat',
    ]) {
        app.use(prefix, verified, bodySiteMutationLease);
        app.use(prefix, verified, querySiteMutationLease);
    }
    const leaseOwnedResource = (resolveSiteId: (accountId: string, resourceId: string) => Promise<string | null>, parameter: string) => {
        const resolve = (req: express.Request) => resolveOwnedResourceSiteIdFromRequest(req, resolveSiteId, parameter);
        return [
            // A null resolver result is either missing or an intentionally
            // account-wide legacy resource. Both are a 404 for selected-scope
            // teammates; otherwise a site-less row would bypass the lease's
            // ordinary `if (!siteId) next()` lifecycle behavior.
            requireTeamResourceSiteAccess(resolve),
            createSiteMutationLease(resolve, { includeSafeMethods: true }),
        ];
    };
    app.use('/api/content-analyses/:analysisId', verified, leaseOwnedResource(resolveOwnedAnalysisSiteId, 'analysisId'));
    app.use('/api/audits/:runId', verified, leaseOwnedResource(resolveOwnedAuditRunSiteId, 'runId'));
    app.use('/api/local-seo/reviews/sources/:id', verified, leaseOwnedResource(resolveOwnedReviewSourceSiteId, 'id'));
    for (const path of [
        '/api/local-seo/reviews/runs/:id',
        '/api/local-seo/reviews/stats/:id',
        '/api/local-seo/reviews/themes/:id',
    ]) {
        app.use(path, verified, leaseOwnedResource(resolveOwnedReviewRunSiteId, 'id'));
    }
    app.use('/api/alerts/rules/:ruleId', verified, leaseOwnedResource(resolveOwnedAlertRuleSiteId, 'ruleId'));
    app.use('/api/chat/conversations/:id', verified, leaseOwnedResource(resolveOwnedConversationSiteId, 'id'));
    app.use('/api/cannibalization-reports/:reportId', verified, leaseOwnedResource(resolveOwnedCannibalizationReportSiteId, 'reportId'));
    app.use('/api/brand-radar/scans/:id', verified, leaseOwnedResource(resolveOwnedBrandRadarScanSiteId, 'id'));
    app.use('/api/schema-generator/generations/:generationId', verified, leaseOwnedResource(resolveOwnedSchemaGenerationSiteId, 'generationId'));
    app.use('/api/internal-link-runs/:runId', verified, leaseOwnedResource(resolveOwnedInternalLinkRunSiteId, 'runId'));
    app.use('/api/keyword-cluster-runs/:runId', verified, leaseOwnedResource(resolveOwnedKeywordClusterRunSiteId, 'runId'));
    app.use('/api/backlinks/runs/:id', verified, leaseOwnedResource(resolveOwnedBacklinkDeepRunSiteId, 'id'));
    app.use('/api/backlinks/gap/:runId', verified, leaseOwnedResource(resolveOwnedLinkGapRunSiteId, 'runId'));
    app.use('/api/backlinks/toxicity/:runId', verified, leaseOwnedResource(resolveOwnedToxicityReviewSiteId, 'runId'));
    app.use('/api/competitors/traffic-snapshots/:id', verified, leaseOwnedResource(resolveOwnedTrafficSnapshotSiteId, 'id'));
    app.use('/api/keywords/:id', verified, leaseOwnedResource((accountId, keywordId) => resolveOwnedKeywordSiteId(accountId, keywordId, getRanksDb()), 'id'));
    // This resource lease belongs only to the stored-run GET. Mounting it with
    // `use` also interprets the sibling POST `/trends/explore` path as a run id,
    // which prevents selected-site teammates from reaching the handler's
    // explicit site-scope check.
    app.get('/api/keyword-research/trends/:runId', verified, leaseOwnedResource(resolveOwnedTrendsRunSiteId, 'runId'));
    app.use('/api/audit', verified, auditRouter);
    app.use('/api/users', verified, usersRouter);
    app.use('/api/sites', verified, sitesRouter);
    // App SEO registration and the later ASO sub-surfaces share one site-nested
    // mount. The broad `/api/sites/:siteId` lease above already covers this
    // prefix, so every profile mutation/read participates in site deletion.
    app.use('/api/sites/:siteId/apps', verified, createAppSeoRouter());
    // Audit runs. Two mounts: `/api/sites/:siteId/audits` (start
    // + list) and `/api/audits/:runId` (get) — kept path-specific so the
    // auth middleware never fires for unrelated `/api/*` traffic.
    app.use('/api/sites', verified, auditsSiteRouter);
    app.use('/api/audits', verified, auditsRouter);
    // Unified Next Actions read model + append-only history.
    registerBuiltInActionAdapters();
    app.use('/api/sites/:siteId/actions', verified, actionsSiteRouter);
    // Ranks. Two mounts mirror audits: site-scoped keyword CRUD +
    // cadence sit under `/api/sites/:siteId/*`; keyword-scoped reads (history
    // for the trend UI) sit under `/api/keywords/:id/*`.
    app.use('/api/sites', verified, ranksSiteRouter);
    app.use('/api/keywords', verified, ranksKeywordRouter);
    // Google configuration and stored reads are Site-scoped. The encrypted
    // credential is shared by the owner, but every resource selection belongs
    // to the Site in the URL; the former account-global /api/google mount is
    // intentionally absent.
    app.use('/api/sites/:siteId/google', verified, requireTeamSiteAccess((req) => req.params.siteId), requireWorkspaceOwner, googleConnectionsRouter);
    // Keyword research. Provider
    // + db resolved per request via the module's holder so tests inject a fake
    // provider at boot with `setKeywordProvider(...)`.
    // Legacy research history and AI clusters have no Site foreign key. They
    // may aggregate evidence from denied Sites, so selected-scope teammates
    // fail closed until the resources can be unambiguously Site-bound.
    app.use(['/api/keyword-research/history', '/api/keyword-research/clusters'], verified, requireTeamResourceSiteAccess(resolveAccountWideResourceSiteId, 'keywordResearch.errors.runNotFound'));
    app.use('/api/keyword-research', verified, keywordResearchRouter);
    // Backlinks. Site-scoped: /:siteId/backlinks/*.
    // Competitors. Site-scoped: /:siteId/competitors/*.
    // Both providers + db resolved per request via holders so tests inject
    // fakes at boot with `setBacklinkProvider(...)` / `setCompetitorProvider(...)`.
    app.use('/api/sites', verified, backlinksRouter);
    app.use('/api/backlinks', verified, createBacklinkDeepRouter());
    app.use('/api/sites', verified, competitorsRouter);
    app.use('/api/competitors', verified, competitorsRouter);
    app.use('/api/sites/:siteId/competitor-intelligence', verified, createCompetitorIntelligenceRouter());
    app.use('/api/sites', verified, aiVisibilityRouter);
    // Local SEO. Site-scoped: /:siteId/local-seo/*.
    // Provider + db resolved per request via the module's holder so tests
    // inject fakes at boot with `setLocalSeoProvider(...)`.
    app.use('/api/sites', verified, localSeoRouter);
    // Review Intelligence. Profile-scoped under `/api/local-seo/reviews/*`; the named `review_sync` bucket
    // and the REVIEW_INTELLIGENCE_ENABLED kill switch live inside the router
    // and service.
    app.use('/api/local-seo', verified, createReviewSyncRouter());
    // Brand Radar. The BRAND_RADAR_ENABLED kill switch and the two named
    // per-account buckets (`brand_radar_create`, `brand_radar_poll`) live
    // inside the routers and service. Two mounts:
    // site-scoped preview/create/list under `/api/sites/:siteId/brand-radar`,
    // covered by the `/api/sites/:siteId` param lease, and scan-scoped stored
    // reads under `/api/brand-radar/scans/:id` behind the owned-resource lease.
    app.use('/api/sites', verified, createBrandRadarSiteRouter());
    app.use('/api/brand-radar', verified, createBrandRadarRouter());
    // Content Intelligence. Two mounts mirror audits: site-scoped
    // create/preflight/list under `/api/sites/:siteId/content-analyses` and
    // analysis-scoped get/cancel/regenerate under `/api/content-analyses/:analysisId`.
    // Per-bucket rate limiters (`content_intelligence_create`,
    // `content_intelligence_poll`) live inside the routers.
    app.use('/api/sites', verified, createContentIntelligenceSiteRouter());
    app.use('/api/content-analyses', verified, createContentIntelligenceAnalysisRouter());
    // Keyword cannibalization reports. Computed
    // synchronously from the stored GSC `query,page` snapshots — no queue, no
    // vendor call. Site-scoped preview/generate/list under
    // `/api/sites/:siteId/cannibalization-reports`; free stored re-open under
    // `/api/cannibalization-reports/:reportId`. The CANNIBALIZATION_ENABLED kill
    // switch and the two named per-account buckets live in the router+service.
    app.use('/api/sites', verified, createCannibalizationSiteRouter());
    app.use('/api/cannibalization-reports', verified, createCannibalizationReportRouter());
    // Schema markup generator. Generation is
    // INLINE and bounded — one `schema_generator` AI pass whose ceiling equals
    // the `schema_generations` unit cost, so there is no queue and no worker
    // consumer. Assembles bounded first-party evidence as a free preflight
    // before the AI generation; the SCHEMA_GENERATOR_ENABLED kill switch and the two named per-account buckets
    // (`schema_generator_create` / `schema_generator_poll`) live in the
    // router+service.
    app.use('/api/schema-generator', verified, createSchemaGeneratorRouter());
    // Alert rules + channels. Rule CRUD is
    // first-party compute — no queue on the API path; detection enqueues
    // `alert-dispatch` from the worker instead. The ALERTS_ENABLED kill switch
    // gates MUTATIONS only (stored rule/log reads survive a flag flip), and
    // the two named per-account buckets (`alerts_manage` /
    // `alerts_poll`) live in the router factory.
    app.use('/api/alerts', verified, createAlertsRouter());
    // Content inventory + cannibalization. Site-scoped router:
    // start/list/get/cancel under
    // `/api/sites/:siteId/content-intelligence/inventory`. The per-bucket
    // rate limiters (`inventory_start`, `content_intelligence_poll`) live in the
    // router factory.
    app.use('/api/sites', verified, createContentInventoryRouter());
    // Internal-link suggestions (community request 07). Reads one pinned,
    // completed inventory plus stored 28-day GSC rows; never crawls. Preview,
    // create and list are site-scoped; free detail/CSV re-open is run-scoped.
    app.use('/api/sites', verified, createInternalLinksSiteRouter());
    app.use('/api/internal-link-runs', verified, createInternalLinksRunRouter());
    // Keyword clustering by SERP overlap (community request 02). Deterministic
    // grouping over the durable `serp_observations` stores; zero vendor
    // spend and no refund path. Preview, create and list are site-scoped; free
    // detail re-open is run-scoped. The KEYWORD_CLUSTERING_ENABLED kill switch
    // refuses preview/create while stored reads stay open.
    app.use('/api/sites', verified, createKeywordClustersSiteRouter());
    app.use('/api/keyword-cluster-runs', verified, createKeywordClustersRunRouter());
    // SERP-based content briefs and editor. One run covers the stored or
    // fetched SERP, at most ten one-page scrapes, statistics, and initial AI.
    // Stored re-open and draft history reads are free; creation and re-score use
    // distinct named per-account rate buckets inside the router.
    app.use('/api/sites', verified, createContentBriefRouter());
    app.use('/api/sites', verified, createGeogridRouter());
    // Competitor content intelligence. Site-scoped router:
    // suggestions / confirm-add / archive-restore / run start-list-get-cancel
    // under `/api/sites/:siteId/competitor-content/*`. The per-bucket rate
    // limiters (`competitor_manage`, `content_intelligence_poll`) live in the
    // router factory.
    app.use('/api/sites', verified, createCompetitorContentRouter());
    // Public-page change monitoring. Site-scoped router:
    // monitor CRUD + change feed under
    // `/api/sites/:siteId/content-monitoring/monitors`. The weekly check is
    // scheduled by the reconciliation sweep (never at the API layer); the
    // per-bucket rate limiters (`content_intelligence_create`/`_poll`)
    // live in the router factory. The unauthenticated webhook is mounted
    // separately above (before express.json).
    app.use('/api/sites', verified, createContentMonitoringRouter());
    // Audience Research. Site-scoped router — enqueues to the owned BullMQ
    // queue.
    app.use('/api/sites', verified, createAudienceResearchSiteRouter());
    // Weekly Pulse. Site-scoped router: state / preview / put /
    // history / detail. PUT validates preview acknowledgement — the scheduled
    // job is authoritative.
    app.use('/api/sites', verified, createWeeklyPulseSiteRouter());
    // Stored-snapshot client report composition.
    // Schedules and portal management extend this same router in section 2.
    app.use('/api/client-reports', verified, createClientReportsRouter());
    app.use('/api/report-exports', verified, createReportExportsRouter());
    // Team invites + membership management. Owner/self-scoped; cross-
    // account access returns 404 not 403 per the better-auth rules.
    app.use('/api/team', verified, teamRouter);
    // Account-level MCP permission defaults. Cookie
    // chain, no feature gate.
    app.use('/api/mcp-permissions', verified, requireWorkspaceOwner, mcpPermissionsRouter);
    // AI Assistant streaming chat. Cookie chain → named per-account `chat`
    // rate bucket inside the router. CHAT_ENABLED refuses inside the message
    // POST before any SSE bytes.
    app.use('/api/chat', verified, createChatRouter());
    // API-key management (workstream C). Cookie-authed like every other product
    // surface.
    app.use('/api/api-keys', verified, requireWorkspaceOwner, apiKeysRouter);
    // Public read-only API v1 (workstream C). Bearer-key authed — NOT behind
    // the cookie chain. Order:
    //   1. per-IP rate limiter — throttles unauthenticated bearer floods so
    //      an attacker rotating random bearers on one IP cannot allocate
    //      per-token buckets.
    //   2. per-token rate limiter — buckets by sha256(token) once the token
    //      has been proven (see `markTokenAuthenticated`); otherwise falls
    //      through to IP.
    //   3. bearer-key auth (populates req.user + marks the token proven).
    //   4. read-only routes.
    const resolveApiDb = () => getApiKeysDb();
    app.use('/api/v1', bearerLanguage, createApiIpRateLimiter(), createApiRateLimiter(), createApiKeyAuth(resolveApiDb));
    app.use('/api/v1/sites/:siteId', siteMutationLease);
    app.use('/api/v1', querySiteMutationLease);
    app.use('/api/v1', v1Router);
    // MCP endpoint — bearer-authed JSON-RPC surface. Same layered
    // chain as /api/v1 but the per-token bucket is the named `mcp` bucket
    // (records to rate_limit_hits.route = 'mcp'). MCP_ENABLED short-
    // circuits inside the controller with a localized JSON-RPC unavailable
    // envelope before any tool work.
    app.use('/api/mcp', bearerLanguage, createApiIpRateLimiter(), createBatchRateLimiter('mcp'), createApiKeyAuth(resolveApiDb), mcpRouter);
    app.use(notFound);
    app.use(errorHandler);
    return app;
}
