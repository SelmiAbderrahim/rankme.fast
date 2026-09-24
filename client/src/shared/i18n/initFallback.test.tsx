import { describe, expect, it, vi } from 'vitest';

// Force `isSupportedLocale` to always report false so that, inside initI18n,
// the resolved language is treated as unsupported and the code falls back to
// DEFAULT_LOCALE (the `: DEFAULT_LOCALE` arm of the active-locale ternary).
// All other locale exports keep their real values so i18next still boots.
vi.mock('./locales', async () => {
  const actual = await vi.importActual<typeof import('./locales')>('./locales');
  return { ...actual, isSupportedLocale: () => false };
});

describe('initI18n fallback to DEFAULT_LOCALE', () => {
  it('applies DEFAULT_LOCALE when the resolved language is not supported', async () => {
    const { initI18n } = await import('./index');
    const { DEFAULT_LOCALE } = await import('./locales');
    initI18n();
    expect(document.documentElement.lang).toBe(DEFAULT_LOCALE);
  });
});
