import { Bdi } from '@shared/components/Bdi';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMatch, useNavigate } from 'react-router-dom';
import { SITE_NAV_GROUPS, SITE_NAV_ITEMS, loadSites, selectSites, selectSitesLoaded, selectSitesLoading, siteTabHref } from '@features/sites';
import { canOpenRoute, selectActiveWorkspaceRole, selectIsForeignWorkspace } from '@features/workspace';
import { docsUrl } from '@shared/docs/docsUrl';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { DEFAULT_LOCALE, isSupportedLocale } from '@shared/i18n';
import { cn } from '@shared/lib/utils';
import { isolateText } from '@shared/lib/bidi';
import { APP_NAV_GROUPS } from '@shared/navigation/appNav';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { rankSearchFields } from '@shared/navigation/searchMatch';
import { Button } from '@shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@shared/ui/dialog';
import { NavigationPendingIndicator } from './NavigationPendingIndicator';

type SearchGroup = 'pages' | 'tools' | 'sites' | 'docs';
const SEARCH_GROUPS: SearchGroup[] = ['pages', 'tools', 'sites', 'docs'];
const GROUP_LABELS: Record<SearchGroup, string> = {
  pages: 'shell.searchGroupPages', tools: 'shell.searchGroupTools', sites: 'shell.searchGroupSites', docs: 'shell.searchGroupDocs',
};

interface SearchResult {
  id: string;
  to: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: SearchGroup;
  /** Opens outside the SPA, in a new tab. */
  newTab?: boolean;
  /** Text the query is matched against. */
  fields: string[];
  rank: number;
}

/** Empty-query browse list shows a few sites, not the whole portfolio. */
const BROWSE_SITE_LIMIT = 5;
const RESULT_LIMIT = 12;
const TOOL_RESULT_LIMIT = 8;

const useSearchResults = (query: string): SearchResult[] => {
  const { t, i18n } = useTranslation(['common', 'alerts', ...new Set(SITE_NAV_ITEMS.map((item) => item.labelKey.split(':')[0]!))]);
  const currentSiteId = useMatch('/sites/:siteId/*')?.params.siteId;
  const sites = useAppSelector(selectSites);
  const role = useAppSelector(selectActiveWorkspaceRole);
  const isForeign = useAppSelector(selectIsForeignWorkspace);
  const locale = isSupportedLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;

  return useMemo(() => {
    // Same destinations (and the same workspace-role policy) as the sidebar.
    const pages: SearchResult[] = APP_NAV_GROUPS.flatMap((group) =>
      group.items
        .filter((item) => canOpenRoute(item.to, role, isForeign))
        .map((item) => ({
          id: `page:${item.to}`,
          to: item.to === '/docs' ? docsUrl('index', locale) : item.to,
          label: t(item.labelKey),
          icon: item.icon,
          newTab: item.newTab === true,
          group: item.to === '/docs' ? 'docs' as const : 'pages' as const,
          fields: [t(item.labelKey)],
          rank: 0,
        })),
    );
    const siteRows: SearchResult[] = sites.map((site) => ({
      id: `site:${site.id}`,
      to: `/sites/${encodeURIComponent(site.id)}`,
      label: site.displayName || site.domain,
      hint: site.displayName && site.displayName !== site.domain ? site.domain : undefined,
      icon: APP_PAGE_ICONS.sites,
      group: 'sites' as const,
      fields: [site.displayName, site.domain],
      rank: 0,
    }));

    const needle = query.trim();
    const toolSites = sites.filter((site) => !currentSiteId || site.id === currentSiteId)
      .sort((a, b) => Number(a.paused) - Number(b.paused));
    const tools: SearchResult[] = needle ? SITE_NAV_ITEMS.flatMap((item) => {
      const label = t(item.labelKey);
      const group = SITE_NAV_GROUPS.find((group) => group.id === item.group);
      const rank = rankSearchFields(group ? [label, t(group.labelKey)] : [label], needle);
      if (rank === null) return [];
      return toolSites.map((site) => ({
        id: `tool:${site.id}:${item.id}`, to: siteTabHref(site.id, item.id),
        label: `${label} — ${site.displayName || site.domain}`, icon: item.icon,
        hint: site.paused ? t('sites:paused.optionSuffix') : undefined,
        group: 'tools' as const, fields: [], rank,
      }));
    }).slice(0, TOOL_RESULT_LIMIT) : [];

    const inDisplayOrder = (rows: SearchResult[]) => rows.sort((a, b) =>
      SEARCH_GROUPS.indexOf(a.group) - SEARCH_GROUPS.indexOf(b.group) || a.rank - b.rank);
    if (!needle) return inDisplayOrder([...pages, ...siteRows.slice(0, BROWSE_SITE_LIMIT)]);

    const scored = [...pages, ...siteRows].flatMap((row) => {
      const rank = rankSearchFields(row.fields, needle);
      return rank === null ? [] : [{ ...row, rank }];
    });
    return inDisplayOrder([...scored, ...tools]).slice(0, RESULT_LIMIT);
  }, [query, t, locale, sites, role, isForeign, currentSiteId]);
};

interface SearchComboboxProps {
  /** Render the list inline and keep it open (inside the mobile dialog). */
  persistent?: boolean;
  autoFocus?: boolean;
  onNavigate?: () => void;
  className?: string;
}

/**
 * Accessible combobox (WAI-ARIA 1.2 list autocomplete): the input keeps focus,
 * arrow keys move `aria-activedescendant`, Enter opens the highlighted result,
 * Escape closes. Cleared after every navigation.
 */
