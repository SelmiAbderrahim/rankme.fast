import { ChevronDown, Search, type LucideIcon } from 'lucide-react';
import { isolateText } from '@shared/lib/bidi';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { Bdi } from '@shared/components/Bdi';
import { useMediaQuery } from '@shared/hooks/useMediaQuery';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { NAV_GROUP_LABEL_CLASS, NAV_LABEL_CLASS, NAV_ROW_CLASS } from '@shared/ui/nav-row';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@shared/ui/sheet';
import {
  SITE_NAV_GROUPS,
  SITE_NAV_ITEMS,
  getSiteNavGroupItems,
  getSiteNavItem,
  siteTabHref,
} from '../../siteNavigation';
import { SITE_NAV_NAMESPACES, activeTabFromLocation } from './shared';
import { SiteSwitcher } from './SiteSwitcher';
import { useSiteNavigation } from './context';

/**
 * Phones (<768px): a sticky site bar (switcher + current page) with the
 * section's sibling pages as chips, and a "Choose a page" bottom sheet.
 */
export const SiteMobileBar = () => {
  const { t } = useTranslation([...SITE_NAV_NAMESPACES]);
  const { pathname, search, hash, state } = useLocation();
  const { siteId } = useSiteNavigation();
  const [open, setOpen] = useState(false);
  const mobile = useMediaQuery('(max-width: 767.98px)');
  useEffect(() => setOpen(false), [mobile, pathname, search]);
  const [filter, setFilter] = useState('');
  const activeTab = activeTabFromLocation(pathname, search);
  const activeItem = getSiteNavItem(activeTab);
  const siblings = activeItem.group ? getSiteNavGroupItems(activeItem.group) : [];
  const activeChipRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeChipRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [activeTab]);
  useEffect(() => {
    if (!open) setFilter('');
  }, [open]);

  const needle = filter.trim().toLocaleLowerCase();
  const visible = (labelKey: string) => !needle || t(labelKey).toLocaleLowerCase().includes(needle);
  const overview = SITE_NAV_ITEMS[0]!;
  const row = (item: (typeof SITE_NAV_ITEMS)[number]) => {
    const ItemIcon = item.icon as LucideIcon;
    return (
      <li key={item.id}>
        <Link
          replace
          state={state}
          to={siteTabHref(siteId ?? '', item.id, search, hash)}
          onClick={() => setOpen(false)}
          aria-current={activeTab === item.id ? 'page' : undefined}
          className={cn(NAV_ROW_CLASS, 'h-11')}
        >
          <ItemIcon aria-hidden="true" />
          <span className={NAV_LABEL_CLASS}>
            <Bdi>{t(item.labelKey)}</Bdi>
          </span>
        </Link>
      </li>
    );
  };
  const groups = SITE_NAV_GROUPS.map((group) => ({
    ...group,
    items: getSiteNavGroupItems(group.id).filter((item) => visible(item.labelKey)),
  })).filter((group) => group.items.length > 0);
  const nothing = !visible(overview.labelKey) && groups.length === 0;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div
        className="sticky top-14 z-30 border-b bg-background px-3 py-2 md:hidden"
        data-testid="site-mobile-bar"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-1">
            <SiteSwitcher variant="bar" />
          </div>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              className="min-h-11 min-w-0 max-w-[48%] justify-between gap-2"
              aria-haspopup="dialog"
              aria-expanded={open}
              data-testid="site-page-picker"
            >
              <span className="truncate">
                <Bdi>{t(activeItem.labelKey)}</Bdi>
              </span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
            </Button>
          </SheetTrigger>
        </div>
        {siblings.length > 0 ? (
          <div
            className="no-scrollbar mt-2 flex min-w-0 gap-2 overflow-x-auto pb-0.5"
            aria-label={t('sites:workspace.siblingPages')}
            role="group"
          >
            {siblings.map((item) => (
              <Link
                replace
                state={state}
                ref={item.id === activeTab ? activeChipRef : undefined}
                key={item.id}
                // Chips exist only for a grouped tab, i.e. on a site route.
                to={siteTabHref(siteId!, item.id, search, hash)}
                aria-current={item.id === activeTab ? 'page' : undefined}
                className="flex min-h-11 cursor-pointer hover:bg-accent active:bg-accent shrink-0 items-center rounded-md border border-input px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
      <SheetContent
        side="bottom"
        className="max-h-[85svh] rounded-t-lg p-0 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <SheetHeader className="border-b px-4 pt-4 pb-3">
          <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-border" aria-hidden="true" />
          <SheetTitle>{t('sites:workspace.choosePage')}</SheetTitle>
          <SheetDescription>{t('sites:workspace.choosePageDescription')}</SheetDescription>
        </SheetHeader>
        <div className="relative m-4">
          <Search
            aria-hidden="true"
            className="absolute start-3 top-3 size-4 text-muted-foreground"
          />
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('sites:workspace.filterPages')}
            aria-label={t('sites:workspace.filterPages')}
            className="h-10 w-full rounded-md border border-input bg-background ps-9 pe-3 text-sm outline-hidden placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <nav
          className="max-h-[58svh] space-y-3 overflow-y-auto px-4 pb-4"
          aria-label={t('sites:workspace.navLandmark')}
        >
          {visible(overview.labelKey) ? <ul>{row(overview)}</ul> : null}
          {groups.map((group) => (
            <div key={group.id}>
              <p className={cn(NAV_GROUP_LABEL_CLASS, 'mb-1 px-2.5')}>{t(group.labelKey)}</p>
              <ul className="flex flex-col gap-0.5">{group.items.map(row)}</ul>
            </div>
          ))}
          {nothing ? (
            <p className="px-2.5 py-4 text-sm text-muted-foreground" role="status">
              {t('sites:workspace.noPagesMatch', { query: isolateText(filter.trim()) })}
            </p>
          ) : null}
        </nav>
      </SheetContent>
    </Sheet>
  );
};
