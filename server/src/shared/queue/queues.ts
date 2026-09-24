/**
 * Queue definitions + enqueue helpers.
 *
 * Three work queues — `audits`, `ranks`, `account-purge` — plus `dead-letter`
 * (BullMQ has no built-in DLQ; shared/queue/dead-letter.ts feeds it from the worker's
 * `failed` handler). Enqueue helpers validate payloads (the queue is a
 * trust boundary) and derive deterministic jobIds so a double-enqueue
 * dedupes instead of running the same work twice.
 */
import { createHash } from 'node:crypto';
import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { accountPurgeJobSchema, backlinkDeepJobSchema, audienceResearchJobSchema, auditJobSchema, auditSummaryJobSchema, appSeoChartJobSchema, appSeoListingJobSchema, appSeoReviewJobSchema, appSeoTrackingJobSchema, competitorContentJobSchema, competitorLandscapeJobSchema, contentAnalysisJobSchema, contentInventoryJobSchema, internalLinkJobSchema, keywordClusterJobSchema, contentMonitorJobSchema, ga4SyncJobSchema, googleSiteAutoMatchJobSchema, gscSyncJobSchema, parsePayload, rankJobSchema, trafficSnapshotJobSchema, weeklyPulseJobSchema, clientReportJobSchema, type AccountPurgeJob, type BacklinkDeepJob, type AudienceResearchJob, type AuditJob, type AuditSummaryJob, type AppSeoChartJob, type AppSeoListingJob, type AppSeoReviewJob, type AppSeoTrackingJob, type CompetitorContentJob, type CompetitorLandscapeJob, type ContentAnalysisJob, type ContentInventoryJob, type InternalLinkJob, type KeywordClusterJob, type ContentMonitorJob, type Ga4SyncJob, type GoogleSiteAutoMatchJob, type GscSyncJob, type RankJob, reviewSyncJobSchema, type ReviewSyncJob, brandRadarScanJobSchema, type BrandRadarScanJob, contentBriefJobSchema, geogridScanJobSchema, type ContentBriefJob, type GeogridScanJob, alertDispatchJobSchema, type AlertDispatchJob, type TrafficSnapshotJob, type WeeklyPulseJob, type ClientReportJob, } from './payloads.js';
export const AUDITS_QUEUE = 'audits';
export const RANKS_QUEUE = 'ranks';
export const APP_SEO_TRACKING_QUEUE = 'app-seo-tracking';
export const ACCOUNT_PURGE_QUEUE = 'account-purge';
export const GSC_SYNC_QUEUE = 'gsc-sync';
export const GA4_SYNC_QUEUE = 'ga4-sync';
export const CONTENT_ANALYSIS_QUEUE = 'content-analysis';
export const CONTENT_INVENTORY_QUEUE = 'content-inventory';
export const INTERNAL_LINKS_QUEUE = 'internal-links';
export const KEYWORD_CLUSTERING_QUEUE = 'keyword-clustering';
export const COMPETITOR_CONTENT_QUEUE = 'competitor-content';
export const COMPETITOR_LANDSCAPES_QUEUE = 'competitor-landscapes';
export const CONTENT_MONITOR_QUEUE = 'content-monitor';
export const AUDIENCE_RESEARCH_QUEUE = 'audience-research';
export const WEEKLY_PULSE_QUEUE = 'weekly-pulse';
export const CLIENT_REPORTS_QUEUE = 'client-reports';
export const BACKLINK_DEEP_QUEUE = 'backlink-deep';
export const TRAFFIC_SNAPSHOTS_QUEUE = 'traffic-snapshots';
export const REVIEW_SYNC_QUEUE = 'review-sync';
export const BRAND_RADAR_QUEUE = 'brand-radar';
export const CONTENT_BRIEF_QUEUE = 'content-brief';
export const GEOGRID_QUEUE = 'geogrid-scan';
export const ALERT_DISPATCH_QUEUE = 'alert-dispatch';
export const DEAD_LETTER_QUEUE = 'dead-letter';
export const AUDIT_JOB_NAME = 'audit';
export const AUDIT_SUMMARY_JOB_NAME = 'audit-summary';
export const RANK_JOB_NAME = 'rank';
export const APP_SEO_TRACKING_JOB_NAME = 'app-seo-keyword-check';
export const APP_SEO_LISTING_JOB_NAME = 'app-seo-listing-run';
export const APP_SEO_CHART_JOB_NAME = 'app-seo-chart-check';
export const APP_SEO_REVIEW_JOB_NAME = 'app-seo-review-run';
export const ACCOUNT_PURGE_JOB_NAME = 'account-purge';
export const GSC_SYNC_JOB_NAME = 'gsc-sync';
export const GOOGLE_SITE_AUTO_MATCH_JOB_NAME = 'google-site-auto-match';
export const GA4_SYNC_JOB_NAME = 'ga4-sync';
export const CONTENT_ANALYSIS_JOB_NAME = 'content-analysis';
export const CONTENT_INVENTORY_JOB_NAME = 'content-inventory';
export const INTERNAL_LINKS_JOB_NAME = 'internal-links';
export const KEYWORD_CLUSTERING_JOB_NAME = 'keyword-clustering';
export const COMPETITOR_CONTENT_JOB_NAME = 'competitor-content';
export const COMPETITOR_LANDSCAPE_JOB_NAME = 'competitor-landscape';
export const CONTENT_MONITOR_JOB_NAME = 'content-monitor';
export const AUDIENCE_RESEARCH_JOB_NAME = 'audience-research';
export const WEEKLY_PULSE_JOB_NAME = 'weekly-pulse';
export const CLIENT_REPORT_JOB_NAME = 'client-report';
export const BACKLINK_DEEP_JOB_NAME = 'backlink-deep';
export const TRAFFIC_SNAPSHOT_JOB_NAME = 'traffic-snapshot';
export const REVIEW_SYNC_JOB_NAME = 'review-sync';
export const BRAND_RADAR_SCAN_JOB_NAME = 'brand-radar-scan';
export const CONTENT_BRIEF_JOB_NAME = 'content-brief';
export const GEOGRID_SCAN_JOB_NAME = 'geogrid-scan';
export const ALERT_DISPATCH_JOB_NAME = 'alert-dispatch';
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 5000 },
};
export interface Queues {
    audits: Queue;
    ranks: Queue;
    appSeoTracking: Queue;
    accountPurge: Queue;
    gscSync: Queue;
    ga4Sync: Queue;
    contentAnalysis: Queue;
    contentInventory: Queue;
    internalLinks: Queue;
    keywordClusters: Queue;
    competitorContent: Queue;
    competitorLandscapes: Queue;
    contentMonitor: Queue;
    audienceResearch: Queue;
    weeklyPulse: Queue;
    clientReports: Queue;
    backlinkDeep: Queue;
    trafficSnapshots: Queue;
    reviewSync: Queue;
    brandRadar: Queue;
    contentBrief: Queue;
    geogrid: Queue;
    alertDispatch: Queue;
    deadLetter: Queue;
    /** Closes all queues (does not quit the shared connection). */
    close(): Promise<void>;
}
export interface CreateQueuesOptions {
    /** Test seam — production always uses DEFAULT_JOB_OPTIONS. */
    defaultJobOptions?: JobsOptions;
}
export function createQueues(connection: Redis, opts: CreateQueuesOptions = {}): Queues {
    const defaultJobOptions = opts.defaultJobOptions ?? DEFAULT_JOB_OPTIONS;
    const audits = new Queue(AUDITS_QUEUE, { connection, defaultJobOptions });
    const ranks = new Queue(RANKS_QUEUE, { connection, defaultJobOptions });
    const appSeoTracking = new Queue(APP_SEO_TRACKING_QUEUE, {
        connection,
        defaultJobOptions,
    });
    const accountPurge = new Queue(ACCOUNT_PURGE_QUEUE, { connection, defaultJobOptions });
    const gscSync = new Queue(GSC_SYNC_QUEUE, { connection, defaultJobOptions });
    const ga4Sync = new Queue(GA4_SYNC_QUEUE, { connection, defaultJobOptions });
    // Content Intelligence — retries are attempted-bounded (5) via the caller's
    // options; DEFAULT_JOB_OPTIONS still applies for the other queue-wide knobs.
    const contentAnalysis = new Queue(CONTENT_ANALYSIS_QUEUE, {
        connection,
        defaultJobOptions: {
            ...defaultJobOptions,
            attempts: 5,
        },
    });
    // Content inventory — one job per paid page-block reservation.
    // Retries stay bounded (3 via DEFAULT_JOB_OPTIONS); the processor re-loads
    // the ContentInventoryRun and short-circuits terminal states, and the
    // whole-block refund is idempotent by `(reservationKey, kind)`.
    const contentInventory = new Queue(CONTENT_INVENTORY_QUEUE, {
        connection,
        defaultJobOptions,
    });
    // Internal-link suggestions — stored inventory/GSC reads plus one bounded AI
    // pass. The processor is terminal-idempotent and its only refund path is an
    // exactly-once AI-provider failure with zero retained suggestions.
    const internalLinks = new Queue(INTERNAL_LINKS_QUEUE, {
        connection,
        defaultJobOptions,
    });
    // Keyword clustering by SERP overlap (community request 02) — deterministic
    // grouping over stored `serp_observations` plus one optional bounded
    // labelling pass. Zero vendor spend; the processor is terminal-idempotent
    // and this module has no refund path at all.
    const keywordClusters = new Queue(KEYWORD_CLUSTERING_QUEUE, {
        connection,
        defaultJobOptions,
    });
    // Competitor content intelligence — one job per paid
    // `competitor_content_runs` reservation. Retries stay bounded (3 via
    // DEFAULT_JOB_OPTIONS); the processor re-loads the CompetitorContentRun and
    // short-circuits terminal states, and the single-unit refund is idempotent
    // by `(reservationKey, kind)`.
    const competitorContent = new Queue(COMPETITOR_CONTENT_QUEUE, {
        connection,
        defaultJobOptions,
    });
    // Competitor Intelligence landscape snapshots. This registers the
    // producer/queue; the comparison processor consumes it separately.
    const competitorLandscapes = new Queue(COMPETITOR_LANDSCAPES_QUEUE, {
        connection,
        defaultJobOptions,
    });
    // Public-page change monitoring — one job per verified, deduped
    // webhook delivery. Retries stay bounded (3 via DEFAULT_JOB_OPTIONS); the
    // receipt embeds an immutable processing plan + notification outbox. Replay
    // repairs evidence without vendor spend and sends under one stable email
    // idempotency key; reconciliation revives a non-terminal receipt after the
    // queue's immediate attempts are exhausted.
    const contentMonitor = new Queue(CONTENT_MONITOR_QUEUE, {
        connection,
        defaultJobOptions,
    });
    // Audience Research — one run = one bundled unit. Retries stay bounded
    // (3 via DEFAULT_JOB_OPTIONS); the processor also runs its own
    // crash-safe idempotency claim on the AI dispatch to bound worst-case
    // COGS at one AI call per run.
    const audienceResearch = new Queue(AUDIENCE_RESEARCH_QUEUE, {
        connection,
        defaultJobOptions,
    });
    // Weekly Pulse — one job per (site, ISO week) via an
    // `upsertJobScheduler`. Retries are bounded (3 via DEFAULT_JOB_OPTIONS);
    // the processor also runs an idempotency guard against the unique
    // `(account_id, site_id, iso_week)` index on `weekly_pulse_runs`, so a
    // replayed job never charges twice.
    const weeklyPulse = new Queue(WEEKLY_PULSE_QUEUE, {
        connection,
        defaultJobOptions,
    });
    const clientReports = new Queue(CLIENT_REPORTS_QUEUE, {
        connection,
        defaultJobOptions,
    });
    const backlinkDeep = new Queue(BACKLINK_DEEP_QUEUE, {
        connection,
        defaultJobOptions,
    });
    const trafficSnapshots = new Queue(TRAFFIC_SNAPSHOTS_QUEUE, {
        connection,
        defaultJobOptions,
    });
    // Review Intelligence — one job per submitted sync. The
    // deterministic `review-sync-<runId>` job id makes a duplicate enqueue a
    // no-op, and the processor's terminal-status guard makes a replay after a
    // settled run a no-op too, so the reserved unit is never refunded twice.
    const reviewSync = new Queue(REVIEW_SYNC_QUEUE, {
        connection,
        defaultJobOptions,
    });
    // Brand Radar — one job per reserved `brand_mention_scans`
    // unit. The deterministic `brand-radar-<scanId>` job id makes a duplicate
    // enqueue a no-op; the processor short-circuits terminal scans so a
    // replay never re-spends or double-refunds.
    const brandRadar = new Queue(BRAND_RADAR_QUEUE, {
        connection,
        defaultJobOptions,
    });
    const contentBrief = new Queue(CONTENT_BRIEF_QUEUE, {
        connection,
        defaultJobOptions,
    });
    // Geogrid scans — one job per scan. The
    // deterministic jobId makes a duplicate enqueue a no-op, and the processor
    // short-circuits terminal scans so a replay can never re-spend or
    // double-refund the single reserved unit.
    const geogrid = new Queue(GEOGRID_QUEUE, {
        connection,
        defaultJobOptions,
    });
    // Alert dispatch — one job per confirmed transition per rule.
    // Retries stay bounded (3 via DEFAULT_JOB_OPTIONS); the processor claims a
    // per-channel `alert_deliveries` row on a UNIQUE idempotency key, so a
    // replay after a partial fan-out re-sends only the channels that had not
    // already settled.
    const alertDispatch = new Queue(ALERT_DISPATCH_QUEUE, {
        connection,
        defaultJobOptions,
    });
    // Dead-letter entries are kept forever — they exist precisely because the
    // default retention would have discarded the evidence.
    const deadLetter = new Queue(DEAD_LETTER_QUEUE, { connection });
    return {
        audits,
        ranks,
        appSeoTracking,
        accountPurge,
        gscSync,
        ga4Sync,
        contentAnalysis,
        contentInventory,
        internalLinks,
        keywordClusters,
        competitorContent,
        competitorLandscapes,
        contentMonitor,
        audienceResearch,
        weeklyPulse,
        clientReports,
        backlinkDeep,
        trafficSnapshots,
        reviewSync,
        brandRadar,
        contentBrief,
        geogrid,
        alertDispatch,
        deadLetter,
        async close() {
            await Promise.all([
                audits.close(),
                ranks.close(),
                appSeoTracking.close(),
                accountPurge.close(),
                gscSync.close(),
                ga4Sync.close(),
                contentAnalysis.close(),
                contentInventory.close(),
                internalLinks.close(),
                keywordClusters.close(),
                competitorContent.close(),
                competitorLandscapes.close(),
                contentMonitor.close(),
                audienceResearch.close(),
                weeklyPulse.close(),
                clientReports.close(),
                backlinkDeep.close(),
                trafficSnapshots.close(),
                reviewSync.close(),
                brandRadar.close(),
                contentBrief.close(),
                geogrid.close(),
                alertDispatch.close(),
                deadLetter.close(),
            ]);
        },
    };
}
// BullMQ v5 rejects custom jobIds containing `:` (its own key separator),
// so the deterministic ids use `-`.
export function auditJobId(runId: string): string {
    return `audit-${runId}`;
}
export function auditSummaryJobId(locale: AuditSummaryJob['locale'], generationId: string): string {
    return `audit-summary-${locale}-${generationId}`;
}
export function rankJobId(siteId: string, periodKey: string): string {
    return `rank-${siteId}-${periodKey}`;
}
export function accountPurgeJobId(userId: string): string {
    return `account-purge-${userId}`;
}
export function gscSyncJobId(siteId: string, day: string): string {
    return `gsc-sync-${siteId}-${day}`;
}
export function googleSiteAutoMatchJobId(siteId: string, requestId: string): string {
    return `google-site-auto-match-${siteId}-${requestId}`;
}
export function ga4SyncJobId(siteId: string, day: string): string {
    return `ga4-sync-${siteId}-${day}`;
}
/**
 * Deterministic content-analysis job id — one job per analysis. A duplicate
 * enqueue collides on the jobId and BullMQ silently no-ops, so a webhook /
 * worker replay never runs the same analysis twice.
 */
