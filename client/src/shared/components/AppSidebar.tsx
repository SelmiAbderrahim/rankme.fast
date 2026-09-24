import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { BRAND_NAME, BrandLogo } from '@shared/brand';
import { docsUrl } from '@shared/docs/docsUrl';
import { DEFAULT_LOCALE, isSupportedLocale } from '@shared/i18n';
import { useAppSelector } from '@shared/hooks/redux';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@shared/ui/sidebar';
import {
  canOpenRoute,
  selectActiveWorkspaceRole,
  selectIsForeignWorkspace,
} from '@features/workspace';
import { ReleaseStageBadge } from './ReleaseStageBadge';

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
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
      { to: '/settings/security', labelKey: 'nav.security', icon: APP_PAGE_ICONS.security },
    ],
  },
];

const isActivePath = (pathname: string, to: string) =>
  pathname === to || pathname.startsWith(`${to}/`);

/**
 * App shell sidebar (SPEC-02) — logo block, grouped localized nav and a
 * brand-primary active row.
 */
export const AppSidebar = () => {
  const { t, i18n } = useTranslation(['common', 'alerts']);
  const { pathname } = useLocation();
  const { setOpenMobile, isMobile } = useSidebar();
  const side = i18n.dir() === 'rtl' ? 'right' : 'left';
  const workspaceRole = useAppSelector(selectActiveWorkspaceRole);
  const isForeignWorkspace = useAppSelector(selectIsForeignWorkspace);
  const locale = isSupportedLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;

  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  // Inside a foreign workspace, hide what the server would 404 anyway — one
  // shared policy map, never a per-page fork.
  const renderedGroups = NAV_GROUPS.map((group) => ({
    labelKey: group.labelKey,
    rows: group.items
      .filter((item) => canOpenRoute(item.to, workspaceRole, isForeignWorkspace))
      .map((item) => {
        const href = item.to === '/docs' ? docsUrl('index', locale) : item.to;
        return {
          key: item.to,
          href,
          label: t(item.labelKey),
          icon: item.icon,
          active: isActivePath(pathname, href),
        };
      }),
  })).filter((group) => group.rows.length > 0);

  return (
    <Sidebar side={side} variant="inset" collapsible="icon">
      <SidebarHeader className="flex-row items-center gap-2">
        <Link
          to="/dashboard"
          className="flex min-w-0 items-center px-2 py-1.5"
          aria-label={BRAND_NAME}
          onClick={closeOnMobile}
        >
          <BrandLogo textClassName="group-data-[collapsible=icon]:hidden" />
        </Link>
        <ReleaseStageBadge className="group-data-[collapsible=icon]:hidden" />
      </SidebarHeader>

      <SidebarContent>
        {renderedGroups.map((group) => (
          <SidebarGroup key={group.labelKey}>
            <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.rows.map((row) => {
                  const Icon = row.icon;
                  return (
                    <SidebarMenuItem key={row.key}>
                      <SidebarMenuButton
                        asChild
                        isActive={row.active}
                        tooltip={row.label}
                        className="data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:hover:bg-primary/90 data-[active=true]:hover:text-primary-foreground"
                      >
                        <Link
                          to={row.href}
                          aria-current={row.active ? 'page' : undefined}
                          onClick={closeOnMobile}
                        >
                          <Icon />
                          <span>{row.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
};
