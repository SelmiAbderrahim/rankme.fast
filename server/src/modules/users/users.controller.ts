import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { brandingSchema, languagePreferencePatchSchema, notificationPreferencesPatchSchema, userIdParamsSchema, } from './users.schema.js';
import { getUserBranding, getLanguagePreference, getUserProfile, resolveNotificationPreferences, updateNotificationPreferences, updateLanguagePreference, updateUserBranding, } from './users.service.js';
export const getLanguagePreferenceHandler: RequestHandler = asyncHandler(async (req, res) => {
    const language = await getLanguagePreference(req.user!.id);
    res.status(200).json({ language });
});
export const patchLanguagePreferenceHandler: RequestHandler = asyncHandler(async (req, res) => {
    const input = languagePreferencePatchSchema.parse(req.body);
    const language = await updateLanguagePreference(req.user!.id, input.language, input.ifUnset === true);
    res.status(200).json({ language });
});
/**
 * GET /api/users/branding — the account's white-label PDF branding
 * (workstream B). Readable by ANY verified user so the settings panel can
 * show stored values; only the write is plan-gated.
 */
export const getBrandingHandler: RequestHandler = asyncHandler(async (req, res) => {
    /* c8 ignore next -- requireAuth already guarantees req.user; guard is defence-in-depth for a mount misconfiguration. */
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    const branding = await getUserBranding(req.user.id);
    res.status(200).json({ branding });
});
/**
 * PUT /api/users/branding — full-object update, zod-validated. Mounted behind
 * `requireFeature('whiteLabelPdf')` in users.routes.ts, so below-pro accounts
 * receive the shared localized 402 before this handler runs.
 */
export const putBrandingHandler: RequestHandler = asyncHandler(async (req, res) => {
    /* c8 ignore next -- requireAuth already guarantees req.user; guard is defence-in-depth for a mount misconfiguration. */
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    const input = brandingSchema.parse(req.body);
    const branding = await updateUserBranding(req.user.id, input);
    res.status(200).json({ branding });
});
export const viewProfile: RequestHandler = asyncHandler(async (req, res) => {
    const { userId } = userIdParamsSchema.parse(req.params);
    if (!req.user || req.user.id !== userId) {
        throw HttpError.notFound({ code: 'ERRORS_USER_NOT_FOUND', messageKey: 'errors.userNotFound' });
    }
    const user = await getUserProfile(userId);
    res.status(200).json({ user });
});
/**
 * GET /api/users/notifications — resolved four-boolean object for the current
 * user. Self-scoped: reads `req.user.id`, no path parameter. `requireAuth` in
 * the mount ensures no session → 401 before this runs.
 */
export const getNotificationPreferences: RequestHandler = asyncHandler(async (req, res) => {
    /* c8 ignore next -- requireAuth already guarantees req.user; guard is defence-in-depth for a mount misconfiguration. */
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    const preferences = await resolveNotificationPreferences(req.user.id);
    res.status(200).json({ preferences });
});
/**
 * PATCH /api/users/notifications — zod-validated partial update, returns the
 * resolved full object so the client can echo it into Redux without a
 * follow-up GET.
 */
export const patchNotificationPreferences: RequestHandler = asyncHandler(async (req, res) => {
    /* c8 ignore next -- requireAuth already guarantees req.user; guard is defence-in-depth for a mount misconfiguration. */
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    const patch = notificationPreferencesPatchSchema.parse(req.body);
    const preferences = await updateNotificationPreferences(req.user.id, patch);
    res.status(200).json({ preferences });
});
