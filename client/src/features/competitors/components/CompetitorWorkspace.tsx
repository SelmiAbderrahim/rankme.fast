import { Suspense, lazy, useEffect, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  Check,
  ExternalLink,
  FileSearch,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { ReportExportControl } from '@features/report-export';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { formatCountryFromLocation, languageName } from '@shared/markets';
import { safeExternalHref } from '@shared/security';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shared/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@shared/ui/card';
import { Checkbox } from '@shared/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Skeleton } from '@shared/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import {
  clearLandscapePreview,
  toggleLandscapeProfile,
} from '../store/slice';
import {
  acceptCompetitorOpportunity,
  addPortfolioCompetitor,
  cancelCompetitorLandscape,
  confirmCompetitorDiscovery,
  loadCompetitorDiscovery,
  loadCompetitorLandscapeDetail,
  loadCompetitorLandscapeRuns,
  loadCompetitorPortfolio,
  mutatePortfolioCompetitor,
  previewCompetitorDiscovery,
  previewCompetitorLandscape,
  startCompetitorLandscape,
} from '../store/thunks';
import { selectCompetitorIntelligence } from '../store/selectors';
import type {
  CompetitorProfile,
  CompetitorWorkspaceView,
  LandscapeClass,
  LandscapeOpportunity,
  LandscapeState,
} from '../types';
import {
  COMPETITOR_WORKSPACE_VIEWS,
  LANDSCAPE_CLASSES,
  isLandscapeClass,
  useCompetitorWorkspaceView,
} from '../workspaceState';
import { reviewLandscapePageMatch } from '../api';

const LazyCompetitorContentPanel = lazy(async () => {
  const [{ CompetitorContentPanel, contentIntelligenceReducer }, { rootReducer }] =
    await Promise.all([import('@features/content-intelligence'), import('@app/store')]);
  rootReducer.inject({ reducerPath: 'contentIntelligence', reducer: contentIntelligenceReducer });
  return { default: CompetitorContentPanel };
});

const LazyMonitoringPanel = lazy(async () => {
  const [{ MonitoringPanel, contentIntelligenceReducer }, { rootReducer }] = await Promise.all([
    import('@features/content-intelligence'),
    import('@app/store'),
  ]);
  rootReducer.inject({ reducerPath: 'contentIntelligence', reducer: contentIntelligenceReducer });
  return { default: MonitoringPanel };
});

const LazyTrafficInsightsPanel = lazy(async () => {
  const { TrafficInsightsPanel } = await import('@features/competitors/traffic');
  return { default: TrafficInsightsPanel };
});

const TERMINAL_STATES: readonly LandscapeState[] = ['completed', 'partial', 'failed', 'cancelled'];
const COMPETITOR_LIMIT = 10;

function key(scope: string): string {
  return `${scope}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function date(value: string | null, locale: string): string {
  return value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value)) : '—';
}

const ViewFallback = () => (
  <ViewFallbackContent />
);

function ViewFallbackContent() {
  const { t } = useTranslation('competitors');
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t('intelligence.states.loading')}</span>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export interface CompetitorWorkspaceProps {
  siteId: string;
}

export function CompetitorWorkspace({ siteId }: CompetitorWorkspaceProps) {
  const { t } = useTranslation('competitors');
  const dispatch = useAppDispatch();
  const intelligence = useAppSelector(selectCompetitorIntelligence);
  const [view, setView] = useCompetitorWorkspaceView();

  useEffect(() => {
    const request = dispatch(loadCompetitorPortfolio({ siteId }));
    return () => request.abort();
  }, [dispatch, siteId]);

  useEffect(() => {
    if (view !== 'overview') return;
    const request = dispatch(loadCompetitorDiscovery({ siteId }));
    return () => request.abort();
  }, [dispatch, siteId, view]);

  useEffect(() => {
    if (view !== 'keywords' && view !== 'reports') return;
    const request = dispatch(loadCompetitorLandscapeRuns({ siteId }));
    return () => request.abort();
  }, [dispatch, siteId, view]);

  // The reducer is re-keyed by the portfolio request. Keep the previous
  // site's portfolio and reports entirely out of the tree during that handoff.
  if (intelligence.siteId !== siteId) return <ViewFallback />;

  return (
    <div className="flex flex-col gap-5" data-testid="competitor-workspace">
      <div>
        <h2 className="text-2xl font-semibold">{t('intelligence.title')}</h2>
        <p className="text-muted-foreground text-sm">{t('intelligence.description')}</p>
      </div>
      <Tabs value={view} onValueChange={(value) => setView(value as CompetitorWorkspaceView)}>
        <TabsList
          variant="line"
          className="h-auto w-full flex-wrap justify-start"
          aria-label={t('intelligence.views.label')}
          data-testid="competitor-workspace-tabs"
        >
          {COMPETITOR_WORKSPACE_VIEWS.map((item) => (
              <TabsTrigger key={item} value={item} data-testid={`competitor-view-${item}`}>
                {t(`intelligence.views.${item}`)}
              </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <OverviewView siteId={siteId} />
        </TabsContent>
        <TabsContent value="keywords" className="mt-4">
          <KeywordsView siteId={siteId} />
        </TabsContent>
        <TabsContent value="content" className="mt-4">
          <Suspense fallback={<ViewFallback />}>
            <LazyCompetitorContentPanel siteId={siteId} />
          </Suspense>
        </TabsContent>
        <TabsContent value="monitoring" className="mt-4">
          <Suspense fallback={<ViewFallback />}>
            <LazyMonitoringPanel siteId={siteId} />
          </Suspense>
        </TabsContent>
        <TabsContent value="traffic" className="mt-4">
          <Suspense fallback={<ViewFallback />}>
            <LazyTrafficInsightsPanel siteId={siteId} />
          </Suspense>
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsView siteId={siteId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewView({ siteId }: { siteId: string }) {
  const { t, i18n } = useTranslation('competitors');
  const dispatch = useAppDispatch();
  const state = useAppSelector(selectCompetitorIntelligence);
  const [manualUrl, setManualUrl] = useState('');
  const manualId = useId();
  const active = state.profiles.filter((profile) => profile.status === 'active');
  const archived = state.profiles.filter((profile) => profile.status === 'archived');

  const add = async (url: string, source: 'suggested' | 'manual') => {
    const result = await dispatch(
      addPortfolioCompetitor({ siteId, url, source, idempotencyKey: key('portfolio') }),
    );
    if (addPortfolioCompetitor.fulfilled.match(result)) {
      setManualUrl('');
      toast.success(
        result.payload.duplicate
          ? t('intelligence.portfolio.duplicate')
          : t('intelligence.portfolio.confirmed'),
      );
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="competitor-overview">
      <Card>
        <CardHeader>
          <CardTitle>{t('intelligence.portfolio.title')}</CardTitle>
          <CardDescription>
            {t('intelligence.portfolio.description', { active: active.length, max: COMPETITOR_LIMIT })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={manualId}>{t('intelligence.portfolio.manualLabel')}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={manualId}
                type="url"
                value={manualUrl}
                onChange={(event) => setManualUrl(event.target.value)}
                placeholder={t('intelligence.portfolio.manualPlaceholder')}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!manualUrl.trim() || active.length >= COMPETITOR_LIMIT}
                loading={state.mutationKey === manualUrl.trim()}
                loadingLabel={t('intelligence.portfolio.adding')}
                onClick={() => void add(manualUrl.trim(), 'manual')}
              >
                <Plus data-icon="inline-start" />
                {t('intelligence.portfolio.add')}
              </Button>
            </div>
          </div>
          {state.profilesError || state.mutationError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{state.profilesError || state.mutationError}</AlertDescription>
            </Alert>
          ) : null}
          {state.profilesLoading && !state.profilesLoaded ? (
            <ViewFallback />
          ) : (
            <PortfolioTable siteId={siteId} active={active} archived={archived} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('intelligence.discovery.title')}</CardTitle>
          <CardDescription>{t('intelligence.discovery.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state.discovery ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">
                {t(`intelligence.cache.${state.discovery.cache}`)}
              </Badge>
              <Badge variant="outline">
                {t('intelligence.discovery.captured', {
                  date: date(state.discovery.createdAt, i18n.language),
                })}
              </Badge>
              <Badge variant="outline">
                {t(`intelligence.market.${state.discovery.market.source}`)}
              </Badge>
            </div>
          ) : null}
          {state.discoveryError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{state.discoveryError}</AlertDescription>
            </Alert>
          ) : null}
          {state.discovery?.state === 'partial' ? (
            <Alert>
              <AlertTitle>{t('intelligence.states.partial')}</AlertTitle>
              <AlertDescription>{t('intelligence.discovery.partial')}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {state.discovery?.suggestions.map((suggestion) => (
              <Card key={suggestion.registrableDomain}>
                <CardHeader>
                  <CardTitle className="text-base">{suggestion.registrableDomain}</CardTitle>
                  <CardDescription>
                    {t('intelligence.discovery.observed', {
                      date: date(suggestion.capturedAt, i18n.language),
                    })}
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Badge variant="outline">{suggestion.source}</Badge>
                  {suggestion.alreadyConfirmed ? (
                    <Badge>
                      <Check aria-hidden="true" />
                      {t('intelligence.portfolio.confirmedLabel')}
                    </Badge>
                  ) : (
                    <ConfirmSuggestion
                      domain={suggestion.registrableDomain}
                      pending={state.mutationKey === suggestion.origin}
                      onConfirm={() => void add(suggestion.origin, 'suggested')}
                    />
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
          {!state.discoveryLoading && !state.discovery?.suggestions.length ? (
            <p className="text-muted-foreground text-sm">{t('intelligence.discovery.empty')}</p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button
            type="button"
            loading={state.discoveryPreviewLoading}
            loadingLabel={t('intelligence.discovery.previewing')}
            onClick={() => void dispatch(previewCompetitorDiscovery({ siteId }))}
          >
            <Search data-icon="inline-start" />
            {t('intelligence.discovery.previewAction')}
          </Button>
          {state.discoveryPreview ? (
            <DiscoveryConfirmation siteId={siteId} />
          ) : null}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('intelligence.technology.title')}</CardTitle>
          <CardDescription>{t('intelligence.technology.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {t('intelligence.technology.summary', {
              manual: state.profiles.filter((profile) => profile.source === 'manual').length,
              suggested: state.profiles.filter((profile) => profile.source === 'suggested').length,
            })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function PortfolioTable({
  siteId,
  active,
  archived,
}: {
  siteId: string;
  active: CompetitorProfile[];
  archived: CompetitorProfile[];
}) {
  const { t, i18n } = useTranslation('competitors');
  const dispatch = useAppDispatch();
  const state = useAppSelector(selectCompetitorIntelligence);
  const rows = [...active, ...archived];
  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('intelligence.portfolio.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('intelligence.portfolio.empty')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Table>
      <TableCaption className="sr-only">
        {t('intelligence.portfolio.description', { active: active.length, max: COMPETITOR_LIMIT })}
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{t('intelligence.portfolio.domain')}</TableHead>
          <TableHead>{t('intelligence.portfolio.source')}</TableHead>
          <TableHead>{t('intelligence.portfolio.status')}</TableHead>
          <TableHead>{t('intelligence.portfolio.added')}</TableHead>
          <TableHead className="text-end">{t('intelligence.portfolio.action')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((profile) => {
          const action = profile.status === 'active' ? 'archive' : 'restore';
          return (
            <TableRow key={profile.id}>
              <TableCell>{profile.registrableDomain}</TableCell>
              <TableCell>{t(`intelligence.portfolio.sources.${profile.source}`)}</TableCell>
              <TableCell>
                <Badge variant={profile.status === 'active' ? 'default' : 'secondary'}>
                  {t(`intelligence.portfolio.statuses.${profile.status}`)}
                </Badge>
              </TableCell>
              <TableCell>{date(profile.createdAt, i18n.language)}</TableCell>
              <TableCell className="text-end">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={state.mutationKey === profile.id}
                  loadingLabel={t(`intelligence.portfolio.${action}Pending`)}
                  onClick={() =>
                    void dispatch(
                      mutatePortfolioCompetitor({
                        siteId,
                        competitorId: profile.id,
                        action,
                        idempotencyKey: key(action),
                      }),
                    )
                  }
                >
                  {action === 'archive' ? (
                    <Archive data-icon="inline-start" />
                  ) : (
                    <RotateCcw data-icon="inline-start" />
                  )}
                  {t(`intelligence.portfolio.${action}`)}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ConfirmSuggestion({
  domain,
  pending,
  onConfirm,
}: {
  domain: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('competitors');
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" loading={pending}>
          {t('intelligence.portfolio.confirm')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('intelligence.portfolio.confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('intelligence.portfolio.confirmDescription', { domain })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('intelligence.common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t('intelligence.portfolio.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DiscoveryConfirmation({ siteId }: { siteId: string }) {
  const { t } = useTranslation('competitors');
  const dispatch = useAppDispatch();
  const state = useAppSelector(selectCompetitorIntelligence);
  const preview = state.discoveryPreview!;
  return (
    <div className="flex flex-col gap-2">
      {!preview.enabled ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t('intelligence.states.disabled')}</AlertDescription>
        </Alert>
      ) : null}
      <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" disabled={!preview.enabled}>
          {t('intelligence.discovery.reviewAction')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('intelligence.discovery.confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('common:capacity.selfHost')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('intelligence.common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!preview.enabled}
            onClick={() =>
              void dispatch(
                confirmCompetitorDiscovery({ siteId, idempotencyKey: key('discovery') }),
              )
            }
          >
            {t('intelligence.discovery.confirmAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KeywordsView({ siteId }: { siteId: string }) {
  const { t, i18n } = useTranslation('competitors');
  const dispatch = useAppDispatch();
  const state = useAppSelector(selectCompetitorIntelligence);
  const landscapePreview = state.landscapePreview;
  const [params, setParams] = useSearchParams();
  const limit = COMPETITOR_LIMIT;
  const active = state.profiles.filter((profile) => profile.status === 'active');
  const reportId = params.get('report');
  const marketSettingsParams = new URLSearchParams(params);
  marketSettingsParams.set('tab', 'keywords');
  marketSettingsParams.delete('view');
  marketSettingsParams.delete('report');
  marketSettingsParams.delete('class');
  marketSettingsParams.delete('cursor');
  marketSettingsParams.delete('q');

  useEffect(() => {
    if (state.selectedProfileIds.length > 0 || active.length === 0) return;
    const requestedDomains = new Set(
      (params.get('competitors') ?? '')
        .split(',')
        .map((item) => item.trim().toLowerCase().replace(/^www\./, ''))
        .filter(Boolean),
    );
    active
      .filter((profile) => requestedDomains.has(profile.registrableDomain.toLowerCase()))
      .slice(0, limit)
      .forEach((profile) => dispatch(toggleLandscapeProfile(profile.id)));
  }, [active, dispatch, limit, params, state.selectedProfileIds.length]);

  const toggle = (profileId: string) => {
    if (
      !state.selectedProfileIds.includes(profileId) &&
      state.selectedProfileIds.length >= limit
    ) {
      toast.error(t('intelligence.landscape.limit', { count: limit }));
      return;
    }
    dispatch(toggleLandscapeProfile(profileId));
  };

  const start = async () => {
    const result = await dispatch(
      startCompetitorLandscape({
        siteId,
        competitorProfileIds: state.selectedProfileIds,
        locale: i18n.language,
        idempotencyKey: key('landscape'),
      }),
    );
    if (!startCompetitorLandscape.fulfilled.match(result)) return;
    if (result.payload.duplicate) toast.info(t('intelligence.landscape.duplicate'));
    const next = new URLSearchParams(params);
    next.set('view', 'reports');
    next.set('report', result.payload.runId);
    next.delete('cursor');
    setParams(next, { replace: true });
  };

  return (
    <div className="flex flex-col gap-5" data-testid="competitor-keywords">
      {reportId ? <ReportDetail siteId={siteId} runId={reportId} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>{t('intelligence.landscape.title')}</CardTitle>
          <CardDescription>{t('intelligence.landscape.description', { count: limit })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {active.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('intelligence.landscape.emptyTitle')}</EmptyTitle>
                <EmptyDescription>{t('intelligence.landscape.empty')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">
                {t('intelligence.landscape.selection', {
                  selected: state.selectedProfileIds.length,
                  count: limit,
                })}
              </legend>
              {active.map((profile) => (
                <Label key={profile.id} className="flex min-h-11 items-center gap-3 rounded-md border p-3">
                  <Checkbox
                    checked={state.selectedProfileIds.includes(profile.id)}
                    onCheckedChange={() => toggle(profile.id)}
                  />
                  <span>{profile.registrableDomain}</span>
                </Label>
              ))}
            </fieldset>
          )}
          {state.landscapePreviewError || state.startError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>
                {state.landscapePreviewError || state.startError}
              </AlertDescription>
            </Alert>
          ) : null}
          {landscapePreview ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('intelligence.landscape.previewTitle')}</CardTitle>
                <CardDescription>{t('common:capacity.selfHost')}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {t(`intelligence.market.${landscapePreview.market.source}`)}
                </Badge>
                <Badge variant="outline">
                  {formatCountryFromLocation(
                    landscapePreview.market.locationCode,
                    i18n.language,
                    t('common:market.unknownCountry'),
                  )} ·{' '}
                  {languageName(landscapePreview.market.languageCode, i18n.language)
                    ?? t('common:market.unknownLanguage')}
                </Badge>
                <Button asChild size="sm" variant="outline">
                  <Link to={`?${marketSettingsParams.toString()}`}>
                    {t('intelligence.landscape.editMarket')}
                  </Link>
                </Button>
                {!landscapePreview.enabled ? (
                  <Alert variant="destructive" role="alert" className="basis-full">
                    <AlertDescription>{t('intelligence.states.disabled')}</AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
              <CardFooter className="flex gap-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      disabled={!landscapePreview.enabled}
                      loading={state.starting}
                    >
                      {t('intelligence.landscape.reviewAction')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('intelligence.landscape.confirmTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('common:capacity.selfHost')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('intelligence.common.cancel')}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void start()}>
                        {t('intelligence.landscape.confirmAction')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button variant="outline" onClick={() => dispatch(clearLandscapePreview())}>
                  {t('intelligence.common.cancel')}
                </Button>
              </CardFooter>
            </Card>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            disabled={state.selectedProfileIds.length === 0}
            loading={state.landscapePreviewLoading}
            loadingLabel={t('intelligence.landscape.previewing')}
            onClick={() =>
              void dispatch(
                previewCompetitorLandscape({
                  siteId,
                  competitorProfileIds: state.selectedProfileIds,
                }),
              )
            }
          >
            <FileSearch data-icon="inline-start" />
            {t('intelligence.landscape.previewAction')}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function ReportsView({ siteId }: { siteId: string }) {
  const { t, i18n } = useTranslation('competitors');
  const dispatch = useAppDispatch();
  const state = useAppSelector(selectCompetitorIntelligence);
  const [params, setParams] = useSearchParams();
  const runId = params.get('report');
  if (runId) return <ReportDetail siteId={siteId} runId={runId} />;
  return (
    <Card data-testid="competitor-report-history">
      <CardHeader>
        <CardTitle>{t('intelligence.reports.title')}</CardTitle>
        <CardDescription>{t('intelligence.reports.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {state.runsLoading && !state.runsLoaded ? (
          <ViewFallback />
        ) : state.runsError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.runsError}</AlertDescription>
          </Alert>
        ) : state.runs.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('intelligence.reports.emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('intelligence.reports.empty')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableCaption className="sr-only">{t('intelligence.reports.description')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('intelligence.reports.date')}</TableHead>
                <TableHead>{t('intelligence.reports.competitors')}</TableHead>
                <TableHead>{t('intelligence.reports.state')}</TableHead>
                <TableHead className="text-end">{t('intelligence.reports.action')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>{date(run.createdAt, i18n.language)}</TableCell>
                  <TableCell>{run.competitors.map((item) => item.domain).join(', ')}</TableCell>
                  <TableCell><Badge variant="outline">{t(`intelligence.runStates.${run.state}`)}</Badge></TableCell>
                  <TableCell className="text-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const next = new URLSearchParams(params);
                        next.set('report', run.id);
                        next.delete('cursor');
                        setParams(next, { replace: true });
                      }}
                    >
                      {t('intelligence.reports.open')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {state.runsNextCursor ? (
        <CardFooter>
          <Button
            type="button"
            variant="outline"
            loading={state.runsLoading}
            onClick={() =>
              void dispatch(
                loadCompetitorLandscapeRuns({
                  siteId,
                  cursor: state.runsNextCursor!,
                  append: true,
                }),
              )
            }
          >
            {t('intelligence.reports.more')}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function ReportDetail({ siteId, runId }: { siteId: string; runId: string }) {
  const { t, i18n } = useTranslation('competitors');
  const dispatch = useAppDispatch();
  const state = useAppSelector(selectCompetitorIntelligence);
  const [params, setParams] = useSearchParams();
  const className = isLandscapeClass(params.get('class'))
    ? (params.get('class') as LandscapeClass)
    : undefined;
  const competitor = params.get('domain') || undefined;
  const q = (params.get('q') ?? '').slice(0, 200) || undefined;
  const cursor = params.get('cursor') || undefined;
  const detail = state.detail?.run.id === runId ? state.detail : null;

  useEffect(() => {
    const request = dispatch(
      loadCompetitorLandscapeDetail({ siteId, runId, className, competitor, q, cursor }),
    );
    return () => request.abort();
  }, [className, competitor, cursor, dispatch, q, runId, siteId]);

  useEffect(() => {
    if (!detail || TERMINAL_STATES.includes(detail.run.state)) return;
    const timer = window.setTimeout(() => {
      void dispatch(loadCompetitorLandscapeDetail({ siteId, runId, className, competitor, q, cursor }));
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [className, competitor, cursor, detail, dispatch, q, runId, siteId]);

  const patch = (values: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(values)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    if (!('cursor' in values)) next.delete('cursor');
    setParams(next, { replace: true });
  };

  if (state.detailLoading && !detail) return <ViewFallback />;
  if (state.detailError) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertTitle>{t('intelligence.reports.loadFailedTitle')}</AlertTitle>
        <AlertDescription>{state.detailError}</AlertDescription>
      </Alert>
    );
  }
  if (!detail) return null;

  const running = !TERMINAL_STATES.includes(detail.run.state);
  return (
    <div className="flex flex-col gap-5" data-testid="competitor-report-detail">
      <Card>
        <CardHeader>
          <CardTitle>{t('intelligence.detail.title')}</CardTitle>
          <CardDescription>
            {t('intelligence.detail.summary', {
              domain: detail.run.ownedDomain,
              count: detail.run.competitors.length,
              date: date(detail.run.createdAt, i18n.language),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2" aria-live="polite">
            <Badge variant="outline">{t(`intelligence.runStates.${detail.run.state}`)}</Badge>
            <Badge variant="outline">
              {t('intelligence.detail.progress', {
                done: detail.run.progress.completedLegs,
                total: detail.run.progress.totalLegs,
              })}
            </Badge>
            <Badge variant="outline">{t('intelligence.labels.observed')}</Badge>
          </div>
          {running ? (
            <Alert>
              <AlertTitle>{t('intelligence.states.loading')}</AlertTitle>
              <AlertDescription>{t('intelligence.detail.polling')}</AlertDescription>
            </Alert>
          ) : null}
          {detail.run.state === 'partial' && detail.manifest ? (
            <Alert>
              <AlertTitle>{t('intelligence.states.partial')}</AlertTitle>
              <AlertDescription>
                {t('intelligence.detail.partial', {
                  usable: detail.manifest.coverage.usableCompetitors,
                  requested: detail.manifest.coverage.requestedCompetitors,
                  failed: detail.manifest.coverage.failedLegs,
                })}
              </AlertDescription>
            </Alert>
          ) : null}
          {state.actionError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{state.actionError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => patch({ report: null, cursor: null })}
          >
            {t('intelligence.detail.back')}
          </Button>
          {!running && detail.manifest ? (
            <ReportExportControl
              kind="competitors.landscape_run"
              target={{ scope: 'site_resource', siteId, resourceId: runId }}
              selection={{
                ...(className ? { class: [className] } : {}),
                ...(competitor ? { competitor: [competitor] } : {}),
                ...(q ? { query: q } : {}),
              }}
            />
          ) : null}
          {running ? (
            <Button
              type="button"
              variant="destructive"
              loading={state.cancellingRunId === runId}
              onClick={() =>
                void dispatch(
                  cancelCompetitorLandscape({
                    siteId,
                    runId,
                    idempotencyKey: key('cancel'),
                  }),
                )
              }
            >
              {t('intelligence.detail.cancel')}
            </Button>
          ) : null}
        </CardFooter>
      </Card>

      {detail.manifest ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('intelligence.detail.rollupTitle')}</CardTitle>
              <CardDescription>
                {t('intelligence.detail.rollupDescription', {
                  rows: detail.manifest.rowCount,
                  usable: detail.manifest.coverage.usableCompetitors,
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {LANDSCAPE_CLASSES.map((item) => (
                <button
                  type="button"
                  key={item}
                  className="min-h-11 rounded-md border p-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => patch({ class: item })}
                >
                  <span className="block text-sm font-medium">{t(`intelligence.classes.${item}`)}</span>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {detail.manifest!.coverage.rowsByClass[item]}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('intelligence.detail.filtersTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="landscape-class">{t('intelligence.detail.classFilter')}</Label>
                <select
                  id="landscape-class"
                  className="min-h-11 rounded-md border border-input bg-background px-3"
                  value={className ?? ''}
                  onChange={(event) => patch({ class: event.target.value || null })}
                >
                  <option value="">{t('intelligence.detail.allClasses')}</option>
                  {LANDSCAPE_CLASSES.map((item) => (
                    <option key={item} value={item}>{t(`intelligence.classes.${item}`)}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="landscape-domain">{t('intelligence.detail.domainFilter')}</Label>
                <select
                  id="landscape-domain"
                  className="min-h-11 rounded-md border border-input bg-background px-3"
                  value={competitor ?? ''}
                  onChange={(event) => patch({ domain: event.target.value || null })}
                >
                  <option value="">{t('intelligence.detail.allDomains')}</option>
                  {detail.manifest.competitors.map((item) => (
                    <option key={item.profileId} value={item.profileId}>{item.domain}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="landscape-query">{t('intelligence.detail.textFilter')}</Label>
                <Input
                  id="landscape-query"
                  value={q ?? ''}
                  maxLength={200}
                  onChange={(event) => patch({ q: event.target.value || null })}
                />
              </div>
            </CardContent>
          </Card>

          <LandscapeRows />
          <SourceDetails />
          <PageSuggestions siteId={siteId} runId={runId} />
          <Recommendations siteId={siteId} runId={runId} opportunities={detail.manifest.opportunities} />
        </>
      ) : !running ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('intelligence.detail.noDataTitle')}</EmptyTitle>
            <EmptyDescription>{t('intelligence.detail.noData')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </div>
  );
}

function LandscapeRows() {
  const { t, i18n } = useTranslation('competitors');
  const state = useAppSelector(selectCompetitorIntelligence);
  const [params, setParams] = useSearchParams();
  const detail = state.detail!;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('intelligence.detail.keywordsTitle')}</CardTitle>
        <CardDescription>{t('intelligence.detail.keywordsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {detail.items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('intelligence.detail.noMatchTitle')}</EmptyTitle>
              <EmptyDescription>{t('intelligence.detail.noMatch')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableCaption className="sr-only">{t('intelligence.detail.keywordsDescription')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('intelligence.detail.keyword')}</TableHead>
                <TableHead>{t('intelligence.detail.class')}</TableHead>
                <TableHead>{t('intelligence.detail.ownedRank')}</TableHead>
                <TableHead>{t('intelligence.detail.competitorRank')}</TableHead>
                <TableHead>{t('intelligence.detail.volume')}</TableHead>
                <TableHead>{t('intelligence.detail.source')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.keyword}</TableCell>
                  <TableCell><Badge variant="outline">{t(`intelligence.classes.${row.class}`)}</Badge></TableCell>
                  <TableCell>
                    <RankingValue position={row.ownedPosition} url={row.ownedUrl} />
                  </TableCell>
                  <TableCell>
                    <RankingValue position={row.competitorPosition} url={row.competitorUrl} />
                  </TableCell>
                  <TableCell>{row.searchVolume === null ? '—' : new Intl.NumberFormat(i18n.language).format(row.searchVolume)}</TableCell>
                  <TableCell>
                    <span className="flex flex-col gap-1">
                      <Badge variant="outline">{t('intelligence.labels.estimate')}</Badge>
                      <span className="text-muted-foreground text-xs">{row.competitorDomain}</span>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {detail.nextCursor ? (
        <CardFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('cursor', detail.nextCursor!);
              setParams(next, { replace: true });
            }}
          >
            {t('intelligence.detail.next')}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function RankingValue({ position, url }: { position: number | null; url: string | null }) {
  const { t } = useTranslation('competitors');
  if (position === null) return <span>{t('intelligence.detail.missing')}</span>;
  if (!url) return <span>#{position}</span>;
  const href = safeExternalHref(url);
  if (href === '#') return <span>{t('intelligence.states.unsafeLink')}</span>;
  return (
    <a
      href={href}
      rel="nofollow ugc noopener noreferrer"
      className="inline-flex items-center gap-1 underline underline-offset-2"
    >
      #{position}
      <ExternalLink aria-hidden="true" className="size-4" />
    </a>
  );
}

function SourceDetails() {
  const { t, i18n } = useTranslation('competitors');
  const manifest = useAppSelector(selectCompetitorIntelligence).detail!.manifest!;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('intelligence.detail.sourcesTitle')}</CardTitle>
        <CardDescription>{t('intelligence.detail.sourcesDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {manifest.provenance.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('intelligence.detail.sourcesEmpty')}</p>
        ) : manifest.provenance.map((source, index) => (
          <div key={`${source.provider}-${source.leg}-${index}`} className="flex flex-wrap gap-2 rounded-md border p-3">
            <span className="font-medium">{source.provider}</span>
            <Badge variant="outline">{source.leg}</Badge>
            <Badge variant="outline">{t(`intelligence.cache.${source.cache}`)}</Badge>
            <Badge variant="outline">{source.status}</Badge>
            <span className="text-muted-foreground text-sm">
              {t('intelligence.detail.observationDate', {
                date: date(source.capturedAt, i18n.language),
              })}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PageSuggestions({ siteId, runId }: { siteId: string; runId: string }) {
  const { t } = useTranslation('competitors');
  // This component only renders from the manifest branch in ReportDetail.
  const manifest = useAppSelector(selectCompetitorIntelligence).detail!.manifest!;
  const suggestions = manifest.pageSuggestions;
  const [drafts, setDrafts] = useState<Record<string, { ownedUrl: string; competitorUrl: string }>>({});
  const [reviews, setReviews] = useState<Record<string, (typeof suggestions)[number]['review']>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const reviewFor = (suggestion: (typeof suggestions)[number]) => reviews[suggestion.id] ?? suggestion.review;
  const draftFor = (suggestion: (typeof suggestions)[number]) => drafts[suggestion.id] ?? {
    ownedUrl: reviewFor(suggestion).ownedUrl ?? suggestion.ownedUrl,
    competitorUrl: reviewFor(suggestion).competitorUrl ?? suggestion.competitorUrl,
  };
  const save = async (suggestion: (typeof suggestions)[number], decision: 'approved' | 'rejected') => {
    const review = reviewFor(suggestion);
    const draft = draftFor(suggestion);
    setSaving(suggestion.id);
    setError('');
    try {
      const response = await reviewLandscapePageMatch(
        siteId,
        runId,
        suggestion.id,
        {
          decision,
          ownedUrl: decision === 'approved' ? draft.ownedUrl : null,
          competitorUrl: decision === 'approved' ? draft.competitorUrl : null,
          version: review.version,
        },
        `page-match-${suggestion.id}-${Date.now().toString(36)}`,
      );
      setReviews((current) => ({ ...current, [suggestion.id]: response.review }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('intelligence.detail.matchSaveError'));
    } finally {
      setSaving(null);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('intelligence.detail.matchesTitle')}</CardTitle>
        <CardDescription>{t('intelligence.detail.matchesDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
        {suggestions.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('intelligence.detail.matchesEmpty')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {suggestions.map((suggestion) => {
              const review = reviewFor(suggestion);
              const draft = draftFor(suggestion);
              const approved = review.state === 'approved';
              const linkedOpportunity = manifest.opportunities.find(
                (opportunity) =>
                  opportunity.competitorProfileIds.includes(suggestion.competitorProfileId) &&
                  opportunity.keywordKeys.some((keyword) => suggestion.keywordKeys.includes(keyword)),
              );
              const opportunityParam = linkedOpportunity
                ? `&opportunity=${encodeURIComponent(linkedOpportunity.id)}`
                : '';
              const contentHref = `/sites/${siteId}?tab=competitors&view=content&landscapeReport=${encodeURIComponent(runId)}&match=${encodeURIComponent(suggestion.id)}${opportunityParam}`;
              const monitorHref = `/sites/${siteId}?tab=competitors&view=monitoring&prefillTargetUrl=${encodeURIComponent(review.competitorUrl ?? '')}&prefillTargetKind=competitor&prefillCompetitorId=${encodeURIComponent(suggestion.competitorProfileId)}`;
              const analysisHref = `/sites/${siteId}?tab=content&view=analyses&prefillUrl=${encodeURIComponent(review.ownedUrl ?? '')}&prefillKeyword=${encodeURIComponent(linkedOpportunity?.keywordKeys[0] ?? suggestion.keywordKeys[0] ?? '')}&reviewedCompetitorUrls=${encodeURIComponent(review.competitorUrl ?? '')}&landscapeReport=${encodeURIComponent(runId)}&match=${encodeURIComponent(suggestion.id)}${opportunityParam}`;
              return <div key={suggestion.id} className="flex flex-col gap-3 rounded-md border p-3" data-testid={`page-match-${suggestion.id}`}>
                <p className="font-medium">{suggestion.keywordKeys.join(', ')}</p>
                <p className="text-muted-foreground text-sm">
                  {t('intelligence.detail.matchReason', {
                    reason: t(`intelligence.matchReasons.${suggestion.reasonCode}`),
                    confidence: t(`intelligence.confidence.${suggestion.confidence}`),
                  })}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`owned-${suggestion.id}`}>{t('intelligence.detail.matchOwnedUrl')}</Label>
                    <Input id={`owned-${suggestion.id}`} type="url" value={draft.ownedUrl} onChange={(event) => setDrafts((current) => ({ ...current, [suggestion.id]: { ...draft, ownedUrl: event.target.value } }))} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`competitor-${suggestion.id}`}>{t('intelligence.detail.matchCompetitorUrl')}</Label>
                    <Input id={`competitor-${suggestion.id}`} type="url" value={draft.competitorUrl} onChange={(event) => setDrafts((current) => ({ ...current, [suggestion.id]: { ...draft, competitorUrl: event.target.value } }))} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" loading={saving === suggestion.id} onClick={() => void save(suggestion, 'approved')}>{t('intelligence.detail.approveMatch')}</Button>
                  <Button type="button" variant="outline" disabled={saving === suggestion.id} onClick={() => void save(suggestion, 'rejected')}>{t('intelligence.detail.rejectMatch')}</Button>
                  {safeExternalHref(suggestion.competitorUrl) === '#' ? null : (
                    <Button asChild variant="link">
                      <a
                        href={safeExternalHref(suggestion.competitorUrl)}
                        target="_blank"
                        rel="nofollow ugc noopener noreferrer"
                      >
                        {t('intelligence.detail.openSuggested')}
                        <ExternalLink aria-hidden="true" data-icon="inline-end" />
                      </a>
                    </Button>
                  )}
                </div>
                {approved ? <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button asChild variant="outline"><Link to={contentHref}>{t('intelligence.detail.analyzeReviewed')}</Link></Button>
                  <Button asChild variant="outline"><Link to={monitorHref}>{t('intelligence.detail.monitorReviewed')}</Link></Button>
                  <Button asChild variant="outline"><Link to={analysisHref}>{t('intelligence.detail.focusAnalysis')}</Link></Button>
                </div> : null}
              </div>
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Recommendations({
  siteId,
  runId,
  opportunities,
}: {
  siteId: string;
  runId: string;
  opportunities: LandscapeOpportunity[];
}) {
  const { t } = useTranslation('competitors');
  const dispatch = useAppDispatch();
  const intelligence = useAppSelector(selectCompetitorIntelligence);
  const pending = intelligence.acceptingOpportunityId;
  // Recommendations only renders from ReportDetail's retained-manifest branch.
  const suggestions = intelligence.detail!.manifest!.pageSuggestions;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('intelligence.detail.recommendationsTitle')}</CardTitle>
        <CardDescription>{t('intelligence.detail.recommendationsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {opportunities.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('intelligence.detail.recommendationsEmpty')}</p>
        ) : opportunities.map((opportunity) => {
          const reviewedMatch = suggestions.find(
            (suggestion) =>
              suggestion.review.state === 'approved' &&
              Boolean(suggestion.review.ownedUrl) &&
              Boolean(suggestion.review.competitorUrl) &&
              opportunity.competitorProfileIds.includes(suggestion.competitorProfileId) &&
              opportunity.keywordKeys.some((keyword) => suggestion.keywordKeys.includes(keyword)),
          );
          const focusHref = reviewedMatch
            ? `/sites/${siteId}?tab=content&view=analyses&prefillUrl=${encodeURIComponent(reviewedMatch.review.ownedUrl!)}&prefillKeyword=${encodeURIComponent(opportunity.keywordKeys[0]!)}&reviewedCompetitorUrls=${encodeURIComponent(reviewedMatch.review.competitorUrl!)}&landscapeReport=${encodeURIComponent(runId)}&match=${encodeURIComponent(reviewedMatch.id)}&opportunity=${encodeURIComponent(opportunity.id)}`
            : null;
          return <Card key={opportunity.id}>
            <CardHeader>
              <CardTitle className="text-base">{opportunity.title}</CardTitle>
              <CardDescription>{opportunity.recommendation}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge variant="outline">{t(`intelligence.confidence.${opportunity.confidence}`)}</Badge>
              <Badge variant="outline">{t('intelligence.labels.derived')}</Badge>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              {opportunity.acceptedActionId ? (
                <Button asChild variant="outline">
                  <Link to={`/sites/${siteId}?tab=actions&source=competitor_opportunity`}>
                    {t('intelligence.detail.openAction')}
                  </Link>
                </Button>
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" loading={pending === opportunity.id}>
                      {t('intelligence.detail.accept')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('intelligence.detail.acceptTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('intelligence.detail.acceptDescription')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('intelligence.common.cancel')}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          void dispatch(
                            acceptCompetitorOpportunity({
                              siteId,
                              runId,
                              opportunityId: opportunity.id,
                              idempotencyKey: key('accept'),
                            }),
                          )
                        }
                      >
                        {t('intelligence.detail.acceptConfirm')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {focusHref ? (
                <Button asChild variant="outline">
                  <Link to={focusHref}>{t('intelligence.detail.focusAnalysis')}</Link>
                </Button>
              ) : null}
            </CardFooter>
          </Card>
        })}
      </CardContent>
    </Card>
  );
}
