import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { rememberLastMarket, useInitialMarket, type InitialMarket, type MarketChoice } from './initialMarket';

export const SITE_MARKET_SOURCES = ['owner', 'search_console', 'cctld', 'site_language', 'assumed'] as const;
export type SiteMarketSource = (typeof SITE_MARKET_SOURCES)[number];
export interface SiteMarketChoice extends MarketChoice { source?: SiteMarketSource | null; }
export interface ResolvedSiteMarket extends MarketChoice { source: SiteMarketSource | null; }
interface SiteMarketValue {
  market: ResolvedSiteMarket | null | undefined;
  onEditMarket: (() => void) | null;
}
const SiteMarketContext = createContext<SiteMarketValue | null>(null);
export interface SiteMarketProviderProps {
  market: SiteMarketChoice | null | undefined;
  onEditMarket?: (() => void) | null;
  children: ReactNode;
}

export function SiteMarketProvider({ market, onEditMarket = null, children }: SiteMarketProviderProps) {
  const loading = market === undefined;
  const locationCode = market?.locationCode;
  const languageCode = market?.languageCode;
  const device = market?.device;
  const source = market?.source ?? null;
  const value = useMemo<SiteMarketValue>(() => ({
    market: loading ? undefined : locationCode !== undefined && languageCode !== undefined && device !== undefined ? { locationCode, languageCode, device, source } : null,
    onEditMarket,
  }), [loading, locationCode, languageCode, device, source, onEditMarket]);
  return <SiteMarketContext.Provider value={value}>{children}</SiteMarketContext.Provider>;
}

export function useSiteMarket(): SiteMarketValue | null {
  return useContext(SiteMarketContext);
}

export interface PickerMarket {
  initial: InitialMarket;
  ready: boolean;
  inSite: boolean;
  remember: (market: MarketChoice) => void;
}

export function usePickerMarket(storageKey: string): PickerMarket {
  const site = useContext(SiteMarketContext);
  const { i18n } = useTranslation();
  const initial = useInitialMarket(site?.market ?? null, { storageKey, locale: i18n.language });
  const remember = useCallback((market: MarketChoice) => rememberLastMarket(storageKey, market), [storageKey]);
  return { initial, ready: site === null || site.market !== undefined, inSite: site !== null, remember };
}
