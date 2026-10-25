import { Check, ChevronsUpDown, Plus, Settings2 } from 'lucide-react';
import { isolateText } from '@shared/lib/bidi';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthSession } from '@features/auth';
import { Bdi } from '@shared/components/Bdi';
import { NavTooltip } from '@shared/components/NavTooltip';
import { useAppSelector } from '@shared/hooks/redux';
import { selectSites } from '../../store/selectors';
import { cn } from '@shared/lib/utils';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@shared/ui/command';
import { NAV_LABEL_CLASS, NAV_RAIL_BUTTON_CLASS, NAV_ROW_CLASS } from '@shared/ui/nav-row';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Button } from '@shared/ui/button';
import { useAllSites } from '../../useAllSites';
import type { Site } from '../../types';
import { useSiteLookup } from '../../useSiteLookup';
import {
  SITE_NAV_NAMESPACES,
  activeTabFromLocation,
  readRecentSites,
  siteIdFromPath,
  siteLabel,
  siteSecondaryLine,
  switchSiteHref,
} from './shared';

/** Show a "Recent" section once the list is long enough to need one. */
const RECENT_THRESHOLD = 5;
const RECENT_SHOWN = 3;

/**
 * A letter avatar so every site is still told apart. The web CSP blocks
 * third-party images and a favicon fetch would reveal the user's site list to
 * each tracked origin, so no remote icon is requested.
 */
export const SiteFavicon = ({
  site,
  className,
}: {
  site: Pick<Site, 'displayName' | 'domain' | 'url'> | undefined;
  className?: string;
}) => {
  const letter = (site ? siteLabel(site) : '?')
    .replace(/^www\./i, '')
    .charAt(0)
    .toLocaleUpperCase();
  return (
    <span
      aria-hidden="true"
      data-site-avatar=""
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-sidebar-primary text-[0.625rem] leading-none font-semibold text-sidebar-primary-foreground',
        className,
      )}
    >
      {letter}
    </span>
  );
};

export type SiteSwitcherVariant = 'expanded' | 'rail' | 'bar';

/** Read the complete picker list only while its popover is mounted. */
const SiteSwitcherOptions = ({
  siteId,
  userKey,
  onChoose,
  onManage,
}: {
  siteId: string | null;
  userKey: string;
  onChoose: (site: Site) => void;
  onManage: () => void;
}) => {
  const { t } = useTranslation([...SITE_NAV_NAMESPACES]);
  const allSites = useAllSites();
  const sites = allSites.sites;
  const loaded = allSites.status === 'ready';
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase();
  const matches = sites.filter((site) =>
    `${siteLabel(site)} ${site.domain}`.toLocaleLowerCase().includes(needle),
  );
  const recent =
    !needle && sites.length > RECENT_THRESHOLD
      ? readRecentSites(userKey)
          .filter((id) => id !== siteId)
          .map((id) => sites.find((site) => site.id === id))
          .filter((site): site is Site => Boolean(site))
          .slice(0, RECENT_SHOWN)
      : [];

  const renderSite = (site: Site, prefix: string) => {
    const secondary = siteSecondaryLine(site);
    const isCurrent = site.id === siteId;
    return (
      <CommandItem
        key={`${prefix}${site.id}`}
        value={`${prefix}${site.id}`}
        onSelect={() => onChoose(site)}
      >
        <SiteFavicon site={site} />
        <span className="min-w-0 flex-1">
          <Bdi className="block truncate">{siteLabel(site)}</Bdi>
          {secondary ? (
            <Bdi className="block truncate text-xs text-muted-foreground">{secondary}</Bdi>
          ) : null}
        </span>
        {isCurrent ? (
          <>
            <Check aria-hidden="true" className="size-4 text-foreground" />
            <span className="sr-only">{t('sites:workspace.currentSite')}</span>
          </>
        ) : null}
      </CommandItem>
    );
  };

  return (
    <Command shouldFilter={false} label={t('sites:workspace.switchSite')} loop>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t('sites:workspace.filterSites')}
        aria-label={t('sites:workspace.filterSites')}
      />
      {/* 360px at most: the sites scroll, the actions below stay put. */}
      <CommandList className="max-h-none overflow-visible">
        <div
          className="max-h-60 overflow-y-auto overscroll-contain"
          data-testid="site-switcher-list"
        >
          {allSites.status === 'loading' ? (
            <p role="status" className="p-3 text-sm">
              {t('sites:picker.loading')}
            </p>
          ) : null}
          {allSites.status === 'error' ? (
            <div className="p-3">
              <p role="alert">{t('sites:picker.loadFailed')}</p>
              <Button variant="outline" onClick={allSites.retry}>
                {t('sites:retry')}
              </Button>
            </div>
          ) : null}
          {allSites.status === 'ready' && allSites.truncated ? (
            <p role="status" className="p-3 text-sm">
              {t('sites:picker.truncated', { shown: sites.length })}
            </p>
          ) : null}
          {matches.length === 0 && loaded ? (
            <p className="px-3 py-4 text-sm text-muted-foreground" role="status">
              {needle
                ? t('sites:workspace.noSitesMatch', { query: query.trim() })
                : t('sites:workspace.noSites')}
            </p>
          ) : null}
          {recent.length > 0 ? (
            <CommandGroup heading={t('sites:workspace.recentSites')}>
              {recent.map((site) => renderSite(site, 'recent:'))}
            </CommandGroup>
          ) : null}
          {matches.length > 0 ? (
            <CommandGroup heading={recent.length > 0 ? t('sites:workspace.allSites') : undefined}>
              {matches.map((site) => renderSite(site, 'site:'))}
            </CommandGroup>
          ) : null}
        </div>
        <CommandSeparator />
        <CommandGroup>
          <CommandItem value="action:add" onSelect={onManage}>
            <Plus aria-hidden="true" />
            {t('sites:workspace.addSite')}
          </CommandItem>
          <CommandItem value="action:manage" onSelect={onManage}>
            <Settings2 aria-hidden="true" />
            {t('sites:workspace.manageSites')}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
};

