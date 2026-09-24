import { z } from 'zod';
import type { GapRow, ResearchHistoryItem } from './types';
import { countryCodeForLocation, locationCodeForCountry } from '@shared/markets';

/** Client cap — matches server's `CLIENT_KEYWORD_LIMIT`. */
export const MAX_KEYWORDS = 50;
/** Max phrase length — matches server's zod phrase schema. */
export const MAX_PHRASE_LENGTH = 80;

const phraseSchema = z
  .string()
  .trim()
  .min(1, 'keywordResearch:errors.phraseRequired')
  .max(MAX_PHRASE_LENGTH, 'keywordResearch:errors.phraseTooLong');

export const metricsFormSchema = z.object({
  keywords: z
    .array(phraseSchema)
    .min(1, 'keywordResearch:errors.keywordsRequired')
    .max(MAX_KEYWORDS, 'keywordResearch:errors.tooManyKeywords'),
  locationCode: z.number().int().positive(),
  languageCode: z.string().min(2).max(10),
});

export type MetricsForm = z.infer<typeof metricsFormSchema>;

export const LOCATION_OPTIONS = [
  { value: 2840, labelKey: 'keywordResearch:locations.us' },
  { value: 2826, labelKey: 'keywordResearch:locations.uk' },
  { value: 2276, labelKey: 'keywordResearch:locations.de' },
  { value: 2250, labelKey: 'keywordResearch:locations.fr' },
];

export const LANGUAGE_OPTIONS = [
  { value: 'en', labelKey: 'keywordResearch:languages.en' },
  { value: 'de', labelKey: 'keywordResearch:languages.de' },
  { value: 'fr', labelKey: 'keywordResearch:languages.fr' },
  { value: 'es', labelKey: 'keywordResearch:languages.es' },
];

/** Difficulty band label helper — pure so it's cheap to test. */
export function difficultyBand(difficulty: number | null): 'easy' | 'medium' | 'hard' | 'unknown' {
  if (difficulty === null) return 'unknown';
  if (difficulty < 30) return 'easy';
  if (difficulty < 70) return 'medium';
  return 'hard';
}

export const DEFAULT_LOCATION_CODE = 2840;
export const DEFAULT_LANGUAGE_CODE = 'en';

export interface PrefillParams {
  chips: string[];
  locationCode: number;
  languageCode: string;
}

/**
 * Parse exact `?seed=` handoffs or legacy `?q=a,b,c` history links. `seed`
 * wins because commas are valid inside a phrase. Invalid phrases are
 * dropped, the legacy list is deduped + capped at MAX_KEYWORDS, and unknown
 * location/language codes fall back to the defaults. Prefill only seeds the
 * form — it never auto-submits.
 */
export function parsePrefillParams(params: URLSearchParams): PrefillParams {
  const seen = new Set<string>();
  const chips: string[] = [];
  const exactSeed = params.get('seed');
  const rawPhrases = exactSeed === null ? (params.get('q') ?? '').split(',') : [exactSeed];
  for (const raw of rawPhrases) {
    const phrase = raw.trim();
    if (phrase.length === 0 || phrase.length > MAX_PHRASE_LENGTH) continue;
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    chips.push(phrase);
    if (chips.length >= MAX_KEYWORDS) break;
  }
  const location = Number(params.get('location'));
  const locationCode = Number.isInteger(location) && location > 0
    ? location
    : DEFAULT_LOCATION_CODE;
  const lang = params.get('lang') ?? '';
  const languageCode = /^[a-z]{2}$/.test(lang)
    ? lang
    : DEFAULT_LANGUAGE_CODE;
  return { chips, locationCode, languageCode };
}