export function contentAnalysisJobId(analysisId: string): string {
    return `content-analysis-${analysisId}`;
}
/**
 * Deterministic content-inventory job id — one job per run. A duplicate
 * enqueue collides on the jobId and BullMQ silently no-ops, so a webhook /
 * worker replay never runs the same inventory crawl twice.
 */
export function contentInventoryJobId(runId: string): string {
    return `content-inventory-${runId}`;
}
/** One deterministic `internal-links-<runId>` job; BullMQ forbids colons. */
export function internalLinkJobId(runId: string): string {
    return `internal-links-${runId}`;
}
/** One deterministic `keyword-clustering-<runId>` job; no colon. */
export function keywordClusterJobId(runId: string): string {
    return `keyword-clustering-${runId}`;
}
/**
 * Deterministic competitor-content job id — one job per run. A duplicate
 * enqueue collides on the jobId and BullMQ silently no-ops, so a webhook /
 * worker replay never runs the same paid competitor comparison twice.
 */
export function competitorContentJobId(runId: string): string {
    return `competitor-content-${runId}`;
}
export function competitorLandscapeJobId(runId: string): string {
    return `competitor-landscape-${runId}`;
}
/**
 * Deterministic content-monitor job id — one job per webhook delivery receipt.
 * A duplicate enqueue (webhook redelivery, worker replay) collides on the jobId
 * and BullMQ silently no-ops, so a delivery is processed exactly once even if
 * the receipt insert and the enqueue race.
 */
