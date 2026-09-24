import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
export const TRAFFIC_SNAPSHOT_RUN_STATUSES = [
    'queued',
    'running',
    'succeeded',
    'partial',
    'failed',
] as const;
export type TrafficSnapshotRunStatus = (typeof TRAFFIC_SNAPSHOT_RUN_STATUSES)[number];
const inputsSchema = new mongoose.Schema({
    locationCode: { type: Number, required: true, min: 1 },
    languageCode: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        minlength: 2,
        maxlength: 2,
    },
    historyMonths: { type: Number, required: true, min: 1, max: 24 },
}, { _id: false, strict: 'throw' });
const retainedOpsSchema = new mongoose.Schema({
    traffic: { type: Boolean, required: true, default: false },
    rankOverview: { type: Boolean, required: true, default: false },
    history: { type: Boolean, required: true, default: false },
}, { _id: false, strict: 'throw' });
const trafficSnapshotRunSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        default: null,
    },
    targetDomain: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        minlength: 1,
        maxlength: 253,
    },
    inputs: { type: inputsSchema, required: true },
    status: {
        type: String,
        enum: TRAFFIC_SNAPSHOT_RUN_STATUSES,
        required: true,
        default: 'queued',
    },
    retainedOps: {
        type: retainedOpsSchema,
        required: true,
        default: () => ({
            traffic: false,
            rankOverview: false,
            history: false,
        }),
    },
    completedAt: { type: Date, default: null },
}, {
    timestamps: { createdAt: true, updatedAt: false },
    strict: 'throw',
});
trafficSnapshotRunSchema.index({ accountId: 1, _id: 1 });
trafficSnapshotRunSchema.index({ accountId: 1, createdAt: -1, _id: -1 });
trafficSnapshotRunSchema.index({ accountId: 1, targetDomain: 1, createdAt: -1 });
export type TrafficSnapshotRunDocument = InferSchemaType<typeof trafficSnapshotRunSchema> & {
    createdAt: Date;
};
export type TrafficSnapshotRunHydrated = HydratedDocument<TrafficSnapshotRunDocument>;
export const TrafficSnapshotRun = mongoose.model('TrafficSnapshotRun', trafficSnapshotRunSchema);
