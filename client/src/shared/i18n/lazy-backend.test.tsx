import { createInstance } from 'i18next';
import type { Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  NAMESPACES,
  SUPPORTED_LOCALES,
  changeLanguage,
  createLazyResourcesBackend,
  i18n,
  initI18n,
  loadLocaleResource,
} from './index';
import { RESOURCES } from './resources';
import { loadLocaleResource as loadServerLocaleResource } from './localeLoader.server';

describe('lazy i18n backend', () => {
  beforeEach(async () => {
    initI18n({ initialLocale: 'en' });
    await i18n.changeLanguage('en');
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  it('loads a namespace on demand for a non-default locale', async () => {
    const instance = createInstance();
    await instance
      .use(createLazyResourcesBackend())
      .use(initReactI18next)
      .init({
        partialBundledLanguages: true,
        resources: { [DEFAULT_LOCALE]: RESOURCES[DEFAULT_LOCALE] } as Resource,
        lng: 'de',
        fallbackLng: DEFAULT_LOCALE,
        supportedLngs: SUPPORTED_LOCALES as unknown as string[],
        ns: NAMESPACES as unknown as string[],
        defaultNS: 'common',
        returnEmptyString: false,
      });

    expect(instance.t('errors:notFound')).toMatch(/nicht gefunden/i);
  });

  it('falls back to en when a namespace chunk fails to load', async () => {
    const instance = createInstance();
    await instance
      .use(
        createLazyResourcesBackend((lng, ns) => {
          if (lng === 'de' && ns === 'errors') {
            return Promise.reject(new Error('chunk failed'));
          }
          return Promise.resolve(
            RESOURCES[lng as keyof typeof RESOURCES][
              ns as keyof (typeof RESOURCES)[typeof DEFAULT_LOCALE]
            ],
          );
        }),
      )
      .use(initReactI18next)
      .init({
        partialBundledLanguages: true,
        resources: { [DEFAULT_LOCALE]: RESOURCES[DEFAULT_LOCALE] } as Resource,
        lng: 'de',
        fallbackLng: DEFAULT_LOCALE,
        supportedLngs: SUPPORTED_LOCALES as unknown as string[],
        ns: ['errors'],
        defaultNS: 'errors',
        returnEmptyString: false,
      });

    expect(instance.t('notFound')).toBe('The requested resource was not found.');
  });

  it('DEFAULT_LOCALE strings resolve synchronously after init', () => {
    initI18n({ initialLocale: DEFAULT_LOCALE });
    expect(i18n.t('common:nav.dashboard')).toBe('Dashboard');
  });

  it('dir flips to rtl after an async switch to ar', async () => {
    await changeLanguage('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('can import every default-locale namespace chunk on demand', async () => {
    const modules = await Promise.all(
      NAMESPACES.map((namespace) => loadLocaleResource(DEFAULT_LOCALE, namespace)),
    );
    expect(modules).toHaveLength(NAMESPACES.length);
    expect(modules.every((module) => typeof module.default === 'object')).toBe(true);
  });

  it('serves bundled locale resources to the SSR runtime loader', async () => {
    await expect(loadServerLocaleResource('ar', 'common')).resolves.toEqual({
      default: RESOURCES.ar.common,
    });
  });
});