export function contentMonitorJobId(receiptId: string): string {
    return `content-monitor-${receiptId}`;
}
/**
 * Deterministic audience-research job id — one job per run. A duplicate
 * enqueue (client retry, replay, storm) collides on the jobId and BullMQ
 * silently no-ops, so the paid research pipeline never fires twice for the
 * same reservation.
 */
export function audienceResearchJobId(runId: string): string {
    return `audience-research-${runId}`;
}
/**
 * Deterministic weekly-pulse job id — one job per (site, ISO week). A
 * duplicate enqueue (scheduler retry, test-seam replay, storm) collides on
 * the jobId and BullMQ silently no-ops, so the paid pulse pipeline never
 * fires twice for the same week.
 */
export function weeklyPulseJobId(siteId: string, isoWeek: string): string {
    return `weekly-pulse-${siteId}-${isoWeek}`;
}
export function clientReportJobId(scheduleId: string, runKey: string): string {
    return `client-report-${scheduleId}-${runKey}`;
}
export function backlinkDeepJobId(runId: string): string {
    return `backlink-deep-${runId}`;
}
export function trafficSnapshotJobId(runId: string): string {
    return `traffic-snapshot-${runId}`;
}
export function reviewSyncJobId(runId: string): string {
    return `review-sync-${runId}`;
}
export function brandRadarScanJobId(scanId: string): string {
    return `brand-radar-${scanId}`;
}
export function contentBriefJobId(briefId: string): string {
    return `content-brief-${briefId}`;
}
export function geogridScanJobId(scanId: string): string {
    return `geogrid-scan-${scanId}`;
}
/**
 * Deterministic alert-dispatch job id — one job per (rule, transition). The
 * transition id is hashed so an arbitrary-length review-pair key still yields a
 * bounded id, and BullMQ v5 rejects `:` so the separator stays `-`.
 */
