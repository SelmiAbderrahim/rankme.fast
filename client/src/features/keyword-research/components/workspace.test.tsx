/**
 * Workspace shell + gap/overview/trends view coverage.
 * Harness cloned from the audience-research workspace tests: redux hooks are
 * mocked with a hand-rolled state + thunk-running dispatch; the API module is
 * mocked so no request leaves the test.
 */
import type React from 'react';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enCommon from '@shared/i18n/locales/en/common.json';
import en from '@shared/i18n/locales/en/keywordResearch.json';
import { initialState } from '../store/slice';
import {
  gapFormSchema,
  overviewFormSchema,
  trendsFormSchema,
} from '../validation';
import type {
  GapResponse,
  KeywordObservationMeta,
  KeywordOverviewRow,
  KeywordResearchState,
  KeywordSpendPreview,
  KeywordTrendsRow,
  TrendsStoredRunSummary,
} from '../types';
import { SERP_FEATURES } from '../types';

const hooks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
}));

const api = vi.hoisted(() => ({
  fetchHistoryRequest: vi.fn(),
  fetchKeywordPreviewRequest: vi.fn(),
  fetchGapRequest: vi.fn(),
  fetchOverviewRequest: vi.fn(),
  fetchTrendsRequest: vi.fn(),
  runClustersRequest: vi.fn(),
  fetchClusterRunsRequest: vi.fn(),
  fetchClusterRunRequest: vi.fn(),
  postClusterDecisionRequest: vi.fn(),
  // The live-trends tab mounts the Live Trends view, which loads its
  // stored-exploration history once on mount. Mocked here so the workspace
  // suite still makes no request.
  fetchLiveTrendsListRequest: vi.fn(),
  previewLiveTrendsRequest: vi.fn(),
  exploreLiveTrendsRequest: vi.fn(),
  fetchLiveTrendsRunRequest: vi.fn(),
}));

vi.mock('@shared/hooks/redux', () => ({
  useAppDispatch: () => hooks.dispatch,
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(hooks.state),
}));

vi.mock('@features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/auth')>()),
  useAuthSession: () => ({
    authenticated: true,
    isPending: false,
    emailVerified: true,
    user: { id: 'account-a' },
  }),
}));

vi.mock('@features/report-export', () => ({
  ReportExportControl: ({ selection }: { selection?: { operation?: string } }) => (
    <div data-testid="mock-keyword-export">{selection?.operation}</div>
  ),
}));

vi.mock('@shared/markets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/markets')>()),
  useMarketCatalog: () => ({
    markets: [
      { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
      { countryCode: 'GB', locationCode: 2826, languageCodes: ['en', 'de'] },
    ],
    loading: false,
    error: false,
  }),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, ...api };
});

vi.mock('./KeywordResearchPanel', () => ({
  KeywordResearchPanel: () => <div data-testid="mock-research-panel" />,
  IntentBadge: ({ intent }: { intent: string | null | undefined }) =>
    intent ? <span data-testid={`mock-intent-${intent}`}>{intent}</span> : null,
  keywordSlug: (k: string) => k.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
}));

// The cluster view has its own exhaustive suite. Keep this workspace-shell
// assertion focused on resolving the lazy route rather than recompiling the
// full cluster feature graph inside a single timed test.
vi.mock('./ClustersView', () => ({
  ClustersView: () => <div data-testid="kw-clusters-no-candidates" />,
}));

import { GapView } from './GapView';
import { GapResultsTable, filterGapRows, sortGapRows } from './GapResultsTable';
import { KeywordIntelligenceWorkspace } from './KeywordIntelligenceWorkspace';
import { KeywordSpendPreviewCard } from './KeywordSpendPreviewCard';
import { OverviewSection } from './OverviewSection';
import { PhraseChipsInput } from './PhraseChipsInput';
import { ProvenanceBadge, ProvenanceKindChip } from './ProvenanceBadge';
import { SerpFeatureChips } from './SerpFeatureChips';
import { TrendsChart, sortMonthlySeries } from './TrendsChart';
import { TrendsView } from './TrendsView';
import { parseKeywordWorkspaceQuery } from '../tabState';

const i18n = i18next.createInstance();
await i18n
  .use(initReactI18next)
  .init({
    lng: 'en',
    resources: {
      en: { keywordResearch: en, common: enCommon },
    },
  });

const meta: KeywordObservationMeta = {
  kind: 'provider_observation',
  observedAt: '2026-07-01T00:00:00.000Z',
  freshUntil: '2026-07-31T00:00:00.000Z',
  market: { locationCode: 2840, languageCode: 'en' },
};

const preview: KeywordSpendPreview = {};

// The four null combinations (spec: every combo covered) + a tie.
const gapData: GapResponse = {
  ownDomain: 'own.example',
  pairs: [
    {
      ownDomain: 'own.example',
      competitorDomain: 'rival.example',
      cached: false,
      fetchedAt: '2026-07-19T00:00:00.000Z',
      expiresAt: '2026-08-18T00:00:00.000Z',
      rows: [
        { keyword: 'missing kw', ownPosition: null, competitorPosition: 4, searchVolume: 900 },
        { keyword: 'behind kw', ownPosition: 9, competitorPosition: 2, searchVolume: 500 },
        { keyword: 'ahead kw', ownPosition: 1, competitorPosition: 6, searchVolume: 500 },
        { keyword: 'even kw', ownPosition: 5, competitorPosition: 5, searchVolume: null },
        { keyword: 'unranked kw', ownPosition: 3, competitorPosition: null, searchVolume: 100 },
        { keyword: 'both null kw', ownPosition: null, competitorPosition: null, searchVolume: null },
      ],
      meta,
    },
    {
      ownDomain: 'own.example',
      competitorDomain: 'second.example',
      cached: true,
      fetchedAt: '2026-07-19T00:00:00.000Z',
      expiresAt: '2026-08-18T00:00:00.000Z',
      rows: [],
      meta,
    },
  ],
};

