import { LoaderCircle, Network } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ReportExportControl } from '@features/report-export';
import { isSupportedLocale } from '@shared/i18n';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Label } from '@shared/ui/label';
import { Checkbox } from '@shared/ui/checkbox';
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
  fetchKeywordClusterRun,
  fetchKeywordClusterRuns,
  fetchKeywordClusterKeywords,
  previewKeywordClusterRun,
  startKeywordClusterRun,
} from '../api';
import { keywordClusterGate } from '../gate';
import type {
  KeywordClusterPreview,
  KeywordClusterRunDetail,
  KeywordClusterRunSummary,
  KeywordClusterSelectableKeyword,
  KeywordClusterUiState,
} from '../types';
import {
  KEYWORD_CLUSTER_SIZE_FILTERS,
  KEYWORD_CLUSTER_VIEWS,
  useKeywordClusterUrlState,
  type KeywordClusterSizeFilter,
  type KeywordClusterView,
} from '../urlState';
import { BlockedKeywords } from './BlockedKeywords';
import { ClusterList } from './ClusterList';
import { NewRunPanel } from './NewRunPanel';
import { RunList } from './RunList';
import { StateNotice } from './StateNotice';

const POLL_INTERVAL_MS = 1_500;

export const ranksSurfaceHref = (siteId: string): string =>
  `/sites/${siteId}?tab=keywords`;

export const keywordClusterLocale = (value: unknown) =>
  isSupportedLocale(value) ? value : 'en';

export interface KeywordClustersPageProps {
  /** Owning site — supplied by the workspace route, never picked in-panel. */
  siteId: string;
}

