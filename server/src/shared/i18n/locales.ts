export const SUPPORTED_LOCALES = ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'en';
export const LANGUAGE_COOKIE = 'lang';
export const LANGUAGE_HEADER = 'x-lang';
export const RTL_LOCALES: readonly SupportedLocale[] = ['ar'];
export function isSupportedLocale(value: unknown): value is SupportedLocale {
    return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
