/**
 * Copy-similarity (n-gram) guard unit tests (spec §6 / SEC-OUT).
 *
 * This is the security-sensitive path: near-verbatim competitor prose in AI
 * output MUST be caught. Covers tokenization bounds, shingle edge cases,
 * Jaccard symmetry, and the reject/accept decision at the documented threshold.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPETITOR_CONTENT_NGRAM_SIMILARITY_THRESHOLD,
  COMPETITOR_CONTENT_NGRAM_SIZE,
} from '../../shared/safety/feature-limits.js';
import {
  evaluateCopySimilarity,
  jaccardSimilarity,
  shingleSet,
  tokenizeWords,
} from './competitor-content.ngram.js';

describe('tokenizeWords', () => {
  it('lowercases, splits on the fixed class, and drops empties', () => {
    expect(tokenizeWords('Hello, WORLD!  foo-bar')).toEqual(['hello', 'world', 'foo', 'bar']);
  });

  it('caps input length before tokenizing (allocation bound)', () => {
    const huge = 'word '.repeat(100_000);
    // Bounded — never tokenizes the full 500k chars.
    expect(tokenizeWords(huge).length).toBeLessThan(5_000);
  });

  it('returns an empty array for a whitespace-only string', () => {
    expect(tokenizeWords('   ,,, ')).toEqual([]);
  });
});

describe('shingleSet', () => {
  it('builds overlapping n-word shingles', () => {
    const set = shingleSet(['a', 'b', 'c', 'd'], 2);
    expect([...set].sort()).toEqual(['a b', 'b c', 'c d']);
  });

  it('is empty when the word count is below the shingle size', () => {
    expect(shingleSet(['a', 'b'], 5).size).toBe(0);
  });

  it('is empty for a non-positive shingle size', () => {
    expect(shingleSet(['a', 'b', 'c'], 0).size).toBe(0);
  });
});

describe('jaccardSimilarity', () => {
  it('is 0 when either set is empty (both orderings)', () => {
    expect(jaccardSimilarity(new Set(), new Set(['x']))).toBe(0);
    expect(jaccardSimilarity(new Set(['x']), new Set())).toBe(0);
  });

  it('is 1 for identical sets', () => {
    const s = new Set(['a b', 'b c']);
    expect(jaccardSimilarity(s, new Set(s))).toBe(1);
  });

  it('is symmetric regardless of which set is larger', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c']);
    expect(jaccardSimilarity(a, b)).toBeCloseTo(2 / 3);
    expect(jaccardSimilarity(b, a)).toBeCloseTo(2 / 3);
  });
});

describe('evaluateCopySimilarity', () => {
  const snippet =
    'The quick brown fox jumps over the lazy dog and then runs across the wide green field at dawn';

  it('REJECTS near-verbatim reproduction of a competitor snippet', () => {
    // The model echoes the snippet almost word-for-word.
    const result = evaluateCopySimilarity(snippet, [snippet]);
    expect(result.rejected).toBe(true);
    expect(result.maxSimilarity).toBeGreaterThanOrEqual(
      COMPETITOR_CONTENT_NGRAM_SIMILARITY_THRESHOLD,
    );
    expect(result.ngramSize).toBe(COMPETITOR_CONTENT_NGRAM_SIZE);
  });

  it('REJECTS a paraphrase that copies a long contiguous span', () => {
    const copied = `In summary, ${snippet}. This matters for your page.`;
    expect(evaluateCopySimilarity(copied, [snippet]).rejected).toBe(true);
  });

  it('ACCEPTS an original neutral comparison over the same topic', () => {
    const original =
      'Your page is shorter than the competitor and lacks structured data; add more sections.';
    const result = evaluateCopySimilarity(original, [snippet]);
    expect(result.rejected).toBe(false);
    expect(result.maxSimilarity).toBeLessThan(
      COMPETITOR_CONTENT_NGRAM_SIMILARITY_THRESHOLD,
    );
  });

  it('ACCEPTS output shorter than the shingle size (cannot copy a sentence)', () => {
    expect(evaluateCopySimilarity('too short', [snippet]).rejected).toBe(false);
  });

  it('is 0-similarity with no snippets supplied', () => {
    expect(evaluateCopySimilarity(snippet, []).maxSimilarity).toBe(0);
  });

  it('honors custom threshold + ngram-size overrides', () => {
    const original = 'completely unrelated original sentence with different words entirely here';
    // A threshold of 0 rejects everything that forms at least one shingle.
    expect(
      evaluateCopySimilarity(original, [original], { threshold: 0, ngramSize: 3 }).rejected,
    ).toBe(true);
  });

  it('takes the MAX similarity across multiple snippets', () => {
    const unrelated = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
    const result = evaluateCopySimilarity(snippet, [unrelated, snippet]);
    expect(result.rejected).toBe(true);
  });
});
