// SEO URL inventory for robots.txt / sitemap generation.
//
// The public docs are the only indexable surface; slugs mirror client docsUrl.
//
// `en` is the x-default locale and is served on the un-prefixed path. Every
// other locale is served under a `/<locale>` path prefix.
export const LOCALES = ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const;
export type SeoLocale = (typeof LOCALES)[number];
/** The locale served on un-prefixed paths (also the hreflang x-default). */
export const DEFAULT_LOCALE: SeoLocale = 'en';
/**
 * Curated URLs surfaced in `/llms.txt` for LLM crawlers (AEO). The
 * self-hosted edition has no marketing site; the public docs are the only
 * indexable surface.
 */
export const LLMS_TXT_PATHS: readonly string[] = [
    '/docs',
    '/docs/getting-started',
    '/docs/self-hosting',
    '/docs/audit-report',
    '/docs/rankmefast-mcp',
    '/docs/public-api',
];
/** Public documentation hub plus every article. */
export const DOCS_SLUGS: readonly string[] = [
    'getting-started',
    'self-hosting',
    'beta',
    'audit-report',
    'troubleshooting',
    'page-speed',
    'ai-summary',
    'content-intelligence',
    'ai-visibility',
    'local-seo',
    'backlinks-competitors',
    'rank-tracking',
    'keyword-research',
    'google-search-console',
    'pages-performance',
    'pricing',
    'plans-limits-credits',
    'settings-security',
    'notification-preferences',
    'team',
    'enterprise',
    'public-api',
    'looker-studio',
    'rankmefast-mcp',
    'ai-assistant',
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
export const DOCS_PATHS: readonly string[] = [
    '/docs',
    ...DOCS_SLUGS.map((slug) => `/docs/${slug}`),
];
/** AI + search crawlers we explicitly welcome. */
export const ALLOWED_CRAWLERS: readonly string[] = [
    'GPTBot',
    'ChatGPT-User',
    'OAI-SearchBot',
    'PerplexityBot',
    'ClaudeBot',
    'anthropic-ai',
    'Claude-Web',
    'Google-Extended',
    'Googlebot',
    'Bingbot',
];
/** Paths kept out of the index for the wildcard user-agent. */
export const DISALLOWED_PATHS: readonly string[] = [
    '/dashboard',
    '/api',
    '/admin',
    '/login',
    '/register',
    '/share',
    '/ar/share',
    '/fr/share',
    '/de/share',
    '/es/share',
    '/ru/share',
    '/zh/share',
];
/** Escape a string for safe inclusion in XML text / attribute values. */
export function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
/**
 * Build the absolute URL for a locale + path. English (`DEFAULT_LOCALE`) is
 * served on the un-prefixed path; every other locale is prefixed with
 * `/<locale>`.
 */
export function localizedUrl(origin: string, locale: SeoLocale, path: string): string {
    const base = origin.replace(/\/$/, '');
    const suffix = path === '/' ? '' : path;
    if (locale === DEFAULT_LOCALE) {
        return `${base}${suffix || '/'}`;
    }
    return `${base}/${locale}${suffix}`;
}
/**
 * Build a single `<url>` entry (as an XML string) for the given path.
 */
export function buildUrlEntry(origin: string, path: string, lastmod: string): string {
    const loc = escapeXml(localizedUrl(origin, DEFAULT_LOCALE, path));
    const xDefault = escapeXml(localizedUrl(origin, DEFAULT_LOCALE, path));
    const alternates = LOCALES.map((locale) => {
        const href = escapeXml(localizedUrl(origin, locale, path));
        return `    <xhtml:link rel="alternate" hreflang="${locale}" href="${href}"/>`;
    });
    alternates.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${xDefault}"/>`);
    return [
        '  <url>',
        `    <loc>${loc}</loc>`,
        `    <lastmod>${escapeXml(lastmod)}</lastmod>`,
        ...alternates,
        '  </url>',
    ].join('\n');
}
