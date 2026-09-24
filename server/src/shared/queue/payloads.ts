/**
 * Typed, zod-validated job payloads.
 *
 * The queue is a trust boundary between the two deployables (api enqueues,
 * worker consumes), so payloads are validated on BOTH sides: `parsePayload`
 * at enqueue (shared/queue/queues.ts) rejects bad data before it ever hits
 * Redis, and `parseConsumedPayload` at the processor rejects anything that
 * arrives malformed anyway (crafted directly, produced by an older build,
 * …) as an UnrecoverableError — the job fails without retries and without
 * crashing the worker process.
 *
 * Payloads carry only ids + validated scalars — never secrets, never raw
 * vendor responses — and always include `accountId` so every downstream
 * read stays account-scoped.
 */
import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../i18n/locales.js';
/** Better Auth ids are ObjectId-compatible 24-char hex (see modules/auth). */
const objectIdHex = z.string().regex(/^[0-9a-f]{24}$/, 'must be a 24-char hex id');
export const auditJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    runId: objectIdHex,
    pageCap: z.number().int().positive().max(10000),
})
    .strict();
export type AuditJob = z.infer<typeof auditJobSchema>;
export const auditSummaryJobSchema = z
    .object({
    accountId: objectIdHex,
    runId: objectIdHex,
    generationId: objectIdHex,
    locale: z.enum(SUPPORTED_LOCALES),
})
    .strict();
export type AuditSummaryJob = z.infer<typeof auditSummaryJobSchema>;
/**
 * Consumer-only rolling-deploy parser. Producers must use the strict schema
 * above; the optional locale exists solely so the audit worker can inspect
 * and safely compensate a persisted pre-locale payload.
 */
export const legacyAuditSummaryJobSchema = z
    .object({
    accountId: objectIdHex,
    runId: objectIdHex,
    generationId: objectIdHex,
    locale: z.enum(SUPPORTED_LOCALES).optional(),
})
    .strict();
export const auditSummaryJobIdentitySchema = z.object({
    accountId: objectIdHex,
    runId: objectIdHex,
    generationId: objectIdHex,
});
export type LegacyAuditSummaryJob = z.infer<typeof legacyAuditSummaryJobSchema>;
export const rankJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    /** Empty means every active site keyword; non-empty narrows to UUID rows. */
    keywordIds: z.array(z.string().uuid()).max(30),
    /** Job-scheduler key that produced this job (`manual` for one-offs). */
    schedulerKey: z.string().min(1),
    /**
     * Snapshot of the alternate-engine producer flag when this job was
     * accepted. Consumers honor the snapshot, not the current environment:
     * a rollback blocks future jobs without discarding already-queued work.
     * Missing is accepted only for jobs persisted before this field shipped
     * and is treated as enabled for backwards-compatible draining.
     */
    altEnginesEnabledAtEnqueue: z.boolean().optional(),
    /**
     * On-demand check (keyword-create first-run or the "Check now" button).
     * Manual jobs stamp `checkedAt` at the exact trigger time instead of the
     * period floor for Google. Alternate engines retain their structural UTC
     * weekly stamp. Absent (undefined) on scheduled cron jobs.
     */
    manual: z.boolean().optional(),
    /**
     * Manual non-Google checks are reserved by the API before enqueue. The
     * worker validates this bounded descriptor, consumes each matching claim
     * once, and retains its legacy worker-side reservation for scheduled jobs.
     */
    altEngineReservation: z
        .object({
        batchKey: z.string().regex(/^manual-\d+(?:-r\d+)?$/).max(80),
        keywordIds: z.array(z.string().uuid()).min(1).max(30),
    })
        .strict()
        .optional(),
    /** Prepaid Google units for one API-triggered keyword check. */
    serpReservation: z
        .object({
        batchKey: z.string().regex(/^manual-\d+(?:-r\d+)?$/).max(80),
        keywordId: z.string().uuid(),
        units: z.number().int().min(1).max(2),
    })
        .strict()
        .optional(),
})
    .strict()
    .superRefine((payload, context) => {
    if (payload.altEngineReservation !== undefined && payload.manual !== true) {
        context.addIssue({
            code: 'custom',
            path: ['altEngineReservation'],
            message: 'altEngineReservation is only valid on manual jobs',
        });
    }
    if (payload.serpReservation !== undefined) {
        if (payload.manual !== true) {
            context.addIssue({
                code: 'custom',
                path: ['serpReservation'],
                message: 'serpReservation is only valid on manual jobs',
            });
        }
        if (payload.keywordIds.length !== 1 ||
            payload.keywordIds[0] !== payload.serpReservation.keywordId) {
            context.addIssue({
                code: 'custom',
                path: ['serpReservation', 'keywordId'],
                message: 'serpReservation must match the single selected keyword',
            });
        }
        if (payload.altEngineReservation !== undefined) {
            context.addIssue({
                code: 'custom',
                path: ['serpReservation'],
                message: 'Google and alternate-engine reservations are mutually exclusive',
            });
        }
    }
});
export type RankJob = z.infer<typeof rankJobSchema>;
/**
 * Weekly ASO keyword observation. Identity only: the worker reloads the
 * tracked phrase, store target, and app-profile store id from owner-scoped
 * storage. `reservationStamp` is an ISO week plus an optional refunded-retry
 * generation and is also the durable spend idempotency stamp; phrases never
 * cross the Redis trust boundary.
 */
