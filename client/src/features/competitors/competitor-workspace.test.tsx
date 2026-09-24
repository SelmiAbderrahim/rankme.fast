import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { ApiError } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from './api';
import { CompetitorWorkspace } from './components/CompetitorWorkspace';
import { CompetitorsPage } from './components/CompetitorsPage';
import {
  clearIntelligenceActionError,
  clearLandscapePreview,
  competitorsReducer,
  toggleLandscapeProfile,
} from './store/slice';
import {
  acceptCompetitorOpportunity,
  addPortfolioCompetitor,
  cancelCompetitorLandscape,
  confirmCompetitorDiscovery,
  loadCompetitorDiscovery,
  loadCompetitorLandscapeDetail,
  loadCompetitorLandscapeRuns,
  loadCompetitorPortfolio,
  mutatePortfolioCompetitor,
  previewCompetitorDiscovery,
  previewCompetitorLandscape,
  startCompetitorLandscape,
} from './store/thunks';
import type {
  CompetitorDiscovery,
  CompetitorProfile,
  LandscapeDetail,
  LandscapePreview,
  LandscapeSummary,
} from './types';

vi.mock('./api', () => ({
  fetchCompetitors: vi.fn(),
  fetchIntersection: vi.fn(),
  refreshCompetitors: vi.fn(),
  fetchTechStack: vi.fn(),
  fetchCompetitorProfiles: vi.fn(),
  addCompetitorProfile: vi.fn(),
  changeCompetitorProfileStatus: vi.fn(),
  previewDiscoverySpend: vi.fn(),
  fetchLatestDiscovery: vi.fn(),
  refreshDiscovery: vi.fn(),
  previewLandscapeSpend: vi.fn(),
  startLandscapeRun: vi.fn(),
  fetchLandscapeRuns: vi.fn(),
  fetchLandscapeDetail: vi.fn(),
  cancelLandscapeRun: vi.fn(),
  acceptLandscapeRecommendation: vi.fn(),
  reviewLandscapePageMatch: vi.fn(),
}));

vi.mock('@features/competitors/traffic', () => ({
  TrafficInsightsPanel: ({ siteId }: { siteId: string }) => (
    <div data-testid="traffic-public-panel">{siteId}</div>
  ),
}));

