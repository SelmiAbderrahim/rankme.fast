import { useEffect, useState } from 'react';
import type { SiteMarketChoice } from '@shared/markets';
import { fetchSiteMarketRequest } from './api';
import type { Site } from './types';

/** Read the server's stored market decision and retain a stored-site fallback. */
export function useResolvedSiteMarket(site: Site | undefined): SiteMarketChoice | null | undefined {
  const siteId = site?.id;
  const stored = site?.defaultMarket ?? null;
  const storedKey = stored ? `${stored.locationCode}:${stored.languageCode}:${stored.device}:${stored.source}` : '';
  const key = `${siteId ?? ''}|${storedKey}`;
  const [resolved, setResolved] = useState<{ key: string; market: SiteMarketChoice | null } | null>(null);

  useEffect(() => {
    if (!siteId) return;
    const controller = new AbortController();
    fetchSiteMarketRequest(siteId, controller.signal).then(
      ({ market }) => {
        if (!controller.signal.aborted) {
          setResolved({ key, market: {
            locationCode: market.locationCode,
            languageCode: market.languageCode,
            device: market.device,
            source: market.source,
          } });
        }
      },
      () => {
        if (!controller.signal.aborted) setResolved({ key, market: null });
      },
    );
    return () => controller.abort();
  }, [key, siteId]);

  if (!site) return undefined;
  if (resolved?.key !== key) return undefined;
  if (resolved.market) return resolved.market;
  return stored ? {
    locationCode: stored.locationCode,
    languageCode: stored.languageCode,
    device: stored.device,
  } : null;
}
