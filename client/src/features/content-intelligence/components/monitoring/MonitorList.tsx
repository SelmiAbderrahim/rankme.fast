import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Eye } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { StatusChip } from '@shared/ui/status-chip';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  deleteMonitorThunk,
  loadMonitors,
  pauseMonitorThunk,
  resumeMonitorThunk,
} from '../../store/thunks';
import {
  selectMonitorMutateError,
  selectMonitorMutating,
} from '../../store/selectors';
import type { ContentMonitor, ContentMonitorStatus } from '../../types';
import { monitorStatusTone } from './status';

interface MonitorListProps {
  siteId: string;
  monitors: ContentMonitor[];
  loading: boolean;
  loaded: boolean;
  error: string;
  onOpen: (monitorId: string) => void;
  onRetry: () => void;
}

const STATUS_FILTERS = ['all', 'active', 'paused', 'cap_paused', 'error'] as const;
export type MonitorStatusFilter = (typeof STATUS_FILTERS)[number];

export function isMonitorStatusFilter(v: unknown): v is MonitorStatusFilter {
  return typeof v === 'string' && (STATUS_FILTERS as readonly string[]).includes(v);
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

/**
 * The confirmed-monitor list with per-row pause/resume/delete. Delete is guarded
 * by a shadcn `AlertDialog` confirm. The status filter is URL-backed (owned by
 * the parent panel).
 */
export function MonitorList({
  siteId,
  monitors,
  loading,
  loaded,
  error,
  onOpen,
  onRetry,
  filter,
  onFilter,
}: MonitorListProps & {
  filter: MonitorStatusFilter;
  onFilter: (next: MonitorStatusFilter) => void;
}) {
  const { t } = useTranslation('contentIntelligence');
  const mutateError = useAppSelector(selectMonitorMutateError);

  return (
    <Card data-testid="monitor-list">
      <CardHeader>
        <CardTitle>{t('monitoring.list.title')}</CardTitle>
        <CardDescription>{t('monitoring.list.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div role="tablist" className="flex flex-wrap gap-2" data-testid="monitor-filters">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={f === filter ? 'default' : 'outline'}
              role="tab"
              aria-selected={f === filter}
              data-testid={`monitor-filter-${f}`}
              onClick={() => onFilter(f)}
            >
              {t(`monitoring.filters.${f}`)}
            </Button>
          ))}
        </div>

        {mutateError ? (
          <Alert variant="destructive" data-testid="monitor-mutate-error">
            <AlertTitle>{t('monitoring.errors.actionFailed')}</AlertTitle>
            <AlertDescription>{mutateError}</AlertDescription>
          </Alert>
        ) : null}

        {loading && !loaded ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive" data-testid="monitor-list-error">
            <AlertTitle>{t('monitoring.errors.loadFailed')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={onRetry}>
                {t('monitoring.errors.retry')}
              </Button>
            </div>
          </Alert>
        ) : monitors.length === 0 ? (
          <Empty data-testid="monitor-list-empty">
            <EmptyMedia />
            <EmptyContent>
              <EmptyTitle>{t('monitoring.list.empty.title')}</EmptyTitle>
              <EmptyDescription>{t('monitoring.list.empty.description')}</EmptyDescription>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('monitoring.list.columns.target')}</TableHead>
                  <TableHead>{t('monitoring.list.columns.status')}</TableHead>
                  <TableHead>{t('monitoring.list.columns.lastCheck')}</TableHead>
                  <TableHead>{t('monitoring.list.columns.lastChange')}</TableHead>
                  <TableHead className="text-end">
                    {t('monitoring.list.columns.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monitors.map((m) => (
                  <MonitorRow key={m.monitorId} siteId={siteId} monitor={m} onOpen={onOpen} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface MonitorRowProps {
  siteId: string;
  monitor: ContentMonitor;
  onOpen: (monitorId: string) => void;
}

/** Resume is offered for every non-active status; pause only from active. */
function isPausable(status: ContentMonitorStatus): boolean {
  return status === 'active';
}

function MonitorRow({ siteId, monitor, onOpen }: MonitorRowProps) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const mutating = useAppSelector(selectMonitorMutating(monitor.monitorId));
  const [confirmOpen, setConfirmOpen] = useState(false);

  const onPause = useCallback(() => {
    void dispatch(pauseMonitorThunk({ siteId, monitorId: monitor.monitorId }));
  }, [dispatch, monitor.monitorId, siteId]);

  const onResume = useCallback(() => {
    void dispatch(resumeMonitorThunk({ siteId, monitorId: monitor.monitorId }));
  }, [dispatch, monitor.monitorId, siteId]);

  const onDeleteConfirm = useCallback(() => {
    void dispatch(deleteMonitorThunk({ siteId, monitorId: monitor.monitorId })).then((result) => {
      if (deleteMonitorThunk.fulfilled.match(result)) {
        setConfirmOpen(false);
        void dispatch(loadMonitors({ siteId }));
      }
    });
  }, [dispatch, monitor.monitorId, siteId]);

  const pausable = isPausable(monitor.status);

  return (
    <TableRow data-testid={`monitor-row-${monitor.monitorId}`} data-status={monitor.status}>
      <TableCell className="max-w-[16rem]">
        <div className="flex flex-col gap-1">
          <StatusChip tone={monitor.targetKind === 'owned' ? 'primary' : 'info'}>
            {t(`monitoring.targetKinds.${monitor.targetKind}`)}
          </StatusChip>
          {/* eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL contains "noopener noreferrer" */}
          <a
            href={safeExternalHref(monitor.targetUrl)}
            target="_blank"
            rel={SAFE_EXTERNAL_REL}
            className="text-primary inline-flex w-fit items-center gap-1 truncate text-xs hover:underline"
            data-testid={`monitor-target-${monitor.monitorId}`}
          >
            <ExternalLink aria-hidden="true" className="size-3" />
            {monitor.targetUrl}
          </a>
        </div>
      </TableCell>
      <TableCell>
        <StatusChip tone={monitorStatusTone(monitor.status)} aria-live="polite">
          {t(`monitoring.status.${monitor.status}`)}
        </StatusChip>
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {monitor.lastCheckAt
          ? formatDate(monitor.lastCheckAt, i18n.language)
          : t('monitoring.list.never')}
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {monitor.lastMaterialChangeAt
          ? formatDate(monitor.lastMaterialChangeAt, i18n.language)
          : t('monitoring.list.noChange')}
      </TableCell>
      <TableCell className="text-end">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpen(monitor.monitorId)}
            data-testid={`monitor-view-${monitor.monitorId}`}
          >
            <Eye aria-hidden="true" className="me-1 size-4" />
            {t('monitoring.list.view')}
          </Button>
          {pausable ? (
            <Button
              size="sm"
              variant="outline"
              loading={mutating}
              loadingLabel={t('monitoring.list.updating')}
              onClick={onPause}
              data-testid={`monitor-pause-${monitor.monitorId}`}
            >
              {t('monitoring.list.pause')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              loading={mutating}
              loadingLabel={t('monitoring.list.updating')}
              onClick={onResume}
              data-testid={`monitor-resume-${monitor.monitorId}`}
            >
              {t('monitoring.list.resume')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            onClick={() => setConfirmOpen(true)}
            data-testid={`monitor-delete-${monitor.monitorId}`}
          >
            {t('monitoring.list.delete')}
          </Button>
        </div>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('monitoring.list.deleteConfirm.title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('monitoring.list.deleteConfirm.description')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('monitoring.list.deleteConfirm.cancel')}</AlertDialogCancel>
              <Button
                type="button"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                loading={mutating}
                loadingLabel={t('monitoring.list.updating')}
                onClick={onDeleteConfirm}
                data-testid={`monitor-delete-confirm-${monitor.monitorId}`}
              >
                {t('monitoring.list.deleteConfirm.confirm')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}