const SearchCombobox = ({
  persistent = false,
  autoFocus = false,
  onNavigate,
  className,
}: SearchComboboxProps) => {
  const { t, i18n } = useTranslation(['common']);
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const sitesLoaded = useAppSelector(selectSitesLoaded);
  const sitesLoading = useAppSelector(selectSitesLoading);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const statusId = `${baseId}-empty`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useSearchResults(query);
  const activeIndex = Math.min(active, results.length - 1);
  const showList = persistent || open;
  const optionId = (index: number) => `${baseId}-opt-${index}`;
  const activeResult = results[activeIndex];

  useEffect(() => {
    const list = listRef.current;
    const option = activeRef.current;
    if (!list || !option) return;
    const bounds = list.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    if (row.top < bounds.top) list.scrollTop -= bounds.top - row.top;
    else if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom;
  }, [activeIndex, results, showList]);

  const choose = (result: SearchResult) => {
    if (result.newTab) window.open(result.to, '_blank', 'noopener,noreferrer');
    else navigate(result.to);
    setQuery('');
    setActive(0);
    setOpen(false);
    inputRef.current?.blur();
    onNavigate?.();
  };

  const move = (delta: number) => {
    setOpen(true);
    if (results.length === 0) return;
    if (!showList) {
      setActive(delta > 0 ? 0 : results.length - 1);
      return;
    }
    setActive((activeIndex + delta + results.length) % results.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (showList && activeResult) choose(activeResult);
    } else if (event.key === 'Escape' && !persistent) {
      event.preventDefault();
      setOpen(false);
      setQuery('');
    }
  };

  const grouped = SEARCH_GROUPS
    .map((group) => ({
      group,
      rows: results.map((row, index) => ({ row, index })).filter(({ row }) => row.group === group),
    }))
    .filter((entry) => entry.rows.length > 0);

  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute start-2.5 top-[1.125rem] size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-label={t('shell.search')}
        aria-expanded={showList}
        aria-controls={showList && results.length > 0 ? listId : undefined}
        aria-describedby={showList && results.length === 0 && query.trim() ? statusId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={showList && activeResult ? optionId(activeIndex) : undefined}
        value={query}
        placeholder={t('shell.searchPlaceholder')}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          if (!sitesLoaded && !sitesLoading) void dispatch(loadSites({}));
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        // Neutral (ink) focus ring, matching the global `--ring` token.
        className="h-9 w-full min-w-0 cursor-text rounded-md border border-input bg-transparent ps-8 pe-3 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:ring-[3px] focus-visible:ring-foreground/20 md:text-sm dark:bg-input/30"
      />

      {showList ? (
        <div
          className={cn(
            'z-50 mt-1 w-full rounded-md border bg-popover p-1 text-popover-foreground',
            persistent ? 'border-0 p-0' : 'absolute top-full min-w-64 shadow-md',
          )}
        >
          {sitesLoading ? <p role="status" className="px-3 py-2 text-sm text-muted-foreground">{t('shell.searchSitesLoading')}</p> : null}
          {results.length > 0 ? (
            <div ref={listRef} id={listId} role="listbox" aria-label={t('shell.search')} className={cn('overflow-y-auto overscroll-contain', persistent ? 'max-h-[60vh]' : 'max-h-80')}>
              {grouped.map(({ group, rows }) => (
                <div key={group} role="group" aria-labelledby={`${baseId}-group-${group}`}>
                  <div
                    id={`${baseId}-group-${group}`}
                    className="px-2 py-1.5 text-xs font-medium text-muted-foreground"
                  >
                    {t(GROUP_LABELS[group])}
                  </div>
                  {rows.map(({ row, index }) => {
                    const Icon = row.icon;
                    return (
                      <div
                        key={row.id}
                        id={optionId(index)}
                        ref={index === activeIndex ? activeRef : undefined}
                        role="option"
                        aria-selected={index === activeIndex}
                        // Keep focus in the input so a click never blurs (and
                        // closes) the list before the click lands.
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseMove={() => setActive(index)}
                        onClick={() => choose(row)}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                          index === activeIndex && 'bg-accent text-accent-foreground',
                        )}
                      >
                        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate"><Bdi>{row.label}</Bdi></span>
                        {row.hint ? (
                          <span className="ms-auto truncate text-xs text-muted-foreground">
                            <Bdi>{row.hint}</Bdi>
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <p id={statusId} role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">{t('shell.searchNoResults', { query: query.trim() })}</p>
          )}
          {query.trim() ? <a href={`${docsUrl('index', i18n.language)}?q=${encodeURIComponent(query.trim())}`} target="_blank" rel="noopener noreferrer" className="block px-3 py-2 text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring">
            <Bdi>{t('shell.searchDocsFor', { query: isolateText(query.trim()) })}</Bdi>
          </a> : null}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Topbar search: an inline combobox from `sm` up, and an icon button that
 * opens the same combobox in a dialog on phones. Results come from the shared
 * app nav config (the sidebar's own list) plus the sites already in the store.
 */
export const AppSearch = () => {
  const { t } = useTranslation(['common']);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <SearchCombobox className="hidden max-w-sm flex-1 sm:block" />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" className="sm:hidden" aria-label={t('shell.search')}>
            <Search aria-hidden="true" />
          </Button>
        </DialogTrigger>
        <DialogContent className="top-[15%] translate-y-0 gap-3 p-4">
          <DialogTitle className="sr-only">{t('shell.search')}</DialogTitle>
          <DialogDescription className="sr-only">{t('shell.searchPlaceholder')}</DialogDescription>
          <SearchCombobox persistent autoFocus className="pe-8" onNavigate={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
      <NavigationPendingIndicator />
    </>
  );
};
