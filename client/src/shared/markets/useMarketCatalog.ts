import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@shared/api/client';
import { isAbortError } from '@shared/api/errorMessage';
import { usePresentationRefreshSignal } from '@shared/i18n/usePresentationLocale';
import { fetchMarketCatalog } from './api';
import type { MarketCatalogEntry, MarketCatalogResponse, MarketCatalogSurface } from './types';

interface MarketCatalogState {
  markets: MarketCatalogEntry[];
  loading: boolean;
  error: boolean;
  retry: () => void;
}

const RETRY_DELAYS_MS = [250, 750] as const;

function isTransientCatalogError(error: unknown): boolean {
  if (error instanceof ApiError) return error.code === 'network' || error.code === 'timeout' || [408, 425, 429].includes(error.status) || error.status >= 500;
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'NetworkError');
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { window.clearTimeout(timer); reject(new DOMException('Catalogue request cancelled', 'AbortError')); };
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function fetchCatalogWithRetry(surface: MarketCatalogSurface, signal: AbortSignal): Promise<MarketCatalogResponse> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchMarketCatalog(surface, signal);
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (!isTransientCatalogError(error) || delay === undefined || signal.aborted) throw error;
      await waitForRetry(delay, signal);
    }
  }
}

export function useMarketCatalog(surface: MarketCatalogSurface): MarketCatalogState {
  const { refreshGeneration } = usePresentationRefreshSignal();
  const [state, setState] = useState<Omit<MarketCatalogState, 'retry'>>({
    markets: [],
    loading: true,
    error: false,
  });
  const [retryGeneration, setRetryGeneration] = useState(0);
  const retry = useCallback(() => setRetryGeneration((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ markets: [], loading: true, error: false });
    void fetchCatalogWithRetry(surface, controller.signal).then(
      (catalog) => {
        if (!controller.signal.aborted) {
          setState({ markets: catalog.markets, loading: false, error: false });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setState({ markets: [], loading: false, error: true });
        }
      },
    );
    return () => controller.abort();
  }, [refreshGeneration, retryGeneration, surface]);

  return { ...state, retry };
}

