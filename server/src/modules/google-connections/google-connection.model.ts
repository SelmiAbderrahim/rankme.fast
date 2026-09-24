import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
/**
 * Google Search Console connection.
 *
 * One record per account: the refresh token is stored encrypted at rest
 * with the AES-256-GCM helper in `shared/crypto/` (`MASTER_ENCRYPTION_KEY`).
 * The plaintext refresh token NEVER leaves this module and is NEVER logged
 * — see the pino redaction path in `google-connections.service.ts`.
 *
 * `status`:
 *   - `connected` — refresh token is live.
 *   - `needs_reconnect` — refresh returned `invalid_grant` (dead) OR the
 *     ciphertext failed to decrypt (rotated master key). UI prompts
 *     re-consent; the audit still finishes.
 *   - `revoked` — the disconnect flow called Google's revoke endpoint. The
 *     record is deleted after revoke succeeds (or optimistically on
 *     revoke failure to avoid leaking orphaned ciphertext).
 *
 * Better Auth also stores provider tokens in its `account` table. That row
 * is a transient stash from `linkSocial`; source-of-truth for revocation +
 * rotation is THIS record so the disconnect flow controls the lifecycle.
 */
const encryptedSecretSchema = new mongoose.Schema({
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    keyVersion: { type: Number, required: true },
    // Present + true when the record was produced with GCM AAD bound to a
    // context string. Legacy records (unset) decrypt without AAD.
    aadBound: { type: Boolean, required: false },
}, { _id: false });
const googleConnectionSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
        unique: true,
    },
    googleAccountEmail: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
    },
    encryptedRefreshToken: { type: encryptedSecretSchema, required: true },
    scopes: { type: [String], default: [] },
    status: {
        type: String,
        enum: ['connected', 'needs_reconnect', 'revoked'],
        default: 'connected',
        required: true,
    },
    // Deprecated migration-only fields. Normal application reads exclude
    // them; the one-shot Site-binding backfill selects and unsets them.
    propertyUrl: { type: String, default: null, select: false },
    ga4PropertyId: { type: String, default: null, select: false },
    ga4PropertyDisplayName: { type: String, default: null, select: false },
    connectedAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: null },
}, { timestamps: true });
export type GoogleConnectionDocument = InferSchemaType<typeof googleConnectionSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type GoogleConnectionHydrated = HydratedDocument<GoogleConnectionDocument>;
export const GoogleConnection = mongoose.model('GoogleConnection', googleConnectionSchema);
export type GoogleConnectionStatus = 'connected' | 'needs_reconnect' | 'revoked';
