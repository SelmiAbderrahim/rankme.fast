import type { LucideIcon } from 'lucide-react';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';

export interface AppNavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /**
   * Other URLs (`/path` or `/path?tab=x`) that show the same screen. They
   * light this item up too, so a screen reachable through two URLs never
   * leaves the sidebar pointing somewhere else.
   */
  aliases?: readonly string[];
}

export interface AppNavGroup {
  labelKey: string;
  items: readonly AppNavItem[];
}

/**
 * The single list of account-level app destinations. The sidebar renders it
 * and the topbar search is generated from it, so a page added here shows up
 * in both and the two can never drift apart.
 */
export const APP_NAV_GROUPS: readonly AppNavGroup[] = [
  {
    labelKey: 'shell.groupOverview',
    items: [
      { to: '/dashboard', labelKey: 'nav.dashboard', icon: APP_PAGE_ICONS.dashboard },
      { to: '/assistant', labelKey: 'nav.assistant', icon: APP_PAGE_ICONS.assistant },
    ],
  },
  {
    labelKey: 'shell.groupTools',
    items: [
      { to: '/sites', labelKey: 'nav.sites', icon: APP_PAGE_ICONS.sites },
      {
        to: '/keyword-research',
        labelKey: 'nav.keywordResearch',
        icon: APP_PAGE_ICONS.keywordResearch,
      },
      // Brand Radar, Keyword Clusters, Cannibalization, and Internal Links
      // are site-scoped tools and live in the site workspace as `?tab=`
      // panels — they are deliberately not
      // account-level sidebar destinations.
      { to: '/dashboard/alerts', labelKey: 'alerts:title', icon: APP_PAGE_ICONS.alerts },
      { to: '/docs', labelKey: 'nav.docs', icon: APP_PAGE_ICONS.docs },
      { to: '/exports', labelKey: 'nav.exports', icon: APP_PAGE_ICONS.exports },
    ],
  },
  {
    labelKey: 'shell.groupAccount',
    items: [
      { to: '/profile', labelKey: 'shell.profile', icon: APP_PAGE_ICONS.profile },
      { to: '/settings/team', labelKey: 'nav.team', icon: APP_PAGE_ICONS.team },
      {
        to: '/settings/notifications',
        labelKey: 'nav.notifications',
        icon: APP_PAGE_ICONS.notifications,
        aliases: ['/profile?tab=notifications'],
      },
      {
        to: '/settings/security',
        labelKey: 'nav.security',
        icon: APP_PAGE_ICONS.security,
        aliases: ['/profile?tab=security'],
      },
    ],
  },
];

const startsWithPath = (pathname: string, base: string): boolean =>
  pathname === base || pathname.startsWith(`${base}/`);

// An alias that pins a query value (`?tab=security`) is more specific than any
// path match, so it outranks every path length.
const ALIAS_SCORE = 10_000;

const scoreTarget = (target: string, pathname: string, params: URLSearchParams): number => {
  const [path = '', query = ''] = target.split('?');
  if (!startsWithPath(pathname, path)) return 0;
  if (!query) return path.length;
  const wanted = new URLSearchParams(query);
  for (const [key, value] of wanted) {
    if (params.get(key) !== value) return 0;
  }
  return ALIAS_SCORE + path.length;
};

export interface ActiveNavCandidate {
  key: string;
  href: string;
  aliases?: readonly string[];
}

/**
 * Exactly one active destination for the current URL: the candidate with the
 * most specific match wins (longest path prefix, or a query-pinned alias), so
 * `/dashboard/alerts` lights Alerts only and `/profile?tab=security` lights
 * Security instead of Profile. Returns `null` when nothing matches.
 */
export const resolveActiveNavKey = (
  candidates: readonly ActiveNavCandidate[],
  pathname: string,
  search: string,
): string | null => {
  const params = new URLSearchParams(search);
  let bestKey: string | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = Math.max(
      ...[candidate.href, ...(candidate.aliases ?? [])].map((target) =>
        scoreTarget(target, pathname, params),
      ),
    );
    if (score > bestScore) {
      bestScore = score;
      bestKey = candidate.key;
    }
  }
  return bestKey;
};
