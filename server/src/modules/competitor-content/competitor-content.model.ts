/**
 * Competitor content intelligence — Mongo documents.
 *
 * Three collections, mirroring the content-inventory pattern:
 *   - `CompetitorContentRun` — workflow state for one competitor content
 *     comparison run. Embeds the deterministic findings as
 *     a Mixed field, zod-validated at the pipeline seam
 *     (`competitor-content.schemas.ts`).
 *   - `CompetitorPageFacts` — one row per scraped page (owned or competitor),
 *     DERIVED FACTS + HASHES + a bounded snippet ONLY. Never raw HTML, never
 *     substantial competitor prose.
 *   - `CompetitorContentSnapshot` — sanitized, length-capped excerpts on a
 *     7-day Mongo TTL (mirrors `content-snapshot.model.ts`).
 *
 * Every derived text field is checked for raw-HTML markers in a pre-validate
 * hook so a downstream regression cannot land a `<script>`/`<iframe>` in
 * workflow state (SEC-OUT / no-raw-HTML). The workflow-state run
 * + page facts are nested-document-heavy, so they stay in Mongo per the
 * drizzle-postgres-scope rule; the relational competitor catalog + the ordered
 * event log live in Postgres.
 */
import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import { frozenCompetitorPageMatchSchema } from './competitor-content.schemas.js';
export const COMPETITOR_CONTENT_STATUSES = [
    'queued',
    'collecting',
    'comparing',
    'completed',
    'partial',
    'failed',
    'cancelled',
] as const;
export type CompetitorContentStatus = (typeof COMPETITOR_CONTENT_STATUSES)[number];
export const COMPETITOR_CONTENT_TERMINAL_STATUSES = [
    'completed',
    'partial',
    'failed',
    'cancelled',
] as const satisfies readonly CompetitorContentStatus[];
export const COMPETITOR_CONTENT_ERROR_CATEGORIES = [
    'no_confirmed_competitors',
    'owned_page_unusable',
    'no_comparable_pages',
    'collection_failed',
    'comparison_failed',
    'cost_ceiling_exceeded',
    'cancelled',
    'unexpected',
] as const;
export type CompetitorContentErrorCategory = (typeof COMPETITOR_CONTENT_ERROR_CATEGORIES)[number];
const HTML_MARKER_PATTERN = /(<\/?script\b|<\/?iframe\b|<!doctype)/i;
const stageSchema = new mongoose.Schema({
    name: { type: String, enum: COMPETITOR_CONTENT_STATUSES, required: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    error: { type: String, default: null },
}, { _id: false });
const inputSchema = new mongoose.Schema({
    competitorIds: { type: [String], default: [], required: true },
    competitorDomains: { type: [String], default: [], required: true },
    pageLimit: { type: Number, required: true, min: 1 },
    pageMatches: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
        required: true,
        validate: {
            validator: (value: unknown[]) => value.length <= 15 &&
                value.every((item) => frozenCompetitorPageMatchSchema.safeParse(item).success),
            message: 'pageMatches must contain at most 15 frozen reviewed pages',
        },
    },
    compatibilityMode: {
        type: String,
        enum: ['reviewed_pages', 'legacy_explicit', 'historical_origin'],
        required: true,
        default: 'reviewed_pages',
    },
}, { _id: false });
const progressSchema = new mongoose.Schema({
    competitorsRequested: { type: Number, default: 0, required: true },
    competitorsProcessed: { type: Number, default: 0, required: true },
    competitorsFailed: { type: Number, default: 0, required: true },
    pagesScraped: { type: Number, default: 0, required: true },
}, { _id: false });
const warningEntrySchema = new mongoose.Schema({
    code: { type: String, required: true },
    messageKey: { type: String, required: true },
}, { _id: false });
const errorInfoSchema = new mongoose.Schema({
    category: {
        type: String,
        enum: COMPETITOR_CONTENT_ERROR_CATEGORIES,
        required: true,
    },
    messageKey: { type: String, required: true },
    retryable: { type: Boolean, default: false, required: true },
    terminal: { type: Boolean, default: true, required: true },
}, { _id: false });
const competitorContentRunSchema = new mongoose.Schema({
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
    origin: { type: String, required: true },
    ownedUrl: { type: String, required: true },
    keyword: { type: String, default: null },
    locale: { type: String, enum: SUPPORTED_LOCALES, required: true },
    status: {
        type: String,
        enum: COMPETITOR_CONTENT_STATUSES,
        default: 'queued',
        required: true,
    },
    input: { type: inputSchema, required: true },
    progress: { type: progressSchema, default: () => ({}), required: true },
    stages: { type: [stageSchema], default: [], required: true },
    warnings: { type: [warningEntrySchema], default: [], required: true },
    error: { type: errorInfoSchema, default: null },
    inputFingerprint: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    thresholdsVersion: { type: String, default: null },
    // Deterministic findings — Mixed because the concrete shape is versioned by
    // `competitor-content.schemas.ts` and zod-validated at the pipeline seam.
    findings: { type: mongoose.Schema.Types.Mixed, default: null },
    costMicros: { type: Number, default: 0, required: true },
    aiCostMicros: { type: Number, default: 0, required: true },
    requestedAt: { type: Date, required: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
}, { timestamps: true });
competitorContentRunSchema.index({ accountId: 1, siteId: 1, idempotencyKey: 1 }, { unique: true });
competitorContentRunSchema.index({ accountId: 1, siteId: 1, requestedAt: -1 });
competitorContentRunSchema.index({ status: 1, requestedAt: 1 });
competitorContentRunSchema.pre('validate', function pre() {
    const doc = this as CompetitorContentRunHydrated;
    if (typeof doc.origin === 'string' && HTML_MARKER_PATTERN.test(doc.origin)) {
        doc.invalidate('origin', 'competitorContentRun.origin must not contain raw HTML markers');
    }
    for (const match of doc.input.pageMatches) {
        frozenCompetitorPageMatchSchema.parse(match);
    }
});
export type CompetitorContentRunDocument = InferSchemaType<typeof competitorContentRunSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type CompetitorContentRunHydrated = HydratedDocument<CompetitorContentRunDocument>;
export const CompetitorContentRun = mongoose.model('CompetitorContentRun', competitorContentRunSchema);
// ---------------------------------------------------------------------------
// Per-page derived facts — NO raw HTML.
// ---------------------------------------------------------------------------
const competitorPageFactsDocSchema = new mongoose.Schema({
    runId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CompetitorContentRun',
        required: true,
        index: true,
    },
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    role: { type: String, enum: ['owned', 'competitor'], required: true },
    // Derived facts (zod shape `competitorPageFactsSchema`) — Mixed for the same
    // versioned-at-the-seam reason as the run findings.
    facts: { type: mongoose.Schema.Types.Mixed, required: true },
    url: { type: String, required: true },
    contentHash: { type: String, required: true },
    createdAtMs: { type: Number, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
competitorPageFactsDocSchema.index({ runId: 1, url: 1 }, { unique: true });
competitorPageFactsDocSchema.pre('validate', function pre() {
    const doc = this as CompetitorPageFactsHydrated;
    if (typeof doc.url === 'string' && HTML_MARKER_PATTERN.test(doc.url)) {
        doc.invalidate('url', 'competitorPageFacts.url must not contain raw HTML markers');
    }
});
export type CompetitorPageFactsDocument = InferSchemaType<typeof competitorPageFactsDocSchema> & {
    createdAt: Date;
};
export type CompetitorPageFactsHydrated = HydratedDocument<CompetitorPageFactsDocument>;
export const CompetitorPageFacts = mongoose.model('CompetitorPageFacts', competitorPageFactsDocSchema);
// ---------------------------------------------------------------------------
// Sanitized excerpt snapshot — 7-day Mongo TTL (mirrors content-snapshot).
// ---------------------------------------------------------------------------
export const COMPETITOR_CONTENT_SNAPSHOT_MAX_EXCERPT_CHARS = COMPETITOR_CONTENT_SNIPPET_MAX_CHARS;
const competitorContentSnapshotSchema = new mongoose.Schema({
    runId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CompetitorContentRun',
        required: true,
        index: true,
    },
    sourceUrl: { type: String, required: true },
    excerpt: {
        type: String,
        required: true,
        maxlength: COMPETITOR_CONTENT_SNAPSHOT_MAX_EXCERPT_CHARS,
    },
    contentHash: { type: String, required: true },
    retrievedAt: { type: Date, required: true },
    // Mongo TTL — reaped as soon as `expiryAt` is in the past.
    expiryAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
competitorContentSnapshotSchema.pre('validate', function pre() {
    const doc = this as CompetitorContentSnapshotHydrated;
    if (typeof doc.excerpt === 'string' && HTML_MARKER_PATTERN.test(doc.excerpt)) {
        doc.invalidate('excerpt', 'competitorContentSnapshot.excerpt must not contain raw HTML markers');
    }
});
competitorContentSnapshotSchema.index({ expiryAt: 1 }, { expireAfterSeconds: 0 });
competitorContentSnapshotSchema.index({ runId: 1, sourceUrl: 1 });
export type CompetitorContentSnapshotDocument = InferSchemaType<typeof competitorContentSnapshotSchema> & {
    createdAt: Date;
};
export type CompetitorContentSnapshotHydrated = HydratedDocument<CompetitorContentSnapshotDocument>;
export const CompetitorContentSnapshot = mongoose.model('CompetitorContentSnapshot', competitorContentSnapshotSchema);
import { COMPETITOR_CONTENT_SNIPPET_MAX_CHARS } from '../../shared/safety/feature-limits.js';
