import { HttpError } from '../../shared/utils/http-error.js';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale, } from '../../shared/i18n/index.js';
import { User, resolveUserBranding, resolveStoredUserBranding, type UserBranding, type UserHydrated, } from './users.model.js';
import { normalizeBrandingLogo } from './branding-logo.service.js';
export type PublicUser = {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    emailVerified: boolean;
    language: SupportedLocale;
};
export function resolveLanguagePreference(value: unknown): SupportedLocale | null {
    return isSupportedLocale(value) ? value : null;
}
export function resolveLanguagePreferenceOr(value: unknown, fallback: SupportedLocale): SupportedLocale {
    return resolveLanguagePreference(value) ?? fallback;
}
export async function getLanguagePreference(userId: string): Promise<SupportedLocale | null> {
    const user = await User.findById(userId).select('language').lean();
    if (!user)
        throw HttpError.notFound({ code: 'ERRORS_USER_NOT_FOUND', messageKey: 'errors.userNotFound' });
    return resolveLanguagePreference(user.language);
}
export async function updateLanguagePreference(userId: string, language: SupportedLocale, ifUnset = false): Promise<SupportedLocale> {
    if (!ifUnset) {
        const user = await User.findOneAndUpdate({ _id: userId }, { $set: { language } }, { new: true })
            .select('language')
            .lean();
        if (!user)
            throw HttpError.notFound({ code: 'ERRORS_USER_NOT_FOUND', messageKey: 'errors.userNotFound' });
        return resolveLanguagePreferenceOr(user.language, language);
    }
    const winner = await User.findOneAndUpdate({
        _id: userId,
        $or: [
            { language: { $exists: false } },
            { language: null },
            { language: { $nin: [...SUPPORTED_LOCALES, null] } },
        ],
    }, { $set: { language } }, { new: true })
        .select('language')
        .lean();
    if (winner)
        return resolveLanguagePreferenceOr(winner.language, language);
    const current = await User.findById(userId).select('language').lean();
    if (!current)
        throw HttpError.notFound({ code: 'ERRORS_USER_NOT_FOUND', messageKey: 'errors.userNotFound' });
    return resolveLanguagePreferenceOr(current.language, language);
}
/**
 * Booleans that gate every non-security mailer.
 * Security email (password reset, verification, password-changed) NEVER reads
 * this record — those callers skip `shouldSendNotification` on purpose.
 */
export type NotificationChannel = 'emailAuditComplete' | 'emailRankDrop' | 'emailMarketing' | 'emailMonitorChange'
// Alert rules + channels. Distinct from
// `emailRankDrop` (the courtesy single-observation notice) and from
// `emailMonitorChange` (page monitoring): this one governs the
// customer-configured alert rules only.
 | 'emailAlerts';
export type NotificationPreferences = Record<NotificationChannel, boolean>;
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
    'emailAuditComplete',
    'emailRankDrop',
    'emailMarketing',
    'emailMonitorChange',
    'emailAlerts',
];
/** Opt-out defaults: a legacy user with no stored field keeps receiving. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
    emailAuditComplete: true,
    emailRankDrop: true,
    emailMarketing: true,
    emailMonitorChange: true,
    emailAlerts: true,
};
function mergePreferences(stored: Partial<Record<NotificationChannel, unknown>> | null | undefined): NotificationPreferences {
    const out: NotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
    if (!stored)
        return out;
    for (const channel of NOTIFICATION_CHANNELS) {
        const value = stored[channel];
        /* c8 ignore next -- stored notification values are always booleans or absent; the non-boolean guard handles hypothetically corrupted data defensively. */
        if (typeof value === 'boolean')
            out[channel] = value;
    }
    return out;
}
/**
 * Read + merge the stored preference record over the all-true default so a
 * legacy user with an absent field is handled without a migration. Returns
 * defaults when the user is unknown — the mailer gate treats that as "send"
 * so the fallback matches "no opt-out on record".
 */
export async function resolveNotificationPreferences(userId: string): Promise<NotificationPreferences> {
    const user = await User.findById(userId).select('notificationPreferences').lean();
    if (!user)
        return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    return mergePreferences(user.notificationPreferences);
}
/**
 * Persist a partial preference update. Returns the resolved (merged) preferences
 * so the caller can echo the full four-boolean object back on the wire.
 */
export async function updateNotificationPreferences(userId: string, patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const user = await User.findById(userId);
    if (!user)
        throw HttpError.notFound({ code: 'ERRORS_USER_NOT_FOUND', messageKey: 'errors.userNotFound' });
    const current = mergePreferences((user as unknown as {
        notificationPreferences?: Partial<Record<NotificationChannel, unknown>>;
    }).notificationPreferences);
    const next: NotificationPreferences = { ...current };
    for (const channel of NOTIFICATION_CHANNELS) {
        if (patch[channel] !== undefined)
            next[channel] = patch[channel];
    }
    user.set('notificationPreferences', next);
    await user.save();
    return next;
}
/**
 * Read the account's white-label PDF branding. Unknown user
 * resolves to the empty default — same "no custom branding" shape the PDF
 * renderer treats as the RankMeFast header.
 */
export async function getUserBranding(userId: string): Promise<UserBranding> {
    const user = await User.findById(userId).select('branding').lean();
    return resolveUserBranding(user);
}
/** Persist the full branding object (PUT semantics — both fields required). */
export interface UpdateUserBrandingInput {
    companyName: string;
    accentColor: string;
    /** Omitted preserves, null removes, string is normalized before persistence. */
    logoDataUrl?: string | null;
}
export async function updateUserBranding(userId: string, branding: UpdateUserBrandingInput): Promise<UserBranding> {
    const user = await User.findById(userId);
    if (!user)
        throw HttpError.notFound({ code: 'ERRORS_USER_NOT_FOUND', messageKey: 'errors.userNotFound' });
    const stored = resolveStoredUserBranding(user);
    if (branding.logoDataUrl === null) {
        stored.logoPngBase64 = '';
        stored.logoWidth = null;
        stored.logoHeight = null;
    }
    else if (branding.logoDataUrl !== undefined) {
        const normalized = await normalizeBrandingLogo(branding.logoDataUrl);
        stored.logoPngBase64 = normalized.logoPngBase64;
        stored.logoWidth = normalized.logoWidth;
        stored.logoHeight = normalized.logoHeight;
    }
    user.set('branding', {
        companyName: branding.companyName,
        accentColor: branding.accentColor,
        logoPngBase64: stored.logoPngBase64,
        logoWidth: stored.logoWidth,
        logoHeight: stored.logoHeight,
    });
    await user.save();
    return resolveUserBranding(user);
}
export function toPublicUser(user: UserHydrated): PublicUser {
    return {
        id: user._id.toString(),
        email: user.email,
        firstName: user.profile?.firstName ?? '',
        lastName: user.profile?.lastName ?? '',
        role: user.role,
        emailVerified: user.emailVerified ?? false,
        language: resolveLanguagePreference(user.language) ?? DEFAULT_LOCALE,
    };
}
export async function findUserById(userId: string): Promise<UserHydrated | null> {
    return User.findById(userId);
}
export async function getUserProfile(userId: string): Promise<PublicUser> {
    const user = await User.findById(userId);
    if (!user)
        throw HttpError.notFound({ code: 'ERRORS_USER_NOT_FOUND', messageKey: 'errors.userNotFound' });
    return toPublicUser(user);
}
