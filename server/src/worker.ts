/**
 * Worker deployable — second entrypoint in the same package.
 *
 * One codebase, two processes: `api` (server.ts) serves HTTP + enqueues;
 * this process consumes the `audits` / `ranks` queues and talks to vendors
 * exclusively through the provider registry. No browser, no
 * crawler, no HTTP surface beyond /healthz.
 *
 * Composition root only — every piece wired here (processors, dead-letter,
 * health, shutdown) lives in a tested module. Like server.ts, this file is
 * an integration seam excluded from unit coverage.
 */
/* c8 ignore start -- composition root / integration seam (like server.ts):
 * also listed in vitest.config.ts coverage.exclude, but the v8 report-side
 * exclude filter has proven unreliable on some runs, so the seam is marked
 * inline too. Every wired piece is a tested module. */
import { Queue, Worker, type Job } from 'bullmq';
import mongoose from 'mongoose';
import { eq, sql } from 'drizzle-orm';
import { connectDb } from './config/db.js';
import { env, validateAiProviderBaseUrls } from './config/env.js';
import { logger } from './config/logger.js';
import { db } from './db/client.js';
import { alertRules, scheduledReports } from './db/schema/index.js';
import { createAiProfileRunRecorder } from './db/ai-profile-run-events.js';
import { AI_USAGE_PRUNE_INTERVAL_MS, AI_USAGE_PRUNE_JOB, AI_USAGE_PRUNE_QUEUE, AI_USAGE_PRUNE_SCHEDULER_KEY, createAiUsagePruneProcessor, } from './db/ai-usage-events.js';
import { closeDatastores } from './db/shutdown.js';
import { AuditRun, createAuditProcessor, createAuditSummaryProcessor, onAuditJobExhausted, onAuditSummaryJobExhausted, } from './modules/audits/index.js';
import { REPORT_EXPORT_RETENTION_INTERVAL_MS, REPORT_EXPORT_RETENTION_JOB, REPORT_EXPORT_RETENTION_QUEUE, REPORT_EXPORT_RETENTION_SCHEDULER_KEY, createReportExportRetentionProcessor, } from './modules/report-exports/index.js';
import { alertSweepIntervalMs, ALERT_SWEEP_JOB, ALERT_SWEEP_QUEUE, ALERT_SWEEP_SCHEDULER_KEY, createAlertDispatchDeps, createAlertDispatchProcessor, createAlertSweepProcessor, reconcileAlertDeliveries, } from './modules/alerts/index.js';
import { GSC_DAILY_SYNC_CRON, GSC_DAILY_SYNC_SCHEDULER_KEY, GSC_DAILY_SYNC_SWEEP_JOB, createCollectGscInsights, createCollectIndexStatus, createGa4SyncProcessor, createGoogleSiteAutoMatchProcessor, createGscDailySyncProducer, createGscSyncQueueDispatcher, createGscSyncProcessor, createMongoGscDailySyncRepository, setGoogleGa4Provider, setGoogleGscProvider, } from './modules/google-connections/index.js';
import { readPreviousSnapshotTotals, upsertSearchAnalytics, upsertSitemaps, } from './modules/gsc-snapshots/index.js';
import { reconcileTeamInvitations, setTeamDb } from './modules/team/index.js';
import { upsertGa4Metrics } from './modules/ga4-snapshots/index.js';
import { createPostgresRankTargetsResolver, createRankDropConfirmationHandler, createRankDropEffects, createRankProcessor, createSerpCacheRepo, reconcileRankSchedules, refreshRankScheduleAfterPromotion, setRanksQueue, } from './modules/ranks/index.js';
import { createAppChartProcessor, createAppChartWeeklySweep, createAppKeywordProcessor, createAppKeywordWeeklySweep, createAppListingProcessor, createAppReviewProcessor, createAppSeoTrackingDispatcher, dispatchAppChartJob, onAppReviewJobExhausted, upsertAppChartSchedulers, upsertAppSeoTrackingSchedulers, } from './modules/app-seo/index.js';
import { setPulseQueue } from './modules/weekly-pulse/pulse.queue-holder.js';
import { createAccountPurgeProcessor, guardAccountLifecycleCalls, installAccountMongoWriteBarrier, installAccountQueueWriteBarrier, purgeAccount, startDeletionReconciler, } from './modules/legal/index.js';
import { CONTENT_ANALYSIS_RECON_INTERVAL_MS, CONTENT_ANALYSIS_RECON_JOB, CONTENT_ANALYSIS_RECON_QUEUE, CONTENT_ANALYSIS_RECON_SCHEDULER_KEY, CONTENT_OUTCOME_REFRESH_INTERVAL_MS, CONTENT_OUTCOME_REFRESH_JOB, CONTENT_OUTCOME_REFRESH_QUEUE, CONTENT_OUTCOME_REFRESH_SCHEDULER_KEY, createContentAnalysisProcessor, createContentAnalysisReconciliationProcessor, createContentInventoryProcessor, createContentOutcomeRefreshProcessor, } from './modules/content-intelligence/index.js';
import { AUDIENCE_RESEARCH_RECON_INTERVAL_MS, AUDIENCE_RESEARCH_RECON_JOB, AUDIENCE_RESEARCH_RECON_QUEUE, AUDIENCE_RESEARCH_RECON_SCHEDULER_KEY, createAudienceResearchProcessor, createAudienceResearchReconciliationProcessor, } from './modules/audience-research/index.js';
import { BrandRadarScan, BRAND_RADAR_RECON_INTERVAL_MS, BRAND_RADAR_RECON_JOB, BRAND_RADAR_RECON_QUEUE, BRAND_RADAR_RECON_SCHEDULER_KEY, createBrandRadarProcessor, createBrandRadarReconciliationProcessor, } from './modules/brand-radar/index.js';
import { createCompetitorContentProcessor } from './modules/competitor-content/index.js';
import { createInternalLinksProcessor, onInternalLinksJobExhausted, } from './modules/internal-links/index.js';
import { createKeywordClustersProcessor } from './modules/keyword-clusters/index.js';
import { createContentBriefProcessor, onContentBriefJobExhausted, } from './modules/content-briefs/index.js';
import { createGeogridProcessor, onGeogridJobExhausted, } from './modules/geogrid/index.js';
import { CONTENT_MONITOR_RECON_JOB, CONTENT_MONITOR_RECON_QUEUE, CONTENT_MONITOR_RECON_SCHEDULER_KEY, createContentMonitorProcessor, createContentMonitorReconciliationProcessor, shouldDeadLetterContentMonitorJob, } from './modules/content-monitoring/index.js';
import { createAiProfileRunner } from './shared/ai-profiles/index.js';
import { directSiteScope, guardSiteLifecycleCalls, installSiteMongoWriteBarrier, installSiteQueueWriteBarrier, setSiteLifecycleQueues, setSitesDb, withSiteWorkLease, type SiteWorkScope, } from './modules/sites/index.js';
import { createWeeklyPulseProcessor, createWeeklyPulseProductionPorts, reconcilePulseSchedulers, } from './modules/weekly-pulse/index.js';
import { createBacklinkDeepProcessor } from './modules/backlinks/index.js';
import { createClientReportProcessor, reconcileClientReportDeliveries, reconcileClientReportSchedulers, } from './modules/client-reports/index.js';
import { CompetitorLandscapeRun, TrafficSnapshotRun, createCompetitorLandscapeProcessor, createTrafficSnapshotProcessor, onCompetitorLandscapeJobExhausted, reconcileCompetitorLandscapeRuns, setCompetitorLandscapeDb, setCompetitorLandscapeQueue, } from './modules/competitors/index.js';
import { LocalSeoReviewSyncRun, createReviewSyncProcessor, } from './modules/local-seo/index.js';
import { createProviderRegistry, getAiGenerationProvider, providerSelectionFromEnv, } from './shared/providers/index.js';
import { DATAFORSEO_AUDIT_WORKER_CONCURRENCY_MAX } from "./shared/safety/pagespeed-defaults.js";
import { RATE_LIMIT_PRUNE_INTERVAL_MS, RATE_LIMIT_PRUNE_JOB, RATE_LIMIT_PRUNE_QUEUE, RATE_LIMIT_PRUNE_SCHEDULER_KEY, createRateLimitPruneProcessor, } from './shared/middleware/rate-limit-metrics.js';
import { createCachedPageSpeedProvider, createReadThrough, createSingleFlight, createVendorArchiver, createVendorCacheRepo, } from './shared/vendor-cache/index.js';
import { ACCOUNT_PURGE_QUEUE, APP_SEO_LISTING_JOB_NAME, APP_SEO_TRACKING_QUEUE, APP_SEO_REVIEW_JOB_NAME, BACKLINK_DEEP_QUEUE, ALERT_DISPATCH_QUEUE, BRAND_RADAR_QUEUE, AUDIENCE_RESEARCH_QUEUE, AUDIT_SUMMARY_JOB_NAME, AUDITS_QUEUE, COMPETITOR_CONTENT_QUEUE, COMPETITOR_LANDSCAPES_QUEUE, CONTENT_ANALYSIS_QUEUE, CONTENT_INVENTORY_QUEUE, CONTENT_BRIEF_QUEUE, GEOGRID_QUEUE, INTERNAL_LINKS_QUEUE, KEYWORD_CLUSTERING_QUEUE, CONTENT_MONITOR_QUEUE, CLIENT_REPORTS_QUEUE, GA4_SYNC_QUEUE, GSC_SYNC_QUEUE, RANKS_QUEUE, REVIEW_SYNC_QUEUE, TRAFFIC_SNAPSHOTS_QUEUE, WEEKLY_PULSE_QUEUE, collectQueueSnapshot, createQueueConnection, createQueues, createWorkerShutdown, enqueueGscSyncJob, startHealthServer, wireDeadLetter, } from './shared/queue/index.js';
import { reconcileSingletonScheduler, startSchedulerReconciler, withSingletonSchedulerRefresh, } from './scheduler-reconciliation.js';
function jobString(job: Job, field: string): string | null {
    const value = (job.data as Record<string, unknown> | null)?.[field];
    return typeof value === 'string' ? value : null;
}
async function resolveAuditSummarySite(job: Job): Promise<SiteWorkScope | null> {
    const accountId = jobString(job, 'accountId');
    const runId = jobString(job, 'runId');
    if (!accountId || !runId)
        return null;
    const run = await AuditRun.findOne({ _id: runId, accountId }, { accountId: 1, siteId: 1 }).lean();
    return run ? { accountId, siteId: String(run.siteId) } : null;
}
async function resolveTrafficSnapshotSite(job: Job): Promise<SiteWorkScope | null | undefined> {
    const accountId = jobString(job, 'accountId');
    const runId = jobString(job, 'runId');
    if (!accountId || !runId)
        return null;
    const run = await TrafficSnapshotRun.findOne({ _id: runId, accountId }, { accountId: 1, siteId: 1 }).lean();
    if (!run)
        return null;
    return run.siteId ? { accountId, siteId: String(run.siteId) } : undefined;
}
async function resolveCompetitorLandscapeSite(job: Job): Promise<SiteWorkScope | null> {
    const runId = jobString(job, 'runId');
    if (!runId)
        return null;
    const run = await CompetitorLandscapeRun.findById(runId, { accountId: 1, siteId: 1 }).lean();
    return run
        ? { accountId: String(run.accountId), siteId: String(run.siteId) }
        : null;
}
async function resolveReviewSyncSite(job: Job): Promise<SiteWorkScope | null> {
    const accountId = jobString(job, 'accountId');
    const runId = jobString(job, 'runId');
    if (!accountId || !runId)
        return null;
    const run = await LocalSeoReviewSyncRun.findOne({ _id: runId, accountId }, { accountId: 1, profileId: 1 }).lean();
    return run ? { accountId, siteId: String(run.profileId) } : null;
}
async function resolveBrandRadarSite(job: Job): Promise<SiteWorkScope | null | undefined> {
    const accountId = jobString(job, 'accountId');
    const scanId = jobString(job, 'scanId');
    if (!accountId || !scanId)
        return null;
    const scan = await BrandRadarScan.findOne({ _id: scanId, accountId }, { accountId: 1, siteId: 1 }).lean();
    if (!scan)
        return null;
    return scan.siteId ? { accountId, siteId: String(scan.siteId) } : undefined;
}
async function resolveClientReportSite(job: Job): Promise<SiteWorkScope | null> {
    const scheduleId = jobString(job, 'scheduleId');
    if (!scheduleId)
        return null;
    const rows = await db
        .select({ accountId: scheduledReports.accountId, siteId: scheduledReports.siteId })
        .from(scheduledReports)
        .where(eq(scheduledReports.id, scheduleId))
        .limit(1);
    const row = rows[0];
    return row ? { accountId: row.accountId, siteId: row.siteId } : null;
}
async function resolveAlertSite(job: Job): Promise<SiteWorkScope | null> {
    const accountId = jobString(job, 'accountId');
    const ruleId = jobString(job, 'ruleId');
    if (!accountId || !ruleId)
        return null;
    const rows = await db
        .select({ accountId: alertRules.accountId, siteId: alertRules.siteId })
        .from(alertRules)
        .where(eq(alertRules.id, ruleId))
        .limit(1);
    const row = rows[0];
    return row?.accountId === accountId
        ? { accountId: row.accountId, siteId: row.siteId }
        : null;
}
async function main(): Promise<void> {
    await validateAiProviderBaseUrls(env);
    const aiGenerationProvider = guardAccountLifecycleCalls(guardSiteLifecycleCalls(getAiGenerationProvider()));
    if (!env.REDIS_URL) {
        throw new Error('REDIS_URL is required for the worker deployable');
    }
    // Mongo up-front (domain records). Postgres (postgres-js) is lazy — the
    // api owns migrations at ITS boot; the worker only reads/writes.
    await connectDb();
    installSiteMongoWriteBarrier();
    installSiteQueueWriteBarrier();
    installAccountMongoWriteBarrier();
    installAccountQueueWriteBarrier();
    const providers = guardAccountLifecycleCalls(guardSiteLifecycleCalls(createProviderRegistry(providerSelectionFromEnv(env), {
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
        ...(env.GOOGLE_API_KEY ? { google: { apiKey: env.GOOGLE_API_KEY } } : {}),
        ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
            ? {
                googleOAuth: {
                    clientId: env.GOOGLE_CLIENT_ID,
                    clientSecret: env.GOOGLE_CLIENT_SECRET,
                },
            }
            : {}),
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
            recordRun: createAiProfileRunRecorder(db),
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
    })));
    const connection = createQueueConnection(env.REDIS_URL);
    const queues = createQueues(connection);
    const singletonPromotionRefreshers = new Map<string, (job: Job) => Promise<void>>();
    let markSingletonPromotionRefreshersReady!: () => void;
    const singletonPromotionRefreshersReady = new Promise<void>((resolve) => {
        markSingletonPromotionRefreshersReady = resolve;
    });
    const withRegisteredSingletonRefresh = <T>(key: string, processor: (job: Job) => Promise<T>) => async (job: Job): Promise<T> => {
        // Workers are constructed before the scheduler catalog below. A Redis
        // tick already waiting at process start must not slip through that boot
        // window and defer cadence-drift repair until its next (possibly daily)
        // run.
        await singletonPromotionRefreshersReady;
        const refresh = singletonPromotionRefreshers.get(key);
        if (!refresh) {
            throw new Error(`singleton scheduler refresher is not registered: ${key}`);
        }
        await refresh(job);
        return processor(job);
    };
    setSitesDb(db);
    setTeamDb(db);
    setSiteLifecycleQueues(queues);
    setRanksQueue(queues.ranks);
    setPulseQueue(queues.weeklyPulse);
    // Process-local landscape holders let API/reconciliation/lifecycle code
    // share the dedicated queue and relational database handles.
    setCompetitorLandscapeDb(db);
    setCompetitorLandscapeQueue(queues.competitorLandscapes);
    // Wire the GSC + GA4 providers into the process-local holders so the
    // google-connections service can decrypt refresh tokens + refresh access
    // tokens on demand. The audit-processor callback below reuses this same
    // provider through createCollectIndexStatus.
    setGoogleGscProvider(providers.gsc);
    setGoogleGa4Provider(providers.ga4);
    // Save-everything: append-only archiver over vendor_responses. Shared by
    // the audit processor (crawl results) and the GSC collector (inspections)
    // — both per-account private capabilities, never served cross-user.
    const archiveVendorResponse = createVendorArchiver(createVendorCacheRepo(db));
    const collectIndexStatus = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? createCollectIndexStatus(providers.gsc, logger, archiveVendorResponse)
        : undefined;
    // GSC Search Analytics + Sitemaps collector. Persistence goes
    // through the gsc-snapshots module's public API — daily replace-on-conflict
    // snapshots in Postgres that the ?tab=google summary route reads back.
    const collectGscInsights = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? createCollectGscInsights(providers.gsc, {
            logger,
            archive: archiveVendorResponse,
            persist: {
                upsertSearchAnalytics: (input) => upsertSearchAnalytics(db, input),
                upsertSitemaps: (input) => upsertSitemaps(db, input),
                readPreviousTotals: async (siteId, beforeDate) => {
                    const totals = await readPreviousSnapshotTotals(db, siteId, 'query', beforeDate);
                    return totals
                        ? { clicks: totals.clicks, impressions: totals.impressions }
                        : null;
                },
            },
        })
        : undefined;
    // Cross-user PageSpeed cache: provider + adapter version are part of the
    // key, so switching away from fake/Google can never replay their payloads.
    // Fresh results land in the vendor_responses archive.
    const cachedPageSpeed = createCachedPageSpeedProvider({
        inner: providers.pagespeed,
        readThrough: createReadThrough({
            repo: createVendorCacheRepo(db),
            singleFlight: createSingleFlight(),
            logger,
        }),
        cacheNamespace: env.PROVIDER_PAGESPEED === 'dataforseo'
            ? 'dataforseo-lighthouse-live:v1'
            : env.PROVIDER_PAGESPEED === 'google'
                ? 'google-psi-crux:v1'
                : 'fake:v1',
        ttlMs: env.PAGESPEED_CACHE_TTL_HOURS * 60 * 60 * 1000,
    });
    const processAudit = createAuditProcessor({
        provider: providers.audit,
        pageSpeedProvider: cachedPageSpeed,
        pageSpeedSampleSize: env.PAGESPEED_SAMPLE_SIZE,
        gscInspectSampleSize: env.GSC_INSPECT_SAMPLE,
        ...(collectIndexStatus ? { collectIndexStatus } : {}),
        ...(collectGscInsights ? { collectGscInsights } : {}),
        archiveVendorResponse,
        logger,
    });
    const processAuditSummary = createAuditSummaryProcessor({
        provider: providers.summary,
        archiveVendorResponse,
        logger,
    });
    const processLeasedAudit = withSiteWorkLease(processAudit);
    const processLeasedAuditSummary = withSiteWorkLease(processAuditSummary, resolveAuditSummarySite);
    const auditWorker = new Worker(AUDITS_QUEUE, (job) => job.name === AUDIT_SUMMARY_JOB_NAME
        ? processLeasedAuditSummary(job)
        : processLeasedAudit(job), {
        connection,
        concurrency: env.PROVIDER_PAGESPEED === 'dataforseo'
            ? Math.min(env.WORKER_CONCURRENCY, DATAFORSEO_AUDIT_WORKER_CONCURRENCY_MAX)
            : env.WORKER_CONCURRENCY,
    });
    const processRank = createRankProcessor({
        provider: providers.rank,
        db,
        cache: createSerpCacheRepo({ db, ttlHours: env.SERP_CACHE_TTL_HOURS }),
        resolveTargets: createPostgresRankTargetsResolver(db),
        cacheTtlMs: env.SERP_CACHE_TTL_HOURS * 60 * 60 * 1000,
        // A freshly inserted candidate must survive a separate provider
        // observation before either the legacy courtesy email/audit rerun or the
        // rule-based alert sweep can see a confirmed transition.
        confirmRankDrop: createRankDropConfirmationHandler({
            db,
            provider: providers.rank,
            effects: createRankDropEffects({
                auditsQueue: queues.audits,
                logger,
            }),
            logger,
        }),
        // Local-pack maps calls bypass the serp cache — archive their spend.
        archive: archiveVendorResponse,
        logger,
    });
    const rankWorker = new Worker(RANKS_QUEUE, withSiteWorkLease(async (job) => {
        // BullMQ has already promoted this iteration to active and generated
        // the next delayed one before invoking the processor. Refreshing here
        // preserves this accepted payload while applying the current producer
        // flag to future iterations. Failure must never discard accepted work.
        try {
            await refreshRankScheduleAfterPromotion(db, queues.ranks, job.data, env.ALT_ENGINE_TRACKING_ENABLED);
        }
        catch (error) {
            logger.warn({ err: error, jobId: job.id }, 'rank scheduler future-template refresh failed; accepted job continues');
        }
        return processRank(job);
    }), { connection, concurrency: env.WORKER_CONCURRENCY });
    const appKeywordSweepDeps = {
        db,
        queue: queues.appSeoTracking,
        logger,
        enabled: () => env.APP_SEO_ENABLED && env.APP_KEYWORD_TRACKING_ENABLED,
    };
    const processAppKeyword = createAppKeywordProcessor({
        db,
        provider: providers.appData,
        logger,
        archive: archiveVendorResponse,
    });
    const appChartSweepDeps = {
        queue: queues.appSeoTracking,
        logger,
        enabled: () => env.APP_SEO_ENABLED && env.APP_CHART_TRACKING_ENABLED,
    };
    const processAppChart = createAppChartProcessor({
        db,
        provider: providers.appData,
        archive: archiveVendorResponse,
    });
    const processAppListing = createAppListingProcessor({
        db,
        provider: providers.appData,
        archive: archiveVendorResponse,
    });
    const appReviewAiRunner = createAiProfileRunner({
        provider: aiGenerationProvider,
        recordRun: createAiProfileRunRecorder(db),
    });
    const processAppReview = createAppReviewProcessor({
        provider: providers.appData,
        ai: appReviewAiRunner,
        aiProviderOrder: env.PROVIDER_AI === 'ai-sdk' ? env.AI_PROVIDER_ORDER : (['fake'] as const),
    });
    const processAppKeywordDispatch = createAppSeoTrackingDispatcher({
        processKeyword: processAppKeyword,
        weeklySweep: createAppKeywordWeeklySweep(appKeywordSweepDeps),
    });
    const appSeoTrackingWorker = new Worker(APP_SEO_TRACKING_QUEUE, (job) => job.name === APP_SEO_LISTING_JOB_NAME
        ? processAppListing(job)
        : job.name === APP_SEO_REVIEW_JOB_NAME
            ? processAppReview(job)
            : dispatchAppChartJob({
                job,
                processChart: processAppChart,
                weeklySweep: createAppChartWeeklySweep(appChartSweepDeps),
            }) ?? processAppKeywordDispatch(job), { connection, concurrency: env.WORKER_CONCURRENCY });
    await upsertAppSeoTrackingSchedulers(queues.appSeoTracking);
    await upsertAppChartSchedulers(queues.appSeoTracking);
    const accountPurgeWorker = new Worker(ACCOUNT_PURGE_QUEUE, createAccountPurgeProcessor({ db, logger, queues, gscProvider: providers.gsc }), { connection, concurrency: 1 });
    const deletionReconciler = startDeletionReconciler({
        logger,
        purgeAccount: (userId) => purgeAccount(userId, { db, logger, queues, gscProvider: providers.gsc }),
    });
    // Shared deterministic profile runner for every worker-side AI stage.
    // Toxic-link rationale is bundled into its one review run.
    const aiProfileRunner = createAiProfileRunner({
        provider: aiGenerationProvider,
        recordRun: createAiProfileRunRecorder(db),
    });
    const aiProfileProviderOrder = env.PROVIDER_AI === 'ai-sdk' ? env.AI_PROVIDER_ORDER : (['fake'] as const);
    const backlinkDeepWorker = new Worker(BACKLINK_DEEP_QUEUE, withSiteWorkLease(createBacklinkDeepProcessor({
        db,
        provider: providers.backlink,
        ai: aiProfileRunner,
        aiProviderOrder: aiProfileProviderOrder,
    })), { connection, concurrency: env.WORKER_CONCURRENCY });
    const trafficSnapshotsWorker = new Worker(TRAFFIC_SNAPSHOTS_QUEUE, withSiteWorkLease(createTrafficSnapshotProcessor({
        db,
        provider: providers.competitor,
    }), resolveTrafficSnapshotSite), { connection, concurrency: env.WORKER_CONCURRENCY });
    const competitorLandscapeWorker = new Worker(COMPETITOR_LANDSCAPES_QUEUE, withSiteWorkLease(createCompetitorLandscapeProcessor({
        db,
        provider: providers.competitor,
        logger,
    }), resolveCompetitorLandscapeSite), { connection, concurrency: Math.min(env.WORKER_CONCURRENCY, 5) });
    // One AI profile runner + provider order shared by the content-analysis
    // (brief/draft), audience-research (clustering), and review-intelligence
    // (theme pass) consumers, falling back to the fake order when
    // PROVIDER_AI=fake at boot.
    // Review Intelligence — fans out to at most three review
    // sources per run, settles the run exactly once, then runs the bundled
    // `review_themes` pass inside that same run. A replay after settlement is a no-op for the vendor fan-out.
    const reviewSyncWorker = new Worker(REVIEW_SYNC_QUEUE, withSiteWorkLease(createReviewSyncProcessor({
        db,
        provider: providers.reviews,
        ai: aiProfileRunner,
        aiProviderOrder: aiProfileProviderOrder,
    }), resolveReviewSyncSite), { connection, concurrency: env.WORKER_CONCURRENCY });
    // Content-analysis pipeline consumer (owned scrape → SERP →
    // competitors → deterministic scorecard → AI brief + first draft).
    const contentAnalysisWorker = new Worker(CONTENT_ANALYSIS_QUEUE, withSiteWorkLease(createContentAnalysisProcessor({
        db,
        contentSource: providers.contentSource,
        keyword: providers.keyword,
        rank: providers.rank,
        ai: aiProfileRunner,
        aiProviderOrder: aiProfileProviderOrder,
        logger,
    })), { connection, concurrency: env.WORKER_CONCURRENCY });
    const contentAnalysisReconQueue = new Queue(CONTENT_ANALYSIS_RECON_QUEUE, { connection });
    const contentAnalysisReconWorker = new Worker(CONTENT_ANALYSIS_RECON_QUEUE, withRegisteredSingletonRefresh(CONTENT_ANALYSIS_RECON_SCHEDULER_KEY, createContentAnalysisReconciliationProcessor({
        db,
        logger,
        queue: queues.contentAnalysis,
    })), { connection, concurrency: 1 });
    // Content inventory + cannibalization consumer (bounded crawl →
    // incremental page persistence → deterministic analysis → optional AI
    // explanation → whole-block refund on legitimate terminal stop).
    const contentInventoryWorker = new Worker(CONTENT_INVENTORY_QUEUE, withSiteWorkLease(createContentInventoryProcessor({
        db,
        contentSource: providers.contentSource,
        ai: aiProfileRunner,
        aiProviderOrder: aiProfileProviderOrder,
        logger,
    })), { connection, concurrency: env.WORKER_CONCURRENCY });
    // Consumers stay subscribed while a flag is off. Producers own the kill
    // switch; jobs accepted before a rollback must still reach a terminal state.
    const internalLinksWorker = new Worker(INTERNAL_LINKS_QUEUE, withSiteWorkLease(createInternalLinksProcessor({
        db,
        ai: aiProfileRunner,
        aiProviderOrder: aiProfileProviderOrder,
        logger,
    })), { connection, concurrency: env.WORKER_CONCURRENCY });
    // Deterministic SERP-overlap grouping over stored observations
    // plus one optional bounded labelling pass.
    const keywordClustersWorker = new Worker(KEYWORD_CLUSTERING_QUEUE, withSiteWorkLease(createKeywordClustersProcessor({
        db,
        ai: aiProfileRunner,
        aiProviderOrder: aiProfileProviderOrder,
        logger,
    })), { connection, concurrency: env.WORKER_CONCURRENCY });
    const contentBriefWorker = new Worker(CONTENT_BRIEF_QUEUE, withSiteWorkLease(createContentBriefProcessor({
        db,
        rank: providers.rank,
        contentSource: providers.contentSource,
        ai: aiProfileRunner,
        aiProviderOrder: aiProfileProviderOrder,
        logger,
    })), { connection, concurrency: env.WORKER_CONCURRENCY });
    const geogridWorker = new Worker(GEOGRID_QUEUE, withSiteWorkLease(createGeogridProcessor({ db, rank: providers.rank, logger })), { connection, concurrency: env.WORKER_CONCURRENCY });
    // Competitor content intelligence consumer (bounded owned +
    // competitor scrapes → incremental page persistence → deterministic deltas /
    // opportunities → optional n-gram-guarded AI explanation → single-unit refund
    // on a legitimate no-output terminal stop).
    const competitorContentWorker = new Worker(COMPETITOR_CONTENT_QUEUE, withSiteWorkLease(createCompetitorContentProcessor({
        db,
        contentSource: providers.contentSource,
        ai: aiProfileRunner,
        aiProviderOrder: aiProfileProviderOrder,
        logger,
    })), { connection, concurrency: env.WORKER_CONCURRENCY });
    // Public-page change monitoring consumer. Processes one verified,
    // deduped webhook delivery: ordered events → idempotent monitor-state update →
    // notify on a MATERIAL change only. No vendor spend here (the weekly check is
    // scheduled by the reconciliation sweep below).
    const contentMonitorWorker = new Worker(CONTENT_MONITOR_QUEUE, withSiteWorkLease(createContentMonitorProcessor({ db, logger })), { connection, concurrency: env.WORKER_CONCURRENCY });
    const contentMonitorReconQueue = new Queue(CONTENT_MONITOR_RECON_QUEUE, { connection });
    const contentMonitorReconWorker = new Worker(CONTENT_MONITOR_RECON_QUEUE, withRegisteredSingletonRefresh(CONTENT_MONITOR_RECON_SCHEDULER_KEY, createContentMonitorReconciliationProcessor({
        db,
        logger,
        queue: queues.contentMonitor,
        provider: providers.contentMonitor,
    })), { connection, concurrency: 1 });
    // Audience-research pipeline consumer.
    const audienceResearchWorker = new Worker(AUDIENCE_RESEARCH_QUEUE, withSiteWorkLease(createAudienceResearchProcessor({
        rankProvider: providers.rank,
        contentSource: providers.contentSource,
        aiRunner: aiProfileRunner,
        aiProviderOrder: aiProfileProviderOrder,
        logger,
    })), { connection, concurrency: env.WORKER_CONCURRENCY });
    const audienceResearchReconQueue = new Queue(AUDIENCE_RESEARCH_RECON_QUEUE, { connection });
    const audienceResearchReconWorker = new Worker(AUDIENCE_RESEARCH_RECON_QUEUE, withRegisteredSingletonRefresh(AUDIENCE_RESEARCH_RECON_SCHEDULER_KEY, createAudienceResearchReconciliationProcessor({
        logger,
        queue: queues.audienceResearch,
    })), { connection, concurrency: 1 });
    // Producers and the recurring scheduler own the kill switch.
    // Consumers stay live so accepted work converges after a process restart.
    const brandRadarWorker = new Worker(BRAND_RADAR_QUEUE, withSiteWorkLease(createBrandRadarProcessor({
        db,
        provider: providers.contentAnalysis,
        logger,
        // Stage 3 — the bundled `brand_digest` pass rides inside the
        // same scan and never adds a second one.
        ai: aiProfileRunner,
        aiProviderOrder: aiProfileProviderOrder,
    }), resolveBrandRadarSite), { connection, concurrency: env.WORKER_CONCURRENCY });
    const brandRadarReconQueue = new Queue(BRAND_RADAR_RECON_QUEUE, { connection });
    const brandRadarReconWorker = new Worker(BRAND_RADAR_RECON_QUEUE, withRegisteredSingletonRefresh(BRAND_RADAR_RECON_SCHEDULER_KEY, createBrandRadarReconciliationProcessor({
        db,
        logger,
        queue: queues.brandRadar,
    })), { connection, concurrency: 1 });
    const contentOutcomeQueue = new Queue(CONTENT_OUTCOME_REFRESH_QUEUE, { connection });
    const contentOutcomeWorker = new Worker(CONTENT_OUTCOME_REFRESH_QUEUE, withRegisteredSingletonRefresh(CONTENT_OUTCOME_REFRESH_SCHEDULER_KEY, createContentOutcomeRefreshProcessor(db)), { connection, concurrency: 1 });
    wireDeadLetter(auditWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: AUDITS_QUEUE,
        logger,
        onExhausted: (job, err) => job.name === AUDIT_SUMMARY_JOB_NAME
            ? onAuditSummaryJobExhausted(job, err)
            : onAuditJobExhausted(job, err),
    });
    wireDeadLetter(contentAnalysisWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: CONTENT_ANALYSIS_QUEUE,
        logger,
    });
    wireDeadLetter(contentInventoryWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: CONTENT_INVENTORY_QUEUE,
        logger,
    });
    wireDeadLetter(internalLinksWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: INTERNAL_LINKS_QUEUE,
        logger,
        onExhausted: (job) => onInternalLinksJobExhausted(job),
    });
    wireDeadLetter(keywordClustersWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: KEYWORD_CLUSTERING_QUEUE,
        logger,
    });
    wireDeadLetter(contentBriefWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: CONTENT_BRIEF_QUEUE,
        logger,
        onExhausted: (job) => onContentBriefJobExhausted(job),
    });
    wireDeadLetter(geogridWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: GEOGRID_QUEUE,
        logger,
        onExhausted: (job) => onGeogridJobExhausted(job, { db }),
    });
    wireDeadLetter(competitorContentWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: COMPETITOR_CONTENT_QUEUE,
        logger,
    });
    wireDeadLetter(contentMonitorWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: CONTENT_MONITOR_QUEUE,
        logger,
        shouldDeadLetter: (job) => shouldDeadLetterContentMonitorJob(job),
        deadLetterJobId: (job) => {
            const receiptId = job.data &&
                typeof job.data === 'object' &&
                'receiptId' in job.data &&
                typeof job.data.receiptId === 'string'
                ? job.data.receiptId
                : null;
            return `content-monitor-terminal-${receiptId ?? job.id ?? 'malformed'}`;
        },
    });
    wireDeadLetter(audienceResearchWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: AUDIENCE_RESEARCH_QUEUE,
        logger,
    });
    // Alerts — durable consumers with a
    // flag-gated recurring producer.
    //
    //   • `alert-dispatch` fans one confirmed transition out to every configured
    //     channel. Each leg claims its own `alert_deliveries` row on a UNIQUE
    //     idempotency key, so a retry re-sends ONLY the legs that had not
    //     settled; attempt 3 writes the terminal suppressed row and throws into
    //     the dead-letter queue rather than looping forever.
    //   • `alert-detection-sweep` is a read-only scheduler tick over settled
    //     `rank_drop_confirmations`. It never writes that table and is safe to
    //     re-run.
    //
    const alertDispatchWorker = new Worker(ALERT_DISPATCH_QUEUE, withSiteWorkLease(createAlertDispatchProcessor(createAlertDispatchDeps({ db, logger })), resolveAlertSite), { connection, concurrency: env.WORKER_CONCURRENCY });
    const alertSweepQueue = new Queue(ALERT_SWEEP_QUEUE, { connection });
    const alertSweepWorker = new Worker(ALERT_SWEEP_QUEUE, withRegisteredSingletonRefresh(ALERT_SWEEP_SCHEDULER_KEY, createAlertSweepProcessor({
        db,
        queue: queues.alertDispatch,
        logger,
    })), { connection, concurrency: 1 });
    wireDeadLetter(alertDispatchWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: ALERT_DISPATCH_QUEUE,
        logger,
    });
    wireDeadLetter(rankWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: RANKS_QUEUE,
        logger,
    });
    wireDeadLetter(appSeoTrackingWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: APP_SEO_TRACKING_QUEUE,
        logger,
        onExhausted: (job) => onAppReviewJobExhausted(job),
    });
    wireDeadLetter(accountPurgeWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: ACCOUNT_PURGE_QUEUE,
        logger,
    });
    wireDeadLetter(backlinkDeepWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: BACKLINK_DEEP_QUEUE,
        logger,
    });
    wireDeadLetter(trafficSnapshotsWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: TRAFFIC_SNAPSHOTS_QUEUE,
        logger,
    });
    wireDeadLetter(competitorLandscapeWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: COMPETITOR_LANDSCAPES_QUEUE,
        logger,
        onExhausted: (job) => onCompetitorLandscapeJobExhausted(job, {
            db,
            provider: providers.competitor,
            logger,
        }),
    });
    wireDeadLetter(reviewSyncWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: REVIEW_SYNC_QUEUE,
        logger,
    });
    wireDeadLetter(brandRadarWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: BRAND_RADAR_QUEUE,
        logger,
    });
    // GSC snapshot sync. Immediate connect/property-change jobs and the
    // durable daily producer share this queue. The flag controls FUTURE
    // daily sweep ticks only; the consumer stays subscribed during rollback
    // so already-accepted sweep/sync work drains.
    const googleSyncConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    const processGscSync = createGscSyncProcessor({
        gscProvider: providers.gsc,
        persist: {
            upsertSearchAnalytics: (input) => upsertSearchAnalytics(db, input),
            upsertSitemaps: (input) => upsertSitemaps(db, input),
            readPreviousTotals: async (siteId, beforeDate, bindingGenerationId) => {
                const totals = await readPreviousSnapshotTotals(db, siteId, 'query', beforeDate, 28, bindingGenerationId);
                return totals
                    ? { clicks: totals.clicks, impressions: totals.impressions }
                    : null;
            },
        },
        archive: archiveVendorResponse,
        logger,
    });
    const produceDailyGscSync = createGscDailySyncProducer({
        repository: createMongoGscDailySyncRepository(),
        enqueue: (payload, day) => enqueueGscSyncJob(queues.gscSync, payload, day),
        now: () => new Date(),
        logger,
    });
    const processGoogleSiteAutoMatch = createGoogleSiteAutoMatchProcessor({
        gscProvider: providers.gsc,
        ga4Provider: providers.ga4,
        logger,
    });
    const processGscQueueJob = createGscSyncQueueDispatcher(processGscSync, produceDailyGscSync, processGoogleSiteAutoMatch);
    const gscSyncWorker = googleSyncConfigured
        ? new Worker(GSC_SYNC_QUEUE, withRegisteredSingletonRefresh(GSC_DAILY_SYNC_SCHEDULER_KEY, withSiteWorkLease(processGscQueueJob, (job) => job.name === GSC_DAILY_SYNC_SWEEP_JOB
            ? undefined
            : directSiteScope(job))), { connection, concurrency: env.WORKER_CONCURRENCY })
        : undefined;
    if (gscSyncWorker) {
        wireDeadLetter(gscSyncWorker, {
            deadLetterQueue: queues.deadLetter,
            sourceQueueName: GSC_SYNC_QUEUE,
            logger,
        });
    }
    // GA4 snapshot sync — connect/GA4-property-change enqueues here so the
    // analytics card fills in without waiting. Token lifecycle stays on the
    // GSC provider (one Google OAuth client); same OAuth-creds gate.
    const ga4SyncWorker = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? new Worker(GA4_SYNC_QUEUE, withSiteWorkLease(createGa4SyncProcessor({
            ga4Provider: providers.ga4,
            gscProvider: providers.gsc,
            persist: {
                upsertGa4Metrics: (input) => upsertGa4Metrics(db, input),
            },
            archive: archiveVendorResponse,
            logger,
            lagDays: env.GA4_LAG_DAYS,
        })), { connection, concurrency: env.WORKER_CONCURRENCY })
        : undefined;
    if (ga4SyncWorker) {
        wireDeadLetter(ga4SyncWorker, {
            deadLetterQueue: queues.deadLetter,
            sourceQueueName: GA4_SYNC_QUEUE,
            logger,
        });
    }
    // Daily prune of `rate_limit_hits` rows older than the 30-day
    // retention window. Same repeatable-scheduler pattern as the sweeps
    // above.
    const rateLimitPruneQueue = new Queue(RATE_LIMIT_PRUNE_QUEUE, { connection });
    const rateLimitPruneWorker = new Worker(RATE_LIMIT_PRUNE_QUEUE, withRegisteredSingletonRefresh(RATE_LIMIT_PRUNE_SCHEDULER_KEY, createRateLimitPruneProcessor({ db, logger })), { connection, concurrency: 1 });
    const aiUsagePruneQueue = new Queue(AI_USAGE_PRUNE_QUEUE, { connection });
    const aiUsagePruneWorker = new Worker(AI_USAGE_PRUNE_QUEUE, withRegisteredSingletonRefresh(AI_USAGE_PRUNE_SCHEDULER_KEY, createAiUsagePruneProcessor(db, env.AI_USAGE_RETENTION_DAYS)), { connection, concurrency: 1 });
    const reportExportRetentionQueue = new Queue(REPORT_EXPORT_RETENTION_QUEUE, {
        connection,
    });
    const reportExportRetentionWorker = new Worker(REPORT_EXPORT_RETENTION_QUEUE, withRegisteredSingletonRefresh(REPORT_EXPORT_RETENTION_SCHEDULER_KEY, createReportExportRetentionProcessor()), { connection, concurrency: 1 });
    // Weekly Pulse — one job per (site, ISO week). Every production port reads
    // an existing scoped store; collection is followed by a frozen digest and
    // idempotent recipient delivery for completed/partial runs.
    const weeklyPulsePorts = createWeeklyPulseProductionPorts({ db, logger });
    const weeklyPulseProcessor = createWeeklyPulseProcessor({
        db,
        aiVisibility: providers.aiVisibility,
        logger,
        resolveSite: weeklyPulsePorts.resolveSite,
        loadBrandRadarScans: weeklyPulsePorts.loadBrandRadarScans,
        ports: weeklyPulsePorts.collection,
        projectAndDeliver: weeklyPulsePorts.projectAndDeliver,
    });
    const weeklyPulseWorker = new Worker(WEEKLY_PULSE_QUEUE, withSiteWorkLease(weeklyPulseProcessor), {
        connection,
        concurrency: 1,
    });
    wireDeadLetter(weeklyPulseWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: WEEKLY_PULSE_QUEUE,
        logger,
    });
    const clientReportsWorker = new Worker(CLIENT_REPORTS_QUEUE, withSiteWorkLease(createClientReportProcessor({ db, logger }), resolveClientReportSite), { connection, concurrency: 1 });
    wireDeadLetter(clientReportsWorker, {
        deadLetterQueue: queues.deadLetter,
        sourceQueueName: CLIENT_REPORTS_QUEUE,
        logger,
    });
    // Redis is disposable and a worker can remain alive across a Redis restart.
    // Rebuild missing durable schedules every minute without replacing an
    // already-accepted delayed iteration. Content/Brand reconciliation stays
    // scheduled while producer flags are off so accepted receipts/runs drain.
    const singletonSchedulers: ReadonlyArray<{
        name: string;
        key: string;
        queue: Queue;
        desired: boolean;
        expected: {
            every?: number;
            pattern?: string;
            tz?: string;
        };
        install(): Promise<unknown>;
    }> = [
        {
            name: 'content analysis accepted-run reconciliation schedule',
            key: CONTENT_ANALYSIS_RECON_SCHEDULER_KEY,
            queue: contentAnalysisReconQueue,
            desired: true,
            expected: { every: CONTENT_ANALYSIS_RECON_INTERVAL_MS },
            install: () => contentAnalysisReconQueue.upsertJobScheduler(CONTENT_ANALYSIS_RECON_SCHEDULER_KEY, { every: CONTENT_ANALYSIS_RECON_INTERVAL_MS }, { name: CONTENT_ANALYSIS_RECON_JOB }),
        },
        {
            name: 'content monitor receipt reconciliation schedule',
            key: CONTENT_MONITOR_RECON_SCHEDULER_KEY,
            queue: contentMonitorReconQueue,
            desired: true,
            expected: { every: env.CONTENT_MONITOR_RECON_INTERVAL_MS },
            install: () => contentMonitorReconQueue.upsertJobScheduler(CONTENT_MONITOR_RECON_SCHEDULER_KEY, { every: env.CONTENT_MONITOR_RECON_INTERVAL_MS }, { name: CONTENT_MONITOR_RECON_JOB }),
        },
        {
            name: 'audience research accepted-run reconciliation schedule',
            key: AUDIENCE_RESEARCH_RECON_SCHEDULER_KEY,
            queue: audienceResearchReconQueue,
            desired: true,
            expected: { every: AUDIENCE_RESEARCH_RECON_INTERVAL_MS },
            install: () => audienceResearchReconQueue.upsertJobScheduler(AUDIENCE_RESEARCH_RECON_SCHEDULER_KEY, { every: AUDIENCE_RESEARCH_RECON_INTERVAL_MS }, { name: AUDIENCE_RESEARCH_RECON_JOB }),
        },
        {
            name: 'brand radar accepted-run reconciliation schedule',
            key: BRAND_RADAR_RECON_SCHEDULER_KEY,
            queue: brandRadarReconQueue,
            desired: true,
            expected: { every: BRAND_RADAR_RECON_INTERVAL_MS },
            install: () => brandRadarReconQueue.upsertJobScheduler(BRAND_RADAR_RECON_SCHEDULER_KEY, { every: BRAND_RADAR_RECON_INTERVAL_MS }, { name: BRAND_RADAR_RECON_JOB }),
        },
        {
            name: 'content outcome refresh schedule',
            key: CONTENT_OUTCOME_REFRESH_SCHEDULER_KEY,
            queue: contentOutcomeQueue,
            desired: true,
            expected: { every: CONTENT_OUTCOME_REFRESH_INTERVAL_MS },
            install: () => contentOutcomeQueue.upsertJobScheduler(CONTENT_OUTCOME_REFRESH_SCHEDULER_KEY, { every: CONTENT_OUTCOME_REFRESH_INTERVAL_MS }, { name: CONTENT_OUTCOME_REFRESH_JOB }),
        },
        {
            name: 'alert detection producer schedule',
            key: ALERT_SWEEP_SCHEDULER_KEY,
            queue: alertSweepQueue,
            desired: env.ALERTS_ENABLED,
            expected: { every: alertSweepIntervalMs() },
            install: () => alertSweepQueue.upsertJobScheduler(ALERT_SWEEP_SCHEDULER_KEY, { every: alertSweepIntervalMs() }, { name: ALERT_SWEEP_JOB }),
        },
        {
            name: 'GSC daily producer schedule',
            key: GSC_DAILY_SYNC_SCHEDULER_KEY,
            queue: queues.gscSync,
            // Gated on the Google credentials alone. The snapshots this writes are
            // read by cannibalization, client-reports, actions, content-intelligence
            // and keyword suggestions, so pinning the sweep to one consumer's
            // rollout flag starved the other four. The sync itself spends no vendor
            // budget — it is free Google quota.
            desired: googleSyncConfigured,
            expected: { pattern: GSC_DAILY_SYNC_CRON, tz: 'UTC' },
            install: () => queues.gscSync.upsertJobScheduler(GSC_DAILY_SYNC_SCHEDULER_KEY, { pattern: GSC_DAILY_SYNC_CRON, tz: 'UTC' }, {
                name: GSC_DAILY_SYNC_SWEEP_JOB,
                data: { source: 'daily-scheduler' },
            }),
        },
        {
            name: 'rate limit retention schedule',
            key: RATE_LIMIT_PRUNE_SCHEDULER_KEY,
            queue: rateLimitPruneQueue,
            desired: true,
            expected: { every: RATE_LIMIT_PRUNE_INTERVAL_MS },
            install: () => rateLimitPruneQueue.upsertJobScheduler(RATE_LIMIT_PRUNE_SCHEDULER_KEY, { every: RATE_LIMIT_PRUNE_INTERVAL_MS }, { name: RATE_LIMIT_PRUNE_JOB }),
        },
        {
            name: 'AI usage retention schedule',
            key: AI_USAGE_PRUNE_SCHEDULER_KEY,
            queue: aiUsagePruneQueue,
            desired: true,
            expected: { every: AI_USAGE_PRUNE_INTERVAL_MS },
            install: () => aiUsagePruneQueue.upsertJobScheduler(AI_USAGE_PRUNE_SCHEDULER_KEY, { every: AI_USAGE_PRUNE_INTERVAL_MS }, { name: AI_USAGE_PRUNE_JOB }),
        },
        {
            name: 'report export retention schedule',
            key: REPORT_EXPORT_RETENTION_SCHEDULER_KEY,
            queue: reportExportRetentionQueue,
            desired: true,
            expected: { every: REPORT_EXPORT_RETENTION_INTERVAL_MS },
            install: () => reportExportRetentionQueue.upsertJobScheduler(REPORT_EXPORT_RETENTION_SCHEDULER_KEY, { every: REPORT_EXPORT_RETENTION_INTERVAL_MS }, { name: REPORT_EXPORT_RETENTION_JOB }),
        },
    ];
    for (const scheduler of singletonSchedulers) {
        singletonPromotionRefreshers.set(scheduler.key, withSingletonSchedulerRefresh(async () => undefined, {
            queue: scheduler.queue,
            key: scheduler.key,
            desired: scheduler.desired,
            expected: scheduler.expected,
            install: scheduler.install,
            logger,
        }));
    }
    markSingletonPromotionRefreshersReady();
    const schedulerReconciler = startSchedulerReconciler({
        logger,
        tasks: [
            {
                name: 'rank schedules',
                run: () => reconcileRankSchedules(db, queues.ranks, env.ALT_ENGINE_TRACKING_ENABLED),
            },
            {
                name: 'competitor landscape accepted runs',
                run: () => reconcileCompetitorLandscapeRuns(queues.competitorLandscapes),
            },
            {
                name: 'weekly pulse schedules',
                run: () => reconcilePulseSchedulers(db, queues.weeklyPulse),
            },
            {
                name: 'alert delivery outbox',
                run: () => reconcileAlertDeliveries(db, queues.alertDispatch, { logger }),
            },
            {
                name: 'client report schedules',
                run: async () => {
                    const schedules = await db
                        .select()
                        .from(scheduledReports)
                        .where(eq(scheduledReports.enabled, true));
                    await reconcileClientReportSchedulers(queues.clientReports, schedules, env.CLIENT_REPORTS_ENABLED);
                    await reconcileClientReportDeliveries(db, queues.clientReports, { logger });
                },
            },
            {
                name: 'team invitation expiry and provisional account cleanup',
                run: () => reconcileTeamInvitations(),
            },
            ...singletonSchedulers.map((scheduler) => ({
                name: scheduler.name,
                run: () => reconcileSingletonScheduler(scheduler.queue, scheduler.key, scheduler.desired, scheduler.install),
            })),
        ],
    });
    const initialSchedulerReconciliation = await schedulerReconciler.runNow();
    if (initialSchedulerReconciliation.failures > 0) {
        logger.warn(initialSchedulerReconciliation, 'worker started with scheduler reconciliation failures; live recovery will retry');
    }
    const healthServer = await startHealthServer({
        port: env.WORKER_PORT,
        logger,
        checks: {
            redis: async () => (await connection.ping()) === 'PONG',
            mongo: async () => mongoose.connection.readyState === 1,
            postgres: async () => {
                await db.execute(sql `select 1`);
                return true;
            },
        },
        // Extended /health payload: queue depths + DLQ size and oldest job
        // age. The compose healthcheck still hits /healthz which is driven
        // purely by the datastore pings above.
        queueSnapshot: () => collectQueueSnapshot({
            audits: queues.audits,
            ranks: queues.ranks,
            audienceResearch: queues.audienceResearch,
            weeklyPulse: queues.weeklyPulse,
            competitorLandscapes: queues.competitorLandscapes,
            deadLetter: queues.deadLetter,
        }),
    });
    const shutdown = createWorkerShutdown({
        workers: [
            schedulerReconciler,
            deletionReconciler,
            auditWorker,
            rankWorker,
            appSeoTrackingWorker,
            accountPurgeWorker,
            backlinkDeepWorker,
            trafficSnapshotsWorker,
            competitorLandscapeWorker,
            reviewSyncWorker,
            contentAnalysisWorker,
            contentAnalysisReconWorker,
            contentInventoryWorker,
            internalLinksWorker,
            keywordClustersWorker,
            contentBriefWorker,
            geogridWorker,
            competitorContentWorker,
            contentMonitorWorker,
            contentMonitorReconWorker,
            contentOutcomeWorker,
            audienceResearchWorker,
            audienceResearchReconWorker,
            brandRadarWorker,
            alertDispatchWorker,
            alertSweepWorker,
            brandRadarReconWorker,
            ...(gscSyncWorker ? [gscSyncWorker] : []),
            ...(ga4SyncWorker ? [ga4SyncWorker] : []),
            rateLimitPruneWorker,
            aiUsagePruneWorker,
            reportExportRetentionWorker,
            weeklyPulseWorker,
            clientReportsWorker,
        ],
        queues: {
            async close() {
                await Promise.all([
                    queues.close(),
                    rateLimitPruneQueue.close(),
                    aiUsagePruneQueue.close(),
                    reportExportRetentionQueue.close(),
                    contentOutcomeQueue.close(),
                    contentAnalysisReconQueue.close(),
                    contentMonitorReconQueue.close(),
                    audienceResearchReconQueue.close(),
                    alertSweepQueue.close(),
                    brandRadarReconQueue.close(),
                ]);
            },
        },
        connections: [connection],
        healthServer,
        closeDatastores,
        logger,
        exit: (code) => process.exit(code),
    });
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    logger.info({
        queues: [
            AUDITS_QUEUE,
            RANKS_QUEUE,
            ACCOUNT_PURGE_QUEUE,
            BACKLINK_DEEP_QUEUE,
            TRAFFIC_SNAPSHOTS_QUEUE,
            COMPETITOR_LANDSCAPES_QUEUE,
            REVIEW_SYNC_QUEUE,
            CONTENT_ANALYSIS_QUEUE,
            CONTENT_ANALYSIS_RECON_QUEUE,
            CONTENT_INVENTORY_QUEUE,
            INTERNAL_LINKS_QUEUE,
            KEYWORD_CLUSTERING_QUEUE,
            CONTENT_BRIEF_QUEUE,
            GEOGRID_QUEUE,
            COMPETITOR_CONTENT_QUEUE,
            CONTENT_MONITOR_QUEUE,
            CONTENT_MONITOR_RECON_QUEUE,
            CONTENT_OUTCOME_REFRESH_QUEUE,
            AUDIENCE_RESEARCH_QUEUE,
            AUDIENCE_RESEARCH_RECON_QUEUE,
            BRAND_RADAR_QUEUE,
            ALERT_DISPATCH_QUEUE,
            ALERT_SWEEP_QUEUE,
            BRAND_RADAR_RECON_QUEUE,
            ...(gscSyncWorker ? [GSC_SYNC_QUEUE] : []),
            ...(ga4SyncWorker ? [GA4_SYNC_QUEUE] : []),
            RATE_LIMIT_PRUNE_QUEUE,
            AI_USAGE_PRUNE_QUEUE,
            WEEKLY_PULSE_QUEUE,
            CLIENT_REPORTS_QUEUE,
        ],
        concurrency: env.WORKER_CONCURRENCY,
    }, 'worker up');
}
main().catch((err) => {
    logger.fatal({ err }, 'worker startup failed');
    process.exit(1);
});
/* c8 ignore stop */
