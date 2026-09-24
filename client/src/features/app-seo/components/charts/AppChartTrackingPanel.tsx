import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { History, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { DeltaPill } from '@shared/ui/delta-pill';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Skeleton } from '@shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import type { AppStoreKind } from '../../tracking-types';
import type { AppProfile } from '../../types';
import { selectAppProfiles } from '../../store/selectors';
import { selectAppSeoCharts } from '../../store/charts-selectors';
import { clearAppSeoChartsPreview, selectAppChartSubscription } from '../../store/charts-slice';
import {
  confirmAppChartRecheck,
  createAppChart,
  deleteAppChart,
  loadAppChartHistory,
  loadTrackedAppCharts,
  previewAppChartRecheck,
} from '../../store/charts-thunks';
import { AppChartHistoryChart } from './AppChartHistoryChart';

const profileLabel = (profile: AppProfile) =>
  profile.playPackageId ?? profile.appStoreId ?? profile.id;

export function AppChartTrackingPanel({ siteId }: { siteId: string }) {
  const { t } = useTranslation('appSeoCharts');
  const dispatch = useAppDispatch();
  const profiles = useAppSelector(selectAppProfiles);
  const charts = useAppSelector(selectAppSeoCharts);
  const [params, setParams] = useSearchParams();
  const profileId = params.get('profile') ?? profiles[0]?.id ?? '';
  const profile = profiles.find((candidate) => candidate.id === profileId) ?? null;
  const selectedSubscriptionId = params.get('chartSubscription');
  const selectedSubscription =
    charts.items.find((item) => item.id === selectedSubscriptionId) ?? null;
  const availableStores = useMemo(
    () => [
      ...(profile?.playPackageId ? ['google_play' as const] : []),
      ...(profile?.appStoreId ? ['app_store' as const] : []),
    ],
    [profile],
  );
  const requestedStore = params.get('chartStore');
  const store: AppStoreKind = availableStores.includes(requestedStore as AppStoreKind)
    ? (requestedStore as AppStoreKind)
    : (availableStores[0] ?? 'google_play');
  const catalog = charts.catalogs[store];
  const requestedChart = params.get('chartType');
  const chartId = catalog.charts.some((item) => item.id === requestedChart)
    ? requestedChart!
    : (catalog.charts[0]?.id ?? '');
  const requestedCategory = params.get('chartCategory');
  const categoryId = catalog.categories.some((item) => item.id === requestedCategory)
    ? requestedCategory!
    : (catalog.categories[0]?.id ?? '');
  const action = params.get('action');
  const busy = charts.mutationStatus === 'loading';
  const atLimit = charts.items.length >= charts.limit;

  const setUrl = useCallback(
    (values: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(values)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => {
    if (!params.get('profile') && profiles[0]) setUrl({ profile: profiles[0].id });
  }, [params, profiles, setUrl]);

  useEffect(() => {
    if (profileId) void dispatch(loadTrackedAppCharts({ siteId, profileId }));
  }, [dispatch, profileId, siteId]);

  useEffect(() => {
    if (!availableStores.length) return;
    const values: Record<string, string | null> = {};
    if (params.get('chartStore') !== store) values.chartStore = store;
    if (chartId && params.get('chartType') !== chartId) values.chartType = chartId;
    if (categoryId && params.get('chartCategory') !== categoryId) {
      values.chartCategory = categoryId;
    }
    if (Object.keys(values).length) setUrl(values);
  }, [availableStores.length, categoryId, chartId, params, setUrl, store]);

  useEffect(() => {
    dispatch(selectAppChartSubscription(selectedSubscriptionId));
    if (selectedSubscriptionId) {
      void dispatch(loadAppChartHistory({ siteId, subscriptionId: selectedSubscriptionId }));
    }
  }, [dispatch, selectedSubscriptionId, siteId]);

  const labelFor = (kind: 'chart' | 'category', id: string, itemStore = store) => {
    const source =
      kind === 'chart' ? charts.catalogs[itemStore].charts : charts.catalogs[itemStore].categories;
    const entry = source.find((item) => item.id === id);
    return entry ? t(entry.nameKey) : id;
  };

  const closeDialog = () => {
    dispatch(clearAppSeoChartsPreview());
    setUrl({ action: null });
  };

  const addSubscription = async () => {
    try {
      await dispatch(
        createAppChart({
          siteId,
          input: { profileId, store, chartId, categoryId },
        }),
      ).unwrap();
    } catch {
      /* The thunk stores localized API text. */
    }
  };

  const previewRecheck = async (subscriptionId: string) => {
    setUrl({ chartSubscription: subscriptionId, action: 'chart-recheck' });
    try {
      await dispatch(previewAppChartRecheck({ siteId, subscriptionId })).unwrap();
    } catch {
      /* The thunk stores localized API text. */
    }
  };

  const confirmRecheck = async () => {
    if (!selectedSubscriptionId) return;
    try {
      await dispatch(
        confirmAppChartRecheck({
          siteId,
          subscriptionId: selectedSubscriptionId,
        }),
      ).unwrap();
      closeDialog();
    } catch {
      /* The thunk stores localized API text. */
    }
  };

  if (profiles.length === 0) {
    return (
      <Empty data-testid="app-seo-view-charts">
        <EmptyHeader>
          <EmptyTitle>{t('empty.noProfileTitle')}</EmptyTitle>
          <EmptyDescription>{t('empty.noProfileDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (charts.listStatus === 'loading' && charts.profileId !== profileId) {
    return <Skeleton className="h-72 w-full" />;
  }

  return (
    <div className="flex flex-col gap-6" data-testid="app-seo-view-charts">
      {!charts.trackingEnabled ? (
        <Alert>
          <AlertTitle>{t('disabled.title')}</AlertTitle>
          <AlertDescription>{t('disabled.description')}</AlertDescription>
        </Alert>
      ) : null}
      {charts.error ? (
        <Alert variant="destructive">
          <AlertTitle>{t('errors.title')}</AlertTitle>
          <AlertDescription>{charts.error}</AlertDescription>
        </Alert>
      ) : null}
      {atLimit ? (
        <Alert>
          <AlertTitle>{t('limit.title')}</AlertTitle>
          <AlertDescription>{t('limit.description', { limit: charts.limit })}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('form.title')}</CardTitle>
          <CardDescription>{t('form.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="app-chart-profile">{t('form.profile')}</Label>
            <Select
              value={profileId}
              onValueChange={(value) =>
                setUrl({
                  profile: value,
                  chartSubscription: null,
                })
              }
            >
              <SelectTrigger id="app-chart-profile" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {profileLabel(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="app-chart-store">{t('form.store')}</Label>
            <Select
              value={store}
              onValueChange={(value) => {
                const nextStore = value as AppStoreKind;
                const nextCatalog = charts.catalogs[nextStore];
                setUrl({
                  chartStore: nextStore,
                  chartType: nextCatalog.charts[0]?.id ?? null,
                  chartCategory: nextCatalog.categories[0]?.id ?? null,
                });
              }}
            >
              <SelectTrigger id="app-chart-store" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableStores.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item === 'google_play' ? t('stores.googlePlay') : t('stores.appStore')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="app-chart-type">{t('form.chart')}</Label>
            <Select value={chartId} onValueChange={(value) => setUrl({ chartType: value })}>
              <SelectTrigger id="app-chart-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.charts.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {t(item.nameKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="app-chart-category">{t('form.category')}</Label>
            <Select value={categoryId} onValueChange={(value) => setUrl({ chartCategory: value })}>
              <SelectTrigger id="app-chart-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.categories.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {t(item.nameKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4 md:col-span-2">
            <p className="text-muted-foreground text-sm">
              {t('form.usage', { used: charts.items.length, limit: charts.limit })}
            </p>
            <Button
              loading={busy}
              loadingLabel={t('form.adding')}
              disabled={!charts.trackingEnabled || atLimit || !chartId || !categoryId}
              onClick={() => void addSubscription()}
            >
              <Plus aria-hidden="true" />
              {t('form.add')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('list.title')}</CardTitle>
          <CardDescription>{t('list.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {charts.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('empty.noSubscriptions')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('list.chart')}</TableHead>
                  <TableHead>{t('list.category')}</TableHead>
                  <TableHead>{t('list.position')}</TableHead>
                  <TableHead>{t('list.change')}</TableHead>
                  <TableHead className="text-end">{t('list.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {charts.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {labelFor('chart', item.chartId, item.store)}
                    </TableCell>
                    <TableCell>{labelFor('category', item.categoryId, item.store)}</TableCell>
                    <TableCell>
                      {item.lastCheckedAt
                        ? (item.latestPosition ?? t('list.notInTop100'))
                        : t('list.neverChecked')}
                    </TableCell>
                    <TableCell>
                      <DeltaPill value={item.delta} />
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={t('list.historyLabel')}
                          onClick={() => setUrl({ chartSubscription: item.id, action: null })}
                        >
                          <History aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={t('list.recheckLabel')}
                          disabled={!charts.trackingEnabled}
                          onClick={() => void previewRecheck(item.id)}
                        >
                          <RefreshCw aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('list.deleteLabel')}
                          loading={busy}
                          onClick={() =>
                            void dispatch(
                              deleteAppChart({
                                siteId,
                                subscriptionId: item.id,
                              }),
                            )
                          }
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedSubscription ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('history.title')}</CardTitle>
            <CardDescription>{t('history.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            {charts.historyStatus === 'loading' ? (
              <Skeleton className="h-52 w-full" />
            ) : (
              <AppChartHistoryChart subscription={selectedSubscription} points={charts.history} />
            )}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={action === 'chart-recheck'} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('recheck.title')}</DialogTitle>
            <DialogDescription>{t('recheck.description')}</DialogDescription>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">{t('recheck.top100')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t('common:cancel')}
            </Button>
            <Button
              loading={busy}
              loadingLabel={t('recheck.confirming')}
              onClick={() => void confirmRecheck()}
            >
              {t('recheck.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
