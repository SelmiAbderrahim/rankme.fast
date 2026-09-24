/**
 * Brand Radar request schemas.
 *
 * Bounds are the spec's, not re-derived: brand query 1..200 chars, optional
 * ISO-639-1 language, optional ISO publisher country, list limit ≤50. The
 * numeric location remains a temporary legacy input only. `competitorQueries`
 * is explicitly REJECTED in v1 — one scan is one
 * brand query, and silently dropping the field would let a caller believe a
 * multi-query bundle was scanned.
 */
import { z } from 'zod';
import { DATAFORSEO_LOCATION_ISO } from '../../shared/observations/observations.js';
import { BRAND_RADAR_QUERY_MAX_LENGTH } from './brand-radar.model.js';
import { BRAND_RADAR_MENTION_PAGE_DEFAULT, BRAND_RADAR_MENTION_PAGE_MAX, } from './brand-radar.rows.model.js';
export const BRAND_RADAR_MULTI_QUERY_KEY = 'brandRadar.errors.multiQueryUnsupported';
export const BRAND_RADAR_LIST_LIMIT_MAX = 50;
export const BRAND_RADAR_MENTIONS_LIMIT_MAX = BRAND_RADAR_MENTION_PAGE_MAX;
export const BRAND_RADAR_MENTIONS_LIMIT_DEFAULT = BRAND_RADAR_MENTION_PAGE_DEFAULT;
const objectIdHexSchema = z
    .string()
    .regex(/^[0-9a-f]{24}$/i, 'brandRadar.errors.notFound');
const brandQuerySchema = z
    .string()
    .trim()
    .min(1, 'brandRadar.errors.invalidQuery')
    .max(BRAND_RADAR_QUERY_MAX_LENGTH, 'brandRadar.errors.invalidQuery');
/** ISO-639-1: exactly two lowercase letters after normalization. */
const languageSchema = z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2}$/, 'brandRadar.errors.invalidLanguage');
const locationCodeSchema = z
    .coerce
    .number()
    .int('brandRadar.errors.invalidLocation')
    .positive('brandRadar.errors.invalidLocation');
const countryCodeSchema = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'brandRadar.errors.invalidLocation');
const scanInputShape = {
    brandQuery: brandQuerySchema,
    language: languageSchema.optional(),
    countryCode: countryCodeSchema.optional(),
    locationCode: locationCodeSchema.optional(),
    // Declared so the strict object accepts the key and the superRefine can
    // refuse it with the specific v1 message instead of a generic
    // "unrecognized key" error.
    competitorQueries: z.unknown().optional(),
} as const;
function refuseMultiQuery(input: {
    competitorQueries?: unknown;
    countryCode?: string;
    locationCode?: number;
}, ctx: z.RefinementCtx): void {
    if (input.competitorQueries !== undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['competitorQueries'],
            message: BRAND_RADAR_MULTI_QUERY_KEY,
        });
    }
    if (input.countryCode !== undefined && input.locationCode !== undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['countryCode'],
            message: 'brandRadar.errors.invalidLocation',
        });
    }
    if (input.locationCode !== undefined &&
        DATAFORSEO_LOCATION_ISO[input.locationCode] === undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['locationCode'],
            message: 'brandRadar.errors.invalidLocation',
        });
    }
}
function stripMultiQuery<T extends {
    competitorQueries?: unknown;
}>(input: T): Omit<T, 'competitorQueries'> {
    const { competitorQueries: _rejected, ...rest } = input;
    return rest;
}
export const createScanBody = z
    .object(scanInputShape)
    .strict()
    .superRefine(refuseMultiQuery)
    .transform(stripMultiQuery);
/** Preview takes the same inputs — it must price exactly what create runs. */
export const previewBody = z
    .object(scanInputShape)
    .strict()
    .superRefine(refuseMultiQuery)
    .transform(stripMultiQuery);
export const listScansQuery = z
    .object({
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(BRAND_RADAR_LIST_LIMIT_MAX)
        .default(20),
    cursor: z.string().max(500).optional(),
})
    .strict();
/**
 * Mention-inventory page query. The page is larger than the scan-list
 * page because a settled scan retains up to 1000 rows and the workspace table
 * pages through them; the cursor shares the scan-list codec.
 */
export const listMentionsQuery = z
    .object({
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(BRAND_RADAR_MENTIONS_LIMIT_MAX)
        .default(BRAND_RADAR_MENTIONS_LIMIT_DEFAULT),
    cursor: z.string().max(500).optional(),
})
    .strict();
export const scanIdParam = z.object({ id: objectIdHexSchema }).strict();
/**
 * Site-nested route params. A missing `siteId` cannot
 * reach a handler — the route simply does not match — so this only has to
 * refuse a malformed one, and it does so with the same `notFound` key a
 * foreign site produces (no existence oracle).
 */
export const siteIdParams = z.object({ siteId: objectIdHexSchema }).strict();
export type CreateScanInput = z.infer<typeof createScanBody>;
export type PreviewScanInput = z.infer<typeof previewBody>;
export type ListScansQuery = z.infer<typeof listScansQuery>;
export type ListMentionsQuery = z.infer<typeof listMentionsQuery>;
export type ScanIdParam = z.infer<typeof scanIdParam>;
export type SiteIdParams = z.infer<typeof siteIdParams>;
