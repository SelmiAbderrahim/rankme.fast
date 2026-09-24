import { LoaderCircle, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ReportExportControl } from '@features/report-export';
import { isSupportedLocale } from '@shared/i18n';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
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
import {
  fetchInternalLinkRun,
  fetchInternalLinkRuns,
  previewInternalLinkRun,
  startInternalLinkRun,
} from '../api';
import { internalLinkGate } from '../gate';
import type {
  InternalLinkPreview,
  InternalLinkRunDetail,
  InternalLinkRunSummary,
  InternalLinkUiState,
} from '../types';
import {
  INTERNAL_LINK_CONFIDENCE_FILTERS,
  INTERNAL_LINK_TARGET_FILTERS,
  INTERNAL_LINK_VIEWS,
  useInternalLinkUrlState,
  type InternalLinkConfidenceFilter,
  type InternalLinkTargetFilter,
  type InternalLinkView,
} from '../urlState';
import { NewRunPanel } from './NewRunPanel';
import { RunList } from './RunList';
import { StateNotice } from './StateNotice';
import { SuggestionList } from './SuggestionList';

const POLL_INTERVAL_MS = 1_500;

export const inventorySurfaceHref = (siteId: string): string =>
  `/sites/${siteId}?tab=content&view=inventory`;

export const internalLinkLocale = (value: unknown) =>
  isSupportedLocale(value) ? value : 'en';

export interface InternalLinksPageProps {
  /** Owning site — supplied by the workspace route, never picked in-panel. */
  siteId: string;
}

