import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthSession } from '@features/auth';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Skeleton } from '@shared/ui/skeleton';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { DocsLink } from '@shared/docs/DocsLink';
import {
  selectTrafficDetailError,
  selectTrafficDetailStatus,
  selectTrafficLastRequest,
  selectTrafficListError,
  selectTrafficListStatus,
  selectTrafficLocked,
  selectTrafficPreviewError,
  selectTrafficPreviewErrorKind,
  selectTrafficRequestError,
  selectTrafficRequestErrorKind,
  selectTrafficSnapshotDetail,
  selectTrafficSnapshotList,
  selectTrafficSiteId,
} from '../store/selectors';
import { fetchList, fetchOne } from '../store/thunks';
import { readTrafficFilters } from './SnapshotList';
import { SnapshotDetail } from './SnapshotDetail';
import { SnapshotList } from './SnapshotList';
import { SnapshotRequestForm } from './SnapshotRequestForm';
import { KillSwitchBanner } from './KillSwitchBanner';
import { readTrafficCompareIds, TrafficCompareView } from './TrafficCompareView';

interface TrafficInsightsPanelProps {
  siteId: string;
  /** Prefills the request form so the workspace's own domain is one click away. */
  siteDomain?: string;
}

/** Refresh cadence for a snapshot that is still queued or running. */
export const TRAFFIC_DETAIL_POLL_MS = 5000;

export const TrafficInsightsPanel = ({ siteId, siteDomain }: TrafficInsightsPanelProps) => {
  const { t } = useTranslation('competitorsTraffic');
  const session = useAuthSession();
  const dispatch = useAppDispatch();
  const [params] = useSearchParams();
  const filters = useMemo(() => readTrafficFilters(params), [params]);
  const scopedFilters = useMemo(() => ({ ...filters, siteId }), [filters, siteId]);
  const compareIds = useMemo(() => readTrafficCompareIds(params), [params]);
  const list = useAppSelector(selectTrafficSnapshotList);
  const trafficSiteId = useAppSelector(selectTrafficSiteId);
  const listStatus = useAppSelector(selectTrafficListStatus);
  const listError = useAppSelector(selectTrafficListError);
  const detail = useAppSelector(selectTrafficSnapshotDetail);
  const detailStatus = useAppSelector(selectTrafficDetailStatus);
  const detailError = useAppSelector(selectTrafficDetailError);
  const lastRequest = useAppSelector(selectTrafficLastRequest);
  const locked = useAppSelector(selectTrafficLocked);
  const previewError = useAppSelector(selectTrafficPreviewError);
  const requestError = useAppSelector(selectTrafficRequestError);
  const previewErrorKind = useAppSelector(selectTrafficPreviewErrorKind);
  const requestErrorKind = useAppSelector(selectTrafficRequestErrorKind);
  const scopeMatches = trafficSiteId === siteId;
  const lockedReason =
    (requestErrorKind === 'locked' ? requestError : '') ||
    (previewErrorKind === 'locked' ? previewError : '') ||
    t('states.locked.description');

  useEffect(() => {
    if (!session.authenticated || session.isPending) return;
    const request = dispatch(fetchList(scopedFilters));
    return () => request.abort();
  }, [dispatch, scopedFilters, session.authenticated, session.isPending]);

  useEffect(() => {
    if (!scopeMatches || !lastRequest?.runId) return;
    void dispatch(fetchOne({ id: lastRequest.runId, siteId }));
  }, [dispatch, lastRequest?.runId, scopeMatches, siteId]);

  // A queued/running run re-fetches itself until it settles; the settle then
  // refreshes the stored list so the new snapshot row appears without a reload.
  const detailWasInFlight = useRef(false);
  useEffect(() => {
    if (!scopeMatches) {
      detailWasInFlight.current = false;
      return undefined;
    }
    if (!detail) return undefined;
    if (detail.status === 'queued' || detail.status === 'running') {
      detailWasInFlight.current = true;
      const timer = setTimeout(
        () => void dispatch(fetchOne({ id: detail.id, siteId })),
        TRAFFIC_DETAIL_POLL_MS,
      );
      return () => clearTimeout(timer);
    }
    if (detailWasInFlight.current) {
      detailWasInFlight.current = false;
      void dispatch(fetchList(scopedFilters));
    }
    return undefined;
  }, [detail, dispatch, scopedFilters, scopeMatches, siteId]);

  if (session.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!session.authenticated) {
    return (
      <Alert role="alert">
        <AlertDescription>{t('states.signedOut')}</AlertDescription>
      </Alert>
    );
  }

  if (!scopeMatches) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-6" data-testid="traffic-insights-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <DocsLink slug="traffic-insights" className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline underline-offset-2" />
      </div>
      {locked ? <KillSwitchBanner description={lockedReason} /> : null}
      <SnapshotRequestForm
        siteId={siteId}
        initialDomain={siteDomain}
        disabled={locked}
        disabledReason={lockedReason}
      />
      {compareIds.length >= 2 ? (
        <TrafficCompareView
          key={`compare-${siteId}`}
          ids={compareIds}
          siteId={siteId}
          onCollapse={(remainingId) => {
            void dispatch(fetchOne({ id: remainingId, siteId }));
          }}
        />
      ) : (
        <SnapshotDetail detail={detail} loading={detailStatus === 'loading'} error={detailError} />
      )}
      <SnapshotList
        key={`list-${siteId}`}
        data={list}
        status={listStatus}
        error={listError}
        onOpen={(id) => void dispatch(fetchOne({ id, siteId }))}
      />
    </section>
  );
};
