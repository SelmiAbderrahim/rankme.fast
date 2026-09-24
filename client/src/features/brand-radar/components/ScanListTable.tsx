import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Field, FieldLabel } from '@shared/ui/field';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { countryName, languageName } from '@shared/markets';
import type { AsyncStatus, BrandRadarRow, BrandRadarStatus } from '../types';
import { BRAND_RADAR_STATUS_FILTERS, type BrandRadarStatusFilter } from '../urlState';

/** SPEC-A1 status tokens; SPEC-A3 pills. Text is always present, never colour alone. */
export const BRAND_RADAR_STATUS_TONES: Record<BrandRadarStatus, StatusTone> = {
  queued: 'info',
  running: 'info',
  completed: 'success',
  completed_empty: 'muted',
  completed_partial: 'warning',
  failed: 'destructive',
};

interface ScanListTableProps {
  rows: BrandRadarRow[];
  status: AsyncStatus;
  error: string;
  nextCursor: string | null;
  loadingMore: boolean;
  statusFilter: BrandRadarStatusFilter;
  onStatusFilter: (next: BrandRadarStatusFilter) => void;
  onLoadMore: (cursor: string) => void;
  onRetry: () => void;
  onStartScan: () => void;
  /** Opens the stored detail via `?scan=`; an optimistic row has none yet. */
  onOpenScan: (scanId: string) => void;
}

export const ScanListTable = ({
  rows,
  status,
  error,
  nextCursor,
  loadingMore,
  statusFilter,
  onStatusFilter,
  onLoadMore,
  onRetry,
  onStartScan,
  onOpenScan,
}: ScanListTableProps) => {
  const { t, i18n } = useTranslation(['brandRadar', 'language']);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  const number = new Intl.NumberFormat(i18n.language);
  const marketLabel = (row: BrandRadarRow) => {
    const country = row.countryCode
      ? countryName(row.countryCode, i18n.language) ?? t('common:market.unknownCountry')
      : t('common:market.allCountries');
    const language = row.language
      ? languageName(row.language, i18n.language) ?? t('common:market.unknownLanguage')
      : t('common:market.allLanguages');
    return `${country} · ${language}`;
  };

  const visible = statusFilter === 'all' ? rows : rows.filter((row) => row.status === statusFilter);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('list.title')}</CardTitle>
        <CardDescription>{t('list.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="brand-radar-status-filter">{t('list.filter.label')}</FieldLabel>
          <select
            id="brand-radar-status-filter"
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full cursor-pointer rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] sm:w-64"
            data-testid="brand-radar-status-filter"
            value={statusFilter}
            onChange={(event) => onStatusFilter(event.target.value as BrandRadarStatusFilter)}
          >
            {BRAND_RADAR_STATUS_FILTERS.map((option) => (
              <option key={option} value={option}>
                {option === 'all' ? t('list.filter.all') : t(`status.${option}`)}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">{t('list.filter.note')}</p>
        </Field>

        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t('states.error.title')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                {t('list.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {status === 'loading' && rows.length === 0 ? (
          <div
            className="flex flex-col gap-2"
            aria-busy="true"
            aria-live="polite"
            data-testid="brand-radar-list-loading"
          >
            <span className="sr-only">{t('list.loading')}</span>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : null}

        {status !== 'loading' && rows.length === 0 && !error ? (
          <Empty data-testid="brand-radar-list-empty">
            <EmptyHeader>
              <EmptyTitle>{t('states.empty.title')}</EmptyTitle>
              <EmptyDescription>{t('states.empty.description')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" variant="outline" onClick={onStartScan}>
                {t('states.empty.cta')}
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}

        {rows.length > 0 ? (
          <Table>
            <caption className="sr-only">{t('list.title')}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('list.columns.query')}</TableHead>
                <TableHead>{t('list.columns.status')}</TableHead>
                <TableHead>
                  <TableHeaderHelp
                    label={t('list.columns.digest')}
                    description={t('common:tableHelp.digest')}
                  />
                </TableHead>
                <TableHead className="text-end">{t('list.columns.mentions')}</TableHead>
                <TableHead>
                  <TableHeaderHelp
                    label={t('list.columns.refund')}
                    description={t('common:tableHelp.refund')}
                  />
                </TableHead>
                <TableHead>{t('list.columns.created')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('list.columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id} data-testid="brand-radar-row">
                  {/* SEC-OUT: vendor-influenced text renders as a text node. */}
                  <TableCell>
                    <span className="block">{row.brandQuery}</span>
                    <span className="text-muted-foreground block text-xs">
                      {marketLabel(row)}
                    </span>
                    {row.outputLocale ? (
                      <span className="text-muted-foreground block text-xs" data-testid="brand-radar-row-output-locale">
                        {t('outputLocale', {
                          locale: t(`language:names.${row.outputLocale}`),
                        })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusChip tone={BRAND_RADAR_STATUS_TONES[row.status]}>
                      {t(`status.${row.status}`)}
                    </StatusChip>
                  </TableCell>
                  <TableCell>
                    <StatusChip tone="muted">{t(`digest.${row.digestState}`)}</StatusChip>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {row.retainedRowCount === null ? '—' : number.format(row.retainedRowCount)}
                  </TableCell>
                  <TableCell>
                    {/* `none` renders nothing — never "not refunded". */}
                    {row.refundState === 'refunded' ? (
                      <StatusChip tone="success" data-testid="brand-radar-refund-chip">
                        {t('refund.refunded')}
                      </StatusChip>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {row.createdAt === null
                      ? t('list.pendingCreated')
                      : date.format(new Date(row.createdAt))}
                  </TableCell>
                  <TableCell className="text-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="brand-radar-open-scan"
                      onClick={() => onOpenScan(row.id)}
                    >
                      {t('list.open')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}

        {rows.length > 0 && visible.length === 0 ? (
          <p role="status" data-testid="brand-radar-filter-empty">
            {t('states.filtered.description')}
          </p>
        ) : null}
      </CardContent>
      {nextCursor ? (
        <CardFooter>
          <Button
            type="button"
            variant="outline"
            loading={loadingMore}
            loadingLabel={t('list.loading')}
            onClick={() => onLoadMore(nextCursor)}
          >
            {t('list.loadMore')}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
};
