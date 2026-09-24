import mongoose, { type InferSchemaType, type HydratedDocument } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
const accountWorkLeaseSchema = new mongoose.Schema({
    leaseId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
}, { _id: false });
export const ROLE_MEMBER = 'Member';
export const ROLE_CLIENT = 'Client';
export const ROLE_OWNER = 'Owner';
export const ROLE_ADMIN = 'Admin';
// Platform-owner tier (superadmin). Rank 5 — strictly above Admin. Server-owned
// like every other role (Better Auth `input: false`); granted only by the seeder
// or another SuperAdmin via the /api/superadmin surface, never at /api/admin.
export const ROLE_SUPERADMIN = 'SuperAdmin';
// Roles an Admin may assign via the /api/admin surface — everything EXCEPT the
// platform-owner tier. SuperAdmin is granted only by the seeder or another
// SuperAdmin on /api/superadmin, so it is deliberately absent here.
export const ADMIN_ASSIGNABLE_ROLES = [
    ROLE_MEMBER,
    ROLE_CLIENT,
    ROLE_OWNER,
    ROLE_ADMIN,
] as const;
export const ROLES = [...ADMIN_ASSIGNABLE_ROLES, ROLE_SUPERADMIN] as const;
export type Role = (typeof ROLES)[number];
export type AdminAssignableRole = (typeof ADMIN_ASSIGNABLE_ROLES)[number];
const ROLE_RANK: Record<Role, number> = {
    [ROLE_MEMBER]: 1,
    [ROLE_CLIENT]: 2,
    [ROLE_OWNER]: 3,
    [ROLE_ADMIN]: 4,
    [ROLE_SUPERADMIN]: 5,
};
export function getRoleRank(role: string | undefined): number {
    if (!role)
        return 0;
    return ROLE_RANK[role as Role] ?? 0;
}
const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    // NOTE: credentials live in Better Auth's Postgres `account`
    // table — this document is the domain-profile mirror only. No password,
    // no reset/verification tokens are stored here anymore.
    profile: {
        firstName: { type: String, default: '' },
        lastName: { type: String, default: '' },
    },
    role: {
        type: String,
        enum: ROLES,
        default: ROLE_MEMBER,
    },
    // Verified-state mirror of Better Auth's `user.email_verified` (synced by
    // the databaseHooks in modules/auth/auth.ts). Reset + verification tokens
    // now live in Better Auth's Postgres `verification` table.
    emailVerified: { type: Boolean, required: true, default: false },
    // Per-user preferred locale — used by the communication module to render
    // transactional + alert emails in the recipient's language.
    // Falls back to DEFAULT_LOCALE when unset.
    language: {
        type: String,
        enum: SUPPORTED_LOCALES,
        default: null,
    },
    // Deletion lifecycle (GDPR right-to-deletion). A non-null
    // `deletionScheduledAt` marks the account soft-deleted; the repo purge
    // runs after that timestamp. `deletionWarningSentAt` dedupes the final
    // Resend warning email.
    deletionScheduledAt: { type: Date, default: null },
    deletionWarningSentAt: { type: Date, default: null },
    // Stable per-schedule identity for replay-safe requested/cancelled audit
    // evidence. Cancellation keeps the schedule in place while this marker is
    // non-null, so a purge can repair the audit then finish the cancellation
    // instead of racing a transient clear/restore window.
    deletionLifecycleId: { type: String, default: null },
    deletionCancellationId: { type: String, default: null },
    deletionCancellationRequestedAt: { type: Date, default: null },
    // Durable account-wide deletion boundary. Requests and workers append a
    // short renewable lease while they may mutate/spend. Purge atomically sets
    // `deletionStartedAt` only when no live lease exists; after that no new
    // lease can be acquired and the claimed document remains for retry.
    deletionStartedAt: { type: Date, default: null },
    // A permanent deletion claim stops new work; this second, expiring owner
    // serializes the retryable purge attempt itself. A crashed worker can be
    // resumed after expiry without allowing two provider teardowns at once.
    deletionAttemptLeaseId: { type: String, default: null },
    deletionAttemptExpiresAt: { type: Date, default: null },
    workLeases: { type: [accountWorkLeaseSchema], default: [] },
    // Legal hold overrides the deletion purge — held accounts are retained
    // until legal explicitly releases the hold.
    legalHold: { type: Boolean, required: true, default: false },
    // Admin-controlled suspension. Suspended users keep their data
    // but cannot spend against caps — enforcement lives at the API layer.
    suspended: { type: Boolean, required: true, default: false },
    suspendedAt: { type: Date, default: null },
    // Opt-in recovery-code escrow. When enabled, `wrappedKey` holds the master
    // key wrapped under a Shamir escrow key; the recovery codes (the shares)
    // are shown to the user once and NEVER stored. Absent = zero-knowledge
    // default (lose the master key = unrecoverable). See recovery-codes.ts.
    recoveryEscrow: {
        enabled: { type: Boolean, default: false },
        wrappedKey: {
            ciphertext: { type: String, default: '' },
            iv: { type: String, default: '' },
            authTag: { type: String, default: '' },
            keyVersion: { type: Number, default: 0 },
            threshold: { type: Number, default: 0 },
            shareCount: { type: Number, default: 0 },
        },
        createdAt: { type: Date, default: null },
    },
    // White-label PDF branding. Empty strings mean "no custom
    // branding" — the PDF renderer falls back to the localized RankMeFast
    // header. `accentColor` is a `#rrggbb` hex or ''. The SAME subdocument
    // also carries a normalized PNG logo. Only server-reencoded PNG
    // bytes are written; received upload bytes never reach this model.
    // Reads are open to any verified user; writes are gated by
    // requireFeature('whiteLabelPdf').
    branding: {
        companyName: { type: String, default: '' },
        accentColor: { type: String, default: '' },
        logoPngBase64: { type: String, default: '' },
        logoWidth: { type: Number, default: null },
        logoHeight: { type: Number, default: null },
    },
    // Non-transactional email opt-out flags. Opt-out model: any
    // missing field is read as `true` by resolveNotificationPreferences so
    // pre-existing users keep receiving until they explicitly opt out. Security
    // email (password reset / email verification / password-changed
    // confirmation) is NEVER gated — those routes ignore this record entirely.
    notificationPreferences: {
        emailAuditComplete: { type: Boolean, default: true },
        emailRankDrop: { type: Boolean, default: true },
        emailMarketing: { type: Boolean, default: true },
        // Public-page change monitoring — material-change alert.
        emailMonitorChange: { type: Boolean, default: true },
        emailAlerts: { type: Boolean, default: true },
    },
}, { timestamps: true });
export type UserDocument = InferSchemaType<typeof userSchema>;
export type UserHydrated = HydratedDocument<UserDocument>;
export const User = mongoose.model('User', userSchema);
/** White-label PDF branding. */
export interface UserBranding {
    companyName: string;
    /** `'#rrggbb'` or `''` (no custom accent). */
    accentColor: string;
    /** Server-normalized PNG for an inert client preview, or null. */
    logoDataUrl: string | null;
}
export interface StoredUserBranding {
    companyName: string;
    accentColor: string;
    logoPngBase64: string;
    logoWidth: number | null;
    logoHeight: number | null;
}
/**
 * Normalize the stored branding subdoc into the wire shape. Colocated with
 * the model (pure, zero imports) so `modules/audits` can consume it via a
 * direct `users.model.js` import — the users/index barrel sits in the
 * documented require-auth ↔ auth ↔ users cycle and must not be pulled into
 * the audits controller graph.
 */