export const appSeoTrackingJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    profileId: objectIdHex,
    keywordId: z.string().uuid(),
    reservationStamp: z.string().regex(/^\d{4}-W\d{2}(?:-r\d{6})?$/),
    manual: z.boolean(),
})
    .strict();
export type AppSeoTrackingJob = z.infer<typeof appSeoTrackingJobSchema>;
/** One explicit listing-health run. Listing content never crosses Redis. */
export const appSeoListingJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    profileId: objectIdHex,
    runId: z.string().uuid(),
    capturedAt: z.string().datetime({ offset: true }),
    locationCode: z.number().int().positive(),
    languageCode: z.string().trim().min(2).max(16),
})
    .strict();
export type AppSeoListingJob = z.infer<typeof appSeoListingJobSchema>;
/** Weekly chart position observation; chart/category values reload from Mongo. */
export const appSeoChartJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    profileId: objectIdHex,
    subscriptionId: objectIdHex,
    reservationStamp: z.string().regex(/^\d{4}-W\d{2}$/),
    manual: z.boolean(),
})
    .strict();
export type AppSeoChartJob = z.infer<typeof appSeoChartJobSchema>;
/** One explicit bounded review pull. Review text never crosses Redis. */
export const appSeoReviewJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    profileId: objectIdHex,
    runId: objectIdHex,
})
    .strict();
export type AppSeoReviewJob = z.infer<typeof appSeoReviewJobSchema>;
export const accountPurgeJobSchema = z
    .object({
    userId: objectIdHex,
})
    .strict();
export type AccountPurgeJob = z.infer<typeof accountPurgeJobSchema>;
/**
 * GSC snapshot sync — enqueued on connect, property-change, and by the
 * durable daily producer. Carries the site domain
 * so the consumer can match it to a Search Console property.
 */
export const gscSyncJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    domain: z.string().min(1),
})
    .strict();
export type GscSyncJob = z.infer<typeof gscSyncJobSchema>;
/** Background Site-to-Google resource detection. */
export const googleSiteAutoMatchJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    requestId: z.string().uuid(),
})
    .strict();
export type GoogleSiteAutoMatchJob = z.infer<typeof googleSiteAutoMatchJobSchema>;
/**
 * GA4 snapshot sync — enqueued on connect / GA4-property-change so the
 * ?tab=google analytics card fills in without waiting. No domain: the GA4
 * property is chosen explicitly on the connection record.
 */
export const ga4SyncJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
})
    .strict();
export type Ga4SyncJob = z.infer<typeof ga4SyncJobSchema>;
/**
 * Content Intelligence analysis — enqueued once per paid
 * `content_analyses` reservation. The payload is intentionally minimal:
 * the processor loads the ContentAnalysis document and re-validates state
 * before doing any vendor work, so a stale replay picking up a completed /
 * cancelled analysis is a no-op instead of a double-charge.
 */
export const contentAnalysisJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    analysisId: objectIdHex,
    reservationKey: z
        .string()
        .min(1)
        .max(200)
        .regex(/^[A-Za-z0-9_-]+$/, 'reservationKey must be url-safe base64 characters only'),
})
    .strict();
export type ContentAnalysisJob = z.infer<typeof contentAnalysisJobSchema>;
/**
 * Content inventory + cannibalization — enqueued once per paid
 * `content_inventory_page_blocks` reservation. The payload is intentionally
 * minimal: the processor loads the ContentInventoryRun document and
 * re-validates state before doing any crawl work, so a stale replay picking up
 * a terminal run is a no-op instead of a double-charge.
 */
export const contentInventoryJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    runId: objectIdHex,
    reservationKey: z
        .string()
        .min(1)
        .max(200)
        .regex(/^[A-Za-z0-9_-]+$/, 'reservationKey must be url-safe base64 characters only'),
})
    .strict();
export type ContentInventoryJob = z.infer<typeof contentInventoryJobSchema>;
/**
 * Internal-link suggestion run (community request 07). Identity only: the
 * worker reloads the pinned inventory run and GSC snapshot from the run record.
 */
