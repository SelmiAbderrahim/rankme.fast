/**
 * GoogleSearchDetailPanel — the `?view=` drill-in layer of the site
 * workspace Google tab. Four Search Analytics dimensions (queries / pages /
 * countries / devices) share one sortable, filterable, locally-windowed
 * table; the fifth view lists submitted sitemaps with status chips.
 *
 * data-testid contract:
 *   - google-search-detail-panel   root
 *   - google-detail-back           back-to-overview button (clears ?view=)
 *   - google-detail-skeleton       loading skeleton (analytics)
 *   - google-detail-error          hard error alert (analytics)
 *   - google-detail-retry          error retry button (analytics)
 *   - google-detail-empty          404 / no-rows empty state
 *   - google-detail-filter         client-side filter input
 *   - google-detail-no-matches     filter matched nothing
 *   - google-detail-sort-<column>  sortable numeric header buttons
 *   - google-detail-row            one table row per key
 *   - google-detail-load-more      local windowing (+50 rows)
 *   - google-sitemaps-*            sitemaps view equivalents
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, FileText } from 'lucide-react';
import { ReportExportControl } from '@features/report-export';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyTitle } from '@shared/ui/empty';
import { Input } from '@shared/ui/input';
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
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { contentAnalysisHref } from '@shared/navigation/contentIntelligenceHref';
import {
  selectGoogleDetailRange,
  selectGoogleDetailSiteId,
  selectGoogleSearchDetail,
  selectGoogleSitemaps,
  selectGoogleSitemapsSiteId,
} from '../store/selectors';
import { loadSearchAnalyticsDetail, loadSitemaps } from '../store/thunks';
import { useGoogleSearchView, type GoogleSearchView } from '../lib/searchView';
import { useGoogleRange } from '../lib/range';
import {
  deviceLabelKey,
  formatDate,
  formatInt,
  formatPercent,
  formatPosition,
} from '../lib/format';
import type { GscSearchDimension, GscSitemap } from '../types';

export interface GoogleSearchDetailPanelProps {
  view: GoogleSearchView;
  siteId: string;
}

type AnalyticsView = Exclude<GoogleSearchView, 'sitemaps'>;

const VIEW_DIMENSION: Record<AnalyticsView, GscSearchDimension> = {
  queries: 'query',
  pages: 'page',
  countries: 'country',
  devices: 'device',
};

const PAGE_SIZE = 50;

type NumericColumn = 'clicks' | 'impressions' | 'ctr' | 'position';
const NUMERIC_COLUMNS: readonly NumericColumn[] = ['clicks', 'impressions', 'ctr', 'position'];
const NUMERIC_COLUMN_HELP: Record<NumericColumn, string> = {
  clicks: 'clicks',
  impressions: 'impressions',
  ctr: 'ctr',
  position: 'averagePosition',
};

export const GoogleSearchDetailPanel = ({ view, siteId }: GoogleSearchDetailPanelProps) => {
  const { t } = useTranslation('google');
  const [, setView] = useGoogleSearchView();

  return (
    <section
      className="rounded-xl border bg-card p-4 shadow-sm"
      data-testid="google-search-detail-panel"
      aria-label={t(`searchDetail.views.${view}`)}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ms-2"
        onClick={() => setView(null)}
        data-testid="google-detail-back"
      >
        <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
        {t('searchDetail.back')}
      </Button>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t(`searchDetail.views.${view}`)}</h3>
        {view === 'sitemaps' ? (
          <ReportExportControl
            kind="google.gsc_sitemaps"
            target={{ scope: 'site', siteId }}
            selection={{}}
          />
        ) : null}
      </div>
      {view === 'sitemaps' ? (
        <SitemapsSection siteId={siteId} />
      ) : (
        <AnalyticsSection key={view} view={view} siteId={siteId} />
      )}
    </section>
  );
};

const AnalyticsSection = ({ view, siteId }: { view: AnalyticsView; siteId: string }) => {
  const { t, i18n } = useTranslation(['google', 'contentIntelligence']);
  const locale = i18n.language;
  const dispatch = useAppDispatch();
  const dimension = VIEW_DIMENSION[view];
  const detail = useAppSelector(selectGoogleSearchDetail);
  const detailSiteId = useAppSelector(selectGoogleDetailSiteId);
  const detailRange = useAppSelector(selectGoogleDetailRange);
  const [range] = useGoogleRange();
  const section = detail[dimension];

  useEffect(() => {
    if (section.loading) return;
    if (section.loaded && detailSiteId === siteId && detailRange === range && !section.error) {
      return;
    }
    void dispatch(loadSearchAnalyticsDetail({ siteId, dimension, range }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refire only on target change
  }, [dispatch, siteId, dimension, range]);

  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{
    column: NumericColumn;
    direction: 'asc' | 'desc';
  }>({ column: 'clicks', direction: 'desc' });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { total, rows } = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? section.rows.filter((row) => row.key.toLowerCase().includes(needle))
      : section.rows;
    const sorted = [...filtered].sort((a, b) =>
      sort.direction === 'desc' ? b[sort.column] - a[sort.column] : a[sort.column] - b[sort.column],
    );
    return { total: sorted.length, rows: sorted.slice(0, visibleCount) };
  }, [section.rows, filter, sort, visibleCount]);

  const toggleSort = (column: NumericColumn) => {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === 'desc' ? 'asc' : 'desc' }
        : { column, direction: 'desc' },
    );
  };

  const rowLabel = (key: string): string => {
    if (dimension === 'country') return key.toUpperCase();
    if (dimension === 'device') {
      return t(`searchSummary.devices.${deviceLabelKey(key)}`);
    }
    return key;
  };

  const showSkeleton = section.loading || !section.loaded;
  const showError = !showSkeleton && Boolean(section.error);

  if (showSkeleton) {
    return (
      <div className="mt-3 flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-9" data-testid="google-detail-skeleton" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    );
  }

  if (showError) {
    return (
      <div className="mt-3" data-testid="google-detail-error" role="alert">
        <p className="text-destructive text-sm">{t('searchDetail.error')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => void dispatch(loadSearchAnalyticsDetail({ siteId, dimension, range }))}
          data-testid="google-detail-retry"
        >
          {t('searchSummary.retry')}
        </Button>
      </div>
    );
  }

  if (section.rows.length === 0) {
    return (
      <Empty className="mt-3" data-testid="google-detail-empty">
        <EmptyContent>
          <EmptyTitle>{t('searchSummary.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('searchSummary.empty')}</EmptyDescription>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="mt-3">
      {section.asOf ? (
        <p className="text-muted-foreground text-xs">
          {t('searchSummary.asOf', { date: formatDate(locale, section.asOf) })}
        </p>
      ) : null}
      <div className="mt-2 max-w-sm">
        <label htmlFor="google-detail-filter" className="sr-only">
          {t('searchDetail.searchLabel')}
        </label>
        <Input
          id="google-detail-filter"
          type="search"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setVisibleCount(PAGE_SIZE);
          }}
          placeholder={t('searchDetail.searchPlaceholder')}
          data-testid="google-detail-filter"
        />
      </div>
      {total === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm" data-testid="google-detail-no-matches">
          {t('searchDetail.noMatches')}
        </p>
      ) : (
        <>
          <Table className="mt-3">
            <TableCaption className="sr-only">{t(`searchDetail.views.${view}`)}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">
                  {t(`searchDetail.columns.${dimension}`)}
                </TableHead>
                {NUMERIC_COLUMNS.map((column) => (
                  <TableHead
                    key={column}
                    className="text-end"
                    aria-sort={
                      sort.column === column
                        ? sort.direction === 'desc'
                          ? 'descending'
                          : 'ascending'
                        : undefined
                    }
                  >
                    <TableHeaderHelp
                      labelText={t(`searchDetail.columns.${column}`)}
                      label={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-me-2 h-7 px-2"
                          onClick={() => toggleSort(column)}
                          data-testid={`google-detail-sort-${column}`}
                        >
                          {t(`searchDetail.columns.${column}`)}
                          {sort.column === column ? (
                            sort.direction === 'desc' ? (
                              <ArrowDown aria-hidden="true" />
                            ) : (
                              <ArrowUp aria-hidden="true" />
                            )
                          ) : null}
                        </Button>
                      }
                      description={t(`common:tableHelp.${NUMERIC_COLUMN_HELP[column]}`)}
                    />
                  </TableHead>
                ))}
                {dimension === 'query' || dimension === 'page' ? (
                  <TableHead className="text-end">{t('searchDetail.columns.actions')}</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key} data-testid="google-detail-row">
                  <TableCell className="max-w-xs">
                    <span className="block truncate" title={row.key}>
                      {rowLabel(row.key)}
                    </span>
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {formatInt(locale, row.clicks)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {formatInt(locale, row.impressions)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {formatPercent(locale, row.ctr)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {formatPosition(locale, row.position)}
                  </TableCell>
                  {dimension === 'query' || dimension === 'page' ? (
                    <TableCell className="text-end">
                      <Button asChild size="sm" variant="outline">
                        <Link
                          to={contentAnalysisHref({
                            siteId,
                            ...(dimension === 'page' ? { ownedUrl: row.key } : { keyword: row.key }),
                            source: 'gsc',
                          })}
                          data-testid="google-content-analysis-cta"
                        >
                          <FileText aria-hidden="true" />
                          {t('contentIntelligence:form.title')}
                        </Link>
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {total > rows.length ? (
            <div className="mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                data-testid="google-detail-load-more"
              >
                {t('searchDetail.loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

const sitemapStatus = (item: GscSitemap): { tone: string; labelKey: string; n: number } => {
  if (item.errors > 0) {
    return {
      tone: 'bg-destructive/10 text-destructive border-transparent',
      labelKey: 'searchDetail.sitemaps.status.errors',
      n: item.errors,
    };
  }
  if (item.warnings > 0) {
    return {
      tone: 'bg-warning/15 text-warning border-transparent',
      labelKey: 'searchDetail.sitemaps.status.warnings',
      n: item.warnings,
    };
  }
  return {
    tone: 'bg-success/10 text-success border-transparent',
    labelKey: 'searchDetail.sitemaps.status.ok',
    n: 0,
  };
};

const SitemapsSection = ({ siteId }: { siteId: string }) => {
  const { t, i18n } = useTranslation('google');
  const locale = i18n.language;
  const dispatch = useAppDispatch();
  const sitemaps = useAppSelector(selectGoogleSitemaps);
  const sitemapsSiteId = useAppSelector(selectGoogleSitemapsSiteId);

  useEffect(() => {
    if (sitemaps.loading) return;
    if (sitemaps.loaded && sitemapsSiteId === siteId && !sitemaps.error) return;
    void dispatch(loadSitemaps(siteId));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refire only on target change
  }, [dispatch, siteId]);

  const showSkeleton = sitemaps.loading || !sitemaps.loaded;
  const showError = !showSkeleton && Boolean(sitemaps.error);

  if (showSkeleton) {
    return (
      <div className="mt-3 flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-9" data-testid="google-sitemaps-skeleton" />
        <Skeleton className="h-9" />
      </div>
    );
  }

  if (showError) {
    return (
      <div className="mt-3" data-testid="google-sitemaps-error" role="alert">
        <p className="text-destructive text-sm">{t('searchDetail.error')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => void dispatch(loadSitemaps(siteId))}
          data-testid="google-sitemaps-retry"
        >
          {t('searchSummary.retry')}
        </Button>
      </div>
    );
  }

  if (sitemaps.items.length === 0) {
    return (
      <Empty className="mt-3" data-testid="google-sitemaps-empty">
        <EmptyContent>
          <EmptyTitle>{t('searchSummary.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('searchDetail.sitemaps.empty')}</EmptyDescription>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="mt-3">
      {sitemaps.asOf ? (
        <p className="text-muted-foreground text-xs">
          {t('searchSummary.asOf', { date: formatDate(locale, sitemaps.asOf) })}
        </p>
      ) : null}
      <Table className="mt-3">
        <TableCaption className="sr-only">{t('searchDetail.views.sitemaps')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="text-start">{t('searchDetail.sitemaps.columns.path')}</TableHead>
            <TableHead className="text-start">{t('searchDetail.sitemaps.columns.type')}</TableHead>
            <TableHead className="text-start">
              {t('searchDetail.sitemaps.columns.lastSubmitted')}
            </TableHead>
            <TableHead className="text-end">
              {t('searchDetail.sitemaps.columns.processed')}
            </TableHead>
            <TableHead className="text-start">
              {t('searchDetail.sitemaps.columns.status')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sitemaps.items.map((item) => {
            const status = sitemapStatus(item);
            return (
              <TableRow key={item.path} data-testid="google-sitemaps-row">
                <TableCell className="max-w-xs">
                  <span className="block truncate" title={item.path} dir="ltr">
                    {item.path}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{item.type}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {item.lastSubmitted ? formatDate(locale, item.lastSubmitted) : '—'}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {formatInt(locale, item.processed)}
                </TableCell>
                <TableCell>
                  <Badge className={status.tone} data-testid="google-sitemaps-status">
                    {t(status.labelKey, { n: formatInt(locale, status.n) })}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};
