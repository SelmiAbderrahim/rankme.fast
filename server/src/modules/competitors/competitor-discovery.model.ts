import mongoose, { type InferSchemaType } from 'mongoose';
export const COMPETITOR_DISCOVERY_STATES = ['completed', 'partial', 'failed'] as const;
const marketSchema = new mongoose.Schema({
    locationCode: { type: Number, required: true, min: 1 },
    languageCode: { type: String, required: true, minlength: 2, maxlength: 10 },
    source: {
        type: String,
        enum: ['tracked_keyword_mode', 'default'] as const,
        required: true,
    },
    eligibleTrackedKeywords: { type: Number, required: true, min: 0 },
}, { _id: false });
const suggestionSchema = new mongoose.Schema({
    registrableDomain: { type: String, required: true, maxlength: 253 },
    origin: { type: String, required: true, maxlength: 2048 },
    source: { type: String, enum: ['dataforseo'] as const, required: true },
    capturedAt: { type: Date, required: true },
    alreadyConfirmed: { type: Boolean, required: true },
}, { _id: false });
const provenanceSchema = new mongoose.Schema({
    provider: { type: String, enum: ['dataforseo'] as const, required: true },
    operation: {
        type: String,
        enum: ['domain_candidates', 'serp_candidates'] as const,
        required: true,
    },
    status: {
        type: String,
        enum: ['success', 'timeout', 'malformed', 'quota', 'failed'] as const,
        required: true,
    },
    capturedAt: { type: Date, default: null },
}, { _id: false });
const warningSchema = new mongoose.Schema({
    code: {
        type: String,
        enum: [
            'SOURCE_TIMEOUT',
            'SOURCE_MALFORMED',
            'SOURCE_QUOTA',
            'SOURCE_FAILED',
            'SOURCE_TRUNCATED',
        ] as const,
        required: true,
    },
    operation: {
        type: String,
        enum: ['domain_candidates', 'serp_candidates'] as const,
        required: true,
    },
    count: { type: Number, required: true, min: 1 },
}, { _id: false });
const competitorDiscoveryAttemptSchema = new mongoose.Schema({
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    idempotencyKey: { type: String, required: true, minlength: 1, maxlength: 128 },
    state: { type: String, enum: COMPETITOR_DISCOVERY_STATES, required: true },
    market: { type: marketSchema, required: true },
    suggestions: {
        type: [suggestionSchema],
        required: true,
        validate: { validator: (items: unknown[]) => items.length <= 25 },
    },
    cache: { type: String, enum: ['hit', 'miss'] as const, required: true },
    provenance: {
        type: [provenanceSchema],
        required: true,
        validate: { validator: (items: unknown[]) => items.length <= 2 },
    },
    coverage: {
        returned: { type: Number, required: true, min: 0 },
        retained: { type: Number, required: true, min: 0, max: 25 },
        truncated: { type: Boolean, required: true },
    },
    warnings: {
        type: [warningSchema],
        required: true,
        validate: { validator: (items: unknown[]) => items.length <= 5 },
    },
    attemptedAt: { type: Date, required: true },
    safeErrorCode: { type: String, default: null, maxlength: 64 },
}, { timestamps: true });
competitorDiscoveryAttemptSchema.index({ accountId: 1, siteId: 1, idempotencyKey: 1 }, { unique: true, name: 'competitor_discovery_idempotency_uq' });
competitorDiscoveryAttemptSchema.index({ accountId: 1, siteId: 1, state: 1, createdAt: -1, _id: -1 }, { name: 'competitor_discovery_latest_good_idx' });
export type CompetitorDiscoveryAttemptDocument = InferSchemaType<typeof competitorDiscoveryAttemptSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export const CompetitorDiscoveryAttempt = mongoose.model('CompetitorDiscoveryAttempt', competitorDiscoveryAttemptSchema);
