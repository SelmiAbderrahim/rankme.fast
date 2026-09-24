import type { SupportedLocale } from '@shared/i18n';
import type { DocsSlug } from '@shared/docs/docsUrl';

export const DOC_SECTION_IDS = [
  'start',
  'audits',
  'research',
  'product',
  'account',
  'developers',
] as const;

export type DocsSection = (typeof DOC_SECTION_IDS)[number];

export interface DocsMeta {
  slug: DocsSlug;
  locale: SupportedLocale;
  title: string;
  description: string;
  section: DocsSection;
  order: number;
}

export interface DocsCatalog {
  locale: SupportedLocale;
  home: DocsMeta;
  docs: DocsMeta[];
}

export interface DocsSearchEntry extends DocsMeta {
  searchText: string;
}

export interface DocsSearchData {
  locale: SupportedLocale;
  docs: DocsSearchEntry[];
}

export interface DocsArticleData {
  doc: DocsMeta & { body: string };
}

export interface DocsReader {
  readCatalog(locale: SupportedLocale): DocsCatalog;
  readSearch(locale: SupportedLocale): DocsSearchData;
  readArticle(locale: SupportedLocale, slug: DocsSlug): DocsArticleData;
}

export interface DocsRequestContext {
  docsReader?: DocsReader;
}
