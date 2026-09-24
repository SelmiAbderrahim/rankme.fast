/**
 * Real-Redis queue tests — see vitest.global-setup.ts for why
 * these run against a real Redis instance rather than a mock.
 */
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { createTestQueueConnection, flushTestRedis } from '../testing/redis.js';
import {
  ACCOUNT_PURGE_JOB_NAME,
  ACCOUNT_PURGE_QUEUE,
  BACKLINK_DEEP_JOB_NAME,
  BACKLINK_DEEP_QUEUE,
  TRAFFIC_SNAPSHOT_JOB_NAME,
  TRAFFIC_SNAPSHOTS_QUEUE,
  REVIEW_SYNC_JOB_NAME,
  REVIEW_SYNC_QUEUE,
  BRAND_RADAR_SCAN_JOB_NAME,
  BRAND_RADAR_QUEUE,
  ALERT_DISPATCH_JOB_NAME,
  APP_SEO_CHART_JOB_NAME,
  APP_SEO_LISTING_JOB_NAME,
  APP_SEO_REVIEW_JOB_NAME,
  APP_SEO_TRACKING_JOB_NAME,
  COMPETITOR_LANDSCAPE_JOB_NAME,
  CONTENT_BRIEF_JOB_NAME,
  GEOGRID_SCAN_JOB_NAME,
  KEYWORD_CLUSTERING_JOB_NAME,
  WEEKLY_PULSE_JOB_NAME,
  AUDIENCE_RESEARCH_JOB_NAME,
  AUDIENCE_RESEARCH_QUEUE,
  AUDIT_JOB_NAME,
  AUDIT_SUMMARY_JOB_NAME,
  AUDITS_QUEUE,
  COMPETITOR_CONTENT_JOB_NAME,
  COMPETITOR_CONTENT_QUEUE,
  CONTENT_ANALYSIS_JOB_NAME,
  CONTENT_INVENTORY_JOB_NAME,
  CONTENT_INVENTORY_QUEUE,
  INTERNAL_LINKS_JOB_NAME,
  INTERNAL_LINKS_QUEUE,
  CONTENT_MONITOR_JOB_NAME,
  CONTENT_MONITOR_QUEUE,
  CLIENT_REPORT_JOB_NAME,
  CLIENT_REPORTS_QUEUE,
  DEAD_LETTER_QUEUE,
  DEFAULT_JOB_OPTIONS,
  GA4_SYNC_JOB_NAME,
  GA4_SYNC_QUEUE,
  GSC_SYNC_JOB_NAME,
  GSC_SYNC_QUEUE,
  RANK_JOB_NAME,
  RANKS_QUEUE,
  accountPurgeJobId,
  alertDispatchJobId,
  appSeoChartJobId,
  appSeoListingJobId,
  appSeoReviewJobId,
  appSeoTrackingJobId,
  backlinkDeepJobId,
  trafficSnapshotJobId,
  reviewSyncJobId,
  brandRadarScanJobId,
  audienceResearchJobId,
  auditJobId,
  auditSummaryJobId,
  competitorContentJobId,
  competitorLandscapeJobId,
  contentAnalysisJobId,
  contentBriefJobId,
  contentInventoryJobId,
  internalLinkJobId,
  geogridScanJobId,
  keywordClusterJobId,
  contentMonitorJobId,
  createQueues,
  enqueueAccountPurgeJob,
  enqueueAlertDispatchJob,
  enqueueAppSeoChartJob,
  enqueueAppSeoListingJob,
  enqueueAppSeoReviewJob,
  enqueueAppSeoTrackingJob,
  enqueueBacklinkDeepJob,
  enqueueTrafficSnapshotJob,
  enqueueReviewSyncJob,
  enqueueBrandRadarScanJob,
  enqueueAudienceResearchJob,
  enqueueAuditJob,
  enqueueAuditSummaryJob,
  enqueueCompetitorContentJob,
  enqueueCompetitorLandscapeJob,
  enqueueContentAnalysisJob,
  enqueueContentBriefJob,
  enqueueContentInventoryJob,
  enqueueInternalLinkJob,
  enqueueGeogridScanJob,
  enqueueKeywordClusterJob,
  enqueueContentMonitorJob,
  enqueueClientReportJob,
  enqueueGa4SyncJob,
  enqueueGscSyncJob,
  enqueueRankJob,
  enqueueWeeklyPulseJob,
  ga4SyncJobId,
  gscSyncJobId,
  rankJobId,
  rankPeriodKey,
  weeklyPulseJobId,
  clientReportJobId,
  type Queues,
} from './index.js';

const hex = (n: number) => n.toString(16).padStart(24, '0');
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

