import { z } from 'zod';
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
const scheduleBaseSchema = z.object({
    name: z.string().trim().min(1).max(80),
    hourUtc: z.number().int().min(0).max(23),
    locale: z.enum(SUPPORTED_LOCALES),
    recipients: clientReportRecipientsSchema,
    sections: clientReportSectionsSchema,
    enabled: z.boolean().default(true),
});
export const clientReportScheduleBodySchema = z.discriminatedUnion('frequency', [
    scheduleBaseSchema.extend({
        frequency: z.literal('weekly'),
        weekdayUtc: z.number().int().min(0).max(6),
        monthdayUtc: z.null().optional(),
    }).strict(),
    scheduleBaseSchema.extend({
        frequency: z.literal('monthly'),
        weekdayUtc: z.null().optional(),
        monthdayUtc: z.number().int().min(1).max(28),
    }).strict(),
]);
export const clientReportScheduleParamsSchema = clientReportSiteParamsSchema.extend({
    scheduleId: z.string().uuid(),
});
export const clientReportDeliveryQuerySchema = z.object({
    cursor: z.string().uuid().optional(),
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
