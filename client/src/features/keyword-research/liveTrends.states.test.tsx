/**
 * Live Keyword Trends: remaining view states and branches.
 *
 * Companion to `liveTrends.test.tsx` (which covers the happy path, chart
 * shapes, honesty labels and the XSS fixtures). This file pins the states
 * that suite does not reach:
 *   · standalone page shell (`/keyword-research/live-trends`)
 *   · chart degeneracy (single-point series) and the >5-series palette wrap
 *   · preview card variants: loading and the unmetered disclosure
 *   · stored-history row tones (failed / queued), refunded badge, active +
 *     opening affordance, list loading / list error / reopened-run detail
 *   · momentum "down" tone and a coverage-note key with no namespace dot
 *   · related-query sections in isolation (rising-only, top-only, none) and
 *     the follow-up refusal when the third-party query breaks the bounds
 *   · kill-switch fallback copy when the server sent no message
 *   · market-select changes persisting into the URL grammar
 */
import type React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@shared/i18n/locales/en/keywordResearch.json';
import ar from '@shared/i18n/locales/ar/keywordResearch.json';
import enCommon from '@shared/i18n/locales/en/common.json';
import arCommon from '@shared/i18n/locales/ar/common.json';
import { initialState } from './store/slice';
import type {
  KeywordResearchState,
  TrendsExplorationDto,
  TrendsListResponse,
  TrendsSpendPreview,
  TrendsStoredRunSummary,
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
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) => selector(hooks.state),
}));

vi.mock('@shared/markets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/markets')>()),
  useMarketCatalog: () => ({
    markets: [
      { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
      { countryCode: 'GB', locationCode: 2826, languageCodes: ['en', 'fr'] },
    ],
    loading: false,
    error: false,
  }),
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
import { KeywordLiveTrendsPage } from './components/KeywordLiveTrendsPage';

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { keywordResearch: en, common: enCommon } },
});

const arI18n = i18next.createInstance();
await arI18n.use(initReactI18next).init({
  lng: 'ar',
  resources: { ar: { keywordResearch: ar, common: arCommon } },
});

const COVERAGE_NOTE_KEY = 'keywordResearch.trends.coverageNote.searchInterestIndex';

const envelope = () => ({
  source: 'estimate' as const,
  observationMeta: { searchInterestIndexKey: COVERAGE_NOTE_KEY },
});

function setState(overrides: Partial<KeywordResearchState> = {}): void {
  hooks.state = {
    keywordResearch: {
      ...initialState,
      ...overrides,
      liveTrends: {
        ...initialState.liveTrends,
        ...(overrides.liveTrends ?? {}),
      },
    },
  };
}

function installThunkDispatch() {
  hooks.dispatch.mockImplementation((action: unknown) => {
    if (typeof action === 'function') {
      return (action as (...a: unknown[]) => unknown)(hooks.dispatch, () => hooks.state, undefined);
    }
    return action;
  });
}

function renderInRouter(node: React.ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/keyword-research/live-trends']}>{node}</MemoryRouter>
    </I18nextProvider>,
  );
}

function points(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    year: 2023,
    month: i + 1,
    value: 10 + i,
  }));
}

function exploration(overrides: Partial<TrendsExplorationDto> = {}): TrendsExplorationDto {
  return {
    runId: 'a'.repeat(24),
    status: 'succeeded',
    retained: true,
    refunded: false,
    errorCode: null,
    inputs: { keywords: ['solar'], geo: 'us', language: 'en' },
    cached: false,
    fetchedAt: '2026-07-19T00:00:00.000Z',
    window: { startDate: '2023-01-01', endDate: '2023-06-01' },
    observedAt: '2026-07-19T00:00:00.000Z',
    locationCode: 2840,
    languageCode: 'en',
    series: [{ keyword: 'solar', points: points(6), ...envelope() }],
    seriesReadouts: [
      {
        keyword: 'solar',
        readouts: {
          yoy: { deltaFraction: 0.2, ...envelope() },
          momentum: { direction: 'up', slopePerWeek: 0.4, ...envelope() },
          seasonality: { months: [6], ...envelope() },
        },
      },
    ],
    relatedQueries: [],
    createdAt: '2026-07-19T00:00:00.000Z',
    completedAt: '2026-07-19T00:00:01.000Z',
    ...overrides,
  };
}