export const internalLinkJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    runId: objectIdHex,
})
    .strict();
export type InternalLinkJob = z.infer<typeof internalLinkJobSchema>;
/**
 * Keyword clustering by SERP overlap (community request 02). Identity only:
 * the worker reloads the run record for the pinned keyword set and the frozen
 * threshold, then reads the durable `serp_observations` rows. The payload
 * carries no keyword, phrase, or URL.
 */
export const keywordClusterJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    runId: objectIdHex,
})
    .strict();
export type KeywordClusterJob = z.infer<typeof keywordClusterJobSchema>;
/**
 * Competitor content intelligence run — enqueued once per paid
 * `competitor_content_runs` reservation. The payload is intentionally minimal:
 * the processor loads the CompetitorContentRun document and re-validates state
 * before doing any scrape/AI work, so a stale replay picking up a terminal run
 * is a no-op instead of a double-charge.
 */
export const competitorContentJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    runId: objectIdHex,
    reservationKey: z
        .string()
        .min(1)
        .max(200)
        .regex(/^[A-Za-z0-9_-]+$/, 'reservationKey must be url-safe base64 characters only'),
})
    .strict();
export type CompetitorContentJob = z.infer<typeof competitorContentJobSchema>;
/**
 * Public-page change monitoring delivery — enqueued once per verified,
 * deduped webhook delivery (a `MonitorWebhookReceipt` row). The payload is
 * intentionally minimal: the processor loads the receipt + the ContentMonitor
 * and re-validates ownership/config before doing any change detection, so a
 * stale replay consumes the receipt's immutable plan/outbox and never repeats
 * vendor work or a capacity reservation. `receiptId` is the Mongo `_id` of the atomic receipt row —
 * the deterministic job id (`content-monitor-<receiptId>`) makes the enqueue
 * itself idempotent per delivery.
 */
export const contentMonitorJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    monitorId: objectIdHex,
    receiptId: objectIdHex,
})
    .strict();
export type ContentMonitorJob = z.infer<typeof contentMonitorJobSchema>;
/**
 * Audience Research run — enqueued once per paid
 * `audience_research_runs` reservation. The payload is intentionally minimal:
 * the processor loads the AudienceResearchRun document and re-validates state
 * before doing any vendor work, so a stale replay picking up a terminal run is
 * a no-op instead of a double-charge.
 */
export const audienceResearchJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    runId: objectIdHex,
    outputLocale: z.enum(SUPPORTED_LOCALES),
})
    .strict();
export type AudienceResearchJob = z.infer<typeof audienceResearchJobSchema>;
/**
 * Weekly Pulse collection — enqueued by the deterministic
 * `weekly-pulse:<siteId>` upsertJobScheduler once per (site, ISO week).
 * The payload is intentionally minimal: the processor loads the pulse row and
 * runs the full ownership → coverage → capacity → collection life-cycle.
 * A duplicate enqueue for the same `(account, site, iso_week)` collides on the
 * unique `weekly_pulse_runs` index — never a double charge.
 */
export const weeklyPulseJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    /** `YYYY-Www` UTC — see modules/weekly-pulse/schedule.ts → isoWeekUtc. */
    isoWeek: z.string().regex(/^\d{4}-W\d{2}$/, 'must be a YYYY-Www ISO week key'),
})
    .strict();
export type WeeklyPulseJob = z.infer<typeof weeklyPulseJobSchema>;
/**
 * Payload emitted by BullMQ's durable weekly scheduler. The ISO week belongs
 * to the instant the scheduler fires, so it must be derived by the consumer
 * instead of being frozen when the scheduler is installed.
 */
export const weeklyPulseScheduledJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    scheduled: z.literal(true),
})
    .strict();
export type WeeklyPulseScheduledJob = z.infer<typeof weeklyPulseScheduledJobSchema>;
/**
 * Consumer-only schema. The final branch drains scheduler jobs written by
 * releases that used an invalid `isoWeek: "template"` sentinel. Producers
 * continue to use the strict explicit/scheduled schemas above.
 */
export const weeklyPulseConsumedJobSchema = z.union([
    weeklyPulseJobSchema,
    weeklyPulseScheduledJobSchema,
    z
        .object({
        accountId: objectIdHex,
        siteId: objectIdHex,
        isoWeek: z.literal('template'),
    })
        .strict(),
]);
export type WeeklyPulseConsumedJob = z.infer<typeof weeklyPulseConsumedJobSchema>;
/** Stored-only white-label report delivery; the worker reloads every detail. */
export const clientReportJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    scheduleId: z.string().uuid(),
    runKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
    scheduledFor: z.string().datetime({ offset: true }),
})
    .strict();
