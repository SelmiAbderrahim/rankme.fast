import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Field, FieldGroup, FieldLabel } from '@shared/ui/field';
import { Input } from '@shared/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { Skeleton } from '@shared/ui/skeleton';
import { Spinner } from '@shared/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { exportReviewInventory } from '../api';
import { downloadCsv } from '../csv';
import { hasActiveReviewFilter, isReviewSourceName, writeReviewFilters } from '../filters';
import {
  REVIEW_INVENTORY_SORTS,
  REVIEW_ROW_TEXT_MAX_CHARS,
  REVIEW_SOURCES,
  type ReviewInventoryFilters,
  type ReviewInventoryResponse,
  type ReviewRequestStatus,
} from '../types';
import { ReviewObservationMeta } from './ReviewObservationMeta';

interface ReviewInventoryTableProps {
  profileId: string;
  filters: ReviewInventoryFilters;
  data: ReviewInventoryResponse | null;
  status: ReviewRequestStatus;
  error: string;
}

/** Server text is already clamped to 1000 chars; the row cell clamps again. */
export function clampReviewText(text: string): string {
  const glyphs = [...text];
  return glyphs.length > REVIEW_ROW_TEXT_MAX_CHARS
    ? `${glyphs.slice(0, REVIEW_ROW_TEXT_MAX_CHARS).join('')}…`
    : text;
}

/**
 * Inventory table with URL-backed filters (`?src=` `?rating=` `?q=` `?page=`).
 *
 * Review text, titles and author names are untrusted vendor content: every
 * one is rendered as a React TEXT NODE. `dangerouslySetInnerHTML` is not used
 * anywhere in this feature, and the CSV export routes every cell through the
 * shared `neutralizeExportCell` path.
 */
