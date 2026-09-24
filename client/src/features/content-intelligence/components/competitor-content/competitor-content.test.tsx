import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@shared/i18n/locales/en/contentIntelligence.json';
import { ApiError } from '@shared/api/client';
import type { LandscapeDetail } from '@features/competitors';
import { initialState } from '../../store/slice';
import type {
  CompetitorContentRun,
  CompetitorContentRunDetail,
  CompetitorContentRunPage,
  CompetitorDelta,
  CompetitorOpportunity,
  CompetitorPageFacts,
  CompetitorProfile,
  CompetitorSuggestion,
} from '../../types';

const hooks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
}));

const api = vi.hoisted(() => ({
  suggestCompetitors: vi.fn(),
  listCompetitors: vi.fn(),
  addCompetitor: vi.fn(),
  archiveCompetitor: vi.fn(),
  restoreCompetitor: vi.fn(),
  startCompetitorRun: vi.fn(),
  listCompetitorRuns: vi.fn(),
  getCompetitorRun: vi.fn(),
  cancelCompetitorRun: vi.fn(),
}));

const landscapeApi = vi.hoisted(() => ({
  fetchLandscapeDetail: vi.fn(),
  reviewLandscapePageMatch: vi.fn(),
}));

vi.mock('@shared/hooks/redux', () => ({
  useAppDispatch: () => hooks.dispatch,
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(hooks.state),
}));

vi.mock('../../api', () => api);
vi.mock('@features/competitors', () => landscapeApi);

import { competitorConfidenceTone, competitorStatusTone } from './status';
import { RunProgress } from './RunProgress';
import { OpportunityList } from './OpportunityList';
import { ComparisonOverview } from './ComparisonOverview';
import { PageDrilldown } from './PageDrilldown';
import { CompetitorManager } from './CompetitorManager';
import { RunSetupForm } from './RunSetupForm';
import { CompetitorContentPanel } from './CompetitorContentPanel';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', resources: { en: { contentIntelligence: en } } });

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function profile(overrides: Partial<CompetitorProfile> = {}): CompetitorProfile {
  return {
    id: 'p1',
    origin: 'https://rival.com',
    registrableDomain: 'rival.com',
    source: 'manual',
    status: 'active',
    createdAt: '2026-07-20T00:00:00Z',
    ...overrides,
  };
}

function suggestion(overrides: Partial<CompetitorSuggestion> = {}): CompetitorSuggestion {
  return {
    registrableDomain: 'rival.com',
    origin: 'https://rival.com',
    avgPosition: 3,
    intersections: 12,
    alreadyConfirmed: false,
    ...overrides,
  };
}

function facts(overrides: Partial<CompetitorPageFacts> = {}): CompetitorPageFacts {
  return {
    url: 'https://rival.com/page',
    role: 'competitor',
    competitorDomain: 'rival.com',
    statusCode: 200,
    title: 'Rival title',
    description: 'Rival description',
    headings: ['H1', 'H2'],
    wordCount: 900,
    schemaTypes: ['Article'],
    hasSchemaOrgArticle: true,
    internalLinkCount: 12,
    externalLinkCount: 4,
    contentHash: 'hash',
    primaryTopics: ['pricing'],
    secondaryTopics: ['plans'],
    snippet: 'A short evidence snippet.',
    ...overrides,
  };
}

function page(url: string, overrides: Partial<CompetitorPageFacts> = {}): CompetitorContentRunPage {
  const f = facts({ url, ...overrides });
  return { url, role: f.role, facts: f };
}

function delta(overrides: Partial<CompetitorDelta> = {}): CompetitorDelta {
  return {
    competitorDomain: 'rival.com',
    competitorUrl: 'https://rival.com/page',
    wordCountDelta: 200,
    headingCountDelta: 1,
    internalLinkDelta: -3,
    externalLinkDelta: 2,
    missingSchemaTypes: ['FAQPage'],
    missingTopics: ['comparison'],
    ownedOnlyTopics: ['brand'],
    sharedQueries: ['best tool'],
    snippetSourceId: 'snippet:rival.com',
    ...overrides,
  };
}

function opportunity(overrides: Partial<CompetitorOpportunity> = {}): CompetitorOpportunity {
  return {
    id: 'o1',
    kind: 'topic_gap',
    messageKey: 'contentIntelligence.competitorContent.opportunityCopy.topicGap',
    messageVars: { topic: 'comparison' },
    label: 'Cover the comparison topic',
    confidence: 'high',
    evidenceSourceIds: ['query:best tool'],
    ...overrides,
  };
}

