/**
 * Site workspace — one page at `/sites/:siteId`, tab state in `?tab=`.
 *
 * data-testid contract:
 *   - site-workspace                       root
 *   - site-navigation                      grouped workspace navigation
 *   - site-nav-group-<group>               desktop group triggers
 *   - site-tab-<tab>                       desktop menu destinations
 *   - site-nav-mobile                      narrow-screen selector
 *   - site-tab-panel-<tab>                 per-tab panel wrappers
 *   - overview-panel                       overview surface
 */
import { Suspense, lazy, useEffect, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Pause, Play } from 'lucide-react';
import { PageHeader } from '@shared/components/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { formatRelativeTime } from '@shared/lib/datetime';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { rootReducer } from '@app/store';
import { loadBacklinksPage, backlinksReducer } from '@features/backlinks';
import { useLegacyCompetitorContentRedirect } from '@features/competitors';
import { loadReportPage, reportReducer } from '@features/report';
import { KeywordsPanel, SerpFeaturesPanel } from '@features/ranks';
import {
  GoogleAnalyticsSummaryCard,
  GoogleConnectionCard,
  GoogleSearchDetailPanel,
  GoogleSearchSummaryCard,
} from '@features/google';
import { Skeleton } from '@shared/ui/skeleton';
import {
  getSiteTabLabelKey,
  useSiteSubView,
  useSiteTab,
  type SiteTab,
} from '../tabState';
import { loadSites, resumeSite } from '../store/thunks';
import { selectPausingSiteId, selectSites, selectSitesLoaded } from '../store/selectors';
import { OverviewPanel } from './OverviewPanel';
import { SiteWorkspaceNavigation } from './SiteWorkspaceNavigation';

const LazyActionsPanel = lazy(async () => {
  const [{ ActionsPanel, actionsReducer }, { rootReducer }] = await Promise.all([
    import('@features/actions'),
    import('@app/store'),
  ]);
  rootReducer.inject({ reducerPath: 'actions', reducer: actionsReducer });
  return { default: ActionsPanel };
});

const LazyPagesPanel = lazy(async () => {
  const [{ PagesPanel, pagesReducer }, { rootReducer }] = await Promise.all([
    import('@features/pages'),
    import('@app/store'),
  ]);
  rootReducer.inject({ reducerPath: 'pages', reducer: pagesReducer });
  return { default: PagesPanel };
});

const LazyReportPage = lazy(async () => {
  const { ReportPage } = await loadReportPage();
  rootReducer.inject({ reducerPath: 'report', reducer: reportReducer });
  return { default: ReportPage };
});

const LazyClientReportsPanel = lazy(async () => {
  const { ClientReportsPanel } = await import('@features/client-reports');
  return { default: ClientReportsPanel };
});

const LazyKeywordResearchPage = lazy(async () => {
  const [{ KeywordResearchPage, keywordResearchReducer }, { rootReducer }] = await Promise.all([
    import('@features/keyword-research'),
    import('@app/store'),
  ]);
  rootReducer.inject({
    reducerPath: 'keywordResearch',
    reducer: keywordResearchReducer,
  });
  return { default: KeywordResearchPage };
});

const LazyBacklinksPage = lazy(async () => {
  const { BacklinksPage } = await loadBacklinksPage();
  rootReducer.inject({ reducerPath: 'backlinks', reducer: backlinksReducer });
  return { default: BacklinksPage };
});

const LazyCompetitorsPage = lazy(async () => {
  const [{ CompetitorsPage, competitorsReducer }, { rootReducer }] = await Promise.all([
    import('@features/competitors'),
    import('@app/store'),
  ]);
  rootReducer.inject({ reducerPath: 'competitors', reducer: competitorsReducer });
  return { default: CompetitorsPage };
});

const LazyTrafficInsightsPanel = lazy(async () => {
  const { TrafficInsightsPanel } = await import('@features/competitors/traffic');
  return { default: TrafficInsightsPanel };
});

const LazyAiVisibilityPage = lazy(async () => {
  const [{ AiVisibilityPage, aiVisibilityReducer }, { rootReducer }] = await Promise.all([
    import('@features/ai-visibility'),
    import('@app/store'),
  ]);
  rootReducer.inject({ reducerPath: 'aiVisibility', reducer: aiVisibilityReducer });
  return { default: AiVisibilityPage };
});

