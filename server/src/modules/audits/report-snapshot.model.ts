import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
/**
 * Frozen report output at the moment an audit finished.
 *
 * We snapshot the whole rule-engine output instead of re-running rules on
 * demand: rule copy and thresholds can change between runs, but the report
 * a user got yesterday must not silently retell its story tomorrow. The
 * retest-diff reads two of these documents.
 */
const findingSchema = new mongoose.Schema({
    ruleId: { type: String, required: true },
    bucket: {
        type: String,
        enum: ['fix-now', 'watch', 'passed'],
        required: true,
    },
    severity: {
        type: String,
        enum: ['critical', 'warning', 'info'],
        required: true,
    },
    affectedUrls: { type: [String], default: [] },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });
const countsSchema = new mongoose.Schema({
    fixNow: { type: Number, required: true },
    watch: { type: Number, required: true },
    passed: { type: Number, required: true },
}, { _id: false });
/**
 * Page-speed section. Present only when the PSI+CrUX provider
 * ran; `status: 'unavailable'` marks a failure that did NOT crash the audit
 * — the report renders an inline "unavailable" note rather than empty gauges.
 */
const pageSpeedSampleSchema = new mongoose.Schema({
    url: { type: String, required: true },
    strategy: { type: String, enum: ['mobile', 'desktop'], required: true },
    labScores: {
        type: new mongoose.Schema({
            performance: { type: Number, required: true },
            accessibility: { type: Number, required: true },
            bestPractices: { type: Number, required: true },
            seo: { type: Number, required: true },
        }, { _id: false }),
        required: true,
    },
    coreWebVitals: {
        type: new mongoose.Schema({
            lcpMs: { type: Number, required: true },
            inp: { type: Number, required: true },
            cls: { type: Number, required: true },
            category: {
                type: String,
                enum: ['good', 'needs-improvement', 'poor'],
                required: true,
            },
        }, { _id: false }),
        required: false,
    },
    mobileFriendly: { type: Boolean, required: false },
    fieldDataLevel: {
        type: String,
        enum: ['url', 'origin', 'none'],
        required: true,
    },
}, { _id: false });
const pageSpeedSchema = new mongoose.Schema({
    status: { type: String, enum: ['ok', 'unavailable'], required: true },
    samples: { type: [pageSpeedSampleSchema], default: [] },
}, { _id: false });
/**
 * Index-status section. Per-URL GSC inspection captured as a
 * flat record so the report screen can render each verdict without another
 * vendor round-trip. `status !== 'ok'` degrades to an inline note.
 */
const gscInspectionSchema = new mongoose.Schema({
    indexVerdict: {
        type: String,
        enum: ['PASS', 'PARTIAL', 'FAIL', 'NEUTRAL'],
        required: true,
    },
    coverageState: { type: String, required: true },
    robotsTxtState: { type: String, required: true },
    pageFetchState: { type: String, default: null },
    googleCanonical: { type: String, default: null },
    lastCrawlTime: { type: Date, default: null },
    richResults: {
        type: new mongoose.Schema({
            verdict: {
                type: String,
                enum: ['PASS', 'PARTIAL', 'FAIL', 'NEUTRAL'],
                required: true,
            },
            items: {
                type: [
                    new mongoose.Schema({
                        type: { type: String, required: true },
                        issues: { type: Number, required: true },
                    }, { _id: false }),
                ],
                default: [],
            },
        }, { _id: false }),
        required: true,
    },
}, { _id: false });
const indexStatusSampleSchema = new mongoose.Schema({
    url: { type: String, required: true },
    inspection: { type: gscInspectionSchema, required: true },
}, { _id: false });
const indexStatusSchema = new mongoose.Schema({
    status: {
        type: String,
        enum: ['ok', 'unavailable', 'not-connected', 'needs-reconnect', 'quota-exceeded'],
        required: true,
    },
    samples: { type: [indexStatusSampleSchema], default: [] },
}, { _id: false });
/**
 * Search-analytics section. Pre-aggregated at collection time —
 * the report never recomputes weighted averages, so yesterday's numbers stay
 * frozen with yesterday's snapshot.
 */
