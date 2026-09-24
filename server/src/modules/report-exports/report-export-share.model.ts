import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
const PUBLIC_SHARE_FORMATS = ['view', 'pdf', 'csv'] as const;
const reportExportShareSchema = new mongoose.Schema({
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
    snapshotId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ReportExportSnapshot',
        required: true,
        immutable: true,
    },
    createdByUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        immutable: true,
    },
    tokenHash: {
        type: String,
        required: true,
        lowercase: true,
        match: /^[0-9a-f]{64}$/u,
        unique: true,
        immutable: true,
    },
    formats: {
        type: [{ type: String, enum: PUBLIC_SHARE_FORMATS }],
        required: true,
        immutable: true,
        validate: {
            validator: (value: string[]) => value.length >= 1 &&
                value.length <= PUBLIC_SHARE_FORMATS.length &&
                new Set(value).size === value.length,
            message: 'share formats must be unique and non-empty',
        },
    },
    expiresAt: { type: Date, required: true, immutable: true },
    purgeAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null, index: true },
    accessCount: { type: Number, min: 0, default: 0 },
    lastAccessedAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw', minimize: false });
reportExportShareSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
reportExportShareSchema.index({ accountId: 1, revokedAt: 1, expiresAt: 1 });
reportExportShareSchema.index({ snapshotId: 1, revokedAt: 1, expiresAt: 1 });
export type ReportExportShareDocument = InferSchemaType<typeof reportExportShareSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type ReportExportShareHydrated = HydratedDocument<ReportExportShareDocument>;
export const ReportExportShare = (mongoose.models.ReportExportShare as mongoose.Model<ReportExportShareDocument>) ||
    mongoose.model('ReportExportShare', reportExportShareSchema);