/** Deep link that prefills the research form from a history entry. */
export function buildSearchAgainUrl(item: ResearchHistoryItem): string {
  const params = new URLSearchParams();
  if (item.kind === 'long_tail') params.set('seed', item.phrases[0] ?? '');
  else params.set('q', item.phrases.join(','));
  params.set('location', String(item.locationCode));
  params.set('lang', item.languageCode);
  return `/keyword-research?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Client zod mirrors of the gap/overview/trends/cluster
// request bounds. Bounds are kept in exact sync with
// `server/src/modules/keyword-research/keyword-research.schema.ts`.
// ---------------------------------------------------------------------------

export const GAP_COMPETITORS_MAX = 3;
export const OVERVIEW_PHRASE_MAX = 20;
export const TRENDS_PHRASE_MAX = 10;
export const CLUSTER_PHRASE_MIN = 10;
export const CLUSTER_PHRASE_MAX = 200;

const phraseSchemaShared = z
  .string()
  .trim()
  .min(1, 'keywordResearch:errors.phraseRequired')
  .max(MAX_PHRASE_LENGTH, 'keywordResearch:errors.phraseTooLong');

/**
 * Domain mirror of the server schema — lowercased FQDN, trailing dot
 * stripped, bare domains only (no scheme).
 */
export const domainFormSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase().replace(/\.$/, ''))
  .refine((v) => v.length >= 3 && v.length <= 253, {
    message: 'keywordResearch:errors.domainInvalid',
  })
  .refine(
    (v) =>
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v),
    { message: 'keywordResearch:errors.domainInvalid' },
  );

/**
 * Mirror of the server `refineGapCompetitors` — dedupe after normalization
 * and reject the own domain in the competitor list.
 */
export const gapFormSchema = z
  .object({
    ownDomain: domainFormSchema,
    competitors: z
      .array(domainFormSchema)
      .min(1, 'keywordResearch:errors.competitorsRequired')
      .max(GAP_COMPETITORS_MAX, 'keywordResearch:errors.tooManyCompetitors'),
    locationCode: z.number().int().positive(),
    languageCode: z.string().min(2).max(10),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const c of value.competitors) {
      if (seen.has(c)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['competitors'],
          message: 'keywordResearch:errors.competitorsDuplicate',
        });
        return;
      }
      seen.add(c);
    }
    if (seen.has(value.ownDomain)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['competitors'],
        message: 'keywordResearch:errors.gapDomainConflict',
      });
    }
  });

export type GapForm = z.infer<typeof gapFormSchema>;

export const overviewFormSchema = z.object({
  keywords: z
    .array(phraseSchemaShared)
    .min(1, 'keywordResearch:errors.keywordsRequired')
    .max(OVERVIEW_PHRASE_MAX, 'keywordResearch:errors.tooManyKeywords'),
  locationCode: z.number().int().positive(),
  languageCode: z.string().min(2).max(10),
});

export type OverviewForm = z.infer<typeof overviewFormSchema>;

export const trendsFormSchema = z.object({
  keywords: z
    .array(phraseSchemaShared)
    .min(1, 'keywordResearch:errors.keywordsRequired')
    .max(TRENDS_PHRASE_MAX, 'keywordResearch:errors.tooManyKeywords'),
  locationCode: z.number().int().positive(),
  languageCode: z.string().min(2).max(10),
});

export type TrendsForm = z.infer<typeof trendsFormSchema>;

// ---------------------------------------------------------------------------
// Live Keyword Trends form.
// Bounds mirror the server zod schema at
// `server/src/modules/keyword-research/keyword-research.schema.ts`
// (`TRENDS_EXPLORE_PHRASE_MAX=5`, phrase min 1 / max 200 chars, the shipped
//  `us|gb|de|fr` market set, and two-letter provider language codes).
// ---------------------------------------------------------------------------

export const LIVE_TRENDS_PHRASE_MAX = 5;
export const LIVE_TRENDS_PHRASE_MAX_LENGTH = 200;
export const LIVE_TRENDS_MAX_RELATED_QUERIES = 50;
export const LIVE_TRENDS_MAX_QUERY_CHARS = 100;

/**
 * DataForSEO Trends geo codes we ship — deliberately narrow so a user is
 * never shown a market the fake / adapter doesn't support. Future work may extend the picker.
 */
export const LIVE_TRENDS_GEO_OPTIONS = [
  { value: 'us', labelKey: 'keywordResearch:locations.us' },
  { value: 'gb', labelKey: 'keywordResearch:locations.uk' },
  { value: 'de', labelKey: 'keywordResearch:locations.de' },
  { value: 'fr', labelKey: 'keywordResearch:locations.fr' },
] as const;
export const DEFAULT_LIVE_TRENDS_GEO = 'us';

export const LIVE_TRENDS_LANGUAGE_OPTIONS = LANGUAGE_OPTIONS;
export const DEFAULT_LIVE_TRENDS_LANGUAGE = 'en';

/** Map the legacy numeric `locationCode` (2840/…) to a Trends geo string. */
export function locationCodeToGeo(locationCode: number): string {
  return countryCodeForLocation(locationCode)?.toLowerCase() ?? DEFAULT_LIVE_TRENDS_GEO;
}

/** Inverse of `locationCodeToGeo` so `MarketSelects` can be reused verbatim. */
export function geoToLocationCode(geo: string): number {
  return locationCodeForCountry(geo) ?? DEFAULT_LOCATION_CODE;
}

/** Normalize user-typed phrases — lowercase + dedupe + drop empty. */
export function normalizeLiveTrendsKeywords(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const phrase = raw.trim().toLowerCase();
    if (phrase.length === 0 || seen.has(phrase)) continue;
    seen.add(phrase);
    out.push(phrase);
  }
  return out;
}

const liveTrendsPhraseSchema = z
  .string()
  .trim()
  .min(1, 'keywordResearch:trends.errors.phraseRequired')
  .max(
    LIVE_TRENDS_PHRASE_MAX_LENGTH,
    'keywordResearch:trends.errors.phraseTooLong',
  );

const liveTrendsGeoSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(
    z.enum(['us', 'gb', 'de', 'fr'], {
      errorMap: () => ({
        message: 'keywordResearch:trends.errors.geoInvalid',
      }),
    }),
  );

const liveTrendsLanguageSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(
    z
      .string()
      .regex(/^[a-z]{2}$/, 'keywordResearch:trends.errors.languageInvalid'),
  );

export const liveTrendsFormSchema = z.object({
  keywords: z
    .array(liveTrendsPhraseSchema)
    .min(1, 'keywordResearch:trends.errors.keywordsRequired')
    .max(
      LIVE_TRENDS_PHRASE_MAX,
      'keywordResearch:trends.errors.tooManyKeywords',
    ),
  geo: liveTrendsGeoSchema.optional(),
  language: liveTrendsLanguageSchema.optional(),
});

export type LiveTrendsForm = z.infer<typeof liveTrendsFormSchema>;

export const clusterRunFormSchema = z.object({
  phrases: z
    .array(phraseSchemaShared)
    .min(CLUSTER_PHRASE_MIN, 'keywordResearch:errors.keywordsRequired')
    .max(CLUSTER_PHRASE_MAX, 'keywordResearch:errors.tooManyKeywords'),
  locationCode: z.number().int().positive(),
  languageCode: z.string().min(2).max(10),
});

export type ClusterRunForm = z.infer<typeof clusterRunFormSchema>;

/**
 * PRESENTATION-ONLY classification of a shipped gap row — the server ships
 * the nulls, the client only names the combination. Never re-scores.
 *
 *   missing  → we do not rank, the competitor does
 *   behind   → both rank, our position is worse (numerically higher)
 *   ahead    → both rank, our position is better
 *   even     → both rank at the same position
 *   unranked → the competitor does not rank for the row (own-only or neither)
 */
export type GapRowKind = 'missing' | 'behind' | 'ahead' | 'even' | 'unranked';

export function classifyGapRow(row: GapRow): GapRowKind {
  if (row.competitorPosition === null) return 'unranked';
  if (row.ownPosition === null) return 'missing';
  if (row.ownPosition > row.competitorPosition) return 'behind';
  if (row.ownPosition < row.competitorPosition) return 'ahead';
  return 'even';
}
