import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { selectSites } from '@features/sites';
import {
  canOpenRoute,
  selectActiveWorkspaceRole,
  selectIsForeignWorkspace,
} from '@features/workspace';
import { docsUrl } from '@shared/docs/docsUrl';
import { useAppSelector } from '@shared/hooks/redux';
import { DEFAULT_LOCALE, isSupportedLocale } from '@shared/i18n';
import { cn } from '@shared/lib/utils';
import { APP_NAV_GROUPS } from '@shared/navigation/appNav';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { rankSearchFields } from '@shared/navigation/searchMatch';
import { Button } from '@shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@shared/ui/dialog';

interface SearchResult {
  id: string;
  to: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: 'pages' | 'sites';
  /** Opens outside the SPA, in a new tab. */
  newTab?: boolean;
  /** Text the query is matched against. */
  fields: string[];
  rank: number;
}

/** Empty-query browse list shows a few sites, not the whole portfolio. */
const BROWSE_SITE_LIMIT = 5;
const RESULT_LIMIT = 12;

const useSearchResults = (query: string): SearchResult[] => {
  const { t, i18n } = useTranslation(['common', 'alerts']);
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
          group: 'pages' as const,
          fields: [t(item.labelKey)],
          rank: 0,
        })),
    );
    const siteRows: SearchResult[] = sites.map((site) => ({
      id: `site:${site.id}`,
      to: `/sites/${site.id}`,
      label: site.displayName || site.domain,
      hint: site.displayName && site.displayName !== site.domain ? site.domain : undefined,
      icon: APP_PAGE_ICONS.sites,
      group: 'sites' as const,
      fields: [site.displayName, site.domain, site.url],
      rank: 0,
    }));

    const needle = query.trim();
    if (!needle) return [...pages, ...siteRows.slice(0, BROWSE_SITE_LIMIT)];

    const scored = [...pages, ...siteRows].flatMap((row, order) => {
      const rank = rankSearchFields(row.fields, needle);
      return rank === null ? [] : [{ row: { ...row, rank }, order }];
    });
    return scored
      .sort((a, b) => a.row.rank - b.row.rank || a.order - b.order)
      .slice(0, RESULT_LIMIT)
      .map((entry) => entry.row);
  }, [query, t, locale, sites, role, isForeign]);
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
  const { t } = useTranslation(['common']);
  const navigate = useNavigate();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const statusId = `${baseId}-empty`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useSearchResults(query);
  const showList = persistent || open;
  const optionId = (index: number) => `${baseId}-opt-${index}`;
  const activeResult = results[active];

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
    setActive((current) => (current + delta + results.length) % results.length);
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

  const grouped = (['pages', 'sites'] as const)
    .map((group) => ({
      group,
      rows: results.map((row, index) => ({ row, index })).filter(({ row }) => row.group === group),
    }))
    .filter((entry) => entry.rows.length > 0);

  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
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
        aria-activedescendant={showList && activeResult ? optionId(active) : undefined}
        value={query}
        placeholder={t('shell.searchPlaceholder')}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        // Neutral (ink) focus ring: the global signal-red ring reads as a
        // validation error on a plain search field.
        className="h-9 w-full min-w-0 cursor-text rounded-md border border-input bg-transparent ps-8 pe-3 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:ring-[3px] focus-visible:ring-foreground/20 md:text-sm dark:bg-input/30"
      />

      {showList ? (
        <div
          className={cn(
            'z-50 mt-1 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground',
            persistent ? 'max-h-[60vh] border-0 p-0' : 'absolute top-full max-h-80 min-w-64 shadow-md',
          )}
        >
          {results.length > 0 ? (
            <div id={listId} role="listbox" aria-label={t('shell.search')}>
              {grouped.map(({ group, rows }) => (
                <div key={group} role="group" aria-labelledby={`${baseId}-group-${group}`}>
                  <div
                    id={`${baseId}-group-${group}`}
                    className="px-2 py-1.5 text-xs font-medium text-muted-foreground"
                  >
                    {t(group === 'pages' ? 'shell.searchGroupPages' : 'shell.searchGroupSites')}
                  </div>
                  {rows.map(({ row, index }) => {
                    const Icon = row.icon;
                    return (
                      <div
                        key={row.id}
                        id={optionId(index)}
                        role="option"
                        aria-selected={index === active}
                        // Keep focus in the input so a click never blurs (and
                        // closes) the list before the click lands.
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseMove={() => setActive(index)}
                        onClick={() => choose(row)}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                          index === active && 'bg-accent text-accent-foreground',
                        )}
                      >
                        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate">{row.label}</span>
                        {row.hint ? (
                          <span className="ms-auto truncate text-xs text-muted-foreground">
                            {row.hint}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <p id={statusId} role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('shell.searchNoResults', { query: query.trim() })}
            </p>
          )}
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
      <Button
        variant="ghost"
        size="icon"
        className="sm:hidden"
        aria-label={t('shell.search')}
        onClick={() => setDialogOpen(true)}
      >
        <Search aria-hidden="true" />
      </Button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="top-[15%] translate-y-0 gap-3 p-4">
          <DialogTitle className="sr-only">{t('shell.search')}</DialogTitle>
          <DialogDescription className="sr-only">{t('shell.searchPlaceholder')}</DialogDescription>
          <SearchCombobox persistent autoFocus className="pe-8" onNavigate={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
};
