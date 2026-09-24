import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../shared/i18n/index.js';
const portalSectionsSchema = new mongoose.Schema({
    audit: { type: Boolean, required: true },
    ranks: { type: Boolean, required: true },
    gsc: { type: Boolean, required: true },
}, { _id: false, strict: 'throw' });
const clientPortalTokenSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
    },
    clientLabel: { type: String, required: true, trim: true, maxlength: 80 },
    tokenHash: {
        type: String,
        required: true,
        lowercase: true,
        match: /^[0-9a-f]{64}$/,
        unique: true,
    },
    locale: {
        type: String,
        required: true,
        enum: SUPPORTED_LOCALES,
    },
    sections: { type: portalSectionsSchema, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null, index: true },
}, { timestamps: true });
clientPortalTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
clientPortalTokenSchema.index({ accountId: 1, revokedAt: 1, expiresAt: 1 });
export type ClientPortalTokenDocument = InferSchemaType<typeof clientPortalTokenSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type ClientPortalTokenHydrated = HydratedDocument<ClientPortalTokenDocument>;
export const ClientPortalToken = mongoose.model('ClientPortalToken', clientPortalTokenSchema);
