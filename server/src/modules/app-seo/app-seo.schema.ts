import { z } from 'zod';
/** Google Play package ids use at least two reverse-DNS segments. */
export const PLAY_PACKAGE_ID_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
/** Apple App Store ids are numeric strings containing six through twelve digits. */
export const APP_STORE_ID_REGEX = /^\d{6,12}$/;
export const APP_PROFILE_PLAY_PACKAGE_ID_MAX_LENGTH = 255;
export const APP_PROFILE_APP_STORE_ID_MAX_LENGTH = 12;
const optionalTrimmedString = (schema: z.ZodString) => z.preprocess((value) => {
    if (typeof value !== 'string')
        return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
}, schema.optional());
/**
 * Registration is format-only validation. It performs no provider lookup and
 * therefore consumes no metered unit.
 */
export const registerAppProfileBodySchema = z
    .object({
    playPackageId: optionalTrimmedString(z
        .string()
        .max(APP_PROFILE_PLAY_PACKAGE_ID_MAX_LENGTH)
        .regex(PLAY_PACKAGE_ID_REGEX)),
    appStoreId: optionalTrimmedString(z
        .string()
        .max(APP_PROFILE_APP_STORE_ID_MAX_LENGTH)
        .regex(APP_STORE_ID_REGEX)),
    paired: z.boolean().optional().default(false),
})
    .strict()
    .superRefine((value, context) => {
    if (!value.playPackageId && !value.appStoreId) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'appSeo.errors.storeIdRequired',
            path: ['playPackageId'],
        });
    }
    if (value.paired && (!value.playPackageId || !value.appStoreId)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'appSeo.errors.pairedStoreIdsRequired',
            path: ['paired'],
        });
    }
});
// Id shape is deliberately not narrowed to ObjectId here. Services collapse a
// malformed id, a foreign id, and a missing row to the same owner-scoped 404.
const opaqueResourceIdSchema = z.string().trim().min(1).max(64);
export const appSeoSiteParamsSchema = z.object({
    siteId: opaqueResourceIdSchema,
});
export const appSeoProfileParamsSchema = z.object({
    siteId: opaqueResourceIdSchema,
    profileId: opaqueResourceIdSchema,
});
export type RegisterAppProfileInput = z.infer<typeof registerAppProfileBodySchema>;
