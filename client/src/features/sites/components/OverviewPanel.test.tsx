import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type { CodeFixPromptInput } from '@shared/components/CodeFixPromptButton';
import { backlinksReducer, type BacklinkSummary } from '@features/backlinks';
import { competitorsReducer, type CompetitorsList } from '@features/competitors';
import { googleReducer, type GoogleConnection } from '@features/google';
import { ranksReducer, type Keyword } from '@features/ranks';
import {
  reportReducer,
  type AuditReport,
  type LocalizedFinding,
  type PublicAuditRun,
} from '@features/report';
import {
  actionsReducer,
  type ActionItem,
  type ActionSourceStatusEnvelope,
  type ActionsListStatus,
  type ListActionsResponse,
} from '@features/actions';
import { sitesReducer } from '../store/slice';
import { OverviewPanel } from './OverviewPanel';

const mocked = vi.hoisted(() => ({
  fetchLatestRunRequest: vi.fn(async () => {
    throw new Error('no run');
  }),
  fetchKeywordsRequest: vi.fn(async () => {
    throw new Error('no keywords');
  }),
  fetchBacklinkSummary: vi.fn(async () => {
    throw new Error('no backlinks');
  }),
  fetchCompetitors: vi.fn(async () => {
    throw new Error('competitor lookup must not run');
  }),
  getConnection: vi.fn(async () => {
    throw new Error('no connection');
  }),
  listActions: vi.fn(async (): Promise<ListActionsResponse> => {
    throw new Error('no actions');
  }),
  mutateActionState: vi.fn(async () => {
    throw new Error('overview must never mutate an action');
  }),
  retestAction: vi.fn(async () => {
    throw new Error('overview must never retest');
  }),
  getActionHistory: vi.fn(async () => {
    throw new Error('overview must never load history');
  }),
}));

vi.mock('@features/report/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/report/api')>()),
  fetchLatestRunRequest: mocked.fetchLatestRunRequest,
}));
vi.mock('@features/ranks/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/ranks/api')>()),
  fetchKeywordsRequest: mocked.fetchKeywordsRequest,
}));
vi.mock('@features/backlinks/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/backlinks/api')>()),
  fetchBacklinkSummary: mocked.fetchBacklinkSummary,
}));
vi.mock('@features/competitors/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/competitors/api')>()),
  fetchCompetitors: mocked.fetchCompetitors,
}));
vi.mock('@features/google/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/google/api')>()),
  getConnection: mocked.getConnection,
}));
vi.mock('@features/actions/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/actions/api')>()),
  listActions: mocked.listActions,
  mutateActionState: mocked.mutateActionState,
  retestAction: mocked.retestAction,
  getActionHistory: mocked.getActionHistory,
}));

vi.mock('@shared/components/CodeFixPromptButton', () => ({
  CodeFixPromptButton: ({ input }: { input: CodeFixPromptInput }) => (
    <button type="button" data-testid="code-fix-prompt" data-input={JSON.stringify(input)}>
      Copy code prompt
    </button>
  ),
}));

const finding = (
  ruleId: string,
  bucket: LocalizedFinding['bucket'],
  severity: LocalizedFinding['severity'],
  affectedCount: number,
): LocalizedFinding => ({
  ruleId,
  bucket,
  severity,
  affectedUrls: Array.from(
    { length: affectedCount },
    (_, index) => `https://example.com/${ruleId}/${index}`,
  ),
  copy: {
    titleKey: `auditRules.${ruleId}.title`,
    whyKey: `auditRules.${ruleId}.why`,
    fixKey: `auditRules.${ruleId}.fix`,
    passedLabelKey: `auditRules.${ruleId}.passedLabel`,
    title: `${ruleId} title`,
    why: `${ruleId} why`,
    fix: `${ruleId} fix`,
    passedLabel: `${ruleId} passed`,
  },
});

