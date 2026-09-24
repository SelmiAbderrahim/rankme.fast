/**
 * Docs URL helper.
 *
 * Builds the canonical localized HTML route for a documentation page.
 *
 * The docs slug set is closed (see `DOCS_SLUGS`); the docs integrity test
 * guarantees every slug ships in every locale, so
 * this helper never needs an existence fallback.
 */
import type { SupportedLocale } from '@shared/i18n';
import { DEFAULT_LOCALE, isSupportedLocale } from '@shared/i18n';

export const DOCS_SLUGS = [
  'index',
  'getting-started',
  'self-hosting',
  'beta',
  'audit-report',
  'rank-tracking',
  'page-speed',
  'google-search-console',
  'pages-performance',
  'keyword-research',
  'backlinks-competitors',
  'plans-limits-credits',
  'ai-summary',
  'content-intelligence',
  'rankmefast-mcp',
  'ai-assistant',
  'settings-security',
  'troubleshooting',
  'ai-visibility',
  'local-seo',
  'pricing',
  'notification-preferences',
  'team',
  'enterprise',
  'public-api',
  'looker-studio',
  'weekly-pulse',
  'gsc-generative-appearance',
  'confirmed-rank-alerts',
  'next-actions',
  'ai-visibility-citations',
  'audience-research',
  'keyword-intelligence',
  'link-intelligence',
  'traffic-insights',
  'keyword-trends',
  'review-intelligence',
  'brand-radar',
  // rankme-community-requests feature slugs (keyword-clustering included).
  'serp-features',
  'keyword-clustering',
  'alt-engine-tracking',
  'cannibalization',
  'toxic-links',
  'alerts',
  'internal-linking',
  'content-briefs',
  'geogrid',
  'schema-markup',
  'client-reports',
  'report-exports',
  'app-seo',
  'changelog',
] as const;

export type DocsSlug = (typeof DOCS_SLUGS)[number];

export function isDocsSlug(value: unknown): value is DocsSlug {
  return (
    typeof value === 'string' && (DOCS_SLUGS as readonly string[]).includes(value)
  );
}

/**
 * Build the public URL for a docs page.
 *
 * Unknown locales silently fall back to `DEFAULT_LOCALE` (`en`). The
 * integrity test guarantees every slug × locale variant exists, so no
 * runtime existence check is needed.
 */
export function docsUrl(slug: DocsSlug, locale: SupportedLocale | string): string {
  const resolved: SupportedLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  const page = slug === 'index' ? '/docs' : `/docs/${slug}`;
  return resolved === DEFAULT_LOCALE ? page : `/${resolved}${page}`;
}