export function alertDispatchJobId(ruleId: string, transitionId: string): string {
    const digest = createHash('sha256').update(transitionId).digest('hex').slice(0, 16);
    return `alert-dispatch-${ruleId}-${digest}`;
}
/**
 * Deterministic period key for rank-check idempotency: one job per site per
 * period, however many times the trigger fires. Daily → `2026-07-02`,
 * weekly → ISO week `2026-W27`.
 */
export function rankPeriodKey(cadence: 'daily' | 'weekly', at: Date): string {
    if (cadence === 'daily') {
        return at.toISOString().slice(0, 10);
    }
    // ISO-8601 week number: week 1 contains the year's first Thursday.
    const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
    const dayOfWeek = d.getUTCDay() || 7; // Mon=1 … Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek); // shift to this week's Thursday
    const isoYear = d.getUTCFullYear();
    const yearStart = Date.UTC(isoYear, 0, 1);
    const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
    return `${isoYear}-W${String(week).padStart(2, '0')}`;
}
export function appSeoTrackingJobId(keywordId: string, reservationStamp: string): string {
    return `app-seo-keyword-${keywordId}-${reservationStamp}`;
}
export function appSeoListingJobId(runId: string): string {
    return `app-seo-listing-${runId}`;
}
export function appSeoChartJobId(subscriptionId: string, reservationStamp: string): string {
    return `app-seo-chart-${subscriptionId}-${reservationStamp}`;
}
export function appSeoReviewJobId(runId: string): string {
    return `app-seo-review-${runId}`;
}
/** One idempotent tracking job per tracked keyword reservation generation. */
export async function enqueueAppSeoTrackingJob(queue: Pick<Queue, 'add'>, payload: AppSeoTrackingJob, opts: JobsOptions = {}) {
    const data = parsePayload(appSeoTrackingJobSchema, payload);
    return queue.add(APP_SEO_TRACKING_JOB_NAME, data, {
        ...opts,
        jobId: appSeoTrackingJobId(data.keywordId, data.reservationStamp),
    });
}
/** One job per explicit listing-health run; worker reloads registered store ids. */
export async function enqueueAppSeoListingJob(queue: Queue, payload: AppSeoListingJob, opts: JobsOptions = {}) {
    const data = parsePayload(appSeoListingJobSchema, payload);
    return queue.add(APP_SEO_LISTING_JOB_NAME, data, {
        ...opts,
        jobId: appSeoListingJobId(data.runId),
    });
}
/** One idempotent chart job per subscription and ISO week. */
export async function enqueueAppSeoChartJob(queue: Pick<Queue, 'add'>, payload: AppSeoChartJob, opts: JobsOptions = {}) {
    const data = parsePayload(appSeoChartJobSchema, payload);
    return queue.add(APP_SEO_CHART_JOB_NAME, data, {
        ...opts,
        jobId: appSeoChartJobId(data.subscriptionId, data.reservationStamp),
    });
}
/** One job per Mongo review run; worker reloads all mutable inputs owner-scoped. */
export async function enqueueAppSeoReviewJob(queue: Queue, payload: AppSeoReviewJob, opts: JobsOptions = {}) {
    const data = parsePayload(appSeoReviewJobSchema, payload);
    return queue.add(APP_SEO_REVIEW_JOB_NAME, data, {
        ...opts,
        attempts: 1,
        jobId: appSeoReviewJobId(data.runId),
    });
}
/** Validates + enqueues an audit job; jobId `audit-<runId>` dedupes. */
export async function enqueueAuditJob(queue: Queue, payload: AuditJob, opts: JobsOptions = {}) {
    const data = parsePayload(auditJobSchema, payload);
    return queue.add(AUDIT_JOB_NAME, data, { ...opts, jobId: auditJobId(data.runId) });
}
/** The AI runtime owns provider fallback, so summary jobs never replay the paid call. */
export async function enqueueAuditSummaryJob(queue: Queue, payload: AuditSummaryJob, opts: JobsOptions = {}) {
    const data = parsePayload(auditSummaryJobSchema, payload);
    return queue.add(AUDIT_SUMMARY_JOB_NAME, data, {
        ...opts,
        attempts: 1,
        jobId: auditSummaryJobId(data.locale, data.generationId),
    });
}
/** Validates + enqueues a rank job; jobId `rank-<siteId>-<periodKey>` dedupes. */
export async function enqueueRankJob(queue: Queue, payload: RankJob, periodKey: string, opts: JobsOptions = {}) {
    const data = parsePayload(rankJobSchema, payload);
    return queue.add(RANK_JOB_NAME, data, { ...opts, jobId: rankJobId(data.siteId, periodKey) });
}
/** Validates + enqueues a delayed account-purge job; jobId `account-purge-<userId>` dedupes. */
export async function enqueueAccountPurgeJob(queue: Queue, payload: AccountPurgeJob, purgeAt: Date, now: Date = new Date(), opts: JobsOptions = {}) {
    const data = parsePayload(accountPurgeJobSchema, payload);
    return queue.add(ACCOUNT_PURGE_JOB_NAME, data, {
        ...opts,
        jobId: accountPurgeJobId(data.userId),
        delay: Math.max(0, purgeAt.getTime() - now.getTime()),
        // The payload is itself a personal identifier. A completed purge must not
        // remain in Redis's ordinary 500-job completion history.
        removeOnComplete: true,
    });
}
/**
 * Validates + enqueues a GSC sync job; jobId `gsc-sync-<siteId>-<day>` dedupes
 * so connect/property/daily-producer triggers on one day collapse to one sync.
 */
