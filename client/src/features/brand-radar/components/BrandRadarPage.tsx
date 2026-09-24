import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { useI18nDirection } from '@shared/i18n/useDirection';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { DocsLink } from '@shared/docs/DocsLink';
import {
  selectBrandRadarCreateError,
  selectBrandRadarHasPending,
  selectBrandRadarListError,
  selectBrandRadarListStatus,
  selectBrandRadarLoadingMore,
  selectBrandRadarNextCursor,
  selectBrandRadarPreviewError,
  selectBrandRadarRows,
  selectBrandRadarUnavailable,
} from '../store/selectors';
import { loadBrandRadarScans } from '../store/thunks';
import { useBrandRadarUrlState } from '../urlState';
import { NewScanForm } from './NewScanForm';
import { ScanDetailPanel } from './ScanDetailPanel';
import { ScanListTable } from './ScanListTable';

/**
 * Poll cadence while a scan is `queued`/`running`. The shipped
 * `brand_radar_poll` bucket allows 60 stored-read requests per minute per
 * account; 12/min leaves the rest of the workspace room to breathe.
 */
export const BRAND_RADAR_POLL_INTERVAL_MS = 5_000;

export interface BrandRadarPageProps {
  /** Owning site — supplied by the workspace route, never picked in-panel. */
  siteId: string;
}

export const BrandRadarPage = ({ siteId }: BrandRadarPageProps) => {
  const { t, i18n } = useTranslation('brandRadar');
  // Radix pins `dir="ltr"` on the Tabs root unless it is told otherwise, which
  // would render a left-to-right island inside the Arabic shell.
  const direction = useI18nDirection(i18n);
  const dispatch = useAppDispatch();
  const {
    view,
    status: statusFilter,
    scan,
    sentiment,
    domain,
    from,
    to,
    setView,
    setStatus,
    setScan,
    setSentiment,
    setDomain,
    setFrom,
    setTo,
  } = useBrandRadarUrlState();

  const rows = useAppSelector(selectBrandRadarRows);
  const listStatus = useAppSelector(selectBrandRadarListStatus);
  const listError = useAppSelector(selectBrandRadarListError);
  const nextCursor = useAppSelector(selectBrandRadarNextCursor);
  const loadingMore = useAppSelector(selectBrandRadarLoadingMore);
  const hasPending = useAppSelector(selectBrandRadarHasPending);
  const unavailable = useAppSelector(selectBrandRadarUnavailable);
  const previewError = useAppSelector(selectBrandRadarPreviewError);
  const createError = useAppSelector(selectBrandRadarCreateError);

  const refresh = useCallback(() => {
    void dispatch(loadBrandRadarScans({ siteId }));
  }, [dispatch, siteId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!hasPending) return undefined;
    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      refresh();
    };
    const timer = setInterval(tick, BRAND_RADAR_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasPending, refresh]);

  const loadMore = useCallback(
    (cursor: string) => {
      void dispatch(loadBrandRadarScans({ siteId, cursor }));
    },
    [dispatch, siteId],
  );

  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6"
      data-testid="brand-radar-page"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </div>
        <DocsLink slug="brand-radar" className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline underline-offset-2" />
      </header>

      {unavailable ? (
        <Alert role="status" data-testid="brand-radar-unavailable">
          <AlertTitle>{t('states.unavailable.title')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-1">
            <span>{previewError || createError || t('states.unavailable.description')}</span>
            <span>{t('states.unavailable.storedReads')}</span>
          </AlertDescription>
        </Alert>
      ) : null}

      {scan ? (
        <ScanDetailPanel
          scanId={scan}
          filters={{ sentiment, domain, from, to }}
          onBack={() => setScan(null)}
          onSentiment={setSentiment}
          onDomain={setDomain}
          onFrom={setFrom}
          onTo={setTo}
        />
      ) : (
      <Tabs
        dir={direction}
        value={view}
        onValueChange={(value) => setView(value === 'new' ? 'new' : 'scans')}
      >
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
          <TabsTrigger value="scans" data-testid="brand-radar-tab-scans">
            {t('tabs.scans')}
          </TabsTrigger>
          <TabsTrigger value="new" data-testid="brand-radar-tab-new">
            {t('tabs.new')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="scans">
          <ScanListTable
            rows={rows}
            status={listStatus}
            error={listError}
            nextCursor={nextCursor}
            loadingMore={loadingMore}
            statusFilter={statusFilter}
            onStatusFilter={setStatus}
            onLoadMore={loadMore}
            onRetry={refresh}
            onStartScan={() => setView('new')}
            onOpenScan={setScan}
          />
        </TabsContent>
        <TabsContent value="new">
          <NewScanForm
            siteId={siteId}
            locked={unavailable}
            onSubmitted={() => {
              setView('scans');
              refresh();
            }}
          />
        </TabsContent>
      </Tabs>
      )}
    </main>
  );
};
