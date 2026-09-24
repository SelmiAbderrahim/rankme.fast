import { z } from 'zod';
import type { TFunction } from 'i18next';
import { RANK_ENGINES } from './types';

/** Client mirrors of the server's engine-target patterns. */
export const YOUTUBE_HANDLE_RE = /^@?[A-Za-z0-9._-]{3,60}$/;
export const AMAZON_ASIN_RE = /^[A-Za-z0-9]{10}$/;

/**
 * Client-side mirror of the server's `createKeywordSchema` so
 * inline form validation and the API stay in agreement.
 */
export const buildAddKeywordSchema = (t: TFunction<'ranks'>) =>
  z.object({
    phrase: z.string().superRefine((value, ctx) => {
      const phrases = parseKeywordLines(value);
      if (phrases.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('errors.phraseRequired') });
      } else if (phrases.some((phrase) => phrase.length > 300)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('errors.phraseTooLong') });
      }
    }),
    locationCode: z.coerce
      .number({ invalid_type_error: t('errors.locationInvalid') })
      .int(t('errors.locationInvalid'))
      .positive(t('errors.locationInvalid')),
    languageCode: z
      .string()
      .trim()
      .min(2, t('errors.languageInvalid'))
      .max(10, t('errors.languageInvalid')),
    device: z.enum(['desktop', 'mobile']),
    // The engine picker plus its match token.
    engine: z.enum(RANK_ENGINES),
    engineTarget: z.string().trim().max(120).optional(),
  })
    .superRefine((value, ctx) => {
      // Mirrors the server `createKeywordSchema.superRefine` exactly: the
      // token-matched engines REQUIRE a well-formed target, and the
      // domain-matched engines refuse one.
      if (value.engine === 'youtube' || value.engine === 'amazon') {
        if (!value.engineTarget) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['engineTarget'],
            message: t('errors.engineTargetRequired'),
          });
          return;
        }
        const pattern = value.engine === 'youtube' ? YOUTUBE_HANDLE_RE : AMAZON_ASIN_RE;
        if (!pattern.test(value.engineTarget)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['engineTarget'],
            message: t(
              value.engine === 'youtube'
                ? 'errors.youtubeHandleInvalid'
                : 'errors.amazonAsinInvalid',
            ),
          });
        }
        return;
      }
      if (value.engineTarget) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['engineTarget'],
          message: t('errors.engineTargetNotAllowed'),
        });
      }
    });

export type AddKeywordFormValues = z.infer<ReturnType<typeof buildAddKeywordSchema>>;

export const normalizeKeywordPhrase = (phrase: string): string =>
  phrase.trim().toLowerCase().replace(/\s+/g, ' ');

/** Newlines and commas both delimit phrases (pasted lists come either way). */
export const parseKeywordLines = (value: string): string[] => {
  const seen = new Set<string>();
  return value.split(/[\r\n,]+/).flatMap((line) => {
    const phrase = line.trim();
    const key = normalizeKeywordPhrase(phrase);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [phrase];
  });
};

export const longTailResearchSeed = (value: string, engine: string): string | null => {
  if (engine !== 'google') return null;
  const phrases = parseKeywordLines(value);
  const phrase = phrases.length === 1 ? phrases[0] : undefined;
  return phrase && phrase.length <= 80 ? phrase : null;
};

export const buildLongTailResearchUrl = (
  siteId: string,
  seed: string,
  locationCode: number,
  languageCode: string,
): string => {
  const params = new URLSearchParams({
    tab: 'research',
    seed,
    location: String(locationCode),
    lang: languageCode,
  });
  return `/sites/${encodeURIComponent(siteId)}?${params.toString()}`;
};

export const LANGUAGE_OPTIONS = ['en', 'fr', 'de', 'es', 'ar', 'ru', 'zh'] as const;

export type LanguageOption = (typeof LANGUAGE_OPTIONS)[number];

export interface LocationOption {
  code: number;
  region: string;
  /** Languages DataForSEO actually serves for this country, primary first. */
  languages: readonly LanguageOption[];
}

/**
 * DataForSEO location codes for the picker. Region names come from
 * `Intl.DisplayNames` at render time so they follow the active locale.
 *
 * Every entry is a `location_type: 'Country'` row from DataForSEO Labs
 * `/dataforseo_labs/locations_and_languages` whose `available_languages`
 * intersect `LANGUAGE_OPTIONS`, and each is also a Google Ads country so the
 * `keywords_for_site` fallback accepts it. `languages` is that intersection —
 * Labs REJECTS an unlisted pairing outright (`Invalid Field: 'language_code'`),
 * which surfaces as a 503 and still spends a `keyword_lookups` unit, so the
 * form must never offer a pairing that is not in this list.
 *
 * Labs is the narrower catalogue and is what bounds this list: it carries no
 * country serving `zh`, and no longer carries Russia at all, so `ru` is
 * reachable only through Kazakhstan and Ukraine.
 *
 * US stays first — `AddKeywordForm` uses `LOCATION_OPTIONS[0]` as the form
 * default. The rest are ISO-ordered here and sorted by localized name at
 * render time.
 */