export async function enqueueGscSyncJob(queue: Queue, payload: GscSyncJob, day: string, opts: JobsOptions = {}) {
    const data = parsePayload(gscSyncJobSchema, payload);
    return queue.add(GSC_SYNC_JOB_NAME, data, {
        ...opts,
        jobId: gscSyncJobId(data.siteId, day),
    });
}
/** Validate and enqueue one immutable Site matching request. */
export async function enqueueGoogleSiteAutoMatchJob(queue: Queue, payload: GoogleSiteAutoMatchJob, opts: JobsOptions = {}) {
    const data = parsePayload(googleSiteAutoMatchJobSchema, payload);
    return queue.add(GOOGLE_SITE_AUTO_MATCH_JOB_NAME, data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        ...opts,
        jobId: googleSiteAutoMatchJobId(data.siteId, data.requestId),
    });
}
/**
 * Validates + enqueues a GA4 sync job; jobId `ga4-sync-<siteId>-<day>` dedupes
 * so many connect/property triggers on one day collapse to a single sync.
 */
export async function enqueueGa4SyncJob(queue: Queue, payload: Ga4SyncJob, day: string, opts: JobsOptions = {}) {
    const data = parsePayload(ga4SyncJobSchema, payload);
    return queue.add(GA4_SYNC_JOB_NAME, data, {
        ...opts,
        jobId: ga4SyncJobId(data.siteId, day),
    });
}
/**
 * Validates + enqueues a content-analysis job. jobId
 * `content-analysis-<analysisId>` dedupes so a duplicate POST or a worker
 * replay never runs the analysis twice; the processor also re-loads the
 * ContentAnalysis document and short-circuits terminal states.
 */
