import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal, Pause, Play } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { StatusChip } from '@shared/ui/status-chip';
import { Avatar, AvatarFallback } from '@shared/ui/avatar';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Card, CardContent } from '@shared/ui/card';
import { pauseSite, renameSite, resumeSite } from '../store/thunks';
import {
  selectPausingSiteId,
  selectRenameSiteError,
  selectRenamingSiteId,
} from '../store/selectors';
import type { Site } from '../types';

export interface SitesTableProps {
  sites: Site[];
  deletingId: string | null;
  onDelete: (site: Site) => void;
}

const formatAdded = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

const siteName = (site: Site): string => site.displayName || site.domain;

const siteInitials = (site: Site): string =>
  siteName(site).trim().slice(0, 2).toUpperCase();

type SortKey = 'name' | 'domain' | 'added';
type SortState = { key: SortKey; dir: 'asc' | 'desc' };

const sortValue = (site: Site, key: SortKey): string =>
  key === 'name'
    ? siteName(site).toLowerCase()
    : key === 'domain'
      ? site.domain.toLowerCase()
      : site.createdAt;

/**
 * Data-table pattern per design-system.md: muted header row, right-aligned
 * date column, per-row `⋯` menu. Collapses to bordered cards below `md`.
 */
export const SitesTable = ({ sites, deletingId, onDelete }: SitesTableProps) => {
  const { t, i18n } = useTranslation('sites');
  const dispatch = useAppDispatch();
  const renamingId = useAppSelector(selectRenamingSiteId);
  const renameError = useAppSelector(selectRenameSiteError);
  const pausingId = useAppSelector(selectPausingSiteId);
  const [pendingDelete, setPendingDelete] = useState<Site | null>(null);
  const [pendingPause, setPendingPause] = useState<Site | null>(null);
  const [renaming, setRenaming] = useState<Site | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);

  const sortedSites = useMemo(() => {
    if (!sort) return sites;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...sites].sort(
      (a, b) => sortValue(a, sort.key).localeCompare(sortValue(b, sort.key)) * factor,
    );
  }, [sites, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );

  // Accessible name stays the plain label (no aria-label override), so
  // `columnheader` queries still match; sort state is conveyed via `aria-sort`
  // on the TableHead below.
  const SortHeader = ({ sortKey, label }: { sortKey: SortKey; label: string }) => {
    const active = sort?.key === sortKey;
    const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icon
          aria-hidden="true"
          className={active ? 'size-3.5 text-foreground' : 'size-3.5 text-muted-foreground'}
        />
      </button>
    );
  };

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';

  const openRename = (site: Site) => {
    setRenameValue(site.displayName);
    setRenaming(site);
  };

  const closeRename = () => {
    setRenaming(null);
    setRenameValue('');
  };

  const submitRename = async (site: Site) => {
    const result = await dispatch(
      renameSite({ id: site.id, displayName: renameValue.trim() }),
    );
    if (renameSite.fulfilled.match(result)) {
      closeRename();
    }
  };

  const pausedChip = (site: Site) =>
    site.paused ? (
      <StatusChip tone="warning" data-testid={`site-paused-chip-${site.id}`}>
        {t('paused.chip')}
      </StatusChip>
    ) : null;

  const rowMenu = (site: Site) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('rowActions', { name: siteName(site) })}
          disabled={deletingId === site.id || pausingId === site.id}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to={`/sites/${site.id}`}>{t('open')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={`/sites/${site.id}?tab=report`}>{t('viewReport')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={`/sites/${site.id}?tab=keywords`}>{t('trackKeywords')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={`/sites/${site.id}?tab=backlinks`}>{t('backlinks')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={`/sites/${site.id}?tab=competitors`}>{t('competitors')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={`/sites/${site.id}?tab=google`}>{t('googleSettings')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openRename(site)}>
          {t('editName')}
        </DropdownMenuItem>
        {site.paused ? (
          <DropdownMenuItem onSelect={() => void dispatch(resumeSite(site.id))}>
            <Play aria-hidden="true" />
            {t('paused.menuResume')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => setPendingPause(site)}>
            <Pause aria-hidden="true" />
            {t('paused.menuPause')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(site)}>
          {t('delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <div className="hidden rounded-xl border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead aria-sort={ariaSort('name')}>
                <SortHeader sortKey="name" label={t('columnName')} />
              </TableHead>
              <TableHead aria-sort={ariaSort('domain')}>
                <SortHeader sortKey="domain" label={t('columnDomain')} />
              </TableHead>
              <TableHead className="text-end" aria-sort={ariaSort('added')}>
                <SortHeader sortKey="added" label={t('columnAdded')} />
              </TableHead>
              <TableHead className="w-10">
                <span className="sr-only">{t('columnActions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedSites.map((site) => (
              <TableRow key={site.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2.5">
                    <Avatar className="size-8">
                      <AvatarFallback className="text-xs">
                        {siteInitials(site)}
                      </AvatarFallback>
                    </Avatar>
                    <Link to={`/sites/${site.id}`} className="hover:underline">
                      {siteName(site)}
                    </Link>
                    {pausedChip(site)}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{site.domain}</TableCell>
                <TableCell className="text-end">
                  {formatAdded(site.createdAt, i18n.language)}
                </TableCell>
                <TableCell>{rowMenu(site)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        {sortedSites.map((site) => (
          <Card key={site.id}>
            <CardContent className="flex items-center justify-between gap-2 p-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className="text-xs">
                    {siteInitials(site)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    <Link to={`/sites/${site.id}`} className="hover:underline">
                      {siteName(site)}
                    </Link>
                  </p>
                  <p className="text-muted-foreground truncate text-sm">{site.domain}</p>
                  <p className="text-muted-foreground text-sm">
                    {t('columnAdded')}: {formatAdded(site.createdAt, i18n.language)}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {pausedChip(site)}
                  </div>
                </div>
              </div>
              {rowMenu(site)}
            </CardContent>
          </Card>
        ))}
      </div>

      {pendingDelete ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('deleteDescription', { domain: pendingDelete.domain })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('deleteCancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onDelete(pendingDelete);
                  setPendingDelete(null);
                }}
              >
                {t('deleteConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {pendingPause ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingPause(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('paused.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('paused.confirmBody', { domain: pendingPause.domain })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('paused.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  void dispatch(pauseSite(pendingPause.id));
                  setPendingPause(null);
                }}
              >
                {t('paused.confirmCta')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {renaming ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closeRename();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('renameTitle')}</DialogTitle>
              <DialogDescription>
                {t('renameDescription', { domain: renaming.domain })}
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitRename(renaming);
              }}
              className="flex flex-col gap-3"
            >
              <Label htmlFor="site-rename-input">{t('renameLabel')}</Label>
              <Input
                id="site-rename-input"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                placeholder={t('renamePlaceholder')}
                maxLength={120}
                autoFocus
              />
              {renameError ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{renameError}</AlertDescription>
                </Alert>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeRename}>
                  {t('renameCancel')}
                </Button>
                <Button
                  type="submit"
                  loading={renamingId === renaming.id}
                  loadingLabel={t('renameSaving')}
                >
                  {t('renameSave')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
};
