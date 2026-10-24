import {
  GOOGLE_SEARCH_VIEWS,
  isGoogleSearchView,
  useGoogleSearchView,
  type GoogleSearchView,
} from '@features/google';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTabParam } from '@shared/hooks/useTabParam';

import { SITE_TABS, SITE_TAB_LABEL_KEYS, SITE_TAB_GROUPS, type SiteTab } from './siteNavigation';
export { SITE_TABS, SITE_TAB_LABEL_KEYS, SITE_TAB_GROUPS } from './siteNavigation';
export type { SiteTab } from './siteNavigation';
export const DEFAULT_SITE_TAB: SiteTab = 'overview';

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
 * Plausible legacy or long-form `?tab=` slugs (docs, emails, bookmarks from the
 * old top-level routes) mapped to the canonical workspace tab. Lookups are
 * case-insensitive and tolerate `_` or spaces in place of `-`.
 */
export const SITE_TAB_ALIASES: Readonly<Record<string, SiteTab>> = {
  home: 'overview',
  dashboard: 'overview',
  'next-actions': 'actions',
  'fix-now': 'actions',
  audit: 'report',
  audits: 'report',
  'audit-report': 'report',
  'site-audit': 'report',
  'white-label': 'client-reports',
  'white-label-reports': 'client-reports',
  'client-report': 'client-reports',
  ranks: 'keywords',
  rankings: 'keywords',
  'rank-tracking': 'keywords',
  'tracked-keywords': 'keywords',
  serp: 'serp-features',
  'serp-feature': 'serp-features',
  clusters: 'keyword-clusters',
  'keyword-clustering': 'keyword-clusters',
  'keyword-research': 'research',
  'traffic-insights': 'traffic',
  'link-intelligence': 'backlinks',
  links: 'backlinks',
  competitor: 'competitors',
  'ai-mentions': 'ai-visibility',
  'ai-overviews': 'ai-visibility',
  'brand-mentions': 'brand-radar',
  'app-seo': 'apps',
  aso: 'apps',
  local: 'local-seo',
  'review-intelligence': 'reviews',
  'geo-grid': 'geogrid',
  gsc: 'google',
  'search-console': 'google',
  'google-search-console': 'google',
  'content-intelligence': 'content',
  'internal-linking': 'internal-links',
  'keyword-cannibalization': 'cannibalization',
  audience: 'audience-research',
  'schema-generator': 'schema',
  'schema-markup': 'schema',
};

export type SiteTabResolution =
  | { kind: 'absent' | 'valid'; tab: SiteTab }
  | { kind: 'alias' | 'unknown'; tab: SiteTab; requested: string };

/** Resolve a raw `?tab=` value to a workspace tab (pure; see `useSiteTab`). */
export function resolveSiteTab(value: string | null): SiteTabResolution {
  if (value === null || value.trim() === '') return { kind: 'absent', tab: DEFAULT_SITE_TAB };
  if (isSiteTab(value)) return { kind: 'valid', tab: value };
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (isSiteTab(normalized)) return { kind: 'alias', tab: normalized, requested: value };
  const alias = Object.hasOwn(SITE_TAB_ALIASES, normalized) ? SITE_TAB_ALIASES[normalized] : undefined;
  if (alias) return { kind: 'alias', tab: alias, requested: value };
  return { kind: 'unknown', tab: DEFAULT_SITE_TAB, requested: value };
}

/**
 * `?tab=` state per `.claude/rules/url-tab-state.md` — default overview,
 * `replace: true` on switch. Legacy/long slugs resolve to their canonical tab
 * and the URL is rewritten in place; a truly unknown value falls back to the
 * default and is returned as the third tuple member so the workspace can say
 * so instead of silently showing Overview (GitHub issue #21). The unknown
 * value is cleared as soon as the user picks a tab.
 */
export function useSiteTab(): [SiteTab, (tab: SiteTab) => void, string | null] {
  const location = useLocation();
  const navigate = useNavigate();
  const [unknownTab, setUnknownTab] = useState<string | null>(null);
  const rewritingUnknown = useRef(false);
  const resolution = resolveSiteTab(new URLSearchParams(location.search).get('tab'));

  const writeTab = useCallback(
    (next: SiteTab) => {
      const params = new URLSearchParams(location.search);
      params.set('tab', next);
      navigate(
        { pathname: location.pathname, search: params.toString(), hash: location.hash },
        { replace: true, state: location.state },
      );
    },
    [location.hash, location.pathname, location.search, location.state, navigate],
  );

  const needsRewrite = resolution.kind === 'alias' || resolution.kind === 'unknown';
  const requested = needsRewrite ? resolution.requested : null;
  useEffect(() => {
    if (needsRewrite) {
      rewritingUnknown.current = resolution.kind === 'unknown';
      setUnknownTab(resolution.kind === 'unknown' ? requested : null);
      writeTab(resolution.tab);
      return;
    }
    // Any other way of landing on a real section (a link, back/forward)
    // retires the "that section doesn't exist" notice.
    if (rewritingUnknown.current) rewritingUnknown.current = false;
    else setUnknownTab(null);
  }, [location.key, needsRewrite, requested, resolution.kind, resolution.tab, writeTab]);

  const setTab = useCallback(
    (next: SiteTab) => {
      setUnknownTab(null);
      writeTab(next);
    },
    [writeTab],
  );

  return [resolution.tab, setTab, unknownTab];
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
