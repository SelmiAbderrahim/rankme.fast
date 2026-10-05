import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { BRAND_NAME, BrandLogo } from '@shared/brand';
import { docsUrl } from '@shared/docs/docsUrl';
import { DEFAULT_LOCALE, isSupportedLocale } from '@shared/i18n';
import { LanguageSwitcher } from '@shared/i18n/LanguageSwitcher';
import { useAppSelector } from '@shared/hooks/redux';
import { APP_NAV_GROUPS, resolveActiveNavKey } from '@shared/navigation/appNav';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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

/**
 * App shell sidebar (SPEC-02) — logo block, grouped localized nav and a
 * brand-primary active row.
 */
export const AppSidebar = () => {
  const { t, i18n } = useTranslation(['common', 'alerts']);
  const { pathname, search } = useLocation();
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
  const resolvedGroups = APP_NAV_GROUPS.map((group) => ({
    labelKey: group.labelKey,
    rows: group.items
      .filter((item) => canOpenRoute(item.to, workspaceRole, isForeignWorkspace))
      .map((item) => ({
        key: item.to,
        href: item.to === '/docs' ? docsUrl('index', locale) : item.to,
        aliases: item.aliases,
        label: t(item.labelKey),
        icon: item.icon,
      })),
  })).filter((group) => group.rows.length > 0);

  // Exactly one row is active: the most specific match across every visible row.
  const activeKey = resolveActiveNavKey(
    resolvedGroups.flatMap((group) => group.rows),
    pathname,
    search,
  );
  const renderedGroups = resolvedGroups.map((group) => ({
    labelKey: group.labelKey,
    rows: group.rows.map((row) => ({ ...row, active: row.key === activeKey })),
  }));

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

      {isMobile ? (
        // The top-bar switcher only fits from `md` up; below that the drawer is
        // the one place a language can be chosen. Same shared component.
        <SidebarFooter>
          <LanguageSwitcher
            id="language-switcher-drawer"
            className="[&_select]:w-full"
            onLocaleChange={closeOnMobile}
          />
        </SidebarFooter>
      ) : null}
    </Sidebar>
  );
};
