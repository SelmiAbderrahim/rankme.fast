import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { locationCodeForCountry } from './format';
import type { MarketCatalogEntry } from './types';

export type MarketDevice = 'desktop' | 'mobile';
export interface MarketChoice { locationCode: number; languageCode: string; device: MarketDevice; }
export type InitialMarketSource = 'site' | 'lastUsed' | 'locale' | 'fallback';
export interface InitialMarket extends MarketChoice { source: InitialMarketSource; }
export const FALLBACK_MARKET: MarketChoice = Object.freeze({ locationCode: 2840, languageCode: 'en', device: 'desktop' });
const LOCALE_COUNTRY: Readonly<Record<string, string>> = Object.freeze({ ar: 'SA', de: 'DE', en: 'US', es: 'ES', fr: 'FR', ru: 'RU', zh: 'TW' });
const STORAGE_PREFIX = 'rmf.market.';

/** Language-based fallback only; it does not claim to locate the viewer. */
export function countryForLocale(locale: string | null | undefined): string | null {
  return LOCALE_COUNTRY[(locale ?? '').slice(0, 2).toLowerCase()] ?? null;
}

function isMarketChoice(value: unknown): value is MarketChoice {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.locationCode === 'number' && Number.isInteger(candidate.locationCode) && candidate.locationCode > 0
    && typeof candidate.languageCode === 'string' && /^[a-z]{2}$/.test(candidate.languageCode)
    && (candidate.device === 'desktop' || candidate.device === 'mobile');
}

export function readLastMarket(storageKey: string): MarketChoice | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isMarketChoice(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function rememberLastMarket(storageKey: string, market: MarketChoice): void {
  try {
    const { locationCode, languageCode, device } = market;
    window.localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify({ locationCode, languageCode, device }));
  } catch {
    // A picker remains usable when site storage is blocked.
  }
}

export interface ResolveInitialMarketInput {
  siteMarket?: MarketChoice | null;
  lastUsed?: MarketChoice | null;
  locale?: string | null;
}
const pick = ({ locationCode, languageCode, device }: MarketChoice): MarketChoice => ({ locationCode, languageCode, device });

export function resolveInitialMarket(input: ResolveInitialMarketInput): InitialMarket {
  if (input.siteMarket) return { ...pick(input.siteMarket), source: 'site' };
  if (input.lastUsed) return { ...pick(input.lastUsed), source: 'lastUsed' };
  const language = (input.locale ?? '').slice(0, 2).toLowerCase();
  const country = countryForLocale(language);
  const locationCode = country ? locationCodeForCountry(country) : null;
  return locationCode === null ? { ...FALLBACK_MARKET, source: 'fallback' } : { locationCode, languageCode: language, device: 'desktop', source: 'locale' };
}

export interface FallbackMarketOptions { countryCodes?: ReadonlyArray<string | null | undefined>; locale?: string | null; }

/** Array order is a last resort, after known country and language preferences. */
export function pickFallbackMarket<T extends { countryCode: string }>(markets: readonly T[], options: FallbackMarketOptions = {}): T | undefined {
  for (const code of [...(options.countryCodes ?? []), countryForLocale(options.locale), 'US']) {
    if (!code) continue;
    const match = markets.find((market) => market.countryCode === code);
    if (match) return match;
  }
  return markets[0];
}

export function pickFallbackLanguage(languages: readonly string[], current: string, locale?: string | null): string {
  if (languages.includes(current)) return current;
  const ui = (locale ?? '').slice(0, 2).toLowerCase();
  if (ui && languages.includes(ui)) return ui;
  if (languages.includes('en')) return 'en';
  return languages[0] ?? current;
}

export function marketLanguages(markets: readonly MarketCatalogEntry[], locationCode: number): string[] {
  return [...(markets.find((market) => market.locationCode === locationCode)?.languageCodes ?? [])];
}

export function pickMarketLanguage(languages: readonly string[], current: string, preferred?: string): string {
  if (languages.includes(current)) return current;
  if (preferred && languages.includes(preferred)) return preferred;
  return languages[0] ?? current;
}

export function useInitialMarket(siteMarket: MarketChoice | null | undefined, options: { storageKey?: string; locale?: string } = {}): InitialMarket {
  const { storageKey, locale } = options;
  const lastUsed = useMemo(() => storageKey ? readLastMarket(storageKey) : null, [storageKey]);
  const siteLocation = siteMarket?.locationCode;
  const siteLanguage = siteMarket?.languageCode;
  const siteDevice = siteMarket?.device;
  return useMemo(() => resolveInitialMarket({
    siteMarket: siteLocation !== undefined && siteLanguage !== undefined && siteDevice !== undefined ? { locationCode: siteLocation, languageCode: siteLanguage, device: siteDevice } : null,
    lastUsed, locale,
  }), [lastUsed, locale, siteDevice, siteLanguage, siteLocation]);
}

/** Late defaults follow untouched pickers; automatic adjustments are not user choices. */
export function useSeededMarket(initial: MarketChoice): [MarketChoice, (next: MarketChoice) => void, (next: MarketChoice) => void] {
  const [market, setMarket] = useState<MarketChoice>(initial);
  const touched = useRef(false);
  const { locationCode, languageCode, device } = initial;
  useEffect(() => {
    if (!touched.current) setMarket({ locationCode, languageCode, device });
  }, [device, languageCode, locationCode]);
  const choose = useCallback((next: MarketChoice) => { touched.current = true; setMarket(next); }, []);
  const adjust = useCallback((next: MarketChoice) => setMarket(next), []);
  return [market, choose, adjust];
}