vi.mock('@features/content-intelligence', () => ({
  CompetitorContentPanel: ({ siteId }: { siteId: string }) => (
    <div data-testid="workspace-content-panel">{siteId}</div>
  ),
  MonitoringPanel: ({ siteId }: { siteId: string }) => (
    <div data-testid="workspace-monitoring-panel">{siteId}</div>
  ),
  contentIntelligenceReducer: (state = {}) => state,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mocked = vi.mocked(api);
const profile = (id: string, status: 'active' | 'archived' = 'active'): CompetitorProfile => ({
  id,
  origin: `https://${id}.example`,
  registrableDomain: `${id}.example`,
  source: 'suggested',
  status,
  createdAt: '2026-08-09T00:00:00.000Z',
});

const discovery: CompetitorDiscovery = {
  id: 'discovery-1',
  state: 'partial',
  market: {
    locationCode: 2840,
    languageCode: 'en',
    source: 'tracked_keyword_mode',
    eligibleTrackedKeywords: 2,
  },
  suggestions: [
    {
      registrableDomain: 'suggested.example',
      origin: 'https://suggested.example',
      source: 'dataforseo',
      capturedAt: '2026-08-09T00:00:00.000Z',
      alreadyConfirmed: false,
    },
  ],
  cache: 'hit',
  provenance: [
    {
      provider: 'dataforseo',
      operation: 'domain_candidates',
      status: 'success',
      capturedAt: '2026-08-09T00:00:00.000Z',
    },
  ],
  coverage: { returned: 2, retained: 1, truncated: false },
  warnings: [{
    code: 'SOURCE_TIMEOUT',
    operation: 'serp_candidates',
    count: 1,
    messageKey: 'competitors.discovery.warnings.sourceTimeout',
    messageVars: { operation: 'serp_candidates', count: 1 },
    message: 'The competitor source timed out.',
  }],
  lastAttempt: { state: 'partial', attemptedAt: '2026-08-09T00:00:00.000Z', safeErrorCode: null },
  createdAt: '2026-08-09T00:00:00.000Z',
};

const run: LandscapeSummary = {
  id: '64b64b64b64b64b64b64b64b',
  siteId: 'site-1',
  state: 'completed',
  ownedDomain: 'owned.example',
  locale: 'en',
  market: { locationCode: 2840, languageCode: 'en', source: 'default' },
  competitors: [{ profileId: 'one', domain: 'one.example' }],
  progress: { completedLegs: 3, totalLegs: 3, stage: 'completed' },
  reportVersion: 1,
  schemaVersion: 'competitor-landscape/1',
  taxonomyVersion: '2026-08-08.1',
  createdAt: '2026-08-09T00:00:00.000Z',
  startedAt: '2026-08-09T00:00:00.000Z',
  completedAt: '2026-08-09T00:01:00.000Z',
};

const detail: LandscapeDetail = {
  run,
  manifest: {
    ownedDomain: 'owned.example',
    locale: 'en',
    market: {
      locationCode: 2840,
      languageCode: 'en',
      source: 'default',
      eligibleTrackedKeywords: 0,
    },
    competitors: [{ profileId: 'one', domain: 'one.example' }],
    coverage: {
      requestedCompetitors: 1,
      usableCompetitors: 1,
      requestedLegs: 3,
      succeededLegs: 3,
      failedLegs: 0,
      truncatedLegs: 0,
      unclassifiedSharedRows: 0,
      rowsByClass: {
        missing: 1,
        owned_only: 0,
        shared_behind: 0,
        shared_ahead: 0,
        shared_even: 0,
      },
    },
    provenance: [{ provider: 'dataforseo', leg: 'competitor_only', cache: 'miss', status: 'success', capturedAt: '2026-08-09T00:00:00.000Z' }],
    warnings: [],
    errors: [],
    pageSuggestions: [{
      id: 'match-1',
      competitorProfileId: 'one',
      ownedUrl: 'https://owned.example/a',
      competitorUrl: 'https://one.example/a',
      keywordKeys: ['hostile <script>alert(1)</script>'],
      reasonCode: 'same_keyword',
    confidence: 'high',
    review: { state: 'unreviewed', ownedUrl: null, competitorUrl: null, version: 0, reviewedAt: null },
    }],
    opportunities: [{
      id: 'opportunity-1',
      kind: 'missing_keyword',
      titleKey: 'competitors.landscape.opportunities.missingTitle',
      titleVars: { count: 1 },
      title: 'Observed opportunity',
      recommendationKey: 'competitors.landscape.opportunities.missingRecommendation',
      recommendationVars: { count: 1 },
      recommendation: 'Create a useful page.',
      competitorProfileIds: ['one'],
      keywordKeys: ['hostile'],
      evidenceRowIds: ['row-1'],
      confidence: 'high',
      labels: { evidence: 'observed', conclusion: 'derived', prose: 'generated' },
      acceptedActionId: null,
    }],
    sourceDates: [{ competitorProfileId: 'one', leg: 'competitor_only', capturedAt: '2026-08-09T00:00:00.000Z' }],
    rowCount: 1,
    completedAt: '2026-08-09T00:01:00.000Z',
  },
  items: [{
    id: 'row-1',
    class: 'missing',
    competitorProfileId: 'one',
    competitorDomain: 'one.example',
    keyword: '<img src=x onerror=alert(1)>',
    normalizedKeyword: 'hostile',
    ownedPosition: null,
    competitorPosition: 2,
    ownedRankAbsolute: null,
    competitorRankAbsolute: 2,
    ownedUrl: null,
    competitorUrl: 'javascript:alert(1)',
    searchVolume: 100,
    keywordDifficulty: 25,
    intent: 'commercial',
    positionDelta: null,
    competitorCoverage: 1,
    provenanceIndexes: [0],
  }],
  nextCursor: 'next-page',
};

function Location() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderWorkspace(path: string) {
  const store = configureStore({ reducer: { competitors: competitorsReducer } });
  const result = render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <CompetitorWorkspace siteId="site-1" />
          <Location />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return { ...result, store };
}

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  mocked.fetchCompetitorProfiles.mockResolvedValue({ items: [profile('one'), profile('old', 'archived')] });
  mocked.fetchLatestDiscovery.mockResolvedValue({ discovery });
  mocked.fetchLandscapeRuns.mockResolvedValue({ items: [run], nextCursor: null });
  mocked.fetchLandscapeDetail.mockResolvedValue(detail);
  mocked.previewDiscoverySpend.mockResolvedValue({
    market: discovery.market,
    unitsRequired: 1,
    enabled: true,
    createsProfiles: false,
  });
  mocked.refreshDiscovery.mockResolvedValue({ discovery, replayed: false });
  mocked.addCompetitorProfile.mockResolvedValue({ profile: profile('suggested'), duplicate: false });
  mocked.changeCompetitorProfileStatus.mockResolvedValue({ profile: profile('one', 'archived') });
  const preview: LandscapePreview = {
    competitorCount: 1,
    selected: [{ profileId: 'one', domain: 'one.example' }],
    competitorLimit: 10,
    market: discovery.market,
    unitsRequired: 1,
    maxRows: 300,
    enabled: true,
  };
  mocked.previewLandscapeSpend.mockResolvedValue(preview);
  mocked.startLandscapeRun.mockResolvedValue({
    run: { runId: run.id, state: 'queued', duplicate: false, reservedUnits: 1 },
  });
  mocked.cancelLandscapeRun.mockResolvedValue({ run: { ...run, state: 'cancelled' } });
  mocked.acceptLandscapeRecommendation.mockResolvedValue({
    acceptance: { acceptanceId: 'accept-1', actionId: 'action-1', replayed: false },
  });
  mocked.reviewLandscapePageMatch.mockResolvedValue({
    review: {
      state: 'approved',
      ownedUrl: 'https://owned.example/reviewed',
      competitorUrl: 'https://one.example/reviewed',
      version: 1,
      reviewedAt: '2026-08-09T00:02:00.000Z',
    },
    replayed: false,
  });
});

describe('unified competitor workspace', () => {
  it('normalizes a missing view, preserves unrelated params, and exposes all six views', async () => {
    renderWorkspace('/sites/site-1?tab=competitors&utm=kept');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('view=overview'));
    expect(screen.getByTestId('location')).toHaveTextContent('utm=kept');
    expect(screen.getByTestId('competitor-workspace-tabs').querySelectorAll('[role="tab"]')).toHaveLength(6);
    await userEvent.click(screen.getByRole('tab', { name: /traffic/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('view=traffic');
  });

  it('uses the unified page and masks another site while rekeying', async () => {
    const store = configureStore({ reducer: { competitors: competitorsReducer } });
    store.dispatch(loadCompetitorPortfolio.pending('old', { siteId: 'site-old' }));
    store.dispatch(loadCompetitorPortfolio.fulfilled([profile('oldsite')], 'old', { siteId: 'site-old' }));
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/site-1?tab=competitors&view=overview']}>
            <CompetitorsPage siteId="site-1" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(await screen.findByTestId('competitor-overview')).toBeInTheDocument();
    expect(screen.queryByText('oldsite.example')).not.toBeInTheDocument();
  });

  it('reads the site from the route param and falls back to an empty site id', async () => {
    const renderPage = (entry: string) =>
      render(
        <Provider store={configureStore({ reducer: { competitors: competitorsReducer } })}>
          <I18nextProvider i18n={i18n}>
            <MemoryRouter initialEntries={[entry]}>
              <Routes>
                <Route path="sites/:siteId/competitors" element={<CompetitorsPage />} />
                <Route path="*" element={<CompetitorsPage />} />
              </Routes>
            </MemoryRouter>
          </I18nextProvider>
        </Provider>,
      );
    const routed = renderPage('/sites/site-1/competitors');
    expect(await screen.findByTestId('competitor-overview')).toBeInTheDocument();
    expect(mocked.fetchCompetitorProfiles.mock.calls[0]?.[0]).toBe('site-1');
    routed.unmount();
    renderPage('/elsewhere');
    await waitFor(() => expect(mocked.fetchCompetitorProfiles.mock.calls[1]?.[0]).toBe(''));
  });

  it('shows a labelled loading shell before the portfolio is keyed to the site', () => {
    const store = configureStore({ reducer: { competitors: competitorsReducer } });
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <CompetitorWorkspace siteId="site-1" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getByText(/report in progress/i)).toHaveClass('sr-only');
  });

  it('previews and confirms discovery, then confirms a suggested competitor', async () => {
    renderWorkspace('/sites/site-1?tab=competitors&view=overview');
    await screen.findByText('suggested.example');
    await userEvent.click(screen.getByRole('button', { name: /preview discovery refresh/i }));
    await userEvent.click(await screen.findByRole('button', { name: /review and confirm/i }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/self-host/i);
    await userEvent.click(screen.getByRole('button', { name: /confirm refresh/i }));
    await waitFor(() => expect(mocked.refreshDiscovery).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: /confirm competitor/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm competitor/i }));
    await waitFor(() => expect(mocked.addCompetitorProfile).toHaveBeenCalledTimes(1));
  });

  it('discloses a disabled discovery preview before confirmation', async () => {
    mocked.previewDiscoverySpend.mockResolvedValueOnce({
      market: discovery.market, unitsRequired: 1, enabled: false, createsProfiles: false,
    });
    renderWorkspace('/sites/site-1?tab=competitors&view=overview');
    await userEvent.click(await screen.findByRole('button', { name: /preview discovery refresh/i }));
    expect(await screen.findByText(/new competitor requests are temporarily disabled/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /review and confirm/i })).toBeDisabled();
  });

  it('confirms landscape previews with the self-host notice', async () => {
    renderWorkspace('/sites/site-1?tab=competitors&view=keywords');
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /preview report spend/i }));
    expect(await screen.findByText(/self-host/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /review and confirm/i }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/self-host/i);
    await userEvent.click(screen.getByRole('button', { name: /confirm report/i }));
    await waitFor(() => expect(mocked.startLandscapeRun).toHaveBeenCalled());
  });

  it('falls back when the spend preview returns an unknown market language', async () => {
    mocked.previewLandscapeSpend.mockResolvedValueOnce({
      competitorCount: 1,
      selected: [{ profileId: 'one', domain: 'one.example' }],
      competitorLimit: 10,
      market: { ...discovery.market, languageCode: 'not-a-language' },
      unitsRequired: 1,
      maxRows: 300,
      enabled: true,
    });
    renderWorkspace('/sites/site-1?tab=competitors&view=keywords');
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /preview report spend/i }));
    expect(await screen.findByText(/unknown language/i)).toBeInTheDocument();
  });

  it('reports duplicate and failed portfolio additions without spending', async () => {
    mocked.addCompetitorProfile
      .mockResolvedValueOnce({ profile: profile('duplicate'), duplicate: true })
      .mockRejectedValueOnce(new Error('add failed'));
    renderWorkspace('/sites/site-1?tab=competitors&view=overview');
    const input = await screen.findByLabelText(/add a public competitor url/i);
    await userEvent.type(input, 'https://duplicate.example');
    await userEvent.click(screen.getByRole('button', { name: /add competitor/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/already/i)));
    await userEvent.type(input, 'https://failed.example');
    await userEvent.click(screen.getByRole('button', { name: /add competitor/i }));
    await waitFor(() => {
      expect(screen.getAllByRole('alert').some((alert) => /could not complete/i.test(alert.textContent ?? ''))).toBe(true);
    });
  });

  it('builds a landscape through preview and confirmation', async () => {
    mocked.fetchCompetitorProfiles.mockResolvedValueOnce({
      items: [profile('one'), profile('two'), profile('three')],
    });
    mocked.previewLandscapeSpend.mockResolvedValueOnce({
      competitorCount: 3,
      selected: [
        { profileId: 'one', domain: 'one.example' },
        { profileId: 'two', domain: 'two.example' },
        { profileId: 'three', domain: 'three.example' },
      ],
      competitorLimit: 10,
      market: discovery.market,
      unitsRequired: 3,
      maxRows: 900,
      enabled: true,
    });
    renderWorkspace('/sites/site-1?tab=competitors&view=keywords');
    for (const choice of await screen.findAllByRole('checkbox')) await userEvent.click(choice);
    await userEvent.click(screen.getByRole('button', { name: /preview report spend/i }));
    await userEvent.click(await screen.findByRole('button', { name: /review and confirm/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm report/i }));
    await waitFor(() => expect(mocked.startLandscapeRun).toHaveBeenCalledTimes(1));
    expect(mocked.previewLandscapeSpend).toHaveBeenCalledWith('site-1', ['one', 'two', 'three']);
    expect(mocked.startLandscapeRun).toHaveBeenCalledWith(
      'site-1',
      expect.objectContaining({ competitorProfileIds: ['one', 'two', 'three'] }),
      expect.any(String),
    );
    expect(screen.getByTestId('location')).toHaveTextContent(`report=${run.id}`);
  });

  it('applies standalone Gap competitor inputs and preserves market inputs for editing', async () => {
    renderWorkspace('/sites/site-1?tab=competitors&view=keywords&competitors=one.example&locationCode=2826&languageCode=de');
    expect(await screen.findByRole('checkbox')).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /preview report spend/i }));
    expect(await screen.findByRole('link', { name: /edit tracked-keyword market/i })).toHaveAttribute(
      'href',
      expect.stringContaining('locationCode=2826'),
    );
  });

  it('enforces the ten-competitor selection limit, cancels a preview, and reopens duplicate runs', async () => {
    mocked.fetchCompetitorProfiles.mockResolvedValueOnce({
      items: Array.from({ length: 11 }, (_, index) => profile(`site${index}`)),
    });
    const { unmount } = renderWorkspace('/sites/site-1?tab=competitors&view=keywords');
    const choices = await screen.findAllByRole('checkbox');
    for (const choice of choices) await userEvent.click(choice);
    expect(toast.error).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /preview report spend/i }));
    await screen.findByText(/server-authoritative spend preview/i);
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByText(/server-authoritative spend preview/i)).not.toBeInTheDocument();
    unmount();

    mocked.startLandscapeRun.mockResolvedValueOnce({
      run: { runId: run.id, state: 'queued', duplicate: true, reservedUnits: 1 },
    });
    renderWorkspace('/sites/site-1?tab=competitors&view=keywords');
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /preview report spend/i }));
    await userEvent.click(await screen.findByRole('button', { name: /review and confirm/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm report/i }));
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
  });

  it('keeps a failed landscape start in setup with a visible retry error', async () => {
    mocked.startLandscapeRun.mockRejectedValueOnce(new Error('provider unavailable'));
    renderWorkspace('/sites/site-1?tab=competitors&view=keywords');
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /preview report spend/i }));
    await userEvent.click(await screen.findByRole('button', { name: /review and confirm/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm report/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not complete/i);
  });

  it('explains the ten-competitor landscape limit', async () => {
    renderWorkspace('/sites/site-1?tab=competitors&view=keywords');
    expect(await screen.findByText(/select up to 10 confirmed competitors/i)).toBeInTheDocument();
  });

  it('explains the landscape kill switch while stored workspace data stays usable', async () => {
    mocked.previewLandscapeSpend.mockResolvedValueOnce({
      competitorCount: 1, selected: [{ profileId: 'one', domain: 'one.example' }],
      competitorLimit: 10, market: discovery.market, unitsRequired: 1,
      maxRows: 300, enabled: false,
    });
    renderWorkspace('/sites/site-1?tab=competitors&view=keywords');
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /preview report spend/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily disabled/i);
  });

  it('opens stored report detail, persists filters, guards hostile links, and accepts once', async () => {
    renderWorkspace(`/sites/site-1?tab=competitors&view=reports&report=${run.id}`);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/unsafe source link hidden/i)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/keyword class/i), 'missing');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('class=missing'));
    await userEvent.click(screen.getByRole('button', { name: /accept into next actions/i }));
    await userEvent.click(screen.getByRole('button', { name: /accept recommendation/i }));
    await waitFor(() => expect(mocked.acceptLandscapeRecommendation).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('link', { name: /open in next actions/i })).toHaveAttribute(
      'href',
      '/sites/site-1?tab=actions&source=competitor_opportunity',
    );
  });

  it('reviews page matches, protects links, and builds approved downstream handoffs', async () => {
    const matchingOpportunity = {
      ...detail.manifest!.opportunities[0]!,
      keywordKeys: ['shared keyword'],
    };
    const reviewedDetail: LandscapeDetail = {
      ...detail,
      manifest: {
        ...detail.manifest!,
        opportunities: [matchingOpportunity],
        pageSuggestions: [
          {
            ...detail.manifest!.pageSuggestions[0]!,
            id: 'approved-match',
            keywordKeys: ['shared keyword'],
            review: {
              state: 'approved',
              ownedUrl: 'https://owned.example/reviewed',
              competitorUrl: 'https://one.example/reviewed',
              version: 2,
              reviewedAt: '2026-08-09T00:02:00.000Z',
            },
          },
          {
            ...detail.manifest!.pageSuggestions[0]!,
            id: 'editable-match',
            competitorProfileId: 'two',
            competitorUrl: 'javascript:alert(1)',
            keywordKeys: ['orphan keyword'],
            review: {
              state: 'unreviewed',
              ownedUrl: null,
              competitorUrl: null,
              version: 0,
              reviewedAt: null,
            },
          },
          {
            ...detail.manifest!.pageSuggestions[0]!,
            id: 'empty-keyword-match',
            competitorProfileId: 'three',
            keywordKeys: [],
            review: {
              state: 'unreviewed',
              ownedUrl: null,
              competitorUrl: null,
              version: 0,
              reviewedAt: null,
            },
          },
        ],
      },
    };
    mocked.fetchLandscapeDetail.mockResolvedValue(reviewedDetail);
    renderWorkspace(`/sites/site-1?tab=competitors&view=reports&report=${run.id}`);

    const approved = await screen.findByTestId('page-match-approved-match');
    expect(within(approved).getByRole('link', { name: /compare reviewed pages/i })).toHaveAttribute(
      'href',
      expect.stringContaining('opportunity=opportunity-1'),
    );
    expect(within(approved).getByRole('link', { name: /monitor this reviewed page/i })).toHaveAttribute(
      'href',
      expect.stringContaining('prefillTargetKind=competitor'),
    );
    expect(within(approved).getByRole('link', { name: /start focused analysis/i })).toHaveAttribute(
      'href',
      expect.stringContaining('reviewedCompetitorUrls=https%3A%2F%2Fone.example%2Freviewed'),
    );

    const editable = screen.getByTestId('page-match-editable-match');
    expect(within(editable).queryByRole('link', { name: /open suggested/i })).toBeNull();
    const inputs = within(editable).getAllByRole('textbox');
    await userEvent.clear(inputs[0]!);
    await userEvent.type(inputs[0]!, 'https://owned.example/edited');
    await userEvent.clear(inputs[1]!);
    await userEvent.type(inputs[1]!, 'https://two.example/edited');

    let finishReview: ((value: Awaited<ReturnType<typeof api.reviewLandscapePageMatch>>) => void) | undefined;
    mocked.reviewLandscapePageMatch.mockImplementationOnce(() => new Promise((resolve) => {
      finishReview = resolve;
    }));
    await userEvent.click(within(editable).getByRole('button', { name: /approve match/i }));
    expect(within(editable).getByRole('button', { name: /approve match/i })).toHaveAttribute('aria-busy', 'true');
    expect(within(editable).getByRole('button', { name: /^reject$/i })).toBeDisabled();
    finishReview?.({
      review: {
        state: 'approved',
        ownedUrl: 'https://owned.example/edited',
        competitorUrl: 'https://two.example/edited',
        version: 1,
        reviewedAt: '2026-08-09T00:03:00.000Z',
      },
      replayed: false,
    });
    await waitFor(() => expect(mocked.reviewLandscapePageMatch).toHaveBeenCalledWith(
      'site-1',
      run.id,
      'editable-match',
      {
        decision: 'approved',
        ownedUrl: 'https://owned.example/edited',
        competitorUrl: 'https://two.example/edited',
        version: 0,
      },
      expect.stringMatching(/^page-match-editable-match-/),
    ));

    mocked.reviewLandscapePageMatch.mockResolvedValueOnce({
      review: {
        state: 'rejected',
        ownedUrl: null,
        competitorUrl: null,
        version: 2,
        reviewedAt: '2026-08-09T00:04:00.000Z',
      },
      replayed: false,
    });
    await userEvent.click(within(editable).getByRole('button', { name: /^reject$/i }));
    await waitFor(() => expect(mocked.reviewLandscapePageMatch).toHaveBeenLastCalledWith(
      'site-1',
      run.id,
      'editable-match',
      { decision: 'rejected', ownedUrl: null, competitorUrl: null, version: 1 },
      expect.any(String),
    ));

    mocked.reviewLandscapePageMatch.mockRejectedValueOnce(new Error('review conflict'));
    await userEvent.click(within(editable).getByRole('button', { name: /approve match/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('review conflict');
    mocked.reviewLandscapePageMatch.mockRejectedValueOnce('offline');
    await userEvent.click(within(editable).getByRole('button', { name: /approve match/i }));
    await waitFor(() => expect(screen.getByRole('alert')).not.toHaveTextContent('review conflict'));
  });

  it('uses public feature APIs for traffic, content, and monitoring views', async () => {
    const view = renderWorkspace('/sites/site-1?tab=competitors&view=traffic');
    expect(screen.getByTestId('traffic-public-panel')).toHaveTextContent('site-1');
    view.unmount();
    renderWorkspace('/sites/site-1?tab=competitors&view=content');
    expect(await screen.findByTestId('workspace-content-panel')).toBeInTheDocument();
  });

  it('loads the monitoring public panel and supports manual/archive/restore portfolio controls', async () => {
    const monitoring = renderWorkspace('/sites/site-1?tab=competitors&view=monitoring');
    expect(await screen.findByTestId('workspace-monitoring-panel')).toBeInTheDocument();
    monitoring.unmount();

    renderWorkspace('/sites/site-1?tab=competitors&view=overview');
    const input = await screen.findByLabelText(/add a public competitor url/i);
    await userEvent.type(input, 'https://manual.example/');
    await userEvent.click(screen.getByRole('button', { name: /add competitor/i }));
    await waitFor(() => expect(mocked.addCompetitorProfile).toHaveBeenCalled());
    await userEvent.click(screen.getAllByRole('button', { name: /^archive$/i })[0]!);
    await waitFor(() => expect(mocked.changeCompetitorProfileStatus).toHaveBeenCalled());
    await userEvent.click(screen.getAllByRole('button', { name: /^restore$/i })[0]!);
  });

  it('opens report history and advances URL-backed pagination', async () => {
    renderWorkspace('/sites/site-1?tab=competitors&view=reports');
    await userEvent.click(await screen.findByRole('button', { name: /open report/i }));
    expect(screen.getByTestId('location')).toHaveTextContent(`report=${run.id}`);
    await screen.findByTestId('competitor-report-detail');
    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('cursor=next-page');
  });

  it('loads more report history without replacing prior rows', async () => {
    mocked.fetchLandscapeRuns
      .mockResolvedValueOnce({ items: [run], nextCursor: 'more' })
      .mockResolvedValueOnce({ items: [{ ...run, id: '64c64c64c64c64c64c64c64c' }], nextCursor: null });
    renderWorkspace('/sites/site-1?tab=competitors&view=reports');
    await userEvent.click(await screen.findByRole('button', { name: /load more reports/i }));
    await waitFor(() => expect(mocked.fetchLandscapeRuns).toHaveBeenCalledTimes(2));
  });

  it('persists every report filter and supports rollup, back, valid links, and empty evidence', async () => {
    const completeDetail: LandscapeDetail = {
      ...detail,
      items: [
        { ...detail.items[0]!, id: 'safe', ownedPosition: 3, ownedUrl: 'https://owned.example/page', competitorUrl: null, searchVolume: null },
      ],
      nextCursor: null,
      manifest: {
        ...detail.manifest!,
        provenance: [],
        pageSuggestions: [],
        opportunities: [],
      },
    };
    mocked.fetchLandscapeDetail.mockResolvedValue(completeDetail);
    renderWorkspace(`/sites/site-1?tab=competitors&view=reports&report=${run.id}`);
    expect(await screen.findByRole('link', { name: '#3' })).toHaveAttribute('href', 'https://owned.example/page');
    expect(screen.getByText(/no safe page match/i)).toBeInTheDocument();
    expect(screen.getByText(/no recommendation met/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^missing\s+1$/i }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('class=missing'));
    await userEvent.selectOptions(document.querySelector('#landscape-domain')!, 'one');
    await userEvent.type(screen.getByLabelText(/search keywords/i), 'query');
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('domain=one');
      expect(screen.getByTestId('location')).toHaveTextContent('q=query');
    });
    await userEvent.click(screen.getByRole('button', { name: /back to report history/i }));
    expect(screen.getByTestId('location')).not.toHaveTextContent('report=');
  });

  it('polls a running report, exposes cancellation, and reports an action failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const runningDetail = { ...detail, run: { ...run, state: 'collecting' as const } };
    mocked.fetchLandscapeDetail.mockResolvedValue(runningDetail);
    mocked.cancelLandscapeRun.mockRejectedValueOnce(new Error('cancel unavailable'));
    renderWorkspace(`/sites/site-1?tab=competitors&view=reports&report=${run.id}`);
    expect(await screen.findByText(/refresh automatically/i)).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(4000);
    await waitFor(() => expect(mocked.fetchLandscapeDetail).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: /cancel report/i }));
    await waitFor(() => {
      expect(screen.getAllByRole('alert').some((alert) => /could not complete/i.test(alert.textContent ?? ''))).toBe(true);
    });
    vi.useRealTimers();
  });

  it('shows detail failures and a no-match state for filtered empty rows', async () => {
    mocked.fetchLandscapeDetail.mockRejectedValueOnce(new Error('failed'));
    const failed = renderWorkspace(`/sites/site-1?tab=competitors&view=reports&report=${run.id}`);
    expect(await screen.findByText(/could not load this report/i)).toBeInTheDocument();
    failed.unmount();
    mocked.fetchLandscapeDetail.mockResolvedValueOnce({ ...detail, items: [], nextCursor: null });
    renderWorkspace(`/sites/site-1?tab=competitors&view=reports&report=${run.id}&q=none`);
    expect(await screen.findByText(/no matching keywords/i)).toBeInTheDocument();
  });

  it('shows stored report errors, partial coverage, null dates, and clears all filters', async () => {
    mocked.fetchLandscapeRuns.mockRejectedValueOnce(new Error('history unavailable'));
    const history = renderWorkspace('/sites/site-1?tab=competitors&view=reports');
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not complete/i);
    history.unmount();

    const partial = {
      ...detail,
      run: { ...run, state: 'partial' as const, createdAt: null as unknown as string },
    };
    mocked.fetchLandscapeDetail.mockResolvedValue(partial);
    renderWorkspace(`/sites/site-1?tab=competitors&view=reports&report=${run.id}&class=missing&domain=one&q=term`);
    expect(await screen.findByText(/1 of 1 competitors produced usable data/i)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/keyword class/i), '');
    await userEvent.selectOptions(document.querySelector('#landscape-domain')!, '');
    await userEvent.clear(screen.getByLabelText(/search keywords/i));
    await waitFor(() => {
      const value = screen.getByTestId('location').textContent ?? '';
      expect(value).not.toContain('class=');
      expect(value).not.toContain('domain=');
      expect(value).not.toContain('q=');
    });
  });

  it('keeps a running report without a manifest transparent while polling', async () => {
    mocked.fetchLandscapeDetail.mockResolvedValueOnce({
      ...detail, run: { ...run, state: 'queued' }, manifest: null, items: [], nextCursor: null,
    });
    renderWorkspace(`/sites/site-1?tab=competitors&view=reports&report=${run.id}`);
    expect(await screen.findByText(/refresh automatically/i)).toBeInTheDocument();
    expect(screen.queryByText(/no retained report data/i)).not.toBeInTheDocument();
  });

  it('keeps Arabic direction and loading labels available', async () => {
    await changeLanguage('ar');
    renderWorkspace('/sites/site-1?tab=competitors&view=overview');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(await screen.findByTestId('competitor-overview')).toBeInTheDocument();
  });

  it('treats missing discovery as an empty stored state instead of an error', async () => {
    mocked.fetchLatestDiscovery.mockRejectedValueOnce(new ApiError('missing', 404, undefined));
    renderWorkspace('/sites/site-1?tab=competitors&view=overview');
    expect(await screen.findByText(/no stored discovery suggestions yet/i)).toBeInTheDocument();
  });

  it('renders provider failures, empty reports, and transparent missing report data', async () => {
    mocked.fetchCompetitorProfiles.mockRejectedValueOnce(new Error('offline'));
    mocked.fetchLatestDiscovery.mockRejectedValueOnce(new Error('offline'));
    const failure = renderWorkspace('/sites/site-1?tab=competitors&view=overview');
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    failure.unmount();

    mocked.fetchLandscapeRuns.mockResolvedValueOnce({ items: [], nextCursor: null });
    const empty = renderWorkspace('/sites/site-1?tab=competitors&view=reports');
    expect(await screen.findByText(/no landscape reports/i)).toBeInTheDocument();
    empty.unmount();

    mocked.fetchLandscapeDetail.mockResolvedValueOnce({ ...detail, manifest: null, items: [], nextCursor: null });
    renderWorkspace(`/sites/site-1?tab=competitors&view=reports&report=${run.id}`);
    expect(await screen.findByText(/no retained report data/i)).toBeInTheDocument();
  });
});

