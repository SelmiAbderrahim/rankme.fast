import { SITE_URL, SITE_NAME, absoluteUrl } from './meta';
import { BRAND_ASSETS, MAINTAINER_X_URL } from '@shared/brand';
import { githubUrl } from '@shared/config/github';
import type { SupportedLocale } from '@shared/i18n';

/**
 * JSON-LD (schema.org) builders. Each returns a plain object embedded as
 * `<script type="application/ld+json">` by <Seo>. Keep values accurate and
 * matched to visible page content (mismatched schema is a spam signal).
 */

type JsonLd = Record<string, unknown>;

/**
 * Site-wide "content last reviewed" date (ISO). Single source of truth for
 * freshness signals — kept in step with the server sitemap `lastmod`. Guide
 * datasets carry a finer-grained `lastReviewed` (YYYY-MM) that overrides this
 * per page via `monthToIso`.
 */
export const SITE_LAST_UPDATED = '2026-08-10';

/** Expand a "YYYY-MM" review month to an ISO date at the first of the month. */
export function monthToIso(month: string): string {
  return /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : SITE_LAST_UPDATED;
}

/** Combine multiple node objects into one `@graph` document. */
export function graph(...nodes: JsonLd[]): JsonLd {
  return { '@context': 'https://schema.org', '@graph': nodes };
}

export function organization(): JsonLd {
  const repo = githubUrl();
  return {
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl(BRAND_ASSETS.ogLogo),
    description:
      'RankMeFast shows you what to fix so search engines and AI answer engines can find, understand, and cite your site — and where your keywords rank.',
    // The repository joins the profile list only once VITE_GITHUB_URL is set.
    sameAs: [MAINTAINER_X_URL, ...(repo ? [repo] : [])],
  };
}

export function website(): JsonLd {
  return {
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    publisher: { '@id': `${SITE_URL}/#organization` },
  };
}

export function softwareApplication(): JsonLd {
  return {
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#software`,
    name: SITE_NAME,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description:
      'SEO and AI-answer-engine audit tool: crawls a site, explains what to fix in plain language, tracks keyword rankings, monitors Core Web Vitals and Google Search Console indexing, and surfaces backlink and competitor signals.',
  };
}

export interface WebApplicationInput {
  name: string;
  description: string;
  /** Locale-prefixed public path. */
  path: string;
}

/** Schema for a free browser-based utility whose visible UI is the page. */
export function webApplication({
  name,
  description,
  path,
}: WebApplicationInput): JsonLd {
  const url = absoluteUrl(path);
  return {
    '@type': 'WebApplication',
    name,
    description,
    url,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    isAccessibleForFree: true,
    provider: { '@id': `${SITE_URL}/#organization` },
  };
}

export interface DatasetInput {
  name: string;
  description: string;
  /** Locale-prefixed public path. */
  path: string;
  spatialCoverage: string;
  temporalCoverage: string;
  measurementTechnique: string;
  variableMeasured: string;
}

/** Schema for the aggregate dataset described and rendered on a public page. */
export function dataset({
  name,
  description,
  path,
  spatialCoverage,
  temporalCoverage,
  measurementTechnique,
  variableMeasured,
}: DatasetInput): JsonLd {
  const url = absoluteUrl(path);
  return {
    '@type': 'Dataset',
    name,
    description,
    url,
    isAccessibleForFree: true,
    creator: { '@id': `${SITE_URL}/#organization` },
    spatialCoverage,
    temporalCoverage,
    measurementTechnique,
    variableMeasured,
  };
}

export interface BreadcrumbItem {
  name: string;
  /** Locale-prefixed path, e.g. "/alternatives/backrest". */
  path: string;
}

export function breadcrumbList(items: BreadcrumbItem[]): JsonLd {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export interface FaqItem {
  question: string;
  answer: string;
}

export function faqPage(faqs: FaqItem[]): JsonLd {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
}

export interface ItemListEntry {
  name: string;
  path: string;
}

export function itemList(entries: ItemListEntry[]): JsonLd {
  return {
    '@type': 'ItemList',
    itemListElement: entries.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      url: absoluteUrl(entry.path),
    })),
  };
}

export interface ArticleInput {
  headline: string;
  description: string;
  /** Un-prefixed or locale-prefixed page path — becomes the article URL. */
  path: string;
  /** ISO date first published. Defaults to the site last-updated date. */
  datePublished?: string;
  /** ISO date last modified (freshness signal). Defaults to datePublished. */
  dateModified?: string;
  /** BCP-47 language for localized articles. */
  language?: SupportedLocale;
}

/**
 * TechArticle node for long-form guide / use-case pages. Publisher and author
 * point at the Organization so E-E-A-T signals resolve. Dates drive freshness;
 * they must match the visible "Last updated" recency line on the page.
 */
export function article({
  headline,
  description,
  path,
  datePublished = SITE_LAST_UPDATED,
  dateModified,
  language = 'en',
}: ArticleInput): JsonLd {
  const url = absoluteUrl(path);
  return {
    '@type': 'TechArticle',
    headline,
    description,
    url,
    mainEntityOfPage: url,
    datePublished,
    dateModified: dateModified ?? datePublished,
    inLanguage: language,
    author: { '@id': `${SITE_URL}/#organization` },
    publisher: { '@id': `${SITE_URL}/#organization` },
    image: absoluteUrl(BRAND_ASSETS.ogDefault),
  };
}

export interface HowToStep {
  name: string;
  text: string;
}

export function howTo(name: string, steps: HowToStep[]): JsonLd {
  return {
    '@type': 'HowTo',
    name,
    step: steps.map((step, index) => ({
      '@type': 'HowToStep',
      position: index + 1,
      name: step.name,
      text: step.text,
    })),
  };
}
