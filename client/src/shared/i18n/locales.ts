export const SUPPORTED_LOCALES = ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const LANGUAGE_COOKIE = 'lang';

export const RTL_LOCALES: readonly SupportedLocale[] = ['ar'];

export const NAMESPACES = [
  'common',
  'errors',
  'auth',
  'email',
  'language',
  'sites',
  'pages',
  'report',
  'ranks',
  'google',
  'keywordResearch',
  'backlinks',
  'competitors',
  'competitorsTraffic',
  'aiVisibility',
  'brandRadar',
  'alerts',
  'cannibalization',
  'internalLinks',
  'keywordClusters',
  'localSeo',
  'geogrid',
  'reviewIntelligence',
  'team',
  'settings',
  'account',
  'contentIntelligence',
  'audienceResearch',
  'schemaGenerator',
  'weeklyPulse',
  'actions',
  'docs',
  'assistant',
  'clientReports',
  'appSeo',
  'appSeoTracking',
  'appSeoCharts',
  'appSeoResearch',
  'appSeoReviews',
  'appSeoCompare',
  'appSeoListing',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isRtl(locale: SupportedLocale): boolean {
  return (RTL_LOCALES as readonly string[]).includes(locale);
}
