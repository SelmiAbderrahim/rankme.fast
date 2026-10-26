import { useCallback, useMemo, useRef } from 'react';
import { usePickerMarket, useSeededMarket, type MarketChoice } from '@shared/markets';

export interface ResearchMarket {
  locationCode: number;
  languageCode: string;
  /** The owner picked a country: remembered, and the site market no longer overrides it. */
  setLocationCode: (locationCode: number) => void;
  setLanguageCode: (languageCode: string) => void;
  /** Automatic corrections (a language the catalog does not offer): not a choice. */
  adjustLocationCode: (locationCode: number) => void;
  adjustLanguageCode: (languageCode: string) => void;
}

/** One storage key: every research view on a global page shares the last market used. */
export const RESEARCH_MARKET_STORAGE_KEY = 'keywordResearch';

/**
 * The market every keyword-research view starts in: an
 * explicit deep link (`location`/`lang`) when there is one, otherwise the
 * site's default market inside a site, else the last market used on these
 * views, else the interface language's home market. It follows a late-loading
 * site until the owner changes country or language; the setters are stable.
 */
export function useResearchMarket(
  link?: { locationCode: number; languageCode: string } | null,
): ResearchMarket {
  const picker = usePickerMarket(RESEARCH_MARKET_STORAGE_KEY);
  const linkLocation = link?.locationCode;
  const linkLanguage = link?.languageCode;
  const { initial } = picker;
  const seed = useMemo<MarketChoice>(
    () =>
      linkLocation !== undefined && linkLanguage !== undefined
        ? { locationCode: linkLocation, languageCode: linkLanguage, device: initial.device }
        : initial,
    [initial, linkLanguage, linkLocation],
  );
  const [market, choose, adjust] = useSeededMarket(seed);
  const current = useRef(market);
  current.current = market;
  const { remember } = picker;
  const setLocationCode = useCallback(
    (locationCode: number) => {
      const next = { ...current.current, locationCode };
      // Two setters in one handler ("Search again") must both land.
      current.current = next;
      choose(next);
      remember(next);
    },
    [choose, remember],
  );
  const setLanguageCode = useCallback(
    (languageCode: string) => {
      const next = { ...current.current, languageCode };
      current.current = next;
      choose(next);
      remember(next);
    },
    [choose, remember],
  );
  const adjustLocationCode = useCallback(
    (locationCode: number) => {
      current.current = { ...current.current, locationCode };
      adjust(current.current);
    },
    [adjust],
  );
  const adjustLanguageCode = useCallback(
    (languageCode: string) => {
      current.current = { ...current.current, languageCode };
      adjust(current.current);
    },
    [adjust],
  );
  return {
    locationCode: market.locationCode,
    languageCode: market.languageCode,
    setLocationCode,
    setLanguageCode,
    adjustLocationCode,
    adjustLanguageCode,
  };
}
