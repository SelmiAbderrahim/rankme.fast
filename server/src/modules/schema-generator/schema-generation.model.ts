/**
 * Stored schema generations.
 *
 * Mongo, not Postgres: the payload string plus the evidence / omission /
 * conformance arrays are shape-loose nested documents with no ordered
 * time-series query, which is exactly the `drizzle-postgres-scope` boundary.
 *
 * A generation is an IMMUTABLE record of what the stored facts said at
 * generation time. Re-opening one is free, so nothing is recomputed on read —
 * a later crawl must never silently rewrite markup the user already copied.
 */
import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { EVIDENCE_SOURCES } from './evidence.js';
import { OMISSION_REASONS, SUPPORTED_SCHEMA_TYPES } from './schema-types.registry.js';
export const SCHEMA_GENERATION_STATUSES = ['complete', 'failed'] as const;
export type SchemaGenerationStatus = (typeof SCHEMA_GENERATION_STATUSES)[number];
/**
 * `ai_provider_failed` — the provider threw and NOTHING was retained.
 * `ai_output_rejected` — the model answered but every assignment failed the
 * traceability post-check; the deterministic-only markup is still retained.
 */
export const SCHEMA_GENERATION_FAILURE_REASONS = [
    'ai_provider_failed',
    'ai_output_rejected',
] as const;
export type SchemaGenerationFailureReason = (typeof SCHEMA_GENERATION_FAILURE_REASONS)[number];
const evidenceRowSchema = new mongoose.Schema({
    property: { type: String, required: true },
    factId: { type: String, required: true },
    factLabel: { type: String, required: true },
    value: { type: String, required: true },
}, { _id: false });
const omissionRowSchema = new mongoose.Schema({
    property: { type: String, required: true },
    reasonCode: { type: String, enum: OMISSION_REASONS, required: true },
    class: { type: String, enum: ['required', 'recommended'] as const, required: true },
}, { _id: false });
const conformanceGapSchema = new mongoose.Schema({
    property: { type: String, required: true },
    reasonCode: { type: String, enum: OMISSION_REASONS, required: true },
}, { _id: false });
const conformanceSchema = new mongoose.Schema({
    registryVersion: { type: String, required: true },
    status: { type: String, enum: ['conforms', 'gaps'] as const, required: true },
    requiredGaps: { type: [conformanceGapSchema], default: [] },
    recommendedSuggestions: { type: [conformanceGapSchema], default: [] },
}, { _id: false });
/**
 * SEC-REDACT: the prompt text and the raw model response are NEVER persisted.
 * Only the non-identifying provenance of the run is kept.
 */
const provenanceSchema = new mongoose.Schema({
    profileVersion: { type: String, required: true },
    outputSchemaVersion: { type: String, required: true },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    costMicros: { type: String, required: true },
}, { _id: false });
const schemaGenerationSchema = new mongoose.Schema({
    // Better Auth user id. Every read filters by it — a stranger's generation
    // is a 404, never a 403.
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
    pageUrl: { type: String, required: true },
    source: { type: String, enum: EVIDENCE_SOURCES, required: true },
    schemaType: { type: String, enum: SUPPORTED_SCHEMA_TYPES, required: true },
    /** Registry revision the verdict was computed under — never restated later. */
    registryVersion: { type: String, required: true },
    status: { type: String, enum: SCHEMA_GENERATION_STATUSES, required: true },
    /** Serialized JSON-LD. `null` ONLY when nothing was retained. */
    payload: { type: String, default: null },
    evidence: { type: [evidenceRowSchema], default: [] },
    omissions: { type: [omissionRowSchema], default: [] },
    conformance: { type: conformanceSchema, default: null },
    failureReason: {
        type: String,
        enum: SCHEMA_GENERATION_FAILURE_REASONS,
        default: null,
    },
    provenance: { type: provenanceSchema, default: null },
}, { timestamps: true });
// The list route's only access path: newest first, owner-scoped.
schemaGenerationSchema.index({ accountId: 1, createdAt: -1 });
export type SchemaGenerationDocument = InferSchemaType<typeof schemaGenerationSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type SchemaGenerationHydrated = HydratedDocument<SchemaGenerationDocument>;
export const SchemaGeneration = mongoose.model('SchemaGeneration', schemaGenerationSchema);
