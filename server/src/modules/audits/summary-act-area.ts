import { LOCAL_SEO_RULE_IDS } from './finding-applicability.js';

/**
 * Where in the product the user acts on a summary item.
 * Chosen by rule, never by the model, so a summary can only point at a
 * surface that exists. Each value is a site-workspace tab.
 */
export const SUMMARY_ACT_AREAS = ['report', 'pages', 'google', 'schema', 'local-seo', 'ai-visibility'] as const;
export type SummaryActArea = (typeof SUMMARY_ACT_AREAS)[number];

const AREA_BY_RULE: Readonly<Record<string, SummaryActArea>> = {
  'not-indexed': 'google',
  'index-partial': 'google',
  'rich-results-issues': 'google',
  'gsc-ctr-low': 'google',
  'sitemap-errors': 'google',
  'broken-internal-links': 'pages',
  'thin-content': 'pages',
  'title-missing-or-weak': 'pages',
  'meta-description-missing': 'pages',
  'headings-weak': 'pages',
  'structured-data-missing': 'schema',
  'faq-content-missing': 'schema',
  'ai-visibility-low': 'ai-visibility',
  // Per-page problems are listed on each page.
  'orphan-pages': 'pages',
  'deep-pages': 'pages',
  'duplicate-titles': 'pages',
  'duplicate-content': 'pages',
  'placeholder-text': 'pages',
  'images-missing-alt': 'pages',
  'social-tags-missing': 'pages',
};

/** The surface for a rule: Local SEO checks go to Local SEO, others default to the report. */
export function summaryActArea(ruleId: string): SummaryActArea {
  if (LOCAL_SEO_RULE_IDS.has(ruleId)) return 'local-seo';
  return AREA_BY_RULE[ruleId] ?? 'report';
}