function run(overrides: Partial<CompetitorContentRun> = {}): CompetitorContentRun {
  return {
    runId: 'r1',
    siteId: 's1',
    origin: 'https://example.com',
    ownedUrl: 'https://example.com/p',
    keyword: 'best tool',
    locale: 'en',
    status: 'completed',
    input: { competitorIds: ['p1'], competitorDomains: ['rival.com'], pageLimit: 15 },
    progress: {
      competitorsRequested: 2,
      competitorsProcessed: 2,
      competitorsFailed: 0,
      pagesScraped: 6,
    },
    warnings: [],
    error: null,
    thresholdsVersion: 'v',
    findings: null,
    reservation: { key: 'k', reservedUnits: 1, refundedUnits: 0, refundedAt: null, refundReason: null },
    costMicros: 0,
    aiCostMicros: 0,
    requestedAt: '2026-07-20T00:00:00Z',
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

function detail(overrides: Partial<CompetitorContentRunDetail> = {}): CompetitorContentRunDetail {
  return { ...run(), pages: [], ...overrides };
}

function findings(overrides: Partial<NonNullable<CompetitorContentRun['findings']>> = {}) {
  return {
    version: 'v',
    thresholdsVersion: 'v',
    ownedUrl: 'https://example.com/p',
    keyword: 'best tool',
    deltas: [delta()],
    opportunities: [opportunity()],
    partialDomains: [],
    aiExplanation: null as string | null,
    ...overrides,
  };
}

function landscapeDetail(
  overrides: Partial<NonNullable<LandscapeDetail['manifest']>['pageSuggestions'][number]> = {},
): LandscapeDetail {
  const pageSuggestion = {
    id: 'match-1',
    competitorProfileId: 'p1',
    ownedUrl: 'https://owned.example/article',
    competitorUrl: 'https://rival.example/article',
    keywordKeys: ['comparison keyword'],
    reasonCode: 'same_keyword',
    confidence: 'high' as const,
    review: {
      state: 'unreviewed' as const,
      ownedUrl: null,
      competitorUrl: null,
      version: 0,
      reviewedAt: null,
    },
    ...overrides,
  };
  return {
    run: {
      id: 'report-1',
      siteId: 's1',
      state: 'completed',
      ownedDomain: 'owned.example',
      locale: 'en',
      market: { locationCode: 2840, languageCode: 'en', source: 'default' },
      competitors: [{ profileId: 'p1', domain: 'rival.example' }],
      progress: { completedLegs: 1, totalLegs: 1, stage: 'completed' },
      reportVersion: 1,
      schemaVersion: 'competitor-landscape/1',
      taxonomyVersion: '2026-08-08.1',
      createdAt: '2026-08-09T00:00:00.000Z',
      startedAt: '2026-08-09T00:00:00.000Z',
      completedAt: '2026-08-09T00:01:00.000Z',
    },
    manifest: {
      ownedDomain: 'owned.example',
      locale: 'en',
      market: {
        locationCode: 2840,
        languageCode: 'en',
        source: 'default',
        eligibleTrackedKeywords: 0,
      },
      competitors: [{ profileId: 'p1', domain: 'rival.example' }],
      coverage: {
        requestedCompetitors: 1,
        usableCompetitors: 1,
        requestedLegs: 1,
        succeededLegs: 1,
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
      provenance: [],
      warnings: [],
      errors: [],
      pageSuggestions: [pageSuggestion],
      opportunities: [],
      sourceDates: [],
      rowCount: 1,
      completedAt: '2026-08-09T00:01:00.000Z',
    },
    items: [],
    nextCursor: null,
  };
}

// ---------------------------------------------------------------------------
// Store + router helpers
// ---------------------------------------------------------------------------

function setState(ccOverrides: Partial<typeof initialState.competitorContent> = {}) {
  hooks.state = {
    contentIntelligence: {
      ...initialState,
      siteId: 's1',
      competitorContent: { ...initialState.competitorContent, ...ccOverrides },
    },
  };
}

function installThunkDispatch() {
  hooks.dispatch.mockImplementation((action: unknown) => {
    if (typeof action === 'function') {
      return action(hooks.dispatch, () => hooks.state, undefined);
    }
    return action;
  });
}

function LocationDisplay() {
  const loc = useLocation();
  return <span data-testid="loc">{loc.search}</span>;
}

function renderInRouter(node: React.ReactNode, path = '/sites/s1?tab=content&view=competitors') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        {node}
        <LocationDisplay />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.useRealTimers();
  hooks.dispatch.mockReset();
  for (const mock of Object.values(api)) mock.mockReset();
  api.suggestCompetitors.mockResolvedValue({ suggestions: [] });
  api.listCompetitors.mockResolvedValue({ competitors: [] });
  api.addCompetitor.mockResolvedValue({ profile: profile(), duplicate: false });
  api.archiveCompetitor.mockResolvedValue({ profile: profile({ status: 'archived' }) });
  api.restoreCompetitor.mockResolvedValue({ profile: profile({ status: 'active' }) });
  api.startCompetitorRun.mockResolvedValue({ runId: 'newrun', status: 'queued', reservedUnits: 1, duplicate: false, message: 'ok' });
  api.listCompetitorRuns.mockResolvedValue({ items: [], nextCursor: null });
  api.getCompetitorRun.mockResolvedValue(detail());
  api.cancelCompetitorRun.mockResolvedValue({ ok: true });
  landscapeApi.fetchLandscapeDetail.mockReset();
  landscapeApi.reviewLandscapePageMatch.mockReset();
  landscapeApi.fetchLandscapeDetail.mockResolvedValue(landscapeDetail());
  landscapeApi.reviewLandscapePageMatch.mockResolvedValue({
    review: {
      state: 'approved',
      ownedUrl: 'https://owned.example/article',
      competitorUrl: 'https://rival.example/article',
      version: 1,
      reviewedAt: '2026-08-09T00:02:00.000Z',
    },
    replayed: false,
  });
  setState();
  installThunkDispatch();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// status.ts
// ---------------------------------------------------------------------------

describe('competitor status helpers', () => {
  it('maps every run status + confidence to a tone', () => {
    expect(competitorStatusTone('queued')).toBe('warning');
    expect(competitorStatusTone('collecting')).toBe('info');
    expect(competitorStatusTone('comparing')).toBe('info');
    expect(competitorStatusTone('completed')).toBe('success');
    expect(competitorStatusTone('partial')).toBe('warning');
    expect(competitorStatusTone('failed')).toBe('destructive');
    expect(competitorStatusTone('cancelled')).toBe('muted');
    expect(competitorConfidenceTone('high')).toBe('info');
    expect(competitorConfidenceTone('medium')).toBe('warning');
    expect(competitorConfidenceTone('low')).toBe('muted');
  });
});

// ---------------------------------------------------------------------------
// RunProgress
// ---------------------------------------------------------------------------

describe('RunProgress', () => {
  it('renders counters, warnings, error, and a cancel affordance', async () => {
    const onCancel = vi.fn();
    renderInRouter(
      <RunProgress
        run={run({
          status: 'collecting',
          progress: { competitorsRequested: 3, competitorsProcessed: 1, competitorsFailed: 1, pagesScraped: 4 },
          warnings: [
            { code: 'stoppedEarly', messageKey: 'x', message: 'Collection stopped early.' },
            { code: 'mysteryCode', messageKey: 'y', message: 'Mystery warning.' },
          ],
          error: { category: 'collection_failed', messageKey: 'k', retryable: false, terminal: true },
        })}
        onCancel={onCancel}
        cancelling={false}
      />,
    );
    expect(screen.getByTestId('competitor-progress-processed')).toHaveTextContent('1');
    expect(screen.getByTestId('competitor-progress-warnings')).toHaveTextContent('Mystery warning.');
    expect(screen.getByTestId('competitor-progress-error')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('competitor-progress-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('hides the cancel button on a terminal run and falls back on unknown error categories', () => {
    renderInRouter(
      <RunProgress
        run={run({
          status: 'completed',
          error: { category: 'mystery', messageKey: 'k', retryable: false, terminal: true },
        })}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('competitor-progress-cancel')).toBeNull();
    expect(screen.getByTestId('competitor-progress-error')).toHaveTextContent(
      'The run stopped before it finished.',
    );
  });

  it('renders without a cancel handler on a cancellable run', () => {
    renderInRouter(<RunProgress run={run({ status: 'queued' })} />);
    expect(screen.queryByTestId('competitor-progress-cancel')).toBeNull();
    expect(screen.queryByTestId('competitor-progress-warnings')).toBeNull();
    expect(screen.queryByTestId('competitor-progress-error')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// OpportunityList
// ---------------------------------------------------------------------------

describe('OpportunityList', () => {
  it('renders empty and populated states and a start-analysis deep link', async () => {
    const empty = renderInRouter(<OpportunityList opportunities={[]} onStartAnalysis={vi.fn()} />);
    expect(screen.getByTestId('competitor-opportunities-empty')).toBeInTheDocument();
    empty.unmount();

    const onStart = vi.fn();
    renderInRouter(
      <OpportunityList
        opportunities={[
          opportunity({ id: 'o1', kind: 'schema_gap', confidence: 'medium' }),
          opportunity({ id: 'o2', kind: 'differentiated_strength', confidence: 'low', evidenceSourceIds: [] }),
        ]}
        onStartAnalysis={onStart}
      />,
    );
    expect(screen.getByTestId('competitor-opportunity-o1')).toHaveTextContent('Cover the comparison topic');
    await userEvent.click(screen.getByTestId('competitor-start-analysis'));
    expect(onStart).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ComparisonOverview
// ---------------------------------------------------------------------------

describe('ComparisonOverview', () => {
  it('renders the empty state', () => {
    renderInRouter(<ComparisonOverview deltas={[]} partialDomains={[]} />);
    expect(screen.getByTestId('competitor-comparison-empty')).toBeInTheDocument();
  });

  it('renders partial domains, delta rows, and the em-dash for empty schema/topics', () => {
    renderInRouter(
      <ComparisonOverview
        deltas={[
          delta({ competitorDomain: 'rival.com', competitorUrl: 'https://rival.com/a' }),
          delta({
            competitorDomain: 'other.com',
            competitorUrl: 'https://other.com/b',
            wordCountDelta: -50,
            headingCountDelta: 0,
            internalLinkDelta: 0,
            externalLinkDelta: 0,
            missingSchemaTypes: [],
            missingTopics: [],
          }),
        ]}
        partialDomains={['blocked.com']}
      />,
    );
    expect(screen.getByTestId('competitor-partial-domains')).toHaveTextContent('blocked.com');
    expect(screen.getByTestId('competitor-delta-rival.com')).toHaveTextContent('+200');
    expect(screen.getByTestId('competitor-delta-other.com')).toHaveTextContent('-50');
  });

  it('filters by domain + dimension through the URL and clears on no-match', async () => {
    const user = userEvent.setup();
    renderInRouter(
      <ComparisonOverview
        deltas={[
          delta({ competitorDomain: 'rival.com', competitorUrl: 'https://rival.com/a', missingSchemaTypes: ['FAQPage'] }),
          delta({ competitorDomain: 'other.com', competitorUrl: 'https://other.com/b', missingSchemaTypes: [], missingTopics: [], wordCountDelta: 0, headingCountDelta: 0, internalLinkDelta: 0, externalLinkDelta: 0 }),
        ]}
        partialDomains={[]}
      />,
      '/sites/s1?ccDim=bogus',
    );
    // Invalid ccDim falls back to "all" → both rows visible.
    expect(screen.getAllByTestId(/competitor-delta-/)).toHaveLength(2);

    fireEvent.change(screen.getByTestId('competitor-filter-domain'), { target: { value: 'rival' } });
    expect(screen.getByTestId('loc').textContent).toContain('ccDomain=rival');
    expect(screen.getAllByTestId(/competitor-delta-/)).toHaveLength(1);

    // Dimension Select → schema only matches the first row.
    const combo = screen.getByTestId('competitor-filter-dimension');
    await user.click(combo);
    await user.click(screen.getByRole('option', { name: 'Structured data' }));
    expect(screen.getByTestId('loc').textContent).toContain('ccDim=schema');

    // Now filter to a domain with no schema gap → no-match + clear.
    fireEvent.change(screen.getByTestId('competitor-filter-domain'), { target: { value: 'other' } });
    expect(screen.getByTestId('competitor-comparison-nomatch')).toBeInTheDocument();
    await user.click(screen.getByTestId('competitor-comparison-clear'));
    expect(screen.getByTestId('loc').textContent).not.toContain('ccDomain=');
    expect(screen.getByTestId('loc').textContent).not.toContain('ccDim=');
  });

  it('covers each dimension filter branch', async () => {
    const user = userEvent.setup();
    renderInRouter(
      <ComparisonOverview deltas={[delta()]} partialDomains={[]} />,
    );
    const combo = screen.getByTestId('competitor-filter-dimension');
    for (const name of ['Content length', 'Structure', 'Links', 'Topics', 'All dimensions']) {
      await user.click(combo);
      await user.click(screen.getByRole('option', { name }));
    }
    expect(screen.getByTestId('competitor-delta-rival.com')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PageDrilldown
// ---------------------------------------------------------------------------

describe('PageDrilldown', () => {
  it('renders the empty state', () => {
    renderInRouter(<PageDrilldown pages={[]} />);
    expect(screen.getByTestId('competitor-drilldown-empty')).toBeInTheDocument();
  });

  it('renders untrusted snippets as text nodes and neutralizes unsafe hrefs', () => {
    const xss = '<script>alert(1)</script>';
    renderInRouter(
      <PageDrilldown
        pages={[
          page('https://example.com/owned', { role: 'owned', competitorDomain: null, title: null, primaryTopics: [], snippet: '' }),
          page('javascript:alert(1)', { role: 'competitor', title: 'Rival', snippet: xss }),
        ]}
      />,
    );
    // Owned page has no title/topics/snippet blocks.
    expect(screen.queryByTestId('competitor-page-topics-https://example.com/owned')).toBeNull();
    // The XSS snippet renders as plain text — no <script> element is created.
    const snippet = screen.getByTestId('competitor-page-snippet-javascript:alert(1)');
    expect(snippet).toHaveTextContent('<script>alert(1)</script>');
    expect(snippet.querySelector('script')).toBeNull();
    // The unsafe javascript: URL is neutralized to '#'.
    const link = screen.getByTestId('competitor-page-link-javascript:alert(1)');
    expect(link).toHaveAttribute('href', '#');
    expect(link).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    // A normal owned page keeps its safe href.
    expect(screen.getByTestId('competitor-page-link-https://example.com/owned'))
      .toHaveAttribute('href', 'https://example.com/owned');
  });
});

// ---------------------------------------------------------------------------
// CompetitorManager
// ---------------------------------------------------------------------------

describe('CompetitorManager', () => {
  it('shows loading skeletons then confirms a suggestion', async () => {
    setState({
      suggestionsLoading: true,
      profilesLoading: true,
    });
    const loading = renderInRouter(<CompetitorManager siteId="s1" />);
    expect(loading.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    loading.unmount();

    setState({
      suggestionsLoaded: true,
      suggestions: [suggestion(), suggestion({ registrableDomain: 'done.com', origin: 'https://done.com', alreadyConfirmed: true, avgPosition: null })],
      profilesLoaded: true,
    });
    renderInRouter(<CompetitorManager siteId="s1" />);
    expect(screen.getByTestId('competitor-confirmed-done.com')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('competitor-confirm-rival.com'));
    expect(api.addCompetitor).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 's1', url: 'https://rival.com', source: 'suggested' }),
      expect.anything(),
    );
  });

  it('renders suggestion + portfolio errors with retry and empty states', async () => {
    setState({ suggestionsLoaded: true, suggestionsError: 'sugg down', profilesLoaded: true, profilesError: 'port down' });
    renderInRouter(<CompetitorManager siteId="s1" />);
    expect(screen.getByTestId('competitor-suggestions-error')).toHaveTextContent('sugg down');
    expect(screen.getByTestId('competitor-portfolio-error')).toHaveTextContent('port down');
    await userEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]!);
    expect(api.suggestCompetitors).toHaveBeenCalled();
  });

  it('shows empty suggestion + portfolio states', () => {
    setState({ suggestionsLoaded: true, profilesLoaded: true });
    renderInRouter(<CompetitorManager siteId="s1" />);
    expect(screen.getByTestId('competitor-suggestions-empty')).toBeInTheDocument();
    expect(screen.getByTestId('competitor-portfolio-empty')).toBeInTheDocument();
  });

  it('validates the manual-add URL and submits a valid one', async () => {
    setState({ suggestionsLoaded: true, profilesLoaded: true });
    renderInRouter(<CompetitorManager siteId="s1" />);
    fireEvent.change(screen.getByTestId('competitor-manual-url'), { target: { value: 'not a url' } });
    fireEvent.submit(screen.getByTestId('competitor-manual-submit').closest('form')!);
    expect(await screen.findByTestId('competitor-manual-inline-error')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('competitor-manual-url'), { target: { value: 'https://new.com' } });
    fireEvent.submit(screen.getByTestId('competitor-manual-submit').closest('form')!);
    await waitFor(() =>
      expect(api.addCompetitor).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://new.com', source: 'manual' }),
        expect.anything(),
      ),
    );
  });

  it('accepts an http manual URL', async () => {
    setState({ suggestionsLoaded: true, profilesLoaded: true });
    renderInRouter(<CompetitorManager siteId="s1" />);
    fireEvent.change(screen.getByTestId('competitor-manual-url'), { target: { value: 'http://plain.com' } });
    fireEvent.submit(screen.getByTestId('competitor-manual-submit').closest('form')!);
    await waitFor(() =>
      expect(api.addCompetitor).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'http://plain.com', source: 'manual' }),
        expect.anything(),
      ),
    );
  });

  it('surfaces the add server error and clears it on edit', () => {
    setState({ suggestionsLoaded: true, profilesLoaded: true, addError: 'nope' });
    renderInRouter(<CompetitorManager siteId="s1" />);
    expect(screen.getByTestId('competitor-manual-server-error')).toHaveTextContent('nope');
    fireEvent.change(screen.getByTestId('competitor-manual-url'), { target: { value: 'https://x.com' } });
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'contentIntelligence/clearCompetitorAddError' }),
    );
  });

  it('blocks adding when the portfolio is full', () => {
    const full = Array.from({ length: 10 }, (_, i) => profile({ id: `p${i}`, registrableDomain: `c${i}.com` }));
    setState({ suggestionsLoaded: true, profilesLoaded: true, profiles: full });
    renderInRouter(<CompetitorManager siteId="s1" />);
    expect(screen.getByTestId('competitor-portfolio-full')).toBeInTheDocument();
    expect(screen.getByTestId('competitor-manual-submit')).toBeDisabled();
    // Submitting a valid URL while full surfaces the inline portfolio-full error.
    fireEvent.change(screen.getByTestId('competitor-manual-url'), { target: { value: 'https://new.com' } });
    fireEvent.submit(screen.getByTestId('competitor-manual-submit').closest('form')!);
    expect(screen.getByTestId('competitor-manual-inline-error')).toBeInTheDocument();
  });

  it('no-ops a manual submit while an add is already in flight', () => {
    setState({ suggestionsLoaded: true, profilesLoaded: true, addingKey: 'https://busy.com' });
    renderInRouter(<CompetitorManager siteId="s1" />);
    fireEvent.change(screen.getByTestId('competitor-manual-url'), { target: { value: 'https://new.com' } });
    fireEvent.submit(screen.getByTestId('competitor-manual-submit').closest('form')!);
    expect(api.addCompetitor).not.toHaveBeenCalled();
  });

  it('skips the reload when an add is rejected (confirm + manual)', async () => {
    setState({ suggestionsLoaded: true, suggestions: [suggestion()], profilesLoaded: true });
    api.addCompetitor.mockRejectedValue(new Error('boom'));
    renderInRouter(<CompetitorManager siteId="s1" />);
    await userEvent.click(screen.getByTestId('competitor-confirm-rival.com'));
    await waitFor(() => expect(api.addCompetitor).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('competitor-manual-url'), { target: { value: 'https://new.com' } });
    fireEvent.submit(screen.getByTestId('competitor-manual-submit').closest('form')!);
    await waitFor(() => expect(api.addCompetitor).toHaveBeenCalledTimes(2));
  });

  it('lists the portfolio with provenance and toggles archive/restore', async () => {
    setState({
      suggestionsLoaded: true,
      profilesLoaded: true,
      profiles: [
        profile({ id: 'p1', registrableDomain: 'active.com', source: 'suggested', status: 'active' }),
        profile({ id: 'p2', registrableDomain: 'archived.com', source: 'manual', status: 'archived' }),
      ],
      mutateError: 'mutate boom',
    });
    renderInRouter(<CompetitorManager siteId="s1" />);
    expect(screen.getByTestId('competitor-portfolio-mutate-error')).toHaveTextContent('mutate boom');
    await userEvent.click(screen.getByTestId('competitor-toggle-p1'));
    expect(api.archiveCompetitor).toHaveBeenCalledWith('s1', 'p1', expect.anything());
    await userEvent.click(screen.getByTestId('competitor-toggle-p2'));
    expect(api.restoreCompetitor).toHaveBeenCalledWith('s1', 'p2', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// RunSetupForm
// ---------------------------------------------------------------------------

describe('RunSetupForm', () => {
  it('loads, approves, and starts a reviewed landscape page match', async () => {
    const user = userEvent.setup();
    const onStarted = vi.fn();
    renderInRouter(
      <RunSetupForm siteId="s1" onStarted={onStarted} />,
      '/sites/s1?tab=content&view=competitors&landscapeReport=report-1&match=match-1&opportunity=opportunity-1',
    );

    expect(await screen.findByTestId('competitor-reviewed-run-setup')).toBeInTheDocument();
    const suggested = await screen.findByRole('link', { name: /open suggested/i });
    expect(suggested).toHaveAttribute('href', 'https://rival.example/article');
    expect(suggested).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    const keyword = screen.getByLabelText(/focus keyword/i);
    await user.clear(keyword);
    await user.type(keyword, ' updated comparison ');

    await user.click(screen.getByRole('button', { name: /review cost and confirm/i }));
    await user.click(screen.getByRole('button', { name: /^confirm and start$/i }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('newrun'));

    expect(landscapeApi.reviewLandscapePageMatch).toHaveBeenCalledWith(
      's1',
      'report-1',
      'match-1',
      {
        decision: 'approved',
        ownedUrl: 'https://owned.example/article',
        competitorUrl: 'https://rival.example/article',
        version: 0,
      },
      expect.stringMatching(/^content-review-match-1-/),
    );
    expect(api.startCompetitorRun).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 's1',
        competitorIds: [],
        reviewedPageMatches: [{
          landscapeReportId: 'report-1',
          landscapeOpportunityId: 'opportunity-1',
          suggestionId: 'match-1',
        }],
        keyword: 'updated comparison',
        pageLimit: 1,
        locale: 'en',
        clientKey: expect.stringMatching(/^cc-/),
      }),
      expect.anything(),
    );
  });

  it('uses reviewed URL overrides and omits blank optional launch fields', async () => {
    const user = userEvent.setup();
    landscapeApi.fetchLandscapeDetail.mockResolvedValue(
      landscapeDetail({
        keywordKeys: [],
        review: {
          state: 'approved',
          ownedUrl: 'http://owned.example/reviewed',
          competitorUrl: 'http://rival.example/reviewed',
          version: 4,
          reviewedAt: '2026-08-09T00:02:00.000Z',
        },
      }),
    );
    renderInRouter(
      <RunSetupForm siteId="s1" />,
      '/sites/s1?landscapeReport=report-1&match=match-1',
    );

    expect(await screen.findByDisplayValue('http://owned.example/reviewed')).toBeInTheDocument();
    expect(screen.getByDisplayValue('http://rival.example/reviewed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /review cost and confirm/i }));
    await user.click(screen.getByRole('button', { name: /^confirm and start$/i }));
    await waitFor(() => expect(api.startCompetitorRun).toHaveBeenCalled());
    expect(api.startCompetitorRun).toHaveBeenCalledWith(
      expect.not.objectContaining({ keyword: expect.anything() }),
      expect.anything(),
    );
    expect(api.startCompetitorRun).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewedPageMatches: [{ landscapeReportId: 'report-1', suggestionId: 'match-1' }],
      }),
      expect.anything(),
    );
    expect(landscapeApi.reviewLandscapePageMatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ version: 4 }),
      expect.anything(),
    );
  });

  it('renders safe loading, missing-suggestion, and unsafe-link states', async () => {
    let resolveLoad: (value: LandscapeDetail) => void = () => undefined;
    landscapeApi.fetchLandscapeDetail.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const loading = renderInRouter(
      <RunSetupForm siteId="s1" />,
      '/sites/s1?landscapeReport=report-1&match=match-1',
    );
    expect(screen.getByText(/loading the reviewed page match/i)).toHaveAttribute('aria-busy', 'true');
    resolveLoad(landscapeDetail({ competitorUrl: 'javascript:alert(1)' }));
    expect(await screen.findByText('javascript:alert(1)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open suggested/i })).not.toBeInTheDocument();
    loading.unmount();

    landscapeApi.fetchLandscapeDetail.mockResolvedValue({
      ...landscapeDetail(),
      manifest: null,
    });
    renderInRouter(
      <RunSetupForm siteId="s1" />,
      '/sites/s1?landscapeReport=report-1&match=match-1',
    );
    expect(await screen.findByText(/reviewed page match is no longer available/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /review cost and confirm/i })).not.toBeInTheDocument();
  });

  it('surfaces Error and fallback landscape-load failures', async () => {
    landscapeApi.fetchLandscapeDetail.mockRejectedValueOnce(new Error('landscape unavailable'));
    const first = renderInRouter(
      <RunSetupForm siteId="s1" />,
      '/sites/s1?landscapeReport=report-1&match=match-1',
    );
    expect(await screen.findByText('landscape unavailable')).toBeInTheDocument();
    first.unmount();

    landscapeApi.fetchLandscapeDetail.mockRejectedValueOnce('offline');
    renderInRouter(
      <RunSetupForm siteId="s1" />,
      '/sites/s1?landscapeReport=report-1&match=match-1',
    );
    expect(await screen.findByText(/reviewed page match could not be loaded/i)).toBeInTheDocument();
  });

  it('ignores a landscape rejection after the reviewed form unmounts', async () => {
    let rejectLoad: (cause: unknown) => void = () => undefined;
    landscapeApi.fetchLandscapeDetail.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      }),
    );
    const view = renderInRouter(
      <RunSetupForm siteId="s1" />,
      '/sites/s1?landscapeReport=report-1&match=match-1',
    );
    await screen.findByText(/loading the reviewed page match/i);
    view.unmount();
    await act(async () => {
      rejectLoad(new Error('late failure'));
      await Promise.resolve();
    });
  });

  it('rechecks disabled state when a reviewed confirmation is already open', async () => {
    const user = userEvent.setup();
    const path = '/sites/s1?landscapeReport=report-1&match=match-1';
    const view = renderInRouter(<RunSetupForm siteId="s1" />, path);
    await screen.findByDisplayValue('https://owned.example/article');
    await user.click(screen.getByRole('button', { name: /review cost and confirm/i }));

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <RunSetupForm siteId="s1" disabled />
          <LocationDisplay />
        </MemoryRouter>
      </I18nextProvider>,
    );
    await user.click(screen.getByRole('button', { name: /^confirm and start$/i }));
    expect(landscapeApi.reviewLandscapePageMatch).not.toHaveBeenCalled();
  });

  it('does not notify a reviewed start callback when enqueue rejects', async () => {
    const user = userEvent.setup();
    const onStarted = vi.fn();
    api.startCompetitorRun.mockRejectedValueOnce(new Error('enqueue failed'));
    renderInRouter(
      <RunSetupForm siteId="s1" onStarted={onStarted} />,
      '/sites/s1?landscapeReport=report-1&match=match-1',
    );
    await screen.findByDisplayValue('https://owned.example/article');
    await user.click(screen.getByRole('button', { name: /review cost and confirm/i }));
    await user.click(screen.getByRole('button', { name: /^confirm and start$/i }));
    await waitFor(() => expect(api.startCompetitorRun).toHaveBeenCalled());
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('validates reviewed URLs and clears review errors when either URL changes', async () => {
    const user = userEvent.setup();
    landscapeApi.reviewLandscapePageMatch.mockRejectedValueOnce(
      new ApiError('review conflict', 409, { error: { message: 'review conflict' } }),
    );
    renderInRouter(
      <RunSetupForm siteId="s1" />,
      '/sites/s1?landscapeReport=report-1&match=match-1',
    );
    await screen.findByDisplayValue('https://owned.example/article');

    await user.click(screen.getByRole('button', { name: /review cost and confirm/i }));
    await user.click(screen.getByRole('button', { name: /^confirm and start$/i }));
    expect(await screen.findByText('review conflict')).toBeInTheDocument();

    const owned = screen.getByLabelText(/your page URL/i);
    await user.clear(owned);
    await user.type(owned, 'ftp://owned.example/article');
    expect(screen.queryByText('review conflict')).not.toBeInTheDocument();
    expect(owned).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/valid page URL that starts with http or https/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /review cost and confirm/i })).toBeDisabled();

    await user.clear(owned);
    await user.type(owned, 'https://owned.example/new');
    const competitor = screen.getByLabelText(/competitor ranking page/i);
    await user.clear(competitor);
    await user.type(competitor, 'not a url');
    expect(competitor).toHaveAttribute('aria-invalid', 'true');
    await user.clear(competitor);
    await user.type(competitor, 'https://rival.example/new');
    expect(screen.queryByText(/valid page URL that starts with http or https/i)).not.toBeInTheDocument();
  });

  it('shows server submit errors and disables reviewed actions while blocked or busy', async () => {
    setState({ submitError: 'Capacity reached' });
    const blocked = renderInRouter(
      <RunSetupForm siteId="s1" disabled />,
      '/sites/s1?landscapeReport=report-1&match=match-1',
    );
    expect(await screen.findByText('Capacity reached')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /review cost and confirm/i })).toBeDisabled();
    blocked.unmount();

    setState({ submitting: true });
    renderInRouter(
      <RunSetupForm siteId="s1" />,
      '/sites/s1?landscapeReport=report-1&match=match-1',
    );
    expect(await screen.findByRole('button', { name: /review cost and confirm/i })).toBeDisabled();
  });

  it('shows the no-competitors empty state', () => {
    setState({ profiles: [] });
    renderInRouter(<RunSetupForm siteId="s1" />);
    expect(screen.getByTestId('competitor-run-no-competitors')).toBeInTheDocument();
  });

  it('selects a competitor, shows the live disclosure, and submits', async () => {
    setState({ profiles: [profile({ id: 'p1', registrableDomain: 'rival.com' })] });
    const onStarted = vi.fn();
    renderInRouter(<RunSetupForm siteId="s1" onStarted={onStarted} />);
    await userEvent.click(screen.getByTestId('competitor-select-p1'));
    fireEvent.change(screen.getByTestId('competitor-url-p1'), { target: { value: 'https://rival.com/ranking-page' } });
    fireEvent.change(screen.getByTestId('competitor-run-owned-url'), { target: { value: 'https://example.com/p' } });
    fireEvent.change(screen.getByTestId('competitor-run-keyword'), { target: { value: ' best tool ' } });
    expect(screen.getByTestId('competitor-run-disclosure')).toHaveTextContent('1 competitor');
    fireEvent.submit(screen.getByTestId('competitor-run-submit').closest('form')!);
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('newrun'));
    expect(api.startCompetitorRun).toHaveBeenCalledWith(
      expect.objectContaining({ competitorIds: ['p1'], ownedUrl: 'https://example.com/p', keyword: 'best tool' }),
      expect.anything(),
    );
  });

  it('submits without a keyword using an http URL', async () => {
    setState({ profiles: [profile({ id: 'p1' })] });
    const onStarted = vi.fn();
    renderInRouter(<RunSetupForm siteId="s1" onStarted={onStarted} />);
    await userEvent.click(screen.getByTestId('competitor-select-p1'));
    fireEvent.change(screen.getByTestId('competitor-url-p1'), { target: { value: 'http://rival.test/ranking-page' } });
    fireEvent.change(screen.getByTestId('competitor-run-owned-url'), { target: { value: 'http://example.com/p' } });
    fireEvent.submit(screen.getByTestId('competitor-run-submit').closest('form')!);
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('newrun'));
    expect(api.startCompetitorRun).toHaveBeenCalledWith(
      expect.not.objectContaining({ keyword: expect.anything() }),
      expect.anything(),
    );
  });

  it('surfaces client-side validation branches', async () => {
    setState({ profiles: [profile({ id: 'p1' })] });
    renderInRouter(<RunSetupForm siteId="s1" />);
    // No selection → noSelection error (submit through the form).
    fireEvent.submit(screen.getByTestId('competitor-run-submit').closest('form')!);
    expect(await screen.findByTestId('competitor-run-inline-error')).toHaveTextContent(
      'Choose at least one competitor',
    );
    // Select + invalid URL → invalidUrl error.
    await userEvent.click(screen.getByTestId('competitor-select-p1'));
    fireEvent.submit(screen.getByTestId('competitor-run-submit').closest('form')!);
    expect(await screen.findByText(/valid page URL/i)).toBeInTheDocument();
    // Valid URL, invalid page limit → disclosureInvalid + pageLimitRange.
    fireEvent.change(screen.getByTestId('competitor-url-p1'), { target: { value: 'https://rival.test/ranking-page' } });
    fireEvent.change(screen.getByTestId('competitor-run-owned-url'), { target: { value: 'https://example.com/p' } });
    fireEvent.change(screen.getByTestId('competitor-run-page-limit'), { target: { value: '0' } });
    expect(screen.getByTestId('competitor-run-disclosure')).toHaveTextContent('valid page count');
    fireEvent.submit(screen.getByTestId('competitor-run-submit').closest('form')!);
    expect(await screen.findByText(/within the allowed range/i)).toBeInTheDocument();
    expect(api.startCompetitorRun).not.toHaveBeenCalled();
  });

  it('rejects an invalid selected competitor URL and clears it when deselected', async () => {
    setState({ profiles: [profile({ id: 'p1' })] });
    renderInRouter(<RunSetupForm siteId="s1" />);
    await userEvent.click(screen.getByTestId('competitor-select-p1'));
    fireEvent.change(screen.getByTestId('competitor-url-p1'), { target: { value: 'javascript:bad' } });
    fireEvent.change(screen.getByTestId('competitor-run-owned-url'), { target: { value: 'https://example.com/p' } });
    fireEvent.submit(screen.getByTestId('competitor-run-submit').closest('form')!);
    expect(await screen.findByText(/explicit ranking-page URL/i)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('competitor-select-p1'));
    expect(screen.queryByTestId('competitor-url-p1')).not.toBeInTheDocument();
  });

  it('rejects a selected competitor whose ranking-page URL is still empty', async () => {
    setState({ profiles: [profile({ id: 'p1' })] });
    renderInRouter(<RunSetupForm siteId="s1" />);
    await userEvent.click(screen.getByTestId('competitor-select-p1'));
    fireEvent.change(screen.getByTestId('competitor-run-owned-url'), {
      target: { value: 'https://example.com/p' },
    });
    fireEvent.submit(screen.getByTestId('competitor-run-submit').closest('form')!);
    expect(await screen.findByText(/explicit ranking-page URL/i)).toBeInTheDocument();
  });

  it('rejects selecting more than the maximum competitors', async () => {
    const many = Array.from({ length: 11 }, (_, i) => profile({ id: `p${i}`, registrableDomain: `c${i}.com` }));
    setState({ profiles: many });
    renderInRouter(<RunSetupForm siteId="s1" />);
    for (let i = 0; i < 11; i++) {
      await userEvent.click(screen.getByTestId(`competitor-select-p${i}`));
    }
    fireEvent.change(screen.getByTestId('competitor-run-owned-url'), { target: { value: 'https://example.com/p' } });
    fireEvent.submit(screen.getByTestId('competitor-run-submit').closest('form')!);
    expect(await screen.findByText(/no more than the allowed/i)).toBeInTheDocument();
  });

  it('shows the in-flight note + disabled submit and the server error alert', () => {
    setState({ profiles: [profile({ id: 'p1' })], submitError: 'Could not start' });
    const view = renderInRouter(<RunSetupForm siteId="s1" disabled />);
    expect(screen.getByTestId('competitor-run-in-flight')).toBeInTheDocument();
    expect(screen.getByTestId('competitor-run-server-error')).toHaveTextContent('Could not start');
    expect(screen.getByTestId('competitor-run-server-error')).toHaveClass('text-destructive');
    // A disabled form no-ops on submit.
    fireEvent.submit(screen.getByTestId('competitor-run-submit').closest('form')!);
    expect(api.startCompetitorRun).not.toHaveBeenCalled();
    view.unmount();
    // Editing a field clears the submit error.
    setState({ profiles: [profile({ id: 'p1' })], submitError: 'boom' });
    renderInRouter(<RunSetupForm siteId="s1" />);
    fireEvent.change(screen.getByTestId('competitor-run-owned-url'), { target: { value: 'https://x' } });
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'contentIntelligence/clearCompetitorSubmitError' }),
    );
  });

  it('renders the busy submit state', () => {
    setState({ profiles: [profile({ id: 'p1' })], submitting: true });
    renderInRouter(<RunSetupForm siteId="s1" />);
    expect(screen.getByTestId('competitor-run-submit')).toHaveAttribute('aria-busy', 'true');
  });

  it('does not call onStarted when the run start is rejected', async () => {
    setState({ profiles: [profile({ id: 'p1' })] });
    api.startCompetitorRun.mockRejectedValueOnce(new Error('boom'));
    const onStarted = vi.fn();
    renderInRouter(<RunSetupForm siteId="s1" onStarted={onStarted} />);
    await userEvent.click(screen.getByTestId('competitor-select-p1'));
    fireEvent.change(screen.getByTestId('competitor-url-p1'), { target: { value: 'https://rival.test/ranking-page' } });
    fireEvent.change(screen.getByTestId('competitor-run-owned-url'), { target: { value: 'https://example.com/p' } });
    fireEvent.submit(screen.getByTestId('competitor-run-submit').closest('form')!);
    await waitFor(() => expect(api.startCompetitorRun).toHaveBeenCalled());
    expect(onStarted).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CompetitorContentPanel
// ---------------------------------------------------------------------------

describe('CompetitorContentPanel — index', () => {
  it('renders loading, error+retry, and empty run states', async () => {
    setState({ listLoading: true, listLoaded: false });
    const loading = renderInRouter(<CompetitorContentPanel siteId="s1" />);
    expect(loading.container.querySelector('[data-testid="competitor-runs"] [aria-busy="true"]')).toBeInTheDocument();
    loading.unmount();

    setState({ listLoaded: true, listError: 'network down' });
    const errored = renderInRouter(<CompetitorContentPanel siteId="s1" />);
    expect(screen.getByTestId('competitor-runs-error')).toHaveTextContent('network down');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(api.listCompetitorRuns).toHaveBeenCalled();
    errored.unmount();

    setState({ listLoaded: true });
    renderInRouter(<CompetitorContentPanel siteId="s1" />);
    expect(screen.getByTestId('competitor-runs-empty')).toBeInTheDocument();
  });

  it('lists runs, disables the run form while in flight, loads more, and opens a run', async () => {
    const user = userEvent.setup();
    setState({
      listLoaded: true,
      nextCursor: 'next',
      profilesLoaded: true,
      profiles: [profile({ id: 'p1' })],
      runs: [run({ runId: 'active', status: 'collecting', requestedAt: null }), run({ runId: 'done', status: 'completed' })],
    });
    renderInRouter(<CompetitorContentPanel siteId="s1" />);
    expect(screen.getByTestId('competitor-run-active')).toBeInTheDocument();
    expect(screen.getByTestId('competitor-run-submit')).toBeDisabled();
    await user.click(screen.getByTestId('competitor-runs-load-more'));
    expect(api.listCompetitorRuns).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 's1', cursor: 'next' }),
      expect.anything(),
    );
    await user.click(screen.getAllByRole('button', { name: 'Open' })[0]!);
    expect(screen.getByTestId('loc').textContent).toContain('ccRun=active');
  });
});

