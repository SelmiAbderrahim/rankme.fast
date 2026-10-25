/**
 * Near-duplicate suppression for AI-Visibility suggestions.
 *
 * "What is the best episode pricing?" and "Which episode pricing should I
 * use?" are the same question in two coats. Two prompts are near-duplicates
 * when the Jaccard overlap of their content-token sets reaches
 * `NEAR_DUPLICATE_JACCARD`. Content tokens are the lower-cased letter/number
 * runs minus the locale's stopwords; Han runs are cut into character bigrams
 * so unspaced Chinese still has a meaningful overlap.
 *
 * 0.8 is deliberate: one added or swapped content word in a five-word prompt
 * (4 shared of 5 total) still collapses, while the same template asked about
 * two different topics ("best tools for X" vs "best tools for Y": the shared
 * skeleton is a fraction of the union) stays distinct.
 */

import type { SupportedLocale } from '../../shared/i18n/locales.js';
import { STOPWORDS } from './locale-lexicon.js';

export const NEAR_DUPLICATE_JACCARD = 0.8;

const TOKEN = /\p{Script=Han}+|[\p{L}\p{M}\p{N}]+/gu;
const HAN_RUN = /^\p{Script=Han}+$/u;

/** Locales whose plurals are a trailing "s" ("episode" / "episodes"). */
const PLURAL_S_LOCALES: ReadonlySet<SupportedLocale> = new Set(['en', 'fr', 'es']);

function singular(token: string, locale: SupportedLocale): string {
  return PLURAL_S_LOCALES.has(locale) && token.length > 3 && token.endsWith('s') && !token.endsWith('ss')
    ? token.slice(0, -1)
    : token;
}

/** Content-token set of a text for similarity comparison. */
export function similarityTokens(text: string, locale: SupportedLocale): Set<string> {
  const stop: ReadonlySet<string> = locale === 'zh' ? new Set() : STOPWORDS[locale];
  const raw: string[] = [];
  for (const run of text.toLowerCase().match(TOKEN) ?? []) {
    if (!HAN_RUN.test(run)) {
      raw.push(run);
    } else if (run.length === 1) {
      raw.push(run);
    } else {
      for (let index = 0; index < run.length - 1; index += 1) raw.push(run.slice(index, index + 2));
    }
  }
  const content = raw.filter((token) => !stop.has(token));
  return new Set((content.length > 0 ? content : raw).map((token) => singular(token, locale)));
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Keep the first of every near-duplicate group, in input order. Stable on
 * purpose: callers order candidates by priority (AI rows, then competitor
 * match-ups, then categories) and the earlier one wins.
 */
export function dropNearDuplicates<T extends { prompt: string }>(
  rows: readonly T[],
  locale: SupportedLocale,
): T[] {
  const kept: Array<{ row: T; tokens: Set<string> }> = [];
  for (const row of rows) {
    const tokens = similarityTokens(row.prompt, locale);
    if (kept.some((entry) => jaccard(entry.tokens, tokens) >= NEAR_DUPLICATE_JACCARD)) continue;
    kept.push({ row, tokens });
  }
  return kept.map((entry) => entry.row);
}