const LazyLocalSeoPage = lazy(async () => {
  const [{ LocalSeoPage, localSeoReducer }, { rootReducer }] = await Promise.all([
    import('@features/local-seo'),
    import('@app/store'),
  ]);
  rootReducer.inject({ reducerPath: 'localSeo', reducer: localSeoReducer });
  return { default: LocalSeoPage };
});

// Review Intelligence lives INSIDE the local-seo feature; it just
// gets its own workspace tab so `?tab=reviews` is a first-class URL.
const LazyReviewsPanel = lazy(async () => {
  const [{ ReviewsPanel, localSeoReviewsReducer }, { rootReducer }] = await Promise.all([
    import('@features/local-seo'),
    import('@app/store'),
  ]);
  rootReducer.inject({ reducerPath: 'localSeoReviews', reducer: localSeoReviewsReducer });
  return { default: ReviewsPanel };
});

// Geogrid local rank tracking — another
// local-seo sub-surface with a first-class `?tab=geogrid` URL.
const LazyGeogridPanel = lazy(async () => {
  const [{ GeogridPanel, geogridReducer }, { rootReducer }] = await Promise.all([
    import('@features/local-seo'),
    import('@app/store'),
  ]);
  rootReducer.inject({ reducerPath: 'geogrid', reducer: geogridReducer });
  return { default: GeogridPanel };
});

const LazyContentIntelligencePage = lazy(async () => {
  const [{ ContentIntelligencePage, contentIntelligenceReducer }, { rootReducer }] =
    await Promise.all([import('@features/content-intelligence'), import('@app/store')]);
  rootReducer.inject({
    reducerPath: 'contentIntelligence',
    reducer: contentIntelligenceReducer,
  });
  return { default: ContentIntelligencePage };
});

const LazyAudienceResearchPage = lazy(async () => {
  const [{ AudienceResearchPanel, audienceResearchReducer }, { rootReducer }] = await Promise.all([
    import('@features/audience-research'),
    import('@app/store'),
  ]);
  rootReducer.inject({
    reducerPath: 'audienceResearch',
    reducer: audienceResearchReducer,
  });
  return { default: AudienceResearchPanel };
});

// Weekly Pulse card lives at the top of the AI Visibility tab,
// and the GSC generative appearance card sits at the top of the Google tab.
// Both lazy-inject the shared `weeklyPulse` reducer via `combineSlices.inject`
// (idempotent by reducerPath).
const LazyWeeklyPulseCard = lazy(async () => {
  const [{ WeeklyPulseCard, weeklyPulseReducer }, { rootReducer }] = await Promise.all([
    import('@features/weekly-pulse'),
    import('@app/store'),
  ]);
  rootReducer.inject({ reducerPath: 'weeklyPulse', reducer: weeklyPulseReducer });
  return { default: WeeklyPulseCard };
});

const LazyGscGenerativeAppearanceCard = lazy(async () => {
  const [{ GscGenerativeAppearanceCard, weeklyPulseReducer }, { rootReducer }] = await Promise.all([
    import('@features/weekly-pulse'),
    import('@app/store'),
  ]);
  rootReducer.inject({ reducerPath: 'weeklyPulse', reducer: weeklyPulseReducer });
  return { default: GscGenerativeAppearanceCard };
});

// Schema markup generator. Lazy-injects its own
// `schemaGenerator` reducer through `combineSlices.inject` (idempotent by
// reducerPath), exactly like the panels above.
// Site-scoped tools relocated from top-level routes.
// Brand Radar and Cannibalization own Redux slices and inject them here;
// Keyword Clusters and Internal Links are stateless lazy imports.
const LazyBrandRadarPanel = lazy(async () => {
  const [{ BrandRadarPage, brandRadarReducer }, { rootReducer }] = await Promise.all([
    import('@features/brand-radar'),
    import('@app/store'),
  ]);
  rootReducer.inject({ reducerPath: 'brandRadar', reducer: brandRadarReducer });
  return { default: BrandRadarPage };
});