export const KeywordClustersPage = ({ siteId }: KeywordClustersPageProps) => {
  const { t, i18n } = useTranslation('keywordClusters');
  const url = useKeywordClusterUrlState();
  const [runs, setRuns] = useState<KeywordClusterRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsGate, setRunsGate] = useState<KeywordClusterUiState | null>(null);
  const [detail, setDetail] = useState<KeywordClusterRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailGate, setDetailGate] = useState<KeywordClusterUiState | null>(null);
  const [preview, setPreview] = useState<KeywordClusterPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [actionGate, setActionGate] = useState<KeywordClusterUiState | null>(null);
  const [keywords, setKeywords] = useState<KeywordClusterSelectableKeyword[]>([]);
  const [selectedKeywordIds, setSelectedKeywordIds] = useState<string[]>([]);
  const [keywordsLoading, setKeywordsLoading] = useState(false);

  const loadRuns = useCallback(async (selectedSiteId: string, signal?: AbortSignal) => {
    const response = await fetchKeywordClusterRuns(selectedSiteId, signal);
    setRuns(response.items);
    setRunsGate(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setRunsLoading(true);
    void loadRuns(siteId, controller.signal)
      .catch((error: unknown) => {
        if (active) setRunsGate(keywordClusterGate(error));
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
    const controller = new AbortController();
    let active = true;
    setKeywordsLoading(true);
    void fetchKeywordClusterKeywords(siteId, controller.signal)
      .then((items) => {
        if (!active) return;
        setKeywords(items);
        setSelectedKeywordIds(items.map((item) => item.id));
      })
      .catch((error: unknown) => {
        if (active) setActionGate(keywordClusterGate(error));
      })
      .finally(() => {
        if (active) setKeywordsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [siteId]);

  useEffect(() => {
    if (url.runId === null) {
      setDetail(null);
      setDetailGate(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setDetailLoading(true);
    void fetchKeywordClusterRun(url.runId, controller.signal)
      .then((run) => {
        if (!active) return;
        setDetail(run);
        setDetailGate(null);
      })
      .catch((error: unknown) => {
        if (active) setDetailGate(keywordClusterGate(error));
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
        void fetchKeywordClusterRun(pollingRunId)
          .then((run) => {
            if (!active) return;
            setDetail(run);
            setRuns((current) =>
              current.map((item) => (item.id === run.id ? run : item)),
            );
            if (run.status === 'queued' || run.status === 'processing') poll();
          })
          .catch((error: unknown) => {
            if (active) setDetailGate(keywordClusterGate(error));
          });
      }, POLL_INTERVAL_MS);
    };
    poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [pollingRunId, pollingStatus]);

  const filteredClusters = useMemo(() => {
    const clusters = detail?.clusters ?? [];
    if (url.size === 'grouped') return clusters.filter((cluster) => cluster.size > 1);
    if (url.size === 'singleton') return clusters.filter((cluster) => cluster.size === 1);
    return clusters;
  }, [detail, url.size]);

  const onPreview = async (selectedSiteId: string) => {
    setPreviewing(true);
    setActionGate(null);
    try {
      setPreview(await previewKeywordClusterRun(selectedSiteId, selectedKeywordIds));
    } catch (error) {
      setActionGate(keywordClusterGate(error));
    } finally {
      setPreviewing(false);
    }
  };

  const onStart = async (selectedSiteId: string) => {
    setStarting(true);
    setActionGate(null);
    const language = i18n.resolvedLanguage;
    try {
      const run = await startKeywordClusterRun(
        selectedSiteId,
        keywordClusterLocale(language),
        selectedKeywordIds,
      );
      setDetail(run);
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setPreview(null);
      url.setRunId(run.id);
      url.setView('runs');
    } catch (error) {
      setActionGate(keywordClusterGate(error));
    } finally {
      setStarting(false);
    }
  };

  const ranksHref = ranksSurfaceHref(siteId);
  const running = detail?.status === 'queued' || detail?.status === 'processing';

  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6"
      data-testid="keyword-clusters-page"
    >
      <header className="space-y-2">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Network className="size-4" aria-hidden="true" />
          <span>{t('eyebrow')}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">{t('subtitle')}</p>
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link to={ranksHref}>{t('site.ranksLink')}</Link>
        </Button>
      </div>

      <Tabs
        value={url.view}
        dir={i18n.dir()}
        onValueChange={(value) => url.setView(value as KeywordClusterView)}
      >
        <TabsList>
          {KEYWORD_CLUSTER_VIEWS.map((view) => (
            <TabsTrigger
              key={view}
              value={view}
              data-testid={`keyword-clusters-tab-${view}`}
            >
              {t(`tabs.${view}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="new" className="mt-4">
            <section
              className="mb-4 space-y-3 border border-border bg-card p-4"
              aria-labelledby="keyword-clusters-scope-title"
              data-testid="keyword-clusters-scope"
            >
              <div>
                <h2 id="keyword-clusters-scope-title" className="font-medium">
                  {t('scope.title')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('scope.description', { count: selectedKeywordIds.length })}
                </p>
              </div>
              {keywordsLoading ? <Skeleton className="h-10 w-full" /> : null}
              {!keywordsLoading && keywords.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('scope.empty')}</p>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {keywords.map((keyword) => {
                  const checked = selectedKeywordIds.includes(keyword.id);
                  return (
                    <label
                      key={keyword.id}
                      className="flex cursor-pointer items-center gap-2 border border-border px-3 py-2 text-sm"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) => {
                          setPreview(null);
                          setSelectedKeywordIds((current) => next
                            ? [...current, keyword.id]
                            : current.filter((id) => id !== keyword.id));
                        }}
                        aria-label={keyword.phrase}
                      />
                      <span>{keyword.phrase}</span>
                    </label>
                  );
                })}
              </div>
              {!keywordsLoading && selectedKeywordIds.length < 2 ? (
                <p className="text-sm text-destructive" role="alert">
                  {t('scope.minimum')}
                </p>
              ) : null}
            </section>
          <NewRunPanel
            ranksHref={ranksHref}
            preview={preview}
            previewing={previewing}
            starting={starting}
            gate={actionGate}
            canPreview={!keywordsLoading && selectedKeywordIds.length >= 2}
            onPreview={() => void onPreview(siteId)}
            onCancel={() => {
              setPreview(null);
              setActionGate(null);
            }}
            onConfirm={() => void onStart(siteId)}
          />
        </TabsContent>

        <TabsContent value="runs" className="mt-4 space-y-5">
          {runsLoading ? (
            <Skeleton className="h-32 w-full" data-testid="keyword-clusters-runs-loading" />
          ) : null}
          {runsGate ? <StateNotice kind={runsGate} /> : null}
          {!runsLoading && !runsGate && runs.length === 0 ? (
            <StateNotice kind="emptyRuns" />
          ) : null}
          {runs.length > 0 ? (
            <RunList runs={runs} activeRunId={url.runId} onOpen={url.setRunId} />
          ) : null}

          {detailLoading ? (
            <Skeleton
              className="h-40 w-full"
              data-testid="keyword-clusters-detail-loading"
            />
          ) : null}
          {detailGate ? <StateNotice kind={detailGate} /> : null}
          {running ? (
            <Alert data-testid="keyword-clusters-running" role="status">
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              <AlertTitle>{t('states.running.title')}</AlertTitle>
              <AlertDescription>{t('states.running.body')}</AlertDescription>
            </Alert>
          ) : null}
          {detail?.status === 'failed' ? <StateNotice kind="failed" /> : null}
          {detail?.status === 'completed' ? (
            <section className="space-y-4" aria-labelledby="keyword-clusters-results-title">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h2
                    id="keyword-clusters-results-title"
                    className="text-xl font-semibold"
                  >
                    {t('results.title')}
                  </h2>
                  <p
                    className="text-muted-foreground text-sm"
                    data-testid="keyword-clusters-method"
                  >
                    {t('results.method', {
                      shared: detail.minSharedUrls,
                      window: detail.topUrlWindow,
                    })}
                  </p>
                </div>
                <ReportExportControl
                  kind="keyword.serp_cluster_run"
                  target={{ scope: 'site_resource', siteId, resourceId: detail.id }}
                  selection={{}}
                />
              </div>

              {detail.aiStatus === 'output_rejected' ||
              detail.aiStatus === 'provider_failed' ? (
                <Alert data-testid="keyword-clusters-unlabeled">
                  <AlertDescription>{t('results.unlabeled')}</AlertDescription>
                </Alert>
              ) : null}

              <BlockedKeywords
                blocked={detail.blocked}
                total={detail.blockedCount}
                ranksHref={ranksHref}
              />

              {detail.clusters.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="keyword-clusters-size-filter">
                      {t('filters.size')}
                    </Label>
                    <Select
                      dir={i18n.dir()}
                      value={url.size}
                      onValueChange={(value) =>
                        url.setSize(value as KeywordClusterSizeFilter)
                      }
                    >
                      <SelectTrigger id="keyword-clusters-size-filter">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {KEYWORD_CLUSTER_SIZE_FILTERS.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`filters.sizeValue.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}

              {filteredClusters.length === 0 ? (
                <StateNotice kind="emptyClusters" />
              ) : (
                <ClusterList
                  clusters={filteredClusters}
                  openClusterId={url.clusterId}
                  onToggle={url.setClusterId}
                />
              )}
            </section>
          ) : null}
        </TabsContent>
      </Tabs>
    </main>
  );
};