export async function enqueueContentAnalysisJob(queue: Queue, payload: ContentAnalysisJob, opts: JobsOptions = {}) {
    const data = parsePayload(contentAnalysisJobSchema, payload);
    return queue.add(CONTENT_ANALYSIS_JOB_NAME, data, {
        ...opts,
        jobId: contentAnalysisJobId(data.analysisId),
    });
}
/**
 * Validates + enqueues a content-inventory job. jobId
 * `content-inventory-<runId>` dedupes so a duplicate POST or a worker replay
 * never runs the same inventory crawl twice; the processor also re-loads the
 * ContentInventoryRun document and short-circuits terminal states.
 */
export async function enqueueContentInventoryJob(queue: Queue, payload: ContentInventoryJob, opts: JobsOptions = {}) {
    const data = parsePayload(contentInventoryJobSchema, payload);
    return queue.add(CONTENT_INVENTORY_JOB_NAME, data, {
        ...opts,
        jobId: contentInventoryJobId(data.runId),
    });
}
/** Validates + enqueues one stored-inventory internal-link suggestion run. */
export async function enqueueInternalLinkJob(queue: Queue, payload: InternalLinkJob, opts: JobsOptions = {}) {
    const data = parsePayload(internalLinkJobSchema, payload);
    return queue.add(INTERNAL_LINKS_JOB_NAME, data, {
        ...opts,
        jobId: internalLinkJobId(data.runId),
    });
}
/**
 * Validates + enqueues a keyword-clustering job. The deterministic
 * `keyword-clustering-<runId>` job id makes a duplicate POST or a worker replay
 * a no-op; the processor additionally short-circuits terminal runs.
 */
