/**
 * Rule `thin-content` — indexable pages with little unique text. Advisory
 * (watch): thin content is often intentional (landing pages, category hubs).
 *
 * Each page is measured in the unit its language allows:
 * words where words are separated by spaces, characters for Chinese,
 * Japanese, Korean and Thai, whose words a space count cannot see. Every
 * flagged URL carries its measured length and unit so the reader can judge
 * the page instead of trusting a bare list.
 *
 * If NO page in the audit reports a usable measure, the vendor did not sample
 * this signal — the rule lands in watch with `insufficientData` meta so the
 * report never invents a fix-now the vendor cannot back up.
 */
import type { AuditPage, AuditResult } from '../../../shared/providers/index.js';
import {
  languageClassOf,
  type LanguageClass,
  type TextMeasure,
} from '../../../shared/utils/text-length.js';
import { bucketFor } from './bucket.js';
import { pageLanguage } from './page-language.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'thin-content' as const;

/**
 * Spaced languages: below about 200 words a page rarely holds more than a
 * heading, a sentence and navigation. A screening line, not a target — the
 * advice copy deliberately names no minimum.
 */
export const THIN_CONTENT_WORDS = 200;
/**
 * Chinese and Japanese: translated text runs about 1.5 characters per
 * English word, so 300 characters sits at the same depth as 200 words.
 */
export const THIN_CONTENT_IDEOGRAPHIC_CHARS = 300;
/**
 * Korean: about 2.25 Hangul syllables per English word in translation,
 * so 450 syllables matches the 200-word line.
 */
export const THIN_CONTENT_HANGUL_CHARS = 450;
/** Thai: words average about four letters, so 800 letters ≈ 200 words. */
export const THIN_CONTENT_THAI_CHARS = 800;
/**
 * The vendor reports plain-text size in UTF-8 bytes. Han, kana, Hangul and
 * Thai letters take three bytes each, so bytes / 3 approximates characters
 * (Latin navigation words in the same text make it a slight overestimate,
 * which errs toward NOT flagging).
 */
export const UTF8_BYTES_PER_NO_SPACE_CHAR = 3;

const CHARACTER_LIMITS: Record<Exclude<LanguageClass, 'spaced'>, number> = {
  ideographic: THIN_CONTENT_IDEOGRAPHIC_CHARS,
  hangul: THIN_CONTENT_HANGUL_CHARS,
  thai: THIN_CONTENT_THAI_CHARS,
};

/** One flagged page with the length that put it on the list. */
export interface ThinContentMeasurement extends TextMeasure {
  url: string;
}

interface Measured {
  measure: TextMeasure;
  limit: number;
}

/** The fair measure of a page, or `null` when the crawl did not report it. */
export function measurePage(page: AuditPage): Measured | null {
  const cls = languageClassOf(pageLanguage(page));
  if (cls === 'spaced') {
    return typeof page.wordCount === 'number'
      ? { measure: { value: page.wordCount, unit: 'words' }, limit: THIN_CONTENT_WORDS }
      : null;
  }
  return typeof page.textSize === 'number'
    ? {
        measure: {
          value: Math.round(page.textSize / UTF8_BYTES_PER_NO_SPACE_CHAR),
          unit: 'characters',
        },
        limit: CHARACTER_LIMITS[cls],
      }
    : null;
}

export const thinContentRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    const indexable = result.pages.filter((p) => p.isIndexable);
    const sampled = indexable.flatMap((page) => {
      const measured = measurePage(page);
      return measured ? [{ url: page.url, ...measured }] : [];
    });
    if (indexable.length > 0 && sampled.length === 0) {
      return {
        ruleId: RULE_ID,
        bucket: 'watch',
        severity: 'warning',
        affectedUrls: [],
        meta: { insufficientData: true, reason: 'no-crawl-signal' },
      };
    }
    const measurements: ThinContentMeasurement[] = sampled
      .filter((page) => page.measure.value < page.limit)
      .map((page) => ({ url: page.url, ...page.measure }));
    const passed = measurements.length === 0;
    return {
      ruleId: RULE_ID,
      bucket: bucketFor('warning', passed),
      severity: 'warning',
      affectedUrls: measurements.map((m) => m.url),
      ...(passed ? {} : { meta: { measurements } }),
    };
  },
};
