import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { Label } from '@shared/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { SITE_TAB_GROUPS, getSiteTabGroup, getSiteTabLabelKey, type SiteTab } from '../tabState';

interface SiteWorkspaceNavigationProps {
  activeTab: SiteTab;
  onTabChange: (tab: SiteTab) => void;
}

export const SiteWorkspaceNavigation = ({
  activeTab,
  onTabChange,
}: SiteWorkspaceNavigationProps) => {
  const { t, i18n } = useTranslation([
    'sites',
    'pages',
    'clientReports',
    'competitorsTraffic',
    'common',
  ]);
  const direction = i18n.dir();
  const activeGroup = getSiteTabGroup(activeTab);
  const labelFor = (tab: SiteTab): string => t(getSiteTabLabelKey(tab));

  const renderDestination = (tab: SiteTab) => {
    const active = activeTab === tab;
    return (
      <DropdownMenuItem
        key={tab}
        className="min-h-11"
        onSelect={() => onTabChange(tab)}
        aria-current={active ? 'page' : undefined}
        data-testid={`site-tab-${tab}`}
        data-state={active ? 'active' : 'inactive'}
      >
        <Check aria-hidden="true" className={active ? undefined : 'invisible'} />
        <span className="min-w-0 flex-1">{labelFor(tab)}</span>
      </DropdownMenuItem>
    );
  };

  const renderMobileDestination = (tab: SiteTab) => {
    return (
      <SelectItem
        key={tab}
        value={tab}
        className="min-h-11"
        aria-current={activeTab === tab ? 'page' : undefined}
        data-testid={`site-nav-mobile-item-${tab}`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 flex-1">{labelFor(tab)}</span>
        </span>
      </SelectItem>
    );
  };

  return (
    <nav aria-label={t('workspace.navigationLabel')} data-testid="site-navigation">
      <div className="flex flex-col gap-2 md:hidden">
        <Label htmlFor="site-workspace-destination">{t('workspace.navigationLabel')}</Label>
        <Select
          value={activeTab}
          onValueChange={(value) => onTabChange(value as SiteTab)}
          dir={direction}
        >
          <SelectTrigger
            id="site-workspace-destination"
            className="min-h-11 w-full"
            data-testid="site-nav-mobile"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectGroup>{renderMobileDestination('overview')}</SelectGroup>
            {SITE_TAB_GROUPS.map((group) => (
              <SelectGroup key={group.id}>
                <SelectSeparator />
                <SelectLabel>{t(group.labelKey)}</SelectLabel>
                {group.tabs.map(renderMobileDestination)}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        className="hidden grid-cols-3 gap-2 md:grid 2xl:grid-cols-6"
        data-testid="site-nav-desktop"
      >
        <Button
          type="button"
          variant={activeTab === 'overview' ? 'secondary' : 'outline'}
          className="min-h-11 h-auto w-full whitespace-normal"
          onClick={() => onTabChange('overview')}
          aria-current={activeTab === 'overview' ? 'page' : undefined}
          data-testid="site-tab-overview"
          data-state={activeTab === 'overview' ? 'active' : 'inactive'}
        >
          {labelFor('overview')}
        </Button>

        {SITE_TAB_GROUPS.map((group) => {
          const groupActive = activeGroup?.id === group.id;
          const activeLabel = groupActive ? labelFor(activeTab) : '';
          const triggerLabel = groupActive
            ? t('workspace.activeGroupLabel', {
                group: t(group.labelKey),
                current: activeLabel,
              })
            : t(group.labelKey);

          return (
            <DropdownMenu key={group.id} dir={direction}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant={groupActive ? 'secondary' : 'outline'}
                  className="min-h-11 h-auto w-full min-w-0 justify-between whitespace-normal px-3 py-2 text-start"
                  aria-label={triggerLabel}
                  data-testid={`site-nav-group-${group.id}`}
                  data-active={groupActive ? 'true' : undefined}
                >
                  <span className="min-w-0 flex-1">{triggerLabel}</span>
                  <ChevronDown aria-hidden="true" data-icon="inline-end" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
              >
                <DropdownMenuGroup>{group.tabs.map(renderDestination)}</DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </div>
    </nav>
  );
};
