import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { readLastMarket, rememberLastMarket, SiteMarketProvider } from '@shared/markets';
import { RESEARCH_MARKET_STORAGE_KEY, useResearchMarket } from './useResearchMarket';

const SAUDI = { locationCode: 2682, languageCode: 'ar', device: 'desktop' } as const;

const inSite = (market: typeof SAUDI | null | undefined) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nextProvider i18n={i18n}>
        <SiteMarketProvider market={market}>{children}</SiteMarketProvider>
      </I18nextProvider>
    );
  };
const global = ({ children }: { children: ReactNode }) => (
  <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
);

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});
afterEach(() => window.localStorage.clear());

describe('useResearchMarket', () => {
  it("starts in the site's market and follows a late-loading site", () => {
    let market: typeof SAUDI | undefined = undefined;
    const { result, rerender } = renderHook(() => useResearchMarket(), {
      wrapper: ({ children }) => inSite(market)({ children }),
    });
    expect(result.current).toMatchObject({ locationCode: 2840, languageCode: 'en' });
    market = SAUDI;
    rerender();
    expect(result.current).toMatchObject({ locationCode: 2682, languageCode: 'ar' });
  });

  it('an explicit link wins over the site market', () => {
    const { result } = renderHook(() => useResearchMarket({ locationCode: 2276, languageCode: 'de' }), {
      wrapper: inSite(SAUDI),
    });
    expect(result.current).toMatchObject({ locationCode: 2276, languageCode: 'de' });
  });

  it('on a global page starts in the last market used, and remembers choices (not adjustments)', () => {
    rememberLastMarket(RESEARCH_MARKET_STORAGE_KEY, { locationCode: 2250, languageCode: 'fr', device: 'desktop' });
    const { result } = renderHook(() => useResearchMarket(), { wrapper: global });
    expect(result.current).toMatchObject({ locationCode: 2250, languageCode: 'fr' });
    act(() => result.current.adjustLanguageCode('en'));
    act(() => result.current.adjustLocationCode(2124));
    expect(result.current).toMatchObject({ locationCode: 2124, languageCode: 'en' });
    expect(readLastMarket(RESEARCH_MARKET_STORAGE_KEY)).toMatchObject({ locationCode: 2250, languageCode: 'fr' });
    // Two choices in one handler both land ("Search again").
    act(() => {
      result.current.setLocationCode(2276);
      result.current.setLanguageCode('de');
    });
    expect(result.current).toMatchObject({ locationCode: 2276, languageCode: 'de' });
    expect(readLastMarket(RESEARCH_MARKET_STORAGE_KEY)).toMatchObject({ locationCode: 2276, languageCode: 'de' });
  });

  it('a choice is never overridden by the site market arriving later', () => {
    let market: typeof SAUDI | undefined = undefined;
    const { result, rerender } = renderHook(() => useResearchMarket(), {
      wrapper: ({ children }) => inSite(market)({ children }),
    });
    act(() => result.current.setLocationCode(2826));
    market = SAUDI;
    rerender();
    expect(result.current.locationCode).toBe(2826);
  });
});
