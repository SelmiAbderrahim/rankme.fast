import { z } from 'zod';
import { SITE_URL_MAX_LENGTH } from '../../shared/validation/site-url.js';
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
export const updateSiteSchema = z.object({
    displayName: z.string().trim().max(120),
});
export type UpdateSiteBody = z.infer<typeof updateSiteSchema>;