const richReport = (overrides: Partial<AuditReport> = {}): AuditReport => ({
  runId: 'run-1',
  counts: { fixNow: 3, watch: 15, passed: 8 },
  findings: [
    finding('site-wide', 'fix-now', 'critical', 0),
    finding('one-page', 'watch', 'warning', 1),
    finding('two-pages', 'fix-now', 'info', 2),
    finding('passing', 'passed', 'info', 0),
  ],
  diff: {
    entries: [],
    summary: { fixed: 0, regressed: 0, new: 0, unchanged: 0 },
  },
  pageSpeed: {
    status: 'ok',
    samples: [
      {
        url: 'https://example.com/desktop',
        strategy: 'desktop',
        labScores: {
          performance: 11,
          accessibility: 22,
          bestPractices: 33,
          seo: 44,
        },
        fieldDataLevel: 'none',
      },
      {
        url: 'https://example.com/mobile',
        strategy: 'mobile',
        labScores: {
          performance: 92,
          accessibility: 88,
          bestPractices: 96,
          seo: 100,
        },
        coreWebVitals: {
          lcpMs: 1_800,
          inp: 120,
          cls: 0.04,
          category: 'good',
        },
        fieldDataLevel: 'url',
      },
    ],
  },
  gscSearch: {
    status: 'ok',
    totalClicks: 3,
    totalImpressions: 364,
    averageCtr: 0.0082,
    averagePosition: 11.4,
    topQueries: [{ query: 'best example', clicks: 2, impressions: 100, ctr: 0.02, position: 4 }],
    topPages: [],
    delta: { clicks: 1, impressions: 20 },
  },
  ...overrides,
});

const actionItem = (id: string, overrides: Partial<ActionItem> = {}): ActionItem => ({
  id,
  siteId: 'site-1',
  sourceType: 'audit_finding',
  sourceId: `run-1:${id}`,
  sourceLink: '/sites/site-1?tab=report',
  problem: `${id} problem`,
  whyItMatters: `${id} why`,
  nextStep: `${id} next`,
  affectedUrls: [],
  evidence: [
    {
      sourceRef: `audit:${id}`,
      observation: { freshness: 'fresh', observedAt: '2026-07-15T00:00:00.000Z' },
    },
  ],
  severity: 'critical',
  firstPartyImpact: 'high',
  confidence: 'high',
  effort: 'low',
  state: 'open',
  version: 1,
  reappearedAfterFix: false,
  observedAt: '2026-07-15T00:00:00.000Z',
  lastVerifiedAt: null,
  retest: { available: true },
  ...overrides,
  copy: overrides.copy ?? {
    problem: { messageKey: `auditRules.${id}.title` },
    whyItMatters: { messageKey: `auditRules.${id}.why` },
    nextStep: { messageKey: `auditRules.${id}.fix` },
  },
});

const availableSources = (): ActionSourceStatusEnvelope => ({
  audit_finding: { status: 'available', lastObservedAt: '2026-07-15T00:00:00.000Z' },
  confirmed_rank_drop: { status: 'available' },
});

const keyword = (id: string, overrides: Partial<Keyword> = {}): Keyword => ({
  id,
  siteId: 'site-1',
  phrase: `keyword ${id}`,
  locationCode: 2840,
  languageCode: 'en',
  device: 'desktop',
  active: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  latestPosition: null,
  previousPosition: null,
  delta: null,
  lastCheckedAt: null,
  aiOverviewPresent: null,
  aiCited: null,
  aiCitedUrl: null,
  lastFailedCheckAt: null,
  lastFailedReason: null,
  engine: 'google',
  engineTarget: null,
  observationMeta: null,
  ...overrides,
});

const richKeywords = (): Keyword[] => [
  keyword('ranked', {
    phrase: 'ranked keyword',
    latestPosition: 1,
    previousPosition: 3,
    delta: 2,
    lastCheckedAt: '2026-07-15T00:00:00.000Z',
  }),
  keyword('failed', {
    phrase: 'failed keyword',
    lastFailedCheckAt: '2026-07-15T00:00:00.000Z',
  }),
  keyword('not-ranking', {
    phrase: 'not ranking keyword',
    lastCheckedAt: '2026-07-15T00:00:00.000Z',
  }),
  keyword('awaiting', { phrase: 'awaiting keyword' }),
  keyword('fifth', { phrase: 'hidden fifth keyword' }),
];

