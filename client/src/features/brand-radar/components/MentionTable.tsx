import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { safeExternalHref } from '@shared/security';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Field, FieldLabel } from '@shared/ui/field';
import { Input } from '@shared/ui/input';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type { AsyncStatus, BrandRadarMentionRow, BrandRadarPolarity } from '../types';
import { BRAND_RADAR_SENTIMENT_FILTERS, type BrandRadarSentimentFilter } from '../urlState';

export const BRAND_RADAR_POLARITY_TONES: Record<BrandRadarPolarity, StatusTone> = {
  positive: 'success',
  neutral: 'muted',
  negative: 'destructive',
};

/** Anchor id a digest citation links to; one owner of the string shape. */
export const brandRadarMentionAnchor = (mentionId: string): string =>
  `brand-radar-mention-${mentionId}`;

export interface BrandRadarMentionFilters {
  sentiment: BrandRadarSentimentFilter;
  domain: string;
  from: string;
  to: string;
}

/**
 * Filter the LOADED page. The server exposes no filter parameters on the
 * mention read, so this is deliberately client-side and the UI says so.
 */
export function filterBrandRadarMentions(
  rows: readonly BrandRadarMentionRow[],
  filters: BrandRadarMentionFilters,
): BrandRadarMentionRow[] {
  return rows.filter((row) => {
    if (filters.sentiment !== 'all' && row.polarity !== filters.sentiment) return false;
    if (filters.domain && !row.domain.toLowerCase().includes(filters.domain)) return false;
    if (filters.from || filters.to) {
      // A row with no observation date cannot satisfy a date window.
      if (row.observedAt === null) return false;
      const day = row.observedAt.slice(0, 10);
      if (filters.from && day < filters.from) return false;
      if (filters.to && day > filters.to) return false;
    }
    return true;
  });
}

interface MentionTableProps {
  rows: BrandRadarMentionRow[];
  status: AsyncStatus;
  error: string;
  filters: BrandRadarMentionFilters;
  nextCursor: string | null;
  loadingMore: boolean;
  onSentiment: (next: BrandRadarSentimentFilter) => void;
  onDomain: (next: string) => void;
  onFrom: (next: string) => void;
  onTo: (next: string) => void;
  onLoadMore: (cursor: string) => void;
  onExport: () => void;
}

export const MentionTable = ({
  rows,
  status,
  error,
  filters,
  nextCursor,
  loadingMore,
  onSentiment,
  onDomain,
  onFrom,
  onTo,
  onLoadMore,
  onExport,
}: MentionTableProps) => {
  const { t, i18n } = useTranslation('brandRadar');
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );
  const visible = useMemo(() => filterBrandRadarMentions(rows, filters), [rows, filters]);

  return (
    <section className="flex flex-col gap-4" data-testid="brand-radar-mentions">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-sm font-semibold">{t('detail.mentions.title')}</h3>
        <div className="flex flex-col items-start gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="brand-radar-export"
            disabled={visible.length === 0}
            onClick={onExport}
          >
            {t('detail.mentions.export')}
          </Button>
          <p className="text-muted-foreground text-xs">{t('detail.mentions.exportFree')}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field>
          <FieldLabel htmlFor="brand-radar-sentiment-filter">
            {t('detail.mentions.filters.sentiment')}
          </FieldLabel>
          <select
            id="brand-radar-sentiment-filter"
            data-testid="brand-radar-sentiment-filter"
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full cursor-pointer rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px]"
            value={filters.sentiment}
            onChange={(event) => onSentiment(event.target.value as BrandRadarSentimentFilter)}
          >
            {BRAND_RADAR_SENTIMENT_FILTERS.map((option) => (
              <option key={option} value={option}>
                {t(`detail.mentions.sentiment.${option}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="brand-radar-domain-filter">
            {t('detail.mentions.filters.domain')}
          </FieldLabel>
          <Input
            id="brand-radar-domain-filter"
            data-testid="brand-radar-domain-filter"
            value={filters.domain}
            onChange={(event) => onDomain(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="brand-radar-from-filter">
            {t('detail.mentions.filters.from')}
          </FieldLabel>
          <Input
            id="brand-radar-from-filter"
            data-testid="brand-radar-from-filter"
            type="date"
            value={filters.from}
            onChange={(event) => onFrom(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="brand-radar-to-filter">{t('detail.mentions.filters.to')}</FieldLabel>
          <Input
            id="brand-radar-to-filter"
            data-testid="brand-radar-to-filter"
            type="date"
            value={filters.to}
            onChange={(event) => onTo(event.target.value)}
          />
        </Field>
      </div>
      <p className="text-muted-foreground text-xs">{t('detail.mentions.filterNote')}</p>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t('detail.mentions.errorTitle')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {status === 'loading' && rows.length === 0 ? (
        <div
          className="flex flex-col gap-2"
          aria-busy="true"
          aria-live="polite"
          data-testid="brand-radar-mentions-loading"
        >
          <span className="sr-only">{t('detail.mentions.loading')}</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}

      {rows.length > 0 && visible.length === 0 ? (
        <p role="status" data-testid="brand-radar-mentions-filtered">
          {t('detail.mentions.filteredEmpty')}
        </p>
      ) : null}

      {visible.length > 0 ? (
        <Table>
          <caption className="sr-only">{t('detail.mentions.title')}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('detail.mentions.columns.title')}</TableHead>
              <TableHead>{t('detail.mentions.columns.snippet')}</TableHead>
              <TableHead>{t('detail.mentions.columns.domain')}</TableHead>
              <TableHead>
                <TableHeaderHelp
                  label={t('detail.mentions.columns.sentiment')}
                  description={t('common:tableHelp.sentiment')}
                />
              </TableHead>
              <TableHead>{t('detail.mentions.columns.observedAt')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow
                key={row.id}
                id={brandRadarMentionAnchor(row.id)}
                data-testid="brand-radar-mention-row"
              >
                {/* SEC-OUT: every vendor field is a React text node. */}
                <TableCell>{row.title}</TableCell>
                <TableCell className="max-w-md">{row.snippet}</TableCell>
                <TableCell>
                  {row.url === null ? (
                    // The server refused the stored scheme — no anchor at all.
                    <span data-testid="brand-radar-mention-plain-domain">{row.domain}</span>
                  ) : (
                    <a
                      href={safeExternalHref(row.url)}
                      rel="nofollow ugc noopener noreferrer"
                      target="_blank"
                      className="underline underline-offset-2"
                      data-testid="brand-radar-mention-link"
                    >
                      {row.domain}
                    </a>
                  )}
                </TableCell>
                <TableCell>
                  <StatusChip tone={BRAND_RADAR_POLARITY_TONES[row.polarity]}>
                    {t(`detail.mentions.sentiment.${row.polarity}`)}
                  </StatusChip>
                </TableCell>
                <TableCell>
                  {row.observedAt === null
                    ? t('detail.mentions.noObservedAt')
                    : date.format(new Date(row.observedAt))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {nextCursor ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={loadingMore}
            loadingLabel={t('detail.mentions.loading')}
            data-testid="brand-radar-mentions-more"
            onClick={() => onLoadMore(nextCursor)}
          >
            {t('detail.mentions.loadMore')}
          </Button>
        </div>
      ) : null}
    </section>
  );
};