export const InternalLinksPage = ({ siteId }: InternalLinksPageProps) => {
  const { t, i18n } = useTranslation('internalLinks');
  const url = useInternalLinkUrlState();
  const [runs, setRuns] = useState<InternalLinkRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsGate, setRunsGate] = useState<InternalLinkUiState | null>(null);
  const [detail, setDetail] = useState<InternalLinkRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailGate, setDetailGate] = useState<InternalLinkUiState | null>(null);
  const [preview, setPreview] = useState<InternalLinkPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [actionGate, setActionGate] = useState<InternalLinkUiState | null>(null);

  const loadRuns = useCallback(async (selectedSiteId: string, signal?: AbortSignal) => {
    const response = await fetchInternalLinkRuns(selectedSiteId, signal);
    setRuns(response.items);
    setRunsGate(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setRunsLoading(true);
    void loadRuns(siteId, controller.signal)
      .catch((error: unknown) => {
        if (active) setRunsGate(internalLinkGate(error));
      })
      .finally(() => {
        if (active) setRunsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [loadRuns, siteId]);

  useEffect(() => {
    if (url.runId === null) {
      setDetail(null);
      setDetailGate(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setDetailLoading(true);
    void fetchInternalLinkRun(url.runId, controller.signal)
      .then((run) => {
        if (!active) return;
        setDetail(run);
        setDetailGate(null);
      })
      .catch((error: unknown) => {
        if (active) setDetailGate(internalLinkGate(error));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [url.runId]);

  const pollingRunId = detail?.id;
  const pollingStatus = detail?.status;
  useEffect(() => {
    if (
      !pollingRunId ||
      (pollingStatus !== 'queued' && pollingStatus !== 'processing')
    ) {
      return;
    }
    let active = true;
    let timer = 0;
    const poll = () => {
      timer = window.setTimeout(() => {
        void fetchInternalLinkRun(pollingRunId)
          .then((run) => {
            if (!active) return;
            setDetail(run);
            setRuns((current) =>
              current.map((item) => (item.id === run.id ? run : item)),
            );
            if (run.status === 'queued' || run.status === 'processing') poll();
          })
          .catch((error: unknown) => {
            if (active) setDetailGate(internalLinkGate(error));
          });
      }, POLL_INTERVAL_MS);
    };
    poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [pollingRunId, pollingStatus]);

  const sourceSections = useMemo(() => {
    const values = new Set(detail?.suggestions.map((item) => item.sourceSection) ?? []);
    if (url.section !== 'all') values.add(url.section);
    return [...values].sort();
  }, [detail, url.section]);

  const filteredSuggestions = useMemo(() => {
    const suggestions = detail?.suggestions ?? [];
    return suggestions.filter(
      (suggestion) =>
        (url.target === 'all' || suggestion.targetFlag === url.target) &&
        (url.section === 'all' || suggestion.sourceSection === url.section) &&
        (url.confidence === 'all' || suggestion.confidence === url.confidence),
    );
  }, [detail, url.confidence, url.section, url.target]);

  const onPreview = async (selectedSiteId: string) => {
    setPreviewing(true);
    setActionGate(null);
    try {
      setPreview(await previewInternalLinkRun(selectedSiteId));
    } catch (error) {
      setActionGate(internalLinkGate(error));
    } finally {
      setPreviewing(false);
    }
  };

  const onStart = async (selectedSiteId: string) => {
    setStarting(true);
    setActionGate(null);
    const language = i18n.resolvedLanguage;
    try {
      const run = await startInternalLinkRun(
        selectedSiteId,
        internalLinkLocale(language),
      );
      setDetail(run);
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setPreview(null);
      url.setRunId(run.id);
      url.setView('runs');
    } catch (error) {
      setActionGate(internalLinkGate(error));
    } finally {
      setStarting(false);
    }
  };

  const inventoryHref = inventorySurfaceHref(siteId);
  const running = detail?.status === 'queued' || detail?.status === 'processing';

  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6"
      data-testid="internal-links-page"
    >
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="size-4" aria-hidden="true" />
          <span>{t('eyebrow')}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link to={inventoryHref}>{t('site.inventoryLink')}</Link>
        </Button>
      </div>

      <Tabs
        value={url.view}
        dir={i18n.dir()}
        onValueChange={(value) => url.setView(value as InternalLinkView)}
      >
        <TabsList>
          {INTERNAL_LINK_VIEWS.map((view) => (
            <TabsTrigger key={view} value={view} data-testid={`internal-links-tab-${view}`}>
              {t(`tabs.${view}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="new" className="mt-4">
          <NewRunPanel
            inventoryHref={inventoryHref}
            preview={preview}
            previewing={previewing}
            starting={starting}
            gate={actionGate}
            onPreview={() => void onPreview(siteId)}
            onCancel={() => {
              setPreview(null);
              setActionGate(null);
            }}
            onConfirm={() => void onStart(siteId)}
          />
        </TabsContent>

        <TabsContent value="runs" className="mt-4 space-y-5">
          {runsLoading ? <Skeleton className="h-32 w-full" data-testid="internal-links-runs-loading" /> : null}
          {runsGate ? <StateNotice kind={runsGate} /> : null}
          {!runsLoading && !runsGate && runs.length === 0 ? (
            <StateNotice kind="emptyRuns" />
          ) : null}
          {runs.length > 0 ? (
            <RunList runs={runs} activeRunId={url.runId} onOpen={url.setRunId} />
          ) : null}

          {detailLoading ? <Skeleton className="h-40 w-full" data-testid="internal-links-detail-loading" /> : null}
          {detailGate ? <StateNotice kind={detailGate} /> : null}
          {running ? (
            <Alert data-testid="internal-links-running" role="status">
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              <AlertTitle>{t('states.running.title')}</AlertTitle>
              <AlertDescription>{t('states.running.body')}</AlertDescription>
            </Alert>
          ) : null}
          {detail?.status === 'failed' ? <StateNotice kind="failed" /> : null}
          {detail?.status === 'completed' ? (
            <section className="space-y-4" aria-labelledby="internal-links-results-title">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 id="internal-links-results-title" className="text-xl font-semibold">
                    {t('suggestions.title')}
                  </h2>
                  <p className="text-muted-foreground text-sm" data-testid="internal-links-inventory-date">
                    {t('suggestions.inventorySnapshot', { date: detail.inventoryDate })}
                  </p>
                </div>
                <ReportExportControl
                  kind="internal_links.run"
                  target={{ scope: 'site_resource', siteId, resourceId: detail.id }}
                  selection={{
                    ...(url.target !== 'all' ? { targetFlag: [url.target] } : {}),
                    ...(url.confidence !== 'all' ? { confidence: [url.confidence] } : {}),
                  }}
                />
              </div>

              {detail.aiStatus === 'output_rejected' || detail.aiStatus === 'provider_failed' ? (
                <Alert data-testid="internal-links-fallback">
                  <AlertDescription>{t('suggestions.fallback')}</AlertDescription>
                </Alert>
              ) : null}

              {detail.suggestions.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="internal-links-target-filter">{t('filters.target')}</Label>
                    <Select
                      dir={i18n.dir()}
                      value={url.target}
                      onValueChange={(value) => url.setTarget(value as InternalLinkTargetFilter)}
                    >
                      <SelectTrigger id="internal-links-target-filter"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {INTERNAL_LINK_TARGET_FILTERS.map((value) => (
                          <SelectItem key={value} value={value}>{t(`filters.targetValue.${value}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="internal-links-section-filter">{t('filters.section')}</Label>
                    <Select
                      dir={i18n.dir()}
                      value={url.section}
                      onValueChange={url.setSection}
                    >
                      <SelectTrigger id="internal-links-section-filter"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('filters.allSections')}</SelectItem>
                        {sourceSections.map((section) => (
                          <SelectItem key={section} value={section}>{section}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="internal-links-confidence-filter">{t('filters.confidence')}</Label>
                    <Select
                      dir={i18n.dir()}
                      value={url.confidence}
                      onValueChange={(value) =>
                        url.setConfidence(value as InternalLinkConfidenceFilter)
                      }
                    >
                      <SelectTrigger id="internal-links-confidence-filter"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {INTERNAL_LINK_CONFIDENCE_FILTERS.map((value) => (
                          <SelectItem key={value} value={value}>{t(`filters.confidenceValue.${value}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}

              {detail.suggestions.length === 0 || filteredSuggestions.length === 0 ? (
                <StateNotice kind="emptySuggestions" />
              ) : (
                <SuggestionList suggestions={filteredSuggestions} />
              )}
            </section>
          ) : null}
        </TabsContent>
      </Tabs>
    </main>
  );
};