const LazyAppsPanel = lazy(async () => {
  const [{ AppsPanel, appSeoChartsReducer, appSeoCompareReducer, appSeoListingReducer, appSeoReducer, appSeoResearchReducer, appSeoReviewsReducer, appSeoTrackingReducer }, { rootReducer }] = await Promise.all([
    import('@features/app-seo'),
    import('@app/store'),
  ]);
  rootReducer.inject({ reducerPath: 'appSeo', reducer: appSeoReducer });
  rootReducer.inject({ reducerPath: 'appSeoTracking', reducer: appSeoTrackingReducer });
  rootReducer.inject({ reducerPath: 'appSeoListing', reducer: appSeoListingReducer });
  rootReducer.inject({ reducerPath: 'appSeoCharts', reducer: appSeoChartsReducer });
  rootReducer.inject({ reducerPath: 'appSeoResearch', reducer: appSeoResearchReducer });
  rootReducer.inject({ reducerPath: 'appSeoReviews', reducer: appSeoReviewsReducer });
  rootReducer.inject({ reducerPath: 'appSeoCompare', reducer: appSeoCompareReducer });
  return { default: AppsPanel };
});

const LazyCannibalizationPanel = lazy(async () => {
  const [{ CannibalizationPage, cannibalizationReducer }, { rootReducer }] = await Promise.all([
    import('@features/cannibalization'),
    import('@app/store'),
  ]);
  rootReducer.inject({
    reducerPath: 'cannibalization',
    reducer: cannibalizationReducer,
  });
  return { default: CannibalizationPage };
});

const LazyKeywordClustersPanel = lazy(async () => {
  const { KeywordClustersPage } = await import('@features/keyword-clusters');
  return { default: KeywordClustersPage };
});

const LazyInternalLinksPanel = lazy(async () => {
  const { InternalLinksPage } = await import('@features/internal-links');
  return { default: InternalLinksPage };
});

const LazySchemaGeneratorPanel = lazy(async () => {
  const [{ SchemaGeneratorPanel, schemaGeneratorReducer }, { rootReducer }] = await Promise.all([
    import('@features/schema-generator'),
    import('@app/store'),
  ]);
  rootReducer.inject({ reducerPath: 'schemaGenerator', reducer: schemaGeneratorReducer });
  return { default: SchemaGeneratorPanel };
});

const LazyPanelFallback = () => (
  <div className="flex flex-col gap-3" aria-busy="true">
    <Skeleton className="h-8 w-48" />
    <Skeleton className="h-32 w-full" />
  </div>
);

