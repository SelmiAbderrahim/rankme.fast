import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import { TOXICITY_RUBRIC_VERSION } from './toxicity-rubric.js';
export const TOXICITY_REVIEW_STATUSES = [
    'queued',
    'running',
    'succeeded',
    'failed',
] as const;
export type ToxicityReviewStatus = (typeof TOXICITY_REVIEW_STATUSES)[number];
export const TOXICITY_PROVIDER_STATUSES = [
    'not_started',
    'not_needed',
    'succeeded',
    'partial_failed',
    'failed',
    'budget_halted',
] as const;
export const TOXICITY_AI_STATUSES = [
    'not_requested',
    'succeeded',
    'abstained',
    'failed',
    'budget_skipped',
] as const;
export const TOXICITY_FAILURE_KINDS = [
    'provider_failed',
    'ceiling_halted',
] as const;
const toxicityReviewRunSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        required: true,
    },
    domain: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        minlength: 1,
        maxlength: 253,
    },
    status: {
        type: String,
        enum: TOXICITY_REVIEW_STATUSES,
        required: true,
        default: 'queued',
    },
    rubricVersion: {
        type: String,
        enum: [TOXICITY_RUBRIC_VERSION],
        required: true,
        default: TOXICITY_RUBRIC_VERSION,
    },
    locale: {
        type: String,
        enum: SUPPORTED_LOCALES,
        required: true,
        default: 'en',
    },
    retainedCount: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        max: 1000,
    },
    bulkDomainCount: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        max: 100,
    },
    providerStatus: {
        type: String,
        enum: TOXICITY_PROVIDER_STATUSES,
        required: true,
        default: 'not_started',
    },
    aiStatus: {
        type: String,
        enum: TOXICITY_AI_STATUSES,
        required: true,
        default: 'not_requested',
    },
    failureKind: {
        type: String,
        enum: [...TOXICITY_FAILURE_KINDS, null],
        default: null,
    },
    estimatedCostMicros: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    completedAt: {
        type: Date,
        default: null,
    },
}, {
    timestamps: { createdAt: true, updatedAt: false },
    strict: 'throw',
});
toxicityReviewRunSchema.index({ accountId: 1, _id: 1 });
toxicityReviewRunSchema.index({
    accountId: 1,
    siteId: 1,
    status: 1,
    createdAt: -1,
    _id: -1,
});
export type ToxicityReviewRunDocument = InferSchemaType<typeof toxicityReviewRunSchema> & {
    createdAt: Date;
};
export type ToxicityReviewRunHydrated = HydratedDocument<ToxicityReviewRunDocument>;
export const ToxicityReviewRun = mongoose.model('ToxicityReviewRun', toxicityReviewRunSchema);
