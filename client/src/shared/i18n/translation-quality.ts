// Translation-quality guard. Key parity proves a key EXISTS in every
// locale; it says nothing about whether the *value* was actually translated.
// The ai-visibility surface shipped with English copied verbatim into all six
// non-`en` locales and parity was blind to it. This detector catches that class
// of defect: raw English leaking into a non-Latin locale, or a long English
// sentence copied wholesale into any locale.
//
// Single source of truth for the allowlist lives here and is imported by the
// i18n parity suite. The rules are ASCII/length based (never a per-key skip
// file — that is forbidden by the i18n rule); when a legitimate value trips a
// rule, extend the allowlist with a justified pattern below — never weaken the
// ASCII/length thresholds.

/** Locales written in a non-Latin script — a genuinely translated value here
 *  contains native-script characters, so a pure-ASCII Latin value is a tell. */
export const NON_LATIN_LOCALES = ['ar', 'ru', 'zh'] as const;

/**
 * Brand / product / protocol tokens that stay Latin in every locale by
 * convention. Matched case-insensitively as substrings and stripped before the
 * residual-Latin-word check, so a value that is ONLY brand tokens never trips.
 * Each entry is here because translating it would be wrong, not lazy.
 */
export const BRAND_TOKENS = [
  'RankMeFast', // product name
  'DataForSEO', // vendor
  'Google', // vendor / proper noun
  'Bing', // search engine proper noun
  'YouTube', // search engine proper noun
  'Amazon', // marketplace proper noun
  'GSC', // Google Search Console initialism
  'Polar', // payment vendor
  'Resend', // email vendor
  'Anthropic', // AI vendor
  'Firecrawl', // vendor (Content Intelligence + monitoring page-source)
  'Trustpilot', // review directory (proper noun in every locale)
  'Tripadvisor', // review directory (proper noun in every locale)
  'OpenAI', // AI vendor
  'DeepSeek', // AI vendor
  'Kimi', // AI vendor
  'Moonshot', // AI vendor (Kimi upstream)
  'Gemini', // AI vendor (Google model family)
  'Claude', // AI model family (Anthropic)
  'GLM', // AI vendor initialism (Zhipu)
  'Content Intelligence', // RankMeFast flagship feature name (kept Latin in ru breadcrumb/eyebrow)
  'Cursor', // MCP client (proper noun in every locale)
  'VS Code', // MCP client (proper noun in every locale)
  'Search Console', // Google Search Console — proper product name, kept Latin
  'Core Web Vitals', // Google metric family (kept as the canonical proper noun)
  'LCP', // Core Web Vitals metric initialism
  'INP', // Core Web Vitals metric initialism
  'CLS', // Core Web Vitals metric initialism
  'TTFB', // web-performance metric initialism
  'FCP', // web-performance metric initialism
  'CTR', // click-through-rate initialism (Search Console column)
  'FAQ', // acronym kept Latin in fr/de/es/ru nav + marketing
  'CMS', // content-management-system acronym (tech-stack label)
  'Cookie', // web-standard borrowed term (privacy copy: "Cookie CSRF")
  'On-page', // SEO jargon, kept Latin like `canonical` / `sitemap`
  'Largest Contentful Paint', // Core Web Vitals metric proper noun (kept Latin)
  'Interaction to Next Paint', // Core Web Vitals metric proper noun (kept Latin)
  'Cumulative Layout Shift', // Core Web Vitals metric proper noun (kept Latin)
  'JSON', // data format
  'CSRF', // security acronym
  'API', // acronym
  'SEO', // acronym (product category)
  'URL', // acronym
  'PSI', // PageSpeed Insights initialism
  'CrUX', // Chrome UX Report initialism
  'SERP', // search-engine-results-page initialism
  'AI', // acronym
  'LLM', // acronym
  'NAP', // name/address/phone initialism (local SEO)
  'Dofollow', // link-attribute jargon (kept Latin)
  'Nofollow', // link-attribute jargon (kept Latin)
  'robots.txt', // literal filename
  'canonical', // SEO jargon term (kept Latin per rule copy convention)
  'sitemap', // SEO jargon term (kept Latin per rule copy convention)
  'Webhooks', // longest-first so the plural strips before the singular
  'Webhook',
  'Slack', // vendor proper noun (alert channel) — translating it would be wrong
] as const;

/**
 * Key prefixes whose values are intentionally NOT translated (they are the same
 * token in every locale): language endonyms and `_marker` sentinel keys.
 */
