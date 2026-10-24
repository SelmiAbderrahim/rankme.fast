import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countryForLocale, FALLBACK_MARKET, marketLanguages, pickFallbackLanguage, pickFallbackMarket, pickMarketLanguage, readLastMarket, rememberLastMarket, resolveInitialMarket, useInitialMarket, useSeededMarket, type MarketChoice } from './initialMarket';

const US: MarketChoice = { locationCode: 2840, languageCode: 'en', device: 'desktop' };
const FR: MarketChoice = { locationCode: 2250, languageCode: 'fr', device: 'mobile' };
const DE: MarketChoice = { locationCode: 2276, languageCode: 'de', device: 'desktop' };
beforeEach(() => window.localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('initial market selection', () => {
  it('prefers site, then last choice, then interface language, then an explicit fallback', () => {
    expect(resolveInitialMarket({ siteMarket: FR, lastUsed: US, locale: 'de' })).toEqual({ ...FR, source: 'site' });
    expect(resolveInitialMarket({ lastUsed: US, locale: 'de' })).toEqual({ ...US, source: 'lastUsed' });
    expect(resolveInitialMarket({ locale: 'de' })).toEqual({ ...DE, source: 'locale' });
    expect(resolveInitialMarket({ locale: 'zh' })).toEqual({ locationCode: 2158, languageCode: 'zh', device: 'desktop', source: 'locale' });
    expect(resolveInitialMarket({ locale: 'unknown' })).toEqual({ ...FALLBACK_MARKET, source: 'fallback' });
    expect(resolveInitialMarket({})).toEqual({ ...FALLBACK_MARKET, source: 'fallback' });
    expect(countryForLocale('AR-eg')).toBe('SA');
    expect(countryForLocale(null)).toBeNull();
    expect(countryForLocale(undefined)).toBeNull();
  });

  it('stores only market fields and ignores missing or malformed remembered values', () => {
    expect(readLastMarket('research')).toBeNull();
    rememberLastMarket('research', { ...FR, ...{ label: 'not stored' } });
    expect(readLastMarket('research')).toEqual(FR);
    expect(JSON.parse(window.localStorage.getItem('rmf.market.research')!)).toEqual(FR);
    for (const value of [null, [], {}, { ...US, locationCode: 0 }, { ...US, locationCode: 1.5 }, { ...US, languageCode: 4 }, { ...US, languageCode: 'EN' }, { ...US, device: 'tablet' }]) {
      window.localStorage.setItem('rmf.market.invalid', JSON.stringify(value));
      expect(readLastMarket('invalid')).toBeNull();
    }
    window.localStorage.setItem('rmf.market.invalid', '{ broken');
    expect(readLastMarket('invalid')).toBeNull();
  });

  it('keeps defaults usable when storage is blocked or no browser exists', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readLastMarket('research')).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => rememberLastMarket('research', US)).not.toThrow();
    vi.stubGlobal('window', undefined);
    expect(readLastMarket('research')).toBeNull();
    expect(() => rememberLastMarket('research', US)).not.toThrow();
  });

  it('chooses catalog fallbacks by known preferences rather than array order', () => {
    const markets = [{ countryCode: 'FR' }, { countryCode: 'US' }];
    expect(pickFallbackMarket(markets)).toBe(markets[1]);
    expect(pickFallbackMarket(markets, { countryCodes: [null, 'ZZ', 'FR'], locale: 'en' })).toBe(markets[0]);
    expect(pickFallbackMarket(markets, { locale: 'fr' })).toBe(markets[0]);
    expect(pickFallbackMarket([{ countryCode: 'DE' }])).toEqual({ countryCode: 'DE' });
    expect(pickFallbackMarket([])).toBeUndefined();
    expect(pickFallbackLanguage(['de', 'fr', 'en'], 'fr', 'de')).toBe('fr');
    expect(pickFallbackLanguage(['de', 'fr'], 'xx', 'fr-FR')).toBe('fr');
    expect(pickFallbackLanguage(['de', 'en'], 'xx')).toBe('en');
    expect(pickFallbackLanguage(['de'], 'xx')).toBe('de');
    expect(pickFallbackLanguage([], 'xx')).toBe('xx');
    expect(pickMarketLanguage(['de', 'fr'], 'fr', 'de')).toBe('fr');
    expect(pickMarketLanguage(['de', 'fr'], 'xx', 'fr')).toBe('fr');
    expect(pickMarketLanguage(['de'], 'xx')).toBe('de');
    expect(pickMarketLanguage([], 'xx', 'fr')).toBe('xx');
    const catalog = [{ countryCode: 'US', locationCode: 2840, languageCodes: ['en'] }];
    const languages = marketLanguages(catalog, 2840);
    languages.push('fr');
    expect(catalog[0]!.languageCodes).toEqual(['en']);
    expect(marketLanguages(catalog, 999)).toEqual([]);
  });

  it('follows a late site default while preserving a user choice afterwards', () => {
    rememberLastMarket('research', FR);
    const initial = renderHook(({ site, storageKey, locale }: { site: MarketChoice | null; storageKey?: string; locale?: string }) => useInitialMarket(site, { storageKey, locale }), { initialProps: { site: null as MarketChoice | null, storageKey: 'research', locale: 'en' } });
    expect(initial.result.current).toEqual({ ...FR, source: 'lastUsed' });
    initial.rerender({ site: DE, storageKey: 'research', locale: 'en' });
    expect(initial.result.current).toEqual({ ...DE, source: 'site' });
    initial.rerender({ site: null, storageKey: '', locale: 'en' });
    expect(initial.result.current).toEqual({ ...US, source: 'locale' });
    initial.unmount();
    const defaults = renderHook(() => useInitialMarket(undefined));
    expect(defaults.result.current.source).toBe('fallback');
    defaults.unmount();
    const seeded = renderHook(({ value }) => useSeededMarket(value), { initialProps: { value: US } });
    seeded.rerender({ value: FR });
    expect(seeded.result.current[0]).toEqual(FR);
    act(() => seeded.result.current[2](US));
    seeded.rerender({ value: DE });
    expect(seeded.result.current[0]).toEqual(DE);
    act(() => seeded.result.current[1](FR));
    seeded.rerender({ value: US });
    expect(seeded.result.current[0]).toEqual(FR);
  });
});
