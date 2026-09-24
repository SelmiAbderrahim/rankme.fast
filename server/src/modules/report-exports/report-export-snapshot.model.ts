import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
import { REPORT_FORMATS, REPORT_GLOBAL_BOUNDS, REPORT_KIND_IDS, REPORT_SOURCE_TARGET_SCOPES, } from '../../shared/report-exports/index.js';
const reportExportSnapshotSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        immutable: true,
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        default: null,
        immutable: true,
    },
    createdByUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        immutable: true,
    },
    targetScope: {
        type: String,
        enum: REPORT_SOURCE_TARGET_SCOPES,
        required: true,
        immutable: true,
    },
    sourceResourceId: {
        type: String,
        maxlength: 256,
        default: null,
        immutable: true,
    },
    sourceVersion: {
        type: String,
        maxlength: 256,
        required: true,
        immutable: true,
    },
    kind: {
        type: String,
        enum: REPORT_KIND_IDS,
        required: true,
        immutable: true,
    },
    format: {
        type: String,
        enum: REPORT_FORMATS,
        required: true,
        immutable: true,
    },
    locale: {
        type: String,
        enum: ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const,
        required: true,
        immutable: true,
    },
    schemaVersion: { type: Number, required: true, immutable: true },
    kindVersion: { type: Number, required: true, immutable: true },
    canonicalJson: {
        type: String,
        required: true,
        maxlength: REPORT_GLOBAL_BOUNDS.canonicalBytes,
        immutable: true,
    },
    canonicalBytes: { type: Number, required: true, min: 0, immutable: true },
    contentHash: {
        type: String,
        required: true,
        match: /^[a-f0-9]{64}$/u,
        immutable: true,
    },
    representedItems: {
        type: Number,
        required: true,
        min: 0,
        max: 100000,
        immutable: true,
    },
    expiresAt: { type: Date, required: true, immutable: true },
    deletedAt: { type: Date, default: null },
    purgeAt: { type: Date, default: null },
    downloadCount: {
        type: Number,
        required: true,
        min: 0,
        max: 1000000,
        default: 0,
    },
    lastDownloadedAt: { type: Date, default: null },
}, {
    timestamps: { createdAt: true, updatedAt: false },
    strict: 'throw',
    minimize: false,
});
reportExportSnapshotSchema.index({ accountId: 1, createdAt: -1, _id: -1 });
reportExportSnapshotSchema.index({ accountId: 1, contentHash: 1, format: 1 });
reportExportSnapshotSchema.index({ siteId: 1, deletedAt: 1 });
reportExportSnapshotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
reportExportSnapshotSchema.index({ purgeAt: 1 }, {
    expireAfterSeconds: 0,
    partialFilterExpression: { purgeAt: { $type: 'date' } },
});
export type ReportExportSnapshotDocument = InferSchemaType<typeof reportExportSnapshotSchema> & {
    createdAt: Date;
};
export type ReportExportSnapshotHydrated = HydratedDocument<ReportExportSnapshotDocument>;
export const ReportExportSnapshot = (mongoose.models.ReportExportSnapshot as mongoose.Model<ReportExportSnapshotDocument> | undefined) ??
    mongoose.model<ReportExportSnapshotDocument>('ReportExportSnapshot', reportExportSnapshotSchema);
