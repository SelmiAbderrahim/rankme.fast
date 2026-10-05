import type { LucideIcon } from 'lucide-react';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';

export interface AppNavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
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
      },
      {
        to: '/settings/security',
        labelKey: 'nav.security',
        icon: APP_PAGE_ICONS.security,
      },
    ],
  },
];
