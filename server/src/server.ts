/* c8 ignore start -- composition root / integration seam: also listed in
 * vitest.config.ts coverage.exclude, but the v8 report-side exclude filter
 * has proven unreliable on some runs, so the seam is marked inline too. */
import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env, validateAiProviderBaseUrls } from './config/env.js';
import { logger } from './config/logger.js';
import { runMigrations } from './db/migrate.js';
import { createAiProfileRunRecorder } from './db/ai-profile-run-events.js';
import { closeDatastores } from './db/shutdown.js';
import { createAuditCompletedHandler, createAuditFailedHandler, setAuditsQueue, setSummaryDb, setSummaryProvider, } from './modules/audits/index.js';
import { setRanksDb, setRanksQueue } from './modules/ranks/index.js';
import { setAppSeoResearchProvider, setAppSeoTrackingQueue, } from './modules/app-seo/index.js';
import { setPulseQueue } from './modules/weekly-pulse/pulse.queue-holder.js';
import { setClientReportsQueue } from './modules/client-reports/index.js';
import { setGa4SyncQueue, setGoogleGa4Provider, setGoogleGscProvider, setGscSyncQueue, } from './modules/google-connections/index.js';
import { setKeywordDiscoveryContentSourceProvider, setKeywordProvider, setKeywordResearchAiRunner, setKeywordResearchCompetitorProvider, setKeywordResearchDb, setKeywordResearchTrendsProvider, } from './modules/keyword-research/index.js';
import { setSchemaGeneratorAiRunner } from './modules/schema-generator/index.js';
import { createAiProfileRunner } from './shared/ai-profiles/index.js';
import { setBacklinkProvider, setBacklinksDb, setBacklinkDeepQueue, } from './modules/backlinks/index.js';
import { setCompetitorProvider, setCompetitorsDb, setCompetitorLandscapeDb, setCompetitorLandscapeQueue, setTrafficSnapshotsQueue, } from './modules/competitors/index.js';
import { setAiVisibilityDb, setAiVisibilityProvider, setAiVisibilitySummaryProvider, } from './modules/ai-visibility/index.js';
import { setLocalSeoDb, setLocalSeoProvider, setLocalSeoRankProvider, setReviewSyncQueue, } from './modules/local-seo/index.js';
import { setBrandRadarDb, setBrandRadarQueue, } from './modules/brand-radar/index.js';
import { backfillStoredOAuthTokens, seedSuperadmin, } from './modules/auth/index.js';
import { guardSiteLifecycleCalls, guardSiteLifecycleStream, installSiteMongoWriteBarrier, installSiteQueueWriteBarrier, setSiteLifecycleQueues, setSitesDb, } from './modules/sites/index.js';
import { setApiKeysDb } from './modules/api-keys/index.js';
import { setTeamDb } from './modules/team/index.js';
import { createCoreReportExportAdapterRegistry, setReportExportAdapterRegistry, setReportExportsDb, } from './modules/report-exports/index.js';
import { guardAccountLifecycleCalls, guardAccountLifecycleStream, installAccountMongoWriteBarrier, installAccountQueueWriteBarrier, setAccountPurgeQueue, } from './modules/legal/index.js';
import { setContentAnalysisQueue, setContentInventoryQueue, setContentIntelligenceDb, } from './modules/content-intelligence/index.js';
import { setInternalLinksDb, setInternalLinksQueue, } from './modules/internal-links/index.js';
import { setKeywordClustersDb, setKeywordClustersQueue, } from './modules/keyword-clusters/index.js';
import { setContentBriefAi, setContentBriefDb, setContentBriefQueue, } from './modules/content-briefs/index.js';
import { setGeogridDb, setGeogridQueue } from './modules/geogrid/index.js';
import { setAudienceResearchDb, setAudienceResearchQueue, } from './modules/audience-research/index.js';
import { setCompetitorContentDb, setCompetitorContentQueue, } from './modules/competitor-content/index.js';
import { setContentMonitorDb, setContentMonitorProvider, setContentMonitorQueue, } from './modules/content-monitoring/index.js';
import { createAiChatProviderFromEnv, createProviderRegistry, getAiGenerationProvider, providerSelectionFromEnv, } from './shared/providers/index.js';
import { setChatAiProvider } from './modules/chat/index.js';
import { setMarketCatalogDeps } from './modules/market-catalog/index.js';
import { db as productionDb } from './db/client.js';
import { createApiShutdown, createQueueConnection, createQueues, startQueueStatusEvents, type QueueStatusEvents, type Queues, type QuittableConnection, } from './shared/queue/index.js';
import { setRateLimitMetricsDb, setRateLimitMetricsLogger, } from './shared/middleware/rate-limit-metrics.js';
async function main(): Promise<void> {
    installSiteMongoWriteBarrier();
    installSiteQueueWriteBarrier();
    // Prototype wrappers compose inside-out. Installing account second keeps
    // the global acquisition order account → site for queue/Mongo boundaries.
    installAccountMongoWriteBarrier();
    installAccountQueueWriteBarrier();
    await validateAiProviderBaseUrls(env);
    // Postgres schema must be current before any request handler runs.
    await runMigrations();
    // Better Auth's encryption option is write-forward only. Upgrade legacy
    // OAuth bearer/refresh credentials and erase retained ID tokens before the
    // HTTP listener can observe a row. The result contains counts only.
    const oauthTokenBackfill = await backfillStoredOAuthTokens(productionDb);
    logger.info({ oauthTokenBackfill }, 'oauth token at-rest backfill complete');
    const aiGenerationProvider = guardAccountLifecycleCalls(guardSiteLifecycleCalls(getAiGenerationProvider()));
    setRanksDb(productionDb);
    setKeywordResearchDb(productionDb);
    setBacklinksDb(productionDb);
    setCompetitorsDb(productionDb);
    setCompetitorLandscapeDb(productionDb);
    setAiVisibilityDb(productionDb);
    setLocalSeoDb(productionDb);
    setBrandRadarDb(productionDb);
    setSummaryDb(productionDb);
    setSitesDb(productionDb);
    setApiKeysDb(productionDb);
    setTeamDb(productionDb);
    setReportExportsDb(productionDb);
    setReportExportAdapterRegistry(createCoreReportExportAdapterRegistry(productionDb));
    setRateLimitMetricsDb(productionDb);
    setRateLimitMetricsLogger(logger);
    setInternalLinksDb(productionDb);
    setKeywordClustersDb(productionDb);
    setContentBriefDb(productionDb);
    setGeogridDb(productionDb);
    // AI Assistant chat: the configured streaming provider (fake or ai-sdk,
    // same adapters as generation).
    const chatAiProvider = createAiChatProviderFromEnv(env, { db: productionDb });
    setChatAiProvider({
        streamChat: guardAccountLifecycleStream(guardSiteLifecycleStream(chatAiProvider.streamChat.bind(chatAiProvider))),
    });
    // Shared registry options — built once so EVERY createProviderRegistry call
    // carries the same credentials. createProviderRegistry eagerly instantiates
    // every capability (selectImpl runs the real factory immediately when the
    // PROVIDER_* value is not `fake`), so a registry built without `dataForSeo`
    // throws the moment any capability is `dataforseo` — even when the caller
    // only wants `.gsc`. Reusing one options object keeps the GSC wiring below
    // from re-triggering that guard.
    const registryOptions = {
        logger,
        serpDepth: env.SERP_DEPTH,
        serpLiveDepth: env.SERP_LIVE_DEPTH,
        serpTaskPollIntervalMs: env.SERP_TASK_POLL_INTERVAL_MS,
        serpTaskMaxPollAttempts: env.SERP_TASK_MAX_POLL_ATTEMPTS,
        ...(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD
            ? {
                dataForSeo: {
                    login: env.DATAFORSEO_LOGIN,
                    password: env.DATAFORSEO_PASSWORD,
                    baseUrl: env.DATAFORSEO_BASE_URL,
                },
            }
            : {}),
        ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
            ? {
                googleOAuth: {
                    clientId: env.GOOGLE_CLIENT_ID,
                    clientSecret: env.GOOGLE_CLIENT_SECRET,
                },
            }
            : {}),
        ...(env.GOOGLE_API_KEY ? { google: { apiKey: env.GOOGLE_API_KEY } } : {}),
        anthropic: {
            enabled: env.AI_SUMMARY_ENABLED,
            ...(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}),
            model: env.AI_SUMMARY_MODEL,
            ...(env.ANTHROPIC_INPUT_COST_MICROS_PER_MILLION !== undefined
                ? { inputCostMicrosPerMillion: env.ANTHROPIC_INPUT_COST_MICROS_PER_MILLION }
                : {}),
            ...(env.ANTHROPIC_OUTPUT_COST_MICROS_PER_MILLION !== undefined
                ? { outputCostMicrosPerMillion: env.ANTHROPIC_OUTPUT_COST_MICROS_PER_MILLION }
                : {}),
            totalTimeoutMs: env.AI_TOTAL_TIMEOUT_MS,
            telemetryEnabled: env.AI_TELEMETRY_ENABLED,
        },
        aiGeneration: {
            ordered: aiGenerationProvider,
            providerOrder: env.AI_PROVIDER_ORDER,
            recordRun: createAiProfileRunRecorder(productionDb),
        },
        ...(env.FIRECRAWL_API_KEY && env.FIRECRAWL_BASE_URL
            ? {
                firecrawl: {
                    apiKey: env.FIRECRAWL_API_KEY,
                    fallbackApiKeys: env.FIRECRAWL_FALLBACK_API_KEYS,
                    baseUrl: env.FIRECRAWL_BASE_URL,
                    timeoutMs: env.FIRECRAWL_TIMEOUT_MS,
                    maxPageCharacters: env.FIRECRAWL_MAX_PAGE_CHARS,
                    maxCrawlPages: env.FIRECRAWL_MAX_CRAWL_PAGES,
                    costMicrosPerCredit: env.FIRECRAWL_COST_MICROS_PER_CREDIT,
                    zdrEnabled: env.FIRECRAWL_ZDR_ENABLED,
                },
            }
            : {}),
    };
    // Provider registry — built ONCE at boot and reused
    // for every capability. Registry throws loudly if a PROVIDER_* value points
    // at an adapter whose credentials are absent.
    const registry = guardAccountLifecycleCalls(guardSiteLifecycleCalls(createProviderRegistry(providerSelectionFromEnv(env), registryOptions)));
    setKeywordProvider(registry.keyword);
    setKeywordDiscoveryContentSourceProvider(registry.contentSource);
    setAppSeoResearchProvider(registry.appData);
    setMarketCatalogDeps({
        db: productionDb,
        keywordProvider: registry.keyword,
        contentAnalysisProvider: registry.contentAnalysis,
        appDataProvider: registry.appData,
    });
    // Keyword gap reads the CompetitorProvider via its own holder
    // so `modules/keyword-research` never imports from `modules/competitors`.
    setKeywordResearchCompetitorProvider(registry.competitor);
    // Keyword Trends live-explore surface reads the TrendsProvider
    // via the keyword-research holder (never imports the concrete adapter).
    setKeywordResearchTrendsProvider(registry.trends);
    // Clustering pipeline calls the shared AI generation runtime
    // through a bounded profile. Provider order mirrors the shipped
    // AI_PROVIDER_ORDER (falling back to `fake` when PROVIDER_AI=fake).
    setKeywordResearchAiRunner(createAiProfileRunner({
        provider: aiGenerationProvider,
        recordRun: createAiProfileRunRecorder(productionDb),
    }), env.PROVIDER_AI === 'ai-sdk' ? env.AI_PROVIDER_ORDER : ['fake']);
    // The schema markup generator runs ONE bounded AI pass inline
    // on the request path. Wired unconditionally so a keyless stack gets the
    // deterministic `fake` order rather than an unconfigured-holder 500.
    setSchemaGeneratorAiRunner(createAiProfileRunner({
        provider: aiGenerationProvider,
        recordRun: createAiProfileRunRecorder(productionDb),
    }), env.PROVIDER_AI === 'ai-sdk' ? env.AI_PROVIDER_ORDER : ['fake']);
    setContentBriefAi(createAiProfileRunner({
        provider: aiGenerationProvider,
        recordRun: createAiProfileRunRecorder(productionDb),
    }), env.PROVIDER_AI === 'ai-sdk' ? env.AI_PROVIDER_ORDER : ['fake']);
    setBacklinkProvider(registry.backlink);
    setCompetitorProvider(registry.competitor);
    setAiVisibilityProvider(registry.aiVisibility);
    setLocalSeoProvider(registry.localListings);
    setLocalSeoRankProvider(registry.rank);
    setSummaryProvider(registry.summary);
    setAiVisibilitySummaryProvider(registry.summary);
    // Public-page change monitoring — the api resolves the concrete
    // ContentMonitorProvider per request for the monitor CRUD + webhook surface.
    // Keep the adapter wired even while creation/reconciliation is kill-switched:
    // site/account deletion must still tear down already-billable remote monitors.
    // Product routes and workers enforce CONTENT_MONITORING_ENABLED themselves.
    setContentMonitorProvider(registry.contentMonitor);
    // Wire the GSC + GA4 providers into the process-local holders so the
    // Site-scoped Google endpoints can serve requests — unconditionally, matching
    // the worker (worker.ts wires both without a credential guard). Credential
    // safety lives in the registry: a LIVE `PROVIDER_GSC=google` /
    // `PROVIDER_GA4=google` selection without the Google OAuth client fails
    // registry construction loudly above (`requireGoogleOAuth`), so reaching
    // this line means the selected adapters (fake or live) are fully
    // configured. The previous `GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET`
    // guard skipped wiring the FAKE providers on a keyless stack, turning
    // every Site-scoped Google read into the holder-gate 500.
    setGoogleGscProvider(registry.gsc);
    setGoogleGa4Provider(registry.ga4);
    // Mongo must be ready before request handling and before the bootstrap seed
    // can dual-write its user mirror. The seed itself remains fire-and-forget:
    // listen never waits for signup/promotion and a seed failure never crashes
    // the api process.
    await connectDb();
    const app = createApp();
    void seedSuperadmin(productionDb).catch((err) => {
        logger.error({ err }, 'superadmin seed failed');
    });
    const server = app.listen(env.PORT, () => {
        logger.info({ port: env.PORT, env: env.NODE_ENV }, 'server up');
    });
    // Job layer: api-side QueueEvents consumers keep AuditRun
    // status current on completed/failed. Optional — the api boots without
    // Redis (queueing is then disabled until REDIS_URL is configured).
    let queueEvents: QueueStatusEvents | null = null;
    let apiQueues: Queues | null = null;
    const producerConnections: QuittableConnection[] = [];
    if (env.REDIS_URL) {
        const redisUrl = env.REDIS_URL;
        queueEvents = startQueueStatusEvents({
            createConnection: () => createQueueConnection(redisUrl),
            logger,
            onAuditCompleted: createAuditCompletedHandler({ logger }),
            onAuditFailed: createAuditFailedHandler({ logger }),
        });
        // The audits router enqueues via the shared holder. The
        // producer connection is separate from QueueEvents' — a dedicated
        // ioredis client is required by BullMQ v5.
        const enqueueConnection = createQueueConnection(redisUrl);
        producerConnections.push(enqueueConnection);
        apiQueues = createQueues(enqueueConnection);
        setSiteLifecycleQueues(apiQueues);
        setAuditsQueue(apiQueues.audits);
        setRanksQueue(apiQueues.ranks);
        setAppSeoTrackingQueue(apiQueues.appSeoTracking);
        setPulseQueue(apiQueues.weeklyPulse);
        setClientReportsQueue(apiQueues.clientReports);
        setAccountPurgeQueue(apiQueues.accountPurge);
        setGscSyncQueue(apiQueues.gscSync);
        setGa4SyncQueue(apiQueues.ga4Sync);
        setContentAnalysisQueue(apiQueues.contentAnalysis);
        setContentInventoryQueue(apiQueues.contentInventory);
        setInternalLinksQueue(apiQueues.internalLinks);
        setKeywordClustersQueue(apiQueues.keywordClusters);
        setContentBriefQueue(apiQueues.contentBrief);
        setGeogridQueue(apiQueues.geogrid);
        setContentIntelligenceDb(productionDb);
        setAudienceResearchQueue(apiQueues.audienceResearch);
        setAudienceResearchDb(productionDb);
        setCompetitorContentQueue(apiQueues.competitorContent);
        setCompetitorLandscapeQueue(apiQueues.competitorLandscapes);
        setCompetitorContentDb(productionDb);
        setContentMonitorQueue(env.CONTENT_MONITORING_ENABLED ? apiQueues.contentMonitor : null);
        setContentMonitorDb(productionDb);
        setBacklinkDeepQueue(apiQueues.backlinkDeep);
        setTrafficSnapshotsQueue(apiQueues.trafficSnapshots);
        setReviewSyncQueue(apiQueues.reviewSync);
        setBrandRadarQueue(apiQueues.brandRadar);
    }
    const shutdown = createApiShutdown({
        server,
        queueEvents,
        queues: apiQueues,
        connections: producerConnections,
        closeDatastores,
        logger,
        exit: (code) => process.exit(code),
        onQueuesClosed: () => {
            if (apiQueues) {
                setSiteLifecycleQueues(null);
                setAuditsQueue(null);
                setRanksQueue(null);
                setAppSeoTrackingQueue(null);
                setPulseQueue(null);
                setClientReportsQueue(null);
                setAccountPurgeQueue(null);
                setGscSyncQueue(null);
                setGa4SyncQueue(null);
                setContentAnalysisQueue(null);
                setContentInventoryQueue(null);
                setInternalLinksQueue(null);
                setInternalLinksDb(null);
                setKeywordClustersQueue(null);
                setKeywordClustersDb(null);
                setContentBriefQueue(null);
                setContentBriefDb(null);
                setGeogridQueue(null);
                setGeogridDb(null);
                setContentBriefAi(null);
                setContentIntelligenceDb(null);
                setAudienceResearchQueue(null);
                setAudienceResearchDb(null);
                setCompetitorContentQueue(null);
                setCompetitorLandscapeQueue(null);
                setCompetitorLandscapeDb(null);
                setCompetitorContentDb(null);
                setContentMonitorQueue(null);
                setContentMonitorDb(null);
                setBacklinkDeepQueue(null);
                setTrafficSnapshotsQueue(null);
                setReviewSyncQueue(null);
                setBrandRadarQueue(null);
                setBrandRadarDb(null);
                setMarketCatalogDeps(null);
            }
        },
    });
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
main().catch((err) => {
    logger.fatal({ err }, 'startup failed');
    process.exit(1);
});
/* c8 ignore stop */