describe('canonical competitor API wrappers', () => {
  it('uses the site-scoped authority, strict query params, and idempotency headers', async () => {
    const real = await vi.importActual<typeof import('./api')>('./api');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ items: [], nextCursor: null, run: {}, acceptance: {}, discovery: {}, profile: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const signal = new AbortController().signal;

    await real.fetchCompetitorProfiles('site/id', 'archived', signal);
    await real.addCompetitorProfile('site/id', { url: 'https://rival.example', source: 'manual' }, 'add-key');
    await real.changeCompetitorProfileStatus('site/id', 'profile/id', 'archive', 'archive-key');
    await real.previewDiscoverySpend('site/id');
    await real.fetchLatestDiscovery('site/id', signal);
    await real.refreshDiscovery('site/id', 'discovery-key');
    await real.previewLandscapeSpend('site/id', ['one']);
    await real.startLandscapeRun('site/id', { competitorProfileIds: ['one'], locale: 'en' }, 'run-key');
    await real.fetchLandscapeRuns('site/id', { state: 'partial', limit: 10, cursor: 'cursor', signal });
    await real.fetchLandscapeRuns('site/id');
    await real.fetchLandscapeDetail('site/id', 'run/id', {
      className: 'missing', competitor: 'one', q: 'term', limit: 10, cursor: 'cursor', signal,
    });
    await real.fetchLandscapeDetail('site/id', 'run/id');
    await real.cancelLandscapeRun('site/id', 'run/id', 'cancel-key');
    await real.acceptLandscapeRecommendation('site/id', 'run/id', 'op/id', 'accept-key');
    await real.reviewLandscapePageMatch(
      'site/id',
      'run/id',
      'suggestion/id',
      {
        decision: 'approved',
        ownedUrl: 'https://owned.example/page',
        competitorUrl: 'https://rival.example/page',
        version: 2,
      },
      'review-key',
    );

    const calls = fetchSpy.mock.calls.map(([input, init]) => ({ url: String(input), init }));
    const parsedBody = (path: string): unknown => {
      const call = calls.find(({ url, init }) => url.includes(path) && init?.body !== undefined);
      expect(call, `request for ${path}`).toBeDefined();
      expect(typeof call?.init?.body).toBe('string');
      return JSON.parse(call?.init?.body as string) as unknown;
    };
    expect(calls.some(({ url }) => url.includes('/sites/site%2Fid/competitor-intelligence/competitors?status=archived'))).toBe(true);
    expect(calls.some(({ url }) => url.includes('class=missing') && url.includes('competitor=one'))).toBe(true);
    expect(calls.some(({ init }) => new Headers(init?.headers).get('Idempotency-Key') === 'accept-key')).toBe(true);
    expect(calls.some(({ url, init }) =>
      url.includes('/page-matches/suggestion%2Fid') &&
      new Headers(init?.headers).get('Idempotency-Key') === 'review-key'
    )).toBe(true);
    expect(parsedBody('/competitor-intelligence/competitors')).toEqual({
      url: 'https://rival.example',
      source: 'manual',
    });
    expect(parsedBody('/discovery/preview')).toEqual({});
    expect(parsedBody('/landscapes/preview')).toEqual({ competitorProfileIds: ['one'] });
    expect(parsedBody('/page-matches/suggestion%2Fid')).toEqual({
      decision: 'approved',
      ownedUrl: 'https://owned.example/page',
      competitorUrl: 'https://rival.example/page',
      version: 2,
    });
  });
});

