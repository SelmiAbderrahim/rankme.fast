import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportExportControl } from '@features/report-export';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Label } from '@shared/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { Skeleton } from '@shared/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { CandidateTable } from './CandidateTable';
import { NewReportForm } from './NewReportForm';
import { QueryDrillDown } from './QueryDrillDown';
import { ReportListTable } from './ReportListTable';
import { StateNotice } from './StateNotice';
import {
  selectCannibalizationDetail,
  selectCannibalizationDetailGate,
  selectCannibalizationDetailStatus,
  selectCannibalizationGenerateGate,
  selectCannibalizationGenerateStatus,
  selectCannibalizationGscConnected,
  selectCannibalizationListGate,
  selectCannibalizationListStatus,
  selectCannibalizationPreview,
  selectCannibalizationPreviewGate,
  selectCannibalizationPreviewStatus,
  selectCannibalizationReports,
  selectCannibalizationSitesStatus,
} from '../store/selectors';
import {
  generateCannibalizationReportThunk,
  loadCannibalizationReport,
  loadCannibalizationReports,
  loadCannibalizationPrerequisites,
  previewCannibalizationReportThunk,
} from '../store/thunks';
import {
  CANNIBALIZATION_CONFIDENCE_FILTERS,
  CANNIBALIZATION_VIEWS,
  useCannibalizationUrlState,
  type CannibalizationConfidenceFilter,
  type CannibalizationView,
} from '../urlState';

export interface CannibalizationPageProps {
  /** Owning site — supplied by the workspace route, never picked in-panel. */
  siteId: string;
}

/**
 * Cannibalization panel of the site workspace (`?tab=cannibalization`). The
 * site is the workspace's; the only prerequisite this panel loads for itself
 * is the Search Console link the report is computed from.
 */
