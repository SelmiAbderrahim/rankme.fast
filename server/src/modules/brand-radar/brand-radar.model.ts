/**
 * Brand Radar scan document.
 *
 * One document per scan. The document is written BEFORE the job is enqueued
 * (parse → own → kill switch → create → enqueue), so a crash between the
 * write and the enqueue leaves a `queued` row the reconciliation sweep can
 * settle.
 *
 * `queryHash` is the trend series key: sha256 of the normalized query,
 * language, and publisher country. `priorScanId` links the most recent
 * settled scan for the same account + same market-aware query so
 * `computeTrendVsPrevious` never fabricates a delta.
 */
import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
export const BRAND_RADAR_SCAN_STATUSES = [
    'queued',
    'running',
    'completed',
    'completed_empty',
    'completed_partial',
    'failed',
] as const;
export type BrandRadarScanStatus = (typeof BRAND_RADAR_SCAN_STATUSES)[number];
/** Statuses that make a scan eligible to be the `priorScanId` of the next one. */
export const BRAND_RADAR_SETTLED_STATUSES = [
    'completed',
    'completed_partial',
    'completed_empty',
] as const;
export const BRAND_RADAR_DIGEST_STATES = [
    'pending',
    'digest_present',
    'digest_absent',
    'no_reliable_digest',
] as const;
export type BrandRadarDigestState = (typeof BRAND_RADAR_DIGEST_STATES)[number];
/**
 * Halt disclosure: WHICH stage halted a `completed_partial` / `failed` scan
 * and WHY, in a bounded taxonomy — never raw vendor error text. `scan` is the
 * reconciliation sweep's whole-run stage. Legacy documents predate the field
 * and hydrate `null`; the client
 * falls back to its generic banner copy for those.
 */
export const BRAND_RADAR_HALT_STAGES = [
    'search',
    'summary',
    'brand_digest',
    'scan',
] as const;
export type BrandRadarHaltStage = (typeof BRAND_RADAR_HALT_STAGES)[number];
export const BRAND_RADAR_HALT_REASONS = [
    'cost_ceiling',
    'provider_error',
    'digest_failed',
    'processing_failure',
] as const;
export type BrandRadarHaltReason = (typeof BRAND_RADAR_HALT_REASONS)[number];
const haltSchema = new mongoose.Schema({
    stage: { type: String, enum: BRAND_RADAR_HALT_STAGES, required: true },
    reason: { type: String, enum: BRAND_RADAR_HALT_REASONS, required: true },
}, { _id: false, strict: 'throw' });
/** Bounds: mention rows ≤1000 per scan. */
export const BRAND_RADAR_MAX_RETAINED_ROWS = 1000;
/** Bounds: brand query 1..200 chars. */
export const BRAND_RADAR_QUERY_MAX_LENGTH = 200;
/** Bounds: ≤20 digest sentences, ≤300 characters each. */
export const BRAND_RADAR_MAX_DIGEST_SENTENCES = 20;
export const BRAND_RADAR_DIGEST_TEXT_MAX_LENGTH = 300;
/**
 * One surviving digest sentence. Citation-or-drop already ran before this is
 * written, so every id here is a retained mention row of the same
 * scan. The text is untrusted generated content: render it as text, never as
 * markup, and never log it (`digestSentenceText` redaction path).
 */
