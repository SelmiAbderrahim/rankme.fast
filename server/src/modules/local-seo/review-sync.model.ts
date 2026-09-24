/**
 * Review Intelligence storage.
 *
 * Three Mongo documents:
 *
 *   `LocalSeoReviewSource`  — one configured vendor target per
 *                             (accountId, profileId, source).
 *   `LocalSeoReviewSyncRun` — one submitted sync; carries the per-source
 *                             outcome bookkeeping.
 *   `LocalSeoReviewRow`     — one persisted review; unique on
 *                             (profileId, source, sourceReviewId), which IS
 *                             the dedupe key.
 *
 * `profileId` is the owned `Site` id — RankMeFast models a local business
 * profile as a site, so ownership (and the cross-account 404) resolves
 * through the existing `Site` collection.
 *
 * Field bounds mirror the provider normalization's dropped-field table: review
 * text is clamped to 1000 characters, author profile URLs and reviewer IDs
 * are never stored, and any in-body email is replaced with `[email]` before
 * persist. The AI fields (`aiTerminalState`, `aiCostMicros`) are declared
 * here but left at their defaults until the theme pass fills them.
 */
import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
export const REVIEW_SOURCES = ['google', 'trustpilot', 'tripadvisor'] as const;
export type ReviewSourceName = (typeof REVIEW_SOURCES)[number];
export const REVIEW_SYNC_RUN_STATUSES = [
    'queued',
    'running',
    'succeeded',
    'partial',
    'failed',
] as const;
export type ReviewSyncRunStatus = (typeof REVIEW_SYNC_RUN_STATUSES)[number];
export const REVIEW_SOURCE_OUTCOMES = ['ok', 'failed', 'zeroNew'] as const;
export type ReviewSourceOutcome = (typeof REVIEW_SOURCE_OUTCOMES)[number];
/** AI review-clustering terminal states; a sync run alone never leaves `pending`. */
export const REVIEW_AI_TERMINAL_STATES = [
    'pending',
    'themes-ok',
    'no-reliable-themes',
    'ai-failed-reviews-intact',
] as const;
export type ReviewAiTerminalState = (typeof REVIEW_AI_TERMINAL_STATES)[number];
export const REVIEW_TEXT_MAX_CHARS = 1000;
export const REVIEW_TITLE_MAX_CHARS = 200;
export const REVIEW_AUTHOR_MAX_CHARS = 120;
export const REVIEW_LANGUAGE_MAX_CHARS = 16;
export const REVIEW_SOURCE_ID_MAX_CHARS = 200;
export const REVIEW_TARGET_MAX_CHARS = 200;
export const REVIEW_SYNC_MAX_DEPTH = 100;
const atMostCodePoints = (max: number) => ({
    validator: (value: string | null | undefined) => typeof value !== 'string' || [...value].length <= max,
    message: `value must contain at most ${max} Unicode code points`,
});
const reviewSourceSchema = new mongoose.Schema({
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    source: { type: String, enum: REVIEW_SOURCES, required: true },
    target: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: REVIEW_TARGET_MAX_CHARS,
    },
}, { timestamps: { createdAt: true, updatedAt: true }, strict: 'throw' });
// One configured target per (profile, source) — re-configuring replaces.
reviewSourceSchema.index({ profileId: 1, source: 1 }, { unique: true });
reviewSourceSchema.index({ accountId: 1, profileId: 1 });
export type LocalSeoReviewSourceDocument = InferSchemaType<typeof reviewSourceSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type LocalSeoReviewSourceHydrated = HydratedDocument<LocalSeoReviewSourceDocument>;
export const LocalSeoReviewSource = mongoose.model('LocalSeoReviewSource', reviewSourceSchema);
const perSourceOutcomeSchema = new mongoose.Schema({
    source: { type: String, enum: REVIEW_SOURCES, required: true },
    outcome: { type: String, enum: REVIEW_SOURCE_OUTCOMES, required: true },
    /** Previously-unseen rows persisted from this source on this run. */
    retained: { type: Number, required: true, min: 0, default: 0 },
    /** Provider error class name on `failed`; null otherwise. Never a vendor message. */
    errorCode: { type: String, default: null, maxlength: 64 },
}, { _id: false, strict: 'throw' });
export const REVIEW_THEME_KINDS = ['complaint', 'praise'] as const;
export type ReviewThemeKind = (typeof REVIEW_THEME_KINDS)[number];
export const REVIEW_THEME_LABEL_MAX_CHARS = 120;
export const REVIEW_THEME_SUMMARY_MAX_CHARS = 500;
/** Read-boundary clamp for an excerpt rendered from a cited row. */
export const REVIEW_THEME_EXCERPT_MAX_CHARS = 300;
/** A theme survives only when it cites at least this many persisted rows. */
export const REVIEW_THEME_MIN_CITATIONS = 2;
export const REVIEW_THEME_MAX_CITATIONS = 20;
export const REVIEW_THEME_MAX_PER_KIND = 10;
export const REVIEW_THEME_MAX_TOTAL = REVIEW_THEME_MAX_PER_KIND * 2;
/**
 * One surviving AI theme. `citedReviewIds` holds the Mongo ids of
 * STORED `LocalSeoReviewRow` documents, NOT vendor `sourceReviewId` values and
 * not the synthetic ids handed to the model. Source review ids are only
 * unique together with their source; using the owned row id prevents a Google
 * and Trustpilot collision from ever resolving to the wrong evidence.
 */
