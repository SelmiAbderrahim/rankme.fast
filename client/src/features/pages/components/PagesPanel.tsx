import { isolateDominant, isolateText } from '@shared/lib/bidi';
import { Bdi } from '@shared/components/Bdi';
import { CrawlStopReasonNote } from '@shared/components/CrawlStopReasonNote';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  ExternalLink,
  FileSearch,
  FilterX,
  Info,
  RefreshCw,
  RotateCcw,
  Search,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { Button } from '@shared/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/ui/empty';
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
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security/output-encoding';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { cn } from '@/shared/lib/utils';
import { formatCountryFromLocation, languageName } from '@shared/markets';
import { DEFAULT_PAGES_URL_STATE, pagesListQueryFromUrlState, usePagesUrlState } from '../urlState';
import { PAGES_RANGES } from '../types';
import type {
  PageRow,
  PagesDirection,
  PagesEnvelope,
  PagesIndexability,
  PagesInsight,
  PagesLastCrawl,
  PagesLimit,
  PagesListQuery,
  PagesListResponse,
  PagesLoadState,
  PagesSort,
  PagesSourceCapabilities,
  PagesVisibility,
} from '../types';
import { enterPagesSite, loadPagesDetail, loadPagesList, refreshPages } from '../store/thunks';
import {
  pagesSourceCapabilities,
  selectPagesDetailEntry,
  selectPagesDetailLoadState,
  selectPagesListEntry,
  selectPagesListLoadState,
  selectPagesRefresh,
} from '../store/selectors';
import {
  formatPagesDate,
  formatPagesDay,
  formatPagesMetric,
  formatPagesNumber,
  formatSignedPagesValue,
  pagesPathLabel,
  pagesRowName,
  type PagesMetricKey,
} from '../formatters';
import { crawlStateLabel } from '../crawlState';
import {
  PAGES_METRIC_COLUMNS,
  PAGES_TOGGLEABLE_COLUMNS,
  isPagesColumnAvailable,
  usePagesColumns,
  type PagesColumnId,
  type PagesColumnsController,
} from '../columns';
import { PageDetailSheet } from './PageDetailSheet';
import { HorizontalScrollRegion } from './HorizontalScrollRegion';
import { GscTotalsNote, SiteGoogleNotice } from '@features/google';
import { ReportExportControl } from '@features/report-export';
import { PositionDelta } from '@shared/components/PositionDelta';

interface PagesPanelProps {
  siteId: string;
}

const ALL_VALUE = 'all';
const SUMMARY_METRICS_GSC: PagesMetricKey[] = ['clicks', 'impressions', 'ctr', 'averagePosition'];
const SUMMARY_METRICS_FALLBACK: PagesMetricKey[] = [
  'averagePosition',
  'keywordCount',
  'searchVolume',
  'estimatedTraffic',
  'clicks',
  'impressions',
  'ctr',
];

const selectValue = <T extends string>(value: string): T | null =>
  value === ALL_VALUE ? null : (value as T);

function metricSort(metric: PagesMetricKey): PagesSort {
  if (metric === 'averagePosition') return 'average_position';
  if (metric === 'bestPosition') return 'best_position';
  if (metric === 'keywordCount') return 'keyword_count';
  if (metric === 'searchVolume') return 'search_volume';
  if (metric === 'estimatedTraffic') return 'estimated_traffic';
  return metric;
}

function sourceStatusVariant(
  status: PagesEnvelope['status'],
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'unavailable') return 'destructive';
  if (status === 'stale' || status === 'syncing') return 'secondary';
  if (status === 'ready') return 'default';
  return 'outline';
}

/**
 * A missing value renders as a quiet dash so an unmeasured row does not turn
 * into a wall of words; screen readers still hear "Not available".
 */
