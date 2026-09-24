/**
 * Keyword Trends exploration runs. Mongoose document store —
 * Postgres already carries the vendor-cache row for the raw provider payload;
 * this collection is the account-scoped run ledger the API surfaces to the
 * client.
 *
 * SEC-OUT: raw rising/related query strings are NEVER persisted here — they
 * live only on the vendor-cache archive/read-through row (Postgres) and are
 * length-clamped on read. This document keeps summary counts only.
 */
import { Schema, model, type InferSchemaType } from 'mongoose';
export const TRENDS_EXPLORATION_STATUSES = [
    'queued',
    'running',
    'succeeded',
    'failed',
] as const;
export type TrendsExplorationStatus = (typeof TRENDS_EXPLORATION_STATUSES)[number];
export const trendsExplorationRunSchema = new Schema({
    accountId: { type: String, required: true, index: true },
    siteId: { type: String, default: null, index: true },
    inputs: {
        keywords: { type: [String], required: true },
        geo: { type: String, default: null },
        language: { type: String, default: null },
    },
    status: {
        type: String,
        enum: TRENDS_EXPLORATION_STATUSES,
        required: true,
        index: true,
    },
    retained: { type: Boolean, required: true, default: false },
    errorCode: { type: String, default: null },
    completedAt: { type: Date, default: null },
    seriesCount: { type: Number, default: 0 },
    relatedQueryCount: { type: Number, default: 0 },
}, { timestamps: true, collection: 'trends_exploration_runs' });
// Compound index for the paginated list-for-account query.
trendsExplorationRunSchema.index({ accountId: 1, createdAt: -1 });
export type TrendsExplorationRunDoc = InferSchemaType<typeof trendsExplorationRunSchema>;
export const TrendsExplorationRun = model('TrendsExplorationRun', trendsExplorationRunSchema);
