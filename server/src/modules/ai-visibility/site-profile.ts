/**
 * Deterministic site profile for AI-Visibility suggestions.
 *
 * The suggestion fallback used to cast raw top queries ("episode pricing")
 * through four fixed question shapes, so it asked an assistant "What is the
 * best episode pricing?". The profile replaces that with what the site
 * actually offers, read from evidence the account already owns and paid for:
 *
 *   crawled title / H1 / meta description (latest audit)  weight 3 / 3 / 2
 *   tracked keywords                                       weight 3
 *   Google Search Console queries                          weight 2
 *
 * Every field is cut into clauses and contiguous word n-grams (1..4 words).
 * An n-gram becomes a category phrase only if it survives these gates:
 *
 *   - it neither starts nor ends with a stopword and does not end in a generic
 *     product noun ("tool", "generator"), so its last word is always content;
 *   - it contains no navigation or price word ("pricing", "login") and no
 *     fragment of the site's own brand;
 *   - it reads as the output language (`seedFitsLocale`) and as a noun phrase
 *     (`classifySeed === 'topic'`: not a question, not a verb-led task).
 *
 * A phrase must be backed by at least two evidence fields (a tracked keyword
 * or search query that IS the phrase counts as two), so one clever title
 * fragment cannot define the category. Phrases are ranked by summed support
 * times word count, then thinned so no two selected phrases overlap (subset or
 * Jaccard >= the shared near-duplicate threshold). Single words are a last
 * resort: they must appear in crawled copy and are chosen only when no
 * multi-word phrase qualified. Nothing is
 * invented: a phrase exists only if its words appeared in the evidence, and a
 * site whose evidence yields no phrase is reported as `none`.
 */

import type { SupportedLocale } from '../../shared/i18n/locales.js';
import {
  GENERIC_NOUNS,
  LINKERS,
  NAVIGATION_WORDS,
  STOPWORDS,
  ZH_NAVIGATION,
  ZH_SPLIT,
} from './locale-lexicon.js';
import {
  brandLabelOf,
  classifySeed,
  pathLanguageOf,
  seedFitsLocale,
} from './prompt-seed-quality.js';
import { NEAR_DUPLICATE_JACCARD, jaccard, similarityTokens } from './prompt-similarity.js';

/** How much the evidence supports category-led suggestions. */
export type EvidenceLevel = 'rich' | 'limited' | 'none';
export type CategorySource = 'gsc' | 'keyword' | 'title';

/** One crawled page, as the latest audit stored it (final URL preferred). */
export interface EvidencePage {
  url: string;
  title: string | null | undefined;
  metaDescription: string | null | undefined;
  h1: string[];
}

export interface CategoryPhrase {
  phrase: string;
  support: number;
  /** The kind of evidence that contributed most; ties prefer keyword, gsc, title. */
  evidenceSource: CategorySource;
}

export interface SiteProfile {
  categories: CategoryPhrase[];
  evidenceLevel: EvidenceLevel;
  /** Crawled pages that contributed text (pages under another language path are skipped). */
  pageCount: number;
}

export const MAX_CATEGORIES = 4;
/** Distinct categories (with page copy behind them) needed to call evidence rich. */
export const MIN_RICH_CATEGORIES = 2;
const MAX_NGRAM = 4;
/** Evidence fields a phrase needs; an exact keyword/query match counts as two. */
const MIN_PHRASE_FIELDS = 2;
const MIN_SINGLE_WORD_LENGTH = 4;
const MAX_PHRASE_LENGTH = 60;
const ZH_MIN_LENGTH = 2;
const ZH_MAX_LENGTH = 12;
const LENGTH_BONUS = 1;
/** A longer phrase this well supported (vs the shorter one it contains) replaces it. */
const MAXIMAL_SUPPORT_RATIO = 0.5;

const WEIGHT = { title: 3, h1: 3, keyword: 3, meta: 2, gsc: 2 } as const;
const SOURCE_ORDER: readonly CategorySource[] = ['keyword', 'gsc', 'title'];

