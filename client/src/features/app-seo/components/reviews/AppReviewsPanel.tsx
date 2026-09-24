import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { MessageSquareText, Play, Search } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Skeleton } from '@shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import type { AppStoreKind } from '../../tracking-types';
import type { AppProfile } from '../../types';
import { selectAppProfiles } from '../../store/selectors';
import { selectAppSeoReviews } from '../../store/reviews-selectors';
import { clearAppReviewPreview, selectAppReviewRun } from '../../store/reviews-slice';
import {
  confirmAppReviewRun,
  loadAppReviewRunDetail,
  loadAppReviewRuns,
  previewAppReviewRun,
} from '../../store/reviews-thunks';
import type { AppReviewRunStatus } from '../../reviews-types';
import { AppReviewClusters } from './AppReviewClusters';
import { AppReviewRunDialog } from './AppReviewRunDialog';
import { AppReviewStatsView } from './AppReviewStats';

const profileLabel = (profile: AppProfile) =>
  profile.playPackageId ?? profile.appStoreId ?? profile.id;

const terminal = (status: AppReviewRunStatus) => status === 'completed' || status === 'failed';

const statusClass = (status: AppReviewRunStatus) => {
  if (status === 'completed') return 'bg-success/10 text-success';
  if (status === 'failed') return 'bg-destructive/10 text-destructive';
  if (status === 'pulling' || status === 'clustering') return 'bg-info/10 text-info';
  return 'bg-warning/10 text-warning';
};

