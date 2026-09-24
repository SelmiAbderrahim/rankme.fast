import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Minus, MoreHorizontal, RefreshCw } from 'lucide-react';
import { Badge } from '@shared/ui/badge';
import { formatRelativeTime } from '@shared/lib/datetime';
import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import { Spinner } from '@shared/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { cn } from '@shared/lib/utils';
import type { Keyword } from '../types';
import { rankCheckReachedTerminal } from '../check-status';
import { formatCountryFromLocation } from '@shared/markets';

export interface KeywordsTableProps {
  keywords: Keyword[];
  removingId: string | null;
  selectedId: string | null;
  onSelect: (keyword: Keyword) => void;
  onRemove: (keyword: Keyword) => void;
  onCheck?: (keyword: Keyword) => void;
  /**
   * Epoch ms of an in-flight "Check now" (null when idle). A row whose
   * `lastCheckedAt` has not advanced past this stamp renders an optimistic
   * "Checking…" state instead of its stale/unavailable position.
   */
  checkingSince?: number | null;
  /** Null means a site-wide check; a UUID limits optimistic state to one row. */
  checkingKeywordId?: string | null;
  /** Row whose POST request has not returned yet. */
  requestingKeywordId?: string | null;
}

const dateTimeFormatter = (locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Data-table pattern per design-system.md: muted header row, right-aligned
 * numeric columns, per-row `⋯` menu. Collapses to bordered cards below `md`.
 */
export const KeywordsTable = ({
  keywords,
  removingId,
  selectedId,
  onSelect,
  onRemove,
  onCheck,
  checkingSince = null,
  checkingKeywordId = null,
  requestingKeywordId = null,
}: KeywordsTableProps) => {
  const { t, i18n } = useTranslation('ranks');
  const [pendingRemove, setPendingRemove] = useState<Keyword | null>(null);
  const dateTime = useMemo(() => dateTimeFormatter(i18n.language), [i18n.language]);

  // A row is "checking" while a Check-now poll is in flight and this keyword's
  // snapshot has not yet been refreshed past the trigger stamp.
  const isChecking = (k: Keyword): boolean =>
    checkingSince !== null &&
    (checkingKeywordId === null || checkingKeywordId === k.id) &&
    !rankCheckReachedTerminal(k, checkingSince);

  /**
   * Engine provenance on every row. Google rows
   * render nothing so the shipped table is visually unchanged for accounts
   * that never left Google. Amazon additionally carries the provider-index
   * label so its ordinal can never read as a live shelf position.
   */
  const renderEngineBadge = (k: Keyword) => {
    if (k.engine === 'google') return null;
    const amazonObservation =
      k.engine === 'amazon' &&
      k.observationMeta?.coverageNoteKey === 'observations.coverage.providerIndexRanking'
        ? k.observationMeta
        : null;
    return (
      <span className="mt-1 flex flex-wrap items-center gap-1 whitespace-normal">
        <Badge variant="secondary" data-testid={`keyword-engine-${k.id}`}>
          {t(`engine.name.${k.engine}`)}
        </Badge>
        {k.engineTarget ? (
          <span className="text-muted-foreground min-w-0 truncate text-xs" title={k.engineTarget}>
            {k.engineTarget}
          </span>
        ) : null}
        {k.engine === 'amazon' ? (
          <span
            className="text-muted-foreground text-xs"
            data-testid={`keyword-amazon-note-${k.id}`}
            data-observation-source={amazonObservation?.sourceLabel ?? undefined}
            data-observed-at={amazonObservation?.observedAt}
          >
            {t('engine.amazonProviderIndexNote')}
          </span>
        ) : null}
      </span>
    );
  };

  const renderChecking = (k: Keyword, slot: 'pos' | 'time') => (
    <span
      className="text-muted-foreground inline-flex items-center gap-1.5"
      aria-live="polite"
      data-testid={`keyword-checking-${slot}-${k.id}`}
    >
      <Spinner className="size-3" aria-hidden="true" />
      <span>{t('checking')}</span>
    </span>
  );

  /**
   * Localized explanation for a recorded failure. Null when the check never
   * failed, or failed before the cause was recorded — callers then show the
   * bare "check failed" label rather than inventing a reason.
   */
  const failureReason = (k: Keyword): string | null =>
    k.lastFailedReason === null ? null : t(`checkErroredReason.${k.lastFailedReason}`);

  const positionLabel = (k: Keyword): ReactNode => {
    if (k.latestPosition === null && k.lastCheckedAt === null) {
      if (k.lastFailedCheckAt === null) return t('unavailable');
      const reason = failureReason(k);
      // The reason rides the same node as the label so both the pointer
      // tooltip and the accessible name carry it; the visible text is
      // unchanged, so the cell still reads "Check failed" at a glance.
      return (
        <span
          {...(reason === null ? {} : { title: reason, 'aria-label': `${t('checkErrored')}: ${reason}` })}
          data-testid={`keyword-position-failed-${k.id}`}
        >
          {t('checkErrored')}
        </span>
      );
    }
    return k.latestPosition === null ? t('notInTop100') : String(k.latestPosition);
  };

  const locationLabel = (code: number): string =>
    formatCountryFromLocation(
      code,
      i18n.language,
      t('common:market.unknownCountry'),
    );

  const rowMenu = (k: Keyword) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('rowActions', { phrase: k.phrase })}
          disabled={removingId === k.id}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onCheck ? (
          <DropdownMenuItem
            disabled={requestingKeywordId === k.id || isChecking(k)}
            onSelect={() => onCheck(k)}
          >
            <RefreshCw aria-hidden="true" />
            {t('checkNow')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem variant="destructive" onSelect={() => setPendingRemove(k)}>
          {t('remove')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderDelta = (k: Keyword) => {
    // No comparison available yet (never checked, or only one snapshot) — show
    // a neutral dash, NOT "0". A literal 0 reads as a measured "no change" and
    // is misleading on keywords that have no data. Mirrors the Position column's
    // null handling.
    if (k.delta === null) {
      return (
        <span
          className="text-muted-foreground inline-flex items-center gap-1 tabular-nums"
          role="img"
          aria-label={t('deltaUnavailable')}
        >
          <span aria-hidden="true">—</span>
        </span>
      );
    }
    if (k.delta === 0) {
      return (
        <span
          className="text-muted-foreground inline-flex items-center gap-1 tabular-nums"
          role="img"
          aria-label={t('deltaFlat')}
        >
          <Minus aria-hidden="true" className="size-3" />
          <span aria-hidden="true">0</span>
        </span>
      );
    }
    const isUp = k.delta > 0;
    const magnitude = Math.abs(k.delta);
    const label = isUp
      ? magnitude === 1
        ? t('deltaUpOne')
        : t('deltaUp', { count: magnitude })
      : magnitude === 1
        ? t('deltaDownOne')
        : t('deltaDown', { count: magnitude });
    const Icon = isUp ? ArrowUp : ArrowDown;
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 tabular-nums',
          isUp ? 'text-foreground' : 'text-destructive',
        )}
        role="img"
        aria-label={label}
      >
        <Icon aria-hidden="true" className="size-3" />
        <span aria-hidden="true">{magnitude}</span>
      </span>
    );
  };

  // Google AI Overview citation state — four honest states (SPEC-A2/A3
  // tinted status chips): cited / shown-not-cited / no overview / unknown.
  const renderAiOverview = (k: Keyword) => {
    if (k.aiOverviewPresent === null) {
      return (
        <span
          className="text-muted-foreground"
          role="img"
          aria-label={t('aiUnknown')}
          title={t('aiUnknown')}
          data-testid={`keyword-ai-unknown-${k.id}`}
        >
          —
        </span>
      );
    }
    if (!k.aiOverviewPresent) {
      return (
        <span className="text-muted-foreground text-xs" data-testid={`keyword-ai-none-${k.id}`}>
          {t('aiNone')}
        </span>
      );
    }
    if (k.aiCited) {
      return (
        <Badge
          className="rounded-full bg-success/10 text-success border-transparent"
          title={k.aiCitedUrl ?? undefined}
          data-testid={`keyword-ai-cited-${k.id}`}
        >
          {t('aiCited')}
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className="rounded-full"
        data-testid={`keyword-ai-not-cited-${k.id}`}
      >
        {t('aiNotCited')}
      </Badge>
    );
  };

  const renderLastChecked = (k: Keyword) => {
    if (isChecking(k)) {
      return renderChecking(k, 'time');
    }
    if (!k.lastCheckedAt) {
      // A recorded failed attempt (no snapshot) reads as "check failed" with
      // its time — distinct from the never-checked "unavailable" state.
      if (k.lastFailedCheckAt !== null) {
        const reason = failureReason(k);
        const failedAt = dateTime.format(new Date(k.lastFailedCheckAt));
        return (
          <Badge
            variant="destructive"
            className="rounded-full"
            title={reason === null ? failedAt : `${failedAt} — ${reason}`}
            aria-label={reason === null ? t('checkErrored') : `${t('checkErrored')}: ${reason}`}
            data-testid={`keyword-check-failed-${k.id}`}
          >
            <time dateTime={k.lastFailedCheckAt}>
              {formatRelativeTime(k.lastFailedCheckAt, i18n.language)}
            </time>
          </Badge>
        );
      }
      return (
        <Badge variant="outline" data-testid={`keyword-unavailable-${k.id}`}>
          {t('unavailable')}
        </Badge>
      );
    }
    return (
      <time dateTime={k.lastCheckedAt} title={dateTime.format(new Date(k.lastCheckedAt))}>
        {formatRelativeTime(k.lastCheckedAt, i18n.language)}
      </time>
    );
  };

  const isSelected = (k: Keyword) => selectedId === k.id;

  return (
    <>
      <div className="hidden rounded-xl border md:block" data-testid="keywords-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/5">{t('columnPhrase')}</TableHead>
              <TableHead>{t('columnLocation')}</TableHead>
              <TableHead>{t('columnDevice')}</TableHead>
              <TableHead className="text-end">
                <TableHeaderHelp
                  label={t('columnPosition')}
                  description={t('common:tableHelp.position')}
                />
              </TableHead>
              <TableHead className="text-end">
                <TableHeaderHelp
                  label={t('columnDelta')}
                  description={t('common:tableHelp.positionDelta')}
                />
              </TableHead>
              <TableHead>
                <TableHeaderHelp
                  label={t('aiColumn')}
                  description={t('common:tableHelp.aiVisibility')}
                />
              </TableHead>
              <TableHead className="text-end">{t('columnLastChecked')}</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">{t('columnActions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keywords.map((k) => (
              <TableRow
                key={k.id}
                data-state={isSelected(k) ? 'selected' : undefined}
                aria-selected={isSelected(k)}
                data-testid={`keyword-row-${k.id}`}
              >
                {/* max-w-0 lets the truncating child cap the column at its 20%
                    share instead of the phrase widening the whole table. */}
                <TableCell className="w-1/5 max-w-0">
                  <button
                    type="button"
                    onClick={() => onSelect(k)}
                    title={k.phrase}
                    className="block w-full truncate text-start font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                    data-testid={`keyword-select-${k.id}`}
                  >
                    {k.phrase}
                  </button>
                  {renderEngineBadge(k)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {locationLabel(k.locationCode)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {t(k.device === 'desktop' ? 'deviceDesktop' : 'deviceMobile')}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {isChecking(k) ? renderChecking(k, 'pos') : positionLabel(k)}
                </TableCell>
                <TableCell className="text-end">{renderDelta(k)}</TableCell>
                <TableCell>{renderAiOverview(k)}</TableCell>
                <TableCell className="text-end">{renderLastChecked(k)}</TableCell>
                <TableCell>{rowMenu(k)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        {keywords.map((k) => (
          <Card key={k.id} data-testid={`keyword-card-${k.id}`}>
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onSelect(k)}
                  className="min-w-0 break-words text-start font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  {k.phrase}
                </button>
                {rowMenu(k)}
              </div>
              {renderEngineBadge(k)}
              <div className="text-muted-foreground text-xs">
                {locationLabel(k.locationCode)} ·{' '}
                {t(k.device === 'desktop' ? 'deviceDesktop' : 'deviceMobile')}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="tabular-nums">
                  {isChecking(k) ? renderChecking(k, 'pos') : positionLabel(k)}
                </span>
                {renderDelta(k)}
                {renderLastChecked(k)}
              </div>
              <div className="flex items-center justify-between text-sm">{renderAiOverview(k)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {pendingRemove ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingRemove(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('removeConfirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('removeConfirmDescription', { phrase: pendingRemove.phrase })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('removeCancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onRemove(pendingRemove);
                  setPendingRemove(null);
                }}
              >
                {t('removeConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
};