const reviewThemeSchema = new mongoose.Schema({
    kind: { type: String, enum: REVIEW_THEME_KINDS, required: true },
    label: {
        type: String,
        required: true,
        validate: atMostCodePoints(REVIEW_THEME_LABEL_MAX_CHARS),
    },
    summary: {
        type: String,
        required: true,
        validate: atMostCodePoints(REVIEW_THEME_SUMMARY_MAX_CHARS),
    },
    citedReviewIds: {
        type: [{
                type: String,
                minlength: 24,
                maxlength: 24,
                match: /^[0-9a-f]{24}$/i,
            }],
        required: true,
        validate: {
            validator: (value: string[]) => value.length >= REVIEW_THEME_MIN_CITATIONS &&
                value.length <= REVIEW_THEME_MAX_CITATIONS,
            message: 'theme citations must contain two to twenty stored review ids',
        },
    },
}, { _id: false, strict: 'throw' });
const reviewSyncRunSchema = new mongoose.Schema({
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    sources: {
        type: [{ type: String, enum: REVIEW_SOURCES }],
        required: true,
        validate: {
            validator: (value: string[]) => value.length >= 1 && value.length <= REVIEW_SOURCES.length,
            message: 'sources must contain one to three review sources',
        },
    },
    depth: { type: Number, required: true, min: 1, max: REVIEW_SYNC_MAX_DEPTH },
    /** Frozen presentation locale. Null only on pre-change legacy documents. */
    outputLocale: { type: String, enum: SUPPORTED_LOCALES, default: null },
    status: {
        type: String,
        enum: REVIEW_SYNC_RUN_STATUSES,
        required: true,
        default: 'queued',
    },
    perSourceOutcomes: { type: [perSourceOutcomeSchema], required: true, default: () => [] },
    retainedCount: { type: Number, required: true, min: 0, default: 0 },
    aiTerminalState: {
        type: String,
        enum: REVIEW_AI_TERMINAL_STATES,
        required: true,
        default: 'pending',
    },
    aiCostMicros: { type: Number, default: null, min: 0 },
    aiThemes: {
        type: [reviewThemeSchema],
        required: true,
        default: () => [],
        validate: {
            validator: (value: unknown[]) => value.length <= REVIEW_THEME_MAX_TOTAL,
            message: 'at most twenty review themes may be stored',
        },
    },
    /** Atomic exactly-once claim written immediately before AI dispatch. */
    aiPassStartedAt: { type: Date, default: null },
    aiCompletedAt: { type: Date, default: null },
    aiInputCount: {
        type: Number,
        default: null,
        min: 0,
        max: 60,
        validate: {
            validator: (value: number | null) => value === null || Number.isInteger(value),
            message: 'AI input count must be an integer',
        },
    },
    completedAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' });
reviewSyncRunSchema.index({ accountId: 1, _id: 1 });
reviewSyncRunSchema.index({ accountId: 1, profileId: 1, createdAt: -1, _id: -1 });
export type LocalSeoReviewSyncRunDocument = InferSchemaType<typeof reviewSyncRunSchema> & {
    createdAt: Date;
};
export type LocalSeoReviewSyncRunHydrated = HydratedDocument<LocalSeoReviewSyncRunDocument>;
export const LocalSeoReviewSyncRun = mongoose.model('LocalSeoReviewSyncRun', reviewSyncRunSchema);
const reviewRowSchema = new mongoose.Schema({
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    source: { type: String, enum: REVIEW_SOURCES, required: true },
    /** Opaque per-source review id — never a vendor task id. */
    sourceReviewId: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        validate: atMostCodePoints(REVIEW_SOURCE_ID_MAX_CHARS),
    },
    rating: { type: Number, default: null, min: 0, max: 5 },
    title: {
        type: String,
        default: null,
        validate: atMostCodePoints(REVIEW_TITLE_MAX_CHARS),
    },
    text: {
        type: String,
        required: true,
        default: '',
        validate: atMostCodePoints(REVIEW_TEXT_MAX_CHARS),
    },
    /** Public display name only — profile URLs and reviewer IDs are dropped. */
    authorDisplayName: {
        type: String,
        default: null,
        validate: atMostCodePoints(REVIEW_AUTHOR_MAX_CHARS),
    },
    language: {
        type: String,
        default: null,
        validate: atMostCodePoints(REVIEW_LANGUAGE_MAX_CHARS),
    },
    reviewedAt: { type: Date, default: null },
    /** The run that first persisted this row; later runs never rewrite it. */
    firstSeenRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'LocalSeoReviewSyncRun', required: true },
    fetchedAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' });
// THE dedupe key. A rerun re-fetches, collides here, and appends nothing.
reviewRowSchema.index({ profileId: 1, source: 1, sourceReviewId: 1 }, { unique: true });
// Newest-first inventory reads (nulls sort last under a descending sort).
reviewRowSchema.index({ accountId: 1, profileId: 1, reviewedAt: -1, _id: -1 });
export type LocalSeoReviewRowDocument = InferSchemaType<typeof reviewRowSchema> & {
    createdAt: Date;
};
export type LocalSeoReviewRowHydrated = HydratedDocument<LocalSeoReviewRowDocument>;
export const LocalSeoReviewRow = mongoose.model('LocalSeoReviewRow', reviewRowSchema);