describe('competitor intelligence store failure and race handling', () => {
  it('keeps errors scoped to the active site and clears mutable UI state', async () => {
    const store = configureStore({ reducer: { competitors: competitorsReducer } });
    await store.dispatch(loadCompetitorPortfolio({ siteId: 'site-1' }));
    store.dispatch(toggleLandscapeProfile('one'));
    store.dispatch(toggleLandscapeProfile('one'));
    store.dispatch(toggleLandscapeProfile('one'));
    store.dispatch(clearLandscapePreview());
    store.dispatch(clearIntelligenceActionError());

    mocked.addCompetitorProfile.mockRejectedValueOnce(new Error('add failed'));
    mocked.changeCompetitorProfileStatus.mockRejectedValueOnce(new Error('mutate failed'));
    mocked.previewDiscoverySpend.mockRejectedValueOnce(new Error('preview failed'));
    mocked.refreshDiscovery.mockRejectedValueOnce(new Error('refresh failed'));
    mocked.previewLandscapeSpend.mockRejectedValueOnce(new Error('landscape preview failed'));
    mocked.startLandscapeRun.mockRejectedValueOnce(new Error('start failed'));
    mocked.fetchLandscapeRuns.mockRejectedValueOnce(new Error('runs failed'));
    mocked.fetchLandscapeDetail.mockRejectedValueOnce(new Error('detail failed'));
    mocked.cancelLandscapeRun.mockRejectedValueOnce(new Error('cancel failed'));
    mocked.acceptLandscapeRecommendation.mockRejectedValueOnce(new Error('accept failed'));

    await store.dispatch(addPortfolioCompetitor({ siteId: 'site-1', url: 'https://x.example', source: 'manual', idempotencyKey: 'a' }));
    await store.dispatch(mutatePortfolioCompetitor({ siteId: 'site-1', competitorId: 'one', action: 'archive', idempotencyKey: 'b' }));
    await store.dispatch(previewCompetitorDiscovery({ siteId: 'site-1' }));
    await store.dispatch(confirmCompetitorDiscovery({ siteId: 'site-1', idempotencyKey: 'c' }));
    await store.dispatch(previewCompetitorLandscape({ siteId: 'site-1', competitorProfileIds: ['one'] }));
    await store.dispatch(startCompetitorLandscape({ siteId: 'site-1', competitorProfileIds: ['one'], locale: 'en', idempotencyKey: 'd' }));
    await store.dispatch(loadCompetitorLandscapeRuns({ siteId: 'site-1' }));
    await store.dispatch(loadCompetitorLandscapeDetail({ siteId: 'site-1', runId: run.id }));
    await store.dispatch(cancelCompetitorLandscape({ siteId: 'site-1', runId: run.id, idempotencyKey: 'e' }));
    await store.dispatch(acceptCompetitorOpportunity({ siteId: 'site-1', runId: run.id, opportunityId: 'op', idempotencyKey: 'f' }));

    expect(store.getState().competitors.intelligence.actionError).toBeTruthy();
    const before = store.getState().competitors.intelligence;
    store.dispatch(loadCompetitorLandscapeRuns.fulfilled(
      { items: [{ ...run, siteId: 'other' }], nextCursor: null, append: false },
      'stale',
      { siteId: 'other' },
    ));
    expect(store.getState().competitors.intelligence.runs).toEqual(before.runs);
  });

  it('appends history, replaces portfolio rows, overlays acceptance, and updates cancellation', async () => {
    const store = configureStore({ reducer: { competitors: competitorsReducer } });
    await store.dispatch(loadCompetitorPortfolio({ siteId: 'site-1' }));
    mocked.addCompetitorProfile.mockResolvedValueOnce({ profile: profile('one'), duplicate: true });
    await store.dispatch(addPortfolioCompetitor({ siteId: 'site-1', url: 'https://one.example', source: 'suggested', idempotencyKey: 'a' }));
    mocked.fetchLandscapeRuns
      .mockResolvedValueOnce({ items: [run], nextCursor: 'more' })
      .mockResolvedValueOnce({ items: [{ ...run, id: '64c64c64c64c64c64c64c64c' }], nextCursor: null });
    await store.dispatch(loadCompetitorLandscapeRuns({ siteId: 'site-1' }));
    await store.dispatch(loadCompetitorLandscapeRuns({ siteId: 'site-1', cursor: 'more', append: true }));
    await store.dispatch(loadCompetitorLandscapeDetail({ siteId: 'site-1', runId: run.id }));
    await store.dispatch(acceptCompetitorOpportunity({ siteId: 'site-1', runId: run.id, opportunityId: 'opportunity-1', idempotencyKey: 'b' }));
    await store.dispatch(cancelCompetitorLandscape({ siteId: 'site-1', runId: run.id, idempotencyKey: 'c' }));
    expect(store.getState().competitors.intelligence.runs).toHaveLength(2);
    expect(store.getState().competitors.intelligence.detail?.manifest?.opportunities[0]?.acceptedActionId).toBe('action-1');
  });

  it('reduces every successful canonical workflow and prunes inactive selections', async () => {
    const store = configureStore({ reducer: { competitors: competitorsReducer } });
    await store.dispatch(loadCompetitorPortfolio({ siteId: 'site-1' }));
    store.dispatch(toggleLandscapeProfile('one'));
    store.dispatch(toggleLandscapeProfile('not-active'));
    await store.dispatch(loadCompetitorPortfolio({ siteId: 'site-1' }));
    store.dispatch(toggleLandscapeProfile('old'));
    mocked.changeCompetitorProfileStatus.mockResolvedValueOnce({ profile: profile('old', 'archived') });
    await store.dispatch(mutatePortfolioCompetitor({
      siteId: 'site-1', competitorId: 'old', action: 'archive', idempotencyKey: 'archive',
    }));
    await store.dispatch(loadCompetitorDiscovery({ siteId: 'site-1' }));
    await store.dispatch(previewCompetitorDiscovery({ siteId: 'site-1' }));
    await store.dispatch(confirmCompetitorDiscovery({ siteId: 'site-1', idempotencyKey: 'discovery' }));
    await store.dispatch(previewCompetitorLandscape({ siteId: 'site-1', competitorProfileIds: ['one'] }));
    await store.dispatch(startCompetitorLandscape({
      siteId: 'site-1', competitorProfileIds: ['one'], locale: 'en', idempotencyKey: 'start',
    }));
    mocked.addCompetitorProfile.mockResolvedValueOnce({ profile: profile('new'), duplicate: false });
    await store.dispatch(addPortfolioCompetitor({
      siteId: 'site-1', url: 'https://new.example', source: 'manual', idempotencyKey: 'add',
    }));
    mocked.changeCompetitorProfileStatus.mockResolvedValueOnce({ profile: profile('missing') });
    await store.dispatch(mutatePortfolioCompetitor({
      siteId: 'site-1', competitorId: 'missing', action: 'restore', idempotencyKey: 'restore',
    }));
    expect(store.getState().competitors.intelligence.selectedProfileIds).toEqual(['one']);
    expect(store.getState().competitors.intelligence.lastStartedRunId).toBe(run.id);
  });

  it('ignores fulfilled and rejected mutations that belong to another site', async () => {
    const store = configureStore({ reducer: { competitors: competitorsReducer } });
    await store.dispatch(loadCompetitorPortfolio({ siteId: 'site-1' }));
    const other = { siteId: 'site-other' };
    store.dispatch(addPortfolioCompetitor.fulfilled(
      { profile: profile('other'), duplicate: false }, '1',
      { ...other, url: 'https://other.example', source: 'manual', idempotencyKey: 'a' },
    ));
    store.dispatch(mutatePortfolioCompetitor.fulfilled(
      profile('other'), '2',
      { ...other, competitorId: 'other', action: 'archive', idempotencyKey: 'b' },
    ));
    store.dispatch(loadCompetitorDiscovery.fulfilled(discovery, '3', other));
    store.dispatch(previewCompetitorDiscovery.fulfilled({
      market: discovery.market, unitsRequired: 1, enabled: true, createsProfiles: false,
    }, '4', other));
    store.dispatch(confirmCompetitorDiscovery.fulfilled(
      { discovery, replayed: false }, '5', { ...other, idempotencyKey: 'c' },
    ));
    store.dispatch(previewCompetitorLandscape.fulfilled({
      competitorCount: 1, selected: [{ profileId: 'one', domain: 'one.example' }],
      competitorLimit: 10, market: discovery.market, unitsRequired: 1,
      maxRows: 1, enabled: true,
    }, '6', { ...other, competitorProfileIds: ['one'] }));
    store.dispatch(startCompetitorLandscape.fulfilled(
      { runId: run.id, state: 'queued', duplicate: false, reservedUnits: 1 }, '7',
      { ...other, competitorProfileIds: ['one'], locale: 'en', idempotencyKey: 'd' },
    ));
    store.dispatch(loadCompetitorLandscapeDetail.pending('8', { ...other, runId: run.id }));
    store.dispatch(loadCompetitorLandscapeDetail.fulfilled(detail, '9', { ...other, runId: run.id }));
    store.dispatch(cancelCompetitorLandscape.fulfilled(
      { ...run, state: 'cancelled' }, '10', { ...other, runId: run.id, idempotencyKey: 'e' },
    ));
    store.dispatch(acceptCompetitorOpportunity.fulfilled(
      { acceptanceId: 'accept', opportunityId: 'opportunity-1', actionId: 'action', replayed: false }, '11',
      { ...other, runId: run.id, opportunityId: 'opportunity-1', idempotencyKey: 'f' },
    ));
    store.dispatch(addPortfolioCompetitor.rejected(new Error('stale'), '12',
      { ...other, url: 'https://other.example', source: 'manual', idempotencyKey: 'a' }, 'stale'));
    store.dispatch(mutatePortfolioCompetitor.rejected(new Error('stale'), '13',
      { ...other, competitorId: 'other', action: 'archive', idempotencyKey: 'b' }, 'stale'));
    store.dispatch(loadCompetitorDiscovery.rejected(new Error('stale'), '14', other, 'stale'));
    store.dispatch(previewCompetitorDiscovery.rejected(new Error('stale'), '15', other, 'stale'));
    store.dispatch(confirmCompetitorDiscovery.rejected(new Error('stale'), '16',
      { ...other, idempotencyKey: 'c' }, 'stale'));
    store.dispatch(previewCompetitorLandscape.rejected(new Error('stale'), '17',
      { ...other, competitorProfileIds: ['one'] }, 'stale'));
    store.dispatch(startCompetitorLandscape.rejected(new Error('stale'), '18',
      { ...other, competitorProfileIds: ['one'], locale: 'en', idempotencyKey: 'd' }, 'stale'));
    store.dispatch(loadCompetitorLandscapeRuns.rejected(new Error('stale'), '19', other, 'stale'));
    store.dispatch(loadCompetitorLandscapeDetail.rejected(new Error('stale'), '20',
      { ...other, runId: run.id }, 'stale'));
    store.dispatch(cancelCompetitorLandscape.rejected(new Error('stale'), '21',
      { ...other, runId: run.id, idempotencyKey: 'e' }, 'stale'));
    store.dispatch(acceptCompetitorOpportunity.rejected(new Error('stale'), '22',
      { ...other, runId: run.id, opportunityId: 'opportunity-1', idempotencyKey: 'f' }, 'stale'));
    expect(store.getState().competitors.intelligence.siteId).toBe('site-1');
    expect(store.getState().competitors.intelligence.profiles.some((item) => item.id === 'other')).toBe(false);
  });

  it('handles payload-free reducer rejections and successful no-match updates defensively', async () => {
    const store = configureStore({ reducer: { competitors: competitorsReducer } });
    await store.dispatch(loadCompetitorPortfolio({ siteId: 'site-1' }));
    const site = { siteId: 'site-1' };
    store.dispatch(loadCompetitorPortfolio.rejected(new Error('x'), '1', site));
    store.dispatch(addPortfolioCompetitor.rejected(new Error('x'), '2',
      { ...site, url: 'https://x.example', source: 'manual', idempotencyKey: 'a' }));
    store.dispatch(mutatePortfolioCompetitor.rejected(new Error('x'), '3',
      { ...site, competitorId: 'none', action: 'restore', idempotencyKey: 'b' }));
    store.dispatch(loadCompetitorDiscovery.rejected(new Error('x'), '4', site));
    store.dispatch(previewCompetitorDiscovery.rejected(new Error('x'), '5', site));
    store.dispatch(confirmCompetitorDiscovery.rejected(new Error('x'), '6',
      { ...site, idempotencyKey: 'c' }));
    store.dispatch(previewCompetitorLandscape.rejected(new Error('x'), '7',
      { ...site, competitorProfileIds: ['one'] }));
    store.dispatch(startCompetitorLandscape.rejected(new Error('x'), '8',
      { ...site, competitorProfileIds: ['one'], locale: 'en', idempotencyKey: 'd' }));
    store.dispatch(loadCompetitorLandscapeRuns.rejected(new Error('x'), '9', site));
    store.dispatch(loadCompetitorLandscapeDetail.rejected(new Error('x'), '10',
      { ...site, runId: run.id }));
    store.dispatch(cancelCompetitorLandscape.rejected(new Error('x'), '11',
      { ...site, runId: run.id, idempotencyKey: 'e' }));
    store.dispatch(acceptCompetitorOpportunity.rejected(new Error('x'), '12',
      { ...site, runId: run.id, opportunityId: 'none', idempotencyKey: 'f' }));
    store.dispatch(cancelCompetitorLandscape.fulfilled(
      { ...run, id: 'not-stored', state: 'cancelled' }, '13',
      { ...site, runId: 'not-stored', idempotencyKey: 'g' },
    ));
    store.dispatch(acceptCompetitorOpportunity.fulfilled(
      { acceptanceId: 'accept', actionId: 'action', replayed: false, opportunityId: 'none' }, '14',
      { ...site, runId: run.id, opportunityId: 'none', idempotencyKey: 'h' },
    ));
    expect(store.getState().competitors.intelligence.actionError).toBe('');
  });

  it('rekeys immediately on a site switch and aborts stale reads', async () => {
    let resolve!: (value: { items: CompetitorProfile[] }) => void;
    mocked.fetchCompetitorProfiles.mockImplementationOnce(
      () => new Promise((done) => { resolve = done; }),
    );
    const store = configureStore({ reducer: { competitors: competitorsReducer } });
    const stale = store.dispatch(loadCompetitorPortfolio({ siteId: 'site-a' }));
    mocked.fetchCompetitorProfiles.mockResolvedValueOnce({ items: [profile('two')] });
    await store.dispatch(loadCompetitorPortfolio({ siteId: 'site-b' }));
    resolve({ items: [profile('one')] });
    await stale;
    expect(store.getState().competitors.intelligence.siteId).toBe('site-b');
    expect(store.getState().competitors.intelligence.profiles[0]?.id).toBe('two');

    const pending = store.dispatch(loadCompetitorDiscovery({ siteId: 'site-b' }));
    pending.abort();
    await pending;
    expect(store.getState().competitors.intelligence.discoveryError).toBe('');
  });
});