const auditPayload = { accountId: hex(1), siteId: hex(2), runId: hex(3), pageCap: 50 };
const auditSummaryPayload = {
  accountId: hex(1),
  runId: hex(3),
  generationId: hex(6),
  locale: 'en' as const,
};
const accountPurgePayload = { userId: hex(1) };
const rankPayload = {
  accountId: hex(1),
  siteId: hex(2),
  keywordIds: [uuid(4)],
  schedulerKey: 'manual',
};
const gscSyncPayload = { accountId: hex(1), siteId: hex(2), domain: 'example.com' };
const ga4SyncPayload = { accountId: hex(1), siteId: hex(2) };
const audienceResearchPayload = {
  accountId: hex(1),
  siteId: hex(2),
  runId: hex(7),
  outputLocale: 'en' as const,
};
const contentAnalysisPayload = {
  accountId: hex(1),
  siteId: hex(2),
  analysisId: hex(8),
  reservationKey: 'analysis_reservation_key-1',
};
const contentInventoryPayload = {
  accountId: hex(1),
  siteId: hex(2),
  runId: hex(9),
  reservationKey: 'inv_reservation_key-1',
};
const internalLinkPayload = {
  accountId: hex(1),
  siteId: hex(2),
  runId: hex(10),
};
const competitorContentPayload = {
  accountId: hex(1),
  siteId: hex(2),
  runId: hex(11),
  reservationKey: 'competitor_reservation_key-1',
};
const contentMonitorPayload = {
  accountId: hex(1),
  siteId: hex(2),
  monitorId: hex(12),
  receiptId: hex(13),
};
const backlinkDeepPayload = {
  accountId: hex(1),
  siteId: hex(2),
  runId: hex(14),
  operation: 'deep_pull' as const,
};
const trafficSnapshotPayload = { accountId: hex(1), runId: hex(15) };
const reviewSyncPayload = {
  accountId: hex(1),
  siteId: hex(2),
  runId: hex(16),
  outputLocale: 'en' as const,
};
const brandRadarPayload = {
  accountId: hex(1),
  siteId: hex(2),
  scanId: hex(17),
  outputLocale: 'en' as const,
};
const clientReportPayload = {
  accountId: hex(1),
  siteId: hex(2),
  scheduleId: '00000000-0000-4000-8000-000000000011',
  runKey: '2026-08-04T10_00_00Z',
  scheduledFor: '2026-08-04T10:00:00.000Z',
};
const appSeoTrackingPayload = {
  accountId: hex(1),
  siteId: hex(2),
  profileId: hex(18),
  keywordId: '00000000-0000-4000-8000-000000000019',
  reservationStamp: '2026-W32',
  manual: false,
};
const appSeoListingPayload = {
  accountId: hex(1),
  siteId: hex(2),
  profileId: hex(18),
  runId: '00000000-0000-4000-8000-000000000020',
  capturedAt: '2026-08-10T00:00:00.000Z',
  locationCode: 2840,
  languageCode: 'en',
};
const appSeoChartPayload = {
  accountId: hex(1),
  siteId: hex(2),
  profileId: hex(18),
  subscriptionId: hex(21),
  reservationStamp: '2026-W32',
  manual: true,
};
const appSeoReviewPayload = {
  accountId: hex(1),
  siteId: hex(2),
  profileId: hex(18),
  runId: hex(22),
};
const keywordClusterPayload = { accountId: hex(1), siteId: hex(2), runId: hex(23) };
const competitorLandscapePayload = { runId: hex(24) };
const weeklyPulsePayload = { accountId: hex(1), siteId: hex(2), isoWeek: '2026-W32' };
const alertDispatchPayload = {
  accountId: hex(1),
  siteId: hex(2),
  ruleId: '00000000-0000-4000-8000-000000000025',
  transitionId: 'transition-1',
  evidence: { before: 1, after: 2 },
};
const contentBriefPayload = { accountId: hex(1), siteId: hex(2), briefId: hex(26) };
const geogridPayload = {
  accountId: hex(1),
  siteId: hex(2),
  scanId: '00000000-0000-4000-8000-000000000027',
};

let connection: Redis;
let queues: Queues;

beforeAll(() => {
  connection = createTestQueueConnection();
});

afterAll(async () => {
  await connection.quit();
});

beforeEach(async () => {
  await flushTestRedis(connection);
  queues = createQueues(connection);
});

