import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
export const CONTENT_BRIEF_STATUSES = [
    'queued',
    'running',
    'completed',
    'completed_empty',
    'completed_partial',
    'failed',
] as const;
export type ContentBriefStatus = (typeof CONTENT_BRIEF_STATUSES)[number];
export const CONTENT_BRIEF_HALT_STAGES = [
    'serp_fetch',
    'scrape',
    'brief_ai',
    'editor_ai',
] as const;
export type ContentBriefHaltStage = (typeof CONTENT_BRIEF_HALT_STAGES)[number];
export const CONTENT_BRIEF_HALT_REASONS = [
    'cost_ceiling',
    'provider_error',
    'unsafe_url',
    'malformed_output',
    'processing_failure',
] as const;
export type ContentBriefHaltReason = (typeof CONTENT_BRIEF_HALT_REASONS)[number];
export const CONTENT_BRIEF_MAX_DOCUMENTS = 10;
export const CONTENT_BRIEF_MAX_DRAFT_VERSIONS = 20;
export const CONTENT_BRIEF_MAX_DRAFT_CHARS = 50000;
const headingSchema = new mongoose.Schema({
    level: { type: Number, required: true, min: 1, max: 6 },
    text: { type: String, required: true, maxlength: 300 },
}, { _id: false, strict: 'throw' });
const documentSchema = new mongoose.Schema({
    id: { type: String, required: true, maxlength: 32 },
    sourceUrl: { type: String, required: true, maxlength: 2048 },
    title: { type: String, default: '', maxlength: 300 },
    excerpt: { type: String, default: '', maxlength: 4000 },
    headings: {
        type: [headingSchema],
        required: true,
        default: () => [],
        validate: {
            validator: (value: unknown[]) => value.length <= 100,
            message: 'contentBriefs.errors.headingLimit',
        },
    },
    capturedAt: { type: Date, required: true },
    wordCount: { type: Number, required: true, min: 0 },
    entityLabels: {
        type: [String],
        required: true,
        default: () => [],
        validate: {
            validator: (value: unknown[]) => value.length <= 50,
            message: 'contentBriefs.errors.entityLimit',
        },
    },
}, { _id: false, strict: 'throw' });
const paaRowSchema = new mongoose.Schema({
    id: { type: String, required: true, maxlength: 32 },
    question: { type: String, required: true, maxlength: 300 },
    answerDomain: { type: String, default: null, maxlength: 253 },
    answerUrl: { type: String, default: null, maxlength: 2048 },
}, { _id: false, strict: 'throw' });
const entitySchema = new mongoose.Schema({
    label: { type: String, required: true, maxlength: 120 },
    documentCount: { type: Number, required: true, min: 1, max: 10 },
}, { _id: false, strict: 'throw' });
const wordCountSchema = new mongoose.Schema({
    min: { type: Number, default: null, min: 0 },
    max: { type: Number, default: null, min: 0 },
    average: { type: Number, default: null, min: 0 },
    documentCount: { type: Number, required: true, min: 0, max: 10 },
}, { _id: false, strict: 'throw' });
const headingHistogramSchema = new mongoose.Schema({
    h1: { type: Number, required: true, min: 0 },
    h2: { type: Number, required: true, min: 0 },
    h3: { type: Number, required: true, min: 0 },
    h4: { type: Number, required: true, min: 0 },
    h5: { type: Number, required: true, min: 0 },
    h6: { type: Number, required: true, min: 0 },
}, { _id: false, strict: 'throw' });
const corpusStatsSchema = new mongoose.Schema({
    wordCount: { type: wordCountSchema, required: true },
    headingHistogram: { type: headingHistogramSchema, required: true },
    entities: { type: [entitySchema], required: true, default: () => [] },
    scrapeDates: { type: [Date], required: true, default: () => [] },
}, { _id: false, strict: 'throw' });
const outlineNodeSchema = new mongoose.Schema({
    id: { type: String, required: true, maxlength: 64 },
    heading: { type: String, required: true, maxlength: 300 },
    purpose: { type: String, required: true, maxlength: 1000 },
    citations: { type: [String], required: true, default: () => [] },
}, { _id: false, strict: 'throw' });
const questionSchema = new mongoose.Schema({
    question: { type: String, required: true, maxlength: 300 },
    citations: { type: [String], required: true, default: () => [] },
}, { _id: false, strict: 'throw' });
const secondaryTermSchema = new mongoose.Schema({
    id: { type: String, required: true, maxlength: 32 },
    term: { type: String, required: true, maxlength: 200 },
}, { _id: false, strict: 'throw' });
const haltSchema = new mongoose.Schema({
    stage: { type: String, enum: CONTENT_BRIEF_HALT_STAGES, required: true },
    reason: { type: String, enum: CONTENT_BRIEF_HALT_REASONS, required: true },
}, { _id: false, strict: 'throw' });
const costEntrySchema = new mongoose.Schema({
    stage: { type: String, enum: CONTENT_BRIEF_HALT_STAGES, required: true },
    costMicros: { type: Number, required: true, min: 0 },
    source: { type: String, enum: ['captured', 'estimated'], required: true },
}, { _id: false, strict: 'throw' });
const deterministicComparisonSchema = new mongoose.Schema({
    wordCount: { type: Number, required: true, min: 0 },
    corpusMin: { type: Number, default: null, min: 0 },
    corpusMax: { type: Number, default: null, min: 0 },
    corpusAverage: { type: Number, default: null, min: 0 },
    wordDeltaFromAverage: { type: Number, default: null },
    headingCount: { type: Number, required: true, min: 0 },
    corpusAverageHeadings: { type: Number, default: null, min: 0 },
    matchedEntities: { type: Number, required: true, min: 0 },
    totalEntities: { type: Number, required: true, min: 0 },
    deterministicScore: { type: Number, required: true, min: 0, max: 100 },
}, { _id: false, strict: 'throw' });
const draftVersionSchema = new mongoose.Schema({
    version: { type: Number, required: true, min: 1, max: CONTENT_BRIEF_MAX_DRAFT_VERSIONS },
    draft: { type: String, required: true, maxlength: CONTENT_BRIEF_MAX_DRAFT_CHARS },
    comparison: { type: deterministicComparisonSchema, required: true },
    aiScore: { type: Number, default: null, min: 0, max: 100 },
    aiRationale: { type: String, default: null, maxlength: 1000 },
    aiCitations: { type: [String], required: true, default: () => [] },
    aiCostMicros: { type: Number, required: true, default: 0, min: 0 },
    aiDisclosure: {
        type: String,
        enum: ['scored', 'cost_ceiling', 'provider_error', 'malformed_output'],
        required: true,
    },
    createdAt: { type: Date, required: true },
}, { _id: false, strict: 'throw' });
const contentBriefSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        required: true,
        index: true,
    },
    keywordId: { type: String, required: true, maxlength: 64 },
    keyword: { type: String, required: true, minlength: 1, maxlength: 200 },
    locale: { type: String, enum: SUPPORTED_LOCALES, required: true },
    // Idempotency key (account + site + keyword + locale + client key); unique per site.
    reservationKey: { type: String, required: true, maxlength: 200 },
    status: {
        type: String,
        enum: CONTENT_BRIEF_STATUSES,
        required: true,
        default: 'queued',
    },
    runCeilingMicros: { type: Number, required: true, min: 1 },
    totalCostMicros: { type: Number, required: true, default: 0, min: 0 },
    editorAiCostMicros: { type: Number, required: true, default: 0, min: 0 },
    editorAiReservedMicros: { type: Number, required: true, default: 0, min: 0 },
    costEntries: { type: [costEntrySchema], required: true, default: () => [] },
    serpSource: {
        type: String,
        enum: ['pending', 'stored', 'fetched'],
        required: true,
        default: 'pending',
    },
    serpCheckedAt: { type: Date, default: null },
    serpFetchStartedAt: { type: Date, default: null },
    fetchedInsideUnit: { type: Boolean, required: true, default: false },
    serpTopUrls: {
        type: [String],
        required: true,
        default: () => [],
        validate: {
            validator: (value: unknown[]) => value.length <= CONTENT_BRIEF_MAX_DOCUMENTS,
            message: 'contentBriefs.errors.serpLimit',
        },
    },
    paaRows: { type: [paaRowSchema], required: true, default: () => [] },
    scrapeAttempts: { type: Number, required: true, default: 0, min: 0, max: 10 },
    successfulScrapeAttempts: { type: Number, required: true, default: 0, min: 0, max: 10 },
    indeterminateScrapeAttempts: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        max: 10,
    },
    providerFailureCount: { type: Number, required: true, default: 0, min: 0, max: 11 },
    unsafeUrlCount: { type: Number, required: true, default: 0, min: 0, max: 10 },
    documents: {
        type: [documentSchema],
        required: true,
        default: () => [],
        validate: {
            validator: (value: unknown[]) => value.length <= CONTENT_BRIEF_MAX_DOCUMENTS,
            message: 'contentBriefs.errors.documentLimit',
        },
    },
    corpusStats: { type: corpusStatsSchema, default: null },
    outline: { type: [outlineNodeSchema], required: true, default: () => [] },
    questions: { type: [questionSchema], required: true, default: () => [] },
    secondaryTerms: { type: [secondaryTermSchema], required: true, default: () => [] },
    abstentions: { type: [String], required: true, default: () => [] },
    briefAiStartedAt: { type: Date, default: null },
    briefAiCompleted: { type: Boolean, required: true, default: false },
    halt: { type: haltSchema, default: null },
    draftVersions: {
        type: [draftVersionSchema],
        required: true,
        default: () => [],
        validate: {
            validator: (value: unknown[]) => value.length <= CONTENT_BRIEF_MAX_DRAFT_VERSIONS,
            message: 'contentBriefs.errors.draftVersionLimit',
        },
    },
    draftVersionCount: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        max: CONTENT_BRIEF_MAX_DRAFT_VERSIONS,
    },
    /**
     * BullMQ's zero-based delivery attempt that currently owns the run.
     *
     * `-1` means unclaimed.  A strictly newer delivery may atomically replace
     * this value after a worker crash, while duplicate delivery of the same
     * attempt cannot enter the pipeline a second time.
     */
    processorAttempt: { type: Number, required: true, default: -1, min: -1 },
    processorStartedAt: { type: Date, default: null },
    terminalAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });
contentBriefSchema.index({ accountId: 1, siteId: 1, reservationKey: 1 }, { unique: true });
contentBriefSchema.index({ accountId: 1, siteId: 1, createdAt: -1, _id: -1 });
contentBriefSchema.index({ accountId: 1, status: 1, updatedAt: 1 });
export type ContentBriefDocument = InferSchemaType<typeof contentBriefSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type ContentBriefHydrated = HydratedDocument<ContentBriefDocument>;
export const ContentBrief = mongoose.model('ContentBrief', contentBriefSchema);
