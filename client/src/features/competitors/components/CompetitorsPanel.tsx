/**
 * Competitors panel.
 *
 * data-testid contract (Playwright):
 *   - competitors-panel                 root
 *   - competitors-loading               loading skeleton
 *   - competitors-error                 error alert
 *   - competitors-table                 competitors table
 *   - competitors-row-<domain>          one row per competitor
 *   - competitors-gap                   gap analysis panel
 *   - competitors-gap-row-<i>           one row per gap keyword
 *   - competitors-gap-loading           gap loading skeleton
 *   - competitors-gap-error             gap request error
 *   - competitors-empty                 empty state
 *   - competitors-empty-refresh         empty-state refresh CTA
 *   - competitors-gap-empty             gap empty state
 *   - competitors-gap-refresh           gap empty-state refresh CTA
 *   - competitors-retry                 initial-load error retry button
 */
import { Fragment, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ReportExportControl } from '@features/report-export';
import {
  BarChart3,
  FileText,
  Layers,
  LayoutGrid,
  type LucideIcon,
  Package,
  RefreshCw,
  Server,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import { RefreshButton } from '@shared/components/RefreshButton';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Avatar, AvatarFallback } from '@shared/ui/avatar';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Skeleton } from '@shared/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { contentAnalysisHref } from '@shared/navigation/contentIntelligenceHref';
import {
  fetchTechStack,
  loadCompetitors,
  loadIntersection,
  refreshCompetitors,
} from '../store/thunks';
import type { CompetitorTechStack, TechStackCategory } from '../types';
import {
  selectCompetitorsList,
  selectCompetitorsSiteId,
  selectCooldownUntil,
  selectError,
  selectIntersection,
  selectIntersectionError,
  selectIntersectionLoading,
  selectIsRefreshing,
  selectLoaded,
  selectLoading,
  selectRefreshError,
  selectSelectedCompetitor,
} from '../store/selectors';
import { TrafficInsightsPanel } from '../traffic/components/TrafficInsightsPanel';

interface Props {
  siteId: string;
}

function formatPosition(n: number | null): string {
  if (n === null) return '—';
  return n.toFixed(1);
}

function formatNumber(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(n);
}

function formatTraffic(v: string | null, locale: string): string {
  if (v === null) return '—';
  const num = Number(v);
  /* v8 ignore next -- server-emitted decimal strings always parse; defence only. */
  if (!Number.isFinite(num)) return '—';
  return `$${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(num)}`;
}

// lucide icon per normalized tech category — no new colors, icons inherit the
// badge's foreground token (design-system §2: lucide only, semantic tokens).
const CATEGORY_ICON: Record<TechStackCategory, LucideIcon> = {
  cms: LayoutGrid,
  analytics: BarChart3,
  hosting: Server,
  ecommerce: ShoppingCart,
  other: Package,
};

const CATEGORY_ORDER: TechStackCategory[] = ['cms', 'analytics', 'hosting', 'ecommerce', 'other'];

interface TechStackCellProps {
  cell: CompetitorTechStack;
  domain: string;
}

/** The expandable per-row tech-stack area: skeleton → badges → empty. */
const TechStackCell = ({ cell, domain }: TechStackCellProps) => {
  const { t } = useTranslation();
  if (cell.loading) {
    return (
      <div
        className="flex flex-wrap gap-2"
        aria-busy="true"
        aria-live="polite"
        data-testid={`competitors-techstack-loading-${domain}`}
      >
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-28" />
      </div>
    );
  }
  if (cell.error) {
    return (
      <p
        className="text-destructive text-sm"
        role="alert"
        data-testid={`competitors-techstack-error-${domain}`}
      >
        {cell.error}
      </p>
    );
  }
  if (cell.entries.length === 0) {
    return (
      <p
        className="text-muted-foreground text-sm"
        data-testid={`competitors-techstack-empty-${domain}`}
      >
        {t('competitors:techStack.empty')}
      </p>
    );
  }
  // Group by category so badges read left-to-right in a stable order.
  const byCategory = CATEGORY_ORDER.flatMap((category) =>
    cell.entries.filter((e) => e.category === category).map((e) => ({ category, name: e.name })),
  );
  return (
    <div className="flex flex-wrap gap-2" data-testid={`competitors-techstack-${domain}`}>
      {byCategory.map((entry) => {
        const Icon = CATEGORY_ICON[entry.category];
        return (
          <Badge key={`${entry.category}-${entry.name}`} variant="secondary" className="gap-1">
            <Icon className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">{t(`competitors:techStack.${entry.category}`)}: </span>
            {entry.name}
          </Badge>
        );
      })}
    </div>
  );
};

