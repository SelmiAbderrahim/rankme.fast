/**
 * Backlinks panel.
 *
 * data-testid contract (Playwright):
 *   - backlinks-panel                   root
 *   - backlinks-loading                 loading skeleton
 *   - backlinks-error                   error alert
 *   - backlinks-summary                 4 stat cards
 *   - backlinks-summary-dr              domain-rating card
 *   - backlinks-summary-refdomains      referring domains card
 *   - backlinks-summary-links           backlinks card
 *   - backlinks-summary-broken          broken backlinks card
 *   - backlinks-delta-<key>             delta value badges
 *   - backlinks-table                   backlinks list table
 *   - backlinks-row-<i>                 one row per backlink
 *   - backlinks-load-more               load-more button
 *   - backlinks-retry                   initial-load error retry button
 *   - backlinks-empty-refresh           empty-state refresh CTA
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ExternalLink, Link2, RefreshCw } from 'lucide-react';
import { RefreshButton } from '@shared/components/RefreshButton';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Checkbox } from '@shared/ui/checkbox';
import { StatusChip } from '@shared/ui/status-chip';
import { saveBlobAs } from '@features/report-export';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Skeleton } from '@shared/ui/skeleton';
import { StatCard } from '@shared/ui/stat-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security';
import { loadList, loadSummary, refreshSummary } from '../store/thunks';
import { referringHostOf, serializeSuspectedDisavow } from '../disavow';
import {
  selectBacklinksSiteId,
  selectCooldownUntil,
  selectCursor,
  selectError,
  selectIsRefreshing,
  selectList,
  selectLoaded,
  selectLoading,
  selectRefreshError,
  selectSummary,
} from '../store/selectors';

interface Props {
  siteId: string;
  view?: 'all' | 'overview' | 'rows';
  managedExternally?: boolean;
}

function fmt(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(n);
}

export const BacklinksPanel = ({ siteId, view = 'all', managedExternally = false }: Props) => {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const summary = useAppSelector(selectSummary);
  const list = useAppSelector(selectList);
  const loading = useAppSelector(selectLoading);
  const loaded = useAppSelector(selectLoaded);
  const error = useAppSelector(selectError);
  const cursor = useAppSelector(selectCursor);
  const isRefreshing = useAppSelector(selectIsRefreshing);
  const cooldownUntil = useAppSelector(selectCooldownUntil);
  const refreshError = useAppSelector(selectRefreshError);
  const sliceSiteId = useAppSelector(selectBacklinksSiteId);
  // Ref-mirror of sliceSiteId so the mount effect can inspect the current
  // slice state without listing it in deps — otherwise the pending re-key
  // would re-run the effect and abort its own in-flight dispatch.
  const sliceSiteIdRef = useRef(sliceSiteId);
  sliceSiteIdRef.current = sliceSiteId;
  const [selectedHosts, setSelectedHosts] = useState<ReadonlySet<string>>(new Set());
  const flaggedRows = useMemo(() => (list?.rows ?? []).filter((row) => row.suspicion), [list]);
  const flaggedHosts = useMemo(
    () => [...new Set(flaggedRows.map((row) => referringHostOf(row)))],
    [flaggedRows],
  );
  // Only hosts that are still flagged on the current page can be exported.
  const exportHosts = flaggedHosts.filter((host) => selectedHosts.has(host));
  const toggleHost = (host: string, checked: boolean) =>
    setSelectedHosts((current) => {
      const next = new Set(current);
      if (checked) next.add(host);
      else next.delete(host);
      return next;
    });
  const downloadDisavow = () => {
    saveBlobAs(
      new Blob([serializeSuspectedDisavow(exportHosts, new Date())], {
        type: 'text/plain;charset=utf-8',
      }),
      'disavow.txt',
    );
  };

  useEffect(() => {
    if (managedExternally) return;
    // Skip the metered refetch when the slice is already primed for this site
    // (fully loaded OR in flight). A different siteId re-fires.
    if (sliceSiteIdRef.current === siteId) return;
    const summaryPromise = dispatch(loadSummary({ siteId }));
    const listPromise = dispatch(loadList({ siteId }));
    return () => {
      summaryPromise.abort();
      listPromise.abort();
    };
  }, [dispatch, managedExternally, siteId]);

  // Refresh failures surface as a toast — the panel keeps its last data.
  useEffect(() => {
    if (refreshError) toast.error(refreshError);
  }, [refreshError]);

  const handleRefresh = () => {
    void dispatch(refreshSummary({ siteId })).then((action) => {
      // The refresh invalidated the stored first page server-side; this is the
      // one explicit provider pull of rows (a plain list GET reads stored data).
      if (refreshSummary.fulfilled.match(action)) {
        void dispatch(loadList({ siteId, fresh: true }));
      }
    });
  };

  return (
    <div className="flex flex-col gap-6 px-4 py-8" data-testid="backlinks-panel">
      {view === 'all' ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">{t('backlinks:title')}</h1>
            <p className="text-muted-foreground text-sm">{t('backlinks:description')}</p>
          </div>
          <RefreshButton
            onRefresh={handleRefresh}
            isRefreshing={isRefreshing}
            cooldownUntil={cooldownUntil}
            labelKey="backlinks:refresh.button"
            cooldownKey="backlinks:refresh.cooldown"
            data-testid="backlinks-refresh"
          />
        </div>
      ) : null}

      {error ? (
        <div>
          <Alert variant="destructive" role="alert" data-testid="backlinks-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              void dispatch(loadSummary({ siteId }));
              void dispatch(loadList({ siteId }));
            }}
            data-testid="backlinks-retry"
          >
            {t('common:retry')}
          </Button>
        </div>
      ) : null}

      {loading && !loaded ? (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
          aria-busy="true"
          aria-live="polite"
          data-testid="backlinks-loading"
        >
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : null}

      {view !== 'rows' && summary ? (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
          data-testid="backlinks-summary"
        >
          <StatCard
            variant="kpi"
            data-testid="backlinks-summary-dr"
            label={t('backlinks:summary.domainRating')}
            value={summary.domainRating === null ? '—' : String(summary.domainRating)}
            context={summary.delta ? t('backlinks:delta.since') : undefined}
            delta={
              summary.delta
                ? { value: summary.delta.domainRating, testId: 'backlinks-delta-dr' }
                : undefined
            }
          />
          <StatCard
            variant="kpi"
            data-testid="backlinks-summary-refdomains"
            label={t('backlinks:summary.referringDomains')}
            value={fmt(summary.referringDomains, i18n.language)}
            context={summary.delta ? t('backlinks:delta.since') : undefined}
            delta={
              summary.delta
                ? { value: summary.delta.referringDomains, testId: 'backlinks-delta-refdomains' }
                : undefined
            }
          />
          <StatCard
            variant="kpi"
            data-testid="backlinks-summary-links"
            label={t('backlinks:summary.backlinks')}
            value={fmt(summary.backlinks, i18n.language)}
            context={summary.delta ? t('backlinks:delta.since') : undefined}
            delta={
              summary.delta
                ? { value: summary.delta.backlinks, testId: 'backlinks-delta-links' }
                : undefined
            }
          />
          <StatCard
            variant="kpi"
            data-testid="backlinks-summary-broken"
            label={t('backlinks:summary.brokenBacklinks')}
            value={fmt(summary.brokenBacklinks, i18n.language)}
            context={summary.delta ? t('backlinks:delta.since') : undefined}
            delta={
              summary.delta
                ? {
                    value: summary.delta.brokenBacklinks,
                    goodDirection: 'down',
                    testId: 'backlinks-delta-broken',
                  }
                : undefined
            }
          />
        </div>
      ) : null}

      {view !== 'overview' && list && list.rows.length > 0 ? (
        <Card data-testid="backlinks-table">
          <CardHeader>
            <CardTitle className="text-base">{t('backlinks:table.title')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {flaggedRows.length > 0 ? (
              <div
                className="flex flex-wrap items-center gap-3 border-b p-4"
                data-testid="backlinks-suspicion-toolbar"
              >
                <p className="text-sm font-medium">
                  {t('backlinks:suspicion.summary', { flagged: flaggedHosts.length })}
                </p>
                <p className="text-muted-foreground text-xs" data-testid="backlinks-suspicion-selected">
                  {t('backlinks:suspicion.selected', { selected: exportHosts.length })}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedHosts(new Set(flaggedHosts))}
                  data-testid="backlinks-suspicion-select-all"
                >
                  {t('backlinks:suspicion.selectAll')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedHosts(new Set())}
                  disabled={exportHosts.length === 0}
                  data-testid="backlinks-suspicion-clear"
                >
                  {t('backlinks:suspicion.clear')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={downloadDisavow}
                  disabled={exportHosts.length === 0}
                  data-testid="backlinks-disavow-download"
                >
                  {t('backlinks:suspicion.download', { selected: exportHosts.length })}
                </Button>
                <p className="text-muted-foreground basis-full text-xs">
                  {t('backlinks:suspicion.help')}
                </p>
              </div>
            ) : null}
            <Table>
              <caption className="sr-only">{t('backlinks:table.title')}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('backlinks:table.domain')}</TableHead>
                  <TableHead>{t('backlinks:table.anchor')}</TableHead>
                  <TableHead>
                    <TableHeaderHelp
                      label={t('backlinks:table.dofollow')}
                      description={t('common:tableHelp.dofollow')}
                    />
                  </TableHead>
                  <TableHead>{t('backlinks:table.firstSeen')}</TableHead>
                  <TableHead>{t('backlinks:table.review')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((row, i) => (
                  <TableRow key={`${row.urlFrom}-${i}`} data-testid={`backlinks-row-${i}`}>
                    <TableCell>
                      {/* eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL contains noopener and noreferrer. */}
                      <a
                        href={safeExternalHref(row.urlFrom)}
                        target="_blank"
                        rel={SAFE_EXTERNAL_REL}
                        className="inline-flex items-center gap-1"
                      >
                        <Link2 aria-hidden="true" className="h-3 w-3" />
                        <span className="truncate">{row.urlFrom}</span>
                        <ExternalLink aria-hidden="true" className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{row.anchor ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={row.dofollow ? 'default' : 'secondary'}>
                        {row.dofollow
                          ? t('backlinks:table.dofollowYes')
                          : t('backlinks:table.dofollowNo')}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground text-xs">
                      {row.firstSeen
                        ? new Intl.DateTimeFormat(i18n.language, {
                            dateStyle: 'medium',
                          }).format(new Date(row.firstSeen))
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {row.suspicion ? (
                        <div className="flex flex-col gap-1" data-testid={`backlinks-suspicion-${i}`}>
                          <label className="flex items-center gap-2">
                            <Checkbox
                              checked={selectedHosts.has(referringHostOf(row))}
                              onCheckedChange={(checked) =>
                                toggleHost(referringHostOf(row), checked === true)
                              }
                              aria-label={t('backlinks:table.selectRow', {
                                domain: referringHostOf(row),
                              })}
                            />
                            <StatusChip tone="warning">{t('backlinks:suspicion.badge')}</StatusChip>
                          </label>
                          <ul className="text-muted-foreground list-disc ps-5 text-xs">
                            {row.suspicion.reasons.map((reason) => (
                              <li key={reason}>{t(`backlinks:suspicion.reasons.${reason}`)}</li>
                            ))}
                          </ul>
                          <span className="text-muted-foreground text-xs">
                            {t('backlinks:suspicion.notVerified')}
                          </span>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {cursor ? (
              <div className="flex flex-wrap items-center gap-3 p-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void dispatch(loadList({ siteId, cursor }))}
                  loading={loading}
                  loadingLabel={t('backlinks:table.loading')}
                  data-testid="backlinks-load-more"
                >
                  {t('backlinks:table.loadMore')}
                </Button>
                <p className="text-muted-foreground text-xs" data-testid="backlinks-load-more-hint">
                  {t('backlinks:table.loadMoreHint')}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : loaded && !loading && !error && (view !== 'overview' || summary === null) ? (
        <Empty className="w-full max-w-md self-center" data-testid="backlinks-empty">
          <EmptyHeader>
            <EmptyTitle>{t('backlinks:emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('backlinks:empty')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={handleRefresh} data-testid="backlinks-empty-refresh">
              <RefreshCw aria-hidden="true" className="me-1 h-4 w-4" />
              {t('backlinks:refresh.button')}
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}
    </div>
  );
};
