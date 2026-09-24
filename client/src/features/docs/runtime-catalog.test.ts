import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DocsReader } from './types';
import type { SupportedLocale } from '@shared/i18n';

const DOCS_DIR = resolve(__dirname, '..', '..', '..', '..', 'docs');
const LOCALES: readonly SupportedLocale[] = [
  'en',
  'ar',
  'fr',
  'de',
  'es',
  'ru',
  'zh',
];
const FEATURE_SLUGS = [
  'looker-studio',
  'ai-assistant',
  'link-intelligence',
  'traffic-insights',
  'keyword-trends',
  'review-intelligence',
  'brand-radar',
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
  'changelog',
] as const;

interface DocsRuntimeModule {
  createDocsReader(docsDir: string): DocsReader;
  docsRoutePath(slug: string, locale: string): string;
}

async function loadRuntime(): Promise<DocsRuntimeModule> {
  return import('../../../docs-runtime.js') as Promise<DocsRuntimeModule>;
}

describe('feature docs runtime catalog', () => {
  it.each(LOCALES)('%s parses and renders every new localized article', async (locale) => {
    const { createDocsReader, docsRoutePath } = await loadRuntime();
    const reader = createDocsReader(DOCS_DIR);
    const catalog = reader.readCatalog(locale);
    const catalogSlugs = catalog.docs.map(({ slug }) => slug);

    for (const slug of FEATURE_SLUGS) {
      expect(catalogSlugs, `${locale} catalog → ${slug}`).toContain(slug);
      const article = reader.readArticle(locale, slug);
      expect(article.doc.body.length, `${locale}/${slug} body`).toBeGreaterThan(120);
      const expected =
        locale === 'en' ? `/docs/${slug}` : `/${locale}/docs/${slug}`;
      expect(docsRoutePath(slug, locale)).toBe(expected);
    }
  });
});
