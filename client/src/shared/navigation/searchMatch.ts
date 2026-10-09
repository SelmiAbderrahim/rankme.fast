/**
 * Small, dependency-free matcher behind the topbar search. Case- and
 * accent-insensitive; a substring hit always beats a looser in-order
 * (subsequence) hit, so "kwr" still finds "Keyword research" but never
 * outranks a real substring match.
 */
export const normalizeSearchText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

/** Subsequence matching below this length matches nearly everything. */
const MIN_FUZZY_LENGTH = 3;

const isSubsequence = (haystack: string, needle: string): boolean => {
  let at = 0;
  for (const char of haystack) {
    if (char === needle[at]) at += 1;
    if (at === needle.length) return true;
  }
  return false;
};

/**
 * Lower is better: 0 starts-with, 1 word-start, 2 substring, 3 fuzzy.
 * `null` means no match. An empty needle matches everything equally (0).
 */
export const rankSearchMatch = (text: string, query: string): number | null => {
  const haystack = normalizeSearchText(text);
  const needle = normalizeSearchText(query);
  if (!needle) return 0;
  const index = haystack.indexOf(needle);
  if (index === 0) return 0;
  if (index > 0) return /[\s\-_./]/u.test(haystack.charAt(index - 1)) ? 1 : 2;
  if (needle.length >= MIN_FUZZY_LENGTH && isSubsequence(haystack, needle.replace(/\s+/gu, ''))) {
    return 3;
  }
  return null;
};

/** Best rank across several fields of one record (label, domain, …). */
export const rankSearchFields = (fields: readonly string[], query: string): number | null => {
  let best: number | null = null;
  for (const field of fields) {
    const rank = rankSearchMatch(field, query);
    if (rank !== null && (best === null || rank < best)) best = rank;
  }
  return best;
};
