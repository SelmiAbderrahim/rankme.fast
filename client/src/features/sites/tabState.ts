import {
  GOOGLE_SEARCH_VIEWS,
  isGoogleSearchView,
  useGoogleSearchView,
  type GoogleSearchView,
} from '@features/google';
import { useTabParam } from '@shared/hooks/useTabParam';

export const SITE_TABS = [
  'overview',
  'pages',
  'actions',
  'report',
  'client-reports',
  'keywords',
  'serp-features',
  'keyword-clusters',
  'research',
  'traffic',
  'backlinks',
  'competitors',
  'ai-visibility',
  'brand-radar',
  'apps',
  'local-seo',
  'reviews',
  'geogrid',
  'google',
  'content',
  'internal-links',
  'cannibalization',
  'audience-research',
  'schema',
] as const;
export type SiteTab = (typeof SITE_TABS)[number];
export const DEFAULT_SITE_TAB: SiteTab = 'overview';

export const SITE_TAB_LABEL_KEYS: Readonly<Record<SiteTab, string>> = {
  overview: 'sites:workspace.tabs.overview',
  pages: 'pages:workspaceTab',
  actions: 'sites:workspace.tabs.actions',
  report: 'sites:workspace.tabs.report',
  'client-reports': 'clientReports:dashboard.title',
  keywords: 'sites:workspace.tabs.keywords',
  'serp-features': 'sites:workspace.tabs.serpFeatures',
  'keyword-clusters': 'sites:workspace.tabs.keywordClusters',
  research: 'sites:workspace.tabs.research',
  traffic: 'competitorsTraffic:title',
  backlinks: 'sites:workspace.tabs.backlinks',
  competitors: 'sites:workspace.tabs.competitors',
  'ai-visibility': 'sites:workspace.tabs.aiVisibility',
  'brand-radar': 'sites:workspace.tabs.brandRadar',
  apps: 'sites:workspace.tabs.apps',
  'local-seo': 'sites:workspace.tabs.localSeo',
  reviews: 'sites:workspace.tabs.reviews',
  geogrid: 'sites:workspace.tabs.geogrid',
  google: 'sites:workspace.tabs.google',
  content: 'sites:workspace.tabs.content',
  'internal-links': 'sites:workspace.tabs.internalLinks',
  cannibalization: 'sites:workspace.tabs.cannibalization',
  'audience-research': 'sites:workspace.tabs.audienceResearch',
  schema: 'sites:workspace.tabs.schema',
};

export const SITE_TAB_GROUPS = [
  {
    id: 'audit-reports',
    labelKey: 'sites:workspace.groups.auditReports',
    tabs: ['actions', 'pages', 'report', 'client-reports'],
  },
  {
    id: 'search',
    labelKey: 'sites:workspace.groups.search',
    tabs: ['keywords', 'serp-features', 'keyword-clusters', 'research', 'google'],
  },
  {
    id: 'visibility',
    labelKey: 'sites:workspace.groups.visibility',
    tabs: ['traffic', 'backlinks', 'competitors', 'ai-visibility', 'brand-radar'],
  },
  {
    id: 'content',
    labelKey: 'sites:workspace.groups.content',
    tabs: ['content', 'internal-links', 'cannibalization', 'audience-research', 'schema'],
  },
  {
    id: 'local-apps',
    labelKey: 'sites:workspace.groups.localApps',
    tabs: ['local-seo', 'reviews', 'geogrid', 'apps'],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  labelKey: string;
  tabs: readonly SiteTab[];
}>;

export type SiteTabGroup = (typeof SITE_TAB_GROUPS)[number];
export type SiteTabGroupId = SiteTabGroup['id'];

export function getSiteTabLabelKey(tab: SiteTab): string {
  return SITE_TAB_LABEL_KEYS[tab];
}

export function getSiteTabGroup(tab: SiteTab): SiteTabGroup | undefined {
  return SITE_TAB_GROUPS.find((group) => (group.tabs as readonly SiteTab[]).includes(tab));
}

export function isSiteTab(value: unknown): value is SiteTab {
  return typeof value === 'string' && (SITE_TABS as readonly string[]).includes(value);
}

/**
 * `?tab=` state per `.claude/rules/url-tab-state.md` — default overview,
 * `replace: true` on switch, invalid values fall back to the default.
 */
export function useSiteTab(): [SiteTab, (tab: SiteTab) => void] {
  return useTabParam<SiteTab>(DEFAULT_SITE_TAB, SITE_TABS);
}

/**
 * `?view=` drill-in state for the Google tab — absent means the overview.
 * Delegates to the google feature's canonical hook (single implementation,
 * imported through its public API) so mechanics match `useTabParam`:
 * `replace: true` on writes, invalid values fall back to the default (null),
 * `?tab=google` is preserved, and `setView(null)` clears the param.
 */
export const SITE_SUB_VIEWS = GOOGLE_SEARCH_VIEWS;
export type SiteSubView = GoogleSearchView;
export const isSiteSubView = isGoogleSearchView;
export const useSiteSubView = useGoogleSearchView;

export const APP_SEO_VIEWS = [
  'profiles',
  'keywords',
  'listing',
  'charts',
  'research',
  'reviews',
  'compare',
] as const;
export type AppSeoView = (typeof APP_SEO_VIEWS)[number];
export const DEFAULT_APP_SEO_VIEW: AppSeoView = 'profiles';

export function isAppSeoView(value: unknown): value is AppSeoView {
  return typeof value === 'string' && (APP_SEO_VIEWS as readonly string[]).includes(value);
}

/** URL-backed drill-in state for the App SEO workspace panel. */
export function useAppSeoView(): [AppSeoView, (view: AppSeoView) => void] {
  return useTabParam<AppSeoView>(DEFAULT_APP_SEO_VIEW, APP_SEO_VIEWS, 'view');
}
