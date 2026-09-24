import mongoose, { type InferSchemaType } from 'mongoose';
import { APP_SEO_STORES } from '../../db/schema/app-seo.js';
const appChartSubscriptionSchema = new mongoose.Schema({
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
    profileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AppProfile',
        required: true,
        index: true,
    },
    store: {
        type: String,
        enum: APP_SEO_STORES,
        required: true,
    },
    chartId: { type: String, required: true, maxlength: 100 },
    categoryId: { type: String, required: true, maxlength: 100 },
    locationCode: { type: Number, required: true, min: 1, default: 2840 },
    languageCode: { type: String, required: true, minlength: 2, maxlength: 16, default: 'en' },
    /** Stable slot 0..1 makes the per-profile bound race-safe in Mongo. */
    slot: { type: Number, required: true, min: 0, max: 1 },
}, { timestamps: true });
appChartSubscriptionSchema.index({ accountId: 1, siteId: 1, profileId: 1, slot: 1 }, { unique: true });
appChartSubscriptionSchema.index({ accountId: 1, profileId: 1, store: 1, chartId: 1, categoryId: 1 }, { unique: true });
export type AppChartSubscriptionDocument = InferSchemaType<typeof appChartSubscriptionSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export const AppChartSubscription = mongoose.model('AppChartSubscription', appChartSubscriptionSchema);
