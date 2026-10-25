/**
 * Last gate before an AI-visibility suggestion is stored or shown (QA round
 * 2, P0-1). Whatever produced the row — the AI model or a deterministic
 * template — the phrase people will track must read as a real question:
 *
 *  - never a raw crawled page title ("best welcome - example rewards"): a prompt
 *    equal to a title/H1, containing a whole brand-separated title, or
 *    carrying a title separator (" - ", "|", "–", "—", "•", "·") is dropped;
 *  - whitespace and repeated punctuation are collapsed;
 *  - an AI row must cite one of the site's own seeds (or its domain) as its
 *    evidence, so a phrase never rides in on unsupported text such as a typo
 *    copied from somewhere else;
 *  - near-duplicates collapse, first one wins.
 */
import type { SupportedLocale } from '../../shared/i18n/locales.js';
import { dropNearDuplicates } from './prompt-similarity.js';

const TITLE_SEPARATOR_IN_TEXT = /\s[-–—|•·]\s|\|/u;
/** How a raw title is split into brand / page parts. */
const RAW_TITLE_SEPARATORS = /\s+-\s+|[|–—•·]/u;
const MIN_PROMPT_LENGTH = 4;

/** Collapse whitespace and repeated punctuation; trim stray edge separators. */
export function normalizePromptText(raw: string): string {
  return raw
    .replace(/\s+/gu, ' ')
    .replace(/([?!.,;:؟،？！，。])\1+/gu, '$1')
    .replace(/^[\s\-–—|•·]+|[\s\-–—|•·]+$/gu, '')
    .trim();
}

/** Case-, quote- and punctuation-insensitive comparison key. */
export function comparisonKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export interface OutputGuardContext {
  /** Raw crawled page titles and H1s of the site's latest audit. */
  pageTitles: readonly string[];
  /** Every seed the run was built from (keywords, titles, queries, competitors). */
  seeds: readonly string[];
  domain: string;
  locale: SupportedLocale;
}

interface GuardedRow {
  prompt: string;
  source?: 'ai' | 'template';
  evidenceRef?: string | null;
}

export function guardSuggestionRows<T extends GuardedRow>(rows: readonly T[], context: OutputGuardContext): T[] {
  const titleKeys = new Set(context.pageTitles.map(comparisonKey).filter(Boolean));
  const brandedTitleKeys = context.pageTitles
    .filter((title) => RAW_TITLE_SEPARATORS.test(title))
    .map(comparisonKey)
    .filter(Boolean);
  const evidence = new Set([...context.seeds, context.domain].map(comparisonKey));
  const kept: T[] = [];
  for (const row of rows) {
    const prompt = normalizePromptText(row.prompt);
    if (prompt.length < MIN_PROMPT_LENGTH) continue;
    if (TITLE_SEPARATOR_IN_TEXT.test(prompt)) continue;
    const key = comparisonKey(prompt);
    if (titleKeys.has(key) || brandedTitleKeys.some((title) => key.includes(title))) continue;
    if (row.source === 'ai' && row.evidenceRef && !evidence.has(comparisonKey(row.evidenceRef))) continue;
    kept.push({ ...row, prompt });
  }
  return dropNearDuplicates(kept, context.locale);
}
