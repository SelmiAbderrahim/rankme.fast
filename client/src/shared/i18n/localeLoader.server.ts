import type { Namespace, SupportedLocale } from './locales';
import { RESOURCES } from './resources';
import type { LocaleResourceModule } from './localeLoader';

export function loadLocaleResource(lng: string, ns: string): Promise<LocaleResourceModule> {
  return Promise.resolve({
    default: RESOURCES[lng as SupportedLocale][ns as Namespace],
  });
}
