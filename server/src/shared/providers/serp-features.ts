/**
 * SERP-feature normalization — the ONE authority. Promoted here from two
 * former homes so a single module owns the closed enum, the vendor alias
 * table, and both normalization entry points:
 *
 *   - `keyword-research.service.ts` held `KNOWN_SERP_FEATURES` +
 *     `normalizeSerpFeatures()` (closed-enum membership).
 *   - `dataforseo/keywords.ts` held `SERP_FEATURE_ALIASES` + `mapSerpFeature()`
 *     + `toSerpFeatures()` (raw vendor item-type aliasing).
 *
 * Both old paths now re-export from here; neither keeps an implementation.
 *
 * The two entry points keep DELIBERATELY different semantics, byte-identical
 * to what shipped, so no consumer drifts:
 *
 *   `normalizeSerpFeatures`       input is already our enum vocabulary
 *                                 (Labs `serp_features`) → membership check.
 *   `normalizeVendorSerpFeatures` input is raw vendor item types
 *                                 (`map`, `image_pack`, …) → alias table.
 *
 * Anything unrecognized normalizes to `'other'` and is NEVER dropped — the
 * same convention as `intent: null` in the metrics/intent path.
 */
import type { SerpFeatureType } from './types.js';
/** Every member of the closed `SerpFeatureType` union, declaration order. */
export const SERP_FEATURE_TYPES = [
    'ai_overview',
    'featured_snippet',
    'people_also_ask',
    'local_pack',
    'video',
    'images',
    'shopping',
    'knowledge_graph',
    'other',
] as const satisfies readonly SerpFeatureType[];
const KNOWN_SERP_FEATURES = new Set<SerpFeatureType>(SERP_FEATURE_TYPES);
/** True when `value` is already a member of the closed enum. */
export function isSerpFeatureType(value: unknown): value is SerpFeatureType {
    return typeof value === 'string' && KNOWN_SERP_FEATURES.has(value as SerpFeatureType);
}
/**
 * Vendor SERP item-type → normalized `SerpFeatureType`. Unknown vendor
 * strings intentionally normalize to `'other'` and never drop.
 */
const SERP_FEATURE_ALIASES: Record<string, SerpFeatureType> = {
    ai_overview: 'ai_overview',
    google_ai_overview: 'ai_overview',
    featured_snippet: 'featured_snippet',
    people_also_ask: 'people_also_ask',
    local_pack: 'local_pack',
    map: 'local_pack',
    video: 'video',
    video_carousel: 'video',
    images: 'images',
    image: 'images',
    image_pack: 'images',
    shopping: 'shopping',
    google_shopping: 'shopping',
    knowledge_graph: 'knowledge_graph',
    knowledge_panel: 'knowledge_graph',
};
/**
 * Normalize a vendor SERP item-type string to the closed `SerpFeatureType`
 * enum. Anything not in the alias table maps to `'other'`; empty/whitespace
 * strings are skipped by the caller (they carry no signal).
 */
export function mapSerpFeature(vendorType: string): SerpFeatureType {
    const key = vendorType.trim().toLowerCase();
    return SERP_FEATURE_ALIASES[key] ?? 'other';
}
/**
 * Normalize the SERP-feature list from the vendor: dedupe (order-preserving)
 * and map anything outside the closed enum to `'other'`. Empty input → [].
 */
export function normalizeSerpFeatures(input: readonly string[] | undefined | null): SerpFeatureType[] {
    if (!input || input.length === 0)
        return [];
    const seen = new Set<SerpFeatureType>();
    const out: SerpFeatureType[] = [];
    for (const raw of input) {
        const normalized: SerpFeatureType = isSerpFeatureType(raw) ? raw : 'other';
        if (seen.has(normalized))
            continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}
/**
 * Map the vendor `serp_info.serp_item_types` array (or nullish) to a deduped
 * ordered array of normalized SERP features. Order is first-seen, so tests
 * can lock deterministic outputs.
 */
export function normalizeVendorSerpFeatures(vendorTypes: readonly string[] | null | undefined): SerpFeatureType[] {
    if (!vendorTypes)
        return [];
    const seen = new Set<SerpFeatureType>();
    const out: SerpFeatureType[] = [];
    for (const raw of vendorTypes) {
        if (typeof raw !== 'string' || raw.trim().length === 0)
            continue;
        const normalized = mapSerpFeature(raw);
        if (seen.has(normalized))
            continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}
