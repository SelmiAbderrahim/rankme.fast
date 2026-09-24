import mongoose, { type InferSchemaType } from 'mongoose';
import { APP_PROFILE_APP_STORE_ID_MAX_LENGTH, APP_PROFILE_PLAY_PACKAGE_ID_MAX_LENGTH, APP_STORE_ID_REGEX, PLAY_PACKAGE_ID_REGEX, } from './app-seo.schema.js';
const appProfileSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        required: true,
        index: true,
    },
    playPackageId: {
        type: String,
        trim: true,
        default: null,
        maxlength: APP_PROFILE_PLAY_PACKAGE_ID_MAX_LENGTH,
        match: PLAY_PACKAGE_ID_REGEX,
    },
    appStoreId: {
        type: String,
        trim: true,
        default: null,
        maxlength: APP_PROFILE_APP_STORE_ID_MAX_LENGTH,
        match: APP_STORE_ID_REGEX,
    },
    paired: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });
appProfileSchema.pre('validate', function requireAtLeastOneStoreId() {
    if (!this.playPackageId && !this.appStoreId) {
        this.invalidate('playPackageId', 'appSeo.errors.storeIdRequired');
    }
    if (this.paired && (!this.playPackageId || !this.appStoreId)) {
        this.invalidate('paired', 'appSeo.errors.pairedStoreIdsRequired');
    }
});
// Account/site lists and owner-scoped profile mutations use this prefix.
appProfileSchema.index({ accountId: 1, siteId: 1, createdAt: -1 });
// One account cannot register the same store identity on multiple Sites.
appProfileSchema.index({ accountId: 1, playPackageId: 1 }, {
    unique: true,
    partialFilterExpression: { playPackageId: { $type: 'string' } },
});
appProfileSchema.index({ accountId: 1, appStoreId: 1 }, {
    unique: true,
    partialFilterExpression: { appStoreId: { $type: 'string' } },
});
export type AppProfileDocument = InferSchemaType<typeof appProfileSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export const AppProfile = mongoose.model('AppProfile', appProfileSchema);
