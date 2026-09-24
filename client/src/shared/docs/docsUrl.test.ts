import { describe, expect, it } from 'vitest';
import { DOCS_SLUGS, docsUrl, isDocsSlug } from './docsUrl';

describe('docsUrl', () => {
  it('resolves clean canonical routes for default and prefixed locales', () => {
    expect(docsUrl('getting-started', 'en')).toBe('/docs/getting-started');
    expect(docsUrl('ai-summary', 'ar')).toBe('/ar/docs/ai-summary');
    expect(docsUrl('index', 'fr')).toBe('/fr/docs');
  });

  it('falls back to en for unknown locales', () => {
    expect(docsUrl('index', 'xx')).toBe('/docs');
  });

  it('accepts every supported locale', () => {
    for (const locale of ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const) {
      const prefix = locale === 'en' ? '' : `/${locale}`;
      expect(docsUrl('audit-report', locale)).toBe(`${prefix}/docs/audit-report`);
    }
  });

  it('isDocsSlug narrows unknown values', () => {
    expect(isDocsSlug('getting-started')).toBe(true);
    expect(isDocsSlug('unknown-slug')).toBe(false);
    expect(isDocsSlug(42)).toBe(false);
    expect(isDocsSlug(undefined)).toBe(false);
  });

  it('exports the full slug catalogue (drift guard)', () => {
    expect(DOCS_SLUGS).toEqual([
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
    ]);
  });

  // The client `DOCS_SLUGS` and the server-side integrity
  // `SLUGS` must enumerate the same complete set. This guard duplicates
  // the server list here (kept small) so any drift lands as a red test on
  // the client side too.
  it('mirrors the server-side integrity slug list (drift guard, both sides)', () => {
    const serverIntegritySlugs = [
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
    ];
    expect([...DOCS_SLUGS].sort()).toEqual([...serverIntegritySlugs].sort());
  });
});