const richBacklinks = (overrides: Partial<BacklinkSummary> = {}): BacklinkSummary => ({
  domainRating: 51.5,
  backlinks: 1_234,
  referringDomains: 88,
  brokenBacklinks: 4,
  firstSeen: '2026-06-01T00:00:00.000Z',
  fetchedAt: '2026-07-15T00:00:00.000Z',
  cached: true,
  delta: {
    domainRating: 1.5,
    backlinks: 20,
    referringDomains: 3,
    brokenBacklinks: -2,
  },
  ...overrides,
});

const richCompetitors = (): CompetitorsList => ({
  target: 'example.com',
  fetchedAt: '2026-07-15T00:00:00.000Z',
  source: 'domain',
  competitors: Array.from({ length: 4 }, (_, index) => ({
    domain: `rival-${index + 1}.example`,
    avgPosition: index === 2 ? null : index + 2.5,
    intersections: index + 10,
    estimatedTraffic: null,
    fetchedAt: '2026-07-15T00:00:00.000Z',
  })),
});

const connectedGoogle = (): GoogleConnection => ({
  status: 'connected',
  googleAccountEmail: 'me@example.com',
  propertyUrl: 'https://example.com',
  scopes: [],
  connectedAt: '2026-07-01T00:00:00.000Z',
  lastUsedAt: null,
});

interface Preload {
  report?: AuditReport | null;
  reportLoaded?: boolean;
  reportLoading?: boolean;
  reportError?: string;
  reportRunStatus?: PublicAuditRun['status'] | null;
  reportSiteId?: string | null;
  keywords?: Keyword[];
  ranksLoaded?: boolean;
  ranksLoading?: boolean;
  ranksError?: string;
  ranksSiteId?: string | null;
  backlinks?: BacklinkSummary | null;
  backlinksLoaded?: boolean;
  backlinksLoading?: boolean;
  backlinksError?: string;
  backlinksSiteId?: string | null;
  competitors?: CompetitorsList | null;
  competitorsSiteId?: string | null;
  connection?: GoogleConnection | null;
  googleConnectionSiteId?: string | null;
  googleLoaded?: boolean;
  googleLoading?: boolean;
  actions?: ActionItem[];
  actionsStatus?: ActionsListStatus;
  actionsSiteId?: string | null;
  actionsSourceStatus?: ActionSourceStatusEnvelope;
}

const buildStore = (preloaded: Preload = {}) => {
  const report = Object.hasOwn(preloaded, 'report') ? preloaded.report : richReport();
  const keywords = preloaded.keywords ?? richKeywords();
  const backlinks = Object.hasOwn(preloaded, 'backlinks') ? preloaded.backlinks : richBacklinks();
  const competitors = Object.hasOwn(preloaded, 'competitors')
    ? preloaded.competitors
    : richCompetitors();
  const connection = Object.hasOwn(preloaded, 'connection')
    ? preloaded.connection
    : connectedGoogle();

  const sitesBase = sitesReducer(undefined, { type: '@@init' });
  const reportBase = reportReducer(undefined, { type: '@@init' });
  const ranksBase = ranksReducer(undefined, { type: '@@init' });
  const backlinksBase = backlinksReducer(undefined, { type: '@@init' });
  const competitorsBase = competitorsReducer(undefined, { type: '@@init' });
  const googleBase = googleReducer(undefined, { type: '@@init' });
  const actionsBase = actionsReducer(undefined, { type: '@@init' });

  return configureStore({
    reducer: {
      sites: sitesReducer,
      report: reportReducer,
      ranks: ranksReducer,
      backlinks: backlinksReducer,
      competitors: competitorsReducer,
      google: googleReducer,
      actions: actionsReducer,
    },
    preloadedState: {
      sites: { ...sitesBase, loaded: true },
      report: {
        ...reportBase,
        siteId: preloaded.reportSiteId ?? 'site-1',
        loaded: preloaded.reportLoaded ?? true,
        loading: preloaded.reportLoading ?? false,
        error: preloaded.reportError ?? '',
        report: report ?? null,
        runId: report?.runId ?? null,
        runStatus: preloaded.reportRunStatus ?? (report ? 'succeeded' : null),
      },
      ranks: {
        ...ranksBase,
        siteId: preloaded.ranksSiteId ?? 'site-1',
        loaded: preloaded.ranksLoaded ?? true,
        loading: preloaded.ranksLoading ?? false,
        error: preloaded.ranksError ?? '',
        items: keywords,
      },
      backlinks: {
        ...backlinksBase,
        siteId: preloaded.backlinksSiteId ?? 'site-1',
        loaded: preloaded.backlinksLoaded ?? true,
        loading: preloaded.backlinksLoading ?? false,
        error: preloaded.backlinksError ?? '',
        summary: backlinks ?? null,
      },
      competitors: {
        ...competitorsBase,
        siteId: preloaded.competitorsSiteId ?? 'site-1',
        loaded: competitors !== null,
        list: competitors ?? null,
      },
      google: {
        ...googleBase,
        connectionSiteId: Object.hasOwn(preloaded, 'googleConnectionSiteId')
          ? (preloaded.googleConnectionSiteId ?? null)
          : 'site-1',
        loaded: preloaded.googleLoaded ?? true,
        loading: preloaded.googleLoading ?? false,
        connection: connection ?? null,
      },
      actions: {
        ...actionsBase,
        siteId: Object.hasOwn(preloaded, 'actionsSiteId')
          ? (preloaded.actionsSiteId ?? null)
          : 'site-1',
        listStatus: preloaded.actionsStatus ?? 'ready',
        items: preloaded.actions ?? [
          actionItem('a1'),
          actionItem('a2', { state: 'planned' }),
          actionItem('a3', { sourceType: 'confirmed_rank_drop', sourceId: 'kw-1' }),
        ],
        sourceStatus: preloaded.actionsSourceStatus ?? availableSources(),
      },
    },
  });
};

