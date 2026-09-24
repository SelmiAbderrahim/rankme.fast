import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { StatusChip } from '@shared/ui/status-chip';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { loadMonitorFeed, loadMonitors } from '../../store/thunks';
import {
  selectMonitorById,
  selectMonitorDetailError,
  selectMonitorDetailLoading,
  selectMonitorFeed,
  selectMonitorFeedCursor,
  selectMonitorListError,
  selectMonitorListLoaded,
  selectMonitorListLoading,
  selectMonitors,
} from '../../store/selectors';
import { isContentMonitorActive } from '../../types';
import { monitorStatusTone } from './status';
import { MonitorCreateForm } from './MonitorCreateForm';
import { MonitorNotificationsToggle } from './MonitorNotificationsToggle';
import { MonitorList, isMonitorStatusFilter, type MonitorStatusFilter } from './MonitorList';
import { ChangeFeed } from './ChangeFeed';

interface MonitoringPanelProps {
  siteId: string;
}

const MONITOR_PARAM = 'monitor';
const FILTER_PARAM = 'monStatus';
const FEED_LIMIT = 20;
const POLL_MS = 8000;

/**
 * Public-page change monitoring sub-view. Routes between the monitor index
 * (create form + notifications toggle + list) and a single-monitor change feed
 * via `?monitor=`. The status filter persists in `?monStatus=`.
 */
export function MonitoringPanel({ siteId }: MonitoringPanelProps) {
  const [params, setParams] = useSearchParams();
  const monitorId = params.get(MONITOR_PARAM);

  const openMonitor = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      next.set(MONITOR_PARAM, id);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const backToIndex = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete(MONITOR_PARAM);
    setParams(next, { replace: true });
  }, [params, setParams]);

  const goToCompetitors = useCallback(() => {
    const next = new URLSearchParams(params);
    next.set('view', 'competitors');
    next.delete(MONITOR_PARAM);
    setParams(next, { replace: true });
  }, [params, setParams]);

  if (monitorId) {
    return <MonitorDetailView siteId={siteId} monitorId={monitorId} onBack={backToIndex} />;
  }

  return (
    <MonitoringIndex
      siteId={siteId}
      onOpen={openMonitor}
      onManageCompetitors={goToCompetitors}
    />
  );
}

// ---------------------------------------------------------------------------
// Index — create form + notifications toggle + monitor list.
// ---------------------------------------------------------------------------

interface MonitoringIndexProps {
  siteId: string;
  onOpen: (monitorId: string) => void;
  onManageCompetitors: () => void;
}

