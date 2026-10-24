import { initI18n, type SupportedLocale } from '@shared/i18n';

/** Public documentation uses the same locale backend and namespace as the app. */
export async function initPublicI18n(options: { initialLocale?: SupportedLocale } = {}) {
  const instance = initI18n(options);
  await instance.loadNamespaces('docs');
  if (options.initialLocale) await instance.changeLanguage(options.initialLocale);
  return instance;
}
