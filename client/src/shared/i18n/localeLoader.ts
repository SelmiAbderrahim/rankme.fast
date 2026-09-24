import { DEFAULT_LOCALE } from './locales';
import type { Namespace } from './locales';
import { DEFAULT_RESOURCES } from './defaultResources';

export interface LocaleResourceModule {
  default: unknown;
}

const lazyResources = import.meta.glob<LocaleResourceModule>(
  './locales/{ar,fr,de,es,ru,zh}/*.json',
);

export function loadLocaleResource(lng: string, ns: string): Promise<LocaleResourceModule> {
  if (lng === DEFAULT_LOCALE) {
    return Promise.resolve({ default: DEFAULT_RESOURCES.en[ns as Namespace] });
  }
  return lazyResources[`./locales/${lng}/${ns}.json`]!();
}