const gscSearchTopQuerySchema = new mongoose.Schema({
    query: { type: String, required: true },
    clicks: { type: Number, required: true },
    impressions: { type: Number, required: true },
    ctr: { type: Number, required: true },
    position: { type: Number, required: true },
}, { _id: false });
const gscSearchTopPageSchema = new mongoose.Schema({
    url: { type: String, required: true },
    clicks: { type: Number, required: true },
    impressions: { type: Number, required: true },
    ctr: { type: Number, required: true },
    position: { type: Number, required: true },
}, { _id: false });
const gscSearchSchema = new mongoose.Schema({
    status: {
        type: String,
        enum: ['ok', 'unavailable', 'not-connected', 'needs-reconnect', 'no-data'],
        required: true,
    },
    totalClicks: { type: Number, required: true },
    totalImpressions: { type: Number, required: true },
    averageCtr: { type: Number, required: true },
    averagePosition: { type: Number, required: true },
    topQueries: { type: [gscSearchTopQuerySchema], default: [] },
    topPages: { type: [gscSearchTopPageSchema], default: [] },
    delta: {
        type: new mongoose.Schema({
            clicks: { type: Number, default: null },
            impressions: { type: Number, default: null },
        }, { _id: false }),
        required: true,
    },
}, { _id: false });
/** Sitemaps section. */
const gscSitemapEntrySchema = new mongoose.Schema({
    path: { type: String, required: true },
    errors: { type: Number, required: true },
    warnings: { type: Number, required: true },
    processed: { type: Number, required: true },
    lastDownloaded: { type: Date, default: null },
}, {
    _id: false,
    // `errors` is the upstream Search Console sitemap metric, not Mongoose's
    // document error state. The explicit option documents that intentional
    // collision and prevents noisy warnings in every test and worker boot.
    suppressReservedKeysWarning: true,
});
const gscSitemapsSchema = new mongoose.Schema({
    status: {
        type: String,
        enum: ['ok', 'unavailable', 'not-connected', 'needs-reconnect', 'no-sitemaps'],
        required: true,
    },
    sitemaps: { type: [gscSitemapEntrySchema], default: [] },
}, { _id: false });
const aiVisibilitySchema = new mongoose.Schema({
    status: {
        type: String,
        enum: ['ok', 'unavailable', 'no-prompts-tracked'],
        required: true,
    },
    aiOverviewCitedCount: { type: Number, required: true },
    aiOverviewTotalChecked: { type: Number, required: true },
    llmMentionedCount: { type: Number, required: true },
    llmTotalChecked: { type: Number, required: true },
    shareOfVoicePct: { type: Number, default: null },
    negativeSentimentCount: { type: Number, required: true },
    competitorsPresent: { type: Boolean, required: true },
    sentiment: {
        type: new mongoose.Schema({
            positive: { type: Number, required: true },
            neutral: { type: Number, required: true },
            negative: { type: Number, required: true },
        }, { _id: false }),
        default: null,
    },
    notMentionedPrompts: { type: [String], default: [] },
}, { _id: false });
/**
 * Local SEO section. Present only when a local-seo refresh (or
 * local-pack check) has landed for the site — `null` = pre-feature snapshot
 * or the account never refreshed. The report renders the "connect local
 * data" state when this section is absent, mirroring the ai-visibility
 * degradation contract.
 */
const localSeoListingSchema = new mongoose.Schema({
    source: { type: String, required: true },
    consistent: { type: Boolean, required: true },
}, { _id: false });
const localSeoSchema = new mongoose.Schema({
    status: {
        type: String,
        enum: ['ok', 'unavailable', 'not-configured'],
        required: true,
    },
    listings: { type: [localSeoListingSchema], default: [] },
    reviews: {
        type: new mongoose.Schema({
            averageRating: { type: Number, default: null },
            reviewCount: { type: Number, required: true },
        }, { _id: false }),
        default: null,
    },
    qa: {
        type: new mongoose.Schema({
            unansweredCount: { type: Number, required: true },
        }, { _id: false }),
        default: null,
    },
    localPack: {
        type: new mongoose.Schema({
            keyword: { type: String, required: true },
            position: { type: Number, default: null },
            totalPackSize: { type: Number, required: true },
        }, { _id: false }),
        default: null,
    },
}, { _id: false });
/**
 * Legacy optional AI summary. New code never writes this field;
 * it remains readable only when its stored locale exactly matches the
 * requested locale.
 */
