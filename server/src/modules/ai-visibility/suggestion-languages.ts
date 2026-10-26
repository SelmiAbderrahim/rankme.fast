/**
 * Which languages a site's AI-visibility suggestions are written in: the site's default-market language, plus at most one more
 * language that the site's own tracked keywords show it serves (a Saudi site
 * tracking Arabic and English phrases gets both). Never the viewer's
 * interface language just because of who is looking — that is only the
 * fallback when the site has no usable market language.
 */
import { SUPPORTED_LOCALES, type SupportedLocale } from '../../shared/i18n/locales.js';
import { seedFitsLocale } from './prompt-seed-quality.js';

/** A second language needs at least this many tracked keywords behind it. */
export const MIN_SECONDARY_LANGUAGE_KEYWORDS = 2;

const LATIN_LOCALES: readonly SupportedLocale[] = ['en', 'fr', 'de', 'es'];

const isSupported = (value: string | null | undefined): value is SupportedLocale =>
  (SUPPORTED_LOCALES as readonly string[]).includes(value ?? '');

/**
 * The language a tracked keyword is written in, or null when it cannot tell.
 * Script decides Arabic, Russian and Chinese; for Latin script the primary
 * language wins when the phrase fits it, then English, then a sole fit.
 */
export function keywordLanguage(phrase: string, primary: SupportedLocale): SupportedLocale | null {
  for (const locale of ['ar', 'ru', 'zh'] as const) {
    if (seedFitsLocale(phrase, locale)) return locale;
  }
  const fits = LATIN_LOCALES.filter((locale) => seedFitsLocale(phrase, locale));
  if (fits.includes(primary)) return primary;
  if (fits.includes('en')) return 'en';
  return fits.length === 1 ? fits[0]! : null;
}

export interface SuggestionLanguages {
  primary: SupportedLocale;
  secondary: SupportedLocale | null;
}

export function resolveSuggestionLanguages(input: {
  /** `Site.defaultMarket.languageCode`, when the site has one. */
  marketLanguage: string | null | undefined;
  /** The viewer's interface language: fallback only. */
  uiLocale: SupportedLocale;
  /** The site's own tracked keyword phrases. */
  keywords: readonly string[];
}): SuggestionLanguages {
  const primary = isSupported(input.marketLanguage) ? input.marketLanguage : input.uiLocale;
  const counts = new Map<SupportedLocale, number>();
  for (const phrase of input.keywords) {
    const language = keywordLanguage(phrase, primary);
    if (language && language !== primary) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const [best] = [...counts.entries()]
    .filter(([, count]) => count >= MIN_SECONDARY_LANGUAGE_KEYWORDS)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { primary, secondary: best ? best[0] : null };
}
