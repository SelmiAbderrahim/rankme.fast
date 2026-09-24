import { apiClient } from '@shared/api/client';
import {
  marketCatalogResponseSchema,
  type MarketCatalogResponse,
  type MarketCatalogSurface,
} from './types';

export async function fetchMarketCatalog(
  surface: MarketCatalogSurface,
  signal?: AbortSignal,
): Promise<MarketCatalogResponse> {
  const raw = await apiClient<unknown>(`/market-catalogs/${surface}`, signal ? { signal } : {});
  return marketCatalogResponseSchema.parse(raw);
}