const digestSentenceSchema = new mongoose.Schema({
    text: {
        type: String,
        required: true,
        maxlength: BRAND_RADAR_DIGEST_TEXT_MAX_LENGTH,
    },
    citedRowIds: { type: [String], required: true, default: () => [] },
}, { _id: false, strict: 'throw' });
/** Deterministic sentiment split, in whole percentage points. */
const sentimentDistributionSchema = new mongoose.Schema({
    positive: { type: Number, required: true, min: 0, max: 100, default: 0 },
    neutral: { type: Number, required: true, min: 0, max: 100, default: 0 },
    negative: { type: Number, required: true, min: 0, max: 100, default: 0 },
    unknown: { type: Number, required: true, min: 0, max: 100, default: 0 },
}, { _id: false, strict: 'throw' });
const scanTopDomainSchema = new mongoose.Schema({
    domain: { type: String, required: true, maxlength: 253 },
    count: { type: Number, required: true, min: 0 },
}, { _id: false, strict: 'throw' });
const brandRadarScanSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    // Site scoping. A scan belongs to exactly one
    // site — the workspace tab that created it. Legacy null-sited rows are
    // resolved by `scripts/backfill-brand-radar-site.ts` BEFORE this required
    // field deploys; see `ops/brand-radar-site-scoping-rollout.md`.
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        required: true,
        index: true,
    },
    brandQuery: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: BRAND_RADAR_QUERY_MAX_LENGTH,
    },
    language: {
        type: String,
        default: null,
        trim: true,
        lowercase: true,
        minlength: 2,
        maxlength: 2,
    },
    /** Frozen digest presentation locale; null only on legacy documents. */
    outputLocale: { type: String, enum: SUPPORTED_LOCALES, default: null },
    locationCode: { type: Number, default: null, min: 1 },
    countryCode: {
        type: String,
        default: null,
        trim: true,
        uppercase: true,
        match: /^[A-Z]{2}$/,
    },
    status: {
        type: String,
        enum: BRAND_RADAR_SCAN_STATUSES,
        required: true,
        default: 'queued',
    },
    digestState: {
        type: String,
        enum: BRAND_RADAR_DIGEST_STATES,
        required: true,
        default: 'pending',
    },
    /** sha256 hex of the normalized brand query — the trend series key. */
    queryHash: {
        type: String,
        required: true,
        match: /^[0-9a-f]{64}$/,
        index: true,
    },
    priorScanId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BrandRadarScan',
        default: null,
        index: true,
        sparse: true,
    },
    retainedRowCount: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        max: BRAND_RADAR_MAX_RETAINED_ROWS,
    },
    retainedRowIds: {
        type: [String],
        required: true,
        default: () => [],
        validate: {
            validator: (ids: string[]) => ids.length <= BRAND_RADAR_MAX_RETAINED_ROWS,
            message: 'brandRadar.errors.tooManyRows',
        },
    },
    mentionSummaryId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        sparse: true,
    },
    // ---- Deterministic aggregates ---------------------------------
    // Written once at settlement from the STORED rows. Never AI-supplied.
    mentionCount: { type: Number, required: true, default: 0, min: 0 },
    sentimentDistribution: {
        type: sentimentDistributionSchema,
        required: true,
        default: () => ({ positive: 0, neutral: 0, negative: 0, unknown: 0 }),
    },
    topDomains: {
        type: [scanTopDomainSchema],
        required: true,
        default: () => [],
    },
    /** Current count − prior scan's count; null when there is no prior scan. */
    trendVsPrevious: { type: Number, default: null },
    digestSentences: {
        type: [digestSentenceSchema],
        required: true,
        default: () => [],
        validate: {
            validator: (sentences: unknown[]) => sentences.length <= BRAND_RADAR_MAX_DIGEST_SENTENCES,
            message: 'brandRadar.errors.tooManyDigestSentences',
        },
    },
    /** Which stage halted and why — null on clean terminals and legacy docs. */
    halt: { type: haltSchema, default: null },
    terminalAt: { type: Date, default: null, sparse: true },
}, { timestamps: true, strict: 'throw' });
// Workspace list + cursor: newest first inside one site.
brandRadarScanSchema.index({ accountId: 1, siteId: 1, createdAt: -1, _id: -1 });
// Trend linkage: newest settled scan for the same normalized query ON THIS
// SITE. Two sites of one account tracking the same brand keep separate
// baselines, so the site is part of the key.
brandRadarScanSchema.index({ accountId: 1, siteId: 1, queryHash: 1, createdAt: -1 });
// Account-wide list ordering is still used by the account cascade and by the
// superadmin reads, which scan by account rather than by site.
brandRadarScanSchema.index({ accountId: 1, createdAt: -1, _id: -1 });
// Reconciliation sweep reuses this index.
brandRadarScanSchema.index({ accountId: 1, status: 1, updatedAt: 1 });
// The account-level `{ accountId, queryHash, createdAt }` index is gone: its
// sole reader was `findPriorScanId`, which is now site-scoped and served by
// the site-prefixed index above. Nothing else in `server/src` filters on
// `queryHash` — weekly-pulse groups by it in memory after an
// `{ accountId, siteId, status, terminalAt }` range read.
export type BrandRadarScanDocument = InferSchemaType<typeof brandRadarScanSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type BrandRadarScanHydrated = HydratedDocument<BrandRadarScanDocument>;
export const BrandRadarScan = mongoose.model('BrandRadarScan', brandRadarScanSchema);
