/**
 * Content Intelligence — analysis document.
 *
 * Owns the workflow state (queued → collecting_owned → ... → completed |
 * partial | failed | cancelled) for one analysis run. Never stores raw HTML
 * or full prose beyond the sanitized brief / draft; excerpts live on the
 * sibling `ContentSnapshot` docs and expire on TTL.
 *
 * Rationale for the split: the Postgres `content_analysis_events` table is
 * the ordered lifecycle + cost event archive; this Mongo doc
 * is the document-shaped workflow state the UI reads. Every downstream
 * consumer (pipeline, workspace, competitor comparison, superadmin, MCP)
 * inherits the split and MUST NOT treat analyses as Postgres rows.
 */
import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
export const CONTENT_ANALYSIS_STATUSES = [
    'queued',
    'collecting_owned',
    'collecting_serp',
    'collecting_competitors',
    'scoring',
    'generating_brief',
    'generating_draft',
    'completed',
    'partial',
    'failed',
    'cancelled',
] as const;
export type ContentAnalysisStatus = (typeof CONTENT_ANALYSIS_STATUSES)[number];
export const CONTENT_ANALYSIS_TERMINAL_STATUSES = [
    'completed',
    'partial',
    'failed',
    'cancelled',
] as const satisfies readonly ContentAnalysisStatus[];
/**
 * True when the analysis is in a state that ACCEPTS a user cancel. Terminal
 * states are already frozen; `generating_draft` is deliberately still
 * cancellable so a user can abort a slow final stage before the draft lands.
 */
