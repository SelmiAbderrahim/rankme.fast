/**
 * Geogrid workspace panel.
 *
 * Composes the definition form, the preview→confirm disclosure, the heat grid
 * with its mandatory accessible table fallback, and the free stored-scan
 * history. Selection is URL-backed (`?scan=`, `?cell=`) per
 * `.claude/rules/url-tab-state.md`.
 *
 * data-testid contract:
 *   - geogrid-panel                 root
 *   - geogrid-preview-card          paid-scan confirmation
 *   - geogrid-confirm               paid submit
 *   - geogrid-cancel                cancel (spends nothing)
 *   - geogrid-cell-detail           focused-cell readout
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { ReportExportControl } from '@features/report-export';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@shared/ui/empty';
import { Skeleton } from '@shared/ui/skeleton';
import { fetchGeogridKeywordOptions, type GeogridKeywordOption } from '../api';
import { useGeogridUrlState } from '../urlState';
import { validateGeogridForm, type GeogridFieldError } from '../validation';
import {
  clearGeogridPreview,
  setGeogridFormField,
  setGeogridSiteId,
} from '../store/slice';
import {
  loadGeogridScan,
  loadGeogridScans,
  previewGeogrid,
  submitGeogridScan,
} from '../store/thunks';
import {
  selectGeogridDetail,
  selectGeogridDetailGate,
  selectGeogridDetailStatus,
  selectGeogridForm,
  selectGeogridPreview,
  selectGeogridPreviewDefinition,
  selectGeogridPreviewGate,
  selectGeogridPreviewStatus,
  selectGeogridScans,
  selectGeogridScansGate,
  selectGeogridScansStatus,
  selectGeogridSubmitGate,
  selectGeogridSubmitting,
} from '../store/selectors';
import type { GeogridDefinition, GeogridSize } from '../types';
import { GeogridCellTable } from './GeogridCellTable';
import { GeogridForm } from './GeogridForm';
import { GeogridHeatGrid } from './GeogridHeatGrid';
import { GeogridScanHistory } from './GeogridScanHistory';
import { GeogridGateNotice, GeogridOutcomeBanner } from './GeogridStatePanels';

const GEOGRID_POLL_INTERVAL_MS = 1_500;

interface Props {
  siteId: string;
}

export const GeogridPanel = ({ siteId }: Props) => {
  const { t } = useTranslation('geogrid');
  const dispatch = useAppDispatch();
  const form = useAppSelector(selectGeogridForm);
  const scans = useAppSelector(selectGeogridScans);
  const scansStatus = useAppSelector(selectGeogridScansStatus);
  const scansGate = useAppSelector(selectGeogridScansGate);
  const detail = useAppSelector(selectGeogridDetail);
  const detailStatus = useAppSelector(selectGeogridDetailStatus);
  const detailGate = useAppSelector(selectGeogridDetailGate);
  const preview = useAppSelector(selectGeogridPreview);
  const previewDefinition = useAppSelector(selectGeogridPreviewDefinition);
  const previewStatus = useAppSelector(selectGeogridPreviewStatus);
  const previewGate = useAppSelector(selectGeogridPreviewGate);
  const submitting = useAppSelector(selectGeogridSubmitting);
  const submitGate = useAppSelector(selectGeogridSubmitGate);

  const [urlState, setUrlState] = useGeogridUrlState();
  const [keywords, setKeywords] = useState<GeogridKeywordOption[]>([]);
  const [errors, setErrors] = useState<GeogridFieldError[]>([]);
  useEffect(() => {
    dispatch(setGeogridSiteId(siteId));
  }, [dispatch, siteId]);

  useEffect(() => {
    void dispatch(loadGeogridScans({ siteId }));
    let cancelled = false;
    void fetchGeogridKeywordOptions(siteId)
      .then((options) => {
        if (!cancelled) setKeywords(options);
      })
      .catch(() => {
        if (!cancelled) setKeywords([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch, siteId]);

  useEffect(() => {
    if (!urlState.scanId) return;
    void dispatch(loadGeogridScan({ siteId, scanId: urlState.scanId }));
  }, [dispatch, siteId, urlState.scanId]);

  const activeScanId = detail?.id;
  const activeScanStatus = detail?.status;
  useEffect(() => {
    if (
      !activeScanId ||
      activeScanId !== urlState.scanId ||
      (activeScanStatus !== 'queued' && activeScanStatus !== 'running')
    ) {
      return;
    }
    let inFlight: { abort: () => void } | undefined;
    const timer = window.setInterval(() => {
      inFlight = dispatch(loadGeogridScan({ siteId, scanId: activeScanId }));
    }, GEOGRID_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      inFlight?.abort();
    };
  }, [activeScanId, activeScanStatus, dispatch, siteId, urlState.scanId]);

  useEffect(() => {
    if (
      !detail ||
      detail.id !== urlState.scanId ||
      detail.status === 'queued' ||
      detail.status === 'running'
    ) {
      return;
    }
    void dispatch(loadGeogridScans({ siteId }));
  }, [detail, dispatch, siteId, urlState.scanId]);

  const runPreview = useCallback(() => {
    const validation = validateGeogridForm(form);
    setErrors(validation.errors);
    if (!validation.definition) return;
    void dispatch(previewGeogrid({ siteId, definition: validation.definition }));
  }, [dispatch, form, siteId]);

  /**
   * Submits EXACTLY the definition the estimate was made for — never a
   * re-read of the form, so a race between an edit and a click can never
   * spend on a grid the user did not confirm.
   */
  const confirm = useCallback(
    (definition: GeogridDefinition) => {
      void dispatch(submitGeogridScan({ siteId, definition })).then((action) => {
        const payload = action.payload as { scanId?: string } | undefined;
        if (payload?.scanId) {
          setUrlState({ scanId: payload.scanId, cellIndex: null });
          void dispatch(loadGeogridScans({ siteId }));
        }
      });
    },
    [dispatch, setUrlState, siteId],
  );

  const selectedCell =
    urlState.cellIndex === null
      ? null
      : (detail?.cells.find((cell) => cell.pointIndex === urlState.cellIndex) ?? null);

  return (
    <div data-testid="geogrid-panel" className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin aria-hidden="true" className="size-4" />
            {t('title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">{t('description')}</p>
          <GeogridForm
            form={form}
            keywords={keywords}
            errors={errors}
            disabled={submitting}
            previewing={previewStatus === 'loading'}
            onKeywordChange={(value) =>
              dispatch(setGeogridFormField({ field: 'keywordId', value }))
            }
            onCoordinateChange={(field, value) =>
              dispatch(setGeogridFormField({ field, value }))
            }
            onSpacingChange={(value) =>
              dispatch(setGeogridFormField({ field: 'spacingMeters', value }))
            }
            onSizeChange={(value: GeogridSize) =>
              dispatch(setGeogridFormField({ field: 'gridSize', value }))
            }
            onZoomChange={(value) => dispatch(setGeogridFormField({ field: 'zoom', value }))}
            onPreview={runPreview}
          />
          {previewGate ? <GeogridGateNotice gate={previewGate} /> : null}
          {submitGate ? <GeogridGateNotice gate={submitGate} /> : null}
          {preview && previewDefinition ? (
            <Alert data-testid="geogrid-preview-card">
              <AlertTitle>{t('preview.title')}</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <span>{t('preview.body', { units: 1, cells: preview.cellCount })}</span>
                <span className="flex gap-2">
                  <Button
                    type="button"
                    data-testid="geogrid-confirm"
                    loading={submitting}
                    loadingLabel={t('preview.running')}
                    onClick={() => confirm(previewDefinition)}
                  >
                    {t('preview.confirm')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="geogrid-cancel"
                    onClick={() => dispatch(clearGeogridPreview())}
                  >
                    {t('preview.cancel')}
                  </Button>
                </span>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('history.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {scansStatus === 'loading' ? <Skeleton className="h-16 w-full" /> : null}
          {scansGate ? <GeogridGateNotice gate={scansGate} /> : null}
          {scansStatus === 'ready' ? (
            <GeogridScanHistory
              scans={scans}
              selectedScanId={urlState.scanId}
              onSelect={(scanId) => setUrlState({ scanId, cellIndex: null })}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{t('grid.title')}</CardTitle>
            {detail && detail.status !== 'queued' && detail.status !== 'running' ? (
              <ReportExportControl
                kind="local.geogrid_scan"
                target={{ scope: 'site_resource', siteId, resourceId: detail.id }}
                selection={{}}
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {detailStatus === 'loading' ? <Skeleton className="h-40 w-full" /> : null}
          {detailGate ? <GeogridGateNotice gate={detailGate} /> : null}
          {!urlState.scanId && detailStatus !== 'loading' ? (
            <Empty data-testid="geogrid-empty">
              <EmptyHeader>
                <EmptyTitle>{t('grid.emptyTitle')}</EmptyTitle>
                <EmptyDescription>{t('grid.emptyBody')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {detail ? (
            <>
              <GeogridOutcomeBanner scan={detail} />
              {detail.status === 'queued' || detail.status === 'running' ? (
                <p data-testid="geogrid-running" className="text-muted-foreground text-sm">
                  {t('grid.running')}
                </p>
              ) : null}
              <GeogridHeatGrid
                cells={detail.cells}
                gridSize={detail.gridSize}
                totalCells={detail.totalCells}
                selectedIndex={urlState.cellIndex}
                onSelect={(pointIndex) => setUrlState({ cellIndex: pointIndex })}
              />
              {selectedCell ? (
                <p data-testid="geogrid-cell-detail" className="text-sm">
                  {selectedCell.state === 'failed'
                    ? t('detail.failed', {
                        index: selectedCell.pointIndex + 1,
                        lat: String(selectedCell.lat),
                        lng: String(selectedCell.lng),
                      })
                    : selectedCell.state === 'not_in_pack'
                      ? t('detail.notInPack', {
                          index: selectedCell.pointIndex + 1,
                          lat: String(selectedCell.lat),
                          lng: String(selectedCell.lng),
                          capturedAt: selectedCell.capturedAt,
                        })
                      : t('detail.observed', {
                          index: selectedCell.pointIndex + 1,
                          position: selectedCell.position,
                          packSize: selectedCell.totalPackSize,
                          lat: String(selectedCell.lat),
                          lng: String(selectedCell.lng),
                          capturedAt: selectedCell.capturedAt,
                        })}
                </p>
              ) : null}
              <GeogridCellTable cells={detail.cells} />
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};
