/**
 * Stored cannibalization reports.
 *
 * A report is an immutable snapshot of what the site's stored Search Console
 * `query,page` rows said at generation time. Re-opening one is free, so the
 * candidates and their per-page metrics are embedded rather than recomputed —
 * a later sync must never silently rewrite what the user already read.
 */
import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { CANNIBALIZATION_CONFIDENCE_LEVELS } from '../../shared/cannibalization/index.js';
const PRIMARY_PAGE_REASONS = ['most_clicks', 'best_position', 'stable_order'] as const;
const candidatePageSchema = new mongoose.Schema({
    url: { type: String, required: true },
    clicks: { type: Number, required: true },
    impressions: { type: Number, required: true },
    position: { type: Number, required: true },
    /** Share of the query's clicks held by this page (0..1). */
    clickShare: { type: Number, required: true },
    /** Share of the query's impressions held by this page (0..1). */
    impressionShare: { type: Number, required: true },
    isPrimary: { type: Boolean, required: true },
}, { _id: false });
const candidateSchema = new mongoose.Schema({
    candidateId: { type: String, required: true },
    query: { type: String, required: true },
    confidence: {
        type: String,
        enum: CANNIBALIZATION_CONFIDENCE_LEVELS,
        required: true,
    },
    totalClicks: { type: Number, required: true },
    totalImpressions: { type: Number, required: true },
    primaryUrl: { type: String, required: true },
    primaryReason: { type: String, enum: PRIMARY_PAGE_REASONS, required: true },
    pages: { type: [candidatePageSchema], required: true },
}, { _id: false });
const reportSchema = new mongoose.Schema({
    // Better Auth user id. Every query filters by it — cross-account reads are
    // 404s, never 403s.
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    /** Aggregation window of the stored rows the report was computed from. */
    windowDays: { type: Number, required: true },
    /** `YYYY-MM-DD` end date of the snapshot the report read — the last sync. */
    snapshotDate: { type: String, required: true },
    queriesAnalyzed: { type: Number, required: true },
    pagesInvolved: { type: Number, required: true },
    candidates: { type: [candidateSchema], required: true },
}, { timestamps: true });
// Newest-first per site, owner-scoped — the list endpoint's only access path.
reportSchema.index({ accountId: 1, siteId: 1, createdAt: -1 });
export type CannibalizationReportDocument = InferSchemaType<typeof reportSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type CannibalizationReportHydrated = HydratedDocument<CannibalizationReportDocument>;
export const CannibalizationReport = mongoose.model('CannibalizationReport', reportSchema);
export { PRIMARY_PAGE_REASONS };
