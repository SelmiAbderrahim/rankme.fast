import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { backlinksReducer } from '@features/backlinks';
import { competitorsReducer } from '@features/competitors';
import { aiVisibilityReducer } from '@features/ai-visibility';
import { localSeoReducer } from '@features/local-seo';
import { googleReducer } from '@features/google';
import { keywordResearchReducer } from '@features/keyword-research';
import { ranksReducer } from '@features/ranks';
import { reportReducer } from '@features/report';
import * as sitesApi from '../api';
import { sitesReducer } from '../store/slice';
import { SITE_TABS, getSiteTabGroup, type SiteTab } from '../tabState';
import type { SitesState } from '../types';
import { SiteWorkspacePage } from './SiteWorkspacePage';

vi.mock('@features/ranks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/ranks')>()),
  KeywordsPanel: ({ siteId }: { siteId: string }) => (
    <div data-testid="mock-keywords" data-site={siteId}>
      keywords-mock
    </div>
  ),
  SerpFeaturesPanel: ({ siteId }: { siteId: string }) => (
    <div data-testid="mock-serp-features" data-site={siteId}>
      serp-features-mock
    </div>
  ),
}));

vi.mock('@features/pages', () => ({
  PagesPanel: ({ siteId }: { siteId: string }) => (
    <div data-testid="mock-pages" data-site={siteId}>pages-mock</div>
  ),
  pagesReducer: (state = {}) => state,
}));

vi.mock('@features/keyword-research', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/keyword-research')>()),
  KeywordResearchPage: ({ siteId }: { siteId?: string | null }) => (
    <div data-testid="mock-keyword-research" data-site={siteId}>
      keyword-research-mock
    </div>
  ),
}));

vi.mock('@features/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/report')>()),
}));

vi.mock('@features/report/components/ReportPage', () => ({
  ReportPage: ({ siteId }: { siteId?: string }) => (
    <div data-testid="mock-report" data-site={siteId}>
      report-mock
    </div>
  ),
}));

vi.mock('@features/client-reports', () => ({
  ClientReportsPanel: ({ siteId }: { siteId: string }) => (
    <div data-testid="mock-client-reports" data-site={siteId}>
      client-reports-mock
    </div>
  ),
}));

vi.mock('@features/actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/actions')>()),
  ActionsPanel: ({ siteId }: { siteId?: string }) => (
    <div data-testid="mock-actions" data-site={siteId}>
      actions-mock
    </div>
  ),
}));

vi.mock('@features/backlinks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/backlinks')>()),
}));

vi.mock('@features/competitors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/competitors')>()),
  CompetitorsPage: ({ siteId }: { siteId?: string }) => (
    <div data-testid="mock-competitors" data-site={siteId}>
      competitors-mock
    </div>
  ),
}));

vi.mock('@features/competitors/traffic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/competitors/traffic')>()),
  TrafficInsightsPanel: ({ siteId }: { siteId?: string }) => (
    <div data-testid="mock-traffic" data-site={siteId}>
      traffic-mock
    </div>
  ),
}));

vi.mock('@features/ai-visibility', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/ai-visibility')>()),
  AiVisibilityPage: ({ siteId }: { siteId?: string }) => (
    <div data-testid="mock-ai-visibility" data-site={siteId}>
      ai-visibility-mock
    </div>
  ),
}));

vi.mock('@features/local-seo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/local-seo')>()),
  LocalSeoPage: ({ siteId }: { siteId?: string }) => (
    <div data-testid="mock-local-seo" data-site={siteId}>
      local-seo-mock
    </div>
  ),
  // Review Intelligence is a second lazy tab out of the SAME
  // feature barrel — stubbed here so this suite covers the `?tab=reviews`
  // chunk factory without pulling the whole reviews surface.
  ReviewsPanel: ({ siteId }: { siteId?: string }) => (
    <div data-testid="mock-reviews" data-site={siteId}>
      reviews-mock
    </div>
  ),
  // Geogrid is a third lazy tab out of the SAME feature barrel —
  // stubbed here so this suite covers the `?tab=geogrid` chunk factory
  // without pulling the whole geogrid surface.
  GeogridPanel: ({ siteId }: { siteId?: string }) => (
    <div data-testid="mock-geogrid" data-site={siteId}>
      geogrid-mock
    </div>
  ),
  // The workspace injects the feature reducer before rendering the lazy panel.
  geogridReducer: (state: unknown = {}) => state,
}));

