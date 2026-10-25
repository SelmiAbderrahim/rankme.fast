import { z } from 'zod';
import { SITE_URL_MAX_LENGTH } from '../../shared/validation/site-url.js';
import { SITE_MARKET_DEVICES } from './site-market.js';
// Request-shape validation only. The strict URL semantics (scheme, IP
// literals, TLD, userinfo, normalization) live in the shared validator —
// the service maps its reject reasons to localized errors.
export const createSiteSchema = z.object({
    url: z.string().max(SITE_URL_MAX_LENGTH + 1024),
    displayName: z.string().trim().max(120).optional(),
});
export type CreateSiteBody = z.infer<typeof createSiteSchema>;
export const listSitesQuerySchema = z.object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListSitesQuery = z.infer<typeof listSitesQuerySchema>;
export const siteIdParamsSchema = z.object({
    id: z.string().min(1),
});
export type SiteIdParams = z.infer<typeof siteIdParamsSchema>;
const siteMarketSchema = z.object({
    locationCode: z.number().int().positive(),
    languageCode: z.string().regex(/^[a-z]{2,3}(?:-[a-z]{2})?$/i),
    device: z.enum(SITE_MARKET_DEVICES),
});
export const updateSiteSchema = z.object({
    displayName: z.string().trim().max(120).optional(),
    defaultMarket: siteMarketSchema.optional(),
    localBusiness: z.boolean().optional(),
}).refine((body) => body.displayName !== undefined || body.defaultMarket !== undefined || body.localBusiness !== undefined);
export type UpdateSiteBody = z.infer<typeof updateSiteSchema>;