export async function enqueueKeywordClusterJob(queue: Queue, payload: KeywordClusterJob, opts: JobsOptions = {}) {
    const data = parsePayload(keywordClusterJobSchema, payload);
    return queue.add(KEYWORD_CLUSTERING_JOB_NAME, data, {
        ...opts,
        jobId: keywordClusterJobId(data.runId),
    });
}
/**
 * Validates + enqueues a competitor-content job. jobId
 * `competitor-content-<runId>` dedupes so a duplicate POST or a worker replay
 * never runs the same paid competitor comparison twice; the processor also
 * re-loads the CompetitorContentRun document and short-circuits terminal states.
 */
export async function enqueueCompetitorContentJob(queue: Queue, payload: CompetitorContentJob, opts: JobsOptions = {}) {
    const data = parsePayload(competitorContentJobSchema, payload);
    return queue.add(COMPETITOR_CONTENT_JOB_NAME, data, {
        ...opts,
        jobId: competitorContentJobId(data.runId),
    });
}
/** Strict producer validation + deterministic one-job-per-run id. */
export async function enqueueCompetitorLandscapeJob(queue: Queue, payload: CompetitorLandscapeJob, opts: JobsOptions = {}) {
    const data = parsePayload(competitorLandscapeJobSchema, payload);
    return queue.add(COMPETITOR_LANDSCAPE_JOB_NAME, data, {
        ...opts,
        jobId: competitorLandscapeJobId(data.runId),
    });
}
/**
 * Validates + enqueues a content-monitor job. jobId
 * `content-monitor-<receiptId>` dedupes so a webhook redelivery or a worker
 * replay never creates parallel initial jobs. The processor's durable receipt
 * state/outbox remains the final idempotency authority across crash recovery.
 */
export async function enqueueContentMonitorJob(queue: Queue, payload: ContentMonitorJob, opts: JobsOptions = {}) {
    const data = parsePayload(contentMonitorJobSchema, payload);
    return queue.add(CONTENT_MONITOR_JOB_NAME, data, {
        ...opts,
        jobId: contentMonitorJobId(data.receiptId),
    });
}
/**
 * Validates + enqueues an audience-research job. jobId
 * `audience-research-<runId>` dedupes so a duplicate POST or a worker replay
 * never runs the same research twice; the processor also re-loads the
 * AudienceResearchRun document and short-circuits terminal states.
 */
