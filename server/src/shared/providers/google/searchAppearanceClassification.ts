/**
 * Search-appearance classifier.
 *
 * Google Search Console's Search Analytics API returns a `searchAppearance`
 * dimension whose values evolve — Google adds and renames labels without a
 * versioned changelog. Consumers CANNOT hard-code the enum. Every returned
 * row is stored VERBATIM (raw_appearance) and classified layerd on top.
 *
 * Recognized values are verified from current primary Google documentation on
 * the day of the ingest run (Search Console "Search appearance" help page +
 * Search Analytics API reference). This module is the SINGLE source of truth
 * for the generative-AI recognition list; the snapshot writer + read DTO
 * consume it, never inline strings.
 *
 * Unknown values pass through as `other_unknown` — never dropped, never
 * silently reclassified as generative. Operator-facing surfaces show the raw
 * name safely for review so we can update the list without a schema break.
 *
 * Access date + primary URL:
 *   - https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 *     (Search Analytics: valid `searchAppearance` dimension values, verified
 *     2026-07-19). Google documents `ai_overviews` (AI Overviews link in AI
 *     Overviews) and `ai_mode` (AI Mode) as generative-AI surfaces.
 *   - https://support.google.com/webmasters/answer/7576553 — Search Appearance
 *     filter reference, matching label list.
 *
 * Non-generative labels covered here (rich results, video, product, etc.)
 * are classified for observability parity but marked `is_generative:false`.
 * They exist here so consumers can display the raw label with a stable slug
 * even when it is not the generative-AI surface the pulse targets.
 */
export type SearchAppearanceClassificationSlug = 'ai_overviews' | 'ai_mode' | 'ama' | 'amp_article' | 'amp_top_stories' | 'faq_rich_results' | 'how_to' | 'job_listing' | 'product_result' | 'recipe' | 'review_snippet' | 'sitelinks_searchbox' | 'top_stories' | 'translated_results' | 'video' | 'web_light' | 'other_unknown';
export interface SearchAppearanceClassification {
    slug: SearchAppearanceClassificationSlug;
    isGenerative: boolean;
}
/**
 * Frozen recognition table. Keys are the RAW `keys[0]` values that Google
 * returns for the `searchAppearance` dimension (as reported by the Search
 * Analytics API — the API label, not the UI label).
 *
 * A change to this map must ship with a fixture update AND the primary-doc
 * access date in the header block.
 */
const RECOGNIZED: Readonly<Record<string, SearchAppearanceClassification>> = Object.freeze({
    AI_OVERVIEWS: { slug: 'ai_overviews', isGenerative: true },
    AI_MODE: { slug: 'ai_mode', isGenerative: true },
    AMA: { slug: 'ama', isGenerative: false },
    AMP_ARTICLE: { slug: 'amp_article', isGenerative: false },
    AMP_TOP_STORIES: { slug: 'amp_top_stories', isGenerative: false },
    FAQ_RICH_RESULTS: { slug: 'faq_rich_results', isGenerative: false },
    HOW_TO: { slug: 'how_to', isGenerative: false },
    JOB_LISTING: { slug: 'job_listing', isGenerative: false },
    PRODUCT_RESULT: { slug: 'product_result', isGenerative: false },
    RECIPE: { slug: 'recipe', isGenerative: false },
    REVIEW_SNIPPET: { slug: 'review_snippet', isGenerative: false },
    SITELINKS_SEARCHBOX: { slug: 'sitelinks_searchbox', isGenerative: false },
    TOP_STORIES: { slug: 'top_stories', isGenerative: false },
    TRANSLATED_RESULTS: { slug: 'translated_results', isGenerative: false },
    VIDEO: { slug: 'video', isGenerative: false },
    WEB_LIGHT: { slug: 'web_light', isGenerative: false },
});
const OTHER_UNKNOWN: SearchAppearanceClassification = Object.freeze({
    slug: 'other_unknown',
    isGenerative: false,
});
/**
 * Classify a raw Google `searchAppearance` value. Pure — no I/O, no state.
 * Unknown values pass through as `other_unknown` and are NEVER treated as
 * generative even if the raw string contains a suggestive substring.
 */
export function classifySearchAppearance(raw: string): SearchAppearanceClassification {
    const normalized = raw.trim().toUpperCase();
    const hit = RECOGNIZED[normalized];
    return hit ?? OTHER_UNKNOWN;
}
/** Read-only list of every recognized raw label (upper-cased). */
export function listRecognizedRawAppearances(): readonly string[] {
    return Object.freeze(Object.keys(RECOGNIZED));
}
/** Read-only list of every raw label recognized as generative-AI. */
export function listRecognizedGenerativeRawAppearances(): readonly string[] {
    return Object.freeze(Object.entries(RECOGNIZED)
        .filter(([, c]) => c.isGenerative)
        .map(([raw]) => raw));
}
