import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  localizedPath,
  absoluteUrl,
  hreflangAlternates,
  canonicalFor,
  SITE_URL,
  ogLocaleFor,
} from './meta';
import { SUPPORTED_LOCALES } from '@shared/i18n';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('seo/meta', () => {
  it('localizedPath keeps English un-prefixed and prefixes other locales', () => {
    expect(localizedPath('/', 'en')).toBe('/');
    expect(localizedPath('/free-audit', 'en')).toBe('/free-audit');
    expect(localizedPath('/free-audit', 'fr')).toBe('/fr/free-audit');
    // The root path collapses so we don't emit a trailing slash after the locale.
    expect(localizedPath('/', 'de')).toBe('/de');
  });

  it('absoluteUrl normalises the leading slash', () => {
    expect(absoluteUrl('/x')).toBe(`${SITE_URL}/x`);
    expect(absoluteUrl('x')).toBe(`${SITE_URL}/x`);
  });

  it('hreflangAlternates covers every locale plus x-default', () => {
    const alts = hreflangAlternates('/free-audit');
    expect(alts.some((a) => a.hrefLang === 'x-default')).toBe(true);
    expect(alts.some((a) => a.hrefLang === 'fr')).toBe(true);
    expect(alts.find((a) => a.hrefLang === 'x-default')?.href).toBe(absoluteUrl('/free-audit'));
  });

  it('canonicalFor returns the locale-specific absolute URL', () => {
    expect(canonicalFor('/free-audit', 'en')).toBe(absoluteUrl('/free-audit'));
    expect(canonicalFor('/free-audit', 'fr')).toBe(absoluteUrl('/fr/free-audit'));
  });

  it('emits og:locale as en_US-style for every supported locale', () => {
    expect(SUPPORTED_LOCALES.map((locale) => ogLocaleFor(locale))).toEqual([
      'en_US',
      'ar_AR',
      'fr_FR',
      'de_DE',
      'es_ES',
      'ru_RU',
      'zh_CN',
    ]);
  });

  it('falls back to path-only URLs during SSR when VITE_SITE_URL is absent', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SITE_URL', undefined);
    vi.stubGlobal('window', undefined);

    const { SITE_URL: ssrSiteUrl, absoluteUrl: ssrAbsoluteUrl } = await import('./meta');

    expect(ssrSiteUrl).toBe('');
    expect(ssrAbsoluteUrl('/free-audit')).toBe('/free-audit');
  });

  it('falls back to window.location.origin in the browser when VITE_SITE_URL is absent', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SITE_URL', undefined);

    const { SITE_URL: browserSiteUrl, absoluteUrl: browserAbsoluteUrl } = await import(
      './meta'
    );

    expect(browserSiteUrl).toBe(window.location.origin);
    expect(browserAbsoluteUrl('/free-audit')).toBe(`${window.location.origin}/free-audit`);
  });
});