export type ClientReportJob = z.infer<typeof clientReportJobSchema>;
export const BACKLINK_DEEP_JOB_OPERATIONS = [
    'deep_pull',
    'link_gap',
    'toxicity_review',
] as const;
export type BacklinkDeepJobOperation = (typeof BACKLINK_DEEP_JOB_OPERATIONS)[number];
/** One paid backlink-family operation; the processor reloads all inputs. */
export const backlinkDeepJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    runId: objectIdHex,
    // Optional only for already-enqueued jobs from older builds.
    // Every current producer supplies it; consumers retain legacy discovery.
    operation: z.enum(BACKLINK_DEEP_JOB_OPERATIONS).optional(),
})
    .strict();
export type BacklinkDeepJob = z.infer<typeof backlinkDeepJobSchema>;
/** One paid Traffic Insights snapshot; the processor reloads all inputs. */
export const trafficSnapshotJobSchema = z
    .object({
    accountId: objectIdHex,
    runId: objectIdHex,
})
    .strict();
export type TrafficSnapshotJob = z.infer<typeof trafficSnapshotJobSchema>;
/**
 * One immutable competitor-landscape run. Identity only: the consumer reloads
 * account, site, market, competitors, reservation, and versions from Mongo.
 */
export const competitorLandscapeJobSchema = z
    .object({
    runId: objectIdHex,
})
    .strict();
export type CompetitorLandscapeJob = z.infer<typeof competitorLandscapeJobSchema>;
/**
 * One paid Review Intelligence sync. The processor reloads the
 * requested sources, configured targets, and depth from the run document —
 * the payload carries identity only, so a replayed job can never widen the
 * fan-out beyond what the reserved unit paid for.
 */
export const reviewSyncJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    runId: objectIdHex,
    outputLocale: z.enum(SUPPORTED_LOCALES),
})
    .strict();
export type ReviewSyncJob = z.infer<typeof reviewSyncJobSchema>;
/**
 * One paid Brand Radar scan. The payload carries identity only —
 * the processor reloads the brand query, language, and location from
 * the reserved `BrandRadarScan` document, so a replayed job can never widen
 * the fan-out beyond what the reserved unit paid for.
 */
export const brandRadarScanJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    scanId: objectIdHex,
    outputLocale: z.enum(SUPPORTED_LOCALES),
})
    .strict();
export type BrandRadarScanJob = z.infer<typeof brandRadarScanJobSchema>;
/**
 * One SERP-based content brief. The worker reloads every bounded input from
 * the account-scoped Mongo document; no keyword, URL, or scraped text crosses
 * the Redis trust boundary.
 */
export const contentBriefJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    briefId: objectIdHex,
})
    .strict();
export type ContentBriefJob = z.infer<typeof contentBriefJobSchema>;
/**
 * One geogrid scan. Identity only: the grid
 * definition, the keyword, and the cell derivation all reload from the
 * account-scoped `geogrid_scans` row, so a replayed job can never widen the
 * fan-out beyond the ≤49 cells the reserved unit paid for. `scanId` is a
 * Postgres uuid, not a Mongo ObjectId.
 */
export const geogridScanJobSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    scanId: z.string().uuid(),
})
    .strict();
export type GeogridScanJob = z.infer<typeof geogridScanJobSchema>;
/**
 * Alert dispatch — one job per confirmed
 * transition per rule. The payload carries the FROZEN evidence pair so the
 * processor never recomputes (and so can never invent) an observation, and it
 * is secret-free by construction: channel credentials stay encrypted at rest
 * and are opened only inside the processor.
 *
 * `transitionId` is derived from stored evidence (a confirmation id, or an
 * ordered snapshot-review pair), never from a clock or a counter, so a replay
 * produces the same idempotency keys and the DB claim collapses it.
 */
export const alertDispatchJobSchema = z
    .object({
    accountId: z.string().min(1).max(64),
    siteId: z.string().min(1).max(64),
    ruleId: z.string().uuid(),
    transitionId: z.string().min(1).max(200),
    evidence: z.record(z.string(), z.unknown()),
})
    .strict();
export type AlertDispatchJob = z.infer<typeof alertDispatchJobSchema>;
/** Enqueue-side validation: throws ZodError back at the producer. */
export function parsePayload<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
    return schema.parse(data);
}
/**
 * Consume-side validation: a malformed payload can never become valid on a
 * retry, so wrap the ZodError in BullMQ's UnrecoverableError — the job goes
 * straight to failed (and the dead-letter queue) without burning attempts.
 */
export function parseConsumedPayload<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
    const result = schema.safeParse(data);
    if (!result.success) {
        throw new UnrecoverableError(`malformed job payload: ${result.error.message}`);
    }
    return result.data;
}
