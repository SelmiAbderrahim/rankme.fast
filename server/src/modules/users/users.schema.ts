import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
export const userIdParamsSchema = z.object({
    userId: z.string().min(1),
});
export type UserIdParams = z.infer<typeof userIdParamsSchema>;
export const languagePreferencePatchSchema = z
    .object({
    language: z.enum(SUPPORTED_LOCALES),
    ifUnset: z.boolean().optional(),
})
    .strict();
export type LanguagePreferencePatch = z.infer<typeof languagePreferencePatchSchema>;
// Any subset of the booleans is accepted; the service merges the patch
// over the currently stored record. `strict()` rejects unknown fields so
// clients cannot smuggle in fake channels.
export const notificationPreferencesPatchSchema = z
    .object({
    emailAuditComplete: z.boolean().optional(),
    emailRankDrop: z.boolean().optional(),
    emailMarketing: z.boolean().optional(),
    emailMonitorChange: z.boolean().optional(),
    emailAlerts: z.boolean().optional(),
})
    .strict()
    .refine((v) => Object.keys(v).length > 0, {
    message: 'validation.custom.notificationUpdateRequired',
});
export type NotificationPreferencesPatch = z.infer<typeof notificationPreferencesPatchSchema>;
// White-label PDF branding (workstream B). `accentColor` accepts either the
// empty string (no custom accent) or a strict `#rrggbb` hex.
export const brandingSchema = z
    .object({
    companyName: z.string().trim().max(80),
    accentColor: z.union([z.literal(''), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
    // Omitted preserves the stored logo; null removes it. The
    // decoded-byte limit is enforced by branding-logo.service after strict
    // base64 decoding. This wire bound keeps validation ahead of image work.
    logoDataUrl: z.string().max(400000).nullable().optional(),
})
    .strict();
export type BrandingInput = z.infer<typeof brandingSchema>;