describe('CompetitorContentPanel — run detail', () => {
  it('shows detail loading, error, and missing states', () => {
    setState({ detailLoading: { r1: true } });
    const loading = renderInRouter(<CompetitorContentPanel siteId="s1" />, '/sites/s1?view=competitors&ccRun=r1');
    expect(screen.getByTestId('competitor-detail-loading')).toBeInTheDocument();
    loading.unmount();

    setState({ detailError: { r1: 'not found' } });
    const errored = renderInRouter(<CompetitorContentPanel siteId="s1" />, '/sites/s1?view=competitors&ccRun=r1');
    expect(screen.getByTestId('competitor-detail-error')).toHaveTextContent('not found');
    errored.unmount();

    setState({});
    renderInRouter(<CompetitorContentPanel siteId="s1" />, '/sites/s1?view=competitors&ccRun=missing');
    expect(screen.getByTestId('competitor-detail-back')).toBeInTheDocument();
    expect(screen.queryByTestId('competitor-detail')).toBeNull();
  });

  it('renders a completed run with findings, deep-links to a new analysis, and navigates back', async () => {
    const user = userEvent.setup();
    setState({
      detail: {
        r1: detail({
          status: 'completed',
          findings: findings({ aiExplanation: 'Consolidate the comparison coverage.', partialDomains: ['blocked.com'] }),
          pages: [page('https://example.com/p', { role: 'owned', competitorDomain: null }), page('https://rival.com/x')],
        }),
      },
    });
    renderInRouter(<CompetitorContentPanel siteId="s1" />, '/sites/s1?view=competitors&ccRun=r1');
    expect(screen.getByTestId('competitor-detail')).toBeInTheDocument();
    expect(screen.getByTestId('competitor-ai-explanation')).toHaveTextContent('Consolidate');
    expect(screen.getByTestId('competitor-comparison')).toBeInTheDocument();
    expect(screen.getByTestId('competitor-opportunities')).toBeInTheDocument();
    expect(screen.getByTestId('competitor-drilldown')).toBeInTheDocument();
    // Deep-link into a prefilled new analysis using the run's owned URL + keyword.
    await user.click(screen.getByTestId('competitor-start-analysis'));
    const loc = screen.getByTestId('loc').textContent!;
    expect(loc).toContain('view=analyses');
    expect(loc).toContain('prefillKeyword=best+tool');
    expect(loc).toContain(encodeURIComponent('https://example.com/p'));
    expect(loc).not.toContain('ccRun=');
  });

  it('navigates back from a run detail to the index', async () => {
    setState({ detail: { r1: detail({ status: 'completed', findings: findings(), pages: [] }) } });
    renderInRouter(<CompetitorContentPanel siteId="s1" />, '/sites/s1?view=competitors&ccRun=r1');
    await userEvent.click(screen.getByTestId('competitor-detail-back'));
    expect(screen.getByTestId('loc').textContent).not.toContain('ccRun=');
  });

  it('deep-links with an empty keyword when the run has none', async () => {
    setState({ detail: { r1: detail({ status: 'completed', keyword: null, findings: findings({ keyword: null }), pages: [] }) } });
    renderInRouter(<CompetitorContentPanel siteId="s1" />, '/sites/s1?view=competitors&ccRun=r1');
    await userEvent.click(screen.getByTestId('competitor-start-analysis'));
    const loc = screen.getByTestId('loc').textContent!;
    expect(loc).toContain('prefillKeyword=');
    expect(loc).not.toContain('prefillKeyword=best');
  });

  it('renders the pending panel (no findings, no ai explanation) and cancels', async () => {
    const user = userEvent.setup();
    setState({ detail: { r1: detail({ status: 'queued', findings: null }) } });
    renderInRouter(<CompetitorContentPanel siteId="s1" />, '/sites/s1?view=competitors&ccRun=r1');
    expect(screen.getByTestId('competitor-detail-pending')).toBeInTheDocument();
    await user.click(screen.getByTestId('competitor-progress-cancel'));
    expect(api.cancelCompetitorRun).toHaveBeenCalledWith('s1', 'r1', expect.anything());
  });
});

describe('CompetitorContentPanel — polling', () => {
  it('re-polls the runs list while a run is in flight', async () => {
    vi.useFakeTimers();
    setState({ listLoaded: true, profilesLoaded: true, runs: [run({ runId: 'x', status: 'collecting' })] });
    const view = renderInRouter(<CompetitorContentPanel siteId="s1" />);
    await vi.advanceTimersByTimeAsync(4000);
    expect(api.listCompetitorRuns).toHaveBeenCalled();
    view.unmount();
  });

  it('re-polls a non-terminal run detail', async () => {
    vi.useFakeTimers();
    setState({ detail: { r1: detail({ status: 'collecting', findings: null }) } });
    const view = renderInRouter(<CompetitorContentPanel siteId="s1" />, '/sites/s1?view=competitors&ccRun=r1');
    await vi.advanceTimersByTimeAsync(4000);
    expect(api.getCompetitorRun).toHaveBeenCalled();
    view.unmount();
  });
});
