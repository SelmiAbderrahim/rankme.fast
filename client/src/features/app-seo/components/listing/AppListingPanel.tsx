import { useCallback, useEffect, useMemo } from 'react';
import { ClipboardCheck, History, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/ui/empty';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Skeleton } from '@shared/ui/skeleton';
import type { AppListingFinding, AppListingSeverity } from '../../listing-types';
import type { AppProfile } from '../../types';
import { selectAppProfiles } from '../../store/selectors';
import { selectAppSeoListing } from '../../store/listing-selectors';
import { clearAppListingPreview } from '../../store/listing-slice';
import {
  confirmAppListingRun,
  loadAppListingHistory,
  loadLatestAppListing,
  previewAppListingRun,
} from '../../store/listing-thunks';
import { AppListingFindingBuckets, AppListingNotEvaluated } from './AppListingFindingBuckets';
import { AppListingRunDialog } from './AppListingRunDialog';
import { AppListingStoreCard } from './AppListingStoreCard';

const STORES = ['google_play', 'app_store'] as const;
const SEVERITIES: readonly AppListingSeverity[] = ['fixNow', 'watch', 'advisory'];

const profileLabel = (profile: AppProfile) =>
  profile.playPackageId ?? profile.appStoreId ?? profile.id;

export function AppListingPanel({ siteId }: { siteId: string }) {
  const { t, i18n } = useTranslation('appSeoListing');
  const dispatch = useAppDispatch();
  const profiles = useAppSelector(selectAppProfiles);
  const listing = useAppSelector(selectAppSeoListing);
  const [params, setParams] = useSearchParams();
  const requestedProfileId = params.get('profile');
  const profileId =
    requestedProfileId && profiles.some((profile) => profile.id === requestedProfileId)
      ? requestedProfileId
      : (profiles[0]?.id ?? '');
  const profile = profiles.find((candidate) => candidate.id === profileId) ?? null;
  const action = params.get('action');
  const busy = listing.mutationStatus === 'loading';
  const canRun = listing.listingEnabled;
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  );

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
    if (!requestedProfileId && profileId) setUrl({ profile: profileId });
  }, [profileId, requestedProfileId, setUrl]);

  useEffect(() => {
    if (!profileId) return;
    void dispatch(loadLatestAppListing({ siteId, profileId }));
    void dispatch(loadAppListingHistory({ siteId, profileId }));
  }, [dispatch, profileId, siteId]);

  const queuedAt = listing.preview?.queued ? listing.preview.capturedAt : null;
  const queuedReportReady = Boolean(
    queuedAt && listing.report && listing.report.capturedAt >= queuedAt,
  );

  useEffect(() => {
    if (!profileId || !queuedAt || queuedReportReady) return;
    const timer = window.setInterval(() => {
      void dispatch(loadLatestAppListing({ siteId, profileId }));
      void dispatch(loadAppListingHistory({ siteId, profileId }));
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [dispatch, profileId, queuedAt, queuedReportReady, siteId]);

  useEffect(() => {
    if (queuedReportReady) dispatch(clearAppListingPreview());
  }, [dispatch, queuedReportReady]);

  const openPreview = async () => {
    setUrl({ action: 'listing-run' });
    try {
      await dispatch(previewAppListingRun({ siteId, input: { profileId } })).unwrap();
    } catch {
      /* The thunk stores localized API text. */
    }
  };

  const closeDialog = () => {
    dispatch(clearAppListingPreview());
    setUrl({ action: null });
  };

  const confirmRun = async () => {
    try {
      const response = await dispatch(
        confirmAppListingRun({
          siteId,
          input: { profileId },
        }),
      ).unwrap();
      if (response.queued) {
        setUrl({ action: null });
      }
    } catch {
      /* The thunk stores localized API text. */
    }
  };

  const selectProfile = (value: string) => {
    dispatch(clearAppListingPreview());
    setUrl({ profile: value, action: null });
  };

  if (profiles.length === 0) {
    return (
      <Empty data-testid="app-seo-view-listing">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClipboardCheck aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{t('empty.title')}</EmptyTitle>
          <EmptyDescription>{t('empty.description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link to={`/sites/${encodeURIComponent(siteId)}?tab=apps&view=profiles`}>
              {t('empty.cta')}
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (listing.latestStatus === 'loading' && listing.profileId !== profileId) {
    return <Skeleton className="h-96 w-full" />;
  }

  const report = listing.report;
  const parityFindings: AppListingFinding[] =
    report?.findings.filter((finding) => finding.scope === 'parity') ?? [];

  return (
    <div className="flex flex-col gap-6" data-testid="app-seo-view-listing">
      {!listing.listingEnabled ? (
        <Alert>
          <AlertTitle>{t('disabled.title')}</AlertTitle>
          <AlertDescription>{t('disabled.description')}</AlertDescription>
        </Alert>
      ) : null}
      {listing.error ? (
        <Alert variant="destructive">
          <AlertTitle>{t('errors.title')}</AlertTitle>
          <AlertDescription>{listing.error}</AlertDescription>
        </Alert>
      ) : null}
      {queuedAt && !queuedReportReady ? (
        <Alert>
          <AlertTitle>{t('queued.title')}</AlertTitle>
          <AlertDescription>{t('queued.description')}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck aria-hidden="true" className="size-5" />
            {t('run.title')}
          </CardTitle>
          <CardDescription>{t('run.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor="app-listing-profile">{t('run.profile')}</Label>
            <Select value={profileId} onValueChange={selectProfile}>
              <SelectTrigger id="app-listing-profile" className="w-full">
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
          <Button
            loading={busy && action === 'listing-run'}
            loadingLabel={t('run.previewing')}
            disabled={!canRun}
            onClick={() => void openPreview()}
          >
            <Play aria-hidden="true" />
            {t('run.button')}
          </Button>
          <p className="text-muted-foreground text-sm md:col-span-2">{t('run.bound')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle role="heading" aria-level={3}>{t('report.title')}</CardTitle>
              <CardDescription>
                {report
                  ? t('report.capturedAt', { date: date.format(new Date(report.capturedAt)) })
                  : t('report.description')}
              </CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link
                to={`/sites/${encodeURIComponent(siteId)}?tab=apps&view=keywords&profile=${encodeURIComponent(profileId)}`}
              >
                {t('report.keywordsCta')}
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!report ? (
            listing.latestStatus === 'loading' ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <p className="text-muted-foreground text-sm">{t('report.empty')}</p>
            )
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {STORES.map((store) => (
                <AppListingStoreCard
                  key={store}
                  store={store}
                  snapshot={report.stores[store]}
                  findings={report.findings.filter((finding) => finding.scope === store)}
                  notes={report.notObserved.filter((note) => note.store === store)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {report && profile?.paired ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle role="heading" aria-level={3}>{t('parity.title')}</CardTitle>
                <CardDescription>{t('parity.description')}</CardDescription>
              </div>
              <Badge variant="outline">{t('parity.provenance')}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <AppListingFindingBuckets findings={parityFindings} />
            <AppListingNotEvaluated findings={parityFindings} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History aria-hidden="true" className="size-5" />
            {t('history.title')}
          </CardTitle>
          <CardDescription>{t('history.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {listing.historyStatus === 'loading' && listing.history.length === 0 ? (
            <Skeleton className="h-32 w-full" />
          ) : listing.history.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('history.empty')}</p>
          ) : (
            <ol className="grid gap-3">
              {listing.history.map((item) => (
                <li key={item.capturedAt} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-medium">{date.format(new Date(item.capturedAt))}</p>
                    {item.partial ? <Badge variant="outline">{t('history.partial')}</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.stores.map((store) => t(`stores.${store}`)).join(' · ')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {SEVERITIES.map((severity) => (
                      <Badge key={severity} variant="secondary">
                        {t(`history.counts.${severity}`, { count: item.findingCounts[severity] })}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <AppListingRunDialog
        open={action === 'listing-run'}
        preview={listing.preview}
        busy={busy}
        onClose={closeDialog}
        onConfirm={() => void confirmRun()}
      />
    </div>
  );
}
