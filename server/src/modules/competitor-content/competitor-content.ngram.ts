// A single FIXED split class — never derived from content (SEC-INJECT/ReDoS).
const WORD_SPLIT = /[^a-z0-9]+/;
/** Hard cap on characters tokenized from any single string. */
const MAX_SIMILARITY_CHARS = 20000;
/** Lowercase, length-capped word list using the fixed split class. */
export function tokenizeWords(source: string): string[] {
    return source
        .slice(0, MAX_SIMILARITY_CHARS)
        .toLowerCase()
        .split(WORD_SPLIT)
        .filter((w) => w.length > 0);
}
/** Overlapping `size`-word shingles as a set (deterministic, bounded). */
export function shingleSet(words: readonly string[], size: number): Set<string> {
    const shingles = new Set<string>();
    if (size <= 0 || words.length < size)
        return shingles;
    for (let i = 0; i + size <= words.length; i += 1) {
        shingles.add(words.slice(i, i + size).join(' '));
    }
    return shingles;
}
/** Jaccard similarity of two shingle sets (0 when either is empty). */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0)
        return 0;
    let intersection = 0;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const shingle of small) {
        if (large.has(shingle))
            intersection += 1;
    }
    return intersection / (a.size + b.size - intersection);
}
export interface NgramGuardResult {
    /** True when the output is too close to a snippet and must be dropped. */
    rejected: boolean;
    /** Max Jaccard similarity of the output against any single snippet. */
    maxSimilarity: number;
    threshold: number;
    ngramSize: number;
}
/**
 * Evaluate AI output against every supplied competitor snippet. Deterministic
 * and pure. `rejected` is true iff the max shingle similarity against any one
 * snippet is at or above the documented threshold.
 */
export function evaluateCopySimilarity(output: string, snippets: readonly string[], options: {
    ngramSize?: number;
    threshold?: number;
} = {}): NgramGuardResult {
    const ngramSize = options.ngramSize ?? COMPETITOR_CONTENT_NGRAM_SIZE;
    const threshold = options.threshold ?? COMPETITOR_CONTENT_NGRAM_SIMILARITY_THRESHOLD;
    const outputShingles = shingleSet(tokenizeWords(output), ngramSize);
    let maxSimilarity = 0;
    for (const snippet of snippets) {
        const snippetShingles = shingleSet(tokenizeWords(snippet), ngramSize);
        const similarity = jaccardSimilarity(outputShingles, snippetShingles);
        if (similarity > maxSimilarity)
            maxSimilarity = similarity;
    }
    return {
        rejected: maxSimilarity >= threshold,
        maxSimilarity,
        threshold,
        ngramSize,
    };
}
import { COMPETITOR_CONTENT_NGRAM_SIZE, COMPETITOR_CONTENT_NGRAM_SIMILARITY_THRESHOLD } from '../../shared/safety/feature-limits.js';
