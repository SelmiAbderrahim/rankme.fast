import { useEffect, useState } from 'react';
import { fetchMarketCatalog } from './api';
import type { MarketCatalogEntry, MarketCatalogSurface } from './types';

interface MarketCatalogState {
  markets: MarketCatalogEntry[];
  loading: boolean;
  error: boolean;
}

export function useMarketCatalog(surface: MarketCatalogSurface): MarketCatalogState {
  const [state, setState] = useState<MarketCatalogState>({
    markets: [],
    loading: true,
    error: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ markets: [], loading: true, error: false });
    void fetchMarketCatalog(surface, controller.signal).then(
      (catalog) => {
        if (!controller.signal.aborted) {
          setState({ markets: catalog.markets, loading: false, error: false });
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setState({ markets: [], loading: false, error: true });
        }
      },
    );
    return () => controller.abort();
  }, [surface]);

  return state;
}

