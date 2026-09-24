import { z } from 'zod';
import { validateSiteUrl } from '../../shared/validation/site-url.js';
import { BACKLINK_BULK_RANK_MAX_DOMAINS, BACKLINK_HISTORY_MAX_MONTHS, BACKLINK_PULL_MAX_ROWS, BACKLINK_PULL_TYPES, LINK_INTELLIGENCE_DOMAIN_MAX_LENGTH, } from './backlink-runs.model.js';
const objectIdHexSchema = z
    .string()
    .regex(/^[0-9a-f]{24}$/i, 'backlinks.errors.siteNotFound');
function clamp(value: number, maximum: number): number {
    return Math.min(maximum, Math.max(1, value));
}
function boundedLimit(maximum: number, fallback: number) {
    return z.coerce
        .number()
        .finite()
        .int()
        .transform((value) => clamp(value, maximum))
        .default(fallback);
}
/**
 * Domain-only boundary used by bulk-rank inputs. It reuses the shipped site
 * URL validator for protocol/userinfo/IP/TLD checks, then returns only the
 * normalized hostname. No server-side fetch occurs here.
 */
export const backlinkDeepDomainSchema = z
    .string()
    .trim()
    .min(1)
    .max(LINK_INTELLIGENCE_DOMAIN_MAX_LENGTH + 16)
    .transform((raw, context) => {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
        ? raw
        : `https://${raw}`;
    const parsed = validateSiteUrl(candidate);
    if (!parsed.ok || parsed.domain.length > LINK_INTELLIGENCE_DOMAIN_MAX_LENGTH) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'backlinks.errors.domainInvalid',
        });
        return z.NEVER;
    }
    return parsed.domain.toLowerCase().replace(/^www\./, '');
});
export const referringDomainsBodySchema = z
    .object({
    siteId: objectIdHexSchema,
    limit: boundedLimit(BACKLINK_PULL_MAX_ROWS, BACKLINK_PULL_MAX_ROWS),
})
    .strict();
export const anchorsBodySchema = referringDomainsBodySchema;
export const historyBodySchema = z
    .object({
    siteId: objectIdHexSchema,
    limit: boundedLimit(BACKLINK_HISTORY_MAX_MONTHS, BACKLINK_HISTORY_MAX_MONTHS),
})
    .strict();
export const bulkRanksBodySchema = z
    .object({
    siteId: objectIdHexSchema,
    domains: z
        .array(backlinkDeepDomainSchema)
        .min(1)
        .transform((domains) => [
        ...new Set(domains),
    ].slice(0, BACKLINK_BULK_RANK_MAX_DOMAINS)),
})
    .strict();
export const backlinkRunsQuerySchema = z
    .object({
    siteId: objectIdHexSchema,
    type: z.enum(BACKLINK_PULL_TYPES).optional(),
    limit: boundedLimit(100, 20),
    cursor: objectIdHexSchema.optional(),
})
    .strict();
export const backlinkRunParamsSchema = z
    .object({ id: objectIdHexSchema })
    .strict();
export type ReferringDomainsBody = z.infer<typeof referringDomainsBodySchema>;
export type AnchorsBody = z.infer<typeof anchorsBodySchema>;
export type HistoryBody = z.infer<typeof historyBodySchema>;
export type BulkRanksBody = z.infer<typeof bulkRanksBodySchema>;
export type BacklinkRunsQuery = z.infer<typeof backlinkRunsQuerySchema>;