export function isContentAnalysisCancellable(status: ContentAnalysisStatus): boolean {
    return !(CONTENT_ANALYSIS_TERMINAL_STATUSES as readonly string[]).includes(status);
}
export const CONTENT_ANALYSIS_ERROR_CATEGORIES = [
    'owned_page_unusable',
    'owned_fetch_failed',
    'provider_unavailable',
    'serp_failed',
    'competitors_failed',
    'scoring_failed',
    'brief_failed',
    'draft_failed',
    'ai_budget_exceeded',
    'cost_ceiling_exceeded',
    'cancelled',
    'unexpected',
] as const;
export type ContentAnalysisErrorCategory = (typeof CONTENT_ANALYSIS_ERROR_CATEGORIES)[number];
export const CONTENT_RECOMMENDATION_STATES = [
    'suggested',
    'accepted',
    'dismissed',
    'applied',
] as const;
export type ContentRecommendationState = (typeof CONTENT_RECOMMENDATION_STATES)[number];
// Fields on `ContentAnalysis` that MUST NOT accept raw HTML at persistence
// time. Applied as a Mongoose schema pre-validate hook so a future change
// cannot silently regress the SEC-OUT / "no raw HTML" boundary.
const HTML_MARKER_PATTERN = /(<\/?script\b|<\/?iframe\b|<!doctype)/i;
const stageSchema = new mongoose.Schema({
    name: {
        type: String,
        enum: CONTENT_ANALYSIS_STATUSES,
        required: true,
    },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    error: { type: String, default: null },
}, { _id: false });
const scorecardSchema = new mongoose.Schema({
    readabilityScore: { type: Number, default: 0, required: true },
    coverageScore: { type: Number, default: 0, required: true },
    structureScore: { type: Number, default: 0, required: true },
    warnings: { type: [String], default: [], required: true },
}, { _id: false });
const briefSectionSchema = new mongoose.Schema({
    heading: { type: String, required: true },
    body: { type: String, required: true },
}, { _id: false });
const briefSchema = new mongoose.Schema({
    versionId: { type: String, required: true },
    sections: { type: [briefSectionSchema], default: [], required: true },
    // Optional AI-generated brief text + citations. Text is
    // treated as untrusted content by every consumer.
    text: { type: String, default: null },
    citations: { type: [String], default: [], required: true },
    profileVersion: { type: String, default: null },
    provider: { type: String, default: null },
}, { _id: false });
const draftSchema = new mongoose.Schema({
    versionId: { type: String, required: true },
    markdown: { type: String, required: true },
    wordCount: { type: Number, default: 0, required: true },
    // Optional AI-generated first-draft text + citations. Text is
    // treated as untrusted content by every consumer.
    text: { type: String, default: null },
    citations: { type: [String], default: [], required: true },
    profileVersion: { type: String, default: null },
    provider: { type: String, default: null },
}, { _id: false });
const draftVersionSchema = new mongoose.Schema({
    versionId: { type: String, required: true },
    markdown: { type: String, required: true },
    wordCount: { type: Number, default: 0, required: true },
    savedAt: { type: Date, required: true },
    actorUserId: { type: String, required: true },
    clientKey: { type: String, required: true },
}, { _id: false });
const briefVersionSchema = new mongoose.Schema({
    versionId: { type: String, required: true },
    sections: { type: [briefSectionSchema], default: [], required: true },
    savedAt: { type: Date, required: true },
    actorUserId: { type: String, required: true },
    clientKey: { type: String, required: true },
}, { _id: false });
const citationSchema = new mongoose.Schema({
    sourceId: { type: String, required: true },
    url: { type: String, required: true },
    title: { type: String, default: null },
}, { _id: false });
const warningEntrySchema = new mongoose.Schema({
    code: { type: String, required: true },
    messageKey: { type: String, required: true },
}, { _id: false });
const providerRefsSchema = new mongoose.Schema({
    firecrawlJobId: { type: String, default: null },
    snapshotIds: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: 'ContentSnapshot',
        default: [],
    },
    serpCacheKey: { type: String, default: null },
}, { _id: false });
const errorInfoSchema = new mongoose.Schema({
    category: {
        type: String,
        enum: CONTENT_ANALYSIS_ERROR_CATEGORIES,
        required: true,
    },
    messageKey: { type: String, required: true },
    retryable: { type: Boolean, default: false, required: true },
    terminal: { type: Boolean, default: true, required: true },
}, { _id: false });
const recommendationStateSchema = new mongoose.Schema({
    recommendationId: { type: String, required: true },
    analysisVersion: { type: String, required: true },
    state: {
        type: String,
        enum: CONTENT_RECOMMENDATION_STATES,
        required: true,
    },
    version: { type: Number, required: true, min: 1 },
    actorUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    stateChangedAt: { type: Date, required: true },
    appliedAt: { type: Date, default: null },
    baselineAnchorAt: { type: Date, default: null },
    contentHash: { type: String, default: null },
    analysisContentHash: { type: String, default: null },
}, { _id: false });
const contentAnalysisSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    ownerUserId: {
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
    // Canonicalized owned URL (normalized origin + path — no fragment; no
    // query stripping). Kept as a string because Mongoose's URL casting is
    // lossy for the origin/path forms we care about here.
    ownedUrl: { type: String, required: true },
    // Canonicalized keyword — whitespace-collapsed, casefolded, control-char
    // stripped by `keywordString` upstream.
    keyword: { type: String, required: true },
    reviewedCompetitorUrls: {
        type: [String],
        default: [],
        required: true,
        validate: {
            validator: (value: string[]) => value.length <= 3,
            message: 'reviewedCompetitorUrls must contain at most 3 URLs',
        },
    },
    reviewedPageMatches: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
        required: true,
    },
    locale: {
        type: String,
        enum: SUPPORTED_LOCALES,
        required: true,
    },
    status: {
        type: String,
        enum: CONTENT_ANALYSIS_STATUSES,
        default: 'queued',
        required: true,
    },
    stages: { type: [stageSchema], default: [], required: true },
    inputFingerprint: { type: String, required: true },
    // Server-namespaced idempotency key (`idem_<43-char base64url HMAC>`,
    // built by `makeIdempotencyKey`). The unique index below enforces
    // one-run-per-key deduplication; it also keys the lifecycle event rows.
    idempotencyKey: { type: String, required: true },
    providerRefs: {
        type: providerRefsSchema,
        default: () => ({ snapshotIds: [] }),
        required: true,
    },
    scorecard: { type: scorecardSchema, default: null },
    brief: { type: briefSchema, default: null },
    briefVersions: { type: [briefVersionSchema], default: [], required: true },
    draft: { type: draftSchema, default: null },
    draftVersions: { type: [draftVersionSchema], default: [], required: true },
    citations: { type: [citationSchema], default: [], required: true },
    warnings: { type: [warningEntrySchema], default: [], required: true },
    error: { type: errorInfoSchema, default: null },
    // Deterministic evidence + rich outputs. Loosely-typed
    // (Mixed) because the concrete shapes are versioned by
    // `content-analysis.schemas.ts` and zod-validated at the pipeline seam
    // — schema-level enforcement here would duplicate that authority.
    owned: { type: mongoose.Schema.Types.Mixed, default: null },
    evidence: { type: mongoose.Schema.Types.Mixed, default: null },
    scorecardV2: { type: mongoose.Schema.Types.Mixed, default: null },
    recommendations: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Efficient current-state projection. Suggested is implicit
    // when no entry exists; every other change is also appended to Postgres.
    recommendationStates: {
        type: [recommendationStateSchema],
        default: [],
        required: true,
    },
    stageLedger: { type: [mongoose.Schema.Types.Mixed], default: [] },
    budgetSpentMicros: { type: Number, default: 0, required: true },
    // Running direct-cost total for the analysis (micros USD). Never exceeds
    // `CONTENT_ANALYSIS_COST_CEILING_MICROS` (the pipeline aborts further
    // spend when a stage would push past the ceiling).
    costMicros: { type: Number, default: 0, required: true },
    aiCostMicros: { type: Number, default: 0, required: true },
    requestedAt: { type: Date, required: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
}, { timestamps: true });
// One-run-per-key idempotency — a fresh POST with the same idempotency key
// returns the existing analysis instead of starting a second run. A
// regeneration always derives a NEW key, so a completed analysis never
// blocks it.
contentAnalysisSchema.index({ accountId: 1, siteId: 1, idempotencyKey: 1 }, { unique: true });
contentAnalysisSchema.index({ accountId: 1, siteId: 1, requestedAt: -1 });
contentAnalysisSchema.index({ accountId: 1, siteId: 1, ownedUrl: 1, requestedAt: -1 });
contentAnalysisSchema.index({ status: 1, requestedAt: 1 });
contentAnalysisSchema.index({ accountId: 1, 'recommendationStates.state': 1 });
contentAnalysisSchema.pre('validate', function pre() {
    // Belt-and-braces SEC-OUT guard — every derived text field that a
    // downstream writer might populate is checked for HTML markers so a
    // regression cannot land a raw script/iframe in workflow state.
    const doc = this as ContentAnalysisHydrated;
    const checks: Array<{
        path: string;
        value: string | null | undefined;
    }> = [
        { path: 'ownedUrl', value: doc.ownedUrl },
        { path: 'keyword', value: doc.keyword },
        { path: 'draft.markdown', value: doc.draft?.markdown },
        ...(doc.brief?.sections ?? []).flatMap((section, index) => [
            { path: `brief.sections.${index}.heading`, value: section.heading },
            { path: `brief.sections.${index}.body`, value: section.body },
        ]),
        ...doc.briefVersions.flatMap((version, versionIndex) => version.sections.flatMap((section, sectionIndex) => [
            {
                path: `briefVersions.${versionIndex}.sections.${sectionIndex}.heading`,
                value: section.heading,
            },
            {
                path: `briefVersions.${versionIndex}.sections.${sectionIndex}.body`,
                value: section.body,
            },
        ])),
        ...doc.draftVersions.map((version, index) => ({
            path: `draftVersions.${index}.markdown`,
            value: version.markdown,
        })),
    ];
    for (const c of checks) {
        if (typeof c.value === 'string' && HTML_MARKER_PATTERN.test(c.value)) {
            doc.invalidate(c.path, `contentAnalysis.${c.path} must not contain raw HTML markers`);
        }
    }
});
export type ContentAnalysisDocument = InferSchemaType<typeof contentAnalysisSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type ContentAnalysisHydrated = HydratedDocument<ContentAnalysisDocument>;
export const ContentAnalysis = mongoose.model('ContentAnalysis', contentAnalysisSchema);