function preview(): TrendsSpendPreview {
  return { operation: 'trends-explore' };
}

function storedRun(overrides: Partial<TrendsStoredRunSummary> = {}): TrendsStoredRunSummary {
  return {
    runId: 'b'.repeat(24),
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
    ...envelope(),
    ...overrides,
  };
}

function listOf(...runs: TrendsStoredRunSummary[]): TrendsListResponse {
  return { runs, nextCursor: null };
}

const LOADED_EMPTY_LIST = {
  loading: false,
  data: listOf(),
  error: '',
  errorKind: null,
} as const;

beforeEach(() => {
  hooks.dispatch.mockReset();
  installThunkDispatch();
  for (const mock of Object.values(api)) mock.mockReset();
  api.fetchLiveTrendsListRequest.mockResolvedValue(listOf());
  api.previewLiveTrendsRequest.mockResolvedValue(preview());
  api.exploreLiveTrendsRequest.mockResolvedValue(exploration());
  api.fetchLiveTrendsRunRequest.mockResolvedValue(storedRun());
  setState({ liveTrends: { ...initialState.liveTrends, list: { ...LOADED_EMPTY_LIST } } });
});

// ---------------------------------------------------------------------------
// Standalone page shell + mount-time history load
// ---------------------------------------------------------------------------

describe('KeywordLiveTrendsPage', () => {
  it('renders the standalone shell around the live-trends view', () => {
    renderInRouter(<KeywordLiveTrendsPage />);
    expect(screen.getByTestId('keyword-live-trends-page')).toBeInTheDocument();
    expect(screen.getByTestId('live-trends-view')).toBeInTheDocument();
  });
});

