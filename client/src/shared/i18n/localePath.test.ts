import { describe, expect, it } from 'vitest';
import { authEntryHref, localeHref, resolveMarketingRoute } from './localePath';

describe('resolveMarketingRoute', () => {
  it.each([
    ['/', 'en', '/'],
    ['/docs/', 'en', '/docs'],
    ['/en/docs', 'en', '/en/docs'],
    ['/ar', 'ar', '/'],
    ['/ar/', 'ar', '/'],
    ['/fr/docs/getting-started/', 'fr', '/docs/getting-started'],
    ['/xx/docs', 'en', '/xx/docs'],
  ])('resolves %s to locale %s and base path %s', (pathname, locale, basePath) => {
    expect(resolveMarketingRoute(pathname)).toEqual({ locale, basePath });
  });
});

describe('localeHref / authEntryHref', () => {
  it('prefixes only non-default locales', () => {
    expect(localeHref('/docs', 'en')).toBe('/docs');
    expect(localeHref('/', 'zh')).toBe('/zh');
    expect(localeHref('/docs', 'zh')).toBe('/zh/docs');
  });

  it('carries non-default locales into auth entry points as ?lng=', () => {
    expect(authEntryHref('/login', 'en')).toBe('/login');
    expect(authEntryHref('/register', 'de')).toBe('/register?lng=de');
  });
});