export const LOCATION_OPTIONS: LocationOption[] = [
  { code: 2840, region: 'US', languages: ['en', 'es'] },
  { code: 2784, region: 'AE', languages: ['en', 'ar'] },
  { code: 2032, region: 'AR', languages: ['es'] },
  { code: 2040, region: 'AT', languages: ['de'] },
  { code: 2036, region: 'AU', languages: ['en'] },
  { code: 2056, region: 'BE', languages: ['fr', 'de'] },
  { code: 2854, region: 'BF', languages: ['fr'] },
  { code: 2048, region: 'BH', languages: ['ar'] },
  { code: 2068, region: 'BO', languages: ['es'] },
  { code: 2124, region: 'CA', languages: ['en', 'fr'] },
  { code: 2756, region: 'CH', languages: ['fr', 'de'] },
  { code: 2384, region: 'CI', languages: ['fr'] },
  { code: 2152, region: 'CL', languages: ['es'] },
  { code: 2120, region: 'CM', languages: ['fr'] },
  { code: 2170, region: 'CO', languages: ['es'] },
  { code: 2188, region: 'CR', languages: ['es'] },
  { code: 2196, region: 'CY', languages: ['en'] },
  { code: 2276, region: 'DE', languages: ['de'] },
  { code: 2012, region: 'DZ', languages: ['fr', 'ar'] },
  { code: 2218, region: 'EC', languages: ['es'] },
  { code: 2818, region: 'EG', languages: ['en', 'ar'] },
  { code: 2724, region: 'ES', languages: ['es'] },
  { code: 2250, region: 'FR', languages: ['fr'] },
  { code: 2826, region: 'GB', languages: ['en'] },
  { code: 2288, region: 'GH', languages: ['en'] },
  { code: 2300, region: 'GR', languages: ['en'] },
  { code: 2320, region: 'GT', languages: ['es'] },
  { code: 2360, region: 'ID', languages: ['en'] },
  { code: 2372, region: 'IE', languages: ['en'] },
  { code: 2376, region: 'IL', languages: ['ar'] },
  { code: 2356, region: 'IN', languages: ['en'] },
  { code: 2400, region: 'JO', languages: ['ar'] },
  { code: 2404, region: 'KE', languages: ['en'] },
  { code: 2116, region: 'KH', languages: ['en'] },
  { code: 2398, region: 'KZ', languages: ['ru'] },
  { code: 2144, region: 'LK', languages: ['en'] },
  { code: 2504, region: 'MA', languages: ['fr', 'ar'] },
  { code: 2492, region: 'MC', languages: ['fr'] },
  { code: 2104, region: 'MM', languages: ['en'] },
  { code: 2470, region: 'MT', languages: ['en'] },
  { code: 2484, region: 'MX', languages: ['es'] },
  { code: 2458, region: 'MY', languages: ['en'] },
  { code: 2566, region: 'NG', languages: ['en'] },
  { code: 2558, region: 'NI', languages: ['es'] },
  { code: 2554, region: 'NZ', languages: ['en'] },
  { code: 2591, region: 'PA', languages: ['es'] },
  { code: 2604, region: 'PE', languages: ['es'] },
  { code: 2608, region: 'PH', languages: ['en'] },
  { code: 2586, region: 'PK', languages: ['en'] },
  { code: 2600, region: 'PY', languages: ['es'] },
  { code: 2682, region: 'SA', languages: ['ar'] },
  { code: 2702, region: 'SG', languages: ['en'] },
  { code: 2686, region: 'SN', languages: ['fr'] },
  { code: 2222, region: 'SV', languages: ['es'] },
  { code: 2788, region: 'TN', languages: ['ar'] },
  { code: 2804, region: 'UA', languages: ['ru'] },
  { code: 2858, region: 'UY', languages: ['es'] },
  { code: 2862, region: 'VE', languages: ['es'] },
  { code: 2704, region: 'VN', languages: ['en'] },
  { code: 2710, region: 'ZA', languages: ['en'] },
];

const LOCATION_BY_CODE = new Map(LOCATION_OPTIONS.map((opt) => [opt.code, opt]));

/**
 * The languages DataForSEO serves for `code`, falling back to the first
 * location's list so an unknown code can never yield an empty picker.
 */
export const languagesForLocation = (code: number): readonly LanguageOption[] =>
  (LOCATION_BY_CODE.get(code) ?? LOCATION_OPTIONS[0]!).languages;

export const DEVICE_OPTIONS = ['desktop', 'mobile'] as const;