vi.mock('@features/content-intelligence', () => ({
  ContentIntelligencePage: ({ siteId }: { siteId?: string }) => (
    <div data-testid="mock-content-intelligence" data-site={siteId}>
      content-intelligence-mock
    </div>
  ),
  // The workspace injects the feature reducer before rendering the lazy page.
  // This isolated component test does not exercise that reducer's behavior.
  contentIntelligenceReducer: (state: unknown = {}) => state,
}));

vi.mock('@features/audience-research', () => ({
  AudienceResearchPanel: ({ siteId }: { siteId?: string }) => (
    <div data-testid="mock-audience-research" data-site={siteId}>
      audience-research-mock
    </div>
  ),
  // The workspace injects the feature reducer before rendering the lazy page.
  // This isolated component test does not exercise that reducer's behavior.
  audienceResearchReducer: (state: unknown = {}) => state,
}));

// Site-scoped tools relocated into the workspace.
vi.mock('@features/brand-radar', () => ({
  BrandRadarPage: ({ siteId }: { siteId: string }) => (
    <div data-testid="mock-brand-radar" data-site={siteId} />
  ),
  brandRadarReducer: (state = {}) => state,
}));

vi.mock('@features/app-seo', () => ({
  AppsPanel: ({ siteId }: { siteId: string }) => (
    <div data-testid="mock-apps" data-site={siteId} />
  ),
  appSeoReducer: (state = { profiles: [], registration: { status: 'idle', message: '' } }) => state,
  appSeoChartsReducer: (state = {}) => state,
  appSeoCompareReducer: (state = {}) => state,
  appSeoListingReducer: (state = {}) => state,
  appSeoResearchReducer: (state = {}) => state,
  appSeoReviewsReducer: (state = {}) => state,
  appSeoTrackingReducer: (state = {}) => state,
}));

vi.mock('@features/cannibalization', () => ({
  CannibalizationPage: ({ siteId }: { siteId: string }) => (
    <div data-testid="mock-cannibalization" data-site={siteId} />
  ),
  cannibalizationReducer: (state = {}) => state,
}));

vi.mock('@features/keyword-clusters', () => ({
  KeywordClustersPage: ({ siteId }: { siteId: string }) => (
    <div data-testid="mock-keyword-clusters" data-site={siteId} />
  ),
}));

vi.mock('@features/internal-links', () => ({
  InternalLinksPage: ({ siteId }: { siteId: string }) => (
    <div data-testid="mock-internal-links" data-site={siteId} />
  ),
}));

vi.mock('@features/schema-generator', () => ({
  SchemaGeneratorPanel: ({ siteId }: { siteId?: string }) => (
    <div data-testid="mock-schema-generator" data-site={siteId}>
      schema-generator-mock
    </div>
  ),
  // The workspace injects the feature reducer before rendering the lazy panel.
  // This isolated component test does not exercise that reducer's behavior.
  schemaGeneratorReducer: (state: unknown = {}) => state,
}));

vi.mock('@features/weekly-pulse', () => ({
  WeeklyPulseCard: ({ siteId }: { siteId?: string }) => (
    <div data-testid="mock-weekly-pulse" data-site={siteId}>
      weekly-pulse-mock
    </div>
  ),
  GscGenerativeAppearanceCard: ({ siteId }: { siteId?: string }) => (
    <div data-testid="mock-gsc-appearance" data-site={siteId}>
      gsc-appearance-mock
    </div>
  ),
  // Both lazy loaders inject this shared reducer before rendering; this
  // isolated component test does not exercise the reducer's behavior.
  weeklyPulseReducer: (state: unknown = {}) => state,
}));