export const CompetitorsPanel = ({ siteId }: Props) => {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceView = searchParams.get('view') === 'traffic' ? 'traffic' : 'overview';
  const list = useAppSelector(selectCompetitorsList);
  const intersection = useAppSelector(selectIntersection);
  const selected = useAppSelector(selectSelectedCompetitor);
  const loading = useAppSelector(selectLoading);
  const loaded = useAppSelector(selectLoaded);
  const intersectionLoading = useAppSelector(selectIntersectionLoading);
  const error = useAppSelector(selectError);
  const intersectionError = useAppSelector(selectIntersectionError);
  const isRefreshing = useAppSelector(selectIsRefreshing);
  const cooldownUntil = useAppSelector(selectCooldownUntil);
  const refreshError = useAppSelector(selectRefreshError);
  const sliceSiteId = useAppSelector(selectCompetitorsSiteId);
  // Ref-mirror so the mount effect doesn't re-run when the pending re-key
  // flips sliceSiteId — that would abort its own in-flight dispatch.
  const sliceSiteIdRef = useRef(sliceSiteId);
  sliceSiteIdRef.current = sliceSiteId;

  useEffect(() => {
    if (sliceSiteIdRef.current === siteId) return;
    const promise = dispatch(loadCompetitors({ siteId }));
    return () => {
      promise.abort();
    };
  }, [dispatch, siteId]);

  // Refresh failures surface as a toast — the panel keeps its last data.
  useEffect(() => {
    if (refreshError) toast.error(refreshError);
  }, [refreshError]);

  return (
    <div className="flex flex-col gap-6 px-4 py-8" data-testid="competitors-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t('competitors:title')}</h1>
          <p className="text-muted-foreground text-sm">{t('competitors:description')}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {workspaceView === 'overview' ? (
            <ReportExportControl
              kind="competitors.organic"
              target={{ scope: 'site', siteId }}
              selection={{}}
            />
          ) : null}
          {workspaceView === 'overview' ? (
            <RefreshButton
              onRefresh={() => void dispatch(refreshCompetitors({ siteId }))}
              isRefreshing={isRefreshing}
              cooldownUntil={cooldownUntil}
              labelKey="competitors:refresh.button"
              cooldownKey="competitors:refresh.cooldown"
              data-testid="competitors-refresh"
            />
          ) : null}
        </div>
      </div>

      <Tabs
        value={workspaceView}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          if (value === 'traffic') next.set('view', 'traffic');
          else next.delete('view');
          setSearchParams(next, { replace: true });
        }}
      >
        <TabsList
          variant="line"
          aria-label={t('competitorsTraffic:agency.tabsLabel')}
          data-testid="competitors-workspace-tabs"
          className="h-auto w-full flex-wrap justify-start sm:w-fit"
        >
          <TabsTrigger value="overview" data-testid="competitors-workspace-tab-overview">
            {t('competitorsTraffic:agency.overviewTab')}
          </TabsTrigger>
          <TabsTrigger value="traffic" data-testid="competitors-workspace-tab-traffic">
            {t('competitorsTraffic:agency.trafficTab')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-6 pt-4">
          {error ? (
            <div>
              <Alert variant="destructive" role="alert" data-testid="competitors-error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => void dispatch(loadCompetitors({ siteId }))}
                data-testid="competitors-retry"
              >
                {t('common:retry')}
              </Button>
            </div>
          ) : null}

          {loading && !loaded ? (
            <div
              className="flex flex-col gap-2"
              aria-busy="true"
              aria-live="polite"
              data-testid="competitors-loading"
            >
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : null}

          {list && list.competitors.length > 0 ? (
            <Card data-testid="competitors-table">
              <CardHeader>
                <CardTitle className="text-base">{t('competitors:table.title')}</CardTitle>
                {list.source === 'tracked_keywords' ? (
                  <p
                    className="text-muted-foreground text-xs"
                    data-testid="competitors-source-note"
                  >
                    {t('competitors:table.sourceTrackedKeywords')}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('competitors:table.domain')}</TableHead>
                      <TableHead className="text-end">
                        <TableHeaderHelp
                          label={t('competitors:table.overlap')}
                          description={t('common:tableHelp.keywordOverlap')}
                        />
                      </TableHead>
                      <TableHead className="text-end">
                        <TableHeaderHelp
                          label={t('competitors:table.avgPosition')}
                          description={t('common:tableHelp.averagePosition')}
                        />
                      </TableHead>
                      <TableHead className="text-end">
                        <TableHeaderHelp
                          label={t('competitors:table.estTraffic')}
                          description={t('common:tableHelp.estimatedTraffic')}
                        />
                      </TableHead>
                      <TableHead className="w-32" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.competitors.map((c) => {
                      const isSelected = selected === c.domain;
                      return (
                        <Fragment key={c.domain}>
                          <TableRow
                            data-state={isSelected ? 'selected' : undefined}
                            data-testid={`competitors-row-${c.domain}`}
                          >
                            <TableCell className="font-medium">
                              <span className="flex items-center gap-2.5">
                                <Avatar className="size-8">
                                  <AvatarFallback className="text-xs">
                                    {c.domain.slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                {c.domain}
                              </span>
                            </TableCell>
                            <TableCell className="text-end tabular-nums">
                              {formatNumber(c.intersections, i18n.language)}
                            </TableCell>
                            <TableCell className="text-end tabular-nums">
                              {formatPosition(c.avgPosition)}
                            </TableCell>
                            <TableCell className="text-end tabular-nums">
                              {formatTraffic(c.estimatedTraffic, i18n.language)}
                            </TableCell>
                            <TableCell className="text-end">
                              <span className="flex items-center justify-end gap-2">
                                <ReportExportControl
                                  kind="competitors.tech_stack"
                                  target={{ scope: 'site', siteId }}
                                  selection={{ domain: c.domain }}
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  loading={c.techStack?.loading ?? false}
                                  onClick={() =>
                                    void dispatch(fetchTechStack({ siteId, domain: c.domain }))
                                  }
                                  data-testid={`competitors-techstack-btn-${c.domain}`}
                                >
                                  <Layers className="me-1 h-3 w-3" />
                                  {t('competitors:techStack.action')}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={isSelected ? 'default' : 'outline'}
                                  loading={intersectionLoading && isSelected}
                                  loadingLabel={t('competitors:gap.loading')}
                                  disabled={intersectionLoading && !isSelected}
                                  aria-expanded={isSelected}
                                  aria-controls={`competitors-gap-${c.domain}`}
                                  onClick={() =>
                                    void dispatch(
                                      loadIntersection({
                                        siteId,
                                        competitor: c.domain,
                                      }),
                                    )
                                  }
                                  data-testid={`competitors-gap-btn-${c.domain}`}
                                >
                                  <TrendingUp className="me-1 h-3 w-3" />
                                  {t('competitors:table.gapAction')}
                                </Button>
                              </span>
                            </TableCell>
                          </TableRow>
                          {isSelected ? (
                            <TableRow
                              id={`competitors-gap-${c.domain}`}
                              className="hover:bg-transparent"
                              data-testid="competitors-gap"
                            >
                              <TableCell colSpan={5} className="bg-muted/30 p-4 whitespace-normal">
                                <div
                                  className="space-y-4"
                                  aria-busy={intersectionLoading}
                                  aria-live="polite"
                                >
                                  <h3 className="font-semibold">
                                    {t('competitors:gap.title', {
                                      competitor: c.domain,
                                    })}
                                  </h3>
                                  {intersectionLoading ? (
                                    <div
                                      className="space-y-2"
                                      data-testid="competitors-gap-loading"
                                    >
                                      <Skeleton className="h-8 w-full" />
                                      <Skeleton className="h-8 w-full" />
                                    </div>
                                  ) : intersectionError ? (
                                    <Alert
                                      variant="destructive"
                                      role="alert"
                                      data-testid="competitors-gap-error"
                                    >
                                      <AlertDescription>{intersectionError}</AlertDescription>
                                    </Alert>
                                  ) : intersection && intersection.keywords.length > 0 ? (
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>{t('competitors:gap.keyword')}</TableHead>
                                          <TableHead className="text-end">
                                            <TableHeaderHelp
                                              label={t('competitors:gap.theyRank')}
                                              description={t('common:tableHelp.position')}
                                            />
                                          </TableHead>
                                          <TableHead className="text-end">
                                            <TableHeaderHelp
                                              label={t('competitors:gap.volume')}
                                              description={t('common:tableHelp.searchVolume')}
                                            />
                                          </TableHead>
                                          <TableHead className="text-end">
                                            {t('competitors:table.actions')}
                                          </TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {intersection.keywords.map((k, i) => (
                                          <TableRow
                                            key={`${k.keyword}-${i}`}
                                            data-testid={`competitors-gap-row-${i}`}
                                          >
                                            <TableCell className="whitespace-normal">
                                              {k.keyword}
                                            </TableCell>
                                            <TableCell className="text-end tabular-nums">
                                              {k.target2Position === null
                                                ? '—'
                                                : `#${k.target2Position}`}
                                            </TableCell>
                                            <TableCell className="text-end tabular-nums">
                                              {k.searchVolume === null
                                                ? '—'
                                                : formatNumber(k.searchVolume, i18n.language)}
                                            </TableCell>
                                            <TableCell className="text-end">
                                              <Button asChild size="sm" variant="outline">
                                                <Link
                                                  to={contentAnalysisHref({
                                                    siteId,
                                                    keyword: k.keyword,
                                                    source: 'competitor',
                                                  })}
                                                  data-testid={`competitors-gap-content-${i}`}
                                                >
                                                  <FileText aria-hidden="true" data-icon="inline-start" />
                                                  {t('contentIntelligence:form.title')}
                                                </Link>
                                              </Button>
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  ) : (
                                    <Empty data-testid="competitors-gap-empty">
                                      <EmptyHeader>
                                        <EmptyTitle>{t('competitors:gap.emptyTitle')}</EmptyTitle>
                                        <EmptyDescription>
                                          {t('competitors:gap.empty')}
                                        </EmptyDescription>
                                      </EmptyHeader>
                                      <EmptyContent>
                                        <Button
                                          variant="outline"
                                          onClick={() =>
                                            void dispatch(
                                              loadIntersection({
                                                siteId,
                                                competitor: c.domain,
                                              }),
                                            )
                                          }
                                          data-testid="competitors-gap-refresh"
                                        >
                                          <RefreshCw aria-hidden="true" className="me-1 h-4 w-4" />
                                          {t('competitors:refresh.button')}
                                        </Button>
                                      </EmptyContent>
                                    </Empty>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                          {c.techStack ? (
                            <TableRow data-testid={`competitors-techstack-row-${c.domain}`}>
                              <TableCell colSpan={5} className="bg-muted/30">
                                <TechStackCell cell={c.techStack} domain={c.domain} />
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : loaded && !loading && !error ? (
            <Empty className="w-full max-w-md self-center" data-testid="competitors-empty">
              <EmptyHeader>
                <EmptyTitle>{t('competitors:emptyTitle')}</EmptyTitle>
                <EmptyDescription>{t('competitors:empty')}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={() => void dispatch(refreshCompetitors({ siteId }))}
                  data-testid="competitors-empty-refresh"
                >
                  <RefreshCw aria-hidden="true" className="me-1 h-4 w-4" />
                  {t('competitors:refresh.button')}
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}
        </TabsContent>

        <TabsContent value="traffic" className="pt-4">
          <TrafficInsightsPanel siteId={siteId} />
        </TabsContent>
      </Tabs>
    </div>
  );
};