const CLAUSE_BREAK = /[\n\r.,;:!?¡¿()[\]{}"“”«»…|/\\•·–—،؛؟。，！？、；：]|\s-\s/u;
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;
const NUMERIC = /^\p{N}+$/u;

interface EvidenceField {
  text: string;
  weight: number;
  source: CategorySource;
}

interface PhraseStats {
  surface: string;
  support: number;
  fields: number;
  size: number;
  bySource: Record<CategorySource, number>;
}

function isValidSpacedPhrase(
  tokens: string[],
  locale: Exclude<SupportedLocale, 'zh'>,
  brand: string | null,
): boolean {
  const stop = STOPWORDS[locale];
  const linkers = LINKERS[locale];
  const generic = GENERIC_NOUNS[locale];
  const navigation = NAVIGATION_WORDS[locale];
  const noise = (token: string): boolean => stop.has(token) || NUMERIC.test(token);
  const last = tokens.length - 1;
  if (noise(tokens[0]!) || noise(tokens[last]!) || generic.has(tokens[last]!)) return false;
  for (let index = 1; index < last; index += 1) {
    const token = tokens[index]!;
    if (noise(token) && !linkers.has(token)) return false;
  }
  if (tokens.some((token) => navigation.has(token))) return false;
  if (tokens.length === 1 && tokens[0]!.length < MIN_SINGLE_WORD_LENGTH) return false;
  const phrase = tokens.join(' ');
  if (phrase.length > MAX_PHRASE_LENGTH) return false;
  if (brand && phrase.replace(/[\s-]/g, '').includes(brand)) return false;
  return seedFitsLocale(phrase, locale) && classifySeed(phrase) === 'topic';
}

function isValidZhPhrase(phrase: string, brand: string | null): boolean {
  if (phrase.length < ZH_MIN_LENGTH || phrase.length > ZH_MAX_LENGTH) return false;
  if (ZH_NAVIGATION.some((label) => phrase.includes(label))) return false;
  if (brand && phrase.replace(/[\s-]/g, '').includes(brand)) return false;
  return seedFitsLocale(phrase, 'zh') && classifySeed(phrase) === 'topic';
}

/**
 * Whether a raw query/keyword describes a page or the brand ("episode
 * pricing", "episodebrief login") rather than something to ask an assistant
 * about. Such seeds are withheld from the AI generator, which would otherwise
 * ground "the best episode pricing" in them.
 */
export function isNavigationalSeed(
  seed: string,
  locale: SupportedLocale,
  domain: string,
): boolean {
  const text = seed.toLowerCase();
  const brand = brandLabelOf(domain);
  if (brand && text.replace(/[\s-]/g, '').includes(brand)) return true;
  if (locale === 'zh') return ZH_NAVIGATION.some((label) => text.includes(label));
  const navigation = NAVIGATION_WORDS[locale];
  return (text.match(WORD) ?? []).some((token) => navigation.has(token));
}

function coreBounds(
  tokens: readonly string[],
  locale: Exclude<SupportedLocale, 'zh'>,
): { from: number; to: number } {
  const stop = STOPWORDS[locale];
  const generic = GENERIC_NOUNS[locale];
  let from = 0;
  let to = tokens.length;
  while (from < to && stop.has(tokens[from]!)) from += 1;
  while (to > from && (stop.has(tokens[to - 1]!) || generic.has(tokens[to - 1]!))) to -= 1;
  return { from, to };
}

interface PhraseHit {
  /** Display form: lower-case, except German where nouns keep their capitals. */
  surface: string;
  size: number;
  /** The phrase is the whole clause apart from filler words and product nouns. */
  exact: boolean;
}

/** Every distinct valid category phrase one field offers. */
function phrasesOf(
  text: string,
  locale: SupportedLocale,
  brand: string | null,
): Map<string, PhraseHit> {
  const found = new Map<string, PhraseHit>();
  for (const clause of text.split(CLAUSE_BREAK)) {
    if (locale === 'zh') {
      const parts = clause.split(ZH_SPLIT);
      for (const part of parts) {
        const phrase = part.trim().toLowerCase();
        if (isValidZhPhrase(phrase, brand)) {
          found.set(phrase, {
            surface: phrase,
            size: Math.max(2, Math.ceil(phrase.length / 3)),
            exact: parts.length === 1,
          });
        }
      }
      continue;
    }
    const words = clause.match(WORD) ?? [];
    const lower = words.map((word) => word.toLowerCase());
    // The clause minus leading filler and trailing filler or product nouns:
    // "podcast show notes generator" is exactly the category "podcast show notes".
    const core = coreBounds(lower, locale);
    for (let start = 0; start < words.length; start += 1) {
      for (let size = 1; size <= MAX_NGRAM && start + size <= words.length; size += 1) {
        const tokens = lower.slice(start, start + size);
        if (isValidSpacedPhrase(tokens, locale, brand)) {
          found.set(tokens.join(' '), {
            surface: (locale === 'de' ? words : lower).slice(start, start + size).join(' '),
            size,
            exact: start === core.from && start + size === core.to,
          });
        }
      }
    }
  }
  return found;
}

function dominantSource(bySource: Record<CategorySource, number>): CategorySource {
  return SOURCE_ORDER.reduce((best, source) => (bySource[source] > bySource[best] ? source : best));
}

function containsPhrase(outer: string, inner: string, locale: SupportedLocale): boolean {
  return locale === 'zh' ? outer.includes(inner) : ` ${outer} `.includes(` ${inner} `);
}

function isSubset(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const token of a) if (!b.has(token)) return false;
  return true;
}

