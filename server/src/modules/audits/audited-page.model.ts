import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { AUDIT_PAGE_CHECK_KEYS } from '../../shared/providers/index.js';
/** One Boolean per normalized crawl check (`AuditPageChecks`); unreported checks stay absent. */
const auditPageChecksSchema = new mongoose.Schema(Object.fromEntries(AUDIT_PAGE_CHECK_KEYS.map((key) => [key, { type: Boolean, default: undefined }])), { _id: false });
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
    // Deep crawl facts. All absent on older runs and whenever the crawler did
    // not report them — never "zero" / "none".
    checks: { type: auditPageChecksSchema, default: undefined },
    clickDepth: { type: Number, default: undefined },
    inboundInternalLinks: { type: Number, default: undefined },
    outboundInternalLinks: { type: Number, default: undefined },
    outboundExternalLinks: { type: Number, default: undefined },
    pageSizeBytes: { type: Number, default: undefined },
    transferSizeBytes: { type: Number, default: undefined },
    serverResponseMs: { type: Number, default: undefined },
    // `null` = served uncompressed; absent = not reported.
    contentEncoding: { type: String, default: undefined },
    imageCount: { type: Number, default: undefined },
    renderBlockingScripts: { type: Number, default: undefined },
    renderBlockingStylesheets: { type: Number, default: undefined },
    socialTags: {
        type: new mongoose.Schema({ openGraph: { type: Boolean, required: true }, twitterCard: { type: Boolean, required: true } }, { _id: false }),
        default: undefined,
    },
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