export const ALLOWLIST_KEY_PATTERNS: RegExp[] = [
  /(^|\.)_?marker(s)?(\.|$)/i, // parity `_marker` sentinels carry no user copy
  /(^|\.)plan\.(none|starter|basic|pro|business|agency|scale|enterprise)$/i, // tier proper nouns
  /(^|\.)tiers\.[a-z0-9]+\.name$/i, // marketing pricing tier proper nouns
  /(^|\.)tierBadge\.(free|starter|pro|business|agency)$/i, // sidebar tier badge proper nouns
  // Literal identifier EXAMPLES shown inside an input placeholder (a Google
  // Place ID, a bare domain, a numeric location id). They are sample data, not
  // prose — translating them would make the example wrong.
  /(^|\.)sources\.placeholder\.[a-z]+$/i,
  // Same class: an engine-target EXAMPLE shown inside a placeholder — a
  // literal YouTube handle or a literal Amazon ASIN. Translating the sample
  // would make the example wrong.
  /(^|\.)engine\.targetPlaceholder(Youtube|Amazon)$/i,
  // Literal sample domain shown inside the competitor-traffic request field.
  // Translating it would stop it being a valid domain example.
  /^request\.domainPlaceholder$/,
  // Canonical Google SERP feature label retained by the Russian and Chinese
  // editorial translations. Keep this exact leaf narrow so prose cannot hide.
  /^featurePages\.serpFeatures\.truth\.items\.second\.title$/,
];

/** Whole namespaces whose values are intentionally the same in every locale. */
export const ALLOWLIST_NAMESPACES = [
  'language', // language endonyms — "Deutsch" stays "Deutsch" everywhere
] as const;

/** A value that is literal markup / a code snippet (contains an HTML tag) is not
 *  prose — the marketing report-mock snippets are shown verbatim in every locale. */
const MARKUP_RE = /<\/?[a-z][^>]*>/i;

export type QualityReason = 'ascii-latin' | 'copied-en';

export interface QualityIssue {
  locale: string;
  namespace: string;
  key: string;
  value: string;
  reason: QualityReason;
}

const PLACEHOLDER = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g;
const URL_RE = /https?:\/\/\S+/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi;
const LATIN_WORD = /[A-Za-z]{3,}/;

const stripPlaceholders = (s: string): string => s.replace(PLACEHOLDER, ' ');

/** True when every code point is in the 7-bit ASCII range (0..127). Written as
 *  a code-point scan so the source carries no literal control bytes. */
const isPureAscii = (s: string): boolean => {
  for (const ch of s) {
    // `for..of` yields a full single code point, so codePointAt(0) is defined.
    if (ch.codePointAt(0)! > 0x7f) return false;
  }
  return true;
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Strip URLs, emails and every allowlisted brand token so only substantive,
 *  translatable Latin words remain. */
const stripAllowed = (s: string): string => {
  let out = s.replace(URL_RE, ' ').replace(EMAIL_RE, ' ');
  for (const token of BRAND_TOKENS) {
    out = out.replace(new RegExp(escapeRe(token), 'gi'), ' ');
  }
  return out;
};

const isAllowlistedKey = (key: string): boolean =>
  ALLOWLIST_KEY_PATTERNS.some((re) => re.test(key));

/**
 * Classify a single (en → locale) leaf pair. Returns the failing reason, or
 * null when the value is acceptable.
 */
export const classifyValue = (
  locale: string,
  namespace: string,
  key: string,
  enValue: string,
  value: string,
): QualityReason | null => {
  if ((ALLOWLIST_NAMESPACES as readonly string[]).includes(namespace)) return null;
  if (isAllowlistedKey(key)) return null;
  if (MARKUP_RE.test(value)) return null; // literal markup / code snippet
  const stripped = stripPlaceholders(value).trim();
  if (stripped === '') return null; // placeholder-only value (e.g. "{{count}}")

  // Rule 1 — non-Latin locales: a pure-ASCII value that still contains a
  // ≥3-letter Latin word after brand tokens are removed was never translated.
  if ((NON_LATIN_LOCALES as readonly string[]).includes(locale) && isPureAscii(value)) {
    if (LATIN_WORD.test(stripAllowed(stripped))) return 'ascii-latin';
  }

  // Rule 2 — all six non-en locales: a long value copied byte-for-byte from en
  // is a wholesale copy. Short cognates ("Status", "Actions") pass on length;
  // brand-only phrases pass because nothing translatable remains.
  if (value === enValue && stripped.length > 25) {
    // Require a substantive (≥3-letter) residual Latin word so a value made
    // entirely of proper nouns + short connectors ("Sitemaps in Google Search
    // Console", where German "in" coincides with English) is not a false copy.
    if (LATIN_WORD.test(stripAllowed(stripped))) return 'copied-en';
  }

  return null;
};

type Tree = Record<string, unknown>;

/** Walk an en baseline against a locale tree, classifying every leaf. */
export const collectQualityIssues = (
  locale: string,
  namespace: string,
  enTree: unknown,
  localeTree: unknown,
): QualityIssue[] => {
  const issues: QualityIssue[] = [];
  const walk = (enNode: unknown, locNode: unknown, prefix: string): void => {
    if (typeof enNode === 'string') {
      if (typeof locNode !== 'string') return;
      const reason = classifyValue(locale, namespace, prefix, enNode, locNode);
      if (reason) {
        issues.push({ locale, namespace, key: prefix, value: locNode, reason });
      }
      return;
    }
    if (enNode && typeof enNode === 'object') {
      for (const [k, v] of Object.entries(enNode as Tree)) {
        const next = prefix ? `${prefix}.${k}` : k;
        walk(v, (locNode as Tree | undefined)?.[k], next);
      }
    }
  };
  walk(enTree, localeTree, '');
  return issues;
};