function NotAvailableValue({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground" data-testid="pages-not-available">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

interface MetricValueProps {
  metric: PagesMetricKey;
  row: PageRow;
  locale: string;
  notAvailable: string;
}

function MetricValue({ metric, row, locale, notAvailable }: MetricValueProps) {
  const value = formatPagesMetric(locale, metric, row.metrics[metric]);
  return value === null ? (
    <NotAvailableValue label={notAvailable} />
  ) : (
    <span dir="ltr">{value}</span>
  );
}

/**
 * The associated-query count in three honest states: a real number, a dash
 * plus the reason when Google reported impressions but withheld the query text
 * (0 visible queries, not "no queries"), and a plain dash when nothing is
 * stored. A bare 0 would read as "this page earns no searches".
 */
function QueryCountValue({
  row,
  locale,
  notAvailable,
}: {
  row: PageRow;
  locale: string;
  notAvailable: string;
}) {
  const { t } = useTranslation('pages');
  if (row.associatedQueryState === 'anonymized') {
    return (
      <span data-testid="pages-queries-anonymized">
        <span aria-hidden="true" className="text-muted-foreground">
          —
        </span>
        <span className="block text-xs text-muted-foreground">{t('queries.anonymized')}</span>
      </span>
    );
  }
  const count = formatPagesNumber(locale, row.metrics.associatedQueryCount);
  return count === null ? (
    <NotAvailableValue label={notAvailable} />
  ) : (
    <span dir="ltr">{count}</span>
  );
}

/** Pinned cells cast a shadow over the columns sliding beneath them once the table scrolls. */
const PINNED_SHADOW =
  'group-data-[scrolled=true]/scroll:ltr:shadow-[6px_0_8px_-6px_color-mix(in_oklab,var(--foreground)_30%,transparent)] group-data-[scrolled=true]/scroll:rtl:shadow-[-6px_0_8px_-6px_color-mix(in_oklab,var(--foreground)_30%,transparent)]';

function columnLabelKey(column: PagesColumnId): string {
  if (column === 'source') return 'table.source';
  if (column === 'crawl') return 'table.crawl';
  if (column === 'insights') return 'table.insights';
  if (column === 'positionChange') return 'deltas.position';
  return `metrics.${column}`;
}

function PagesColumnPicker({
  columns,
  capabilities,
}: {
  columns: PagesColumnsController;
  capabilities: PagesSourceCapabilities;
}) {
  const { t } = useTranslation('pages');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Columns3 aria-hidden="true" />
          {t('table.columns.button')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>{t('table.columns.menuLabel')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PAGES_TOGGLEABLE_COLUMNS.map((column) => {
          // A column this source cannot fill would only ever show dashes.
          const unavailable = !isPagesColumnAvailable(column, capabilities);
          return (
            <DropdownMenuCheckboxItem
              key={column}
              checked={!unavailable && columns.visibility[column]}
              disabled={unavailable}
              onCheckedChange={(checked) => columns.setVisible(column, checked)}
              onSelect={(event) => event.preventDefault()}
            >
              {t(columnLabelKey(column))}
              {unavailable ? (
                <span className="ms-auto ps-2 text-xs text-muted-foreground">
                  {t('table.columns.notForSource')}
                </span>
              ) : null}
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!columns.customized} onSelect={columns.reset}>
          {t('table.columns.reset')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface SourceStateNoticeProps {
  envelope: PagesEnvelope;
}

/**
 * Source freshness and failure guidance. Why Search Console is not the source
 * (not connected, no property, wrong property) is the shared Google readiness
 * notice's job, so this notice never carries a Google CTA.
 * The header holds the page's one collect/refresh button,
 * and an empty source is the neutral no-data state, not an alert.
 */
function SourceStateNotice({ envelope }: SourceStateNoticeProps) {
  const { t } = useTranslation('pages');
  if (envelope.status === 'ready' || envelope.status === 'empty') return null;
  const isUnavailable = envelope.status === 'unavailable';

  return (
    <Alert
      variant={isUnavailable ? 'destructive' : 'default'}
      role={isUnavailable ? 'alert' : 'status'}
    >
      {isUnavailable ? <AlertCircle aria-hidden="true" /> : <Info aria-hidden="true" />}
      <AlertTitle>{t(`states.${envelope.status}.title`)}</AlertTitle>
      <AlertDescription>
        <p>{t(`states.${envelope.status}.${envelope.source}`)}</p>
      </AlertDescription>
    </Alert>
  );
}

/**
 * What the last completed crawl recorded about itself, so a short page list
 * says why it is short. Only stored evidence is shown;
 * a crawl with no recorded stop reason says so.
 */
function LastCrawlNote({ crawl, siteId }: { crawl: PagesLastCrawl; siteId: string }) {
  const { t } = useTranslation('pages');
  return (
    <div className="flex flex-col gap-1" data-testid="pages-last-crawl">
      <p>
        {crawl.pagesStored === null ? null : (
          <>
            <TableHeaderHelp
              label={t('crawl.pages', { count: crawl.pagesStored })}
              labelText={t('crawl.fetchedLabel')}
              description={t('crawl.fetchedHelp')}
            />{' '}
          </>
        )}
        <CrawlStopReasonNote
          stopReason={crawl.stopReason}
          stopReasonSource={crawl.stopReasonSource}
          pageCap={crawl.pageCap}
          siteId={siteId}
          testId="pages-crawl-stop-reason"
        />
      </p>
      {crawl.sitemapFound === false ? (
        <p data-testid="pages-crawl-no-sitemap">{t('crawl.noSitemap')}</p>
      ) : null}
    </div>
  );
}

interface PagesFiltersProps {
  query: PagesListQuery;
  capabilities: PagesSourceCapabilities;
  searchDraft: string;
  onSearchDraft: (value: string) => void;
  onContext: (patch: Partial<PagesListQuery>) => void;
  onReset: () => void;
  disabled: boolean;
}

function PagesFilters({
  query,
  capabilities,
  searchDraft,
  onSearchDraft,
  onContext,
  onReset,
  disabled,
}: PagesFiltersProps) {
  const { t } = useTranslation('pages');
  const supportedInsights = capabilities.supportedInsights;
  const supportedSorts = capabilities.supportedSorts;
  const active = [
    query.q ? t('filters.activeSearch', { value: query.q }) : null,
    query.insight ? t(`insights.${query.insight}.label`) : null,
    query.indexability ? t(`filters.indexabilityOptions.${query.indexability}`) : null,
    query.visibility ? t(`filters.visibilityOptions.${query.visibility}`) : null,
  ].filter((value): value is string => value !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('filters.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('filters.description')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field className="md:col-span-2">
            <FieldLabel htmlFor="pages-search">{t('filters.searchLabel')}</FieldLabel>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="pages-search"
                type="search"
                value={searchDraft}
                onChange={(event) => onSearchDraft(event.target.value)}
                placeholder={t('filters.searchPlaceholder')}
                className="ps-9"
                maxLength={200}
              />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="pages-insight">{t('filters.insight')}</FieldLabel>
            <Select
              value={query.insight ?? ALL_VALUE}
              onValueChange={(value) => onContext({ insight: selectValue<PagesInsight>(value) })}
              disabled={disabled}
            >
              <SelectTrigger id="pages-insight" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL_VALUE}>{t('filters.allInsights')}</SelectItem>
                  {supportedInsights.map((insight) => (
                    <SelectItem key={insight} value={insight}>
                      {t(`insights.${insight}.label`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="pages-indexability">{t('filters.indexability')}</FieldLabel>
            <Select
              value={query.indexability ?? ALL_VALUE}
              onValueChange={(value) =>
                onContext({
                  indexability: selectValue<PagesIndexability>(value),
                })
              }
              disabled={disabled}
            >
              <SelectTrigger id="pages-indexability" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL_VALUE}>{t('filters.allIndexability')}</SelectItem>
                  <SelectItem value="indexable">
                    {t('filters.indexabilityOptions.indexable')}
                  </SelectItem>
                  <SelectItem value="non_indexable">
                    {t('filters.indexabilityOptions.non_indexable')}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="pages-visibility">{t('filters.visibility')}</FieldLabel>
            <Select
              value={query.visibility ?? ALL_VALUE}
              onValueChange={(value) =>
                onContext({ visibility: selectValue<PagesVisibility>(value) })
              }
              disabled={disabled}
            >
              <SelectTrigger id="pages-visibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL_VALUE}>{t('filters.allVisibility')}</SelectItem>
                  <SelectItem value="measured">
                    {t('filters.visibilityOptions.measured')}
                  </SelectItem>
                  <SelectItem value="unmeasured">
                    {t('filters.visibilityOptions.unmeasured')}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="pages-sort">{t('filters.sort')}</FieldLabel>
            <Select
              value={query.sort}
              onValueChange={(value) => onContext({ sort: value as PagesSort })}
              disabled={disabled}
            >
              <SelectTrigger id="pages-sort" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {supportedSorts.map((sort) => (
                    <SelectItem key={sort} value={sort}>
                      {t(`sorts.${sort}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="pages-direction">{t('filters.direction')}</FieldLabel>
            <Select
              value={query.direction}
              onValueChange={(value) => onContext({ direction: value as PagesDirection })}
              disabled={disabled}
            >
              <SelectTrigger id="pages-direction" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="desc">{t('filters.descending')}</SelectItem>
                  <SelectItem value="asc">{t('filters.ascending')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="pages-limit">{t('filters.pageSize')}</FieldLabel>
            <Select
              value={String(query.limit)}
              onValueChange={(value) => onContext({ limit: Number(value) as PagesLimit })}
              disabled={disabled}
            >
              <SelectTrigger id="pages-limit" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {[25, 50, 100].map((limit) => (
                    <SelectItem key={limit} value={String(limit)}>
                      {t('filters.perPage', { count: limit })}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-muted-foreground" role="status">
            {active.length > 0
              ? t('filters.active', { context: active.join(', ') })
              : t('filters.noneActive')}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onReset} disabled={disabled}>
            <FilterX aria-hidden="true" />
            {t('actions.resetFilters')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface SortHeaderProps {
  sort: PagesSort;
  query: PagesListQuery;
  label: string;
  onSort: (sort: PagesSort) => void;
  className?: string;
}

function SortHeader({ sort, query, label, onSort, className }: SortHeaderProps) {
  const active = query.sort === sort;
  const ariaSort = active ? (query.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <TableHead aria-sort={ariaSort} className={className}>
      <Button type="button" variant="ghost" size="sm" onClick={() => onSort(sort)}>
        {label}
        {active ? (
          query.direction === 'asc' ? (
            <ArrowUp aria-hidden="true" />
          ) : (
            <ArrowDown aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown aria-hidden="true" />
        )}
      </Button>
    </TableHead>
  );
}

interface PageInsightsProps {
  row: PageRow;
}

/** The insight chips (or the quiet "none" note) without a wrapper, so the phone row can share one chip line. */
function PageInsightChips({ row }: PageInsightsProps) {
  const { t } = useTranslation('pages');
  if (row.insights.length === 0)
    return <span className="text-muted-foreground">{t('insights.none')}</span>;
  return (
    <>
      {row.insights.map((insight) => (
        <Badge key={insight} variant="secondary">
          {t(`insights.${insight}.label`)}
        </Badge>
      ))}
    </>
  );
}

function PageInsights({ row }: PageInsightsProps) {
  return (
    <div className="flex max-w-64 flex-wrap gap-1">
      <PageInsightChips row={row} />
    </div>
  );
}

interface PagesResultsProps {
  rows: PageRow[];
  envelope: PagesEnvelope;
  query: PagesListQuery;
  capabilities: PagesSourceCapabilities;
  locale: string;
  backgroundLoading: boolean;
  onSort: (sort: PagesSort) => void;
  onDetail: (pageId: string, trigger: HTMLButtonElement) => void;
}

function PagesResults({
  rows,
  envelope,
  query,
  capabilities,
  locale,
  backgroundLoading,
  onSort,
  onDetail,
}: PagesResultsProps) {
  const { t } = useTranslation('pages');
  const notAvailable = t('common.notAvailable');
  // The server decides the crawl state once; the inspector words it with the
  // same helper, so the two surfaces cannot disagree (issues #48, #4b).
  const crawlLabel = (row: PageRow): string => crawlStateLabel(t, row);
  const columns = usePagesColumns(envelope, capabilities);
  const shown = columns.visibility;
  const metricColumns = PAGES_METRIC_COLUMNS.filter((metric) => shown[metric]);

  return (
    <div
      // `@container`: the table needs about 56rem, so the compact cards are
      // used below that panel width, on tablets too, not only on phones.
      // Wider panels keep the scrollable table.
      className={cn('@container flex min-w-0 flex-col gap-3', backgroundLoading && 'opacity-60')}
      aria-busy={backgroundLoading}
      data-testid="pages-results"
    >
      <div className="flex justify-end">
        <PagesColumnPicker columns={columns} capabilities={capabilities} />
      </div>
      <HorizontalScrollRegion className="hidden @4xl:block">
        <div className="min-w-0" data-testid="pages-desktop-table">
          <Table>
            <caption className="sr-only">{t('table.caption')}</caption>
            <TableHeader>
              <TableRow>
                <SortHeader
                  sort="url"
                  query={query}
                  label={t('table.page')}
                  onSort={onSort}
                  className={cn(
                    'sticky start-0 z-10 border-e border-border bg-background',
                    PINNED_SHADOW,
                  )}
                />
                {shown.source ? <TableHead>{t('table.source')}</TableHead> : null}
                {shown.crawl ? <TableHead>{t('table.crawl')}</TableHead> : null}
                {shown.insights ? <TableHead>{t('table.insights')}</TableHead> : null}
                {metricColumns.map((metric) => (
                  // Only metrics the source can fill are shown, and every one of
                  // those has a server sort.
                  <SortHeader
                    key={metric}
                    sort={metricSort(metric)}
                    query={query}
                    label={t(`metrics.${metric}`)}
                    onSort={onSort}
                  />
                ))}
                {shown.associatedQueryCount ? (
                  <TableHead>{t('metrics.associatedQueryCount')}</TableHead>
                ) : null}
                {shown.positionChange ? (
                  <SortHeader
                    sort="position_change"
                    query={query}
                    label={t('deltas.position')}
                    onSort={onSort}
                  />
                ) : null}
                <TableHead>{t('table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.pageId} data-testid="pages-desktop-row">
                  <TableCell
                    className={cn(
                      'sticky start-0 z-10 border-e border-border bg-background',
                      PINNED_SHADOW,
                    )}
                  >
                    <div
                      className="flex w-72 min-w-0 flex-col gap-1 lg:w-80"
                      data-testid="pages-page-cell"
                    >
                      <span className="truncate font-medium" title={isolateDominant(pagesRowName(row))}>
                        <Bdi dominant>{pagesRowName(row)}</Bdi>
                      </span>
                      {/* eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL includes noopener and noreferrer. */}
                      <a
                        href={safeExternalHref(row.url)}
                        target="_blank"
                        rel={SAFE_EXTERNAL_REL}
                        title={isolateText(row.url)}
                        dir="ltr"
                        className="inline-flex w-fit min-w-0 max-w-full items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="truncate">{pagesPathLabel(row.displayUrl)}</span>
                        <ExternalLink aria-hidden="true" className="shrink-0" />
                      </a>
                    </div>
                  </TableCell>
                  {shown.source ? (
                    <TableCell>
                      <Badge variant={row.performanceSource ? 'secondary' : 'outline'}>
                        {row.performanceSource
                          ? t(`sources.${row.performanceSource}.short`)
                          : t('sources.unmeasured')}
                      </Badge>
                    </TableCell>
                  ) : null}
                  {shown.crawl ? <TableCell>{crawlLabel(row)}</TableCell> : null}
                  {shown.insights ? (
                    <TableCell className="whitespace-normal">
                      <PageInsights row={row} />
                    </TableCell>
                  ) : null}
                  {metricColumns.map((metric) => (
                    <TableCell key={metric}>
                      <MetricValue
                        metric={metric}
                        row={row}
                        locale={locale}
                        notAvailable={notAvailable}
                      />
                    </TableCell>
                  ))}
                  {shown.associatedQueryCount ? (
                    <TableCell>
                      <QueryCountValue row={row} locale={locale} notAvailable={notAvailable} />
                    </TableCell>
                  ) : null}
                  {shown.positionChange ? (
                    <TableCell>
                      <PositionDelta
                        change={row.deltas.position}
                        fallbackDelta={row.deltas.positionChange}
                        testId="pages-position-delta"
                      />
                      {row.deltas.clickChangePct !== null ? (
                        <span className="block text-xs text-muted-foreground">
                          {t('deltas.clicks', {
                            value: formatSignedPagesValue(locale, row.deltas.clickChangePct, true),
                          })}
                        </span>
                      ) : null}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(event) => onDetail(row.pageId, event.currentTarget)}
                    >
                      {t('actions.inspect')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </HorizontalScrollRegion>

      {/* Compact phone rows: title and Inspect share the
          first line, the path and chips follow, and the metrics sit in a
          tight three-column grid, so 25 rows no longer span ~12,000px. */}
      <div
        className="grid min-w-0 grid-cols-1 gap-2 @2xl:grid-cols-2 @4xl:hidden"
        data-testid="pages-mobile-cards"
      >
        {rows.map((row) => (
          <Card key={row.pageId} className="min-w-0 gap-2 py-3" data-testid="pages-mobile-card">
            <CardHeader className="min-w-0 gap-x-2 gap-y-0 px-4">
              <CardTitle className="line-clamp-2 min-w-0 break-words text-sm leading-snug">
                <Bdi dominant className="block text-balance">{pagesRowName(row)}</Bdi>
              </CardTitle>
              <CardAction>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(event) => onDetail(row.pageId, event.currentTarget)}
                >
                  {t('actions.inspect')}
                </Button>
              </CardAction>
              {/* a 44px tap box whose negative margin keeps the
                  row's 24px layout, so the compact card budget holds. */}
              {/* eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL includes noopener and noreferrer. */}
              <a
                href={safeExternalHref(row.url)}
                target="_blank"
                rel={SAFE_EXTERNAL_REL}
                title={isolateText(row.url)}
                dir="ltr"
                className="inline-flex min-h-6 min-w-0 max-w-full items-center gap-1 py-0.5 text-xs text-muted-foreground underline max-md:-my-2.5 max-md:min-h-11 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate">{pagesPathLabel(row.displayUrl)}</span>
                <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
              </a>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-2 px-4">
              <div className="flex flex-wrap items-center gap-1.5">
                {shown.source ? (
                  <Badge variant={row.performanceSource ? 'secondary' : 'outline'}>
                    {row.performanceSource
                      ? t(`sources.${row.performanceSource}.short`)
                      : t('sources.unmeasured')}
                  </Badge>
                ) : null}
                {shown.crawl ? <Badge variant="outline">{crawlLabel(row)}</Badge> : null}
                {shown.insights ? <PageInsightChips row={row} /> : null}
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs min-[340px]:grid-cols-3 min-[380px]:grid-cols-4">
                {metricColumns.map((metric) => (
                  <div key={metric} className="min-w-0">
                    <dt className="text-muted-foreground">{t(`metrics.${metric}`)}</dt>
                    <dd className="break-words text-sm font-medium">
                      <MetricValue
                        metric={metric}
                        row={row}
                        locale={locale}
                        notAvailable={notAvailable}
                      />
                    </dd>
                  </div>
                ))}
                {shown.associatedQueryCount ? (
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">{t('metrics.associatedQueryCount')}</dt>
                    <dd className="break-words text-sm font-medium">
                      <QueryCountValue row={row} locale={locale} notAvailable={notAvailable} />
                    </dd>
                  </div>
                ) : null}
                {shown.positionChange ? (
                  <>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">{t('deltas.position')}</dt>
                      <dd className="text-sm font-medium">
                        <PositionDelta
                          change={row.deltas.position}
                          fallbackDelta={row.deltas.positionChange}
                          testId="pages-position-delta-card"
                        />
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">{t('deltas.clickChange')}</dt>
                      <dd dir="ltr" className="text-sm font-medium">
                        {formatSignedPagesValue(locale, row.deltas.clickChangePct, true) ?? (
                          <NotAvailableValue label={notAvailable} />
                        )}
                      </dd>
                    </div>
                  </>
                ) : null}
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PagesInitialSkeleton({ caption }: { caption: string }) {
  return (
    <div
      className="@container flex flex-col gap-4"
      aria-busy="true"
      data-testid="pages-initial-skeleton"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-40 w-full" />
      <div className="hidden @4xl:block">
        <Table>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            <TableRow>
              {[0, 1, 2, 3, 4].map((item) => (
                <TableHead key={item}>
                  <Skeleton className="h-4 w-20" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[0, 1, 2, 3].map((row) => (
              <TableRow key={row}>
                {[0, 1, 2, 3, 4].map((cell) => (
                  <TableCell key={cell}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:hidden">
        {[0, 1, 2].map((item) => (
          <Skeleton key={item} className="h-64 w-full" />
        ))}
      </div>
    </div>
  );
}

export function PagesPanel({ siteId }: PagesPanelProps) {
  const { t, i18n } = useTranslation('pages');
  const locale = i18n.language;
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { state: urlState, setSearch, changeContext, setCursor, setPageId } = usePagesUrlState();
  const query = useMemo(() => pagesListQueryFromUrlState(urlState), [urlState]);
  const entry = useAppSelector((state) => selectPagesListEntry(state, siteId, query));
  const loadState = useAppSelector((state) => selectPagesListLoadState(state, siteId, query));
  const refresh = useAppSelector((state) => selectPagesRefresh(state, siteId));
  const detailEntry = useAppSelector((state) =>
    urlState.pageId ? selectPagesDetailEntry(state, siteId, query.range, urlState.pageId) : null,
  );
  const detailLoadState = useAppSelector((state) =>
    urlState.pageId
      ? selectPagesDetailLoadState(state, siteId, query.range, urlState.pageId)
      : ('initial_loading' as PagesLoadState),
  );
  const [searchDraft, setSearchDraft] = useState(urlState.q);
  const [announcement, setAnnouncement] = useState('');
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const ownData = entry.data ?? refresh.error?.state ?? null;
  // The last answer for this site stays on screen while a new query loads, so
  // typing in the search box never replaces the filters and table with a
  // skeleton (that swap moved the viewport by hundreds of pixels).
  const [previous, setPrevious] = useState<{ siteId: string; data: PagesListResponse } | null>(
    null,
  );
  if (ownData !== null && (previous?.data !== ownData || previous.siteId !== siteId)) {
    setPrevious({ siteId, data: ownData });
  }
  const placeholder = ownData === null && previous?.siteId === siteId ? previous.data : null;
  const data = ownData ?? placeholder;
  // Showing the previous answer for a query that has not answered yet.
  const refetching = placeholder !== null && entry.error === null;
  const capabilities = useMemo(
    () => (data ? pagesSourceCapabilities(data.envelope) : null),
    [data],
  );

  // Declared before the load effects. Answers outlive the panel (Overview and
  // back inside the freshness window costs no request); only moving to a
  // different site drops the cache and the request lanes.
  useEffect(() => {
    dispatch(enterPagesSite(siteId));
  }, [dispatch, siteId]);

  useEffect(() => {
    setSearchDraft(urlState.q);
  }, [urlState.q]);

  useEffect(() => {
    if (searchDraft === urlState.q) return;
    const timeout = window.setTimeout(() => setSearch(searchDraft), 300);
    return () => window.clearTimeout(timeout);
  }, [searchDraft, setSearch, urlState.q]);

  useEffect(() => {
    void dispatch(loadPagesList({ siteId, query }));
  }, [dispatch, query, siteId]);

  useEffect(() => {
    if (!urlState.pageId) return;
    void dispatch(loadPagesDetail({ siteId, range: query.range, pageId: urlState.pageId }));
  }, [dispatch, query.range, siteId, urlState.pageId]);

  useEffect(() => {
    if (entry.error?.code === 'PAGES_INVALID_CURSOR' && urlState.cursor) {
      setAnnouncement(t('pagination.cursorReset'));
      setCursor(null);
    }
  }, [entry.error?.code, setCursor, t, urlState.cursor]);

  useEffect(() => {
    if (detailEntry?.error?.status === 404 && urlState.pageId) {
      setAnnouncement(t('detail.notFound'));
      setPageId(null);
    }
  }, [detailEntry?.error?.status, setPageId, t, urlState.pageId]);

  const onRefresh = () => {
    setAnnouncement('');
    void dispatch(refreshPages({ siteId, query, pageId: urlState.pageId }));
  };

  const onSort = (sort: PagesSort) => {
    if (query.sort !== sort) {
      changeContext({ sort });
      return;
    }
    changeContext({ sort, direction: query.direction === 'asc' ? 'desc' : 'asc' });
  };

  const openDetail = (pageId: string, trigger: HTMLButtonElement) => {
    detailTriggerRef.current = trigger;
    setPageId(pageId);
  };

  const resetFilters = () => {
    setSearchDraft('');
    changeContext({
      q: '',
      insight: null,
      indexability: null,
      visibility: null,
      sort: DEFAULT_PAGES_URL_STATE.sort,
      direction: DEFAULT_PAGES_URL_STATE.direction,
      limit: DEFAULT_PAGES_URL_STATE.limit,
    });
  };

  const rangeSemantics =
    data?.envelope.rangeSemantics === 'point_in_time'
      ? t('disclosure.pointInTime')
      : t('disclosure.rolling', { range: t(`range.${query.range}`) });
  const summaryMetrics = capabilities?.isObserved ? SUMMARY_METRICS_GSC : SUMMARY_METRICS_FALLBACK;
  // nothing stored → one neutral empty state, not a grid
  // of "Not available" cards (and never a red alert when nothing failed).
  const noSourceData = data?.envelope.status === 'empty';
  const summaryEmpty = data
    ? summaryMetrics.every((metric) => data.summary[metric] === null)
    : true;
  const busy = entry.loading || refresh.loading;
  // This query failed and nothing of its own arrived: the previous answer is hidden, not passed off as the result.
  const resultsBlocked = entry.error !== null && ownData === null;

  return (
    <section
      className="flex min-w-0 flex-col gap-5"
      data-testid="pages-panel"
      aria-labelledby="pages-heading"
    >
      <div className="flex min-w-0 flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0">
          <h2 id="pages-heading" className="text-2xl font-semibold tracking-tight">
            {t('heading')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <ReportExportControl
            kind="pages.performance"
            target={{ scope: 'site', siteId }}
            selection={{
              range: query.range,
              ...(urlState.insight ? { insight: [urlState.insight] } : {}),
              ...(urlState.indexability ? { indexability: urlState.indexability } : {}),
              ...(urlState.visibility ? { visibility: urlState.visibility } : {}),
              ...(urlState.pageId ? { pageIds: [urlState.pageId] } : {}),
            }}
          />
          <Field className="w-auto min-w-32">
            <FieldLabel htmlFor="pages-range">{t('range.label')}</FieldLabel>
            <Select
              value={query.range}
              onValueChange={(value) => changeContext({ range: value as PagesListQuery['range'] })}
              disabled={busy}
            >
              <SelectTrigger id="pages-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {PAGES_RANGES.map((range) => (
                    <SelectItem key={range} value={range}>
                      {t(`range.${range}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Button
            type="button"
            onClick={onRefresh}
            loading={refresh.loading}
            loadingLabel={t('actions.refreshing')}
          >
            <RefreshCw aria-hidden="true" />
            {data?.envelope.source === 'none' ? t('actions.collectFallback') : t('actions.refresh')}
          </Button>
        </div>
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
        {entry.loading ? t('states.loadingAnnouncement') : ''}
        {refresh.loading ? t('states.refreshAnnouncement') : ''}
      </div>

      {loadState === 'initial_loading' && data === null ? (
        <PagesInitialSkeleton caption={t('table.caption')} />
      ) : null}

      {entry.error && data === null && entry.error.code !== 'PAGES_INVALID_CURSOR' ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>
            {entry.error.kind === 'not_found'
              ? t('states.notFound.title')
              : t('states.transport.title')}
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>{entry.error.message || t('states.transport.body')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void dispatch(loadPagesList({ siteId, query }))}
            >
              <RotateCcw aria-hidden="true" />
              {t('actions.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {data ? (
        <>
          {/* Same Search Console status and CTA as every other page. */}
          <SiteGoogleNotice product="gsc" />
          <Card>
            <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {t(`sources.${data.envelope.source}.label`)}
                  <Badge variant={sourceStatusVariant(data.envelope.status)}>
                    {t(`status.${data.envelope.status}`)}
                  </Badge>
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(`sources.${data.envelope.source}.description`)}
                </p>
              </div>
              <dl className="grid min-w-0 grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:max-w-2xl">
                <div>
                  <dt className="text-muted-foreground">{t('disclosure.observedAt')}</dt>
                  <dd>
                    {formatPagesDate(locale, data.envelope.observedAt) ?? t('common.notAvailable')}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('disclosure.range')}</dt>
                  <dd>{rangeSemantics}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('disclosure.comparison')}</dt>
                  <dd>
                    {t('disclosure.sincePreviousSync')}
                    {data.envelope.comparison.previousObservedAt
                      ? ` · ${formatPagesDate(locale, data.envelope.comparison.previousObservedAt)}`
                      : ` · ${t('disclosure.noPreviousSync')}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('disclosure.market')}</dt>
                  <dd>
                    {data.envelope.market
                      ? t('disclosure.marketValue', {
                          location: formatCountryFromLocation(
                            data.envelope.market.locationCode,
                            locale,
                            t('common:market.unknownCountry'),
                          ),
                          language:
                            languageName(data.envelope.market.languageCode, locale) ??
                            t('common:market.unknownLanguage'),
                        })
                      : t('disclosure.notApplicable')}
                  </dd>
                </div>
              </dl>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p data-testid="pages-coverage">
                <TableHeaderHelp
                  label={t('coverage.pages', {
                    count: data.envelope.coverage.inventoryPages,
                    measured: data.envelope.coverage.measuredPages,
                  })}
                  labelText={t('coverage.inventoryLabel')}
                  description={t('coverage.inventoryHelp')}
                />
              </p>
              {(data.envelope.coverage.redirectPages ?? 0) > 0 ? (
                <p data-testid="pages-coverage-redirects">
                  {t('coverage.redirects', { count: data.envelope.coverage.redirectPages })}
                </p>
              ) : null}
              {data.envelope.coverage.sourceRowsDropped > 0 ? (
                <p>{t('coverage.skipped', { count: data.envelope.coverage.sourceRowsDropped })}</p>
              ) : null}
              {data.envelope.coverage.lastCrawl ? (
                <LastCrawlNote crawl={data.envelope.coverage.lastCrawl} siteId={siteId} />
              ) : null}
              {data.envelope.coverage.reportingLagDays ? (
                <p>
                  {t('disclosure.reportingLag', { count: data.envelope.coverage.reportingLagDays })}
                </p>
              ) : null}
              {data.envelope.coverage.sampled !== null ? (
                <p>
                  {data.envelope.coverage.sampled
                    ? t('disclosure.sampled')
                    : t('disclosure.notSampled')}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <SourceStateNotice envelope={data.envelope} />

          {noSourceData ? (
            <Empty className="border" data-testid="pages-no-data">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileSearch aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{t('noData.title')}</EmptyTitle>
                <EmptyDescription>{t(`states.empty.${data.envelope.source}`)}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}

          {refresh.error ? (
            <Alert variant="destructive" role="alert">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>{t('states.refreshFailed.title')}</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3">
                <p>{refresh.error.message || t('states.refreshFailed.body')}</p>
                <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
                  <RotateCcw aria-hidden="true" />
                  {t('actions.retryRefresh')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {refresh.lastResult && !refresh.error ? (
            <p className="text-sm text-success" role="status">
              {t(`notifications.${refresh.lastResult.outcome}`, {
                source: t(`sources.${refresh.lastResult.source}.short`),
              })}
            </p>
          ) : null}

          {noSourceData || summaryEmpty ? null : (
            <div
              className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', refetching && 'opacity-60')}
              data-testid="pages-summary"
            >
              {summaryMetrics.map((metric) => (
                <Card key={metric}>
                  <CardHeader className="pb-2">
                    <p className="text-sm text-muted-foreground">{t(`metrics.${metric}`)}</p>
                  </CardHeader>
                  <CardContent>
                    <p className="break-words text-2xl font-semibold" dir="ltr">
                      {formatPagesMetric(locale, metric, data.summary[metric]) ??
                        t('common.notAvailable')}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {capabilities?.isObserved
                        ? t('metrics.qualifierObserved')
                        : metric === 'clicks' || metric === 'impressions' || metric === 'ctr'
                          ? t('metrics.qualifierUnavailable')
                          : t('metrics.qualifierEstimated')}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {capabilities?.isObserved ? (
            <div
              className="flex flex-col gap-1 text-xs text-muted-foreground"
              data-testid="pages-summary-note"
            >
              {data.envelope.dataWindow ? (
                <p>
                  {t('summaryNote.window', {
                    start: formatPagesDay(locale, data.envelope.dataWindow.startDate),
                    end: formatPagesDay(locale, data.envelope.dataWindow.endDate),
                  })}
                </p>
              ) : null}
              <p>{t('summaryNote.aggregation')}</p>
              <GscTotalsNote testId="pages-scope-note" />
            </div>
          ) : null}

          <PagesFilters
            query={query}
            capabilities={capabilities as PagesSourceCapabilities}
            searchDraft={searchDraft}
            onSearchDraft={setSearchDraft}
            onContext={changeContext}
            onReset={resetFilters}
            disabled={entry.loading}
          />

          {entry.error && entry.error.code !== 'PAGES_INVALID_CURSOR' ? (
            <Alert variant="destructive" role="alert">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>{t('states.transport.title')}</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3">
                <p>
                  {entry.error.message ||
                    (entry.data ? t('states.transport.retained') : t('states.transport.body'))}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void dispatch(loadPagesList({ siteId, query }))}
                >
                  <RotateCcw aria-hidden="true" />
                  {t('actions.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {resultsBlocked ? null : data.items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileSearch aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{t('empty.title')}</EmptyTitle>
                <EmptyDescription>
                  {query.q || query.insight || query.indexability || query.visibility
                    ? t('empty.filtered')
                    : data.envelope.source === 'gsc'
                      ? t('empty.gsc')
                      : data.envelope.source === 'none'
                        ? t('empty.none')
                        : t('empty.fallback')}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {query.q || query.insight || query.indexability || query.visibility ? (
                  <Button type="button" variant="outline" onClick={resetFilters}>
                    <FilterX aria-hidden="true" />
                    {t('actions.resetFilters')}
                  </Button>
                ) : null}
              </EmptyContent>
            </Empty>
          ) : (
            <PagesResults
              rows={data.items}
              envelope={data.envelope}
              query={query}
              capabilities={capabilities as PagesSourceCapabilities}
              locale={locale}
              backgroundLoading={entry.loading || refetching}
              onSort={onSort}
              onDetail={openDetail}
            />
          )}

          {resultsBlocked ? null : (
            <nav
              className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between"
              aria-label={t('pagination.label')}
            >
              <p className="text-sm text-muted-foreground">
                {t('pagination.context', {
                  count: data.pageInfo.totalFiltered,
                  shown: data.items.length,
                  total: data.pageInfo.totalFiltered,
                })}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(-1)}
                  disabled={!query.cursor || busy}
                >
                  {i18n.dir() === 'rtl' ? (
                    <ChevronRight aria-hidden="true" />
                  ) : (
                    <ChevronLeft aria-hidden="true" />
                  )}
                  {t('pagination.previous')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCursor(data.pageInfo.nextCursor)}
                  disabled={!data.pageInfo.hasNext || !data.pageInfo.nextCursor || busy}
                >
                  {t('pagination.next')}
                  {i18n.dir() === 'rtl' ? (
                    <ChevronLeft aria-hidden="true" />
                  ) : (
                    <ChevronRight aria-hidden="true" />
                  )}
                </Button>
              </div>
            </nav>
          )}
        </>
      ) : null}

      <PageDetailSheet
        siteId={siteId}
        open={Boolean(urlState.pageId)}
        entry={
          detailEntry ?? {
            data: null,
            loading: false,
            loaded: false,
            invalidated: false,
            loadedAt: null,
            error: null,
            requestId: null,
          }
        }
        loadState={detailLoadState}
        returnFocusRef={detailTriggerRef}
        onOpenChange={() => setPageId(null)}
        onRetry={() =>
          void dispatch(
            loadPagesDetail({
              siteId,
              range: query.range,
              pageId: urlState.pageId as string,
            }),
          )
        }
      />
    </section>
  );
}