/**
 * The one site switcher: the expanded site sidebar, its rail, and the phone
 * site bar all render this component. Switching keeps the current page.
 */
export const SiteSwitcher = ({ variant = 'expanded' }: { variant?: SiteSwitcherVariant }) => {
  const { t, i18n } = useTranslation([...SITE_NAV_NAMESPACES]);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuthSession();
  const [open, setOpen] = useState(false);
  const siteId = siteIdFromPath(pathname);
  const listed = useAppSelector(selectSites).find((site) => site.id === siteId);
  // A site missing from the loaded list (a later page, or a route that never
  // loads the list) is read directly (shared request), so the label settles
  // instead of staying on "Loading site…".
  const lookup = useSiteLookup(siteId ?? '', !listed);
  const current = listed ?? lookup.site ?? undefined;
  const currentLabel = current
    ? siteLabel(current)
    : lookup.status === 'notFound' || lookup.status === 'error'
      ? t('sites:workspace.unknownSite')
      : t('sites:workspace.loadingSite');
  const userKey = user?.id ?? user?.email ?? 'anonymous';
  const rtl = i18n.dir() === 'rtl';

  const go = (target: Site) => {
    setOpen(false);
    if (target.id !== siteId)
      navigate(switchSiteHref(target.id, activeTabFromLocation(pathname, search), search));
  };

  const manage = () => {
    setOpen(false);
    navigate('/sites');
  };

  const triggerLabel = t('sites:workspace.switchSiteNamed', { site: isolateText(currentLabel) });
  const trigger =
    variant === 'rail' ? (
      <button
        type="button"
        className={cn(NAV_ROW_CLASS, NAV_RAIL_BUTTON_CLASS)}
        aria-label={triggerLabel}
        data-testid="site-switcher"
      >
        <SiteFavicon site={current} />
      </button>
    ) : (
      <button
        type="button"
        className={cn(
          NAV_ROW_CLASS,
          'text-sidebar-foreground',
          variant === 'bar' ? 'h-11 border border-input bg-background' : 'min-w-0 flex-1',
        )}
        aria-label={triggerLabel}
        data-testid="site-switcher"
      >
        <SiteFavicon site={current} />
        <span data-nav-label="" className={cn(NAV_LABEL_CLASS, 'font-medium')}>
          <Bdi>{currentLabel}</Bdi>
        </span>
        <ChevronsUpDown aria-hidden="true" />
      </button>
    );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <NavTooltip
          label={variant === 'rail' ? triggerLabel : currentLabel}
          when={open ? 'never' : variant === 'rail' ? 'always' : 'truncated'}
        >
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        </NavTooltip>
        <PopoverContent
          align="start"
          side={variant === 'rail' ? (rtl ? 'left' : 'right') : 'bottom'}
          sideOffset={variant === 'rail' ? 8 : 4}
          collisionPadding={8}
          className="w-[min(20rem,calc(100vw-1rem))] min-w-[17.5rem] p-0"
          data-testid="site-switcher-popover"
        >
          <SiteSwitcherOptions siteId={siteId} userKey={userKey} onChoose={go} onManage={manage} />
        </PopoverContent>
      </Popover>
    </>
  );
};
