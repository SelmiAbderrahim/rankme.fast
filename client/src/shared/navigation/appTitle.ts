import { resolveSiteTab, SITE_TAB_LABEL_KEYS } from '@features/sites';
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

const AUTH_TITLES: Readonly<Record<string, string>> = {
  '/login': 'auth:login.title',
  '/register': 'auth:register.title',
  '/forgot-password': 'auth:reset.title',
  '/reset-password': 'auth:reset.newPasswordTitle',
  '/verify-email': 'auth:verify.title',
  '/two-factor': 'auth:twoFactor.challenge.title',
  '/logout': 'nav.logout',
  '/team/change-password': 'auth:change.title',
  '/team/invitations': 'team:inbox.title',
};

// Site workspace sub-routes that are not `?tab=` panels, mapped to the tab
// whose label names them.
const SITE_SUBROUTE_TABS: Readonly<Record<string, keyof typeof SITE_TAB_LABEL_KEYS>> = {
  report: 'report',
  backlinks: 'backlinks',
  'content-briefs': 'content',
  'ai-visibility': 'ai-visibility',
  'local-seo': 'local-seo',
  competitors: 'competitors',
  traffic: 'traffic',
  'content-intelligence': 'content',
  audits: 'report',
  ranks: 'keywords',
  gsc: 'google',
  ga4: 'google',
  'audience-research': 'audience-research',
};

/**
 * Which page the URL shows. Account-level pages reuse the shared nav config
 * (`APP_NAV_GROUPS`) so a label added or renamed there is the tab title too;
 * site workspace pages reuse the site tab labels.
 */
export const resolveAppTitleTarget = (pathname: string, search: string): AppTitleTarget => {
  const parts = pathname.split('/').filter(Boolean);
  const authTitle = AUTH_TITLES[`/${parts.join('/')}`.toLowerCase()];
  if (authTitle) return { pageKey: authTitle, siteId: null };
  const teamAction = parts[1]?.toLowerCase();
  if (parts[0]?.toLowerCase() === 'team' && parts[2] && (teamAction === 'accept' || teamAction === 'reject')) {
    return { pageKey: `team:decision.${teamAction}.title`, siteId: null };
  }
  if (parts[0]?.toLowerCase() === 'sites' && parts[1]) {
    const siteId = parts[1];
    if (parts[2] === undefined) {
      const requested = new URLSearchParams(search).get('tab');
      const tab = resolveSiteTab(requested).tab;
      return { pageKey: SITE_TAB_LABEL_KEYS[tab], siteId };
    }
    const subroute = parts[2].toLowerCase();
    const tab = Object.hasOwn(SITE_SUBROUTE_TABS, subroute) ? SITE_SUBROUTE_TABS[subroute] : undefined;
    return { pageKey: tab ? SITE_TAB_LABEL_KEYS[tab] : null, siteId };
  }
  return { pageKey: resolveActiveNavKey(NAV_CANDIDATES, pathname.toLowerCase(), search), siteId: null };
};

/** `<Page> · <Site> · RankMeFast`; absent parts are dropped, never blank. */
export const formatAppTitle = (page: string | null, site: string | null): string =>
  [page, site, BRAND_NAME].filter(Boolean).join(' · ');