function setState(
  overrides: Partial<KeywordResearchState> = {},
): KeywordResearchState {
  const merged: KeywordResearchState = { ...initialState, ...overrides };
  hooks.state = { keywordResearch: merged };
  return merged;
}

function installThunkDispatch() {
  hooks.dispatch.mockImplementation((action: unknown) => {
    if (typeof action === 'function') {
      return (action as (...a: unknown[]) => unknown)(
        hooks.dispatch,
        () => hooks.state,
        undefined,
      );
    }
    return action;
  });
}

function renderInRouter(node: React.ReactNode, path = '/keyword-research') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  hooks.dispatch.mockReset();
  installThunkDispatch();
  for (const mock of Object.values(api)) mock.mockReset();
  api.fetchHistoryRequest.mockResolvedValue({ items: [], nextCursor: null });
  api.fetchKeywordPreviewRequest.mockResolvedValue(preview);
  api.fetchGapRequest.mockResolvedValue(gapData);
  api.fetchOverviewRequest.mockResolvedValue({ keywords: [] });
  api.fetchTrendsRequest.mockResolvedValue({ keywords: [] });
  api.fetchLiveTrendsListRequest.mockResolvedValue({ runs: [], nextCursor: null });
  setState();
});

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

describe('KeywordIntelligenceWorkspace', () => {
  it('renders the research tab by default with the preserved panel + overview section', () => {
    renderInRouter(<KeywordIntelligenceWorkspace />);
    expect(screen.getByTestId('keyword-intel-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('mock-research-panel')).toBeInTheDocument();
    expect(screen.getByTestId('kw-overview-section')).toBeInTheDocument();
  });

  it('offers an export for the newest matching result on the active tab', () => {
    setState({
      history: [
        {
          id: 'history-metrics',
          kind: 'metrics',
          phrases: ['seo audit'],
          locationCode: 2840,
          languageCode: 'en',
          resultCount: 1,
          cached: false,
          createdAt: '2026-07-19T00:00:00.000Z',
        },
      ],
      historyLoaded: true,
    });
    renderInRouter(<KeywordIntelligenceWorkspace />);
    expect(screen.getByTestId('mock-keyword-export')).toHaveTextContent('metrics');
  });

  it('normalizes an unknown ?tab= to research', () => {
    renderInRouter(<KeywordIntelligenceWorkspace />, '/keyword-research?tab=bogus');
    expect(screen.getByTestId('mock-research-panel')).toBeInTheDocument();
  });

  it('deep-links straight into the gap tab and lazy-loads the view', async () => {
    renderInRouter(<KeywordIntelligenceWorkspace />, '/keyword-research?tab=gap');
    expect(await screen.findByTestId('kw-gap-view')).toBeInTheDocument();
  });

  it('deep-links into the trends tab', async () => {
    renderInRouter(<KeywordIntelligenceWorkspace />, '/keyword-research?tab=trends');
    expect(await screen.findByTestId('kw-trends-view')).toBeInTheDocument();
  });

  it('deep-links into the clusters tab and lazy-loads the view', async () => {
    api.fetchClusterRunsRequest.mockResolvedValue({ runs: [], nextCursor: null });
    hooks.state = { keywordResearch: { ...initialState } };
    renderInRouter(<KeywordIntelligenceWorkspace />, '/keyword-research?tab=clusters');
    expect(
      await screen.findByTestId('kw-clusters-no-candidates', undefined, {
        timeout: 15_000,
      }),
    ).toBeInTheDocument();
  });

  it('switches tabs through clicks (URL-backed)', async () => {
    renderInRouter(<KeywordIntelligenceWorkspace />);
    fireEvent.mouseDown(screen.getByTestId('keyword-intel-tab-gap'));
    fireEvent.click(screen.getByTestId('keyword-intel-tab-gap'));
    expect(await screen.findByTestId('kw-gap-view')).toBeInTheDocument();
  });

  it('loads recent research once on mount for the export control', () => {
    renderInRouter(<KeywordIntelligenceWorkspace />);
    expect(api.fetchHistoryRequest).toHaveBeenCalledTimes(1);
  });

  it('does not reload when history is already loaded', () => {
    setState({ historyLoaded: true });
    renderInRouter(<KeywordIntelligenceWorkspace />);
    expect(api.fetchHistoryRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Live search interest hosted beside the Labs historical volume
// ---------------------------------------------------------------------------

const STORED_RUN_ID = 'b'.repeat(24);
const LIVE_TRENDS_COVERAGE_KEY =
  'keywordResearch.trends.coverageNote.searchInterestIndex';

/** Minimal stored-exploration row (Live Trends DTO) — stored reads are always free. */
function storedLiveTrendsRun(): TrendsStoredRunSummary {
  return {
    runId: STORED_RUN_ID,
    status: 'succeeded',
    retained: true,
    refunded: false,
    errorCode: null,
    inputs: { keywords: ['solar'], geo: 'us', language: 'en' },
    siteId: null,
    seriesCount: 1,
    relatedQueryCount: 0,
    createdAt: '2026-07-18T00:00:00.000Z',
    completedAt: '2026-07-18T00:00:01.000Z',
    source: 'estimate',
    observationMeta: { searchInterestIndexKey: LIVE_TRENDS_COVERAGE_KEY },
  };
}

describe('KeywordIntelligenceWorkspace — live search interest tab', () => {
  it('renders both trend tabs with distinct labels', () => {
    renderInRouter(<KeywordIntelligenceWorkspace />);
    expect(screen.getByTestId('keyword-intel-tab-trends')).toHaveTextContent(
      'Historical volume',
    );
    expect(
      screen.getByTestId('keyword-intel-tab-live-trends'),
    ).toHaveTextContent('Live search interest');
  });

  it('deep-links into the live-trends tab and lazy-loads the live-trends view', async () => {
    renderInRouter(
      <KeywordIntelligenceWorkspace />,
      '/keyword-research?tab=live-trends',
    );
    expect(await screen.findByTestId('live-trends-view')).toBeInTheDocument();
    // The live-trends view owns its own mount-time stored-history read.
    await waitFor(() =>
      expect(api.fetchLiveTrendsListRequest).toHaveBeenCalledTimes(1),
    );
  });

  it('switches to live search interest through a click and keeps the URL authoritative', async () => {
    renderInRouter(<KeywordIntelligenceWorkspace />);
    fireEvent.mouseDown(screen.getByTestId('keyword-intel-tab-live-trends'));
    fireEvent.click(screen.getByTestId('keyword-intel-tab-live-trends'));
    expect(await screen.findByTestId('live-trends-view')).toBeInTheDocument();
    expect(
      screen.getByTestId('keyword-intel-tab-live-trends'),
    ).toHaveAttribute('data-state', 'active');
  });

  it('URL state survives a remount (reload) on the live-trends tab', async () => {
    const view = renderInRouter(
      <KeywordIntelligenceWorkspace />,
      '/keyword-research?tab=live-trends&keywords=seo%20audit',
    );
    expect(await screen.findByTestId('live-trends-view')).toBeInTheDocument();
    view.unmount();
    renderInRouter(
      <KeywordIntelligenceWorkspace />,
      '/keyword-research?tab=live-trends&keywords=seo%20audit',
    );
    expect(await screen.findByTestId('live-trends-view')).toBeInTheDocument();
    expect(
      screen.getByTestId('live-trends-chip-seo-audit'),
    ).toBeInTheDocument();
  });

  it('keeps the Labs historical-volume tab unchanged beside it', async () => {
    renderInRouter(<KeywordIntelligenceWorkspace />, '/keyword-research?tab=trends');
    expect(await screen.findByTestId('kw-trends-view')).toBeInTheDocument();
    // Sibling live-trends surface is NOT mounted, so its thunk never fires.
    expect(screen.queryByTestId('live-trends-view')).toBeNull();
    expect(api.fetchLiveTrendsListRequest).not.toHaveBeenCalled();
  });

  it('does not fire the Labs trends thunks while live search interest is active', async () => {
    renderInRouter(
      <KeywordIntelligenceWorkspace />,
      '/keyword-research?tab=live-trends',
    );
    expect(await screen.findByTestId('live-trends-view')).toBeInTheDocument();
    expect(screen.queryByTestId('kw-trends-view')).toBeNull();
    expect(api.fetchTrendsRequest).not.toHaveBeenCalled();
    expect(api.fetchKeywordPreviewRequest).not.toHaveBeenCalled();
  });

  it('surfaces the kill-switch panel while stored reads stay reachable', async () => {
    const base = setState();
    hooks.state = {
      keywordResearch: {
        ...base,
        liveTrends: {
          ...base.liveTrends,
          preview: {
            loading: false,
            data: null,
            error: 'Live keyword trends are temporarily unavailable.',
            errorKind: 'unavailable',
          },
          list: {
            loading: false,
            error: '',
            errorKind: null,
            data: { runs: [storedLiveTrendsRun()], nextCursor: null },
          },
        },
      },
    };
    renderInRouter(
      <KeywordIntelligenceWorkspace />,
      '/keyword-research?tab=live-trends',
    );
    expect(
      await screen.findByTestId('live-trends-kill-switch'),
    ).toBeInTheDocument();
    // Stored reads survive the kill switch — the history row is still listed.
    expect(
      screen.getByTestId(`live-trends-stored-row-${STORED_RUN_ID}`),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Provenance + preview + shared primitives
// ---------------------------------------------------------------------------

describe('ProvenanceBadge', () => {
  it.each([
    ['estimate', 'Estimate'],
    ['provider_observation', 'Provider observation'],
    ['ai_interpretation', 'AI interpretation'],
  ] as const)('labels %s', (kind, label) => {
    renderInRouter(<ProvenanceBadge meta={{ ...meta, kind }} />);
    expect(screen.getByTestId(`kw-provenance-${kind}`)).toHaveTextContent(label);
  });

  it('discloses observedAt/freshUntil when requested', () => {
    renderInRouter(<ProvenanceBadge meta={meta} withTimestamps />);
    const badge = screen.getByTestId('kw-provenance-provider_observation');
    expect(badge.textContent).toMatch(/Observed/);
    expect(badge.textContent).toMatch(/Fresh until/);
  });

  it('ProvenanceKindChip renders a standalone kind chip', () => {
    renderInRouter(<ProvenanceKindChip kind="estimate" />);
    expect(screen.getByTestId('kw-provenance-chip-estimate')).toHaveTextContent(
      'Estimate',
    );
  });
});

describe('KeywordSpendPreviewCard', () => {
  it('discloses that usage is not metered', () => {
    renderInRouter(<KeywordSpendPreviewCard preview={preview} loading={false} />);
    expect(screen.getByTestId('kw-preview')).toHaveTextContent(
      'Plan usage limits are not metered in self-hosted mode.',
    );
  });

  it('renders a skeleton while loading without data and nothing when idle', () => {
    const { rerender } = renderInRouter(
      <KeywordSpendPreviewCard preview={null} loading />,
    );
    expect(screen.getByTestId('kw-preview-loading')).toBeInTheDocument();
    rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <KeywordSpendPreviewCard preview={null} loading={false} />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.queryByTestId('kw-preview')).toBeNull();
    expect(screen.queryByTestId('kw-preview-loading')).toBeNull();
  });
});

describe('SerpFeatureChips', () => {
  it('renders one static chip per closed-enum member including other', () => {
    renderInRouter(<SerpFeatureChips features={[...SERP_FEATURES]} />);
    for (const feature of SERP_FEATURES) {
      expect(screen.getByTestId(`kw-serp-${feature}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('kw-serp-other')).toHaveTextContent('Other');
  });

  it('renders the honest none-observed line for an empty list', () => {
    renderInRouter(<SerpFeatureChips features={[]} />);
    expect(screen.getByTestId('kw-serp-none')).toBeInTheDocument();
  });
});

describe('PhraseChipsInput', () => {
  function Wrapper({ max = 3 }: { max?: number }) {
    const [chips, setChips] = useState<string[]>([]);
    return (
      <PhraseChipsInput
        id="test-chips"
        label="Phrases"
        placeholder="type"
        chips={chips}
        onChange={setChips}
        max={max}
        testIdPrefix="test-chips"
      />
    );
  }

  it('commits on Enter, dedupes, removes via button and Backspace, enforces max', () => {
    renderInRouter(<Wrapper />);
    const input = screen.getByTestId('test-chips-input');
    fireEvent.change(input, { target: { value: 'alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' }); // duplicate ignored
    fireEvent.change(input, { target: { value: 'beta' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(screen.getByTestId('test-chips-chip-alpha')).toBeInTheDocument();
    expect(screen.getByTestId('test-chips-chip-beta')).toBeInTheDocument();
    expect(screen.getByTestId('test-chips-count')).toHaveTextContent('2 of 3');
    // Backspace on empty input removes the last chip.
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(screen.queryByTestId('test-chips-chip-beta')).toBeNull();
    // Remove button.
    fireEvent.click(
      screen.getByRole('button', { name: /remove alpha/i }),
    );
    expect(screen.queryByTestId('test-chips-chip-alpha')).toBeNull();
  });

  it('ignores keydowns that neither commit nor delete', () => {
    renderInRouter(<Wrapper />);
    const input = screen.getByTestId('test-chips-input');
    fireEvent.change(input, { target: { value: 'alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('test-chips-chip-alpha')).toBeInTheDocument();
    // Neither Enter/comma nor an empty-draft Backspace — chips untouched.
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    fireEvent.change(input, { target: { value: 'dra' } });
    fireEvent.keyDown(input, { key: 'Backspace' }); // draft non-empty → no chip removal
    expect(screen.getByTestId('test-chips-chip-alpha')).toBeInTheDocument();
    expect(screen.getByTestId('test-chips-count')).toHaveTextContent('1 of 3');
  });

  it('shows the limit message instead of silently dropping past max', () => {
    renderInRouter(<Wrapper max={1} />);
    const input = screen.getByTestId('test-chips-input');
    fireEvent.change(input, { target: { value: 'one' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'two' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('test-chips-limit')).toBeInTheDocument();
    // Blur with empty draft is a no-op (early return branch).
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('test-chips-chip-one')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Gap
// ---------------------------------------------------------------------------

describe('gap row helpers', () => {
  it('sortGapRows is deterministic: volume desc (nulls last), keyword asc tie-break', () => {
    const sorted = sortGapRows(gapData.pairs[0]!.rows);
    expect(sorted.map((r) => r.keyword)).toEqual([
      'missing kw',
      'ahead kw',
      'behind kw',
      'unranked kw',
      'both null kw',
      'even kw',
    ]);
  });

  it('filterGapRows applies the URL filter and the bounded text needle', () => {
    const rows = gapData.pairs[0]!.rows;
    expect(filterGapRows(rows, 'missing', '').map((r) => r.keyword)).toEqual([
      'missing kw',
    ]);
    expect(filterGapRows(rows, 'behind', '').map((r) => r.keyword)).toEqual([
      'behind kw',
    ]);
    expect(filterGapRows(rows, 'all', 'AHEAD').map((r) => r.keyword)).toEqual([
      'ahead kw',
    ]);
    expect(filterGapRows(rows, 'all', '')).toHaveLength(6);
  });
});

describe('GapResultsTable', () => {
  const query = parseKeywordWorkspaceQuery('');

  it('renders per-pair tables with all four null-combination badges', () => {
    const onQueryChange = vi.fn();
    renderInRouter(
      <GapResultsTable data={gapData} query={query} onQueryChange={onQueryChange} />,
    );
    const table = screen.getByTestId('kw-gap-table');
    expect(table).toBeInTheDocument();
    expect(screen.getByTestId('kw-gap-row-missing-kw')).toHaveTextContent('Missing');
    expect(screen.getByTestId('kw-gap-row-behind-kw')).toHaveTextContent('Behind');
    expect(screen.getByTestId('kw-gap-row-ahead-kw')).toHaveTextContent('Ahead');
    expect(screen.getByTestId('kw-gap-row-even-kw')).toHaveTextContent('Even');
    expect(screen.getByTestId('kw-gap-row-unranked-kw')).toHaveTextContent(
      /not ranking/i,
    );
    expect(screen.getByTestId('kw-gap-row-both-null-kw')).toHaveTextContent(
      /not ranking/i,
    );
    // Narrow-width card fallback renders the same rows.
    expect(screen.getByTestId('kw-gap-cards')).toBeInTheDocument();
    // Provenance legend: positions observation, volume estimate.
    expect(screen.getByTestId('kw-provenance-chip-provider_observation')).toBeInTheDocument();
    expect(screen.getByTestId('kw-provenance-chip-estimate')).toBeInTheDocument();
  });

  it('writes pair/filter/text-filter changes into the URL query', () => {
    const onQueryChange = vi.fn();
    renderInRouter(
      <GapResultsTable data={gapData} query={query} onQueryChange={onQueryChange} />,
    );
    fireEvent.click(screen.getByTestId('kw-gap-pair-second-example'));
    expect(onQueryChange).toHaveBeenCalledWith({ pair: 'second.example' });
    fireEvent.click(screen.getByTestId('kw-gap-filter-missing'));
    expect(onQueryChange).toHaveBeenCalledWith({ gapFilter: 'missing' });
    fireEvent.change(screen.getByTestId('kw-gap-q'), { target: { value: 'seo' } });
    expect(onQueryChange).toHaveBeenCalledWith({ q: 'seo' });
  });

  it('selects the URL pair, shows cached badge and the empty-pair state', () => {
    renderInRouter(
      <GapResultsTable
        data={gapData}
        query={{ ...query, pair: 'second.example' }}
        onQueryChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kw-gap-pair-source')).toHaveTextContent('Cached');
    expect(screen.getByTestId('kw-gap-pair-empty')).toBeInTheDocument();
  });

  it('shows the no-filter-match state when filters exclude every row', () => {
    renderInRouter(
      <GapResultsTable
        data={gapData}
        query={{ ...query, q: 'zzz-no-match' }}
        onQueryChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kw-gap-no-filter-match')).toBeInTheDocument();
  });

  it('renders the empty-results state when the response has no pairs', () => {
    renderInRouter(
      <GapResultsTable
        data={{ ownDomain: 'own.example', pairs: [] }}
        query={query}
        onQueryChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kw-gap-empty')).toBeInTheDocument();
  });

  it('renders malicious keyword strings as inert text', () => {
    const payload = '<img src=x onerror="window.__pwned=1">';
    renderInRouter(
      <GapResultsTable
        data={{
          ownDomain: 'own.example',
          pairs: [
            {
              ...gapData.pairs[0]!,
              rows: [
                {
                  keyword: payload,
                  ownPosition: null,
                  competitorPosition: 1,
                  searchVolume: 5,
                },
              ],
            },
          ],
        }}
        query={query}
        onQueryChange={vi.fn()}
      />,
    );
    expect(screen.getAllByText(payload).length).toBeGreaterThan(0);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(
      (window as unknown as Record<string, unknown>).__pwned,
    ).toBeUndefined();
  });
});

describe('GapView', () => {
  it('rejects a duplicate competitor with the localized zod message (no request)', () => {
    renderInRouter(<GapView />);
    fireEvent.change(screen.getByTestId('kw-gap-own-domain'), {
      target: { value: 'own.example' },
    });
    const input = screen.getByTestId('kw-gap-competitor-input');
    for (const value of ['rival.example', 'rival.example.']) {
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: 'Enter' });
    }
    fireEvent.submit(screen.getByTestId('kw-gap-form'));
    expect(screen.getByTestId('kw-gap-form-error')).toHaveTextContent(
      /duplicate competitor/i,
    );
    expect(api.fetchKeywordPreviewRequest).not.toHaveBeenCalled();
  });

  it('rejects the own domain listed as a competitor', () => {
    renderInRouter(<GapView />);
    fireEvent.change(screen.getByTestId('kw-gap-own-domain'), {
      target: { value: 'own.example' },
    });
    const input = screen.getByTestId('kw-gap-competitor-input');
    fireEvent.change(input, { target: { value: 'OWN.example' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.submit(screen.getByTestId('kw-gap-form'));
    expect(screen.getByTestId('kw-gap-form-error')).toHaveTextContent(
      /cannot be listed/i,
    );
  });

  it('rejects an invalid domain', () => {
    renderInRouter(<GapView />);
    fireEvent.change(screen.getByTestId('kw-gap-own-domain'), {
      target: { value: 'not a domain' },
    });
    const input = screen.getByTestId('kw-gap-competitor-input');
    fireEvent.change(input, { target: { value: 'rival.example' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.submit(screen.getByTestId('kw-gap-form'));
    expect(screen.getByTestId('kw-gap-form-error')).toHaveTextContent(
      /valid domain/i,
    );
  });

  it('requests the server preview on a valid submit and confirms into runGap', async () => {
    setState({
      preview: { loading: false, data: preview, error: '', forOperation: 'gap' },
    });
    renderInRouter(<GapView />);
    fireEvent.change(screen.getByTestId('kw-gap-own-domain'), {
      target: { value: 'Own.Example' },
    });
    const input = screen.getByTestId('kw-gap-competitor-input');
    fireEvent.change(input, { target: { value: 'Rival.Example' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.submit(screen.getByTestId('kw-gap-form'));
    await waitFor(() =>
      expect(api.fetchKeywordPreviewRequest).toHaveBeenCalledWith({
        operation: 'gap',
        ownDomain: 'own.example',
        competitors: ['rival.example'],
        locationCode: 2840,
        languageCode: 'en',
      }),
    );
    // The server preview renders verbatim with explicit confirm.
    expect(screen.getByTestId('kw-preview')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('kw-gap-confirm'));
    await waitFor(() =>
      expect(api.fetchGapRequest).toHaveBeenCalledWith({
        ownDomain: 'own.example',
        competitors: ['rival.example'],
        locationCode: 2840,
        languageCode: 'en',
      }),
    );
  });

  it('cancelling the preview dispatches clearPreview and never runs the gap', () => {
    setState({
      preview: { loading: false, data: preview, error: '', forOperation: 'gap' },
    });
    renderInRouter(<GapView />);
    fireEvent.click(screen.getByTestId('kw-gap-cancel'));
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'keywordResearch/clearPreview' }),
    );
    expect(api.fetchGapRequest).not.toHaveBeenCalled();
  });

  it('a schema failure without issue detail shows no stale error and sends nothing', () => {
    const spy = vi.spyOn(gapFormSchema, 'safeParse').mockReturnValueOnce({
      success: false,
      error: { issues: [] },
    } as never);
    renderInRouter(<GapView />);
    fireEvent.submit(screen.getByTestId('kw-gap-form'));
    expect(screen.queryByTestId('kw-gap-form-error')).toBeNull();
    expect(api.fetchKeywordPreviewRequest).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('confirm without a locally captured body never dispatches a gap run', () => {
    // The preview slot can be populated without this view's own form submit
    // (shared workspace state); confirm must stay inert until a valid submit
    // captured a pending body here.
    setState({
      preview: { loading: false, data: preview, error: '', forOperation: 'gap' },
    });
    renderInRouter(<GapView />);
    fireEvent.click(screen.getByTestId('kw-gap-confirm'));
    expect(api.fetchGapRequest).not.toHaveBeenCalled();
  });

  it('market selects update location and language on the preview body', async () => {
    renderInRouter(<GapView />);
    fireEvent.change(screen.getByTestId('kw-gap-own-domain'), {
      target: { value: 'own.example' },
    });
    const input = screen.getByTestId('kw-gap-competitor-input');
    fireEvent.change(input, { target: { value: 'rival.example' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByTestId('kw-gap-location'));
    fireEvent.click(await screen.findByRole('option', { name: /United Kingdom/ }));
    fireEvent.change(screen.getByTestId('kw-gap-language'), {
      target: { value: 'de' },
    });
    fireEvent.submit(screen.getByTestId('kw-gap-form'));
    await waitFor(() =>
      expect(api.fetchKeywordPreviewRequest).toHaveBeenCalledWith(
        expect.objectContaining({ locationCode: 2826, languageCode: 'de' }),
      ),
    );
  });

  it('renders preview loading, preview error, generic error, loading, results, and idle states', () => {
    // Idle
    const first = renderInRouter(<GapView />);
    expect(screen.getByTestId('kw-gap-idle')).toBeInTheDocument();
    first.unmount();
    // Preview loading skeleton
    setState({
      preview: { loading: true, data: null, error: '', forOperation: 'gap' },
    });
    const second = renderInRouter(<GapView />);
    expect(screen.getByTestId('kw-preview-loading')).toBeInTheDocument();
    second.unmount();
    // Preview error
    setState({
      preview: { loading: false, data: null, error: 'preview boom', forOperation: 'gap' },
    });
    const third = renderInRouter(<GapView />);
    expect(screen.getByTestId('kw-gap-preview-error')).toHaveTextContent('preview boom');
    third.unmount();
    // Generic provider failure
    setState({ gap: { loading: false, data: null, error: 'boom' } });
    const fifth = renderInRouter(<GapView />);
    expect(screen.getByTestId('kw-gap-error')).toHaveTextContent('boom');
    fifth.unmount();
    // Loading skeleton
    setState({ gap: { loading: true, data: null, error: '' } });
    const sixth = renderInRouter(<GapView />);
    expect(screen.getByTestId('kw-gap-loading')).toBeInTheDocument();
    sixth.unmount();
    // Results
    setState({ gap: { loading: false, data: gapData, error: '' } });
    renderInRouter(<GapView />);
    expect(screen.getByTestId('kw-gap-results')).toBeInTheDocument();
  });

  it('offers a canonical site-workspace link with stored gap inputs intact', () => {
    setState({ gap: { loading: false, data: gapData, error: '' } });
    renderInRouter(<GapView />, '/keyword-research?siteId=site%2Fone');
    expect(screen.getByTestId('kw-gap-site-workspace-link')).toHaveAttribute(
      'href',
      expect.stringContaining('/sites/site%2Fone?tab=competitors&view=keywords'),
    );
    const href = screen.getByTestId('kw-gap-site-workspace-link').getAttribute('href') ?? '';
    expect(href).toContain('ownedDomain=own.example');
    expect(href).toContain('competitors=rival.example%2Csecond.example');
    expect(href).toContain('locationCode=2840');
    expect(href).toContain('languageCode=en');
  });

  it('prefers current form and market inputs in the canonical workspace link', async () => {
    setState({ gap: { loading: false, data: gapData, error: '' } });
    renderInRouter(<GapView />, '/keyword-research?siteId=site-one');
    fireEvent.change(screen.getByTestId('kw-gap-own-domain'), {
      target: { value: 'current.example' },
    });
    const input = screen.getByTestId('kw-gap-competitor-input');
    fireEvent.change(input, { target: { value: 'current-rival.example' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByTestId('kw-gap-location'));
    fireEvent.click(await screen.findByRole('option', { name: /United Kingdom/ }));
    fireEvent.change(screen.getByTestId('kw-gap-language'), { target: { value: 'de' } });
    const href = screen.getByTestId('kw-gap-site-workspace-link').getAttribute('href') ?? '';
    expect(href).toContain('ownedDomain=current.example');
    expect(href).toContain('competitors=current-rival.example');
    expect(href).toContain('locationCode=2826');
    expect(href).toContain('languageCode=de');
  });

  it('uses safe defaults when a stored gap result contains no comparison pairs', () => {
    setState({
      gap: {
        loading: false,
        data: { ...gapData, ownDomain: '', pairs: [] },
        error: '',
      },
    });
    renderInRouter(<GapView />, '/keyword-research?siteId=site-one');
    const href = screen.getByTestId('kw-gap-site-workspace-link').getAttribute('href') ?? '';
    expect(href).not.toContain('ownedDomain=');
    expect(href).not.toContain('competitors=');
    expect(href).toContain('locationCode=2840');
    expect(href).toContain('languageCode=en');
  });

  it('does not offer the link before either local or stored gap inputs exist', () => {
    renderInRouter(<GapView />, '/keyword-research?siteId=site-one');
    expect(screen.queryByTestId('kw-gap-site-workspace-link')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function overviewRow(overrides: Partial<KeywordOverviewRow> = {}): KeywordOverviewRow {
  return {
    keyword: 'seo audit',
    searchVolume: 900,
    difficulty: 25,
    cpc: '1.500000',
    intent: 'informational',
    serpFeatures: ['ai_overview', 'featured_snippet'],
    resultsCount: 1000,
    observedAt: '2026-07-01T00:00:00.000Z',
    cached: false,
    fetchedAt: '2026-07-19T00:00:00.000Z',
    expiresAt: '2026-08-18T00:00:00.000Z',
    meta,
    ...overrides,
  };
}

describe('OverviewSection', () => {
  it('requests the preview on submit and confirms into runOverview', async () => {
    setState({
      preview: { loading: false, data: { ...preview, operation: 'overview' }, error: '', forOperation: 'overview' },
    });
    renderInRouter(<OverviewSection />);
    const input = screen.getByTestId('kw-overview-input');
    fireEvent.change(input, { target: { value: 'seo audit' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.submit(screen.getByTestId('kw-overview-form'));
    await waitFor(() =>
      expect(api.fetchKeywordPreviewRequest).toHaveBeenCalledWith({
        operation: 'overview',
        keywords: ['seo audit'],
        locationCode: 2840,
        languageCode: 'en',
      }),
    );
    fireEvent.click(screen.getByTestId('kw-overview-confirm'));
    await waitFor(() =>
      expect(api.fetchOverviewRequest).toHaveBeenCalledWith({
        keywords: ['seo audit'],
        locationCode: 2840,
        languageCode: 'en',
      }),
    );
    fireEvent.click(screen.getByTestId('kw-overview-cancel'));
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'keywordResearch/clearPreview' }),
    );
  });

  it('a schema failure without issue detail shows no stale error and sends nothing', () => {
    const spy = vi.spyOn(overviewFormSchema, 'safeParse').mockReturnValueOnce({
      success: false,
      error: { issues: [] },
    } as never);
    renderInRouter(<OverviewSection />);
    fireEvent.submit(screen.getByTestId('kw-overview-form'));
    expect(screen.queryByTestId('kw-overview-form-error')).toBeNull();
    expect(api.fetchKeywordPreviewRequest).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('shows the preview skeleton while loading and hides confirm until data arrives', () => {
    setState({
      preview: { loading: true, data: null, error: '', forOperation: 'overview' },
    });
    renderInRouter(<OverviewSection />);
    expect(screen.getByTestId('kw-preview-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('kw-overview-confirm')).not.toBeInTheDocument();
  });

  it('validates empty submissions inline', () => {
    renderInRouter(<OverviewSection />);
    fireEvent.submit(screen.getByTestId('kw-overview-form'));
    expect(screen.getByTestId('kw-overview-form-error')).toBeInTheDocument();
    expect(api.fetchKeywordPreviewRequest).not.toHaveBeenCalled();
  });

  it('renders rows with every SERP-feature chip, intent badge, and index-freshness copy', () => {
    setState({
      overview: {
        loading: false,
        loaded: true,
        error: '',
        rows: [
          overviewRow({
            keyword: 'all features',
            serpFeatures: [...SERP_FEATURES],
          }),
          overviewRow({
            keyword: 'bare row',
            searchVolume: null,
            difficulty: null,
            cpc: null,
            intent: null,
            serpFeatures: [],
            resultsCount: null,
            observedAt: null,
          }),
        ],
      },
    });
    renderInRouter(<OverviewSection />);
    for (const feature of SERP_FEATURES) {
      expect(screen.getByTestId(`kw-serp-${feature}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('kw-overview-index-note')).toHaveTextContent(
      /provider's index, not a live search/i,
    );
    expect(screen.getByTestId('mock-intent-informational')).toBeInTheDocument();
    // Null-heavy row renders honest dashes + none-observed features.
    expect(screen.getByTestId('kw-serp-none')).toBeInTheDocument();
    expect(screen.getByTestId('kw-overview-observed-bare-row')).toHaveTextContent('—');
    expect(screen.getByTestId('kw-overview-observed-all-features')).toHaveTextContent(
      /observed/i,
    );
  });

  it('renders empty/error/loading states', () => {
    setState({
      overview: { loading: false, loaded: true, error: '', rows: [] },
    });
    const a = renderInRouter(<OverviewSection />);
    expect(screen.getByTestId('kw-overview-empty')).toBeInTheDocument();
    a.unmount();
    setState({
      overview: { loading: false, loaded: true, error: 'boom', rows: [] },
    });
    const c = renderInRouter(<OverviewSection />);
    expect(screen.getByTestId('kw-overview-error')).toBeInTheDocument();
    c.unmount();
    setState({
      overview: { loading: true, loaded: false, error: '', rows: [] },
    });
    const d = renderInRouter(<OverviewSection />);
    expect(screen.getByTestId('kw-overview-loading')).toBeInTheDocument();
    d.unmount();
    setState({
      preview: { loading: false, data: null, error: 'p-err', forOperation: 'overview' },
    });
    renderInRouter(<OverviewSection />);
    expect(screen.getByTestId('kw-overview-preview-error')).toHaveTextContent('p-err');
  });
});

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

function trendsRow(overrides: Partial<KeywordTrendsRow> = {}): KeywordTrendsRow {
  return {
    keyword: 'seo audit',
    monthlySearches: [
      { year: 2026, month: 2, searchVolume: 200 },
      { year: 2026, month: 1, searchVolume: 100 },
      { year: 2025, month: 12, searchVolume: 50 },
    ],
    trends: {
      yoyDelta: 0.25,
      twelveMonthMomentum: -0.1,
      seasonalityFlags: { peakMonth: 12, troughMonth: 6 },
    },
    cached: false,
    fetchedAt: '2026-07-19T00:00:00.000Z',
    expiresAt: '2026-08-18T00:00:00.000Z',
    meta: { ...meta, kind: 'estimate' },
    ...overrides,
  };
}

describe('TrendsChart', () => {
  it('sorts the series chronologically', () => {
    const sorted = sortMonthlySeries(trendsRow().monthlySearches);
    expect(sorted.map((p) => `${p.year}-${p.month}`)).toEqual([
      '2025-12',
      '2026-1',
      '2026-2',
    ]);
  });

  it('renders a static flat-tint line for two or more points', () => {
    renderInRouter(<TrendsChart series={trendsRow().monthlySearches} />);
    expect(screen.getByTestId('kw-trends-chart')).toBeInTheDocument();
  });

  it('renders the honest not-enough-history state for sparse series', () => {
    renderInRouter(
      <TrendsChart series={[{ year: 2026, month: 1, searchVolume: 10 }]} />,
    );
    expect(screen.getByTestId('kw-trends-chart-empty')).toBeInTheDocument();
  });
});

describe('TrendsView', () => {
  it('previews and confirms a trends run', async () => {
    setState({
      preview: {
        loading: false,
        data: { ...preview, operation: 'trends' },
        error: '',
        forOperation: 'trends',
      },
    });
    renderInRouter(<TrendsView />);
    const input = screen.getByTestId('kw-trends-input');
    fireEvent.change(input, { target: { value: 'seo audit' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.submit(screen.getByTestId('kw-trends-form'));
    await waitFor(() =>
      expect(api.fetchKeywordPreviewRequest).toHaveBeenCalledWith({
        operation: 'trends',
        keywords: ['seo audit'],
        locationCode: 2840,
        languageCode: 'en',
      }),
    );
    fireEvent.click(screen.getByTestId('kw-trends-confirm'));
    await waitFor(() =>
      expect(api.fetchTrendsRequest).toHaveBeenCalledWith({
        keywords: ['seo audit'],
        locationCode: 2840,
        languageCode: 'en',
      }),
    );
    fireEvent.click(screen.getByTestId('kw-trends-cancel'));
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'keywordResearch/clearPreview' }),
    );
  });

  it('validates empty submissions inline', () => {
    renderInRouter(<TrendsView />);
    fireEvent.submit(screen.getByTestId('kw-trends-form'));
    expect(screen.getByTestId('kw-trends-form-error')).toBeInTheDocument();
  });

  it('renders full readouts labelled Estimate plus the accessible table fallback', () => {
    setState({
      trends: { loading: false, loaded: true, error: '', rows: [trendsRow()] },
    });
    renderInRouter(<TrendsView />);
    expect(screen.getByTestId('kw-trends-card-seo-audit')).toBeInTheDocument();
    expect(screen.getByTestId('kw-provenance-estimate')).toBeInTheDocument();
    expect(screen.getByTestId('kw-trends-yoy-seo-audit')).toHaveTextContent('+25%');
    expect(screen.getByTestId('kw-trends-momentum-seo-audit')).toHaveTextContent('-10%');
    expect(screen.getByTestId('kw-trends-peak-seo-audit')).toHaveTextContent('Dec');
    expect(screen.getByTestId('kw-trends-trough-seo-audit')).toHaveTextContent('Jun');
    // Accessible table fallback in chronological order.
    const table = screen.getByTestId('kw-trends-table-seo-audit');
    expect(table).toBeInTheDocument();
    expect(table.textContent).toContain('Dec 2025');
  });

  it('renders null yoy/momentum/seasonality as honest server thresholds', () => {
    setState({
      trends: {
        loading: false,
        loaded: true,
        error: '',
        rows: [
          trendsRow({
            keyword: 'sparse kw',
            monthlySearches: [{ year: 2026, month: 1, searchVolume: 10 }],
            trends: {
              yoyDelta: null,
              twelveMonthMomentum: null,
              seasonalityFlags: { peakMonth: null, troughMonth: null },
            },
            cached: true,
          }),
        ],
      },
    });
    renderInRouter(<TrendsView />);
    expect(screen.getByTestId('kw-trends-yoy-sparse-kw')).toHaveTextContent(
      /need 13 months/i,
    );
    expect(screen.getByTestId('kw-trends-momentum-sparse-kw')).toHaveTextContent(
      /need 24 months/i,
    );
    expect(screen.getByTestId('kw-trends-peak-sparse-kw')).toHaveTextContent(
      /need 24 months/i,
    );
    expect(screen.getByTestId('kw-trends-chart-empty')).toBeInTheDocument();
  });

  it('a schema failure without issue detail shows no stale error and sends nothing', () => {
    const spy = vi.spyOn(trendsFormSchema, 'safeParse').mockReturnValueOnce({
      success: false,
      error: { issues: [] },
    } as never);
    renderInRouter(<TrendsView />);
    fireEvent.submit(screen.getByTestId('kw-trends-form'));
    expect(screen.queryByTestId('kw-trends-form-error')).toBeNull();
    expect(api.fetchKeywordPreviewRequest).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('omits the accessible table entirely for a zero-month series', () => {
    setState({
      trends: {
        loading: false,
        loaded: true,
        error: '',
        rows: [trendsRow({ keyword: 'no history kw', monthlySearches: [] })],
      },
    });
    renderInRouter(<TrendsView />);
    expect(screen.getByTestId('kw-trends-card-no-history-kw')).toBeInTheDocument();
    expect(screen.queryByTestId('kw-trends-table-no-history-kw')).not.toBeInTheDocument();
  });

  it('shows the preview skeleton while loading and hides confirm until data arrives', () => {
    setState({
      preview: { loading: true, data: null, error: '', forOperation: 'trends' },
    });
    renderInRouter(<TrendsView />);
    expect(screen.getByTestId('kw-preview-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('kw-trends-confirm')).not.toBeInTheDocument();
  });

  it('ignores another operation’s in-flight preview (no card, no loading CTA)', () => {
    setState({
      preview: { loading: true, data: null, error: '', forOperation: 'gap' },
    });
    renderInRouter(<TrendsView />);
    expect(screen.queryByTestId('kw-preview-loading')).not.toBeInTheDocument();
    const cta = screen.getByTestId('kw-trends-preview-cta');
    expect(cta).not.toHaveAttribute('aria-busy', 'true');
  });

  it('confirm without a locally captured body never dispatches a run', () => {
    // The preview slot can be populated from another tab session (state is
    // shared); the confirm CTA must still require this view's own submitted
    // body before it spends anything.
    setState({
      preview: {
        loading: false,
        data: { ...preview, operation: 'trends' },
        error: '',
        forOperation: 'trends',
      },
    });
    renderInRouter(<TrendsView />);
    fireEvent.click(screen.getByTestId('kw-trends-confirm'));
    expect(api.fetchTrendsRequest).not.toHaveBeenCalled();
  });

  it('renders error/loading/empty states', () => {
    setState({
      trends: { loading: false, loaded: true, error: 'boom', rows: [] },
    });
    const b = renderInRouter(<TrendsView />);
    expect(screen.getByTestId('kw-trends-error')).toBeInTheDocument();
    b.unmount();
    setState({
      trends: { loading: true, loaded: false, error: '', rows: [] },
    });
    const c = renderInRouter(<TrendsView />);
    expect(screen.getByTestId('kw-trends-loading')).toBeInTheDocument();
    c.unmount();
    setState({
      trends: { loading: false, loaded: true, error: '', rows: [] },
    });
    const d = renderInRouter(<TrendsView />);
    expect(screen.getByTestId('kw-trends-empty')).toBeInTheDocument();
    d.unmount();
    setState({
      preview: { loading: false, data: null, error: 'p-err', forOperation: 'trends' },
    });
    renderInRouter(<TrendsView />);
    expect(screen.getByTestId('kw-trends-preview-error')).toHaveTextContent('p-err');
  });
});
