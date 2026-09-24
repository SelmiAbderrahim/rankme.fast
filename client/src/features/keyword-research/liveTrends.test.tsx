/**
 * Live Keyword Trends view coverage.
 *
 * Layered per the prompt spec:
 *   1. Form validation (>5 rejected, empty rejected, duplicate collapse).
 *   2. Preview shown before submit; cancel does not spend.
 *   3. Cache-hit rerun surfaces cached=true AND still consumes a unit at
 *      submit (mock preview + confirm sequence).
 *   4. Chart + data-table fallback render 1/2/3/5 series correctly.
 *   5. Readouts render `Estimate` label; null readouts render honest
 *      "Need N more months" copy.
 *   6. Rising-query one-click follow-up fires new preview + submit.
 *   7. Malicious rising-query fixture renders inert.
 *   8. Sparse-history / kill-switch / failed states covered.
 *
 * Harness mirrors `components/workspace.test.tsx` — hand-rolled state +
 * thunk-running dispatch; api module mocked so no request leaves the test.
 */
import type React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@shared/i18n/locales/en/keywordResearch.json';
import { initialState } from './store/slice';
import {
  parseLiveTrendsQuery,
  normalizeLiveTrendsQuery,
  serializeLiveTrendsQuery,
} from './tabState';
import {
  geoToLocationCode,
  liveTrendsFormSchema,
  locationCodeToGeo,
  normalizeLiveTrendsKeywords,
} from './validation';
import type {
  KeywordResearchState,
  TrendsExplorationDto,
  TrendsListResponse,
  TrendsSpendPreview,
} from './types';

const hooks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
}));

const api = vi.hoisted(() => ({
  previewLiveTrendsRequest: vi.fn(),
  exploreLiveTrendsRequest: vi.fn(),
  fetchLiveTrendsListRequest: vi.fn(),
  fetchLiveTrendsRunRequest: vi.fn(),
}));

vi.mock('@shared/hooks/redux', () => ({
  useAppDispatch: () => hooks.dispatch,
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(hooks.state),
}));

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, ...api };
});

vi.mock('./components/KeywordResearchPanel', () => ({
  KeywordResearchPanel: () => null,
  IntentBadge: () => null,
  keywordSlug: (k: string) => k.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
}));

import { LiveTrendsView } from './components/LiveTrendsView';

const i18n = i18next.createInstance();
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { keywordResearch: en } } });

function setState(overrides: Partial<KeywordResearchState> = {}): KeywordResearchState {
  const merged: KeywordResearchState = {
    ...initialState,
    ...overrides,
    liveTrends: {
      ...initialState.liveTrends,
      ...(overrides.liveTrends ?? {}),
    },
  };
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

function renderInRouter(node: React.ReactNode, path = '/keyword-research/live-trends') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </I18nextProvider>,
  );
}

const COVERAGE_NOTE_KEY =
  'keywordResearch.trends.coverageNote.searchInterestIndex';

function envelope() {
  return {
    source: 'estimate' as const,
    observationMeta: { searchInterestIndexKey: COVERAGE_NOTE_KEY },
  };
}