export function resolveUserBranding(user: {
    branding?: {
        companyName?: unknown;
        accentColor?: unknown;
        logoPngBase64?: unknown;
        logoWidth?: unknown;
        logoHeight?: unknown;
    } | null;
} | null): UserBranding {
    const companyName = typeof user?.branding?.companyName === 'string' ? user.branding.companyName : '';
    const accentColor = typeof user?.branding?.accentColor === 'string' ? user.branding.accentColor : '';
    const logoPngBase64 = typeof user?.branding?.logoPngBase64 === 'string'
        ? user.branding.logoPngBase64
        : '';
    const logoWidth = typeof user?.branding?.logoWidth === 'number' &&
        Number.isInteger(user.branding.logoWidth) &&
        user.branding.logoWidth > 0
        ? user.branding.logoWidth
        : null;
    const logoHeight = typeof user?.branding?.logoHeight === 'number' &&
        Number.isInteger(user.branding.logoHeight) &&
        user.branding.logoHeight > 0
        ? user.branding.logoHeight
        : null;
    const logoDataUrl = logoPngBase64.length > 0 && logoWidth !== null && logoHeight !== null
        ? `data:image/png;base64,${logoPngBase64}`
        : null;
    return { companyName, accentColor, logoDataUrl };
}
/** Internal normalized branding consumed by the PDF renderer. */
export function resolveStoredUserBranding(user: Parameters<typeof resolveUserBranding>[0]): StoredUserBranding {
    const wire = resolveUserBranding(user);
    const prefix = 'data:image/png;base64,';
    const logoPngBase64 = wire.logoDataUrl?.startsWith(prefix)
        ? wire.logoDataUrl.slice(prefix.length)
        : '';
    const rawWidth = user?.branding?.logoWidth;
    const rawHeight = user?.branding?.logoHeight;
    return {
        companyName: wire.companyName,
        accentColor: wire.accentColor,
        logoPngBase64,
        logoWidth: typeof rawWidth === 'number' && Number.isInteger(rawWidth) && rawWidth > 0
            ? rawWidth
            : null,
        logoHeight: typeof rawHeight === 'number' && Number.isInteger(rawHeight) && rawHeight > 0
            ? rawHeight
            : null,
    };
}
