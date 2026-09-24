import { createInstance, type i18n as I18nType, type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, NAMESPACES, SUPPORTED_LOCALES } from './locales';
import type { SupportedLocale } from './locales';
import { RESOURCES } from './resources';

/**
 * Build a request-scoped i18next instance for SSR. The browser singleton
 * (`initI18n` in ./index) is NOT request-safe — sharing it across requests
 * would leak the last request's language. Each SSR render gets its own
 * instance with the locale resolved from the URL. `initImmediate: false`
 * makes init synchronous (resources are bundled, no async backend) so the
 * instance is ready before renderToString.
 */
export function createServerI18n(locale: SupportedLocale): I18nType {
  const instance = createInstance();
  const resources = Object.fromEntries(
    SUPPORTED_LOCALES.map((l) => [l, RESOURCES[l]]),
  );

  void instance.use(initReactI18next).init({
    resources: resources as Resource,
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    ns: NAMESPACES as unknown as string[],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    initImmediate: false,
  });

  return instance;
}