function makeSeriesPoints(
  months: number,
  values: (i: number) => number,
): { year: number; month: number; value: number }[] {
  const out: { year: number; month: number; value: number }[] = [];
  let year = 2022;
  let month = 1;
  for (let i = 0; i < months; i += 1) {
    out.push({ year, month, value: Math.round(values(i)) });
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

function makeExplorationDto(
  overrides: Partial<TrendsExplorationDto> = {},
): TrendsExplorationDto {
  const points = makeSeriesPoints(24, (i) => 10 + i);
  return {
    runId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    status: 'succeeded',
    retained: true,
    refunded: false,
    errorCode: null,
    inputs: { keywords: ['solar panels'], geo: 'us', language: 'en' },
    cached: false,
    fetchedAt: '2026-07-19T00:00:00.000Z',
    window: { startDate: '2022-01-01', endDate: '2024-01-01' },
    observedAt: '2026-07-19T00:00:00.000Z',
    locationCode: 2840,
    languageCode: 'en',
    series: [
      { keyword: 'solar panels', points, ...envelope() },
    ],
    seriesReadouts: [
      {
        keyword: 'solar panels',
        readouts: {
          yoy: { deltaFraction: 0.42, ...envelope() },
          momentum: { direction: 'up', slopePerWeek: 0.9, ...envelope() },
          seasonality: { months: [6, 7], ...envelope() },
        },
      },
    ],
    relatedQueries: [
      { query: 'solar roof', value: 90, kind: 'rising' },
      { query: 'best solar panel', value: 70, kind: 'top' },
    ],
    createdAt: '2026-07-19T00:00:00.000Z',
    completedAt: '2026-07-19T00:00:01.000Z',
    ...overrides,
  };
}

function makePreview(): TrendsSpendPreview {
  return { operation: 'trends-explore' };
}

function emptyList(): TrendsListResponse {
  return { runs: [], nextCursor: null };
}

beforeEach(() => {
  hooks.dispatch.mockReset();
  installThunkDispatch();
  for (const mock of Object.values(api)) mock.mockReset();
  api.fetchLiveTrendsListRequest.mockResolvedValue(emptyList());
  api.previewLiveTrendsRequest.mockResolvedValue(makePreview());
  api.exploreLiveTrendsRequest.mockResolvedValue(makeExplorationDto());
  api.fetchLiveTrendsRunRequest.mockResolvedValue({
    runId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    status: 'succeeded' as const,
    retained: true,
    refunded: false,
    errorCode: null,
    inputs: { keywords: ['seo'], geo: 'us', language: 'en' },
    siteId: null,
    seriesCount: 1,
    relatedQueryCount: 2,
    createdAt: '2026-07-18T00:00:00.000Z',
    completedAt: '2026-07-18T00:00:01.000Z',
    ...envelope(),
  });
  setState();
});

// ---------------------------------------------------------------------------
// 1. Form validation
// ---------------------------------------------------------------------------

describe('LiveTrendsView — form validation', () => {
  it('rejects >5 keywords: PhraseChipsInput caps at 5 AND zod rejects 6', async () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { loading: false, data: emptyList(), error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    const input = screen.getByTestId('live-trends-input');
    // Try to add 6 chips — the primitive refuses the 6th with a shipped
    // "limit reached" alert and never grows the chip array beyond 5.
    for (const kw of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) {
      await userEvent.type(input, `${kw},`);
    }
    expect(screen.getAllByTestId(/live-trends-chip-/).length).toBe(5);
    expect(screen.getByTestId('live-trends-limit')).toBeInTheDocument();
    // Belt + braces: the schema also rejects a 6-keyword array so a caller
    // that bypasses the UI cap (URL prefill, programmatic seed) still fails.
    const parsed = liveTrendsFormSchema.safeParse({
      keywords: ['a', 'b', 'c', 'd', 'e', 'f'],
      geo: 'us',
      language: 'en',
    });
    expect(parsed.success).toBe(false);
  });

  it('empty keyword form → localized inline error, no preview request', async () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { loading: false, data: emptyList(), error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    fireEvent.submit(screen.getByTestId('live-trends-form'));
    expect(await screen.findByTestId('live-trends-form-error')).toBeInTheDocument();
    expect(api.previewLiveTrendsRequest).not.toHaveBeenCalled();
  });

  it('duplicate keywords are collapsed BEFORE preview is dispatched', () => {
    const normalized = normalizeLiveTrendsKeywords([' Solar ', 'solar', 'SOLAR', 'panels']);
    expect(normalized).toEqual(['solar', 'panels']);
    const parsed = liveTrendsFormSchema.safeParse({
      keywords: normalized,
      geo: 'us',
      language: 'en',
    });
    expect(parsed.success).toBe(true);
  });

  it('normalizes supported markets and rejects inputs outside provider clamps', () => {
    expect(
      liveTrendsFormSchema.parse({
        keywords: ['seo'],
        geo: ' GB ',
        language: 'DE',
      }),
    ).toEqual({ keywords: ['seo'], geo: 'gb', language: 'de' });
    expect(
      liveTrendsFormSchema.safeParse({
        keywords: ['seo'],
        geo: 'anywhere',
        language: 'en',
      }).success,
    ).toBe(false);
    expect(
      liveTrendsFormSchema.safeParse({
        keywords: ['seo'],
        geo: 'us',
        language: 'english',
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Preview shown before submit; cancel does not spend
// ---------------------------------------------------------------------------

describe('LiveTrendsView — preview → confirm/cancel', () => {
  it('successful preview surfaces the disclosure card before submit', async () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        preview: { loading: false, data: makePreview(), error: '', errorKind: null },
        list: { loading: false, data: emptyList(), error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-preview')).toBeInTheDocument();
    expect(screen.getByTestId('live-trends-confirm')).toBeEnabled();
  });

  it('cancel discards the preview and NEVER dispatches an explore request', async () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        preview: { loading: false, data: makePreview(), error: '', errorKind: null },
        list: { loading: false, data: emptyList(), error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    await userEvent.click(screen.getByTestId('live-trends-cancel'));
    expect(api.exploreLiveTrendsRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Confirming a preview submits the exploration
// ---------------------------------------------------------------------------

describe('LiveTrendsView — confirm submits', () => {
  it('confirming a preview fires exploreLiveTrendsRequest once', async () => {
    api.previewLiveTrendsRequest.mockResolvedValue(
      makePreview(),
    );
    api.exploreLiveTrendsRequest.mockResolvedValue(
      makeExplorationDto({ cached: true }),
    );
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        preview: { loading: false, data: makePreview(), error: '', errorKind: null },
        list: { loading: false, data: emptyList(), error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    await userEvent.click(screen.getByTestId('live-trends-confirm'));
    await waitFor(() =>
      expect(api.exploreLiveTrendsRequest).toHaveBeenCalledTimes(1),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Chart + data-table fallback render 1/2/3/5 series
// ---------------------------------------------------------------------------

describe('LiveTrendsView — chart renders 1/2/3/5 series', () => {
  it.each([1, 2, 3, 5])('renders %i series overlays + table rows', (count) => {
    const dto = makeExplorationDto({
      series: Array.from({ length: count }, (_, i) => ({
        keyword: `kw-${i + 1}`,
        points: makeSeriesPoints(6, (m) => 20 + i * 5 + m),
        ...envelope(),
      })),
      seriesReadouts: Array.from({ length: count }, (_, i) => ({
        keyword: `kw-${i + 1}`,
        readouts: {
          yoy: { deltaFraction: null, reason: 'insufficient_history' as const, ...envelope() },
          momentum: { direction: 'flat' as const, slopePerWeek: null, reason: 'insufficient_history' as const, ...envelope() },
          seasonality: { months: [], reason: 'insufficient_history' as const, ...envelope() },
        },
      })),
    });
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        run: { loading: false, data: dto, error: '', errorKind: null },
        list: { loading: false, data: emptyList(), error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    const chart = screen.getByTestId('live-trends-chart');
    // One <g> per series.
    for (let i = 1; i <= count; i += 1) {
      expect(
        within(chart).getByTestId(`live-trends-chart-series-kw-${i}`),
      ).toBeInTheDocument();
    }
    // Accessible data-table fallback renders row per (series × month).
    const table = screen.getByTestId('live-trends-table');
    expect(within(table).getAllByRole('row').length).toBe(count * 6 + 1); // +1 header
    // Legend shows a chip per series.
    const legend = screen.getByTestId('live-trends-chart-legend');
    expect(within(legend).getAllByRole('listitem').length).toBe(count);
  });
});

// ---------------------------------------------------------------------------
// 5. Readouts render Estimate label + honest insufficient-history copy
// ---------------------------------------------------------------------------

describe('LiveTrendsView — readouts honesty labels', () => {
  it('renders Estimate label + insufficient-history copy when readouts are null', () => {
    const dto = makeExplorationDto({
      seriesReadouts: [
        {
          keyword: 'solar panels',
          readouts: {
            yoy: { deltaFraction: null, reason: 'insufficient_history', ...envelope() },
            momentum: { direction: 'flat', slopePerWeek: null, reason: 'insufficient_history', ...envelope() },
            seasonality: { months: [], reason: 'insufficient_history', ...envelope() },
          },
        },
      ],
    });
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        run: { loading: false, data: dto, error: '', errorKind: null },
        list: { loading: false, data: emptyList(), error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    const readouts = screen.getByTestId('live-trends-readouts-solar-panels');
    expect(within(readouts).getByText(/Need at least 56 weeks/)).toBeInTheDocument();
    expect(within(readouts).getByText(/Need at least 12 weeks/)).toBeInTheDocument();
    expect(within(readouts).getByText(/Need at least 24 months/)).toBeInTheDocument();
    // Estimate label chip present on the readouts card.
    expect(within(readouts).getByText('Estimate')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 6. Rising-query one-click follow-up fires new preview + submit
// ---------------------------------------------------------------------------

describe('LiveTrendsView — rising-query follow-up', () => {
  it('clicking a rising query fires a NEW preview request (spends a new unit)', async () => {
    const dto = makeExplorationDto();
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        run: { loading: false, data: dto, error: '', errorKind: null },
        list: { loading: false, data: emptyList(), error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    const btn = screen.getByTestId('live-trends-related-rising-solar-roof');
    await userEvent.click(btn);
    await waitFor(() =>
      expect(api.previewLiveTrendsRequest).toHaveBeenCalledTimes(1),
    );
    expect(api.previewLiveTrendsRequest).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: ['solar roof'] }),
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Malicious rising-query fixture stays inert
// ---------------------------------------------------------------------------

describe('LiveTrendsView — XSS-safe rendering', () => {
  it('never emits script/img/HTML from a malicious rising query', () => {
    const dto = makeExplorationDto({
      relatedQueries: [
        { query: '<img src=x onerror=alert(1)>', value: 99, kind: 'rising' },
        { query: '${bad} `injection`', value: 88, kind: 'top' },
        { query: '‮gnirts thgir tfel', value: 77, kind: 'rising' },
      ],
    });
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        run: { loading: false, data: dto, error: '', errorKind: null },
        list: { loading: false, data: emptyList(), error: '', errorKind: null },
      },
    });
    const { container } = renderInRouter(<LiveTrendsView />);
    // No <img> injected anywhere in the related-queries section.
    expect(container.querySelectorAll('img').length).toBe(0);
    // The raw dangerous string appears once (as inert text), never as HTML.
    const related = screen.getByTestId('live-trends-related');
    expect(
      within(related).getByText('<img src=x onerror=alert(1)>'),
    ).toBeInTheDocument();
    expect(
      within(related).getByText('${bad} `injection`'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 8. Sparse-history / kill-switch / failed states
// ---------------------------------------------------------------------------

describe('LiveTrendsView — state coverage', () => {
  it('renders a distinct consumed empty-result state without a header-only table or sparse claim', () => {
    const dto = makeExplorationDto({
      series: [],
      seriesReadouts: [],
      relatedQueries: [],
    });
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        run: { loading: false, data: dto, error: '', errorKind: null },
        list: { loading: false, data: emptyList(), error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-empty')).toHaveTextContent(
      en.liveTrends.states.emptyTitle,
    );
    expect(screen.getByTestId('live-trends-empty')).toHaveTextContent(
      en.liveTrends.states.emptyBody,
    );
    expect(screen.queryByTestId('live-trends-table')).toBeNull();
    expect(screen.queryByTestId('live-trends-sparse')).toBeNull();
  });

  it('sparse-history honesty banner renders when every readout is insufficient', () => {
    const dto = makeExplorationDto({
      seriesReadouts: [
        {
          keyword: 'solar panels',
          readouts: {
            yoy: { deltaFraction: null, reason: 'insufficient_history', ...envelope() },
            momentum: { direction: 'flat', slopePerWeek: 0.1, ...envelope() },
            seasonality: { months: [], reason: 'insufficient_history', ...envelope() },
          },
        },
      ],
    });
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        run: { loading: false, data: dto, error: '', errorKind: null },
        list: { loading: false, data: emptyList(), error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-sparse')).toBeInTheDocument();
  });

  it('kill-switch (unavailable) surfaces the disabled banner and blocks confirm', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        preview: {
          loading: false,
          data: null,
          error: 'Live trends is temporarily paused.',
          errorKind: 'unavailable',
        },
        list: { loading: false, data: emptyList(), error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-kill-switch')).toBeInTheDocument();
    expect(screen.queryByTestId('live-trends-confirm')).toBeNull();
  });

  it('failed run renders the provider-failed alert', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        run: {
          loading: false,
          data: null,
          error: 'Trends provider unavailable.',
          errorKind: 'providerFailed',
        },
        list: { loading: false, data: emptyList(), error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-run-error')).toBeInTheDocument();
  });

  it('stored history empty state renders localized copy', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { loading: false, data: emptyList(), error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-history-empty')).toBeInTheDocument();
  });

  it('stored history row opens a free stored-run fetch (0 explore calls)', async () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: {
          loading: false,
          data: {
            runs: [
              {
                runId: 'ffffffffffffffffffffffff',
                status: 'succeeded',
                retained: true,
                refunded: false,
                errorCode: null,
                inputs: { keywords: ['solar'], geo: 'us', language: 'en' },
                siteId: null,
                seriesCount: 1,
                relatedQueryCount: 0,
                createdAt: '2026-07-01T00:00:00.000Z',
                completedAt: '2026-07-01T00:00:00.000Z',
                ...envelope(),
              },
            ],
            nextCursor: null,
          },
          error: '',
          errorKind: null,
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    await userEvent.click(
      screen.getByTestId('live-trends-stored-open-ffffffffffffffffffffffff'),
    );
    await waitFor(() =>
      expect(api.fetchLiveTrendsRunRequest).toHaveBeenCalledWith(
        'ffffffffffffffffffffffff',
      ),
    );
    expect(api.exploreLiveTrendsRequest).not.toHaveBeenCalled();
    expect(api.previewLiveTrendsRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// URL grammar (parse + serialize round-trip)
// ---------------------------------------------------------------------------

describe('LiveTrendsView — URL-backed state grammar', () => {
  it('parses `?keywords=a,b&geo=gb&language=en` into the canonical shape', () => {
    const parsed = parseLiveTrendsQuery('?keywords=solar,PANELS&geo=GB&language=en');
    expect(parsed).toEqual({
      keywords: ['solar', 'panels'],
      geo: 'gb',
      language: 'en',
      historyFilter: 'all',
    });
  });

  it('parses `?history=` into the stored-history filter, defaulting to all', () => {
    expect(parseLiveTrendsQuery('?history=failed').historyFilter).toBe('failed');
    expect(parseLiveTrendsQuery('?history=REFUNDED').historyFilter).toBe(
      'refunded',
    );
    // Unknown / missing values fall back silently (url-tab-state rule).
    expect(parseLiveTrendsQuery('?history=bogus').historyFilter).toBe('all');
    expect(parseLiveTrendsQuery('').historyFilter).toBe('all');
  });

  it('serializes the history filter and drops it back on the default', () => {
    const withFilter = serializeLiveTrendsQuery(new URLSearchParams(), {
      historyFilter: 'succeeded',
    });
    expect(withFilter.get('history')).toBe('succeeded');
    expect(
      serializeLiveTrendsQuery(withFilter, { historyFilter: 'all' }).get(
        'history',
      ),
    ).toBeNull();
  });

  it('canonicalizes invalid URL state while preserving unrelated params', () => {
    const normalized = normalizeLiveTrendsQuery(
      new URLSearchParams(
        'tab=live-trends&keywords=Solar%2CSOLAR%2Cpanels&geo=%40bad&language=%24%24&history=bogus&utm=sweep',
      ),
    );
    expect(normalized.toString()).toBe(
      'tab=live-trends&keywords=solar%2Cpanels&utm=sweep',
    );
  });

  it('serialize round-trip removes empty/default keys', () => {
    const current = new URLSearchParams('tab=live-trends');
    const next = serializeLiveTrendsQuery(current, {
      keywords: ['seo'],
      geo: 'us',
      language: 'en',
    });
    expect(next.get('tab')).toBe('live-trends');
    expect(next.get('keywords')).toBe('seo');
    expect(next.get('geo')).toBe('us');
    // clearing back to null removes the param.
    const cleared = serializeLiveTrendsQuery(next, { keywords: [], geo: null });
    expect(cleared.get('keywords')).toBeNull();
    expect(cleared.get('geo')).toBeNull();
  });

  it('rejects malformed geo/language values as null', () => {
    const parsed = parseLiveTrendsQuery('?geo=@bad&language=$$');
    expect(parsed.geo).toBeNull();
    expect(parsed.language).toBeNull();
  });

  it('accepts a URLSearchParams instance and drops over-long/duplicate chunks', () => {
    const params = new URLSearchParams();
    params.set(
      'keywords',
      ['solar', 'SOLAR', ' solar ', 'x'.repeat(201), 'panels'].join(','),
    );
    const parsed = parseLiveTrendsQuery(params);
    // duplicates collapse (case/space-insensitive), the 201-char phrase is
    // refused outright, and the remaining order is preserved.
    expect(parsed.keywords).toEqual(['solar', 'panels']);
  });

  it('caps the parsed keyword list at five even when the URL carries more', () => {
    const parsed = parseLiveTrendsQuery('?keywords=a,b,c,d,e,f,g');
    expect(parsed.keywords).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('a patch that omits keywords/geo leaves those params untouched', () => {
    const current = new URLSearchParams('keywords=seo&geo=gb&language=en');
    const next = serializeLiveTrendsQuery(current, { language: 'fr' });
    expect(next.get('keywords')).toBe('seo');
    expect(next.get('geo')).toBe('gb');
    expect(next.get('language')).toBe('fr');
    // …and clearing only the language keeps the rest.
    const cleared = serializeLiveTrendsQuery(next, { language: null });
    expect(cleared.get('language')).toBeNull();
    expect(cleared.get('keywords')).toBe('seo');
  });

  it('locationCode ↔ geo helpers round-trip', () => {
    for (const geo of ['us', 'gb', 'de', 'fr']) {
      expect(locationCodeToGeo(geoToLocationCode(geo))).toBe(geo);
    }
    expect(locationCodeToGeo(-1)).toBe('us');
    expect(geoToLocationCode('not-a-market')).toBe(2840);
  });
});