function MonitoringIndex({ siteId, onOpen, onManageCompetitors }: MonitoringIndexProps) {
  const [params, setParams] = useSearchParams();
  const dispatch = useAppDispatch();
  const monitors = useAppSelector(selectMonitors);
  const loading = useAppSelector(selectMonitorListLoading);
  const loaded = useAppSelector(selectMonitorListLoaded);
  const listError = useAppSelector(selectMonitorListError);

  const rawFilter = params.get(FILTER_PARAM);
  const filter: MonitorStatusFilter = isMonitorStatusFilter(rawFilter) ? rawFilter : 'all';

  useEffect(() => {
    if (rawFilter === null || isMonitorStatusFilter(rawFilter)) return;
    const next = new URLSearchParams(params);
    next.delete(FILTER_PARAM);
    setParams(next, { replace: true });
  }, [params, rawFilter, setParams]);

  const setFilter = useCallback(
    (next: MonitorStatusFilter) => {
      const p = new URLSearchParams(params);
      if (next === 'all') p.delete(FILTER_PARAM);
      else p.set(FILTER_PARAM, next);
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  const loadArgs = useMemo(
    () => (filter === 'all' ? { siteId } : { siteId, status: filter }),
    [siteId, filter],
  );

  useEffect(() => {
    const promise = dispatch(loadMonitors(loadArgs));
    return () => promise.abort();
  }, [dispatch, loadArgs]);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasActive = monitors.some((m) => isContentMonitorActive(m.status));
  useEffect(() => {
    if (!hasActive) return;
    pollTimer.current = setTimeout(() => {
      void dispatch(loadMonitors(loadArgs));
    }, POLL_MS);
    return () => clearTimeout(pollTimer.current!);
  }, [monitors, dispatch, hasActive, loadArgs]);

  const retry = useCallback(() => {
    void dispatch(loadMonitors(loadArgs));
  }, [dispatch, loadArgs]);

  return (
    <div className="flex flex-col gap-4" data-testid="monitoring-panel">
      <MonitorCreateForm
        siteId={siteId}
        onManageCompetitors={onManageCompetitors}
        onCreated={onOpen}
      />
      <MonitorNotificationsToggle />
      <MonitorList
        siteId={siteId}
        monitors={monitors}
        loading={loading}
        loaded={loaded}
        error={listError}
        onOpen={onOpen}
        onRetry={retry}
        filter={filter}
        onFilter={setFilter}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail — one monitor + its change feed.
// ---------------------------------------------------------------------------

interface MonitorDetailViewProps {
  siteId: string;
  monitorId: string;
  onBack: () => void;
}

function MonitorDetailView({ siteId, monitorId, onBack }: MonitorDetailViewProps) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const monitor = useAppSelector(selectMonitorById(monitorId));
  const feed = useAppSelector(selectMonitorFeed(monitorId));
  const cursor = useAppSelector(selectMonitorFeedCursor(monitorId));
  const loading = useAppSelector(selectMonitorDetailLoading(monitorId));
  const detailError = useAppSelector(selectMonitorDetailError(monitorId));

  useEffect(() => {
    const promise = dispatch(loadMonitorFeed({ siteId, monitorId, limit: FEED_LIMIT }));
    return () => promise.abort();
  }, [dispatch, siteId, monitorId]);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = monitor ? isContentMonitorActive(monitor.status) : false;
  useEffect(() => {
    if (!active) return;
    pollTimer.current = setTimeout(() => {
      void dispatch(loadMonitorFeed({ siteId, monitorId, limit: FEED_LIMIT }));
    }, POLL_MS);
    return () => clearTimeout(pollTimer.current!);
  }, [monitor, dispatch, active, siteId, monitorId]);

  const loadMore = useCallback(() => {
    void dispatch(
      loadMonitorFeed({ siteId, monitorId, cursor: cursor!, limit: FEED_LIMIT, append: true }),
    );
  }, [cursor, dispatch, monitorId, siteId]);

  const back = (
    <Button variant="ghost" size="sm" onClick={onBack} data-testid="monitor-detail-back">
      <ArrowLeft aria-hidden="true" className="me-2 size-4 rtl:rotate-180" />
      {t('monitoring.detail.back')}
    </Button>
  );

  if (loading && !monitor) {
    return (
      <div className="flex flex-col gap-4" data-testid="monitor-detail-loading">
        {back}
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (detailError && !monitor) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Alert variant="destructive" data-testid="monitor-detail-error">
          <AlertTitle>{t('monitoring.errors.loadOneFailed')}</AlertTitle>
          <AlertDescription>{detailError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!monitor) {
    return <div className="flex flex-col gap-4">{back}</div>;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="monitor-detail">
      {back}
      <Card data-testid="monitor-detail-summary">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <StatusChip tone={monitorStatusTone(monitor.status)}>
              {t(`monitoring.status.${monitor.status}`)}
            </StatusChip>
            <span className="text-sm font-normal break-all">{monitor.targetUrl}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div className="flex flex-col">
              <dt className="text-muted-foreground text-xs">{t('monitoring.detail.kind')}</dt>
              <dd>{t(`monitoring.targetKinds.${monitor.targetKind}`)}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-muted-foreground text-xs">{t('monitoring.detail.cadence')}</dt>
              <dd>{t(`monitoring.cadence.${monitor.cadence}`, { defaultValue: monitor.cadence })}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-muted-foreground text-xs">{t('monitoring.detail.lastCheck')}</dt>
              <dd>
                {monitor.lastCheckAt
                  ? new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(monitor.lastCheckAt))
                  : t('monitoring.list.never')}
              </dd>
            </div>
          </dl>
          {monitor.error ? (
            <Alert variant="destructive" className="mt-3" data-testid="monitor-detail-error-info">
              <AlertTitle>{t('monitoring.errors.monitorError')}</AlertTitle>
              <AlertDescription>
                {t(`monitoring.errorCategory.${monitor.error.category}`, {
                  defaultValue: t('monitoring.errorCategory.unexpected'),
                })}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
      <ChangeFeed
        monitor={monitor}
        feed={feed}
        nextCursor={cursor}
        loading={loading}
        onLoadMore={loadMore}
      />
    </div>
  );
}