describe('LiveTrendsView — mount-time stored-history load', () => {
  it('loads the stored history once when nothing is cached yet', async () => {
    setState();
    renderInRouter(<LiveTrendsView />);
    await waitFor(() => expect(api.fetchLiveTrendsListRequest).toHaveBeenCalledWith({ limit: 20 }));
  });

  it('does not refetch when a page is already loading', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { loading: true, data: null, error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(api.fetchLiveTrendsListRequest).not.toHaveBeenCalled();
    // …and the loading affordance stands in for the list.
    expect(screen.queryByTestId('live-trends-history-empty')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Form → preview submit, market changes, follow-up refusal
// ---------------------------------------------------------------------------

describe('LiveTrendsView — form submission', () => {
  it('a valid form submit persists the URL grammar and requests a preview', async () => {
    renderInRouter(<LiveTrendsView />);
    await userEvent.type(screen.getByTestId('live-trends-input'), 'solar panels,');
    await userEvent.click(screen.getByTestId('live-trends-preview-cta'));
    await waitFor(() =>
      expect(api.previewLiveTrendsRequest).toHaveBeenCalledWith({
        keywords: ['solar panels'],
        geo: 'us',
        language: 'en',
      }),
    );
  });

  it('changing the market persists a non-default geo and language', async () => {
    renderInRouter(<LiveTrendsView />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('live-trends-location'));
    await user.click(await screen.findByRole('option', { name: /United Kingdom/ }));
    await user.selectOptions(screen.getByTestId('live-trends-language'), 'fr');
    await user.type(screen.getByTestId('live-trends-input'), 'solar,');
    await user.click(screen.getByTestId('live-trends-preview-cta'));
    await waitFor(() =>
      expect(api.previewLiveTrendsRequest).toHaveBeenCalledWith({
        keywords: ['solar'],
        geo: 'gb',
        language: 'fr',
      }),
    );
  });

  it('refuses a follow-up whose third-party query breaks the phrase bound', async () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        run: {
          loading: false,
          data: exploration({
            relatedQueries: [{ query: 'x'.repeat(240), value: 91, kind: 'rising' }],
          }),
          error: '',
          errorKind: null,
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    const [button] = screen.getAllByTestId(/^live-trends-related-rising-/);
    await userEvent.click(button!);
    expect(await screen.findByTestId('live-trends-form-error')).toBeInTheDocument();
    expect(api.previewLiveTrendsRequest).not.toHaveBeenCalled();
  });

  it('a top-query follow-up fires a new preview for that single keyword', async () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        run: {
          loading: false,
          data: exploration({
            relatedQueries: [{ query: 'solar roof', value: 70, kind: 'top' }],
          }),
          error: '',
          errorKind: null,
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    // Rising section is absent when no rising row shipped.
    expect(screen.queryByTestId(/^live-trends-related-rising-/)).toBeNull();
    await userEvent.click(screen.getByTestId('live-trends-related-top-solar-roof'));
    await waitFor(() =>
      expect(api.previewLiveTrendsRequest).toHaveBeenCalledWith(
        expect.objectContaining({ keywords: ['solar roof'] }),
      ),
    );
  });

  it('omits the related block entirely when the provider returned no queries', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        run: {
          loading: false,
          data: exploration({ relatedQueries: [] }),
          error: '',
          errorKind: null,
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.queryByTestId('live-trends-related')).toBeNull();
  });

  it('renders only the rising section when no top rows shipped', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        run: {
          loading: false,
          data: exploration({
            relatedQueries: [{ query: 'solar roof', value: 90, kind: 'rising' }],
          }),
          error: '',
          errorKind: null,
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-related-rising-solar-roof')).toBeInTheDocument();
    expect(screen.queryByTestId(/^live-trends-related-top-/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Chart degeneracy + palette wrap
// ---------------------------------------------------------------------------

describe('LiveTrendsView — chart edge cases', () => {
  it('omits the overlay when no series has two plottable points', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        run: {
          loading: false,
          data: exploration({
            series: [{ keyword: 'solar', points: points(1), ...envelope() }],
          }),
          error: '',
          errorKind: null,
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.queryByTestId('live-trends-chart')).toBeNull();
    // The accessible table fallback still ships the single observation.
    expect(within(screen.getByTestId('live-trends-table')).getAllByRole('row')).toHaveLength(2);
  });

  it('wraps back onto the first palette slot past the fifth series', () => {
    const series = Array.from({ length: 6 }, (_, i) => ({
      keyword: `kw-${i + 1}`,
      points: points(4),
      ...envelope(),
    }));
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        run: {
          loading: false,
          data: exploration({ series, seriesReadouts: [] }),
          error: '',
          errorKind: null,
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    const chart = screen.getByTestId('live-trends-chart');
    const sixth = within(chart).getByTestId('live-trends-chart-series-kw-6');
    expect(sixth.querySelector('polyline')).toHaveClass('stroke-highlight');
    expect(
      within(screen.getByTestId('live-trends-chart-legend')).getAllByRole('listitem'),
    ).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Readouts: momentum tone + namespace-less coverage-note key
// ---------------------------------------------------------------------------

describe('LiveTrendsView — readout presentation', () => {
  it('renders the falling-momentum label for a negative slope', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        run: {
          loading: false,
          data: exploration({
            seriesReadouts: [
              {
                keyword: 'solar',
                readouts: {
                  yoy: { deltaFraction: -0.3, ...envelope() },
                  momentum: {
                    direction: 'down',
                    slopePerWeek: -0.8,
                    ...envelope(),
                  },
                  seasonality: { months: [], ...envelope() },
                },
              },
            ],
          }),
          error: '',
          errorKind: null,
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    const readouts = screen.getByTestId('live-trends-readouts-solar');
    expect(within(readouts).getByTestId('live-trends-momentum-solar')).toHaveTextContent(
      en.liveTrends.readouts.direction.down,
    );
    // No detected months → the honest "no seasonality" line, not an empty list.
    expect(within(readouts).getByText(en.liveTrends.readouts.noSeasonality)).toBeInTheDocument();
  });

  it('passes a namespace-less coverage-note key through untouched', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        run: {
          loading: false,
          data: exploration({
            series: [
              {
                keyword: 'solar',
                points: points(4),
                source: 'estimate',
                observationMeta: { searchInterestIndexKey: 'searchInterestIndex' },
              },
            ],
          }),
          error: '',
          errorKind: null,
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-coverage-note')).toHaveTextContent(
      'searchInterestIndex',
    );
  });

  it('labels a cache-served exploration as cached in the results header', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        run: {
          loading: false,
          data: exploration({ cached: true }),
          error: '',
          errorKind: null,
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-results')).toHaveTextContent(
      en.liveTrends.results.cached,
    );
  });
});

// ---------------------------------------------------------------------------
// Preview card variants
// ---------------------------------------------------------------------------

describe('LiveTrendsView — preview card variants', () => {
  it('renders the unmetered usage disclosure', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        preview: {
          loading: false,
          data: preview(),
          error: '',
          errorKind: null,
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-preview')).toHaveTextContent(
      'Plan usage limits are not metered in self-hosted mode.',
    );
  });

  it('renders the preview skeleton while the estimate is in flight', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        preview: { loading: true, data: null, error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-preview-loading')).toHaveAttribute('aria-busy', 'true');
    // No confirm button before an estimate exists — nothing can be spent yet.
    expect(screen.queryByTestId('live-trends-confirm')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Honest failure states
// ---------------------------------------------------------------------------

describe('LiveTrendsView — failure and progress states', () => {
  it('falls back to shipped copy when the kill-switch response carried no message', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        preview: { loading: false, data: null, error: '', errorKind: 'unavailable' },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-kill-switch')).toHaveTextContent(
      en.liveTrends.states.unavailableBody,
    );
  });

  it('surfaces a preview failure in its own alert', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        preview: {
          loading: false,
          data: null,
          error: 'Could not estimate this exploration.',
          errorKind: 'unknown',
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-preview-error')).toHaveTextContent(
      'Could not estimate this exploration.',
    );
  });

  it('uses the generic failure title for a non-provider run failure', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        run: {
          loading: false,
          data: null,
          error: 'Something went wrong.',
          errorKind: 'unknown',
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-run-error')).toHaveTextContent(
      en.liveTrends.states.failedTitle,
    );
  });

  it('shows a polite busy region while the exploration is running', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        run: { loading: true, data: null, error: '', errorKind: null },
      },
    });
    renderInRouter(<LiveTrendsView />);
    const busy = screen.getByTestId('live-trends-submit-loading');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-live', 'polite');
  });
});

// ---------------------------------------------------------------------------
// Stored history rows
// ---------------------------------------------------------------------------

describe('LiveTrendsView — stored history', () => {
  it('renders a skeleton while the first page loads', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { loading: true, data: null, error: '', errorKind: null },
      },
    });
    const { container } = renderInRouter(<LiveTrendsView />);
    expect(
      container.querySelector('[data-testid="live-trends-history"] [data-slot="skeleton"]'),
    ).not.toBeNull();
  });

  it('renders the history error alert instead of the empty state', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: {
          loading: false,
          data: null,
          error: 'History is unavailable right now.',
          errorKind: 'unknown',
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    expect(screen.getByTestId('live-trends-history-error')).toHaveTextContent(
      'History is unavailable right now.',
    );
    expect(screen.queryByTestId('live-trends-history-empty')).toBeNull();
  });

  it('tones a failed row destructive and flags a refunded run', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: {
          loading: false,
          data: listOf(
            storedRun({
              runId: 'c'.repeat(24),
              status: 'failed',
              retained: false,
              refunded: true,
              errorCode: 'provider_failed',
              completedAt: null,
            }),
            storedRun({ runId: 'd'.repeat(24), status: 'queued', completedAt: null }),
          ),
          error: '',
          errorKind: null,
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    const failed = screen.getByTestId(`live-trends-stored-row-${'c'.repeat(24)}`);
    expect(within(failed).getByText(en.liveTrends.storedRun.refunded)).toBeInTheDocument();
    expect(within(failed).getByText(en.liveTrends.storedRun.status.failed)).toBeInTheDocument();
    const queued = screen.getByTestId(`live-trends-stored-row-${'d'.repeat(24)}`);
    expect(within(queued).getByText(en.liveTrends.storedRun.status.queued)).toBeInTheDocument();
    expect(within(queued).queryByText(en.liveTrends.storedRun.refunded)).toBeNull();
  });

  it('marks the reopened row active and shows its detail block', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: {
          loading: false,
          data: listOf(storedRun()),
          error: '',
          errorKind: null,
        },
        storedRun: {
          loading: true,
          data: storedRun({ seriesCount: 3, relatedQueryCount: 4 }),
          error: '',
          errorKind: null,
        },
      },
    });
    renderInRouter(<LiveTrendsView />);
    const row = screen.getByTestId(`live-trends-stored-row-${'b'.repeat(24)}`);
    expect(row.className).toContain('ring-2');
    // Active + loading → the shared in-button spinner affordance.
    expect(screen.getByTestId(`live-trends-stored-open-${'b'.repeat(24)}`)).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByTestId('live-trends-stored-detail')).toHaveTextContent('3');
  });
});

