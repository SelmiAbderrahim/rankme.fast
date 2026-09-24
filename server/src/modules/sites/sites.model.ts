import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
const siteWorkLeaseSchema = new mongoose.Schema({
    leaseId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
}, { _id: false });
const siteDeletionQueueResourcesSchema = new mongoose.Schema({
    all: { type: [String], default: [] },
    scheduleIds: { type: [String], default: [] },
    ruleIds: { type: [String], default: [] },
}, { _id: false });
export const GOOGLE_BINDING_SOURCES = ['auto', 'manual', 'legacy'] as const;
export type GoogleBindingSource = (typeof GOOGLE_BINDING_SOURCES)[number];
export const GOOGLE_MATCH_STATUSES = [
    'unbound',
    'not_connected',
    'queued',
    'matching',
    'bound',
    'ambiguous',
    'no_match',
    'scope_missing',
    'needs_reconnect',
    'unavailable',
] as const;
export type GoogleMatchStatus = (typeof GOOGLE_MATCH_STATUSES)[number];
const googleAutoMatchSchema = new mongoose.Schema({
    requestId: { type: String, default: null },
    gscStatus: {
        type: String,
        enum: GOOGLE_MATCH_STATUSES,
        default: 'unbound',
        required: true,
    },
    ga4Status: {
        type: String,
        enum: GOOGLE_MATCH_STATUSES,
        default: 'unbound',
        required: true,
    },
    requestedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failureClass: { type: String, default: null },
}, { _id: false });
const siteSchema = new mongoose.Schema({
    // Better Auth user id (ObjectId-compatible hex — see modules/auth/auth.ts
    // `generateId`). Every query MUST filter by this; cross-account reads are
    // 404s, never 403s (no existence leaks).
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        // The single `accountId` index is redundant with
        // the compound `{ accountId: 1, domain: 1 }` unique below, which serves
        // every `{ accountId }`-prefix query via left-most.
    },
    // Normalized origin (scheme + lowercase host, default ports stripped) —
    // produced by shared/validation/site-url.ts, never raw user input.
    url: {
        type: String,
        required: true,
        trim: true,
    },
    // Lowercase hostname of `url`. Uniqueness is per account (below).
    domain: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
    },
    displayName: {
        type: String,
        default: '',
        trim: true,
    },
    // Google Search Console property URL matched to this site.
    // `sc-domain:example.com` for domain properties, `https://example.com/`
    // for URL-prefix properties. Absent = no property matched yet.
    gscPropertyUrl: {
        type: String,
        default: null,
    },
    /** Opaque generation separating snapshots written for different picks. */
    gscBindingGenerationId: { type: String, default: null },
    gscBindingSource: {
        type: String,
        enum: GOOGLE_BINDING_SOURCES,
        default: null,
    },
    /** GA4 is property-scoped; the matched web stream is provenance only. */
    ga4PropertyId: { type: String, default: null },
    ga4PropertyDisplayName: { type: String, default: null },
    ga4MatchedWebStreamUri: { type: String, default: null },
    ga4BindingGenerationId: { type: String, default: null },
    ga4BindingSource: {
        type: String,
        enum: GOOGLE_BINDING_SOURCES,
        default: null,
    },
    googleAutoMatch: {
        type: googleAutoMatchSchema,
        default: () => ({ gscStatus: 'unbound', ga4Status: 'unbound' }),
    },
    // Pause state: a paused site runs NOTHING — no audits, rank checks,
    // weekly pulse, monitor checks, alerts, or auto-reruns. Stored data stays
    // readable. Enforcement filters use `paused: { $ne: true }` so legacy
    // docs without the field count as active (no backfill needed).
    paused: {
        type: Boolean,
        default: false,
    },
    pausedAt: {
        type: Date,
        default: null,
    },
    // Internal deletion barrier. It is intentionally absent from PublicSite:
    // users see a normal failure response while cleanup remains retryable.
    deletionStartedAt: {
        type: Date,
        default: null,
    },
    deletionAttemptLeaseId: {
        type: String,
        default: null,
    },
    deletionAttemptExpiresAt: {
        type: Date,
        default: null,
    },
    // Minimal provenance survives a failed foreground attempt so a background
    // reconciler records the initiating authority, not itself. Raw request IP
    // is deliberately not persisted in the retry manifest.
    deletionActorUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
    deletionAuditSource: {
        type: String,
        default: null,
    },
    // Frozen before any local row is purged. Retries merge into this manifest
    // so a final Redis sweep can still match jobs that only carry a deleted
    // run/schedule/rule id. It disappears only with the final Site delete.
    deletionQueueResources: {
        type: siteDeletionQueueResourcesSchema,
        default: () => ({ all: [], scheduleIds: [], ruleIds: [] }),
    },
    // Renewable worker leases make the deletion claim atomic with respect to
    // active consumers. Expiry prevents a killed worker from wedging a site
    // forever; workers renew while processing and release in `finally`.
    workLeases: {
        type: [siteWorkLeaseSchema],
        default: [],
    },
}, { timestamps: true });
// One site per domain per account — duplicate adds surface a localized 409.
siteSchema.index({ accountId: 1, domain: 1 }, { unique: true });
siteSchema.index({ accountId: 1, deletionStartedAt: 1 });
// `InferSchemaType` does not surface the `timestamps: true` paths — add them
// explicitly so `toPublicSite` can serialize ISO dates without casts.
export type SiteDocument = InferSchemaType<typeof siteSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type SiteHydrated = HydratedDocument<SiteDocument>;
export const Site = mongoose.model('Site', siteSchema);
