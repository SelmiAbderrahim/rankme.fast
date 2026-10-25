import { z } from 'zod';
import { validateSiteUrl } from '../../shared/validation/site-url.js';
import { trafficSnapshotPayloadSchema, type TrafficSnapshotPayload, } from '../../db/schema/traffic-snapshots.js';
const objectIdHexSchema = z
    .string()
    .regex(/^[0-9a-f]{24}$/i, 'trafficInsights.errors.notFound');
/**
 * Domain input normalized through the shipped site-domain validator. A pasted
 * http(s) URL is reduced to its hostname (path, query and port dropped); other
 * schemes, credentials, IP literals and single-label hosts still fail.
 */
export const trafficSnapshotDomainSchema = z
    .string()
    .trim()
    .min(1)
    .max(269)
    .transform((raw, context) => {
    const scheme = /^([a-z][a-z\d+.-]*):\/\//i.exec(raw);
    if (scheme && !/^https?$/i.test(scheme[1]!)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'trafficInsights.errors.invalidDomain',
        });
        return z.NEVER;
    }
    const parsed = validateSiteUrl(scheme ? raw : `https://${raw}`);
    if (!parsed.ok || parsed.domain.length > 253) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'trafficInsights.errors.invalidDomain',
        });
        return z.NEVER;
    }
    return parsed.domain.toLowerCase().replace(/^www\./, '');
});
/** Default market when a request names none (United States, English). */
export const DEFAULT_TRAFFIC_LOCATION_CODE = 2840;
export const DEFAULT_TRAFFIC_LANGUAGE_CODE = 'en';
/**
 * DataForSEO Labs location code, as offered by the provider market catalog.
 * The provider stays authoritative for coverage, exactly like keyword research.
 */
const trafficLocationCodeSchema = z
    .number({ error: 'trafficInsights.errors.invalidMarket' })
    .int('trafficInsights.errors.invalidMarket')
    .positive('trafficInsights.errors.invalidMarket');
const trafficLanguageCodeSchema = z
    .string({ error: 'trafficInsights.errors.invalidMarket' })
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2}$/, 'trafficInsights.errors.invalidMarket');
export const createTrafficSnapshotSchema = z
    .object({
    targetDomain: trafficSnapshotDomainSchema,
    siteId: objectIdHexSchema.optional(),
    locationCode: trafficLocationCodeSchema.default(DEFAULT_TRAFFIC_LOCATION_CODE),
    languageCode: trafficLanguageCodeSchema.default(DEFAULT_TRAFFIC_LANGUAGE_CODE),
    historyMonths: z.literal(24).default(24),
})
    .strict();
/**
 * Vendor-cache key for one domain in one market. The default market keeps the
 * bare domain so rows written before markets were selectable stay addressable.
 */
export function trafficSnapshotCacheKey(targetDomain: string, locationCode: number, languageCode: string): string {
    return locationCode === DEFAULT_TRAFFIC_LOCATION_CODE && languageCode === DEFAULT_TRAFFIC_LANGUAGE_CODE
        ? targetDomain
        : `${targetDomain}|${locationCode}|${languageCode}`;
}
export const trafficSnapshotPreviewSchema = z
    .object({
    domains: z.array(trafficSnapshotDomainSchema).min(1).max(5),
    locationCode: trafficLocationCodeSchema.default(DEFAULT_TRAFFIC_LOCATION_CODE),
    languageCode: trafficLanguageCodeSchema.default(DEFAULT_TRAFFIC_LANGUAGE_CODE),
})
    .strict()
    .superRefine((input, context) => {
    if (new Set(input.domains).size !== input.domains.length) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['domains'],
            message: 'trafficInsights.errors.invalidDomain',
        });
    }
});
const trafficSnapshotCompareIdsSchema = z
    .string()
    .transform((value) => value.split(',').map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(objectIdHexSchema).min(2))
    .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'trafficInsights.compare.invalidSelection',
        });
    }
})
    .transform((ids) => ({ ids: ids.slice(0, 5), clamped: ids.length > 5 }));
export const trafficSnapshotCompareQuerySchema = z
    .object({
    ids: trafficSnapshotCompareIdsSchema,
    siteId: objectIdHexSchema.optional(),
})
    .strict()
    .transform((query) => ({
    ...query.ids,
    ...(query.siteId ? { siteId: query.siteId } : {}),
}));
export const trafficSnapshotListQuerySchema = z
    .object({
    siteId: objectIdHexSchema.optional(),
    domain: trafficSnapshotDomainSchema.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
})
    .strict()
    .refine((query) => !query.from || !query.to || query.from.getTime() <= query.to.getTime(), { message: 'trafficInsights.errors.invalidDateRange' });
export const trafficSnapshotParamsSchema = z
    .object({ id: objectIdHexSchema })
    .strict();
export const trafficSnapshotReadQuerySchema = z
    .object({ siteId: objectIdHexSchema.optional() })
    .strict();
const trafficCountrySchema = z
    .object({
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    visits: z.number().int().nonnegative(),
})
    .strict();
const trafficEstimationRowSchema = z
    .object({
    domain: z.string().min(1).max(253),
    monthlyOrganicVisits: z.number().int().nonnegative(),
    topCountries: z.array(trafficCountrySchema).max(10),
})
    .strict();
const domainRankOverviewSchema = z
    .object({
    domain: z.string().min(1).max(253),
    rank: z.number().int().min(0).max(100).nullable(),
    keywordsCount: z.number().int().nonnegative(),
    estimatedMonthlyOrganicVisits: z.number().int().nonnegative(),
})
    .strict();
const historicalRankOverviewSchema = z
    .object({
    domain: z.string().min(1).max(253),
    points: z
        .array(z
        .object({
        year: z.number().int().min(1970).max(9999),
        month: z.number().int().min(1).max(12),
        rank: z.number().int().min(0).max(100).nullable(),
        organicKeywords: z.number().int().nonnegative(),
        organicEtv: z.number().int().nonnegative(),
    })
        .strict())
        .max(24),
})
    .strict();
const retainedOpsSchema = z
    .object({
    traffic: z.boolean(),
    rankOverview: z.boolean(),
    history: z.boolean(),
})
    .strict();
const retryabilitySchema = z
    .object({
    traffic: z.boolean().nullable(),
    rankOverview: z.boolean().nullable(),
    history: z.boolean().nullable(),
})
    .strict();
/** Shared, account-neutral payload stored under vendor-cache operation `traffic`. */
export const trafficProviderBundleSchema = z
    .object({
    traffic: z.array(trafficEstimationRowSchema).max(1).nullable(),
    rankOverview: domainRankOverviewSchema.nullable(),
    history: historicalRankOverviewSchema.nullable(),
    retainedOps: retainedOpsSchema,
    retryableFailures: retryabilitySchema,
})
    .strict();
export type TrafficProviderBundle = z.infer<typeof trafficProviderBundleSchema>;
export type TrafficRetainedOps = z.infer<typeof retainedOpsSchema>;
export type CreateTrafficSnapshotInput = z.infer<typeof createTrafficSnapshotSchema>;
export type TrafficSnapshotPreviewInput = z.infer<typeof trafficSnapshotPreviewSchema>;
export type TrafficSnapshotCompareQuery = z.infer<typeof trafficSnapshotCompareQuerySchema>;
export type TrafficSnapshotListQuery = z.infer<typeof trafficSnapshotListQuerySchema>;
export type { TrafficSnapshotPayload };
export { trafficSnapshotPayloadSchema };
