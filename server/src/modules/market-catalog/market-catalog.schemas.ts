import { z } from 'zod';
export const MARKET_CATALOG_SURFACES = [
    'seo',
    'brand-radar',
    'app-google-play',
    'app-store',
] as const;
export const marketCatalogSurfaceSchema = z.enum(MARKET_CATALOG_SURFACES);
export type MarketCatalogSurface = z.infer<typeof marketCatalogSurfaceSchema>;
export const marketCatalogEntrySchema = z
    .object({
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    locationCode: z.number().int().positive().nullable(),
    languageCodes: z.array(z.string().regex(/^[a-z]{2}$/)).max(200),
})
    .strict();
export const marketCatalogPayloadSchema = z.array(marketCatalogEntrySchema).max(300);
