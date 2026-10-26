/**
 * Report categories — how the report groups findings
 * for its category filter. One fixed, vendor-neutral category per rule id;
 * `rules.test.ts` pins that every id has one.
 */
import type { RuleId } from './rule.types.js';

export const RULE_CATEGORIES = [
  'indexability',
  'links-redirects',
  'content',
  'html',
  'media',
  'performance',
  'security',
  'social',
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const RULE_CATEGORY: Readonly<Record<RuleId, RuleCategory>> = {
  'robots-blocked': 'indexability',
  'sitemap-missing-or-weak': 'indexability',
  'title-missing-or-weak': 'content',
  'meta-description-missing': 'content',
  'headings-weak': 'content',
  'canonical-missing-or-broken': 'indexability',
  'structured-data-missing': 'html',
  'broken-internal-links': 'links-redirects',
  'thin-content': 'content',
  'faq-content-missing': 'content',
  'llms-txt-missing': 'indexability',
  'https-canonicalization': 'security',
  'core-web-vitals-poor': 'performance',
  'page-speed-lab-low': 'performance',
  'mobile-unfriendly': 'performance',
  'accessibility-low': 'html',
  'not-indexed': 'indexability',
  'rich-results-issues': 'html',
  'index-partial': 'indexability',
  'gsc-ctr-low': 'content',
  'sitemap-errors': 'indexability',
  'ai-visibility-low': 'content',
  // Listings and reviews are how the business appears off the site.
  'nap-inconsistency': 'social',
  'low-review-count': 'social',
  'low-review-rating': 'social',
  'local-pack-not-ranking': 'social',
  'http-error-pages': 'links-redirects',
  'redirect-chains': 'links-redirects',
  'links-to-redirects': 'links-redirects',
  'meta-refresh-redirect': 'links-redirects',
  'canonical-chain-or-conflict': 'indexability',
  'orphan-pages': 'links-redirects',
  'deep-pages': 'links-redirects',
  'duplicate-titles': 'content',
  'duplicate-content': 'content',
  'placeholder-text': 'content',
  'mixed-content': 'security',
  'images-missing-alt': 'media',
  'slow-server-response': 'performance',
  'large-pages': 'performance',
  'uncompressed-pages': 'performance',
  'render-blocking-resources': 'performance',
  'html-basics-missing': 'html',
  'deprecated-html': 'html',
  'url-structure': 'links-redirects',
  'social-tags-missing': 'social',
  'favicon-missing': 'html',
  'broken-resources': 'media',
  'oversized-images': 'media',
  'uncached-static-resources': 'performance',
};

/** Category of a stored finding; `null` for an id this release does not know. */
export function categoryOf(ruleId: string): RuleCategory | null {
  return Object.hasOwn(RULE_CATEGORY, ruleId) ? RULE_CATEGORY[ruleId as RuleId] : null;
}