export function AppReviewsPanel({ siteId }: { siteId: string }) {
  const { t, i18n } = useTranslation('appSeoReviews');
  const dispatch = useAppDispatch();
  const profiles = useAppSelector(selectAppProfiles);
  const reviews = useAppSelector(selectAppSeoReviews);
  const [params, setParams] = useSearchParams();
  const profileId = params.get('profile') ?? profiles[0]?.id ?? '';
  const profile = profiles.find((candidate) => candidate.id === profileId) ?? null;
  const stores = useMemo(
    () => [
      ...(profile?.playPackageId ? ['google_play' as const] : []),
      ...(profile?.appStoreId ? ['app_store' as const] : []),
    ],
    [profile],
  );
  const requestedStore = params.get('reviewStore');
  const store: AppStoreKind = stores.includes(requestedStore as AppStoreKind)
    ? (requestedStore as AppStoreKind)
    : (stores[0] ?? 'google_play');
  const selectedRunId = params.get('reviewRun');
  const action = params.get('action');
  const busy = reviews.mutationStatus === 'loading';
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  );
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const canRun = reviews.reviewsEnabled;

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
    if (stores.length > 0 && params.get('reviewStore') !== store) {
      setUrl({ reviewStore: store, reviewRun: null });
    }
  }, [params, setUrl, store, stores.length]);

  useEffect(() => {
    if (profileId && stores.length > 0) {
      void dispatch(loadAppReviewRuns({ siteId, profileId, store }));
    }
  }, [dispatch, profileId, siteId, store, stores.length]);

  useEffect(() => {
    dispatch(selectAppReviewRun(selectedRunId));
    if (selectedRunId && stores.length > 0) {
      void dispatch(loadAppReviewRunDetail({ siteId, runId: selectedRunId }));
    }
  }, [dispatch, selectedRunId, siteId, stores.length]);

  const selectedSummary = selectedRunId
    ? reviews.items.find((item) => item.id === selectedRunId)
    : null;
  const selectedStatus =
    reviews.selectedRun?.id === selectedRunId
      ? reviews.selectedRun.status
      : selectedSummary?.status;

  useEffect(() => {
    if (!profileId || !selectedRunId || !selectedStatus || terminal(selectedStatus)) return;
    const timer = window.setTimeout(() => {
      void dispatch(loadAppReviewRunDetail({ siteId, runId: selectedRunId }));
      void dispatch(loadAppReviewRuns({ siteId, profileId, store }));
    }, 2_500);
    return () => window.clearTimeout(timer);
  }, [dispatch, profileId, selectedRunId, selectedStatus, siteId, store]);

  const openPreview = async () => {
    setUrl({ action: 'review-run' });
    try {
      await dispatch(
        previewAppReviewRun({
          siteId,
          input: { profileId, store },
        }),
      ).unwrap();
    } catch {
      /* The thunk stores localized API text. */
    }
  };

  const closeDialog = () => {
    dispatch(clearAppReviewPreview());
    setUrl({ action: null });
  };

  const confirmRun = async () => {
    try {
      const response = await dispatch(
        confirmAppReviewRun({
          siteId,
          input: { profileId, store },
        }),
      ).unwrap();
      const runId = response.run?.id ?? null;
      dispatch(clearAppReviewPreview());
      setUrl({ action: null, reviewRun: runId });
      void dispatch(loadAppReviewRuns({ siteId, profileId, store }));
    } catch {
      /* The thunk stores localized API text. */
    }
  };

  if (profiles.length === 0) {
    return (
      <Empty data-testid="app-seo-view-reviews">
        <EmptyHeader>
          <EmptyTitle>{t('empty.noProfileTitle')}</EmptyTitle>
          <EmptyDescription>{t('empty.noProfileDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (reviews.listStatus === 'loading' && reviews.profileId !== profileId) {
    return <Skeleton className="h-72 w-full" />;
  }

  return (
    <div className="flex flex-col gap-6" data-testid="app-seo-view-reviews">
      {!reviews.reviewsEnabled ? (
        <Alert>
          <AlertTitle>{t('disabled.title')}</AlertTitle>
          <AlertDescription>{t('disabled.description')}</AlertDescription>
        </Alert>
      ) : null}
      {reviews.error ? (
        <Alert variant="destructive">
          <AlertTitle>{t('errors.title')}</AlertTitle>
          <AlertDescription>{reviews.error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText aria-hidden="true" className="size-5" />
            {t('run.title')}
          </CardTitle>
          <CardDescription>{t('run.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="app-review-profile">{t('scope.profile')}</Label>
            <Select
              value={profileId}
              onValueChange={(value) =>
                setUrl({
                  profile: value,
                  reviewRun: null,
                  reviewStore: null,
                })
              }
            >
              <SelectTrigger id="app-review-profile" className="w-full">
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
            <Label htmlFor="app-review-store">{t('scope.store')}</Label>
            <Select
              value={store}
              onValueChange={(value) =>
                setUrl({
                  reviewStore: value,
                  reviewRun: null,
                })
              }
            >
              <SelectTrigger id="app-review-store" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stores.map((item) => (
                  <SelectItem key={item} value={item}>
                    {t(`stores.${item}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4 md:col-span-2">
            <p className="text-muted-foreground text-sm">{t('run.bound')}</p>
            <Button
              loading={busy && action === 'review-run'}
              loadingLabel={t('run.previewing')}
              disabled={!canRun}
              onClick={() => void openPreview()}
            >
              <Play aria-hidden="true" />
              {t('run.button')}
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
          {reviews.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('empty.noRuns')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('list.started')}</TableHead>
                  <TableHead>{t('list.status')}</TableHead>
                  <TableHead>{t('list.reviews')}</TableHead>
                  <TableHead>{t('list.average')}</TableHead>
                  <TableHead className="text-end">{t('list.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.items.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{date.format(new Date(run.createdAt))}</TableCell>
                    <TableCell>
                      <Badge className={statusClass(run.status)}>{t(`status.${run.status}`)}</Badge>
                    </TableCell>
                    <TableCell>{number.format(run.reviewCount)}</TableCell>
                    <TableCell>
                      {run.averageRating === null
                        ? t('common.notAvailable')
                        : number.format(run.averageRating)}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setUrl({ reviewRun: run.id })}
                      >
                        <Search aria-hidden="true" />
                        {t('list.view')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedRunId ? (
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={3}>{t('detail.title')}</CardTitle>
            <CardDescription>{t('detail.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-8">
            {reviews.detailStatus === 'loading' || reviews.selectedRun?.id !== selectedRunId ? (
              <Skeleton className="h-64 w-full" />
            ) : reviews.selectedRun?.status === 'failed' ? (
              <Alert variant="destructive">
                <AlertTitle>{t('states.failedTitle')}</AlertTitle>
                <AlertDescription>{t('states.failedDescription')}</AlertDescription>
              </Alert>
            ) : (
              <>
                {reviews.selectedRun.stats ? (
                  <AppReviewStatsView stats={reviews.selectedRun.stats} />
                ) : (
                  <p className="text-muted-foreground text-sm">{t('states.pending')}</p>
                )}
                <section className="flex flex-col gap-4" aria-labelledby="review-clusters-title">
                  <h3 id="review-clusters-title" className="text-lg font-semibold">
                    {t('clusters.title')}
                  </h3>
                  <AppReviewClusters run={reviews.selectedRun} />
                </section>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <AppReviewRunDialog
        open={action === 'review-run'}
        preview={reviews.preview}
        busy={busy}
        onClose={closeDialog}
        onConfirm={() => void confirmRun()}
      />
    </div>
  );
}
