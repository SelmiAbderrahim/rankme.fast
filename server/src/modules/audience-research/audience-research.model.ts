/**
 * Audience Research — durable workflow document.
 *
 * State machine (locked): queued → discovering → selecting → collecting →
 * clustering → completed | partial | failed. See `audience-research.state.ts`
 * for the transition guard. Terminal states are immutable.
 *
 * Persisted evidence is bounded: canonical URL, safe title, source type,
 * registrable domain, nullable observedAt, ObservationMeta, contentHash, and
 * an output-encoded excerpt ≤ 500 chars. Raw HTML, full page text, raw SERP
 * envelopes, request headers, and prompts NEVER touch this document.
 */
import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
import { AUDIENCE_RESEARCH_STATES, TERMINAL_STATES, type AudienceResearchState, } from './audience-research.state.js';
import { EXCERPT_MAX_LENGTH } from './excerpt.js';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
export const AUDIENCE_RESEARCH_SIGNAL_TYPES = [
    'complaint',
    'request',
    'question',
    'competitor_gap',
] as const;
export type AudienceResearchSignalType = (typeof AUDIENCE_RESEARCH_SIGNAL_TYPES)[number];
export const AUDIENCE_RESEARCH_SUGGESTED_ROUTES = [
    'content',
    'comparison_page',
    'product',
    'seo',
] as const;
export type AudienceResearchSuggestedRoute = (typeof AUDIENCE_RESEARCH_SUGGESTED_ROUTES)[number];
export const AUDIENCE_RESEARCH_CONFIDENCE = ['high', 'medium', 'low'] as const;
export type AudienceResearchConfidence = (typeof AUDIENCE_RESEARCH_CONFIDENCE)[number];
export const AUDIENCE_RESEARCH_SOURCE_TYPES = [
    'forum',
    'review',
    'comparison',
    'question',
    'other',
] as const;
export type AudienceResearchSourceType = (typeof AUDIENCE_RESEARCH_SOURCE_TYPES)[number];
export const AUDIENCE_RESEARCH_LEDGER_STAGES = [
    'discovery',
    'collect',
    'cluster',
] as const;
export type AudienceResearchLedgerStage = (typeof AUDIENCE_RESEARCH_LEDGER_STAGES)[number];
export const AUDIENCE_RESEARCH_LEDGER_OUTCOMES = [
    'ok',
    'ceiling_stop',
    'provider_error',
    'unavailable',
] as const;
export type AudienceResearchLedgerOutcome = (typeof AUDIENCE_RESEARCH_LEDGER_OUTCOMES)[number];
export const AUDIENCE_RESEARCH_TERMINAL_REASON_CODES = [
    'ok',
    'no_usable_public_evidence',
    'cost_ceiling_partial',
    'ai_dispatch_indeterminate',
    'processing_failure',
    'unsupported_market',
    'zdr_blocked',
] as const;
export type AudienceResearchTerminalReasonCode = (typeof AUDIENCE_RESEARCH_TERMINAL_REASON_CODES)[number];
// Guard against a downstream prompt regressing the SEC-OUT boundary by
// persisting raw script/iframe/doctype markers on any excerpt or bounded text.
const HTML_MARKER_PATTERN = /(<\/?script\b|<\/?iframe\b|<!doctype)/i;
const observationMetaSchema = new mongoose.Schema({
    sourceKind: { type: String, required: true },
    sourceLabel: { type: String, default: null },
    observedAt: { type: String, required: true },
    freshUntil: { type: String, default: null },
    freshness: { type: String, required: true },
    market: { type: mongoose.Schema.Types.Mixed, default: null },
    sampleCount: { type: Number, required: true },
    coverageNoteKey: { type: String, default: null },
}, { _id: false });
const siteMarketSchema = new mongoose.Schema({
    country: { type: String, required: true },
    region: { type: String, default: null },
    city: { type: String, default: null },
    language: { type: String, required: true },
    device: { type: String, enum: ['desktop', 'mobile', 'all'], required: true },
}, { _id: false });
const runInputSchema = new mongoose.Schema({
    siteMarket: { type: siteMarketSchema, required: true },
    competitorDomains: { type: [String], default: [], required: true },
    seedTopics: { type: [String], default: [], required: true },
    queryTemplateVersion: { type: Number, required: true },
    /** Frozen generated-prose locale; null only on legacy documents. */
    outputLocale: { type: String, enum: SUPPORTED_LOCALES, default: null },
}, { _id: false });
const generatedQuerySchema = new mongoose.Schema({
    id: { type: String, required: true },
    text: { type: String, required: true, maxlength: 700 },
    templateId: { type: String, required: true },
    category: { type: String, required: true },
}, { _id: false });
const discoverySchema = new mongoose.Schema({
    queries: { type: [generatedQuerySchema], default: [], required: true },
    resultCount: { type: Number, default: 0, required: true },
    costMicros: { type: Number, default: 0, required: true },
    coverage: { type: observationMetaSchema, default: null },
}, { _id: false });
const candidateSchema = new mongoose.Schema({
    canonicalUrl: { type: String, required: true, maxlength: 2048 },
    title: { type: String, required: true, maxlength: 160 },
    sourceType: {
        type: String,
        enum: AUDIENCE_RESEARCH_SOURCE_TYPES,
        required: true,
    },
    registrableDomain: { type: String, required: true, maxlength: 253 },
    observedAt: { type: String, default: null },
    organicPosition: { type: Number, required: true },
    discoveryQueryIds: { type: [String], default: [], required: true },
}, { _id: false });
const sourceSchema = new mongoose.Schema({
    sourceId: { type: String, required: true },
    canonicalUrl: { type: String, required: true, maxlength: 2048 },
    title: { type: String, required: true, maxlength: 160 },
    sourceType: {
        type: String,
        enum: AUDIENCE_RESEARCH_SOURCE_TYPES,
        required: true,
    },
    registrableDomain: { type: String, required: true, maxlength: 253 },
    observedAt: { type: String, default: null },
    contentHash: { type: String, required: true, maxlength: 128 },
    excerpt: { type: String, required: true, maxlength: EXCERPT_MAX_LENGTH },
    observationMeta: { type: observationMetaSchema, required: true },
    discoveryQueryIds: { type: [String], default: [], required: true },
}, { _id: false });
const signalSchema = new mongoose.Schema({
    signalId: { type: String, required: true },
    type: {
        type: String,
        enum: AUDIENCE_RESEARCH_SIGNAL_TYPES,
        required: true,
    },
    title: { type: String, required: true, maxlength: 120 },
    summary: { type: String, required: true, maxlength: 500 },
    suggestedRoute: {
        type: String,
        enum: AUDIENCE_RESEARCH_SUGGESTED_ROUTES,
        required: true,
    },
    citedSourceIds: { type: [String], required: true },
    independentDomainCount: { type: Number, required: true },
    sourceTypeCount: { type: Number, required: true },
    mostRecentSourceObservedAt: { type: String, default: null },
    confidence: {
        type: String,
        enum: AUDIENCE_RESEARCH_CONFIDENCE,
        required: true,
    },
}, { _id: false });
const costLedgerEntrySchema = new mongoose.Schema({
    stage: {
        type: String,
        enum: AUDIENCE_RESEARCH_LEDGER_STAGES,
        required: true,
    },
    operationCounts: { type: mongoose.Schema.Types.Mixed, default: {}, required: true },
    estimatedCostMicros: { type: Number, required: true, min: 0 },
    actualCostMicros: { type: Number, required: true, min: 0 },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    outcome: {
        type: String,
        enum: AUDIENCE_RESEARCH_LEDGER_OUTCOMES,
        required: true,
    },
}, { _id: false });
const aiClusteringSchema = new mongoose.Schema({
    profileVersion: { type: String, default: null },
    idempotencyKey: { type: String, default: null },
    claimedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    resultDigest: { type: String, default: null, maxlength: 128 },
}, { _id: false });
const terminalSchema = new mongoose.Schema({
    state: { type: String, enum: TERMINAL_STATES, default: null },
    reasonCode: {
        type: String,
        enum: AUDIENCE_RESEARCH_TERMINAL_REASON_CODES,
        default: null,
    },
    completedAt: { type: Date, default: null },
}, { _id: false });
const audienceResearchRunSchema = new mongoose.Schema({
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
    },
    state: {
        type: String,
        enum: AUDIENCE_RESEARCH_STATES,
        default: 'queued',
        required: true,
    },
    input: { type: runInputSchema, required: true },
    deterministicInputHash: { type: String, required: true, maxlength: 128 },
    discovery: { type: discoverySchema, default: () => ({ queries: [], resultCount: 0, costMicros: 0 }) },
    candidates: { type: [candidateSchema], default: [], required: true },
    sources: { type: [sourceSchema], default: [], required: true },
    signals: { type: [signalSchema], default: [], required: true },
    costLedger: { type: [costLedgerEntrySchema], default: [], required: true },
    aiClustering: {
        type: aiClusteringSchema,
        default: () => ({
            profileVersion: null,
            idempotencyKey: null,
            claimedAt: null,
            resolvedAt: null,
            resultDigest: null,
        }),
    },
    terminal: {
        type: terminalSchema,
        default: () => ({ state: null, reasonCode: null, completedAt: null }),
    },
    requestedAt: { type: Date, required: true, default: () => new Date() },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
}, { timestamps: true });
audienceResearchRunSchema.index({ accountId: 1, siteId: 1, createdAt: -1 });
audienceResearchRunSchema.index({ accountId: 1, deterministicInputHash: 1 }, { unique: true });
audienceResearchRunSchema.index({ state: 1, updatedAt: -1 });
audienceResearchRunSchema.pre('validate', function pre() {
    const doc = this as AudienceResearchRunHydrated;
    const textFields: Array<{
        path: string;
        value: string | null | undefined;
    }> = [];
    for (const s of doc.sources) {
        textFields.push({ path: 'sources.title', value: s.title });
        textFields.push({ path: 'sources.excerpt', value: s.excerpt });
    }
    for (const s of doc.signals) {
        textFields.push({ path: 'signals.title', value: s.title });
        textFields.push({ path: 'signals.summary', value: s.summary });
    }
    for (const c of doc.candidates) {
        textFields.push({ path: 'candidates.title', value: c.title });
    }
    for (const f of textFields) {
        if (typeof f.value === 'string' && HTML_MARKER_PATTERN.test(f.value)) {
            doc.invalidate(f.path, `audienceResearch.${f.path} must not contain raw HTML markers`);
        }
    }
});
export function isTerminalState(state: AudienceResearchState): boolean {
    return (TERMINAL_STATES as readonly string[]).includes(state);
}
export type AudienceResearchRunDocument = InferSchemaType<typeof audienceResearchRunSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type AudienceResearchRunHydrated = HydratedDocument<AudienceResearchRunDocument>;
export const AudienceResearchRun = mongoose.model('AudienceResearchRun', audienceResearchRunSchema);