export const SiteWorkspacePage = () => {
  const { t, i18n } = useTranslation([
    'sites',
    'pages',
    'clientReports',
    'competitorsTraffic',
  ]);
  const dispatch = useAppDispatch();
  const params = useParams<{ siteId: string }>();
  const siteId = params.siteId ?? '';
  useLegacyCompetitorContentRedirect();

  const sites = useAppSelector(selectSites);
  const sitesLoaded = useAppSelector(selectSitesLoaded);
  const pausingId = useAppSelector(selectPausingSiteId);

  useEffect(() => {
    if (!sitesLoaded) {
      void dispatch(loadSites({ direction: 'initial' }));
    }
  }, [dispatch, sitesLoaded]);

  // `useSiteTab` already coerces unknown `?tab=` values to the overview default.
  const [activeTab, setActiveTab] = useSiteTab();
  // Google-tab drill-in (`?view=`) — null means the overview card stack.
  const [googleView] = useSiteSubView();

  const site = sites.find((s) => s.id === siteId);
  const heading = site?.displayName || site?.domain || siteId;
  // Show a heading-sized skeleton until the sites slice resolves, so the raw
  // site UUID never flashes as the page title.
  const headingResolved = sitesLoaded || Boolean(site);

  const panels: Record<SiteTab, ReactNode> = {
    overview: <OverviewPanel siteId={siteId} />,
    pages: (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyPagesPanel siteId={siteId} />
      </Suspense>
    ),
    actions: (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyActionsPanel siteId={siteId} />
      </Suspense>
    ),
    report: (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyReportPage siteId={siteId} />
      </Suspense>
    ),
    'client-reports': (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyClientReportsPanel siteId={siteId} />
      </Suspense>
    ),
    keywords: <KeywordsPanel siteId={siteId} />,
    'serp-features': <SerpFeaturesPanel siteId={siteId} />,
    'keyword-clusters': (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyKeywordClustersPanel siteId={siteId} />
      </Suspense>
    ),
    research: (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyKeywordResearchPage siteId={siteId} />
      </Suspense>
    ),
    traffic: (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyTrafficInsightsPanel siteId={siteId} siteDomain={site?.domain} />
      </Suspense>
    ),
    backlinks: (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyBacklinksPage siteId={siteId} />
      </Suspense>
    ),
    competitors: (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyCompetitorsPage siteId={siteId} />
      </Suspense>
    ),
    'ai-visibility': (
      <div className="flex flex-col gap-4">
        <Suspense fallback={<LazyPanelFallback />}>
          <LazyWeeklyPulseCard siteId={siteId} />
        </Suspense>
        <Suspense fallback={<LazyPanelFallback />}>
          <LazyAiVisibilityPage siteId={siteId} />
        </Suspense>
      </div>
    ),
    'brand-radar': (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyBrandRadarPanel siteId={siteId} />
      </Suspense>
    ),
    apps: (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyAppsPanel siteId={siteId} />
      </Suspense>
    ),
    'local-seo': (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyLocalSeoPage siteId={siteId} />
      </Suspense>
    ),
    reviews: (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyReviewsPanel siteId={siteId} />
      </Suspense>
    ),
    geogrid: (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyGeogridPanel siteId={siteId} />
      </Suspense>
    ),
    google: (
      <div className="flex flex-col gap-4">
        {/* Search summary, then the GA4 analytics card,
            then the connect card — the summary cards render nothing until
            the connection is `connected`. A `?view=` drill-in replaces the
            whole stack with the detail panel; its back link clears the
            param. */}
        {googleView ? (
          <GoogleSearchDetailPanel view={googleView} siteId={siteId} />
        ) : (
          <>
            <GoogleSearchSummaryCard siteId={siteId} />
            <Suspense fallback={<LazyPanelFallback />}>
              <LazyGscGenerativeAppearanceCard siteId={siteId} />
            </Suspense>
            <GoogleAnalyticsSummaryCard siteId={siteId} />
            <GoogleConnectionCard siteId={siteId} />
          </>
        )}
      </div>
    ),
    content: (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyContentIntelligencePage siteId={siteId} siteOrigin={site?.url} />
      </Suspense>
    ),
    'internal-links': (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyInternalLinksPanel siteId={siteId} />
      </Suspense>
    ),
    cannibalization: (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyCannibalizationPanel siteId={siteId} />
      </Suspense>
    ),
    'audience-research': (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazyAudienceResearchPage siteId={siteId} />
      </Suspense>
    ),
    schema: (
      <Suspense fallback={<LazyPanelFallback />}>
        <LazySchemaGeneratorPanel siteId={siteId} />
      </Suspense>
    ),
  };

  return (
    <div className="flex flex-col gap-6 px-4 py-8" data-testid="site-workspace">
      <PageHeader
        icon={APP_PAGE_ICONS.siteWorkspace}
        title={
          headingResolved ? (
            heading
          ) : (
            <span>
              <span className="sr-only">{t('loading')}</span>
              <span
                aria-hidden="true"
                className="block h-8 w-64 animate-pulse rounded-md bg-accent"
                data-testid="workspace-heading-skeleton"
              />
            </span>
          )
        }
        description={site?.domain}
      />
      {site?.paused ? (
        <Alert role="status" data-testid="site-paused-banner">
          <Pause aria-hidden="true" />
          <AlertTitle>{t('paused.bannerTitle')}</AlertTitle>
          <AlertDescription>
            <p>
              {t('paused.banner', {
                when: site.pausedAt ? formatRelativeTime(site.pausedAt, i18n.language) : '',
              })}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              loading={pausingId === site.id}
              loadingLabel={t('paused.resuming')}
              onClick={() => void dispatch(resumeSite(site.id))}
              data-testid="site-paused-banner-resume"
            >
              <Play aria-hidden="true" />
              {t('paused.resumeCta')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <SiteWorkspaceNavigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <section
        className="min-w-0"
        aria-label={t(getSiteTabLabelKey(activeTab))}
        data-testid={`site-tab-panel-${activeTab}`}
      >
        {panels[activeTab]}
      </section>
    </div>
  );
};
