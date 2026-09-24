import { useLocation } from 'react-router-dom';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  type SupportedLocale,
} from './index';

const NON_DEFAULT_LOCALES = SUPPORTED_LOCALES.filter(
  (locale) => locale !== DEFAULT_LOCALE,
);

export const MARKETING_LOCALE_PREFIXES = NON_DEFAULT_LOCALES;

export function resolveMarketingRoute(pathname: string): {
  locale: SupportedLocale;
  basePath: string;
} {
  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0];
  if (first && first !== DEFAULT_LOCALE && isSupportedLocale(first)) {
    const rest = `/${segments.slice(1).join('/')}`;
    return { locale: first, basePath: rest === '/' ? '/' : rest.replace(/\/$/, '') };
  }
  const base = `/${segments.join('/')}`;
  return {
    locale: DEFAULT_LOCALE,
    basePath: base === '/' ? '/' : base.replace(/\/$/, ''),
  };
}

export function useMarketingRoute(): {
  locale: SupportedLocale;
  basePath: string;
} {
  const { pathname } = useLocation();
  return resolveMarketingRoute(pathname);
}

export function localeHref(basePath: string, locale: SupportedLocale): string {
  if (locale === DEFAULT_LOCALE) return basePath;
  return basePath === '/' ? `/${locale}` : `/${locale}${basePath}`;
}

export function authEntryHref(path: '/login' | '/register', locale: SupportedLocale): string {
  return locale === DEFAULT_LOCALE ? path : `${path}?lng=${locale}`;
}