export async function enqueueAudienceResearchJob(queue: Queue, payload: AudienceResearchJob, opts: JobsOptions = {}) {
    const data = parsePayload(audienceResearchJobSchema, payload);
    return queue.add(AUDIENCE_RESEARCH_JOB_NAME, data, {
        ...opts,
        jobId: audienceResearchJobId(data.runId),
    });
}
/**
 * Validates + enqueues a weekly-pulse job. jobId
 * `weekly-pulse-<siteId>-<isoWeek>` dedupes so the deterministic scheduler
 * and the manual test seam (`scheduleDueWeeklyPulses`) can both fire a job
 * without producing a double collection.
 */
export async function enqueueWeeklyPulseJob(queue: Queue, payload: WeeklyPulseJob, opts: JobsOptions = {}) {
    const data = parsePayload(weeklyPulseJobSchema, payload);
    return queue.add(WEEKLY_PULSE_JOB_NAME, data, {
        ...opts,
        jobId: weeklyPulseJobId(data.siteId, data.isoWeek),
    });
}
/** Validates and enqueues one deterministic scheduled client-report delivery. */
export async function enqueueClientReportJob(queue: Queue, payload: ClientReportJob, opts: JobsOptions = {}) {
    const data = parsePayload(clientReportJobSchema, payload);
    return queue.add(CLIENT_REPORT_JOB_NAME, data, {
        ...opts,
        jobId: clientReportJobId(data.scheduleId, data.runKey),
    });
}
/** Validates + enqueues one deterministic Link Intelligence deep-pull job. */
export async function enqueueBacklinkDeepJob(queue: Queue, payload: BacklinkDeepJob, opts: JobsOptions = {}) {
    const data = parsePayload(backlinkDeepJobSchema, payload);
    return queue.add(BACKLINK_DEEP_JOB_NAME, data, {
        ...opts,
        jobId: backlinkDeepJobId(data.runId),
    });
}
/** Validates + enqueues one deterministic Traffic Insights snapshot job. */
export async function enqueueTrafficSnapshotJob(queue: Queue, payload: TrafficSnapshotJob, opts: JobsOptions = {}) {
    const data = parsePayload(trafficSnapshotJobSchema, payload);
    return queue.add(TRAFFIC_SNAPSHOT_JOB_NAME, data, {
        ...opts,
        jobId: trafficSnapshotJobId(data.runId),
    });
}
/** Validates + enqueues one deterministic Review Intelligence sync job. */
export async function enqueueReviewSyncJob(queue: Queue, payload: ReviewSyncJob, opts: JobsOptions = {}) {
    const data = parsePayload(reviewSyncJobSchema, payload);
    return queue.add(REVIEW_SYNC_JOB_NAME, data, {
        ...opts,
        jobId: reviewSyncJobId(data.runId),
    });
}
/** Validates + enqueues one deterministic alert-dispatch job. */
export async function enqueueAlertDispatchJob(queue: Queue, payload: AlertDispatchJob, opts: JobsOptions = {}) {
    const data = parsePayload(alertDispatchJobSchema, payload);
    return queue.add(ALERT_DISPATCH_JOB_NAME, data, {
        ...opts,
        jobId: alertDispatchJobId(data.ruleId, data.transitionId),
    });
}
export async function enqueueBrandRadarScanJob(queue: Queue, payload: BrandRadarScanJob, opts: JobsOptions = {}) {
    const data = parsePayload(brandRadarScanJobSchema, payload);
    return queue.add(BRAND_RADAR_SCAN_JOB_NAME, data, {
        ...opts,
        jobId: brandRadarScanJobId(data.scanId),
    });
}
export async function enqueueGeogridScanJob(queue: Queue, payload: GeogridScanJob, opts: JobsOptions = {}) {
    const data = parsePayload(geogridScanJobSchema, payload);
    return queue.add(GEOGRID_SCAN_JOB_NAME, data, {
        ...opts,
        jobId: geogridScanJobId(data.scanId),
    });
}
export async function enqueueContentBriefJob(queue: Queue, payload: ContentBriefJob, opts: JobsOptions = {}) {
    const data = parsePayload(contentBriefJobSchema, payload);
    return queue.add(CONTENT_BRIEF_JOB_NAME, data, {
        ...opts,
        jobId: contentBriefJobId(data.briefId),
    });
}