export function buildSiteProfile(input: {
  domain: string;
  outputLocale: SupportedLocale;
  pages: readonly EvidencePage[];
  keywords: readonly string[];
  gscQueries: readonly string[];
}): SiteProfile {
  const locale = input.outputLocale;
  const brand = brandLabelOf(input.domain);
  const fields: EvidenceField[] = [];
  let pageCount = 0;
  for (const page of input.pages) {
    const pageLanguage = pathLanguageOf(page.url);
    if (pageLanguage && pageLanguage !== locale) continue;
    const before = fields.length;
    if (page.title) fields.push({ text: page.title, weight: WEIGHT.title, source: 'title' });
    for (const heading of page.h1) {
      fields.push({ text: heading, weight: WEIGHT.h1, source: 'title' });
    }
    if (page.metaDescription) {
      fields.push({ text: page.metaDescription, weight: WEIGHT.meta, source: 'title' });
    }
    if (fields.length > before) pageCount += 1;
  }
  for (const text of input.keywords) fields.push({ text, weight: WEIGHT.keyword, source: 'keyword' });
  for (const text of input.gscQueries) fields.push({ text, weight: WEIGHT.gsc, source: 'gsc' });

  const stats = new Map<string, PhraseStats>();
  for (const field of fields) {
    for (const [phrase, hit] of phrasesOf(field.text, locale, brand)) {
      const entry = stats.get(phrase) ?? {
        surface: hit.surface,
        support: 0,
        fields: 0,
        size: hit.size,
        bySource: { keyword: 0, gsc: 0, title: 0 },
      };
      entry.support += field.weight;
      entry.fields += hit.exact && field.source !== 'title' ? MIN_PHRASE_FIELDS : 1;
      entry.bySource[field.source] += field.weight;
      stats.set(phrase, entry);
    }
  }

  const qualified = [...stats.entries()]
    // A lone word must come from crawled copy: queries alone ("episode" out of
    // "episode pricing") are too vague to name a category.
    .filter(
      ([, entry]) =>
        entry.fields >= MIN_PHRASE_FIELDS && (entry.size > 1 || entry.bySource.title > 0),
    );
  const ranked = qualified
    // A fragment of a better-supported longer phrase ("podcast show" inside
    // "podcast show notes") is not a category of its own.
    .filter(
      ([phrase, entry]) =>
        !qualified.some(
          ([other, otherEntry]) =>
            otherEntry.size > entry.size &&
            otherEntry.support >= entry.support * MAXIMAL_SUPPORT_RATIO &&
            containsPhrase(other, phrase, locale),
        ),
    )
    .map(([phrase, entry]) => ({
      phrase,
      entry,
      score: entry.support * (1 + LENGTH_BONUS * (entry.size - 1)),
    }))
    // Multi-word phrases outrank any single word: "podcast show notes" says
    // what the site offers, "podcast" alone only what it is about. Single
    // words fill whatever slots multi-word phrases leave.
    .sort(
      (a, b) =>
        Number(a.entry.size === 1) - Number(b.entry.size === 1) ||
        b.score - a.score ||
        (a.phrase < b.phrase ? -1 : 1),
    );

  const categories: CategoryPhrase[] = [];
  const pickedTokens: Array<Set<string>> = [];
  let hasMultiWord = false;
  for (const candidate of ranked) {
    if (categories.length >= MAX_CATEGORIES) break;
    // Single words are a last resort (ranked after every multi-word phrase).
    if (candidate.entry.size === 1 && hasMultiWord) break;
    const tokens = similarityTokens(candidate.phrase, locale);
    const overlaps = pickedTokens.some(
      (picked) =>
        isSubset(tokens, picked) ||
        isSubset(picked, tokens) ||
        jaccard(tokens, picked) >= NEAR_DUPLICATE_JACCARD,
    );
    if (overlaps) continue;
    pickedTokens.push(tokens);
    hasMultiWord = hasMultiWord || candidate.entry.size > 1;
    categories.push({
      phrase: candidate.entry.surface,
      support: candidate.entry.support,
      evidenceSource: dominantSource(candidate.entry.bySource),
    });
  }

  const evidenceLevel: EvidenceLevel =
    categories.length === 0
      ? 'none'
      : categories.length >= MIN_RICH_CATEGORIES && pageCount > 0
        ? 'rich'
        : 'limited';
  return { categories, evidenceLevel, pageCount };
}
