import { useEffect } from 'react';
import { Download, FileArchive, Link2, Trash2, Unlink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@shared/components/PageHeader';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
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
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import { Skeleton } from '@shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import type { ReportShareCenterItem, ReportSnapshotSummary } from '../types';
import {
  selectReportExportActiveOperation,
  selectReportExportCapabilitiesError,
  selectReportExportCapabilitiesLoaded,
  selectReportExportEnabled,
  selectReportExportOperationError,
  selectReportShares,
  selectReportSharesCursor,
  selectReportSharesError,
  selectReportSharesLoaded,
  selectReportSharesLoading,
  selectReportSnapshots,
  selectReportSnapshotsCursor,
  selectReportSnapshotsError,
  selectReportSnapshotsLoaded,
  selectReportSnapshotsLoading,
} from '../store/selectors';
import {
  loadReportExportCapabilities,
  loadReportShareCenter,
  loadReportSnapshots,
  redownloadReportSnapshot,
  removeReportSnapshot,
  revokeReportShareFromCenter,
} from '../store/thunks';

type ExportCenterTab = 'downloads' | 'shares';
const VALID_TABS = new Set<ExportCenterTab>(['downloads', 'shares']);

function date(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function shareState(share: ReportShareCenterItem): 'active' | 'revoked' | 'expired' {
  if (share.revokedAt) return 'revoked';
  return Date.parse(share.expiresAt) <= Date.now() ? 'expired' : 'active';
}

export function ExportCenterPage() {
  const { t, i18n } = useTranslation('report');
  const dispatch = useAppDispatch();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const activeTab: ExportCenterTab =
    requested && VALID_TABS.has(requested as ExportCenterTab)
      ? (requested as ExportCenterTab)
      : 'downloads';
  const enabled = useAppSelector(selectReportExportEnabled);
  const capabilitiesLoaded = useAppSelector(selectReportExportCapabilitiesLoaded);
  const capabilitiesError = useAppSelector(selectReportExportCapabilitiesError);
  const snapshots = useAppSelector(selectReportSnapshots);
  const snapshotsCursor = useAppSelector(selectReportSnapshotsCursor);
  const snapshotsLoading = useAppSelector(selectReportSnapshotsLoading);
  const snapshotsLoaded = useAppSelector(selectReportSnapshotsLoaded);
  const snapshotsError = useAppSelector(selectReportSnapshotsError);
  const shares = useAppSelector(selectReportShares);
  const sharesCursor = useAppSelector(selectReportSharesCursor);
  const sharesLoading = useAppSelector(selectReportSharesLoading);
  const sharesLoaded = useAppSelector(selectReportSharesLoaded);
  const sharesError = useAppSelector(selectReportSharesError);
  const operation = useAppSelector(selectReportExportActiveOperation);
  const operationError = useAppSelector(selectReportExportOperationError);

  useEffect(() => {
    void dispatch(loadReportExportCapabilities());
    if (!snapshotsLoaded) void dispatch(loadReportSnapshots(undefined));
    if (!sharesLoaded) void dispatch(loadReportShareCenter(undefined));
  }, [dispatch, sharesLoaded, snapshotsLoaded]);

  const changeTab = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    setParams(next, { replace: true });
  };

  const download = (snapshot: ReportSnapshotSummary) =>
    dispatch(
      redownloadReportSnapshot({
        operationKey: `download:${snapshot.id}`,
        snapshot,
      }),
    );

  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        icon={FileArchive}
        title={t('exportUi.center.title')}
        description={t('exportUi.center.description')}
      />

      {!enabled && capabilitiesLoaded && !capabilitiesError ? (
        <Alert>
          <AlertTitle>{t('exportUi.center.disabledTitle')}</AlertTitle>
          <AlertDescription>{t('exportUi.center.disabledBody')}</AlertDescription>
        </Alert>
      ) : null}
      {operationError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{operationError}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={activeTab} onValueChange={changeTab}>
        <TabsList aria-label={t('exportUi.center.tabsLabel')}>
          <TabsTrigger value="downloads">{t('exportUi.center.downloads')}</TabsTrigger>
          <TabsTrigger value="shares">{t('exportUi.center.shares')}</TabsTrigger>
        </TabsList>

        <TabsContent value="downloads" className="flex flex-col gap-4">
          {capabilitiesError || snapshotsError ? (
            <LoadError
              message={capabilitiesError || snapshotsError}
              loading={snapshotsLoading}
              onRetry={() => {
                if (capabilitiesError) void dispatch(loadReportExportCapabilities());
                if (snapshotsError) void dispatch(loadReportSnapshots(undefined));
              }}
            />
          ) : null}
          {snapshotsLoading && !snapshotsLoaded ? <LoadingRows /> : null}
          {snapshotsLoaded && snapshots.length === 0 ? (
            <CenterEmpty
              icon={Download}
              title={t('exportUi.center.emptyDownloadsTitle')}
              body={t('exportUi.center.emptyDownloadsBody')}
            />
          ) : null}
          {snapshots.length > 0 ? (
            <>
              <div className="hidden overflow-x-auto rounded-lg border md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('exportUi.center.columns.report')}</TableHead>
                      <TableHead>{t('exportUi.center.columns.format')}</TableHead>
                      <TableHead>{t('exportUi.center.columns.created')}</TableHead>
                      <TableHead>{t('exportUi.center.columns.expires')}</TableHead>
                      <TableHead className="text-end">
                        {t('exportUi.center.columns.actions')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshots.map((snapshot) => (
                      <TableRow key={snapshot.id}>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className="font-medium">{snapshot.title}</span>
                            <span className="text-xs text-muted-foreground">{snapshot.kind}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {t(`exportUi.formats.${snapshot.format}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>{date(snapshot.createdAt, i18n.language)}</TableCell>
                        <TableCell>{date(snapshot.expiresAt, i18n.language)}</TableCell>
                        <TableCell>
                          <SnapshotActions
                            snapshot={snapshot}
                            operation={operation}
                            onDownload={download}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="grid gap-3 md:hidden">
                {snapshots.map((snapshot) => (
                  <Card key={snapshot.id}>
                    <CardHeader>
                      <CardTitle className="text-base">{snapshot.title}</CardTitle>
                      <CardDescription>{snapshot.kind}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{t(`exportUi.formats.${snapshot.format}`)}</Badge>
                        <span className="text-sm text-muted-foreground">
                          {date(snapshot.createdAt, i18n.language)}
                        </span>
                      </div>
                      <SnapshotActions
                        snapshot={snapshot}
                        operation={operation}
                        onDownload={download}
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : null}
          {snapshotsCursor ? (
            <Button
              type="button"
              variant="outline"
              loading={snapshotsLoading}
              onClick={() =>
                void dispatch(loadReportSnapshots({ cursor: snapshotsCursor, append: true }))
              }
              className="self-center"
            >
              {t('exportUi.center.more')}
            </Button>
          ) : null}
        </TabsContent>

        <TabsContent value="shares" className="flex flex-col gap-4">
          {capabilitiesError || sharesError ? (
            <LoadError
              message={capabilitiesError || sharesError}
              loading={sharesLoading}
              onRetry={() => {
                if (capabilitiesError) void dispatch(loadReportExportCapabilities());
                if (sharesError) void dispatch(loadReportShareCenter(undefined));
              }}
            />
          ) : null}
          {sharesLoading && !sharesLoaded ? <LoadingRows /> : null}
          {sharesLoaded && shares.length === 0 ? (
            <CenterEmpty
              icon={Link2}
              title={t('exportUi.center.emptySharesTitle')}
              body={t('exportUi.center.emptySharesBody')}
            />
          ) : null}
          {shares.length > 0 ? (
            <div className="grid gap-3">
              {shares.map((share) => {
                const state = shareState(share);
                const busy = operation === `revoke:${share.id}`;
                return (
                  <Card key={share.id}>
                    <CardHeader className="flex flex-row items-start justify-between gap-4">
                      <div className="min-w-0">
                        <CardTitle className="break-words text-base">
                          {share.snapshot?.title ?? t('exportUi.center.deletedReport')}
                        </CardTitle>
                        <CardDescription>{date(share.createdAt, i18n.language)}</CardDescription>
                      </div>
                      <Badge variant={state === 'active' ? 'secondary' : 'outline'}>
                        {t(`exportUi.states.${state}`)}
                      </Badge>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                        <span>
                          {t('exportUi.center.expiresValue', {
                            date: date(share.expiresAt, i18n.language),
                          })}
                        </span>
                        <span>{t('exportUi.center.views', { count: share.accessCount })}</span>
                      </div>
                      {state === 'active' && share.snapshot ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="outline" size="sm" disabled={busy}>
                              <Unlink data-icon="inline-start" />
                              {t('exportUi.actions.revoke')}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent dir={i18n.dir()}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {t('exportUi.confirm.revokeTitle')}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('exportUi.confirm.revokeBody')}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t('exportUi.actions.cancel')}</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() =>
                                  void dispatch(
                                    revokeReportShareFromCenter({
                                      operationKey: `revoke:${share.id}`,
                                      snapshotId: share.snapshotId,
                                      shareId: share.id,
                                    }),
                                  )
                                }
                              >
                                {t('exportUi.actions.revoke')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : null}
          {sharesCursor ? (
            <Button
              type="button"
              variant="outline"
              loading={sharesLoading}
              onClick={() =>
                void dispatch(loadReportShareCenter({ cursor: sharesCursor, append: true }))
              }
              className="self-center"
            >
              {t('exportUi.center.more')}
            </Button>
          ) : null}
        </TabsContent>
      </Tabs>
    </main>
  );
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

function LoadError({
  message,
  loading,
  onRetry,
}: {
  message: string;
  loading: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation('report');
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{message}</span>
        <Button type="button" variant="outline" size="sm" loading={loading} onClick={onRetry}>
          {t('exportUi.actions.retry')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function CenterEmpty({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Download;
  title: string;
  body: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function SnapshotActions({
  snapshot,
  operation,
  onDownload,
}: {
  snapshot: ReportSnapshotSummary;
  operation: string | null;
  onDownload: (snapshot: ReportSnapshotSummary) => unknown;
}) {
  const { t, i18n } = useTranslation('report');
  const dispatch = useAppDispatch();
  const downloading = operation === `download:${snapshot.id}`;
  const deleting = operation === `delete:${snapshot.id}`;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={downloading}
        onClick={() => void onDownload(snapshot)}
      >
        <Download data-icon="inline-start" />
        {t('exportUi.actions.download')}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={deleting}>
            <Trash2 data-icon="inline-start" />
            {t('exportUi.actions.delete')}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent dir={i18n.dir()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('exportUi.confirm.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('exportUi.confirm.deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('exportUi.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                void dispatch(
                  removeReportSnapshot({
                    operationKey: `delete:${snapshot.id}`,
                    snapshotId: snapshot.id,
                  }),
                )
              }
            >
              {t('exportUi.actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