// ---------------------------------------------------------------------------
// Arabic RTL layout parity
// ---------------------------------------------------------------------------

describe('LiveTrendsView — Arabic RTL layout parity', () => {
  it('renders the Arabic surface with logical direction properties only', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: { ...LOADED_EMPTY_LIST },
        run: {
          loading: false,
          data: exploration({
            relatedQueries: [{ query: 'solar panels', kind: 'rising', value: 120, ...envelope() }],
          }),
          error: '',
          errorKind: null,
        },
        preview: { loading: false, data: preview(), error: '', errorKind: null },
      },
    });
    render(
      <I18nextProvider i18n={arI18n}>
        <MemoryRouter initialEntries={['/keyword-research/live-trends']}>
          <div dir="rtl" lang="ar">
            <LiveTrendsView />
          </div>
        </MemoryRouter>
      </I18nextProvider>,
    );

    // Arabic copy resolves — no English leak on the header, coverage note,
    // estimate chip, or the data-table numeric column.
    expect(screen.getByText(ar.liveTrends.title)).toBeInTheDocument();
    expect(screen.getByTestId('live-trends-coverage-note')).toHaveTextContent(
      ar.trends.coverageNote.searchInterestIndex,
    );
    expect(screen.getAllByTestId('live-trends-estimate-chip')[0]).toHaveTextContent(
      ar.liveTrends.estimateLabel,
    );
    expect(screen.getByText(ar.liveTrends.columnIndex).closest('th')).toHaveClass('text-end');

    // Every class this view owns is direction-agnostic: no physical
    // margin/padding/inset/text-align utilities that would mirror wrongly
    // under `dir="rtl"` (i18n-seven-locales rule).
    const view = screen.getByTestId('live-trends-view');
    const physical = Array.from(view.querySelectorAll('[class]'))
      .map((el) => el.getAttribute('class') ?? '')
      .filter((cls) =>
        /(^|\s)-?(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r)-|(^|\s)text-(left|right)(\s|$)/.test(
          cls,
        ),
      );
    expect(physical).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// URL-backed stored-history filter (free — never refetches, never spends)
