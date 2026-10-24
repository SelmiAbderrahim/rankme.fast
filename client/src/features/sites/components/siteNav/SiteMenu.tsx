import { ChevronDown, ChevronsLeft, ChevronsRight, Search, X, type LucideIcon } from 'lucide-react';
import { isolateText } from '@shared/lib/bidi';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthSession } from '@features/auth';
import { Bdi } from '@shared/components/Bdi';
import { NavTooltip } from '@shared/components/NavTooltip';
import { useScrollFades } from '@shared/hooks/useScrollFades';
import { isPlainKey, isTypingTarget } from '@shared/lib/keyboard';
import { cn } from '@shared/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import {
  NAV_GROUP_LABEL_CLASS,
  NAV_ICON_BUTTON_CLASS,
  NAV_LABEL_CLASS,
  NAV_RAIL_BUTTON_CLASS,
  NAV_ROW_CLASS,
} from '@shared/ui/nav-row';
import { getSiteTabGroup, type SiteTab } from '../../tabState';
import {
  SITE_NAV_GROUPS,
  SITE_NAV_ITEMS,
  getSiteNavGroupItems,
  siteTabHref,
  type SiteNavGroupId,
  type SiteNavItem,
} from '../../siteNavigation';
import {
  SITE_NAV_NAMESPACES,
  SITE_SIDEBAR_ID,
  activeTabFromLocation,
  readSiteGroups,
  splitMatch,
  writeSiteGroups,
  type SiteGroupState,
} from './shared';
import { SiteSwitcher } from './SiteSwitcher';
import { useSiteNavigation } from './context';

const HOVER_DELAY_MS = 150;
const MOBILE_QUERY = '(max-width: 767.98px)';

const itemsOf = (group: SiteNavGroupId): SiteNavItem[] => getSiteNavGroupItems(group);

/** The label with the filter match marked. */
const Highlighted = ({ label, query }: { label: string; query: string }) => {
  const parts = splitMatch(label, query);
  if (!parts) return <Bdi>{label}</Bdi>;
  return (
    <Bdi>
      {parts.before}
      <mark className="rounded-sm bg-sidebar-primary/15 font-semibold text-sidebar-foreground">
        {parts.match}
      </mark>
      {parts.after}
    </Bdi>
  );
};

/** The collapse/expand control of the site sidebar (`[`). */
const SiteSidebarToggle = () => {
  const { t } = useTranslation('sites');
  const { siteMenuExpanded, toggleSiteMenu } = useSiteNavigation();
  const label = siteMenuExpanded ? t('workspace.collapseSiteMenu') : t('workspace.expandSiteMenu');
  const Icon = siteMenuExpanded ? ChevronsLeft : ChevronsRight;
  return (
    <NavTooltip label={label} shortcut="[">
      <button
        type="button"
        className={NAV_ICON_BUTTON_CLASS}
        aria-label={label}
        aria-expanded={siteMenuExpanded}
        aria-controls={SITE_SIDEBAR_ID}
        onClick={(event) => toggleSiteMenu(event.currentTarget)}
        data-site-sidebar-toggle=""
        data-testid="site-sidebar-toggle"
      >
        <Icon aria-hidden="true" className="rtl:-scale-x-100" />
      </button>
    </NavTooltip>
  );
};

/**
 * One group in the rail: an icon button that opens a portaled flyout on
 * hover (with a short open/close delay so the pointer can travel into it),
 * click, Enter, Space or the inline-end arrow key.
 */
