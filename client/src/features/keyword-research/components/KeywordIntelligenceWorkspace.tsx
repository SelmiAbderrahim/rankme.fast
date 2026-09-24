/**
 * Keyword-intelligence workspace shell.
 *
 * Mounted ONLY on the standalone `/keyword-research` route. `?tab=` union
 * `research | gap | trends | live-trends | clusters` (default research) per
 * the url-tab-state rule; unknown values normalize to the default without
 * discarding unrelated params. The research tab preserves the shipped
 * research panel unchanged and hosts the URL-addressable SERP overview
 * section. Gap/trends/live-trends/clusters views are lazy-loaded.
 *
 * The `live-trends` tab hosts `LiveTrendsView` verbatim
 * (no fork, no second component): provider/kill-switch and sparse-history
 * honesty stay owned by that view, which already models them.
 */
import { Suspense, lazy, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportExportControl } from '@features/report-export';
import { Skeleton } from '@shared/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { DocsLink } from '@shared/docs/DocsLink';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { selectHistory, selectHistoryLoaded } from '../store/selectors';
import { loadHistory } from '../store/thunks';
import { DEFAULT_WORKSPACE_TAB, WORKSPACE_TABS, useWorkspaceTab } from '../tabState';
import { KeywordResearchPanel } from './KeywordResearchPanel';
import { OverviewSection } from './OverviewSection';

const LazyGapView = lazy(async () => {
  const { GapView } = await import('./GapView');
  return { default: GapView };
});
const LazyTrendsView = lazy(async () => {
  const { TrendsView } = await import('./TrendsView');
  return { default: TrendsView };
});
const LazyLiveTrendsView = lazy(async () => {
  const { LiveTrendsView } = await import('./LiveTrendsView');
  return { default: LiveTrendsView };
});
const LazyClustersView = lazy(async () => {
  const { ClustersView } = await import('./ClustersView');
  return { default: ClustersView };
});

const LazyViewFallback = () => (
  <div aria-busy="true" aria-live="polite" data-testid="kw-workspace-lazy-loading">
    <Skeleton className="h-40 w-full" />
  </div>
);

export const KeywordIntelligenceWorkspace = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const historyLoaded = useAppSelector(selectHistoryLoaded);
  const history = useAppSelector(selectHistory);
  const [activeTab, setActiveTab] = useWorkspaceTab();
  const exportOperation = activeTab === 'research'
    ? ['metrics', 'related', 'intent', 'ideas', 'long_tail']
    : activeTab === 'gap' || activeTab === 'trends'
      ? [activeTab]
      : [];
  const exportResult = history.find((item) => exportOperation.includes(item.kind));

  // Recent research feeds the export control; the read is free and
  // non-reserving.
  useEffect(() => {
    if (!historyLoaded) void dispatch(loadHistory({}));
  }, [dispatch, historyLoaded]);

  return (
    <div
      className="flex flex-col gap-4 px-4 py-8"
      data-testid="keyword-intel-workspace"
    >
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as (typeof WORKSPACE_TABS)[number])}
        defaultValue={DEFAULT_WORKSPACE_TAB}
      >
        <div className="flex w-full flex-wrap items-center justify-between gap-2 pb-1">
          <TabsList
            data-testid="keyword-intel-tabs"
            className="h-auto w-full flex-wrap justify-start sm:w-fit"
          >
            {WORKSPACE_TABS.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                data-testid={`keyword-intel-tab-${tab}`}
                className="whitespace-nowrap"
              >
                {t(`keywordResearch:tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex shrink-0 items-center gap-2">
            {exportResult ? (
              <ReportExportControl
                kind="keyword.research_result"
                target={{ scope: 'account_resource', resourceId: exportResult.id }}
                selection={{ operation: exportResult.kind }}
              />
            ) : null}
            <DocsLink slug="keyword-intelligence" className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2" />
          </div>
        </div>
        <TabsContent
          value="research"
          className="mt-2 flex flex-col gap-6"
          data-testid="keyword-intel-panel-research"
        >
          <KeywordResearchPanel siteId={null} />
          <div className="px-4">
            <OverviewSection />
          </div>
        </TabsContent>
        <TabsContent
          value="gap"
          className="mt-4"
          data-testid="keyword-intel-panel-gap"
        >
          <Suspense fallback={<LazyViewFallback />}>
            <LazyGapView />
          </Suspense>
        </TabsContent>
        <TabsContent
          value="trends"
          className="mt-4"
          data-testid="keyword-intel-panel-trends"
        >
          <Suspense fallback={<LazyViewFallback />}>
            <LazyTrendsView />
          </Suspense>
        </TabsContent>
        {/* Radix mounts only the ACTIVE TabsContent, so the Labs historical-
            volume view and the live search-interest view never coexist: no
            sibling thunk fires when the other tab is selected. */}
        <TabsContent
          value="live-trends"
          className="mt-4 flex flex-col gap-3"
          data-testid="keyword-intel-panel-live-trends"
        >
          <div className="flex justify-end">
            <DocsLink slug="keyword-trends" />
          </div>
          <Suspense fallback={<LazyViewFallback />}>
            <LazyLiveTrendsView />
          </Suspense>
        </TabsContent>
        <TabsContent
          value="clusters"
          className="mt-4"
          data-testid="keyword-intel-panel-clusters"
        >
          <Suspense fallback={<LazyViewFallback />}>
            <LazyClustersView />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
};
