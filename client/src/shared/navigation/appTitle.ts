import { DEFAULT_SITE_TAB, isSiteTab, SITE_TAB_LABEL_KEYS } from '@features/sites';
import { BRAND_NAME } from '@shared/brand';
import { APP_NAV_GROUPS, resolveActiveNavKey } from '@shared/navigation/appNav';

export interface AppTitleTarget {
  /** i18n key of the page name, or `null` when the route has no nav label. */
  pageKey: string | null;
  /** Site workspace the page belongs to, so the title can name it. */
  siteId: string | null;
}

const NAV_CANDIDATES = APP_NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => ({
    key: item.labelKey,
    href: item.to,
    aliases: item.aliases,
  })),
);

// Site workspace sub-routes that are not `?tab=` panels, mapped to the tab
// whose label names them.
const SITE_SUBROUTE_TABS: Readonly<Record<string, keyof typeof SITE_TAB_LABEL_KEYS>> = {
  report: 'report',
  backlinks: 'backlinks',
  'content-briefs': 'content',
};

/**
 * Which page the URL shows. Account-level pages reuse the shared nav config
 * (`APP_NAV_GROUPS`) so a label added or renamed there is the tab title too;
 * site workspace pages reuse the site tab labels.
 */
export const resolveAppTitleTarget = (pathname: string, search: string): AppTitleTarget => {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'sites' && parts[1]) {
    const siteId = parts[1];
    if (parts[2] === undefined) {
      const requested = new URLSearchParams(search).get('tab');
      const tab = isSiteTab(requested) ? requested : DEFAULT_SITE_TAB;
      return { pageKey: SITE_TAB_LABEL_KEYS[tab], siteId };
    }
    const tab = SITE_SUBROUTE_TABS[parts[2]];
    return { pageKey: tab ? SITE_TAB_LABEL_KEYS[tab] : null, siteId };
  }
  return { pageKey: resolveActiveNavKey(NAV_CANDIDATES, pathname, search), siteId: null };
};

/** `<Page> · <Site> · RankMeFast`; absent parts are dropped, never blank. */
export const formatAppTitle = (page: string | null, site: string | null): string =>
  [page, site, BRAND_NAME].filter(Boolean).join(' · ');