export const CannibalizationPage = ({ siteId }: CannibalizationPageProps) => {
  const { t } = useTranslation('cannibalization');
  const dispatch = useAppDispatch();
  const url = useCannibalizationUrlState();

  const sitesStatus = useAppSelector(selectCannibalizationSitesStatus);
  const gscConnected = useAppSelector(selectCannibalizationGscConnected);
  const reports = useAppSelector(selectCannibalizationReports);
  const listStatus = useAppSelector(selectCannibalizationListStatus);
  const listGate = useAppSelector(selectCannibalizationListGate);
  const detail = useAppSelector(selectCannibalizationDetail);
  const detailStatus = useAppSelector(selectCannibalizationDetailStatus);
  const detailGate = useAppSelector(selectCannibalizationDetailGate);
  const preview = useAppSelector(selectCannibalizationPreview);
  const previewStatus = useAppSelector(selectCannibalizationPreviewStatus);
  const previewGate = useAppSelector(selectCannibalizationPreviewGate);
  const generateStatus = useAppSelector(selectCannibalizationGenerateStatus);
  const generateGate = useAppSelector(selectCannibalizationGenerateGate);

  useEffect(() => {
    void dispatch(loadCannibalizationPrerequisites(siteId));
  }, [dispatch]);

  useEffect(() => {
    void dispatch(loadCannibalizationReports({ siteId, windowDays: url.window }));
  }, [dispatch, siteId, url.window]);

  useEffect(() => {
    if (url.report === null) return;
    void dispatch(loadCannibalizationReport(url.report));
  }, [dispatch, url.report]);

  const candidates = useMemo(() => {
    const all = detail?.candidates ?? [];
    return url.confidence === 'all'
      ? all
      : all.filter((candidate) => candidate.confidence === url.confidence);
  }, [detail, url.confidence]);

  const activeCandidate =
    candidates.find((candidate) => candidate.id === url.query) ?? null;

  const onGenerate = (site: string) => {
    void dispatch(
      generateCannibalizationReportThunk({ siteId: site, windowDays: url.window }),
    ).then((action) => {
      if (generateCannibalizationReportThunk.fulfilled.match(action)) {
        url.setReport(action.payload.id);
        url.setView('reports');
      }
    });
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        {detail ? (
          <ReportExportControl
            kind="keyword.cannibalization"
            target={{ scope: 'site_resource', siteId, resourceId: detail.id }}
            selection={{ confidence: url.confidence }}
          />
        ) : null}
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="cannibalization-confidence">{t('filters.confidence')}</Label>
          <Select
            value={url.confidence}
            onValueChange={(value) =>
              url.setConfidence(value as CannibalizationConfidenceFilter)
            }
          >
            <SelectTrigger id="cannibalization-confidence" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CANNIBALIZATION_CONFIDENCE_FILTERS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`filters.confidenceValue.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {sitesStatus === 'loading' ? (
        <Skeleton className="h-24 w-full" data-testid="cannibalization-loading" />
      ) : null}

      {/* Every trigger owns a real `TabsContent` panel: a `TabsList` without
          matching panels leaves `aria-controls` dangling (an axe critical). */}
      <Tabs
        value={url.view}
        onValueChange={(value) => url.setView(value as CannibalizationView)}
      >
        <TabsList>
          {CANNIBALIZATION_VIEWS.map((view) => (
            <TabsTrigger
              key={view}
              value={view}
              data-testid={`cannibalization-tab-${view}`}
            >
              {t(`tabs.${view}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="new" className="mt-4">
          {sitesStatus === 'loading' ? (
            <Skeleton className="h-32 w-full" data-testid="cannibalization-new-loading" />
          ) : gscConnected === false ? (
            <StateNotice kind="disconnected" />
          ) : gscConnected === null ? (
            <StateNotice kind="failed" />
          ) : (
            <NewReportForm
              windowDays={url.window}
              onWindowChange={url.setWindow}
              onPreview={() => {
                void dispatch(
                  previewCannibalizationReportThunk({
                    siteId,
                    windowDays: url.window,
                  }),
                );
              }}
              onGenerate={() => onGenerate(siteId)}
              preview={preview}
              previewStatus={previewStatus}
              previewGate={previewGate}
              generateStatus={generateStatus}
              generateGate={generateGate}
            />
          )}
        </TabsContent>

        <TabsContent value="reports" className="mt-4 flex flex-col gap-4">
          {listStatus === 'loading' ? (
            <Skeleton className="h-32 w-full" data-testid="cannibalization-list-loading" />
          ) : null}
          {listGate ? (
            <StateNotice kind={listGate.kind} message={listGate.message} />
          ) : null}
          {listStatus === 'succeeded' && reports.length === 0 ? (
            <StateNotice kind="empty" />
          ) : null}
          {reports.length > 0 ? (
            <ReportListTable
              reports={reports}
              activeReportId={url.report}
              onOpen={(reportId) => {
                url.setReport(reportId);
                url.setQuery(null);
              }}
            />
          ) : null}
          {detailStatus === 'loading' ? (
            <Skeleton className="h-32 w-full" data-testid="cannibalization-detail-loading" />
          ) : null}
          {detailGate ? (
            <StateNotice kind={detailGate.kind} message={detailGate.message} />
          ) : null}
          {detail ? (
            <div className="flex flex-col gap-4">
              <p className="text-muted-foreground text-sm" data-testid="cannibalization-provenance">
                {t('detail.provenance', {
                  days: detail.windowDays,
                  date: detail.snapshotDate,
                  queries: detail.queriesAnalyzed,
                })}
              </p>
              {candidates.length === 0 ? (
                <StateNotice kind="empty" />
              ) : (
                <CandidateTable
                  candidates={candidates}
                  activeCandidateId={url.query}
                  onOpen={(candidateId) => url.setQuery(candidateId)}
                />
              )}
              {activeCandidate ? <QueryDrillDown candidate={activeCandidate} /> : null}
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </main>
  );
};
