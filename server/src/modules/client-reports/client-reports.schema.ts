import { z } from 'zod';
import { CLIENT_REPORT_LAST_DAY_OF_MONTH } from '../../db/schema/index.js';
import { SUPPORTED_LOCALES } from '../../shared/i18n/index.js';
export const clientReportSectionsSchema = z
    .object({
    audit: z.boolean(),
    ranks: z.boolean(),
    gsc: z.boolean(),
})
    .strict()
    .refine((sections) => sections.audit || sections.ranks || sections.gsc, {
    message: 'validation.custom.reportSectionRequired',
});
export const composeClientReportSchema = z
    .object({
    locale: z.enum(SUPPORTED_LOCALES),
    sections: clientReportSectionsSchema,
})
    .strict();
export const clientReportSiteParamsSchema = z.object({
    siteId: z.string().regex(/^[0-9a-fA-F]{24}$/),
});
const normalizedRecipientSchema = z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(254);
export const clientReportRecipientsSchema = z
    .array(normalizedRecipientSchema)
    .min(1)
    .max(10)
    .transform((recipients) => [...new Set(recipients)].sort());
/**
 * An IANA zone the runtime knows ("Asia/Riyadh", "UTC"). Fixed offsets and
 * abbreviations are refused so DST rules always come from the zone database.
 */
export function isValidScheduleTimeZone(value: string): boolean {
    if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/u.test(value))
        return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
    }
    catch {
        return false;
    }
}
const scheduleTimeZoneSchema = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine(isValidScheduleTimeZone, { message: 'validation.custom.scheduleTimeZoneInvalid' });
const scheduleBaseSchema = z.object({
    name: z.string().trim().min(1).max(80),
    /** Wall-clock zone for `localHour`, `weekdayUtc` and `monthdayUtc`. */
    timezone: scheduleTimeZoneSchema.default('UTC'),
    /** Hour 0..23 in `timezone`. */
    localHour: z.number().int().min(0).max(23),
    locale: z.enum(SUPPORTED_LOCALES),
    recipients: clientReportRecipientsSchema,
    sections: clientReportSectionsSchema,
    enabled: z.boolean().default(true),
});
/**
 * Schedule body. `weekdayUtc` / `monthdayUtc` keep their wire names but, like
 * `localHour`, are wall-clock values in `timezone` (they equal UTC values for
 * a UTC schedule).
 */
export const clientReportScheduleBodySchema = z.discriminatedUnion('frequency', [
    scheduleBaseSchema.extend({
        frequency: z.literal('weekly'),
        weekdayUtc: z.number().int().min(0).max(6),
        monthdayUtc: z.null().optional(),
    }).strict(),
    scheduleBaseSchema.extend({
        frequency: z.literal('monthly'),
        weekdayUtc: z.null().optional(),
        // 1..28 exist in every month. The last day is its own explicit mode,
        // never an out-of-range day number that a date library would roll over.
        monthdayUtc: z.union([
            z.number().int().min(1).max(28),
            z.literal(CLIENT_REPORT_LAST_DAY_OF_MONTH),
        ]),
    }).strict(),
]);
export const clientReportScheduleParamsSchema = clientReportSiteParamsSchema.extend({
    scheduleId: z.string().guid(),
});
export const clientReportDeliveryQuerySchema = z.object({
    cursor: z.string().guid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const clientPortalCreateBodySchema = z
    .object({
    clientLabel: z.string().trim().min(1).max(80),
    locale: z.enum(SUPPORTED_LOCALES),
    sections: clientReportSectionsSchema,
    expiresInDays: z.number().int().min(1).max(365).default(90),
})
    .strict();
export const clientPortalParamsSchema = clientReportSiteParamsSchema.extend({
    portalId: z.string().regex(/^[0-9a-fA-F]{24}$/),
});
export const publicClientPortalParamsSchema = z.object({
    token: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/),
});
export const publicClientPortalQuerySchema = z.object({
    locale: z.enum(SUPPORTED_LOCALES).optional(),
});
export type ClientReportSectionsInput = z.infer<typeof clientReportSectionsSchema>;
export type ComposeClientReportBody = z.infer<typeof composeClientReportSchema>;
export type ClientReportScheduleBody = z.infer<typeof clientReportScheduleBodySchema>;
export type ClientReportDeliveryQuery = z.infer<typeof clientReportDeliveryQuerySchema>;
export type ClientPortalCreateBody = z.infer<typeof clientPortalCreateBodySchema>;
