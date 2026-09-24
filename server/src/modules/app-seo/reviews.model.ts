import mongoose, { type InferSchemaType } from 'mongoose';
import { APP_SEO_STORES } from '../../db/schema/app-seo.js';
export const APP_REVIEW_RUN_MAX_REVIEWS = 300;
export const APP_REVIEW_CLUSTER_MIN_REVIEWS = 10;
export const APP_REVIEW_RUN_STATUSES = [
    'queued',
    'pulling',
    'clustering',
    'completed',
    'failed',
] as const;
export const APP_REVIEW_CLUSTER_STATES = [
    'pending',
    'available',
    'thin_evidence',
    'unavailable',
] as const;
export type AppReviewRunStatus = (typeof APP_REVIEW_RUN_STATUSES)[number];
export const APP_REVIEW_RUN_TRANSITIONS: Readonly<Record<AppReviewRunStatus, readonly AppReviewRunStatus[]>> = {
    queued: ['pulling', 'failed'],
    pulling: ['clustering', 'failed'],
    clustering: ['completed'],
    completed: [],
    failed: [],
};
export function canTransitionAppReviewRunStatus(from: AppReviewRunStatus, to: AppReviewRunStatus): boolean {
    return APP_REVIEW_RUN_TRANSITIONS[from].includes(to);
}
const marketSchema = new mongoose.Schema({
    country: { type: String, required: true, minlength: 2, maxlength: 2 },
    region: { type: String, default: null, maxlength: 80 },
    city: { type: String, default: null, maxlength: 80 },
    language: { type: String, required: true, minlength: 2, maxlength: 35 },
    device: { type: String, enum: ['desktop', 'mobile', 'all'] as const, required: true },
}, { _id: false });
const observationMetaSchema = new mongoose.Schema({
    sourceKind: {
        type: String,
        enum: ['first_party', 'provider_observation', 'estimate', 'ai_interpretation'] as const,
        required: true,
    },
    sourceLabel: { type: String, default: null, maxlength: 80 },
    observedAt: { type: String, required: true, maxlength: 48 },
    freshUntil: { type: String, default: null, maxlength: 48 },
    freshness: {
        type: String,
        enum: ['fresh', 'stale', 'partial', 'blocked', 'failed', 'unknown'] as const,
        required: true,
    },
    market: { type: marketSchema, default: null },
    sampleCount: { type: Number, required: true, min: 0, max: APP_REVIEW_RUN_MAX_REVIEWS },
    coverageNoteKey: { type: String, default: null, maxlength: 128 },
}, { _id: false });
const embeddedReviewSchema = new mongoose.Schema({
    id: { type: String, required: true, match: /^review-\d{3}$/, maxlength: 10 },
    rating: { type: Number, required: true, min: 0, max: 5 },
    title: { type: String, default: null, maxlength: 700 },
    text: { type: String, required: true, maxlength: 20000 },
    /** Vendor-returned public display name. Never include this field in logs. */
    authorName: { type: String, default: null, maxlength: 300 },
    at: { type: Date, default: null },
}, { _id: false });
const starBucketSchema = new mongoose.Schema({
    star: { type: Number, required: true, min: 1, max: 5 },
    count: { type: Number, required: true, min: 0, max: APP_REVIEW_RUN_MAX_REVIEWS },
}, { _id: false });
const volumeTrendPointSchema = new mongoose.Schema({
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    count: { type: Number, required: true, min: 1, max: APP_REVIEW_RUN_MAX_REVIEWS },
    averageRating: { type: Number, required: true, min: 0, max: 5 },
}, { _id: false });
const deterministicStatsSchema = new mongoose.Schema({
    total: { type: Number, required: true, min: 0, max: APP_REVIEW_RUN_MAX_REVIEWS },
    averageRating: { type: Number, default: null, min: 0, max: 5 },
    histogram: {
        type: [starBucketSchema],
        required: true,
        validate: {
            validator: (value: unknown[]) => value.length === 5,
            message: 'review histogram must have exactly five buckets',
        },
    },
    ratingMix: {
        positive: { type: Number, required: true, min: 0, max: APP_REVIEW_RUN_MAX_REVIEWS },
        neutral: { type: Number, required: true, min: 0, max: APP_REVIEW_RUN_MAX_REVIEWS },
        negative: { type: Number, required: true, min: 0, max: APP_REVIEW_RUN_MAX_REVIEWS },
    },
    volumeTrend: {
        type: [volumeTrendPointSchema],
        required: true,
        validate: {
            validator: (value: unknown[]) => value.length <= 24,
            message: 'review volume trend is bounded to twenty-four periods',
        },
    },
}, { _id: false });
const clusterQuoteSchema = new mongoose.Schema({
    reviewId: { type: String, required: true, match: /^review-\d{3}$/, maxlength: 10 },
    quote: { type: String, required: true, minlength: 1, maxlength: 500 },
}, { _id: false });
const reviewClusterSchema = new mongoose.Schema({
    label: { type: String, required: true, minlength: 1, maxlength: 120 },
    sentiment: {
        type: String,
        enum: ['positive', 'neutral', 'negative', 'mixed'] as const,
        required: true,
    },
    citedReviewIds: {
        type: [String],
        required: true,
        validate: {
            validator: (value: string[]) => value.length >= 2 && value.length <= 8,
            message: 'review clusters require between two and eight citations',
        },
    },
    quotes: {
        type: [clusterQuoteSchema],
        required: true,
        validate: {
            validator: (value: unknown[]) => value.length >= 2 && value.length <= 8,
            message: 'review clusters require between two and eight quotes',
        },
    },
    /** Sentiment and grouping are explicitly AI interpretation, never observed fact. */
    observationMeta: { type: observationMetaSchema, required: true },
}, { _id: false });
const appReviewRunSchema = new mongoose.Schema({
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
    profileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AppProfile',
        required: true,
        index: true,
    },
    store: { type: String, enum: APP_SEO_STORES, required: true },
    locationCode: { type: Number, required: true, min: 1, default: 2840 },
    languageCode: { type: String, required: true, minlength: 2, maxlength: 16, default: 'en' },
    locale: {
        type: String,
        enum: ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const,
        required: true,
        default: 'en',
    },
    status: { type: String, enum: APP_REVIEW_RUN_STATUSES, required: true, default: 'queued' },
    reviews: {
        type: [embeddedReviewSchema],
        required: true,
        default: [],
        validate: {
            validator: (value: unknown[]) => value.length <= APP_REVIEW_RUN_MAX_REVIEWS,
            message: 'review run exceeds the three-hundred-review bound',
        },
    },
    stats: { type: deterministicStatsSchema, default: null },
    clusters: {
        type: [reviewClusterSchema],
        required: true,
        default: [],
        validate: {
            validator: (value: unknown[]) => value.length <= 12,
            message: 'review cluster count exceeds the bound',
        },
    },
    clusterState: {
        type: String,
        enum: APP_REVIEW_CLUSTER_STATES,
        required: true,
        default: 'pending',
    },
    observationMeta: { type: observationMetaSchema, default: null },
    aiCostMicros: { type: Number, default: null, min: 0 },
    aiPassStartedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
}, { timestamps: true, collection: 'app_review_runs' });
appReviewRunSchema.index({ accountId: 1, siteId: 1, profileId: 1, store: 1, createdAt: -1 }, { name: 'app_review_runs_owner_list' });
export type AppReviewRunDocument = InferSchemaType<typeof appReviewRunSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export const AppReviewRun = mongoose.model('AppReviewRun', appReviewRunSchema);
