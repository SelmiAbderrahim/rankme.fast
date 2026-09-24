import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { useAppSelector } from '@shared/hooks/redux';
import { fetchPagesList } from '@features/pages';
import { fetchTrackedKeywords } from '@features/ranks';
import { CONTENT_SUB_VIEWS, useContentView } from '../tabState';
import { selectAnalyses } from '../store/selectors';
import { AnalysisDetail } from './AnalysisDetail';
import { AnalysisList } from './AnalysisList';
import { NewAnalysisForm } from './NewAnalysisForm';
import { InventoryPanel } from './inventory/InventoryPanel';
import { CompetitorContentPanel } from './competitor-content/CompetitorContentPanel';
import { MonitoringPanel } from './monitoring/MonitoringPanel';
import { ContentBriefsPanel } from '@features/content-briefs';
import { readContentAnalysisDeepLink } from '../deepLinkState';

interface ContentIntelligencePanelProps {
  siteId: string;
  siteOrigin?: string | undefined;
}

const ANALYSIS_PARAM = 'analysis';
export function ContentIntelligencePanel({ siteId, siteOrigin }: ContentIntelligencePanelProps) {
  const { t } = useTranslation('contentIntelligence');
  const [view, setView] = useContentView();
  const [params, setParams] = useSearchParams();
  const deepLink = useMemo(
    () => readContentAnalysisDeepLink(params, siteOrigin),
    [params, siteOrigin],
  );
  const analysisId = deepLink.analysisId;

  useEffect(() => {
    const current = params.toString();
    const canonical = deepLink.canonicalParams.toString();
    if (canonical !== current) setParams(deepLink.canonicalParams, { replace: true });
  }, [deepLink, params, setParams]);

  const analyses = useAppSelector(selectAnalyses);
  const [suggestedPages, setSuggestedPages] = useState<string[]>([]);
  const [trackedKeywords, setTrackedKeywords] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [suggestionsError, setSuggestionsError] = useState(false);
  const [suggestionsAttempt, setSuggestionsAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setSuggestedPages([]);
    setTrackedKeywords([]);
    setSuggestionsLoading(true);
    setSuggestionsError(false);
    void Promise.allSettled([
      fetchPagesList(
        siteId,
        {
          range: '28d',
          q: '',
          insight: null,
          indexability: null,
          visibility: null,
          sort: 'opportunity',
          direction: 'desc',
          cursor: null,
          limit: 100,
        },
        controller.signal,
      ),
      fetchTrackedKeywords(siteId, null, { signal: controller.signal }),
    ]).then(([pagesResult, keywordsResult]) => {
      if (controller.signal.aborted) return;
      setSuggestedPages(
        pagesResult.status === 'fulfilled'
          ? pagesResult.value.items.map((page) => page.url)
          : [],
      );
      setTrackedKeywords(
        keywordsResult.status === 'fulfilled'
          ? keywordsResult.value.keywords.map((keyword) => keyword.phrase)
          : [],
      );
      setSuggestionsError(
        pagesResult.status === 'rejected' || keywordsResult.status === 'rejected',
      );
      setSuggestionsLoading(false);
    });
    return () => controller.abort();
  }, [siteId, suggestionsAttempt]);

  const knownPages = useMemo(
    () => Array.from(new Set([
      ...(siteOrigin ? [siteOrigin] : []),
      ...suggestedPages,
      ...analyses
        .filter((analysis) => analysis.siteId === siteId)
        .map((analysis) => analysis.ownedUrl),
    ])),
    [analyses, siteId, siteOrigin, suggestedPages],
  );
  const suggestedKeywords = useMemo(
    () => Array.from(new Set([
      ...trackedKeywords,
      ...analyses
        .filter((analysis) => analysis.siteId === siteId)
        .map((analysis) => analysis.keyword),
    ])),
    [analyses, siteId, trackedKeywords],
  );

  // Deep-link prefill is canonicalized before it reaches a rendered input.
  // The user still confirms the draft; nothing is auto-created.
  const prefill = deepLink.prefill;

  const onOpen = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      next.set(ANALYSIS_PARAM, id);
      setParams(next);
    },
    [params, setParams],
  );

  const onBack = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete(ANALYSIS_PARAM);
    setParams(next, { replace: true });
  }, [params, setParams]);

  const onSubmitted = useCallback(
    (id: string) => {
      onOpen(id);
    },
    [onOpen],
  );

  const onNew = useCallback(() => {
    const el = document.querySelector<HTMLInputElement>(
      '[data-testid="content-form-url"]',
    );
    el?.focus();
  }, []);

  // Analysis detail view (via ?analysis=)
  if (analysisId) {
    return (
      <div className="flex flex-col gap-4" data-testid="content-intelligence-panel">
        <AnalysisDetail
          siteId={siteId}
          analysisId={analysisId}
          onBack={onBack}
          onRegenerated={onOpen}
        />
      </div>
    );
  }

  const viewContent = view === 'inventory' ? (
    <InventoryPanel siteId={siteId} />
  ) : view === 'competitors' ? (
    <CompetitorContentPanel siteId={siteId} />
  ) : view === 'monitoring' ? (
    <MonitoringPanel siteId={siteId} />
  ) : view === 'briefs' ? (
    <ContentBriefsPanel siteId={siteId} />
  ) : (
    <>
      <NewAnalysisForm
        siteId={siteId}
        siteOrigin={siteOrigin}
        knownPages={knownPages}
        suggestedKeywords={suggestedKeywords}
        onSubmitted={onSubmitted}
        prefill={prefill}
      />
      {suggestionsLoading ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t('suggestions.loading')}
        </p>
      ) : suggestionsError ? (
        <Alert>
          <AlertTitle>{t('suggestions.error')}</AlertTitle>
          <AlertDescription>
            <Button
              className="mt-2"
              size="sm"
              variant="outline"
              onClick={() => setSuggestionsAttempt((attempt) => attempt + 1)}
            >
              {t('suggestions.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <AnalysisList siteId={siteId} onOpen={onOpen} onNew={onNew} />
    </>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="content-intelligence-panel">
      <Tabs
        className="gap-4"
        value={view}
        onValueChange={(value) => setView(value as typeof view)}
      >
        <Card data-testid="content-view-nav">
          <CardHeader>
            <CardTitle>{t('list.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TabsList className="h-auto max-w-full flex-wrap justify-start">
              {CONTENT_SUB_VIEWS.map((v) => (
                <TabsTrigger
                  key={v}
                  value={v}
                  data-testid={`content-view-${v}`}
                >
                  {t(`views.${v}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </CardContent>
        </Card>
        {CONTENT_SUB_VIEWS.map((tabView) => (
          <TabsContent
            className={tabView === view ? undefined : 'hidden'}
            forceMount
            key={tabView}
            value={tabView}
          >
            {tabView === view ? viewContent : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
