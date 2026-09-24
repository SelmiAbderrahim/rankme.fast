/** Stored immutable suggestion-run snapshots. Re-open and CSV reads are free. */
import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import { INTERNAL_LINK_AI_STATUSES, INTERNAL_LINK_CONFIDENCES, INTERNAL_LINK_ERROR_CATEGORIES, INTERNAL_LINK_MAX_ANCHOR_CODE_POINTS, INTERNAL_LINK_MAX_CANDIDATES, INTERNAL_LINK_MAX_EVIDENCE_ITEMS, INTERNAL_LINK_RANKING_SOURCES, INTERNAL_LINK_RUN_STATUSES, INTERNAL_LINK_TARGET_FLAGS, } from './internal-links.schemas.js';
const codePointBound = (value: string): boolean => [...value].length <= INTERNAL_LINK_MAX_ANCHOR_CODE_POINTS;
const suggestionSchema = new mongoose.Schema({
    id: { type: String, required: true },
    sourceUrl: { type: String, required: true },
    sourceSection: { type: String, required: true },
    sourceWordCount: { type: Number, required: true, min: 0 },
    targetUrl: { type: String, required: true },
    targetFlag: { type: String, enum: INTERNAL_LINK_TARGET_FLAGS, required: true },
    targetInboundCount: { type: Number, required: true, min: 0, max: 1 },
    confidence: { type: String, enum: INTERNAL_LINK_CONFIDENCES, required: true },
    sharedQueries: {
        type: [String],
        required: true,
        validate: (values: string[]) => values.length <= INTERNAL_LINK_MAX_EVIDENCE_ITEMS,
    },
    headingMatches: {
        type: [String],
        required: true,
        validate: (values: string[]) => values.length <= INTERNAL_LINK_MAX_EVIDENCE_ITEMS,
    },
    anchorText: {
        type: String,
        required: true,
        validate: codePointBound,
    },
    inventoryDate: { type: Date, required: true },
    rank: { type: Number, default: null, min: 1, max: INTERNAL_LINK_MAX_CANDIDATES },
    rankingSource: {
        type: String,
        enum: INTERNAL_LINK_RANKING_SOURCES,
        required: true,
    },
}, { _id: false });
const errorSchema = new mongoose.Schema({
    category: { type: String, enum: INTERNAL_LINK_ERROR_CATEGORIES, required: true },
    messageKey: { type: String, required: true },
}, { _id: false });
const internalLinkRunSchema = new mongoose.Schema({
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
    inventoryRunId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ContentInventoryRun',
        required: true,
    },
    inventoryDate: { type: Date, required: true },
    gscSnapshotDate: { type: String, default: null },
    candidateRulesVersion: { type: String, required: true },
    locale: { type: String, enum: SUPPORTED_LOCALES, required: true },
    status: {
        type: String,
        enum: INTERNAL_LINK_RUN_STATUSES,
        default: 'queued',
        required: true,
    },
    aiStatus: {
        type: String,
        enum: INTERNAL_LINK_AI_STATUSES,
        default: 'pending',
        required: true,
    },
    suggestions: {
        type: [suggestionSchema],
        default: [],
        required: true,
        validate: (values: unknown[]) => values.length <= INTERNAL_LINK_MAX_CANDIDATES,
    },
    error: { type: errorSchema, default: null },
    aiCostMicros: { type: Number, default: 0, min: 0, required: true },
    requestedAt: { type: Date, required: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
}, { timestamps: true });
internalLinkRunSchema.index({ accountId: 1, siteId: 1, requestedAt: -1 });
internalLinkRunSchema.index({ status: 1, requestedAt: 1 });
export type InternalLinkRunDocument = InferSchemaType<typeof internalLinkRunSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type InternalLinkRunHydrated = HydratedDocument<InternalLinkRunDocument>;
export const InternalLinkRun = mongoose.model('InternalLinkRun', internalLinkRunSchema);
