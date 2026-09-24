import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
/**
 * Per-page audit result. One document per URL crawled by an
 * AuditRun; index by `runId` so the report screen can page
 * through. Storage lives here (not inline on the run) because a large
 * site's audit can carry thousands of pages.
 */
const auditedPageSchema = new mongoose.Schema({
    runId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AuditRun',
        required: true,
        index: true,
    },
    url: { type: String, required: true },
    statusCode: { type: Number, required: true },
    title: { type: String, default: null },
    metaDescription: { type: String, default: null },
    h1: { type: [String], default: [] },
    h2: { type: [String], default: [] },
    canonical: { type: String, default: null },
    hasStructuredData: { type: Boolean, default: false },
    structuredDataErrors: { type: [String], default: [] },
    isIndexable: { type: Boolean, default: true },
    nonIndexableReason: { type: String, default: null },
    brokenLinks: { type: [String], default: [] },
    onPageScore: { type: Number, required: true },
    timing: {
        type: new mongoose.Schema({
            timeToInteractiveMs: { type: Number, default: null },
            fetchMs: { type: Number, default: null },
        }, { _id: false }),
        default: null,
    },
}, { timestamps: true });
export type AuditedPageDocument = InferSchemaType<typeof auditedPageSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type AuditedPageHydrated = HydratedDocument<AuditedPageDocument>;
export const AuditedPage = mongoose.model('AuditedPage', auditedPageSchema);