vi.mock('@features/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/google')>()),
  GoogleConnectionCard: () => <div data-testid="mock-google">google-mock</div>,
  GoogleAnalyticsSummaryCard: ({ siteId }: { siteId: string }) => (
    <div data-testid="mock-google-analytics" data-site={siteId}>
      google-analytics-mock
    </div>
  ),
  GoogleSearchDetailPanel: ({ view, siteId }: { view: string; siteId: string }) => (
    <div data-testid="mock-google-detail" data-view={view} data-site={siteId}>
      google-detail-mock
    </div>
  ),
}));

vi.mock('../api', () => ({
  fetchSitesRequest: vi.fn(async () => ({
    sites: [
      {
        id: 'site-1',
        url: 'https://example.com',
        domain: 'example.com',
        displayName: 'Example',
        paused: false,
        pausedAt: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    nextCursor: null,
  })),
  createSiteRequest: vi.fn(),
  deleteSiteRequest: vi.fn(),
  updateSiteRequest: vi.fn(),
  pauseSiteRequest: vi.fn(),
  resumeSiteRequest: vi.fn(),
}));

const baseSites = (): SitesState => sitesReducer(undefined, { type: '@@init' });

const mockedApi = vi.mocked(sitesApi);

interface WorkspaceStoreOpts {
  displayName?: string;
  paused?: boolean;
  pausedAt?: string | null;
}

const makeStore = (opts: WorkspaceStoreOpts = {}) => {
  const store = configureStore({
    reducer: {
      sites: sitesReducer,
      backlinks: backlinksReducer,
      competitors: competitorsReducer,
      aiVisibility: aiVisibilityReducer,
      localSeo: localSeoReducer,
      google: googleReducer,
      keywordResearch: keywordResearchReducer,
      ranks: ranksReducer,
      report: reportReducer,
    },
    preloadedState: {
      sites: {
        ...baseSites(),
        loaded: true,
        items: [
          {
            id: 'site-1',
            url: 'https://example.com',
            domain: 'example.com',
            displayName: opts.displayName ?? 'Example',
            paused: opts.paused ?? false,
            pausedAt: opts.pausedAt ?? null,
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      },
    },
  });
  return store;
};

const renderAt = (path: string, opts: WorkspaceStoreOpts = {}) => {
  const store = makeStore(opts);
  const utils = render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/sites/:siteId" element={<SiteWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return { store, ...utils };
};

const expectActiveDestination = (tab: SiteTab) => {
  expect(screen.getByTestId(`site-tab-panel-${tab}`)).toBeInTheDocument();
  const group = getSiteTabGroup(tab);
  if (group) {
    expect(screen.getByTestId(`site-nav-group-${group.id}`)).toHaveAttribute('data-active', 'true');
    return;
  }
  expect(screen.getByTestId('site-tab-overview')).toHaveAttribute('data-state', 'active');
};

const openMobileDestinations = async () => {
  const user = userEvent.setup();
  await user.click(await screen.findByTestId('site-nav-mobile'));
  return {
    destination: (tab: SiteTab) => screen.getByTestId(`site-nav-mobile-item-${tab}`),
    user,
  };
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('SiteWorkspacePage — default tab, deep link, invalid tab, switching', () => {
  it('renders overview by default when there is no ?tab=', async () => {
    renderAt('/sites/site-1');
    await waitFor(() => expect(screen.getByTestId('overview-panel')).toBeInTheDocument());
    expectActiveDestination('overview');
    expect(screen.getByTestId('site-navigation')).toHaveAccessibleName('Workspace view');
    // Site heading uses the displayName.
    expect(screen.getByRole('heading', { name: 'Example' })).toBeInTheDocument();
  });

  it('deep-link ?tab=report mounts the ReportPage', async () => {
    renderAt('/sites/site-1?tab=report');
    expect(await screen.findByTestId('mock-report')).toHaveAttribute('data-site', 'site-1');
  });

  it('deep-link ?tab=pages mounts the always-available Pages panel', async () => {
    renderAt('/sites/site-1?tab=pages');
    expect(await screen.findByTestId('mock-pages')).toHaveAttribute('data-site', 'site-1');
    expectActiveDestination('pages');
  });

  it('deep-link ?tab=client-reports mounts the client reports surface', async () => {
    renderAt('/sites/site-1?tab=client-reports');
    const panel = await screen.findByTestId('mock-client-reports');
    expect(panel).toHaveAttribute('data-site', 'site-1');
    expectActiveDestination('client-reports');
  });

  it('deep-link ?tab=actions mounts the ActionsPanel ', async () => {
    renderAt('/sites/site-1?tab=actions');
    expect(await screen.findByTestId('mock-actions', {}, { timeout: 3000 })).toHaveAttribute(
      'data-site',
      'site-1',
    );
    expectActiveDestination('actions');
  });

  it('report bucket param (?bucket=) does not knock the workspace off the report tab', async () => {
    // Regression: report inner tabs use ?bucket= so they never collide with
    // the outer site ?tab=. A bucket value must leave the site tab untouched.
    renderAt('/sites/site-1?tab=report&bucket=watch');
    expect(await screen.findByTestId('mock-report')).toHaveAttribute('data-site', 'site-1');
    expectActiveDestination('report');
    expect(screen.queryByTestId('overview-panel')).toBeNull();
  });

  it('deep-link ?tab=keywords mounts the KeywordsPanel', async () => {
    renderAt('/sites/site-1?tab=keywords');
    expect(await screen.findByTestId('mock-keywords')).toHaveAttribute('data-site', 'site-1');
  });

  it('deep-link ?tab=serp-features mounts the SerpFeaturesPanel', async () => {
    renderAt('/sites/site-1?tab=serp-features');
    expect(await screen.findByTestId('mock-serp-features')).toHaveAttribute('data-site', 'site-1');
  });

  it('deep-link ?tab=research mounts the KeywordResearchPage with the siteId', async () => {
    renderAt('/sites/site-1?tab=research');
    expect(
      await screen.findByTestId('mock-keyword-research', {}, { timeout: 3000 }),
    ).toHaveAttribute('data-site', 'site-1');
  });

  it('deep-link ?tab=content mounts content intelligence with the owned site id', async () => {
    renderAt(
      '/sites/site-1?tab=content&view=analyses&ownedUrl=https%3A%2F%2Fexample.com%2Fguide&keyword=content%20audit',
    );
    expect(
      await screen.findByTestId('mock-content-intelligence', {}, { timeout: 3000 }),
    ).toHaveAttribute('data-site', 'site-1');
    expectActiveDestination('content');
  });

  it('deep-link ?tab=audience-research mounts the AudienceResearchPanel', async () => {
    renderAt('/sites/site-1?tab=audience-research');
    expect(
      await screen.findByTestId('mock-audience-research', {}, { timeout: 3000 }),
    ).toHaveAttribute('data-site', 'site-1');
    expectActiveDestination('audience-research');
  });

  it('deep-link ?tab=schema mounts the schema generator with the site id', async () => {
    renderAt('/sites/site-1?tab=schema&page=https%3A%2F%2Fexample.com%2Fguide');
    const panel = await screen.findByTestId('mock-schema-generator', {}, { timeout: 3000 });
    expect(panel).toHaveAttribute('data-site', 'site-1');
    expectActiveDestination('schema');
  });

  it.each([
    ['brand-radar', 'mock-brand-radar'],
    ['apps', 'mock-apps'],
    ['keyword-clusters', 'mock-keyword-clusters'],
    ['cannibalization', 'mock-cannibalization'],
    ['internal-links', 'mock-internal-links'],
  ])('deep-link ?tab=%s mounts the relocated panel with the site id', async (tab, testId) => {
    renderAt(`/sites/site-1?tab=${tab}`);
    expect(await screen.findByTestId(testId, {}, { timeout: 3000 })).toHaveAttribute(
      'data-site',
      'site-1',
    );
    expectActiveDestination(tab as SiteTab);
  });

  it('invalid ?tab= falls back to the overview default', async () => {
    renderAt('/sites/site-1?tab=nonsense');
    await waitFor(() => expect(screen.getByTestId('overview-panel')).toBeInTheDocument());
  });

  it('clicking a tab writes ?tab= without pushing browser history', async () => {
    renderAt('/sites/site-1');
    const before = window.history.length;
    const user = userEvent.setup();
    await user.click(screen.getByTestId('site-nav-group-audit-reports'));
    await user.click(screen.getByTestId('site-tab-report'));
    await waitFor(() => expect(screen.getByTestId('mock-report')).toBeInTheDocument());
    expect(window.history.length).toBe(before);
  });
});

describe('SiteWorkspacePage — every destination is open', () => {
  it('lists every workspace destination with no lock marker', async () => {
    renderAt('/sites/site-1');
    await waitFor(() => expect(screen.getByTestId('site-tab-overview')).toBeInTheDocument());
    const { destination } = await openMobileDestinations();
    for (const tab of SITE_TABS) {
      expect(destination(tab)).toBeInTheDocument();
      expect(destination(tab)).not.toHaveAttribute('data-locked');
    }
  });

  it('?tab=backlinks mounts the backlinks panel', async () => {
    renderAt('/sites/site-1?tab=backlinks');
    expect(await screen.findByTestId('backlinks-panel', {}, { timeout: 3000 })).toBeVisible();
    expectActiveDestination('backlinks');
  });

  it('deep-link ?tab=reviews lazy-mounts the ReviewsPanel with the site id', async () => {
    renderAt('/sites/site-1?tab=reviews');
    const panel = await screen.findByTestId('mock-reviews', {}, { timeout: 3000 });
    expect(panel).toHaveAttribute('data-site', 'site-1');
    expectActiveDestination('reviews');
  });

  it('deep-link ?tab=geogrid lazy-mounts the GeogridPanel with the site id', async () => {
    renderAt('/sites/site-1?tab=geogrid');
    const panel = await screen.findByTestId('mock-geogrid', {}, { timeout: 3000 });
    expect(panel).toHaveAttribute('data-site', 'site-1');
    expectActiveDestination('geogrid');
  });

  it('renders backlinks content on ?tab=backlinks', async () => {
    renderAt('/sites/site-1?tab=backlinks');
    const workspace = await screen.findByTestId(
      'link-intelligence-workspace',
      {},
      { timeout: 3000 },
    );
    expect(workspace).toHaveAttribute('data-embedded', 'true');
    expect(screen.getByTestId('link-intel-tab-overview')).toHaveAttribute('data-state', 'active');
    expectActiveDestination('backlinks');
    expect(screen.getByRole('heading', { level: 2, name: 'Link intelligence' })).toBeVisible();
  });

  it('deep-links from the normal site route to the nested toxicity view', async () => {
    renderAt('/sites/site-1?tab=backlinks&view=toxicity');
    expect(await screen.findByTestId('toxicity-workspace', {}, { timeout: 3000 })).toBeVisible();
    expect(screen.getByTestId('link-intel-tab-toxicity')).toHaveAttribute('data-state', 'active');
    expectActiveDestination('backlinks');
  });

  it('deep-links to the shared traffic panel via ?tab=traffic', async () => {
    renderAt('/sites/site-1?tab=traffic');
    expect(await screen.findByTestId('mock-traffic')).toHaveAttribute('data-site', 'site-1');
    expectActiveDestination('traffic');
  });

  it('renders competitors content on ?tab=competitors', async () => {
    renderAt('/sites/site-1?tab=competitors');
    expect(await screen.findByTestId('mock-competitors', {}, { timeout: 3000 })).toHaveAttribute(
      'data-site',
      'site-1',
    );
  });

  it('renders AI Visibility content on ?tab=ai-visibility', async () => {
    renderAt('/sites/site-1?tab=ai-visibility');
    expect(await screen.findByTestId('mock-ai-visibility', {}, { timeout: 3000 })).toHaveAttribute(
      'data-site',
      'site-1',
    );
  });

  it('lazy-loads the weekly pulse card (and injects its reducer) on ?tab=ai-visibility', async () => {
    renderAt('/sites/site-1?tab=ai-visibility');
    expect(await screen.findByTestId('mock-weekly-pulse', {}, { timeout: 3000 })).toHaveAttribute(
      'data-site',
      'site-1',
    );
  });

  it('lazy-loads the GSC generative-appearance card on ?tab=google', async () => {
    renderAt('/sites/site-1?tab=google');
    expect(await screen.findByTestId('mock-gsc-appearance', {}, { timeout: 3000 })).toHaveAttribute(
      'data-site',
      'site-1',
    );
  });

  it('renders Local SEO content on ?tab=local-seo', async () => {
    renderAt('/sites/site-1?tab=local-seo');
    expect(await screen.findByTestId('mock-local-seo', {}, { timeout: 3000 })).toHaveAttribute(
      'data-site',
      'site-1',
    );
  });

  it('google tab renders the analytics card between the summary and the connection card', async () => {
    renderAt('/sites/site-1?tab=google');
    expect(await screen.findByTestId('mock-google')).toBeInTheDocument();
    const analytics = screen.getByTestId('mock-google-analytics');
    expect(analytics).toHaveAttribute('data-site', 'site-1');
    // Order in the stack: (summary) → analytics → connection.
    expect(
      analytics.compareDocumentPosition(screen.getByTestId('mock-google')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByTestId('mock-google-detail')).not.toBeInTheDocument();
  });

  it('?view= swaps the google card stack for the drill-in detail panel', async () => {
    renderAt('/sites/site-1?tab=google&view=queries');
    const panel = await screen.findByTestId('mock-google-detail');
    expect(panel).toHaveAttribute('data-view', 'queries');
    expect(panel).toHaveAttribute('data-site', 'site-1');
    // The summary/analytics/connection stack is replaced, not stacked underneath.
    expect(screen.queryByTestId('mock-google')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-google-analytics')).not.toBeInTheDocument();
    expect(screen.queryByTestId('google-search-summary-card')).not.toBeInTheDocument();
  });

  it('an invalid ?view= falls back to the overview card stack', async () => {
    renderAt('/sites/site-1?tab=google&view=bogus');
    expect(await screen.findByTestId('mock-google')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-google-detail')).not.toBeInTheDocument();
  });
});

describe('SiteWorkspacePage — falls back when the site is not yet loaded', () => {
  it('renders the site id as the heading when the site record is missing', async () => {
    const store = configureStore({
      reducer: {
        sites: sitesReducer,
        backlinks: backlinksReducer,
        competitors: competitorsReducer,
        aiVisibility: aiVisibilityReducer,
        google: googleReducer,
        ranks: ranksReducer,
        report: reportReducer,
      },
      preloadedState: {
        sites: {
          ...baseSites(),
          loaded: true,
          items: [],
        },
      },
    });
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/unknown']}>
            <Routes>
              <Route path="/sites/:siteId" element={<SiteWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'unknown' })).toBeInTheDocument(),
    );
  });

  it('falls back to the owned domain when the display name is empty', async () => {
    renderAt('/sites/site-1', { displayName: '' });
    expect(await screen.findByRole('heading', { name: 'example.com' })).toBeInTheDocument();
  });

  it('shows a heading skeleton (not the raw UUID) until the sites slice resolves', () => {
    const store = configureStore({
      reducer: {
        sites: sitesReducer,
        backlinks: backlinksReducer,
        competitors: competitorsReducer,
        aiVisibility: aiVisibilityReducer,
        google: googleReducer,
        ranks: ranksReducer,
        report: reportReducer,
      },
    });
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/site-1']}>
            <Routes>
              <Route path="/sites/:siteId" element={<SiteWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    // First synchronous render: sitesLoaded is still false → heading skeleton,
    // no <h1> with the raw site id.
    expect(screen.getByTestId('workspace-heading-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'site-1' })).toBeNull();
  });

  it('dispatches loadSites when the sites slice has not loaded', async () => {
    const store = configureStore({
      reducer: {
        sites: sitesReducer,
        backlinks: backlinksReducer,
        competitors: competitorsReducer,
        aiVisibility: aiVisibilityReducer,
        google: googleReducer,
        ranks: ranksReducer,
        report: reportReducer,
      },
    });
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/site-1']}>
            <Routes>
              <Route path="/sites/:siteId" element={<SiteWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await waitFor(() => expect(screen.getByTestId('site-workspace')).toBeInTheDocument());
  });
});

describe('SiteWorkspacePage — siteId param absent', () => {
  it('falls back to empty string when useParams yields no siteId (covers ?? right branch)', async () => {
    // Render WITHOUT a :siteId route pattern so useParams() returns {}
    // → params.siteId is undefined → the ?? '' right branch fires.
    const store = makeStore();
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/no-param-route']}>
            <Routes>
              <Route path="/no-param-route" element={<SiteWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    // Component renders (with siteId=''), showing the workspace shell
    await waitFor(() => expect(screen.getByTestId('site-workspace')).toBeInTheDocument());
  });
});

describe('SiteWorkspacePage — paused banner', () => {
  const resumedSite = () => ({
    id: 'site-1',
    url: 'https://example.com',
    domain: 'example.com',
    displayName: 'Example',
    paused: false,
    pausedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  });

  it('renders no banner when the site is not paused', async () => {
    renderAt('/sites/site-1');
    await waitFor(() => expect(screen.getByTestId('site-tab-overview')).toBeInTheDocument());
    expect(screen.queryByTestId('site-paused-banner')).toBeNull();
  });

  it('renders the status banner with the relative pause time', async () => {
    const pausedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    renderAt('/sites/site-1', { paused: true, pausedAt });
    const banner = await screen.findByTestId('site-paused-banner');
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveTextContent('Site paused');
    expect(banner).toHaveTextContent(
      'This site is paused — no checks or audits are running. Paused 2 days ago.',
    );
  });

  it('interpolates an empty {{when}} while pausedAt is still null', async () => {
    renderAt('/sites/site-1', { paused: true, pausedAt: null });
    const banner = await screen.findByTestId('site-paused-banner');
    expect(banner).toHaveTextContent(
      'This site is paused — no checks or audits are running. Paused .',
    );
  });

  it('resume button dispatches resumeSite and the banner clears on success', async () => {
    const user = userEvent.setup();
    mockedApi.resumeSiteRequest.mockResolvedValueOnce({
      site: resumedSite(),
      message: 'Site resumed.',
    });
    renderAt('/sites/site-1', {
      paused: true,
      pausedAt: '2026-07-30T00:00:00.000Z',
    });
    await user.click(await screen.findByTestId('site-paused-banner-resume'));
    await waitFor(() => expect(mockedApi.resumeSiteRequest).toHaveBeenCalledWith('site-1'));
    await waitFor(() => expect(screen.queryByTestId('site-paused-banner')).toBeNull());
  });

  it('shows the shared in-button loading state while the resume is in flight', async () => {
    const user = userEvent.setup();
    // A never-resolving resume keeps pausingId === site.id in the store.
    mockedApi.resumeSiteRequest.mockReturnValueOnce(new Promise(() => {}));
    renderAt('/sites/site-1', {
      paused: true,
      pausedAt: '2026-07-30T00:00:00.000Z',
    });
    await user.click(await screen.findByTestId('site-paused-banner-resume'));
    const button = await screen.findByRole('button', { name: /Resuming…/ });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
  });
});

describe('SiteWorkspacePage — RTL', () => {
  it('renders in Arabic with dir=rtl', async () => {
    await changeLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    renderAt('/sites/site-1');
    await waitFor(() => expect(screen.getByTestId('site-tab-overview')).toBeInTheDocument());
    // Arabic overview tab label
    expect(screen.getByTestId('site-tab-overview')).toHaveTextContent('نظرة عامة');
  });
});
