/**
 * Weekly Pulse — HTTP zod schemas.
 *
 * Every route is site-scoped. `siteId` is the 24-hex Mongo ObjectId used
 * everywhere else in the app. Cursor is a bounded, url-safe string.
 */
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../shared/i18n/index.js';
export const siteIdParamsSchema = z.object({
    siteId: z.string().regex(/^[0-9a-f]{24}$/i, 'validation.issue.invalidString'),
});
export type SiteIdParams = z.infer<typeof siteIdParamsSchema>;
export const pulseIdParamsSchema = siteIdParamsSchema.extend({
    pulseId: z.string().uuid('invalid pulse id'),
});
export type PulseIdParams = z.infer<typeof pulseIdParamsSchema>;
export const historyCursorQuerySchema = z.object({
    cursor: z.string().max(256).optional(),
    limit: z.coerce.number().int().positive().max(50).default(10),
});
export type HistoryCursorQuery = z.infer<typeof historyCursorQuerySchema>;
/**
 * Body accepted by `PUT /api/sites/:siteId/weekly-pulse`.
 *
 * `acknowledgedPreviewAt` — ISO timestamp of the last preview call the user
 * saw. Required whenever `enabled=true` so the mutation can prove the user
 * saw the spend preview. Rejected when > 24h old.
 */
export const setSubscriptionBodySchema = z.object({
    enabled: z.boolean(),
    acknowledgedPreviewAt: z
        .string()
        .datetime({ offset: true })
        .optional(),
    locale: z
        .string()
        .refine((value) => (SUPPORTED_LOCALES as readonly string[]).includes(value), { message: 'validation.custom.shippedLocaleRequired' })
        .optional(),
});
export type SetSubscriptionBody = z.infer<typeof setSubscriptionBodySchema>;
