import { z } from 'zod';

export const MARKET_CATALOG_SURFACES = [
  'seo',
  'brand-radar',
  'app-google-play',
  'app-store',
] as const;
export type MarketCatalogSurface = (typeof MARKET_CATALOG_SURFACES)[number];

export const marketCatalogEntrySchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  locationCode: z.number().int().positive().nullable(),
  languageCodes: z.array(z.string().regex(/^[a-z]{2}$/)),
}).strict();

export const marketCatalogResponseSchema = z.object({
  surface: z.enum(MARKET_CATALOG_SURFACES),
  markets: z.array(marketCatalogEntrySchema),
  fetchedAt: z.string().datetime({ offset: true }),
  cached: z.boolean(),
}).strict();

export type MarketCatalogEntry = z.infer<typeof marketCatalogEntrySchema>;
export type MarketCatalogResponse = z.infer<typeof marketCatalogResponseSchema>;

