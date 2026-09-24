/**
 * Per-pair gap result tables.
 *
 * Presentation-only: rows arrive verbatim from `POST /gap`; the
 * missing/behind badges are named combinations of the shipped nulls
 * (`classifyGapRow`), never a re-score. Pair selection, the
 * missing/behind/all filter, and the bounded text filter are URL-backed
 * (`pair`, `gapFilter`, `q`). Sorting is deterministic and documented:
 * search volume descending (nulls last), then keyword ascending.
 * The table collapses to stacked cards below `md` per the design system.
 */
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { cn } from '@shared/lib/utils';
import { classifyGapRow, type GapRowKind } from '../validation';
import { GAP_ROW_FILTERS, type GapRowFilter, type KeywordWorkspaceQueryState } from '../tabState';
import { keywordSlug } from './KeywordResearchPanel';
import { ProvenanceBadge, ProvenanceKindChip } from './ProvenanceBadge';
import type { GapPair, GapResponse, GapRow } from '../types';

const KIND_TONE: Record<GapRowKind, StatusTone> = {
  missing: 'destructive',
  behind: 'warning',
  ahead: 'success',
  even: 'info',
  unranked: 'muted',
};

/** Deterministic row order — volume desc (nulls last), then keyword asc. */
export function sortGapRows(rows: readonly GapRow[]): GapRow[] {
  return [...rows].sort((a, b) => {
    if (a.searchVolume === null && b.searchVolume !== null) return 1;
    if (a.searchVolume !== null && b.searchVolume === null) return -1;
    if (a.searchVolume !== null && b.searchVolume !== null && a.searchVolume !== b.searchVolume) {
      return b.searchVolume - a.searchVolume;
    }
    return a.keyword.localeCompare(b.keyword);
  });
}

export function filterGapRows(rows: readonly GapRow[], filter: GapRowFilter, q: string): GapRow[] {
  const needle = q.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter !== 'all' && classifyGapRow(row) !== filter) return false;
    if (needle && !row.keyword.toLowerCase().includes(needle)) return false;
    return true;
  });
}

interface GapResultsTableProps {
  data: GapResponse;
  query: KeywordWorkspaceQueryState;
  onQueryChange: (patch: Partial<KeywordWorkspaceQueryState>) => void;
}