const aiSummarySchema = new mongoose.Schema({
    text: { type: String, required: true },
    locale: { type: String, enum: SUPPORTED_LOCALES, required: true },
    model: { type: String, required: true },
    truncated: { type: Boolean, required: true, default: false },
    createdAt: { type: Date, required: true },
}, { _id: false });
/** Durable API/worker hand-off state for asynchronous summary generation. */
export const AI_SUMMARY_JOB_STATUSES = [
    'queued',
    'running',
    'succeeded',
    'failed',
] as const;
export type AiSummaryJobStatus = (typeof AI_SUMMARY_JOB_STATUSES)[number];
const aiSummaryJobSchema = new mongoose.Schema({
    generationId: { type: String, required: true },
    locale: { type: String, enum: SUPPORTED_LOCALES, required: true },
    status: { type: String, enum: AI_SUMMARY_JOB_STATUSES, required: true },
    requestedAt: { type: Date, required: true },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
}, { _id: false });
export type StoredAiSummary = InferSchemaType<typeof aiSummarySchema>;
export type AiSummaryJob = InferSchemaType<typeof aiSummaryJobSchema>;
/**
 * Mongoose maps allow arbitrary keys, so locale variants deliberately use a
 * fixed seven-key subdocument. `strict: 'throw'` rejects misspelled or
 * unsupported locale keys instead of silently persisting or stripping them.
 */
const aiSummaryVariantsByLocaleSchema = new mongoose.Schema({
    en: { type: aiSummarySchema, required: false },
    ar: { type: aiSummarySchema, required: false },
    fr: { type: aiSummarySchema, required: false },
    de: { type: aiSummarySchema, required: false },
    es: { type: aiSummarySchema, required: false },
    ru: { type: aiSummarySchema, required: false },
    zh: { type: aiSummarySchema, required: false },
}, { _id: false, strict: 'throw' });
const aiSummaryJobsByLocaleSchema = new mongoose.Schema({
    en: { type: aiSummaryJobSchema, required: false },
    ar: { type: aiSummaryJobSchema, required: false },
    fr: { type: aiSummaryJobSchema, required: false },
    de: { type: aiSummaryJobSchema, required: false },
    es: { type: aiSummaryJobSchema, required: false },
    ru: { type: aiSummaryJobSchema, required: false },
    zh: { type: aiSummaryJobSchema, required: false },
}, { _id: false, strict: 'throw' });
export type AiSummaryVariantsByLocale = Partial<Record<(typeof SUPPORTED_LOCALES)[number], StoredAiSummary>>;
export type AiSummaryJobsByLocale = Partial<Record<(typeof SUPPORTED_LOCALES)[number], AiSummaryJob>>;
const reportSnapshotSchema = new mongoose.Schema({
    runId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AuditRun',
        required: true,
        unique: true,
        index: true,
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        required: true,
        index: true,
    },
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    findings: { type: [findingSchema], default: [] },
    counts: { type: countsSchema, required: true },
    pageSpeed: { type: pageSpeedSchema, required: false, default: null },
    indexStatus: { type: indexStatusSchema, required: false, default: null },
    gscSearch: { type: gscSearchSchema, required: false, default: null },
    gscSitemaps: { type: gscSitemapsSchema, required: false, default: null },
    aiVisibility: { type: aiVisibilitySchema, required: false, default: null },
    localSeo: { type: localSeoSchema, required: false, default: null },
    aiSummaryVariantsByLocale: {
        type: aiSummaryVariantsByLocaleSchema,
        required: false,
        default: () => ({}),
    },
    aiSummaryJobsByLocale: {
        type: aiSummaryJobsByLocaleSchema,
        required: false,
        default: () => ({}),
    },
    // Read-only rolling-deploy compatibility fields.
    aiSummary: { type: aiSummarySchema, required: false, default: null },
    aiSummaryJob: { type: aiSummaryJobSchema, required: false, default: null },
}, { timestamps: true });
export type ReportSnapshotDocument = InferSchemaType<typeof reportSnapshotSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type ReportSnapshotHydrated = HydratedDocument<ReportSnapshotDocument>;
export const ReportSnapshot = mongoose.model('ReportSnapshot', reportSnapshotSchema);
