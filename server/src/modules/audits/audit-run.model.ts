import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { coverageProbeSchema } from './crawl-evidence.schemas.js';
import { AUDIT_RUN_STOP_REASONS } from './crawl-stop-reason.js';
/**
 * One site-audit execution. This document — not BullMQ job
 * state — is the source of truth the UI reads: `queued → running →
 * succeeded | failed | unavailable`. BullMQ state is operational plumbing
 * and is pruned by retention; this record is forever.
 */
export const AUDIT_RUN_STATUSES = [
    'queued',
    'running',
    'succeeded',
    'failed',
    'unavailable',
] as const;
export type AuditRunStatus = (typeof AUDIT_RUN_STATUSES)[number];
const auditRunSchema = new mongoose.Schema({
    // Better Auth user id — every query MUST filter by this (no existence leaks).
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
    status: {
        type: String,
        enum: AUDIT_RUN_STATUSES,
        default: 'queued',
        required: true,
    },
    pageCap: {
        type: Number,
        required: true,
    },
    // The crawl is (or will be) posted with the resource scan (images, scripts
    // and stylesheets). Decided when the run is created and read back by the
    // processor, so a retry that resumes the vendor task reads the result the
    // way it was posted. Runs from before the field stay `false`.
    resourceScan: { type: Boolean, default: false },
    // What started this run. `manual` = user clicked; `rank-drop` = the
    // auto-rerun service (ops provenance only — never exposed to the client).
    trigger: {
        type: String,
        enum: ['manual', 'rank-drop'] as const,
        default: 'manual',
        required: true,
    },
    // `lead` is a legacy value from the removed public free-audit endpoint.
    // It stays in the enum so pre-existing rows keep validating until the
    // TTL index below expires them; nothing creates or processes lead runs.
    kind: {
        type: String,
        enum: ['site', 'lead'] as const,
        default: 'site',
        required: true,
    },
    // Validated origin + lowercase hostname — set on legacy lead runs only.
    targetUrl: {
        type: String,
        default: null,
    },
    targetDomain: {
        type: String,
        default: null,
    },
    startedAt: {
        type: Date,
        default: null,
    },
    finishedAt: {
        type: Date,
        default: null,
    },
    // Operator-facing failure detail (English vendor/taxonomy message). The
    // UI localizes from `status`, never from this string.
    error: {
        type: String,
        default: null,
    },
    vendorTaskId: {
        type: String,
        default: null,
    },
    // Pages stored for this run, written when it succeeds. `null` = the run
    // predates the field or has not finished.
    pagesCrawled: { type: Number, default: null },
    // Pages the crawl vendor said it crawled. Larger than `pagesCrawled` means
    // the stored list is incomplete; `null` = not reported.
    vendorPagesCrawled: { type: Number, default: null },
    // Why the crawler stopped: the vendor's reason, or one derived from the
    // counts when the run finished. `null` = the run predates the field.
    crawlStopReason: { type: String, enum: AUDIT_RUN_STOP_REASONS, default: null },
    // Requests we made for URLs missing from the crawl (the site root, Search
    // Console pages), so "absent from the crawl" has a recorded cause. Absent =
    // the stage did not run.
    coverageProbes: { type: [coverageProbeSchema], default: undefined },
    // Normalized AuditResult (shared/providers/types.ts) — vendor-neutral.
    result: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
    // Hard TTL. Set ONLY on legacy `kind: 'lead'` runs so leftover free
    // one-off audits age out instead of persisting alongside real audit
    // history. Regular account-owned runs leave this null.
    expiresAt: {
        type: Date,
        default: null,
    },
    // TOCTOU guard for concurrent starts on the same site. Set to
    // `String(siteId)` while queued/running, cleared to `null` on any terminal
    // transition (see audit.events transitions + processor). A partial-unique
    // index on `{ activeKey: { $type: 'string' } }` makes two concurrent
    // `startAuditForSite` calls resolve to exactly one run — the loser hits
    // E11000 and the service maps it to the same localized 409 as the
    // pre-check. `$type: 'string'` is used instead of `$in` inside
    // `partialFilterExpression` for mongodb-memory-server compatibility.
    activeKey: {
        type: String,
        default: null,
    },
}, { timestamps: true });
auditRunSchema.index({ expiresAt: 1 }, {
    expireAfterSeconds: 0,
    partialFilterExpression: { kind: 'lead' },
});
auditRunSchema.index({ activeKey: 1 }, {
    unique: true,
    partialFilterExpression: { activeKey: { $type: 'string' } },
});
// `listAuditRuns` filters `{ siteId }` and sorts
// `{ _id: -1 }`; `{ siteId: 1, _id: -1 }` serves both. `{ createdAt: -1 }`
// backs range scans on the admin overview (recent runs across sites).
auditRunSchema.index({ siteId: 1, _id: -1 });
auditRunSchema.index({ createdAt: -1 });
export type AuditRunDocument = InferSchemaType<typeof auditRunSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type AuditRunHydrated = HydratedDocument<AuditRunDocument>;
export const AuditRun = mongoose.model('AuditRun', auditRunSchema);
