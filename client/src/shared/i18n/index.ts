import i18n, { type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import resourcesToBackend from 'i18next-resources-to-backend';
import { loadCookie, saveCookie } from '@shared/utils/cookies';
import {
  DEFAULT_LOCALE,
  LANGUAGE_COOKIE,
  NAMESPACES,
  SUPPORTED_LOCALES,
  isRtl,
  isSupportedLocale,
} from './locales';
import type { SupportedLocale } from './locales';
import { DEFAULT_RESOURCES } from './defaultResources';
import { loadLocaleResource } from '@shared/i18n/localeLoader';
import {
  getPresentationLocale,
  setPresentationLocale,
} from './presentationLocale';

export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LANGUAGE_COOKIE,
  NAMESPACES,
  isSupportedLocale,
  isRtl,
} from './locales';
export type { SupportedLocale, Namespace } from './locales';
export {
  getPresentationLocale,
  getPresentationLocaleSnapshot,
  getPresentationRefreshSignal,
  isCurrentPresentationSnapshot,
  requestPresentationRefresh,
  setPresentationLocale,
  subscribePresentationLocale,
  subscribePresentationRefresh,
} from './presentationLocale';
export type {
  PresentationLocaleListener,
  PresentationLocaleSnapshot,
  PresentationRefreshListener,
  PresentationRefreshSignal,
} from './presentationLocale';
export {
  isCurrentPresentationRequest,
  presentationCacheKey,
  presentationLocaleChanged,
  presentationRequestIdentity,
} from './requestIdentity';
export type { PresentationRequestIdentity } from './requestIdentity';
export {
  useClearOnPresentationRefresh,
  usePresentationLocaleSnapshot,
  usePresentationRefreshSignal,
} from './usePresentationLocale';

const COOKIE_MAX_AGE_ONE_YEAR = 60 * 60 * 24 * 365;

export function readStoredLocale(): SupportedLocale | null {
  const raw = loadCookie<string>(LANGUAGE_COOKIE);
  return isSupportedLocale(raw) ? raw : null;
}

export function persistLocale(locale: SupportedLocale): void {
  saveCookie(LANGUAGE_COOKIE, locale, {
    path: '/',
    maxAge: COOKIE_MAX_AGE_ONE_YEAR,
    sameSite: 'lax',
  });
}

export function applyLocaleToDocument(locale: SupportedLocale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
}

interface InitOptions {
  initialLocale?: SupportedLocale;
}

let initialized = false;

export { loadLocaleResource };

export function createLazyResourcesBackend(
  loader: (lng: string, ns: string) => Promise<unknown> | unknown = loadLocaleResource,
) {
  return resourcesToBackend(loader);
}

export function initI18n(options: InitOptions = {}): typeof i18n {
  if (initialized) return i18n;
  initialized = true;

  const stored = readStoredLocale();
  const forcedLocale: SupportedLocale | undefined = options.initialLocale ?? stored ?? undefined;

  void i18n
    .use(LanguageDetector)
    .use(createLazyResourcesBackend())
    .use(initReactI18next)
    .init({
      partialBundledLanguages: true,
      resources: DEFAULT_RESOURCES as Resource,
      ...(forcedLocale ? { lng: forcedLocale } : {}),
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: SUPPORTED_LOCALES as unknown as string[],
      ns: NAMESPACES as unknown as string[],
      defaultNS: 'common',
      interpolation: { escapeValue: false },
      detection: {
        // A URL locale is authoritative for shareable E2E/user journeys;
        // the detector persists it through the existing languageChanged hook.
        order: ['querystring', 'cookie', 'navigator'],
        lookupQuerystring: 'lng',
        lookupCookie: LANGUAGE_COOKIE,
        caches: [],
      },
      returnEmptyString: false,
    });

  const active = (
    isSupportedLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE
  ) as SupportedLocale;
  setPresentationLocale(active);
  applyLocaleToDocument(active);
  i18n.on('languageChanged', (lng) => {
    if (isSupportedLocale(lng)) {
      setPresentationLocale(lng);
      persistLocale(lng);
      applyLocaleToDocument(lng);
    }
  });

  return i18n;
}

export async function changeLanguage(locale: SupportedLocale): Promise<void> {
  if (!isSupportedLocale(locale)) return;
  if (locale === getPresentationLocale() && i18n.resolvedLanguage === locale) return;
  await i18n.changeLanguage(locale);
}

export { i18n };