export const ReviewInventoryTable = ({
  profileId,
  filters,
  data,
  status,
  error,
}: ReviewInventoryTableProps) => {
  const { t, i18n } = useTranslation('reviewIntelligence');
  const [params, setParams] = useSearchParams();
  const [draftQuery, setDraftQuery] = useState(filters.q ?? '');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );

  // Keep the search box honest when the URL changes underneath it (back/
  // forward, a cleared filter, a deep link opened in a new tab).
  useEffect(() => {
    setDraftQuery(filters.q ?? '');
  }, [filters.q]);

  const patch = (next: Parameters<typeof writeReviewFilters>[1]) => {
    setParams(writeReviewFilters(params, next), { replace: true });
  };

  const rows = data?.reviews ?? [];
  const filtered = hasActiveReviewFilter(filters);
  const sort = filters.sort ?? 'newest';

  const exportAll = async () => {
    setExporting(true);
    setExportError('');
    try {
      const csv = await exportReviewInventory(profileId, filters);
      if (!downloadCsv('reviews.csv', csv)) {
        setExportError(t('inventory.exportFailed'));
      }
    } catch {
      setExportError(t('inventory.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card data-testid="reviews-inventory">
      <CardHeader>
        <CardTitle>{t('inventory.title')}</CardTitle>
        <CardDescription>{t('inventory.description')}</CardDescription>
        <ReviewObservationMeta observation={data?.observation ?? null} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup className="flex-row flex-wrap items-end gap-3">
          <Field className="w-auto gap-1">
            <FieldLabel htmlFor="reviews-filter-source">{t('inventory.filterSource')}</FieldLabel>
            <Select
              value={filters.src ?? 'all'}
              onValueChange={(value) => {
                patch({ src: isReviewSourceName(value) ? value : null });
              }}
            >
              <SelectTrigger id="reviews-filter-source" data-testid="reviews-filter-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">{t('inventory.filterAll')}</SelectItem>
                  {REVIEW_SOURCES.map((source) => (
                    <SelectItem key={source} value={source}>
                      {t(`sourceNames.${source}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="w-auto gap-1">
            <FieldLabel htmlFor="reviews-filter-rating">{t('inventory.filterRating')}</FieldLabel>
            <Select
              value={filters.rating === undefined ? 'all' : String(filters.rating)}
              onValueChange={(selected) => {
                const value = Number(selected);
                patch({
                  rating: Number.isInteger(value) && value >= 1 && value <= 5 ? value : null,
                });
              }}
            >
              <SelectTrigger id="reviews-filter-rating" data-testid="reviews-filter-rating">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">{t('inventory.filterAll')}</SelectItem>
                  {[5, 4, 3, 2, 1].map((star) => (
                    <SelectItem key={star} value={String(star)}>
                      {t('inventory.stars', { stars: star })}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="w-auto gap-1">
            <FieldLabel htmlFor="reviews-sort">{t('inventory.sortLabel')}</FieldLabel>
            <Select
              value={sort}
              onValueChange={(value) => {
                // Radix can only emit one of the three SelectItem values
                // declared immediately below; hand-edited URLs still pass
                // through `isReviewInventorySort` in `readReviewFilters`.
                patch({ sort: value as ReviewInventoryFilters['sort'] });
              }}
            >
              <SelectTrigger id="reviews-sort" data-testid="reviews-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {REVIEW_INVENTORY_SORTS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`inventory.sort.${value}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              patch({ q: draftQuery });
            }}
          >
            <Field className="gap-1">
              <FieldLabel htmlFor="reviews-filter-query">{t('inventory.filterQuery')}</FieldLabel>
              <Input
                id="reviews-filter-query"
                value={draftQuery}
                maxLength={120}
                placeholder={t('inventory.searchPlaceholder')}
                onChange={(event) => setDraftQuery(event.target.value)}
                data-testid="reviews-filter-query"
              />
            </Field>
            <Button type="submit" variant="outline" data-testid="reviews-filter-apply">
              {t('inventory.apply')}
            </Button>
          </form>
          {filtered ? (
            <Button
              type="button"
              variant="ghost"
              data-testid="reviews-filter-clear"
              onClick={() => patch({ src: null, rating: null, q: null })}
            >
              {t('inventory.clearFilters')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={!data || data.total === 0 || exporting}
            data-testid="reviews-export"
            onClick={() => void exportAll()}
          >
            {exporting ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Download aria-hidden="true" data-icon="inline-start" />
            )}
            {exporting ? t('inventory.exportLoading') : t('inventory.export')}
          </Button>
        </FieldGroup>
        <p className="text-muted-foreground text-xs">{t('inventory.exportFree')}</p>
        {exportError ? (
          <Alert role="alert" data-testid="reviews-export-error">
            <AlertDescription>{exportError}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert role="alert" data-testid="reviews-inventory-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {status === 'loading' && rows.length === 0 ? (
          <div
            className="flex flex-col gap-2"
            aria-busy="true"
            data-testid="reviews-inventory-loading"
          >
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : null}

        {status !== 'loading' && rows.length === 0 && !error ? (
          <p
            className="text-muted-foreground text-sm"
            data-testid={filtered ? 'reviews-inventory-no-matches' : 'reviews-inventory-empty'}
          >
            {filtered ? t('inventory.noMatches') : t('inventory.empty')}
          </p>
        ) : null}

        {data !== null && rows.length > 0 ? (
          <>
            <Table>
              <caption className="sr-only">{t('inventory.title')}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="text-end"
                    aria-sort={sort === 'rating-high' ? 'descending' : 'none'}
                  >
                    {t('inventory.columns.rating')}
                  </TableHead>
                  <TableHead aria-sort={sort === 'newest' ? 'descending' : 'none'}>
                    {t('inventory.columns.reviewedAt')}
                  </TableHead>
                  <TableHead aria-sort={sort === 'source' ? 'ascending' : 'none'}>
                    <TableHeaderHelp
                      label={t('inventory.columns.source')}
                      description={t('common:tableHelp.reviewSource')}
                    />
                  </TableHead>
                  <TableHead>{t('inventory.columns.text')}</TableHead>
                  <TableHead>{t('inventory.columns.author')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid={`reviews-row-${row.id}`}>
                    <TableCell className="text-end tabular-nums">
                      {row.rating === null ? t('inventory.unrated') : row.rating}
                    </TableCell>
                    <TableCell>
                      {row.reviewedAt ? date.format(new Date(row.reviewedAt)) : '—'}
                    </TableCell>
                    <TableCell>{t(`sourceNames.${row.source}`)}</TableCell>
                    <TableCell className="max-w-md">
                      {row.title ? (
                        <span className="block font-medium">{clampReviewText(row.title)}</span>
                      ) : null}
                      <span className="block">{clampReviewText(row.text)}</span>
                    </TableCell>
                    <TableCell>{row.authorDisplayName || t('inventory.anonymous')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-sm" data-testid="reviews-inventory-page">
                {t('inventory.page', { page: filters.page, total: data.total })}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={filters.page <= 1}
                  data-testid="reviews-page-previous"
                  onClick={() => patch({ page: filters.page - 1 })}
                >
                  {t('inventory.previous')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!data.hasMore}
                  data-testid="reviews-page-next"
                  onClick={() => patch({ page: filters.page + 1 })}
                >
                  {t('inventory.next')}
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
};