export const GapResultsTable = ({ data, query, onQueryChange }: GapResultsTableProps) => {
  const { t, i18n } = useTranslation();

  const activePair: GapPair | undefined =
    data.pairs.find((p) => p.competitorDomain === query.pair) ?? data.pairs[0];

  const formatVolume = (v: number | null): string =>
    v === null ? t('keywordResearch:unavailable') : new Intl.NumberFormat(i18n.language).format(v);
  const formatPosition = (v: number | null): string =>
    v === null ? t('keywordResearch:unavailable') : new Intl.NumberFormat(i18n.language).format(v);

  if (!activePair) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="kw-gap-empty">
        {t('keywordResearch:gap.emptyResults')}
      </p>
    );
  }

  const rows = filterGapRows(sortGapRows(activePair.rows), query.gapFilter, query.q);

  return (
    <div className="flex flex-col gap-4" data-testid="kw-gap-results">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('keywordResearch:gap.pairPickerLabel')}
      >
        {data.pairs.map((pair) => {
          const selected = pair.competitorDomain === activePair.competitorDomain;
          return (
            <button
              key={pair.competitorDomain}
              type="button"
              aria-pressed={selected}
              onClick={() => onQueryChange({ pair: pair.competitorDomain })}
              data-testid={`kw-gap-pair-${keywordSlug(pair.competitorDomain)}`}
              className={cn(
                'cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background hover:bg-accent',
              )}
            >
              {pair.competitorDomain}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={t('keywordResearch:gap.filterLabel')}
        >
          {GAP_ROW_FILTERS.map((filter) => {
            const selected = query.gapFilter === filter;
            return (
              <button
                key={filter}
                type="button"
                aria-pressed={selected}
                onClick={() => onQueryChange({ gapFilter: filter })}
                data-testid={`kw-gap-filter-${filter}`}
                className={cn(
                  'cursor-pointer rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background hover:bg-accent',
                )}
              >
                {t(`keywordResearch:gap.filter.${filter}`)}
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="kw-gap-q">{t('keywordResearch:gap.searchLabel')}</Label>
          <Input
            id="kw-gap-q"
            value={query.q}
            maxLength={80}
            placeholder={t('keywordResearch:gap.searchPlaceholder')}
            onChange={(e) => onQueryChange({ q: e.target.value })}
            data-testid="kw-gap-q"
            className="w-56"
          />
        </div>
      </div>

      <Card data-testid={`kw-gap-pair-card-${keywordSlug(activePair.competitorDomain)}`}>
        <CardHeader className="flex flex-col gap-2">
          <CardTitle className="text-base">
            {t('keywordResearch:gap.pairTitle', {
              own: data.ownDomain,
              competitor: activePair.competitorDomain,
            })}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusChip
              tone={activePair.cached ? 'muted' : 'success'}
              data-testid="kw-gap-pair-source"
            >
              {activePair.cached
                ? t('keywordResearch:gap.cachedBadge')
                : t('keywordResearch:gap.freshBadge')}
            </StatusChip>
            <ProvenanceBadge meta={activePair.meta} withTimestamps />
          </div>
          <p className="text-muted-foreground text-xs">
            {t('keywordResearch:gap.legendPositions')}{' '}
            <ProvenanceKindChip kind="provider_observation" /> ·{' '}
            {t('keywordResearch:gap.legendVolume')} <ProvenanceKindChip kind="estimate" />
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {activePair.rows.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm" data-testid="kw-gap-pair-empty">
              {t('keywordResearch:gap.emptyPair')}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm" data-testid="kw-gap-no-filter-match">
              {t('keywordResearch:gap.noFilterMatch')}
            </p>
          ) : (
            <>
              <p className="text-muted-foreground px-4 pt-2 text-xs" data-testid="kw-gap-count">
                {t('keywordResearch:gap.resultCount', { count: rows.length })}
              </p>
              {/* ≥ md — full table */}
              <div className="hidden md:block">
                <Table data-testid="kw-gap-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('keywordResearch:gap.columnKeyword')}</TableHead>
                      <TableHead className="text-end">
                        <TableHeaderHelp
                          label={t('keywordResearch:gap.columnOwnPosition')}
                          description={t('common:tableHelp.position')}
                        />
                      </TableHead>
                      <TableHead className="text-end">
                        <TableHeaderHelp
                          label={t('keywordResearch:gap.columnCompetitorPosition')}
                          description={t('common:tableHelp.position')}
                        />
                      </TableHead>
                      <TableHead className="text-end">
                        <TableHeaderHelp
                          label={t('keywordResearch:gap.columnSearchVolume')}
                          description={t('common:tableHelp.searchVolume')}
                        />
                      </TableHead>
                      <TableHead>{t('keywordResearch:gap.columnStatus')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const kind = classifyGapRow(row);
                      return (
                        <TableRow
                          key={row.keyword}
                          data-testid={`kw-gap-row-${keywordSlug(row.keyword)}`}
                        >
                          <TableCell className="max-w-64 truncate" title={row.keyword}>
                            {row.keyword}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {formatPosition(row.ownPosition)}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {formatPosition(row.competitorPosition)}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {formatVolume(row.searchVolume)}
                          </TableCell>
                          <TableCell>
                            <StatusChip tone={KIND_TONE[kind]}>
                              {t(`keywordResearch:gap.badge.${kind}`)}
                            </StatusChip>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {/* < md — stacked cards */}
              <ul className="flex flex-col gap-2 p-3 md:hidden" data-testid="kw-gap-cards">
                {rows.map((row) => {
                  const kind = classifyGapRow(row);
                  return (
                    <li key={row.keyword} className="border-border rounded-md border p-3 text-sm">
                      <p className="font-medium break-words">{row.keyword}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t('keywordResearch:gap.columnOwnPosition')}:{' '}
                        {formatPosition(row.ownPosition)} ·{' '}
                        {t('keywordResearch:gap.columnCompetitorPosition')}:{' '}
                        {formatPosition(row.competitorPosition)} ·{' '}
                        {t('keywordResearch:gap.columnSearchVolume')}:{' '}
                        {formatVolume(row.searchVolume)}
                      </p>
                      <div className="mt-2">
                        <StatusChip tone={KIND_TONE[kind]}>
                          {t(`keywordResearch:gap.badge.${kind}`)}
                        </StatusChip>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