// ---------------------------------------------------------------------------

describe('LiveTrendsView — stored-history filter', () => {
  const succeededRow = () => storedRun({ runId: 's'.repeat(24) });
  const failedRow = () => storedRun({ runId: 'f'.repeat(24), status: 'failed', refunded: true });

  function renderWithLocation(initialEntry: string) {
    const seen = { search: '' };
    const Probe = () => {
      seen.search = useLocation().search;
      return null;
    };
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <LiveTrendsView />
          <Probe />
        </MemoryRouter>
      </I18nextProvider>,
    );
    return seen;
  }

  beforeEach(() => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: {
          loading: false,
          data: listOf(succeededRow(), failedRow()),
          error: '',
          errorKind: null,
        },
      },
    });
  });

  it('shows every stored run under the default `all` filter', () => {
    renderWithLocation('/keyword-research/live-trends');
    expect(screen.getByTestId('live-trends-history-filter-all')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId(`live-trends-stored-row-${'s'.repeat(24)}`)).toBeInTheDocument();
    expect(screen.getByTestId(`live-trends-stored-row-${'f'.repeat(24)}`)).toBeInTheDocument();
  });

  it('narrows to failed runs from the URL alone and never refetches', () => {
    renderWithLocation('/keyword-research/live-trends?history=failed');
    expect(screen.queryByTestId(`live-trends-stored-row-${'s'.repeat(24)}`)).toBeNull();
    expect(screen.getByTestId(`live-trends-stored-row-${'f'.repeat(24)}`)).toBeInTheDocument();
    // A filter is a local narrow: no list reload, and above all no explore.
    expect(api.fetchLiveTrendsListRequest).not.toHaveBeenCalled();
    expect(api.exploreLiveTrendsRequest).not.toHaveBeenCalled();
  });

  it('clicking a filter chip persists it into the URL and back off again', async () => {
    const seen = renderWithLocation('/keyword-research/live-trends');
    await userEvent.click(screen.getByTestId('live-trends-history-filter-refunded'));
    await waitFor(() => expect(new URLSearchParams(seen.search).get('history')).toBe('refunded'));
    // Only the refunded run survives the narrow.
    expect(screen.queryByTestId(`live-trends-stored-row-${'s'.repeat(24)}`)).toBeNull();
    await userEvent.click(screen.getByTestId('live-trends-history-filter-all'));
    await waitFor(() => expect(new URLSearchParams(seen.search).get('history')).toBeNull());
  });

  it('reopening a stored run under a filter stays FREE', async () => {
    renderWithLocation('/keyword-research/live-trends?history=succeeded');
    await userEvent.click(screen.getByTestId(`live-trends-stored-open-${'s'.repeat(24)}`));
    await waitFor(() => expect(api.fetchLiveTrendsRunRequest).toHaveBeenCalledWith('s'.repeat(24)));
    expect(api.previewLiveTrendsRequest).not.toHaveBeenCalled();
    expect(api.exploreLiveTrendsRequest).not.toHaveBeenCalled();
  });

  it('renders honest copy when the filter matches nothing yet rows exist', () => {
    setState({
      liveTrends: {
        ...initialState.liveTrends,
        list: {
          loading: false,
          data: listOf(succeededRow()),
          error: '',
          errorKind: null,
        },
      },
    });
    renderWithLocation('/keyword-research/live-trends?history=refunded');
    expect(screen.getByTestId('live-trends-history-empty')).toHaveTextContent(
      en.liveTrends.storedRun.emptyFiltered,
    );
  });

  it('falls back to the never-explored copy when nothing is stored at all', () => {
    setState({ liveTrends: { ...initialState.liveTrends, list: { ...LOADED_EMPTY_LIST } } });
    renderWithLocation('/keyword-research/live-trends?history=failed');
    expect(screen.getByTestId('live-trends-history-empty')).toHaveTextContent(
      en.liveTrends.storedRun.empty,
    );
  });
});