const RailGroup = ({
  group,
  labelKey,
  activeTab,
}: {
  group: SiteNavGroupId;
  labelKey: string;
  activeTab: SiteTab;
}) => {
  const { t, i18n } = useTranslation([...SITE_NAV_NAMESPACES]);
  const { siteId } = useSiteNavigation();
  const { search, hash, state } = useLocation();
  const [open, setOpen] = useState(false);
  const hoverOpened = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const items = itemsOf(group);
  const label = t(labelKey);
  const rtl = i18n.dir() === 'rtl';
  const containsActive = items.some((item) => item.id === activeTab);
  const GroupIcon = items[0]!.icon as LucideIcon;

  const clear = () => window.clearTimeout(timer.current);
  useEffect(() => clear, []);
  const hoverIn = (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    clear();
    if (open) return;
    timer.current = window.setTimeout(() => {
      hoverOpened.current = true;
      setOpen(true);
    }, HOVER_DELAY_MS);
  };
  const hoverOut = (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    clear();
    if (!hoverOpened.current) return;
    timer.current = window.setTimeout(() => {
      hoverOpened.current = false;
      setOpen(false);
    }, HOVER_DELAY_MS);
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        clear();
        hoverOpened.current = false;
        setOpen(next);
      }}
    >
      <NavTooltip label={label} when={open ? 'never' : 'always'}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(NAV_ROW_CLASS, NAV_RAIL_BUTTON_CLASS)}
            aria-label={label}
            data-active={containsActive ? 'true' : undefined}
            data-site-rail-group={group}
            onPointerEnter={hoverIn}
            onPointerLeave={hoverOut}
            onPointerDown={(event) => {
              // A click on a flyout the pointer already opened pins it open.
              if (open && hoverOpened.current) {
                event.preventDefault();
                hoverOpened.current = false;
              }
            }}
            onKeyDown={(event) => {
              if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) {
                event.preventDefault();
                setOpen(true);
              }
            }}
          >
            <GroupIcon aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
      </NavTooltip>
      <DropdownMenuContent
        side={rtl ? 'left' : 'right'}
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className="w-60 p-1.5"
        data-testid={`site-rail-flyout-${group}`}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') clear();
        }}
        onPointerLeave={hoverOut}
        // A press on this group's own trigger pins the flyout (handled on the
        // trigger); it is not an outside press that should dismiss it.
        onPointerDownOutside={(event) => {
          const target = event.detail.originalEvent.target;
          if (target instanceof Element && target.closest(`[data-site-rail-group="${group}"]`)) {
            event.preventDefault();
          }
        }}
        // Hover never steals focus; click and keyboard move into the menu.
        // (Radix forwards this to the menu content; its types omit it.)
        {...({
          onOpenAutoFocus: (event: Event) => {
            if (hoverOpened.current) event.preventDefault();
          },
        } as object)}
        onKeyDown={(event) => {
          if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <DropdownMenuLabel className={cn(NAV_GROUP_LABEL_CLASS, 'px-2.5 py-1.5')}>
          {label}
        </DropdownMenuLabel>
        {items.map((item) => {
          const ItemIcon = item.icon as LucideIcon;
          const current = item.id === activeTab;
          return (
            <DropdownMenuItem key={item.id} asChild className="p-0 focus:bg-transparent">
              <Link
                replace
                state={state}
                to={siteTabHref(siteId ?? '', item.id, search, hash)}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  NAV_ROW_CLASS,
                  'data-[highlighted]:bg-sidebar-accent/60 data-[highlighted]:text-sidebar-foreground',
                )}
              >
                <ItemIcon aria-hidden="true" />
                <span className={NAV_LABEL_CLASS}>
                  <Bdi>{t(item.labelKey)}</Bdi>
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** The groups' open state: the active page's group opens by default, user toggles are remembered. */
const useGroupState = (activeGroup: SiteNavGroupId | undefined, activeTab: SiteTab) => {
  const { user } = useAuthSession();
  const userKey = user?.id ?? user?.email ?? 'anonymous';
  const [saved, setSaved] = useState<SiteGroupState>(() => readSiteGroups(userKey));
  const [loadedFor, setLoadedFor] = useState(userKey);
  // The group the user closed while it held the current page; reopens on navigation.
  const [closedActive, setClosedActive] = useState<string | null>(null);
  if (loadedFor !== userKey) {
    setLoadedFor(userKey);
    setSaved(readSiteGroups(userKey));
  }
  useEffect(() => setClosedActive(null), [activeTab]);
  const isOpen = (group: SiteNavGroupId): boolean =>
    group === activeGroup ? closedActive !== group : saved[group] === true;
  const toggle = (group: SiteNavGroupId) => {
    const next = !isOpen(group);
    if (group === activeGroup) setClosedActive(next ? null : group);
    const nextSaved = { ...saved, [group]: next };
    setSaved(nextSaved);
    writeSiteGroups(userKey, nextSaved);
  };
  return { isOpen, toggle };
};

const ExpandedGroup = ({
  group,
  labelKey,
  items,
  open,
  filtering,
  query,
  activeTab,
  onToggle,
}: {
  group: SiteNavGroupId;
  labelKey: string;
  items: SiteNavItem[];
  open: boolean;
  filtering: boolean;
  query: string;
  activeTab: SiteTab;
  onToggle: () => void;
}) => {
  const { t } = useTranslation([...SITE_NAV_NAMESPACES]);
  const { siteId } = useSiteNavigation();
  const { search, hash, state } = useLocation();
  const listId = useId();
  const label = t(labelKey);
  return (
    <div className="min-w-0 pt-2" data-site-nav-group={group}>
      {filtering ? (
        <p className={cn(NAV_GROUP_LABEL_CLASS, 'flex h-8 items-center px-2.5')}>{label}</p>
      ) : (
        <button
          type="button"
          className={cn(
            'group/heading flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-start outline-hidden transition-colors duration-150 hover:bg-sidebar-accent/60 active:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset motion-reduce:transition-none',
            NAV_GROUP_LABEL_CLASS,
          )}
          aria-expanded={open}
          aria-controls={listId}
          onClick={onToggle}
        >
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-3.5 shrink-0 opacity-60 transition-[transform,opacity] duration-150 group-hover/heading:opacity-100 motion-reduce:transition-none',
              open ? '' : '-rotate-90 rtl:rotate-90',
            )}
          />
        </button>
      )}
      {open ? (
        <ul id={listId} className="flex flex-col gap-0.5" aria-label={label}>
          {items.map((item) => {
            const ItemIcon = item.icon as LucideIcon;
            const itemLabel = t(item.labelKey);
            return (
              <li key={item.id}>
                <NavTooltip label={itemLabel} when="truncated">
                  <Link
                    replace
                    state={state}
                    to={siteTabHref(siteId ?? '', item.id, search, hash)}
                    aria-current={item.id === activeTab ? 'page' : undefined}
                    className={NAV_ROW_CLASS}
                    data-site-nav-link=""
                  >
                    <ItemIcon aria-hidden="true" />
                    <span data-nav-label="" className={NAV_LABEL_CLASS}>
                      <Highlighted label={itemLabel} query={query} />
                    </span>
                  </Link>
                </NavTooltip>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};

/**
 * The desktop site sidebar: 240px expanded, a 56px rail collapsed. The header
 * (switcher, toggle, filter) stays pinned; only the page list scrolls.
 */
export const SiteMenu = () => {
  const { t } = useTranslation([...SITE_NAV_NAMESPACES]);
  const { pathname, search, hash, state } = useLocation();
  const navigate = useNavigate();
  const {
    siteId,
    siteMenuExpanded: expanded,
    siteMenuOverlay,
    setSiteMenuExpanded,
  } = useSiteNavigation();
  const activeTab = activeTabFromLocation(pathname, search);
  const activeGroup = getSiteTabGroup(activeTab)?.id as SiteNavGroupId | undefined;
  const groups = useGroupState(activeGroup, activeTab);
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const focusFilterNext = useRef(false);
  const listRef = useScrollFades<HTMLDivElement>();
  const query = filter.trim();
  const needle = query.toLocaleLowerCase();
  const matches = (item: SiteNavItem) => t(item.labelKey).toLocaleLowerCase().includes(needle);

  const openFilter = (trigger?: HTMLElement) => {
    if (expanded) {
      filterRef.current?.focus();
      return;
    }
    focusFilterNext.current = true;
    setSiteMenuExpanded(true, trigger);
  };

  useEffect(() => {
    if (expanded && focusFilterNext.current) {
      focusFilterNext.current = false;
      filterRef.current?.focus();
    }
  }, [expanded]);

  // `/` jumps to the page filter from anywhere outside a text field.
  const openFilterRef = useRef(openFilter);
  openFilterRef.current = openFilter;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || !isPlainKey(event) || isTypingTarget(event.target)) return;
      if (window.matchMedia(MOBILE_QUERY).matches) return;
      event.preventDefault();
      openFilterRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const overview = SITE_NAV_ITEMS[0]!;
  const OverviewIcon = overview.icon;
  const overviewLabel = t(overview.labelKey);
  const overviewHref = siteTabHref(siteId ?? '', overview.id, search, hash);
  const showOverview = !needle || matches(overview);
  const visibleGroups = SITE_NAV_GROUPS.map((group) => ({
    ...group,
    items: itemsOf(group.id).filter((item) => !needle || matches(item)),
  })).filter((group) => group.items.length > 0);
  const results = [
    ...(showOverview ? [overview] : []),
    ...visibleGroups.flatMap((group) => group.items),
  ];

  const moveFocus = (from: HTMLElement, delta: number) => {
    const links = Array.from(
      from.closest('nav')!.querySelectorAll<HTMLElement>('[data-site-nav-link]'),
    );
    const index = links.indexOf(from);
    links[Math.max(0, Math.min(links.length - 1, index + delta))]?.focus();
  };

  const onFilterKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (filter) setFilter('');
      else event.currentTarget.blur();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.currentTarget
        .closest('nav')
        ?.querySelector<HTMLElement>('[data-site-nav-link]')
        ?.focus();
    } else if (event.key === 'Enter' && needle && results[0]) {
      event.preventDefault();
      navigate(siteTabHref(siteId ?? '', results[0].id, search, hash), { replace: true, state });
      setFilter('');
    }
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.hasAttribute('data-site-nav-link')) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(target, event.key === 'ArrowDown' ? 1 : -1);
    }
  };

  return (
    <nav
      id={SITE_SIDEBAR_ID}
      aria-label={t('sites:workspace.navLandmark')}
      data-testid="site-navigation"
      data-state={expanded ? 'expanded' : 'collapsed'}
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden border-e border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out motion-reduce:transition-none',
        expanded ? 'w-(--site-sidebar-width)' : 'w-(--site-sidebar-width-icon)',
        siteMenuOverlay && 'absolute inset-y-0 start-0 z-30',
        siteMenuOverlay && expanded && 'shadow-lg',
      )}
    >
      <div
        className={cn(
          'flex shrink-0 gap-1 border-b border-border p-2',
          expanded ? 'flex-row items-center' : 'flex-col items-center',
        )}
      >
        <SiteSwitcher variant={expanded ? 'expanded' : 'rail'} />
        <div className={expanded ? '' : 'order-first'}>
          <SiteSidebarToggle />
        </div>
      </div>
      {expanded ? (
        <div className="relative shrink-0 px-2 pt-2">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-4.5 top-1/2 mt-1 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={filterRef}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={onFilterKeyDown}
            placeholder={t('sites:workspace.filterPages')}
            aria-label={t('sites:workspace.filterPages')}
            aria-keyshortcuts="/"
            data-testid="site-nav-filter"
            className="h-9 w-full min-w-0 rounded-md border border-input bg-background ps-8 pe-9 text-sm outline-hidden placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
          />
          <div className="absolute end-3.5 top-1/2 mt-1 flex -translate-y-1/2 items-center">
            {filter ? (
              <NavTooltip label={t('sites:workspace.clearFilter')}>
                <button
                  type="button"
                  className="inline-flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  aria-label={t('sites:workspace.clearFilter')}
                  onClick={() => {
                    setFilter('');
                    filterRef.current?.focus();
                  }}
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </NavTooltip>
            ) : (
              <span aria-hidden="true" className="text-muted-foreground">
                <kbd className="rounded border border-border px-1.5 font-sans text-[0.7rem] leading-4">
                  /
                </kbd>
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 justify-center px-2 pt-2">
          <NavTooltip label={t('sites:workspace.filterPagesShort')} shortcut="/">
            <button
              type="button"
              className={cn(NAV_ROW_CLASS, NAV_RAIL_BUTTON_CLASS)}
              aria-label={t('sites:workspace.filterPagesShort')}
              aria-keyshortcuts="/"
              aria-controls={SITE_SIDEBAR_ID}
              onClick={(event) => openFilter(event.currentTarget)}
              data-testid="site-nav-filter-rail"
            >
              <Search aria-hidden="true" />
            </button>
          </NavTooltip>
        </div>
      )}
      <div
        ref={listRef}
        className={cn('nav-scroll min-h-0 flex-1 px-2 pt-2 pb-3', !expanded && 'nav-scroll-rail')}
        onKeyDown={onListKeyDown}
      >
        {expanded ? (
          <>
            {showOverview ? (
              <NavTooltip label={overviewLabel} when="truncated">
                <Link
                  replace
                  state={state}
                  to={overviewHref}
                  aria-current={activeTab === overview.id ? 'page' : undefined}
                  className={NAV_ROW_CLASS}
                  data-site-nav-link=""
                >
                  <OverviewIcon aria-hidden="true" />
                  <span data-nav-label="" className={NAV_LABEL_CLASS}>
                    <Highlighted label={overviewLabel} query={query} />
                  </span>
                </Link>
              </NavTooltip>
            ) : null}
            {visibleGroups.map((group) => (
              <ExpandedGroup
                key={group.id}
                group={group.id}
                labelKey={group.labelKey}
                items={group.items}
                open={needle ? true : groups.isOpen(group.id)}
                filtering={Boolean(needle)}
                query={query}
                activeTab={activeTab}
                onToggle={() => groups.toggle(group.id)}
              />
            ))}
            {results.length === 0 ? (
              <div
                className="px-2.5 py-4 text-sm text-muted-foreground"
                role="status"
                data-testid="site-nav-no-results"
              >
                <p>{t('sites:workspace.noPagesMatch', { query: isolateText(query) })}</p>
                <button
                  type="button"
                  className="mt-1 cursor-pointer font-medium text-sidebar-foreground underline underline-offset-4 outline-hidden hover:no-underline active:no-underline focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  onClick={() => {
                    setFilter('');
                    filterRef.current?.focus();
                  }}
                >
                  {t('sites:workspace.clearFilter')}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            <NavTooltip label={overviewLabel}>
              <Link
                replace
                state={state}
                to={overviewHref}
                aria-label={overviewLabel}
                aria-current={activeTab === overview.id ? 'page' : undefined}
                className={cn(NAV_ROW_CLASS, NAV_RAIL_BUTTON_CLASS)}
              >
                <OverviewIcon aria-hidden="true" />
              </Link>
            </NavTooltip>
            {/* One quiet divider between the page and its sections. */}
            <div aria-hidden="true" className="my-1.5 h-px w-6 bg-border" />
            {SITE_NAV_GROUPS.map((group) => (
              <RailGroup
                key={group.id}
                group={group.id}
                labelKey={group.labelKey}
                activeTab={activeTab}
              />
            ))}
          </div>
        )}
      </div>
    </nav>
  );
};