const renderPanel = (store = buildStore(), siteId = 'site-1') =>
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/sites/${siteId}?tab=overview`]}>
          <OverviewPanel siteId={siteId} />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
});

describe('OverviewPanel', () => {
  it('shows prompts only for eligible action previews and preserves their context', () => {
    renderPanel(
      buildStore({
        actions: [
          actionItem('eligible', {
            state: 'dismissed',
            sourceLink: 'javascript:alert(1)',
            affectedUrls: ['https://example.com/a'],
            codeFixPrompt: {
              reference: 'canonical-missing-or-broken',
              recommendedFix: 'Repair the shared canonical output.',
              affectedUrlCount: 8,
            },
          }),
          actionItem('manual'),
        ],
      }),
    );
    const button = screen.getByTestId('code-fix-prompt');
    expect(JSON.parse(button.dataset.input ?? '')).toEqual({
      reference: 'canonical-missing-or-broken',
      severity: 'critical',
      confidence: 'high',
      problem: 'eligible problem',
      whyItMatters: 'eligible why',
      recommendedFix: 'Repair the shared canonical output.',
      affectedUrls: ['https://example.com/a'],
      affectedUrlCount: 8,
    });
    expect(screen.getAllByTestId('overview-action-item')).toHaveLength(2);
  });

  it('turns the latest audit and cached feature data into an action-first overview', () => {
    renderPanel();

    const actions = screen.getByTestId('overview-next-actions');
    expect(within(actions).getByText('3')).toBeInTheDocument();
    expect(within(actions).getByText('15')).toBeInTheDocument();
    expect(within(actions).getByText('8')).toBeInTheDocument();
    expect(screen.getAllByTestId('overview-action-item')).toHaveLength(3);
    expect(screen.getByText('a1 problem')).toBeInTheDocument();
    expect(screen.getByText('a2 problem')).toBeInTheDocument();
    expect(screen.getByText('a3 problem')).toBeInTheDocument();
    expect(screen.getAllByTestId('overview-action-link')[0]).toHaveAttribute(
      'href',
      '/sites/site-1?tab=report',
    );
    expect(screen.getByTestId('overview-actions-view-all')).toHaveAttribute(
      'href',
      '/sites/site-1?tab=actions',
    );
    expect(screen.getByTestId('overview-primary-action')).toHaveAttribute(
      'href',
      '/sites/site-1?tab=report&bucket=fix-now',
    );

    const search = screen.getByTestId('overview-search');
    expect(within(search).getByText('364')).toBeInTheDocument();
    expect(within(search).getByText('0.8%')).toBeInTheDocument();
    expect(within(search).getByText('11.4')).toBeInTheDocument();
    expect(within(search).getByText('best example')).toBeInTheDocument();

    const pageSpeed = screen.getByTestId('overview-pagespeed');
    expect(within(pageSpeed).getByText('92')).toBeInTheDocument();
    expect(within(pageSpeed).getByText('88')).toBeInTheDocument();
    expect(within(pageSpeed).queryByText('11')).not.toBeInTheDocument();
    expect(within(pageSpeed).getByText('Good')).toBeInTheDocument();

    const keywords = screen.getByTestId('overview-keywords');
    expect(within(keywords).getByText('#1')).toBeInTheDocument();
    expect(within(keywords).getByText('Check failed')).toBeInTheDocument();
    expect(within(keywords).getByText('Not in top 100')).toBeInTheDocument();
    expect(within(keywords).getAllByText('Awaiting first check')).toHaveLength(2);
    expect(within(keywords).queryByText('hidden fifth keyword')).not.toBeInTheDocument();

    const backlinks = screen.getByTestId('overview-backlinks');
    expect(within(backlinks).getByText('1,234')).toBeInTheDocument();
    expect(within(backlinks).getByText('51.5')).toBeInTheDocument();

    const competitors = screen.getByTestId('overview-competitors');
    expect(within(competitors).getByText('rival-1.example')).toBeInTheDocument();
    expect(within(competitors).getByText('rival-3.example')).toBeInTheDocument();
    expect(within(competitors).queryByText('rival-4.example')).not.toBeInTheDocument();
    expect(mocked.fetchCompetitors).not.toHaveBeenCalled();
  });

  it('explains a failed rank check with its plain-language reason', () => {
    renderPanel(buildStore({
      keywords: [keyword('failed-with-reason', {
        lastFailedCheckAt: '2026-07-15T00:00:00.000Z',
        lastFailedReason: 'vendor_timeout',
      })],
    }));
    expect(screen.getByText(/search data did not arrive in time/i)).toBeInTheDocument();
  });

  it('loads only non-spending overview reads and never calls the competitor API', async () => {
    renderPanel(
      buildStore({
        report: null,
        reportLoaded: false,
        keywords: [],
        ranksLoaded: false,
        backlinks: null,
        backlinksLoaded: false,
        competitors: null,
        connection: null,
        googleLoaded: false,
      }),
    );

    await waitFor(() => expect(mocked.fetchLatestRunRequest).toHaveBeenCalled());
    expect(mocked.fetchKeywordsRequest).toHaveBeenCalled();
    expect(mocked.fetchBacklinkSummary).toHaveBeenCalledWith(
      'site-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocked.getConnection).toHaveBeenCalled();
    expect(mocked.fetchCompetitors).not.toHaveBeenCalled();
  });

  it('does not refetch already-loaded slices', () => {
    renderPanel();
    expect(mocked.fetchLatestRunRequest).not.toHaveBeenCalled();
    expect(mocked.fetchKeywordsRequest).not.toHaveBeenCalled();
    expect(mocked.fetchBacklinkSummary).not.toHaveBeenCalled();
    expect(mocked.getConnection).not.toHaveBeenCalled();
    expect(mocked.fetchCompetitors).not.toHaveBeenCalled();
  });

  it('reloads site-scoped reads after switching sites but still reuses competitors only', async () => {
    const store = buildStore();
    const view = renderPanel(store);
    view.rerender(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/site-2?tab=overview']}>
            <OverviewPanel siteId="site-2" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );

    await waitFor(() =>
      expect(mocked.fetchLatestRunRequest).toHaveBeenCalledWith(
        'site-2',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    expect(mocked.fetchKeywordsRequest).toHaveBeenCalledWith(
      'site-2',
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocked.fetchBacklinkSummary).toHaveBeenCalledWith(
      'site-2',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocked.fetchCompetitors).not.toHaveBeenCalled();
  });

  it('shows the first-audit action when the site has no run', () => {
    renderPanel(buildStore({ report: null, reportRunStatus: null }));
    expect(screen.getByText('No audits yet')).toBeInTheDocument();
    expect(screen.getByTestId('overview-primary-action')).toHaveTextContent('Run your first audit');
  });

  it('shows audit progress while a run is queued or running', () => {
    renderPanel(buildStore({ report: null, reportRunStatus: 'running' }));
    expect(screen.getByText('Audit in progress')).toBeInTheDocument();
    expect(screen.getByTestId('overview-primary-action')).toHaveTextContent('View audit progress');
  });

  it('shows the true all-clear state only when actions are empty AND sources are healthy', () => {
    renderPanel(buildStore({ actions: [] }));
    expect(screen.getByText('No urgent fixes')).toBeInTheDocument();
    expect(screen.queryByTestId('overview-actions-unavailable')).not.toBeInTheDocument();
  });

  it('never celebrates all-clear while every source is unavailable', () => {
    renderPanel(
      buildStore({
        actions: [],
        actionsSourceStatus: {
          audit_finding: { status: 'unavailable' },
          confirmed_rank_drop: { status: 'unavailable' },
        },
      }),
    );
    expect(screen.getByTestId('overview-actions-unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No urgent fixes')).not.toBeInTheDocument();
  });

  it('shows a compact degraded warning when a source is stale but actions exist', () => {
    renderPanel(
      buildStore({
        actionsSourceStatus: {
          audit_finding: { status: 'available' },
          ga4_decline: { status: 'stale' },
        },
      }),
    );
    expect(screen.getByTestId('overview-actions-degraded')).toBeInTheDocument();
    expect(screen.getAllByTestId('overview-action-item')).toHaveLength(3);
  });

  it('bounds the list to five server-ordered items and never re-sorts', () => {
    renderPanel(
      buildStore({
        actions: [
          actionItem('z-last', { severity: 'info' }),
          actionItem('a-first', { severity: 'critical' }),
          actionItem('m-mid', { evidence: [] }),
          actionItem('b4'),
          actionItem('b5'),
          actionItem('b6-hidden'),
        ],
      }),
    );
    const items = screen.getAllByTestId('overview-action-item');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('z-last problem');
    expect(items[1]).toHaveTextContent('a-first problem');
    expect(screen.queryByText('b6-hidden problem')).not.toBeInTheDocument();
  });

  it('drops the primary item link when the server sourceLink fails revalidation', () => {
    renderPanel(
      buildStore({
        actions: [
          actionItem('external', { sourceLink: 'https://evil.example/phish' }),
          actionItem('schemeless', { sourceLink: '//evil.example/phish' }),
        ],
      }),
    );
    expect(screen.getAllByTestId('overview-action-item')).toHaveLength(2);
    expect(screen.queryByTestId('overview-action-link')).not.toBeInTheDocument();
  });

  it('loads the top five through the read-only actions list and nothing else', async () => {
    mocked.listActions.mockResolvedValueOnce({
      items: [actionItem('fetched')],
      sourceStatus: availableSources(),
      nextCursor: null,
    });
    renderPanel(buildStore({ actionsSiteId: null, actionsStatus: 'idle', actions: [] }));
    await waitFor(() => expect(mocked.listActions).toHaveBeenCalledTimes(1));
    expect(mocked.listActions).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 'site-1', limit: 5 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(await screen.findByText('fetched problem')).toBeInTheDocument();
    // No-spend proof: no mutation, retest, history, or competitor call fired.
    expect(mocked.mutateActionState).not.toHaveBeenCalled();
    expect(mocked.retestAction).not.toHaveBeenCalled();
    expect(mocked.getActionHistory).not.toHaveBeenCalled();
    expect(mocked.fetchCompetitors).not.toHaveBeenCalled();
  });

  it('does not request actions before a successful report exists', () => {
    renderPanel(buildStore({ report: null, reportRunStatus: null }));
    expect(mocked.listActions).not.toHaveBeenCalled();
  });

  it('refetches when the cached actions slice is idle even for the same site', async () => {
    mocked.listActions.mockResolvedValueOnce({
      items: [actionItem('idle-refetch')],
      sourceStatus: availableSources(),
      nextCursor: null,
    });
    renderPanel(buildStore({ actionsStatus: 'idle', actions: [] }));
    await waitFor(() => expect(mocked.listActions).toHaveBeenCalledTimes(1));
  });

  it('shows the actions loading skeleton and an error state with a scoped retry', async () => {
    const loadingView = renderPanel(buildStore({ actionsStatus: 'loading', actions: [] }));
    expect(screen.getByTestId('overview-actions-loading')).toBeInTheDocument();
    loadingView.unmount();

    mocked.listActions.mockResolvedValueOnce({
      items: [actionItem('recovered')],
      sourceStatus: availableSources(),
      nextCursor: null,
    });
    renderPanel(buildStore({ actionsStatus: 'error', actions: [] }));
    fireEvent.click(within(screen.getByTestId('overview-actions-error')).getByRole('button'));
    await waitFor(() => expect(mocked.listActions).toHaveBeenCalled());
  });

  it('shows loading placeholders without a premature primary action', () => {
    mocked.fetchLatestRunRequest.mockImplementationOnce(() => new Promise(() => undefined));
    mocked.fetchKeywordsRequest.mockImplementationOnce(() => new Promise(() => undefined));
    mocked.fetchBacklinkSummary.mockImplementationOnce(() => new Promise(() => undefined));
    mocked.getConnection.mockImplementationOnce(() => new Promise(() => undefined));
    renderPanel(
      buildStore({
        report: null,
        reportLoaded: false,
        reportLoading: true,
        keywords: [],
        ranksLoaded: false,
        ranksLoading: true,
        backlinks: null,
        backlinksLoaded: false,
        backlinksLoading: true,
        connection: null,
        googleLoaded: false,
        googleLoading: true,
      }),
    );
    expect(screen.queryByTestId('overview-primary-action')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);
  });

  it('offers scoped retries for report, keyword, and backlink read errors', () => {
    mocked.fetchLatestRunRequest.mockImplementationOnce(() => new Promise(() => undefined));
    mocked.fetchKeywordsRequest.mockImplementationOnce(() => new Promise(() => undefined));
    mocked.fetchBacklinkSummary.mockImplementationOnce(() => new Promise(() => undefined));
    renderPanel(
      buildStore({
        report: null,
        reportError: 'report failed',
        keywords: [],
        ranksError: 'ranks failed',
        backlinks: null,
        backlinksError: 'backlinks failed',
      }),
    );

    fireEvent.click(within(screen.getByTestId('overview-next-actions')).getByRole('button'));
    fireEvent.click(within(screen.getByTestId('overview-keywords')).getByRole('button'));
    fireEvent.click(within(screen.getByTestId('overview-backlinks')).getByRole('button'));
    expect(mocked.fetchLatestRunRequest).toHaveBeenCalled();
    expect(mocked.fetchKeywordsRequest).toHaveBeenCalled();
    expect(mocked.fetchBacklinkSummary).toHaveBeenCalled();
  });

  it.each([
    ['unavailable', null, 'Search data not available for this run'],
    ['needs-reconnect', null, 'Your Google connection needs to be renewed'],
    ['no-data', connectedGoogle(), 'No search data yet'],
    ['not-connected', null, 'Connect Google Search Console'],
  ] as const)(
    'renders the %s search state without loading another Google dataset',
    (status, connection, expected) => {
      const base = richReport().gscSearch;
      renderPanel(
        buildStore({
          report: richReport({
            gscSearch: base ? { ...base, status } : null,
          }),
          connection,
        }),
      );
      expect(within(screen.getByTestId('overview-search')).getByText(expected)).toBeInTheDocument();
    },
  );

  it('uses connection state when an older report has no GSC section', () => {
    const reconnecting = connectedGoogle();
    reconnecting.status = 'revoked';
    const first = renderPanel(
      buildStore({ report: richReport({ gscSearch: null }), connection: reconnecting }),
    );
    expect(screen.getByText('Your Google connection needs to be renewed')).toBeInTheDocument();
    first.unmount();

    renderPanel(buildStore({ report: richReport({ gscSearch: null }) }));
    expect(screen.getByText('No search data yet')).toBeInTheDocument();
  });

  it('handles an ok GSC snapshot without a top query', () => {
    const gscSearch = richReport().gscSearch;
    renderPanel(
      buildStore({
        report: richReport({
          gscSearch: gscSearch ? { ...gscSearch, topQueries: [] } : null,
        }),
      }),
    );
    expect(screen.queryByText('Top query')).not.toBeInTheDocument();
  });

  it.each([
    ['needs-improvement', 'Needs improvement', 'warning'],
    ['poor', 'Poor', 'destructive'],
  ] as const)('shows the %s Core Web Vitals state', (category, label, tone) => {
    const sample = richReport().pageSpeed?.samples[1];
    if (!sample?.coreWebVitals) throw new Error('fixture missing Core Web Vitals');
    renderPanel(
      buildStore({
        report: richReport({
          pageSpeed: {
            status: 'ok',
            samples: [
              {
                ...sample,
                coreWebVitals: { ...sample.coreWebVitals, category },
              },
            ],
          },
        }),
      }),
    );
    expect(screen.getByText(label)).toHaveAttribute('data-tone', tone);
  });

  it('falls back to the first PageSpeed sample and handles missing field data', () => {
    const desktop = richReport().pageSpeed?.samples[0];
    if (!desktop) throw new Error('fixture missing desktop sample');
    renderPanel(
      buildStore({
        report: richReport({
          pageSpeed: { status: 'ok', samples: [desktop] },
        }),
      }),
    );
    expect(within(screen.getByTestId('overview-pagespeed')).getByText('11')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('overview-pagespeed')).getByText('No data yet'),
    ).toBeInTheDocument();
  });

  it('renders the PageSpeed unavailable state when no usable sample exists', () => {
    renderPanel(
      buildStore({
        report: richReport({ pageSpeed: { status: 'unavailable', samples: [] } }),
      }),
    );
    expect(screen.getByText('Page speed data not available for this run')).toBeInTheDocument();
  });

  it('shows empty keyword and backlink states without inventing zeroes', () => {
    renderPanel(buildStore({ keywords: [], backlinks: null }));
    expect(screen.getByText('No keywords tracked yet')).toBeInTheDocument();
    expect(screen.getByText('No backlink snapshot yet')).toBeInTheDocument();
  });

  it('renders backlink values without deltas and tolerates nullable scores', () => {
    renderPanel(
      buildStore({
        backlinks: richBacklinks({ domainRating: null, delta: null }),
      }),
    );
    expect(within(screen.getByTestId('overview-backlinks')).getByText('—')).toBeInTheDocument();
  });

  it('does not show cached competitors from another site', () => {
    renderPanel(buildStore({ competitorsSiteId: 'site-2' }));
    expect(screen.getByText('Competitor data is ready on demand')).toBeInTheDocument();
    expect(screen.queryByText('rival-1.example')).not.toBeInTheDocument();
    expect(mocked.fetchCompetitors).not.toHaveBeenCalled();
  });

  it('formats metrics in the active locale', async () => {
    await changeLanguage('fr');
    renderPanel();
    expect(screen.getByTestId('overview-backlinks').textContent).toContain(
      new Intl.NumberFormat('fr').format(1_234),
    );
    expect(screen.getByTestId('overview-search').textContent).toContain(
      new Intl.NumberFormat('fr', {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(0.0082),
    );
  });

  it('uses a readable fallback for missing count and percentage values', () => {
    const gscSearch = richReport().gscSearch;
    renderPanel(
      buildStore({
        report: richReport({
          counts: {
            fixNow: null as unknown as number,
            watch: 0,
            passed: 0,
          },
          gscSearch: gscSearch
            ? {
                ...gscSearch,
                averageCtr: null as unknown as number,
              }
            : null,
        }),
      }),
    );
    expect(within(screen.getByTestId('overview-audit-counts')).getByText('—')).toBeInTheDocument();
    expect(within(screen.getByTestId('overview-search')).getByText('—')).toBeInTheDocument();
  });

  it('tolerates missing lazy report, backlink, and competitor slices on first render', () => {
    const minimalStore = configureStore({
      reducer: {
        sites: sitesReducer,
        ranks: ranksReducer,
        google: googleReducer,
      } as unknown as never,
      preloadedState: {
        sites: sitesReducer(undefined, { type: '@@init' }),
        ranks: { ...ranksReducer(undefined, { type: '@@init' }), loaded: true, siteId: 'site-1' },
        google: { ...googleReducer(undefined, { type: '@@init' }), loaded: true },
      } as unknown as never,
    });
    renderPanel(minimalStore as unknown as ReturnType<typeof buildStore>);
    expect(screen.getByTestId('overview-panel')).toBeInTheDocument();
  });
});
