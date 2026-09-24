/**
 * Immutable Mongo record of a cited AI clustering pass.
 *
 * A `runId` is `sha256(accountId|locationCode|languageCode|sortedNormalizedPhrases)`
 * Identical rerun returns the stored run as a free read; the
 * `pre('save')` hook below refuses any second save on the same document so an
 * accidental `save()` after mutation is a loud failure rather than silent
 * history rewrite. No raw vendor envelope, no system prompt, no AI debug
 * payload is stored — only the versioned profile, deterministic ordering, and
 * account-owned data.
 */
import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
const memberRefSchema = new mongoose.Schema({
    keyword: { type: String, required: true, trim: true, lowercase: true },
    source: { type: String, required: true, enum: ['vendor_cache', 'history'] as const },
    observedAt: { type: Date, required: true },
}, { _id: false });
const clusterSchema = new mongoose.Schema({
    clusterId: { type: String, required: true },
    label: { type: String, required: true, trim: true },
    memberKeywords: { type: [String], required: true, default: [] },
    suggestedRoute: { type: String, required: true, enum: ['brief', 'seo'] as const },
    confidence: { type: String, required: true, enum: ['low', 'medium', 'high'] as const },
    summedSearchVolume: { type: Number, required: true, min: 0 },
}, { _id: false });
const marketSchema = new mongoose.Schema({
    locationCode: { type: Number, required: true, min: 1 },
    languageCode: { type: String, required: true, lowercase: true, trim: true },
}, { _id: false });
const aiProfileSchema = new mongoose.Schema({
    name: { type: String, required: true },
    version: { type: String, required: true },
}, { _id: false });
const keywordClusterRunSchema = new mongoose.Schema({
    runId: { type: String, required: true, unique: true, index: true },
    accountId: { type: String, required: true, index: true },
    market: { type: marketSchema, required: true },
    memberRefs: { type: [memberRefSchema], required: true, default: [] },
    clusters: { type: [clusterSchema], required: true, default: [] },
    aiProfile: { type: aiProfileSchema, required: true },
    costMicros: { type: Number, required: true, min: 0 },
}, { timestamps: { createdAt: true, updatedAt: false } });
// Immutability: refuse a second save on the same document. `isNew` is true on
// the initial persist; any subsequent `save()` (e.g. after a mutation) throws
// so history cannot be silently rewritten. Loading + save-without-modify is
// still permitted for compatibility with unusual code paths.
keywordClusterRunSchema.pre('save', function guardImmutability(next) {
    if (!this.isNew && this.isModified()) {
        next(new Error('keyword_cluster_run:immutable'));
        return;
    }
    next();
});
// Fast paginated newest-first list scoped to an account.
keywordClusterRunSchema.index({ accountId: 1, createdAt: -1, _id: -1 });
export type KeywordClusterRunDocument = InferSchemaType<typeof keywordClusterRunSchema> & {
    createdAt: Date;
};
export type KeywordClusterRunHydrated = HydratedDocument<KeywordClusterRunDocument>;
export const KeywordClusterRun = mongoose.model('KeywordClusterRun', keywordClusterRunSchema);
