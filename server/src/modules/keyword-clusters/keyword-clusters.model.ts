/**
 * Stored immutable cluster-run snapshots.
 *
 * Mongo, not Postgres: a run is a bounded aggregate document with nested
 * cluster/member arrays and no ordered-time-series query
 * (`.claude/rules/drizzle-postgres-scope.md`). No Drizzle migration ships with
 * this feature. Re-opening a stored run is free.
 */
import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import { KEYWORD_CLUSTER_AI_STATUSES, KEYWORD_CLUSTER_BLOCK_REASONS, KEYWORD_CLUSTER_ERROR_CATEGORIES, KEYWORD_CLUSTER_MAX_CLUSTERS, KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN, KEYWORD_CLUSTER_MAX_LABEL_CODE_POINTS, KEYWORD_CLUSTER_MAX_SHARED_URLS_STORED, KEYWORD_CLUSTER_RUN_STATUSES, codePointLength, } from './keyword-clusters.schemas.js';
// `label` is nullable, and Mongoose runs a path validator for the null default
// too — so the bound has to accept it rather than index into it.
const labelBound = (value: string | null): boolean => value === null ||
    codePointLength(value) <= KEYWORD_CLUSTER_MAX_LABEL_CODE_POINTS;
const sharedUrlsBound = (values: string[]): boolean => values.length <= KEYWORD_CLUSTER_MAX_SHARED_URLS_STORED;
const memberSchema = new mongoose.Schema({
    keywordId: { type: String, required: true },
    phrase: { type: String, required: true },
    observedAt: { type: Date, required: true },
    isPivot: { type: Boolean, required: true },
    sharedUrls: { type: [String], required: true, validate: sharedUrlsBound },
    sharedUrlCount: { type: Number, required: true, min: 0 },
}, { _id: false });
const clusterSchema = new mongoose.Schema({
    id: { type: String, required: true },
    size: { type: Number, required: true, min: 1 },
    pivotKeywordId: { type: String, required: true },
    sharedUrls: { type: [String], required: true, validate: sharedUrlsBound },
    members: {
        type: [memberSchema],
        required: true,
        validate: (values: unknown[]) => values.length >= 1 && values.length <= KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN,
    },
    label: { type: String, default: null, validate: labelBound },
    labelSource: { type: String, enum: ['ai', null], default: null },
}, { _id: false });
const blockedSchema = new mongoose.Schema({
    keywordId: { type: String, required: true },
    phrase: { type: String, required: true },
    reason: { type: String, enum: KEYWORD_CLUSTER_BLOCK_REASONS, required: true },
    observedAt: { type: Date, default: null },
}, { _id: false });
const inputSchema = new mongoose.Schema({
    keywordId: { type: String, required: true },
    phrase: { type: String, required: true },
    observedAt: { type: Date, required: true },
    topUrls: {
        type: [String],
        required: true,
        validate: sharedUrlsBound,
    },
}, { _id: false });
const errorSchema = new mongoose.Schema({
    category: {
        type: String,
        enum: KEYWORD_CLUSTER_ERROR_CATEGORIES,
        required: true,
    },
    messageKey: { type: String, required: true },
}, { _id: false });
const keywordClusterRunSchema = new mongoose.Schema({
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
    locale: { type: String, enum: SUPPORTED_LOCALES, required: true },
    status: {
        type: String,
        enum: KEYWORD_CLUSTER_RUN_STATUSES,
        default: 'queued',
        required: true,
    },
    aiStatus: {
        type: String,
        enum: KEYWORD_CLUSTER_AI_STATUSES,
        default: 'pending',
        required: true,
    },
    rulesVersion: { type: String, required: true },
    // Frozen per run: an operator changing the shipped constant later must not
    // silently restate an old run's grouping.
    minSharedUrls: { type: Number, required: true, min: 1 },
    topUrlWindow: { type: Number, required: true, min: 1 },
    keywordCount: { type: Number, required: true, min: 0 },
    blockedCount: { type: Number, required: true, min: 0, default: 0 },
    // The exact ready keyword set pinned at run creation, so a later rank
    // check cannot rewrite an accepted run.
    keywordIds: {
        type: [String],
        required: true,
        default: [],
        validate: (values: unknown[]) => values.length <= KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN,
    },
    // Immutable evidence accepted by the preview/start transaction. Processors
    // consume this snapshot, never a newer or newly-stale observation.
    inputs: {
        type: [inputSchema],
        required: true,
        default: [],
        validate: (values: unknown[]) => values.length <= KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN,
    },
    blocked: { type: [blockedSchema], default: [], required: true },
    clusters: {
        type: [clusterSchema],
        default: [],
        required: true,
        validate: (values: unknown[]) => values.length <= KEYWORD_CLUSTER_MAX_CLUSTERS,
    },
    aiCostMicros: { type: Number, default: 0, min: 0, required: true },
    error: { type: errorSchema, default: null },
    requestedAt: { type: Date, required: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
}, { timestamps: true });
keywordClusterRunSchema.index({ accountId: 1, siteId: 1, requestedAt: -1 });
keywordClusterRunSchema.index({ status: 1, requestedAt: 1 });
export type SerpClusterRunDocument = InferSchemaType<typeof keywordClusterRunSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type SerpClusterRunHydrated = HydratedDocument<SerpClusterRunDocument>;
export const SerpClusterRun = mongoose.model('SerpClusterRun', keywordClusterRunSchema);