describe('createQueues', () => {
  it('creates the queues with the spec default job options', () => {
    expect(queues.audits.name).toBe(AUDITS_QUEUE);
    expect(queues.ranks.name).toBe(RANKS_QUEUE);
    expect(queues.accountPurge.name).toBe(ACCOUNT_PURGE_QUEUE);
    expect(queues.backlinkDeep.name).toBe(BACKLINK_DEEP_QUEUE);
    expect(queues.trafficSnapshots.name).toBe(TRAFFIC_SNAPSHOTS_QUEUE);
    expect(queues.reviewSync.name).toBe(REVIEW_SYNC_QUEUE);
    expect(queues.brandRadar.name).toBe(BRAND_RADAR_QUEUE);
    expect(queues.gscSync.name).toBe(GSC_SYNC_QUEUE);
    expect(queues.ga4Sync.name).toBe(GA4_SYNC_QUEUE);
    expect(queues.audienceResearch.name).toBe(AUDIENCE_RESEARCH_QUEUE);
    expect(queues.contentInventory.name).toBe(CONTENT_INVENTORY_QUEUE);
    expect(queues.contentInventory.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
    expect(queues.internalLinks.name).toBe(INTERNAL_LINKS_QUEUE);
    expect(queues.internalLinks.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
    expect(queues.competitorContent.name).toBe(COMPETITOR_CONTENT_QUEUE);
    expect(queues.competitorContent.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
    expect(queues.contentMonitor.name).toBe(CONTENT_MONITOR_QUEUE);
    expect(queues.contentMonitor.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
    expect(queues.clientReports.name).toBe(CLIENT_REPORTS_QUEUE);
    expect(queues.clientReports.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
    expect(queues.deadLetter.name).toBe(DEAD_LETTER_QUEUE);
    expect(DEFAULT_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 5000 },
    });
    expect(queues.audits.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
    expect(queues.ranks.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
    expect(queues.accountPurge.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
    expect(queues.backlinkDeep.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
    expect(queues.trafficSnapshots.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
    expect(queues.reviewSync.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
    expect(queues.gscSync.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
    expect(queues.ga4Sync.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
    expect(queues.audienceResearch.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
  });

  it('honors the defaultJobOptions test seam', async () => {
    const custom = createQueues(connection, { defaultJobOptions: { attempts: 1 } });
    const job = await enqueueAuditJob(custom.audits, auditPayload);
    expect(job.opts.attempts).toBe(1);
    await custom.close();
  });

  it('close() closes all queues', async () => {
    const spies = [
      vi.spyOn(queues.audits, 'close'),
      vi.spyOn(queues.ranks, 'close'),
      vi.spyOn(queues.accountPurge, 'close'),
      vi.spyOn(queues.backlinkDeep, 'close'),
      vi.spyOn(queues.trafficSnapshots, 'close'),
      vi.spyOn(queues.reviewSync, 'close'),
      vi.spyOn(queues.gscSync, 'close'),
      vi.spyOn(queues.ga4Sync, 'close'),
      vi.spyOn(queues.audienceResearch, 'close'),
      vi.spyOn(queues.contentInventory, 'close'),
      vi.spyOn(queues.internalLinks, 'close'),
      vi.spyOn(queues.competitorContent, 'close'),
      vi.spyOn(queues.deadLetter, 'close'),
    ];
    await queues.close();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('jobId helpers', () => {
  it('derives deterministic ids', () => {
    expect(auditJobId('abc')).toBe('audit-abc');
    expect(auditSummaryJobId('fr', 'abc')).toBe('audit-summary-fr-abc');
    expect(rankJobId('site1', '2026-W27')).toBe('rank-site1-2026-W27');
    expect(accountPurgeJobId('abc')).toBe('account-purge-abc');
    expect(backlinkDeepJobId('abc')).toBe('backlink-deep-abc');
    expect(trafficSnapshotJobId('abc')).toBe('traffic-snapshot-abc');
    expect(reviewSyncJobId('abc')).toBe('review-sync-abc');
    expect(brandRadarScanJobId('abc')).toBe('brand-radar-abc');
    expect(keywordClusterJobId('abc')).toBe('keyword-clustering-abc');
    expect(competitorLandscapeJobId('abc')).toBe('competitor-landscape-abc');
    expect(weeklyPulseJobId('site1', '2026-W32')).toBe('weekly-pulse-site1-2026-W32');
    expect(contentBriefJobId('abc')).toBe('content-brief-abc');
    expect(geogridScanJobId('abc')).toBe('geogrid-scan-abc');
    expect(appSeoTrackingJobId('keyword', '2026-W32')).toBe(
      'app-seo-keyword-keyword-2026-W32',
    );
    expect(appSeoListingJobId('abc')).toBe('app-seo-listing-abc');
    expect(appSeoChartJobId('subscription', '2026-W32')).toBe(
      'app-seo-chart-subscription-2026-W32',
    );
    expect(appSeoReviewJobId('abc')).toBe('app-seo-review-abc');
    expect(alertDispatchJobId('rule', 'transition')).toMatch(
      /^alert-dispatch-rule-[0-9a-f]{16}$/,
    );
    expect(gscSyncJobId('site1', '2026-07-02')).toBe('gsc-sync-site1-2026-07-02');
    expect(ga4SyncJobId('site1', '2026-07-02')).toBe('ga4-sync-site1-2026-07-02');
    expect(audienceResearchJobId('abc')).toBe('audience-research-abc');
    expect(contentAnalysisJobId('abc')).toBe('content-analysis-abc');
    expect(contentInventoryJobId('abc')).toBe('content-inventory-abc');
    expect(internalLinkJobId('abc')).toBe('internal-links-abc');
    expect(competitorContentJobId('abc')).toBe('competitor-content-abc');
    expect(clientReportJobId('schedule', 'run')).toBe('client-report-schedule-run');
  });

  it('rankPeriodKey — daily uses the UTC date', () => {
    expect(rankPeriodKey('daily', new Date('2026-07-02T23:59:59Z'))).toBe('2026-07-02');
  });

  it('rankPeriodKey — weekly uses the ISO week', () => {
    expect(rankPeriodKey('weekly', new Date('2026-07-02T00:00:00Z'))).toBe('2026-W27');
    // ISO edge: 2027-01-01 (a Friday) belongs to 2026-W53.
    expect(rankPeriodKey('weekly', new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
    // ISO edge: 2024-12-30 (a Monday) belongs to 2025-W01.
    expect(rankPeriodKey('weekly', new Date('2024-12-30T00:00:00Z'))).toBe('2025-W01');
    // Sunday is ISO day 7, still the same week as the preceding Monday.
    expect(rankPeriodKey('weekly', new Date('2026-07-05T00:00:00Z'))).toBe('2026-W27');
  });
});

describe('new feature job producers', () => {
  it('validates and enqueues every deterministic feature job with and without options', async () => {
    const cases = [
      {
        expectedName: APP_SEO_TRACKING_JOB_NAME,
        enqueueDefault: () => enqueueAppSeoTrackingJob(queues.appSeoTracking, appSeoTrackingPayload),
        enqueueWithOptions: () => enqueueAppSeoTrackingJob(queues.appSeoTracking, { ...appSeoTrackingPayload, keywordId: '00000000-0000-4000-8000-000000000119' }, { priority: 2 }),
      },
      {
        expectedName: APP_SEO_LISTING_JOB_NAME,
        enqueueDefault: () => enqueueAppSeoListingJob(queues.appSeoTracking, appSeoListingPayload),
        enqueueWithOptions: () => enqueueAppSeoListingJob(queues.appSeoTracking, { ...appSeoListingPayload, runId: '00000000-0000-4000-8000-000000000120' }, { priority: 2 }),
      },
      {
        expectedName: APP_SEO_CHART_JOB_NAME,
        enqueueDefault: () => enqueueAppSeoChartJob(queues.appSeoTracking, appSeoChartPayload),
        enqueueWithOptions: () => enqueueAppSeoChartJob(queues.appSeoTracking, { ...appSeoChartPayload, subscriptionId: hex(121) }, { priority: 2 }),
      },
      {
        expectedName: APP_SEO_REVIEW_JOB_NAME,
        enqueueDefault: () => enqueueAppSeoReviewJob(queues.appSeoTracking, appSeoReviewPayload),
        enqueueWithOptions: () => enqueueAppSeoReviewJob(queues.appSeoTracking, { ...appSeoReviewPayload, runId: hex(122) }, { priority: 2 }),
      },
      {
        expectedName: KEYWORD_CLUSTERING_JOB_NAME,
        enqueueDefault: () => enqueueKeywordClusterJob(queues.keywordClusters, keywordClusterPayload),
        enqueueWithOptions: () => enqueueKeywordClusterJob(queues.keywordClusters, { ...keywordClusterPayload, runId: hex(123) }, { priority: 2 }),
      },
      {
        expectedName: COMPETITOR_LANDSCAPE_JOB_NAME,
        enqueueDefault: () => enqueueCompetitorLandscapeJob(queues.competitorLandscapes, competitorLandscapePayload),
        enqueueWithOptions: () => enqueueCompetitorLandscapeJob(queues.competitorLandscapes, { runId: hex(124) }, { priority: 2 }),
      },
      {
        expectedName: WEEKLY_PULSE_JOB_NAME,
        enqueueDefault: () => enqueueWeeklyPulseJob(queues.weeklyPulse, weeklyPulsePayload),
        enqueueWithOptions: () => enqueueWeeklyPulseJob(queues.weeklyPulse, { ...weeklyPulsePayload, isoWeek: '2026-W33' }, { priority: 2 }),
      },
      {
        expectedName: ALERT_DISPATCH_JOB_NAME,
        enqueueDefault: () => enqueueAlertDispatchJob(queues.alertDispatch, alertDispatchPayload),
        enqueueWithOptions: () => enqueueAlertDispatchJob(queues.alertDispatch, { ...alertDispatchPayload, transitionId: 'transition-2' }, { priority: 2 }),
      },
      {
        expectedName: CONTENT_BRIEF_JOB_NAME,
        enqueueDefault: () => enqueueContentBriefJob(queues.contentBrief, contentBriefPayload),
        enqueueWithOptions: () => enqueueContentBriefJob(queues.contentBrief, { ...contentBriefPayload, briefId: hex(126) }, { priority: 2 }),
      },
      {
        expectedName: GEOGRID_SCAN_JOB_NAME,
        enqueueDefault: () => enqueueGeogridScanJob(queues.geogrid, geogridPayload),
        enqueueWithOptions: () => enqueueGeogridScanJob(queues.geogrid, { ...geogridPayload, scanId: '00000000-0000-4000-8000-000000000127' }, { priority: 2 }),
      },
    ] as const;

    for (const testCase of cases) {
      const first = await testCase.enqueueDefault();
      expect(first.name).toBe(testCase.expectedName);
      const second = await testCase.enqueueWithOptions();
      expect(second.opts.priority).toBe(2);
    }
  });
});

describe('enqueue helpers', () => {
  it('enqueues and deduplicates a strict content-analysis job', async () => {
    const first = await enqueueContentAnalysisJob(
      queues.contentAnalysis,
      contentAnalysisPayload,
      { attempts: 2, jobId: 'ignored' },
    );
    expect(first.id).toBe(`content-analysis-${contentAnalysisPayload.analysisId}`);
    expect(first.name).toBe(CONTENT_ANALYSIS_JOB_NAME);
    expect(first.data).toEqual(contentAnalysisPayload);
    expect(first.opts.attempts).toBe(2);

    await enqueueContentAnalysisJob(queues.contentAnalysis, contentAnalysisPayload);
    expect(await queues.contentAnalysis.count()).toBe(1);
    await expect(
      enqueueContentAnalysisJob(queues.contentAnalysis, {
        ...contentAnalysisPayload,
        analysisId: 'bad',
      }),
    ).rejects.toThrow(ZodError);
  });

  it('enqueues and deduplicates a strict scheduled client-report job', async () => {
    const job = await enqueueClientReportJob(queues.clientReports, clientReportPayload);
    expect(job.id).toBe(
      clientReportJobId(clientReportPayload.scheduleId, clientReportPayload.runKey),
    );
    expect(job.name).toBe(CLIENT_REPORT_JOB_NAME);
    expect(job.data).toEqual(clientReportPayload);
    expect(job.opts.attempts).toBe(3);
    await enqueueClientReportJob(queues.clientReports, clientReportPayload);
    expect(await queues.clientReports.count()).toBe(1);
    await expect(
      enqueueClientReportJob(queues.clientReports, {
        ...clientReportPayload,
        runKey: 'contains:colon',
      }),
    ).rejects.toThrow(ZodError);
  });

  it('enqueues and deduplicates a strict internal-links job', async () => {
    const job = await enqueueInternalLinkJob(
      queues.internalLinks,
      internalLinkPayload,
      { attempts: 2, jobId: 'ignored' },
    );
    expect(job.id).toBe(`internal-links-${internalLinkPayload.runId}`);
    expect(job.name).toBe(INTERNAL_LINKS_JOB_NAME);
    expect(job.data).toEqual(internalLinkPayload);
    expect(job.opts.attempts).toBe(2);
    await enqueueInternalLinkJob(queues.internalLinks, internalLinkPayload);
    expect(await queues.internalLinks.count()).toBe(1);
    await expect(
      enqueueInternalLinkJob(queues.internalLinks, {
        ...internalLinkPayload,
        runId: 'bad',
      }),
    ).rejects.toThrow(ZodError);
  });

  it('enqueues and deduplicates a strict Traffic Insights snapshot job', async () => {
    const job = await enqueueTrafficSnapshotJob(
      queues.trafficSnapshots,
      trafficSnapshotPayload,
      { attempts: 4, jobId: 'ignored' },
    );
    expect(job.id).toBe(`traffic-snapshot-${trafficSnapshotPayload.runId}`);
    expect(job.name).toBe(TRAFFIC_SNAPSHOT_JOB_NAME);
    expect(job.data).toEqual(trafficSnapshotPayload);
    expect(job.opts.attempts).toBe(4);
    await enqueueTrafficSnapshotJob(queues.trafficSnapshots, trafficSnapshotPayload);
    expect(await queues.trafficSnapshots.count()).toBe(1);
    await expect(
      enqueueTrafficSnapshotJob(queues.trafficSnapshots, {
        ...trafficSnapshotPayload,
        runId: 'bad',
      }),
    ).rejects.toThrow(ZodError);
  });

  it('enqueues and deduplicates a strict Review Intelligence sync job', async () => {
    const job = await enqueueReviewSyncJob(queues.reviewSync, reviewSyncPayload, {
      attempts: 2,
      jobId: 'ignored',
    });
    expect(job.id).toBe(`review-sync-${reviewSyncPayload.runId}`);
    expect(job.name).toBe(REVIEW_SYNC_JOB_NAME);
    expect(job.data).toEqual(reviewSyncPayload);
    expect(job.opts.attempts).toBe(2);
    await enqueueReviewSyncJob(queues.reviewSync, reviewSyncPayload);
    expect(await queues.reviewSync.count()).toBe(1);
    await expect(
      enqueueReviewSyncJob(queues.reviewSync, { ...reviewSyncPayload, runId: 'bad' }),
    ).rejects.toThrow(ZodError);
  });

  it('enqueues and deduplicates a strict Brand Radar scan job', async () => {
    const job = await enqueueBrandRadarScanJob(queues.brandRadar, brandRadarPayload, {
      attempts: 2,
      jobId: 'ignored',
    });
    expect(job.id).toBe(`brand-radar-${brandRadarPayload.scanId}`);
    expect(job.name).toBe(BRAND_RADAR_SCAN_JOB_NAME);
    expect(job.data).toEqual(brandRadarPayload);
    expect(job.opts.attempts).toBe(2);
    await enqueueBrandRadarScanJob(queues.brandRadar, brandRadarPayload);
    expect(await queues.brandRadar.count()).toBe(1);
    await expect(
      enqueueBrandRadarScanJob(queues.brandRadar, { ...brandRadarPayload, scanId: 'bad' }),
    ).rejects.toThrow(ZodError);
  });

  it('enqueues and deduplicates a strict Link Intelligence deep job', async () => {
    const job = await enqueueBacklinkDeepJob(queues.backlinkDeep, backlinkDeepPayload, {
      attempts: 5,
      jobId: 'ignored',
    });
    expect(job.id).toBe(`backlink-deep-${backlinkDeepPayload.runId}`);
    expect(job.name).toBe(BACKLINK_DEEP_JOB_NAME);
    expect(job.data).toEqual(backlinkDeepPayload);
    expect(job.opts.attempts).toBe(5);
    await enqueueBacklinkDeepJob(queues.backlinkDeep, backlinkDeepPayload);
    expect(await queues.backlinkDeep.count()).toBe(1);
    await expect(
      enqueueBacklinkDeepJob(queues.backlinkDeep, { ...backlinkDeepPayload, runId: 'bad' }),
    ).rejects.toThrow(ZodError);
  });

  it('enqueues a validated audit job under audit:<runId>', async () => {
    const job = await enqueueAuditJob(queues.audits, auditPayload);
    expect(job.id).toBe(`audit-${auditPayload.runId}`);
    expect(job.name).toBe(AUDIT_JOB_NAME);
    expect(job.data).toEqual(auditPayload);
    expect(job.opts.attempts).toBe(3);
  });

  it('enqueues summary work once under its generation id', async () => {
    const job = await enqueueAuditSummaryJob(queues.audits, auditSummaryPayload, {
      attempts: 9,
      jobId: 'ignored',
    });
    expect(job.id).toBe(
      `audit-summary-${auditSummaryPayload.locale}-${auditSummaryPayload.generationId}`,
    );
    expect(job.name).toBe(AUDIT_SUMMARY_JOB_NAME);
    expect(job.data).toEqual(auditSummaryPayload);
    expect(job.opts.attempts).toBe(1);
    await enqueueAuditSummaryJob(queues.audits, auditSummaryPayload);
    expect(await queues.audits.count()).toBe(1);
  });

  it('enqueues a validated rank job under rank:<siteId>:<periodKey>', async () => {
    const job = await enqueueRankJob(queues.ranks, rankPayload, '2026-W27');
    expect(job.id).toBe(`rank-${rankPayload.siteId}-2026-W27`);
    expect(job.name).toBe(RANK_JOB_NAME);
    expect(job.data).toEqual(rankPayload);
  });

  it('enqueueAccountPurgeJob sets jobId account-purge-<userId> and delay = purgeAt - now', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const purgeAt = new Date('2026-01-01T01:30:00Z');
    const job = await enqueueAccountPurgeJob(
      queues.accountPurge,
      accountPurgePayload,
      purgeAt,
      now,
    );
    expect(job.id).toBe(`account-purge-${accountPurgePayload.userId}`);
    expect(job.name).toBe(ACCOUNT_PURGE_JOB_NAME);
    expect(job.data).toEqual(accountPurgePayload);
    expect(job.opts.delay).toBe(90 * 60 * 1000);
    expect(job.opts.attempts).toBe(3);
    expect(job.opts.removeOnComplete).toBe(true);
  });

  it('delay floors at 0 for past purgeAt', async () => {
    const job = await enqueueAccountPurgeJob(
      queues.accountPurge,
      accountPurgePayload,
      new Date('2025-12-31T23:59:00Z'),
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(job.opts.delay).toBe(0);
  });

  it('rejects malformed payloads at enqueue — nothing reaches Redis', async () => {
    await expect(
      enqueueAuditJob(queues.audits, { ...auditPayload, pageCap: -1 }),
    ).rejects.toThrow(ZodError);
    await expect(
      enqueueAuditSummaryJob(queues.audits, { ...auditSummaryPayload, locale: 'xx' } as never),
    ).rejects.toThrow(ZodError);
    await expect(
      enqueueRankJob(queues.ranks, { ...rankPayload, accountId: 'evil' }, '2026-W27'),
    ).rejects.toThrow(ZodError);
    await expect(
      enqueueAccountPurgeJob(queues.accountPurge, { userId: 'evil' }, new Date()),
    ).rejects.toThrow(ZodError);
    expect(await queues.audits.count()).toBe(0);
    expect(await queues.ranks.count()).toBe(0);
    expect(await queues.accountPurge.count()).toBe(0);
  });

  it('double-enqueue with the same jobId dedupes to one job', async () => {
    await enqueueAuditJob(queues.audits, auditPayload);
    await enqueueAuditJob(queues.audits, auditPayload);
    expect(await queues.audits.count()).toBe(1);

    await enqueueRankJob(queues.ranks, rankPayload, '2026-W27');
    await enqueueRankJob(queues.ranks, rankPayload, '2026-W27');
    expect(await queues.ranks.count()).toBe(1);
    // A new period is new work.
    await enqueueRankJob(queues.ranks, rankPayload, '2026-W28');
    expect(await queues.ranks.count()).toBe(2);
  });

  it('double enqueue dedupes on the deterministic jobId', async () => {
    const purgeAt = new Date('2026-01-01T01:00:00Z');
    const now = new Date('2026-01-01T00:00:00Z');
    await enqueueAccountPurgeJob(queues.accountPurge, accountPurgePayload, purgeAt, now);
    await enqueueAccountPurgeJob(queues.accountPurge, accountPurgePayload, purgeAt, now);
    expect(await queues.accountPurge.count()).toBe(1);
  });

  it('merges caller opts without losing the deterministic jobId', async () => {
    const job = await enqueueAuditJob(queues.audits, auditPayload, {
      attempts: 5,
      jobId: 'attempted-override',
    });
    expect(job.id).toBe(`audit-${auditPayload.runId}`);
    expect(job.opts.attempts).toBe(5);
  });

  it('enqueues a validated gsc-sync job under gsc-sync-<siteId>-<day>', async () => {
    const job = await enqueueGscSyncJob(queues.gscSync, gscSyncPayload, '2026-07-02');
    expect(job.id).toBe(`gsc-sync-${gscSyncPayload.siteId}-2026-07-02`);
    expect(job.name).toBe(GSC_SYNC_JOB_NAME);
    expect(job.data).toEqual(gscSyncPayload);
    expect(job.opts.attempts).toBe(3);
  });

  it('gsc-sync double-enqueue on one day dedupes; a new day is new work', async () => {
    await enqueueGscSyncJob(queues.gscSync, gscSyncPayload, '2026-07-02');
    await enqueueGscSyncJob(queues.gscSync, gscSyncPayload, '2026-07-02');
    expect(await queues.gscSync.count()).toBe(1);
    await enqueueGscSyncJob(queues.gscSync, gscSyncPayload, '2026-07-03');
    expect(await queues.gscSync.count()).toBe(2);
  });

  it('enqueues a validated ga4-sync job under ga4-sync-<siteId>-<day>; dedupes per day', async () => {
    const job = await enqueueGa4SyncJob(queues.ga4Sync, ga4SyncPayload, '2026-07-02');
    expect(job.id).toBe(`ga4-sync-${ga4SyncPayload.siteId}-2026-07-02`);
    expect(job.name).toBe(GA4_SYNC_JOB_NAME);
    expect(job.data).toEqual(ga4SyncPayload);
    await enqueueGa4SyncJob(queues.ga4Sync, ga4SyncPayload, '2026-07-02');
    expect(await queues.ga4Sync.count()).toBe(1);
    await enqueueGa4SyncJob(queues.ga4Sync, ga4SyncPayload, '2026-07-03');
    expect(await queues.ga4Sync.count()).toBe(2);
  });

  it('ga4-sync rejects a malformed payload at enqueue (strict schema)', async () => {
    await expect(
      enqueueGa4SyncJob(
        queues.ga4Sync,
        { ...ga4SyncPayload, domain: 'nope.example' } as never,
        '2026-07-02',
      ),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      enqueueGa4SyncJob(queues.ga4Sync, { accountId: 'short' } as never, '2026-07-02'),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('enqueueGscSyncJob merges caller opts without losing the deterministic jobId', async () => {
    const job = await enqueueGscSyncJob(queues.gscSync, gscSyncPayload, '2026-07-02', {
      attempts: 7,
      jobId: 'attempted-override',
    });
    expect(job.id).toBe(`gsc-sync-${gscSyncPayload.siteId}-2026-07-02`);
    expect(job.opts.attempts).toBe(7);
  });

  it('rejects a malformed gsc-sync payload at enqueue — nothing reaches Redis', async () => {
    await expect(
      enqueueGscSyncJob(queues.gscSync, { ...gscSyncPayload, accountId: 'evil' }, '2026-07-02'),
    ).rejects.toThrow(ZodError);
    expect(await queues.gscSync.count()).toBe(0);
  });

  it('enqueues a validated audience-research job under audience-research-<runId>', async () => {
    const job = await enqueueAudienceResearchJob(
      queues.audienceResearch,
      audienceResearchPayload,
    );
    expect(job.id).toBe(`audience-research-${audienceResearchPayload.runId}`);
    expect(job.name).toBe(AUDIENCE_RESEARCH_JOB_NAME);
    expect(job.data).toEqual(audienceResearchPayload);
    expect(job.opts.attempts).toBe(3);
  });

  it('audience-research double-enqueue dedupes on the deterministic jobId', async () => {
    await enqueueAudienceResearchJob(queues.audienceResearch, audienceResearchPayload);
    await enqueueAudienceResearchJob(queues.audienceResearch, audienceResearchPayload);
    expect(await queues.audienceResearch.count()).toBe(1);
    await enqueueAudienceResearchJob(queues.audienceResearch, {
      ...audienceResearchPayload,
      runId: hex(8),
    });
    expect(await queues.audienceResearch.count()).toBe(2);
  });

  it('audience-research merges caller opts without losing the deterministic jobId', async () => {
    const job = await enqueueAudienceResearchJob(
      queues.audienceResearch,
      audienceResearchPayload,
      { attempts: 5, jobId: 'attempted-override' },
    );
    expect(job.id).toBe(`audience-research-${audienceResearchPayload.runId}`);
    expect(job.opts.attempts).toBe(5);
  });

  it('rejects a malformed audience-research payload at enqueue — nothing reaches Redis', async () => {
    await expect(
      enqueueAudienceResearchJob(queues.audienceResearch, {
        ...audienceResearchPayload,
        runId: 'not-hex',
      }),
    ).rejects.toThrow(ZodError);
    await expect(
      enqueueAudienceResearchJob(queues.audienceResearch, {
        ...audienceResearchPayload,
        extra: 'no-additional-fields',
      } as never),
    ).rejects.toThrow(ZodError);
    expect(await queues.audienceResearch.count()).toBe(0);
  });

  it('enqueues a validated content-inventory job under content-inventory-<runId>', async () => {
    const job = await enqueueContentInventoryJob(
      queues.contentInventory,
      contentInventoryPayload,
    );
    expect(job.id).toBe(`content-inventory-${contentInventoryPayload.runId}`);
    expect(job.name).toBe(CONTENT_INVENTORY_JOB_NAME);
    expect(job.data).toEqual(contentInventoryPayload);
    expect(job.opts.attempts).toBe(3);
  });

  it('content-inventory double-enqueue dedupes on the deterministic jobId', async () => {
    await enqueueContentInventoryJob(queues.contentInventory, contentInventoryPayload);
    await enqueueContentInventoryJob(queues.contentInventory, contentInventoryPayload);
    expect(await queues.contentInventory.count()).toBe(1);
    await enqueueContentInventoryJob(queues.contentInventory, {
      ...contentInventoryPayload,
      runId: hex(10),
    });
    expect(await queues.contentInventory.count()).toBe(2);
  });

  it('content-inventory merges caller opts without losing the deterministic jobId', async () => {
    const job = await enqueueContentInventoryJob(
      queues.contentInventory,
      contentInventoryPayload,
      { attempts: 5, jobId: 'attempted-override' },
    );
    expect(job.id).toBe(`content-inventory-${contentInventoryPayload.runId}`);
    expect(job.opts.attempts).toBe(5);
  });

  it('rejects a malformed content-inventory payload at enqueue — nothing reaches Redis', async () => {
    await expect(
      enqueueContentInventoryJob(queues.contentInventory, {
        ...contentInventoryPayload,
        reservationKey: 'has spaces',
      }),
    ).rejects.toThrow(ZodError);
    expect(await queues.contentInventory.count()).toBe(0);
  });

  it('enqueues a validated competitor-content job under competitor-content-<runId>', async () => {
    const job = await enqueueCompetitorContentJob(
      queues.competitorContent,
      competitorContentPayload,
      { attempts: 4, jobId: 'ignored-override' },
    );
    expect(job.id).toBe(`competitor-content-${competitorContentPayload.runId}`);
    expect(job.name).toBe(COMPETITOR_CONTENT_JOB_NAME);
    expect(job.data).toEqual(competitorContentPayload);
    expect(job.opts.attempts).toBe(4);
  });

  it('competitor-content double-enqueue dedupes on the deterministic jobId', async () => {
    await enqueueCompetitorContentJob(queues.competitorContent, competitorContentPayload);
    await enqueueCompetitorContentJob(queues.competitorContent, competitorContentPayload);
    expect(await queues.competitorContent.count()).toBe(1);
  });

  it('rejects a malformed competitor-content payload at enqueue — nothing reaches Redis', async () => {
    await expect(
      enqueueCompetitorContentJob(queues.competitorContent, {
        ...competitorContentPayload,
        reservationKey: 'has spaces',
      }),
    ).rejects.toThrow(ZodError);
    expect(await queues.competitorContent.count()).toBe(0);
  });

  it('enqueues a validated content-monitor job under content-monitor-<receiptId>', async () => {
    const job = await enqueueContentMonitorJob(
      queues.contentMonitor,
      contentMonitorPayload,
      { attempts: 2, jobId: 'ignored-override' },
    );
    expect(job.id).toBe(contentMonitorJobId(contentMonitorPayload.receiptId));
    expect(job.id).toBe(`content-monitor-${contentMonitorPayload.receiptId}`);
    expect(job.name).toBe(CONTENT_MONITOR_JOB_NAME);
    expect(job.data).toEqual(contentMonitorPayload);
    expect(job.opts.attempts).toBe(2);
  });

  it('content-monitor double-enqueue dedupes on the deterministic jobId', async () => {
    await enqueueContentMonitorJob(queues.contentMonitor, contentMonitorPayload);
    await enqueueContentMonitorJob(queues.contentMonitor, contentMonitorPayload);
    expect(await queues.contentMonitor.count()).toBe(1);
  });

  it('rejects a malformed content-monitor payload at enqueue — nothing reaches Redis', async () => {
    await expect(
      enqueueContentMonitorJob(queues.contentMonitor, {
        ...contentMonitorPayload,
        receiptId: 'not-hex',
      }),
    ).rejects.toThrow(ZodError);
    expect(await queues.contentMonitor.count()).toBe(0);
  });
});
