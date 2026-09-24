import { Helmet } from 'react-helmet-async';
import { isRtl, isSupportedLocale, type SupportedLocale } from '@shared/i18n';
import {
  SITE_NAME,
  DEFAULT_OG_IMAGE,
  TWITTER_HANDLE,
  canonicalFor,
  hreflangAlternates,
  ogLocaleFor,
} from './meta';
import { serializeJsonLd } from '@shared/security';

export interface SeoProps {
  /** Page <title> (Helmet appends the site name). */
  title: string;
  /** Meta description (~150–160 chars). */
  description: string;
  /** Un-prefixed (English) path, e.g. "/alternatives/backrest". */
  basePath: string;
  /** Active locale — drives canonical, hreflang self-ref, html lang/dir. */
  locale: SupportedLocale;
  /** Absolute OG image URL. Defaults to the site image. */
  image?: string;
  type?: 'website' | 'article';
  /** When true, emit robots noindex (thin/low-data programmatic pages). */
  noindex?: boolean;
  /** ISO date the content was first published (article pages). */
  datePublished?: string;
  /** ISO date the content was last updated (article pages, freshness signal). */
  dateModified?: string;
  /** JSON-LD document(s) — usually a single `graph(...)` object. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

/**
 * Declarative <head> for a marketing page. Renders title, description,
 * canonical, Open Graph, Twitter Card, the full hreflang cluster, robots,
 * and JSON-LD. On the server react-helmet-async serialises this into the
 * SSR HTML; on the client it updates the document head on navigation.
 */
export const Seo = ({
  title,
  description,
  basePath,
  locale,
  image = DEFAULT_OG_IMAGE,
  type = 'website',
  noindex = false,
  datePublished,
  dateModified,
  jsonLd,
}: SeoProps) => {
  const canonical = canonicalFor(basePath, locale);
  const alternates = hreflangAlternates(basePath);
  // og:locale:alternate — real hreflang locales other than the active one and
  // x-default, so social crawlers surface the localized variants.
  const ogAlternateLocales = alternates.flatMap((alt) =>
    alt.hrefLang !== locale && isSupportedLocale(alt.hrefLang)
      ? [ogLocaleFor(alt.hrefLang)]
      : [],
  );
  const jsonLdDocs = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet
      htmlAttributes={{ lang: locale, dir: isRtl(locale) ? 'rtl' : 'ltr' }}
      titleTemplate={`%s · ${SITE_NAME}`}
      defaultTitle={SITE_NAME}
    >
      <title>{title}</title>
      <meta name="description" content={description} />
      {noindex ? (
        <meta name="robots" content="noindex, follow" />
      ) : (
        <meta name="robots" content="index, follow" />
      )}
      <link rel="canonical" href={canonical} />

      {/* hreflang cluster */}
      {alternates.map((alt) => (
        <link
          key={alt.hrefLang}
          rel="alternate"
          hrefLang={alt.hrefLang}
          href={alt.href}
        />
      ))}

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={image} />
      <meta property="og:locale" content={ogLocaleFor(locale)} />
      {ogAlternateLocales.map((alt) => (
        <meta key={alt} property="og:locale:alternate" content={alt} />
      ))}
      {type === 'article' && datePublished && (
        <meta property="article:published_time" content={datePublished} />
      )}
      {type === 'article' && dateModified && (
        <meta property="article:modified_time" content={dateModified} />
      )}

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={TWITTER_HANDLE} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {jsonLdDocs.map((doc, index) => (
        <script key={index} type="application/ld+json">
          {serializeJsonLd(doc)}
        </script>
      ))}
    </Helmet>
  );
};
