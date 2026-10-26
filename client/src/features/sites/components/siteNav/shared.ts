import { DEFAULT_SITE_TAB, resolveSiteTab, type SiteTab } from '../../tabState';

/** Every namespace a site-navigation label can come from. */
export const SITE_NAV_NAMESPACES = [
  'sites',
  'pages',
  'clientReports',
  'competitorsTraffic',
  'competitors',
  'aiVisibility',
  'brandRadar',
  'appSeo',
  'geogrid',
  'internalLinks',
  'cannibalization',
  'schemaGenerator',
  'common',
] as const;

/** The site sidebar's DOM id, the target of every toggle's `aria-controls`. */
export const SITE_SIDEBAR_ID = 'site-sidebar';
export const SITE_SIDEBAR_COOKIE = 'site_sidebar_state';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const SITE_GROUPS_KEY = 'rankmefast.site-groups';
const RECENT_SITES_KEY = 'rankmefast.recent-sites';
const RECENT_SITES_MAX = 5;

const SITE_PATH = /^\/sites\/([^/?#]+)/;

export const siteIdFromPath = (pathname: string): string | null =>
  SITE_PATH.exec(pathname)?.[1] ?? null;

const STANDALONE_TABS: Readonly<Record<string, SiteTab>> = {
  report: 'report',
  backlinks: 'backlinks',
  competitors: 'competitors',
  'local-seo': 'local-seo',
  'ai-visibility': 'ai-visibility',
};

export const activeTabFromLocation = (pathname: string, search: string): SiteTab => {
  const siteId = siteIdFromPath(pathname);
  if (!siteId) return DEFAULT_SITE_TAB;
  const standalone = pathname.split('/').filter(Boolean)[2];
  if (standalone && STANDALONE_TABS[standalone]) return STANDALONE_TABS[standalone];
  return resolveSiteTab(new URLSearchParams(search).get('tab')).tab;
};

export { siteLabel } from '@shared/lib/siteLabel';
import { siteLabel } from '@shared/lib/siteLabel';

/** The domain is worth a second line only when the name says something else. */
export const siteSecondaryLine = (site: { displayName: string; domain: string }): string | null => {
  const label = siteLabel(site).toLocaleLowerCase();
  const domain = site.domain.toLocaleLowerCase();
  return label === domain || label === `www.${domain}` || `www.${label}` === domain
    ? null
    : site.domain;
};

/** `true` = expanded, `false` = rail, `null` = never chosen. */
export const readSiteSidebarCookie = (): boolean | null => {
  const entry = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith(`${SITE_SIDEBAR_COOKIE}=`));
  const value = entry?.slice(SITE_SIDEBAR_COOKIE.length + 1);
  return value === 'true' ? true : value === 'false' ? false : null;
};

export const writeSiteSidebarCookie = (expanded: boolean): void => {
  document.cookie = `${SITE_SIDEBAR_COOKIE}=${expanded}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
};

const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing and locked-down webviews can reject localStorage.
  }
};

export type SiteGroupState = Partial<Record<string, boolean>>;

export const readSiteGroups = (userKey: string): SiteGroupState => {
  const value = readJson<unknown>(`${SITE_GROUPS_KEY}.${userKey}`, {});
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as SiteGroupState)
    : {};
};

export const writeSiteGroups = (userKey: string, state: SiteGroupState): void =>
  writeJson(`${SITE_GROUPS_KEY}.${userKey}`, state);

export const readRecentSites = (userKey: string): string[] => {
  const value = readJson<unknown>(`${RECENT_SITES_KEY}.${userKey}`, []);
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
};

export const rememberRecentSite = (userKey: string, siteId: string): void => {
  const next = [siteId, ...readRecentSites(userKey).filter((id) => id !== siteId)].slice(
    0,
    RECENT_SITES_MAX,
  );
  writeJson(`${RECENT_SITES_KEY}.${userKey}`, next);
};

/**
 * Where a site switch lands: the same page in the other site. Only the tab
 * and its sub-view travel; ids that belong to the old site (runs, filters)
 * stay behind.
 */
export const switchSiteHref = (siteId: string, tab: SiteTab, currentSearch: string): string => {
  const current = new URLSearchParams(currentSearch);
  const next = new URLSearchParams();
  if (tab !== DEFAULT_SITE_TAB) next.set('tab', tab);
  const view = current.get('view');
  if (view && tab !== DEFAULT_SITE_TAB) next.set('view', view);
  const query = next.toString();
  return `/sites/${encodeURIComponent(siteId)}${query ? `?${query}` : ''}`;
};

/** Split a label around the first case-insensitive match of `query`. */
export const splitMatch = (
  label: string,
  query: string,
): { before: string; match: string; after: string } | null => {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return null;
  const haystack = label.toLocaleLowerCase();
  const index = haystack.indexOf(needle);
  // Case mapping can change length (e.g. "İ"); then indexes no longer line up.
  if (index < 0 || haystack.length !== label.length) return null;
  return {
    before: label.slice(0, index),
    match: label.slice(index, index + needle.length),
    after: label.slice(index + needle.length),
  };
};
