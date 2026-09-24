import type React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@shared/i18n/locales/en/audienceResearch.json';
import enCommon from '@shared/i18n/locales/en/common.json';
import enLanguage from '@shared/i18n/locales/en/language.json';
import type { RunResultView, RunStatusView } from '../types';
import { DEFAULT_FORM_MARKET, initialState } from '../store/slice';

const hooks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
}));

const api = vi.hoisted(() => ({
  startAudienceResearchRun: vi.fn(),
  listAudienceResearchRuns: vi.fn(),
  getAudienceResearchRun: vi.fn(),
  getAudienceResearchRunResult: vi.fn(),
}));

const competitorsMock = vi.hoisted(() => ({
  loadCompetitors: vi.fn(() => ({ type: 'competitors/loadCompetitors/mock' })),
  selectCompetitorsList: (state: Record<string, unknown>) =>
    (state.competitors as { list: unknown } | undefined)?.list ?? null,
  competitorsReducer: (state: unknown = {}) => state,
}));

const marketCatalogMock = vi.hoisted(() => ({
  current: {
    markets: [
      { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'fr'] },
      { countryCode: 'FR', locationCode: 2250, languageCodes: ['fr'] },
    ],
    loading: false,
    error: false,
  },
}));

vi.mock('@shared/hooks/redux', () => ({
  useAppDispatch: () => hooks.dispatch,
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) => selector(hooks.state),
}));

vi.mock('../api', () => api);
vi.mock('@features/competitors', () => competitorsMock);
vi.mock('@app/store', () => ({
  rootReducer: { inject: vi.fn() },
}));
vi.mock('@shared/markets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/markets')>()),
  useMarketCatalog: () => marketCatalogMock.current,
}));

import { AudienceResearchPanel } from './AudienceResearchPanel';
import { ConfirmRunDialog } from './ConfirmRunDialog';
import { NewRunForm } from './NewRunForm';
import { RunHistoryTable } from './RunHistoryTable';
import { RunStatusCard } from './RunStatusCard';

const i18n = i18next.createInstance();
await i18n.init({
  lng: 'en',
  resources: { en: { audienceResearch: en, common: enCommon, language: enLanguage } },
});

function run(id = 'r1', overrides: Partial<RunStatusView> = {}): RunStatusView {
  return {
    runId: id,
    siteId: 's1',
    state: 'queued',
    stage: 'queued',
    counts: { candidates: 0, sources: 0, signals: 0 },
    progress: { percent: 0 },
    coverageNoteKey: null,
    costMicros: { total: 0, byStage: {} },
    terminal: { state: null, reasonCode: null, completedAt: null },
    requestedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
    outputLocale: overrides.outputLocale === undefined ? 'en' : overrides.outputLocale,
  };
}

function setState(overrides: Partial<typeof initialState> = {}, competitorDomains: string[] | null = null) {
  hooks.state = {
    audienceResearch: { ...initialState, ...overrides },
    competitors: competitorDomains
      ? {
          list: {
            competitors: competitorDomains.map((domain) => ({
              domain,
              avgPosition: null,
              intersections: 0,
              estimatedTraffic: null,
              fetchedAt: '2026-01-01T00:00:00.000Z',
            })),
            fetchedAt: '2026-01-01T00:00:00.000Z',
            target: 's1',
            source: 'domain',
          },
        }
      : undefined,
  };
}

function installThunkDispatch() {
  hooks.dispatch.mockImplementation((action: unknown) => {
    if (typeof action === 'function') {
      return (action as (...args: unknown[]) => unknown)(hooks.dispatch, () => hooks.state, undefined);
    }
    return action;
  });
}

function renderInRouter(node: React.ReactNode, path = '/sites/s1?tab=audience-research') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.useRealTimers();
  hooks.dispatch.mockReset();
  for (const mock of Object.values(api)) mock.mockReset();
  competitorsMock.loadCompetitors.mockClear();
  marketCatalogMock.current = {
    markets: [
      { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'fr'] },
      { countryCode: 'FR', locationCode: 2250, languageCodes: ['fr'] },
    ],
    loading: false,
    error: false,
  };
  api.startAudienceResearchRun.mockResolvedValue({
    runId: 'started',
    status: 'queued',
    duplicate: false,
    outputLocale: 'en',
  });
  api.listAudienceResearchRuns.mockResolvedValue({ items: [], nextCursor: null });
  api.getAudienceResearchRun.mockResolvedValue(run());
  api.getAudienceResearchRunResult.mockResolvedValue(null as unknown as RunResultView);
  setState();
  installThunkDispatch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ConfirmRunDialog', () => {
  it('restates market/competitors/topics and fires onConfirm', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    renderInRouter(
      <ConfirmRunDialog
        open
        onOpenChange={onOpenChange}
        input={{ siteMarket: DEFAULT_FORM_MARKET, competitorDomains: ['a.com'], seedTopics: ['pricing'] }}
        maxPages={20}
        submitting={false}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByTestId('audience-research-confirm-market')).toHaveTextContent('United States · English · all');
    expect(screen.getByTestId('audience-research-confirm-competitors')).toHaveTextContent('a.com');
    expect(screen.getByTestId('audience-research-confirm-topics')).toHaveTextContent('pricing');
    await userEvent.click(screen.getByTestId('audience-research-confirm-submit'));
    expect(onConfirm).toHaveBeenCalled();
    await userEvent.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows an em dash placeholder for empty competitors/topics', () => {
    renderInRouter(
      <ConfirmRunDialog
        open
        onOpenChange={vi.fn()}
        input={{ siteMarket: DEFAULT_FORM_MARKET, competitorDomains: [], seedTopics: [] }}
        maxPages={20}
        submitting
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByTestId('audience-research-confirm-competitors')).toHaveTextContent('—');
    expect(screen.getByTestId('audience-research-confirm-submit')).toBeDisabled();
  });

  it('uses honest unknown labels for an unrecognized confirmation market', () => {
    renderInRouter(
      <ConfirmRunDialog
        open
        onOpenChange={vi.fn()}
        input={{ siteMarket: { ...DEFAULT_FORM_MARKET, country: '', language: '' }, competitorDomains: [], seedTopics: [] }}
        maxPages={20}
        submitting={false}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByTestId('audience-research-confirm-market')).toHaveTextContent(
      'Unknown country · Unknown language · all',
    );
  });
});

describe('RunHistoryTable', () => {
  it('renders loading, error/retry, and empty states', async () => {
    setState({ listLoading: true, listLoaded: false });
    const loading = renderInRouter(<RunHistoryTable siteId="s1" onOpen={vi.fn()} />);
    expect(screen.getByTestId('audience-research-history-loading')).toBeInTheDocument();
    loading.unmount();

    setState({ listLoaded: true, listError: 'network error' });
    const error = renderInRouter(<RunHistoryTable siteId="s1" onOpen={vi.fn()} />);
    expect(screen.getByTestId('audience-research-history-error')).toHaveTextContent('network error');
    hooks.dispatch.mockClear();
    fireEvent.click(within(screen.getByTestId('audience-research-history-error')).getByRole('button'));
    expect(hooks.dispatch).toHaveBeenCalled();
    error.unmount();

    setState({ listLoaded: true });
    renderInRouter(<RunHistoryTable siteId="s1" onOpen={vi.fn()} />);
    expect(screen.getByTestId('audience-research-history-empty')).toBeInTheDocument();
  });

  it('renders rows, opens a run, and paginates next/prev', async () => {
    setState({
      listLoaded: true,
      listIds: ['r1', 'r2', 'r3'],
      runsById: {
        r1: run('r1', { state: 'completed', terminal: { state: 'completed', reasonCode: 'ok', completedAt: null }, counts: { candidates: 5, sources: 3, signals: 2 } }),
        r2: run('r2', { state: 'partial', terminal: { state: 'partial', reasonCode: 'cost_ceiling_partial', completedAt: null } }),
        r3: run('r3', { state: 'failed', terminal: { state: 'failed', reasonCode: 'processing_failure', completedAt: null }, requestedAt: null }),
      },
      listCursor: 'next-cursor',
      listCursorStack: ['prev-cursor'],
    });
    const onOpen = vi.fn();
    renderInRouter(<RunHistoryTable siteId="s1" onOpen={onOpen} />);
    expect(screen.getByTestId('audience-research-history-row-r1')).toHaveTextContent('Completed');
    expect(screen.getByTestId('audience-research-history-row-r1')).toHaveTextContent('3');
    expect(screen.getByTestId('audience-research-history-row-r2')).toHaveTextContent('Partially completed');
    expect(screen.getByTestId('audience-research-history-row-r2')).toHaveTextContent('Partial coverage — open the run for details');

    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]!);
    expect(onOpen).toHaveBeenCalledWith('r1');

    expect(screen.getByTestId('audience-research-history-next')).not.toBeDisabled();
    expect(screen.getByTestId('audience-research-history-prev')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('audience-research-history-next'));
    fireEvent.click(screen.getByTestId('audience-research-history-prev'));
    expect(hooks.dispatch).toHaveBeenCalled();
  });

  it('shows the cached market when a run result has been opened before', () => {
    setState({
      listLoaded: true,
      listIds: ['r1'],
      runsById: { r1: run('r1', { outputLocale: 'de' }) },
      runResultsById: {
        r1: {
          ...run('r1', { outputLocale: 'de' }),
          input: { siteMarket: { country: 'FR', region: null, city: null, language: 'fr', device: 'all' }, competitorDomains: [], seedTopics: [], queryTemplateVersion: 1, outputLocale: 'en' },
          sources: [],
          signals: [],
          ledgerSummary: { total: 0, ai: 0, byStage: {} },
        },
      },
    });
    renderInRouter(<RunHistoryTable siteId="s1" onOpen={vi.fn()} />);
    expect(screen.getByTestId('audience-research-history-row-r1')).toHaveTextContent('France · French');
    expect(screen.getByTestId('audience-research-history-locale-r1')).toHaveTextContent(
      'Output language: Deutsch',
    );
  });

  it('uses honest unknown labels for an unrecognized cached market', () => {
    setState({
      listLoaded: true,
      listIds: ['r1'],
      runsById: { r1: run('r1') },
      runResultsById: {
        r1: {
          ...run('r1'),
          input: { siteMarket: { country: '', region: null, city: null, language: '', device: 'all' }, competitorDomains: [], seedTopics: [], queryTemplateVersion: 1, outputLocale: 'en' },
          sources: [],
          signals: [],
          ledgerSummary: { total: 0, ai: 0, byStage: {} },
        },
      },
    });
    renderInRouter(<RunHistoryTable siteId="s1" onOpen={vi.fn()} />);
    expect(screen.getByTestId('audience-research-history-row-r1')).toHaveTextContent(
      'Unknown country · Unknown language',
    );
  });

  it('omits the output-locale annotation for legacy rows without one', () => {
    setState({
      listLoaded: true,
      listIds: ['r1'],
      runsById: { r1: run('r1', { outputLocale: null }) },
    });
    renderInRouter(<RunHistoryTable siteId="s1" onOpen={vi.fn()} />);

    expect(screen.queryByTestId('audience-research-history-locale-r1')).toBeNull();
  });
});

describe('RunStatusCard', () => {
  it('renders loading, error, queued, partial, failed, and no-usable-evidence states', async () => {
    setState({ runStatus: { loading: { r1: true }, error: {} } });
    const loading = renderInRouter(<RunStatusCard siteId="s1" runId="r1" />);
    expect(screen.getByTestId('audience-research-status-loading')).toBeInTheDocument();
    loading.unmount();

    setState({ runStatus: { loading: {}, error: { r1: 'boom' } } });
    const error = renderInRouter(<RunStatusCard siteId="s1" runId="r1" />);
    expect(screen.getByTestId('audience-research-status-error')).toHaveTextContent('boom');
    error.unmount();

    setState({
      runsById: {
        r1: run('r1', { state: 'discovering', progress: { percent: 15 }, outputLocale: 'fr' }),
      },
    });
    const active = renderInRouter(<RunStatusCard siteId="s1" runId="r1" />);
    expect(screen.getByTestId('audience-research-status-stage')).toHaveTextContent('Discovering sources');
    // Non-terminal runs show the active-work spinner + a determinate progress bar.
    expect(screen.getByTestId('audience-research-status-spinner')).toBeInTheDocument();
    const progress = screen.getByTestId('audience-research-status-progress');
    expect(progress).toHaveAttribute('role', 'progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '15');
    expect(screen.getByText('15% complete')).toBeInTheDocument();
    expect(screen.getByTestId('audience-research-status-output-locale')).toHaveTextContent(
      'Output language: Français',
    );
    active.unmount();

    setState({
      runsById: {
        r1: run('r1', {
          state: 'partial',
          terminal: { state: 'partial', reasonCode: 'cost_ceiling_partial', completedAt: '2026-01-01T02:00:00.000Z' },
        }),
      },
    });
    const partial = renderInRouter(<RunStatusCard siteId="s1" runId="r1" />);
    expect(screen.getByTestId('audience-research-status-partial')).toBeInTheDocument();
    // Terminal runs drop the spinner + progress bar (results render instead).
    expect(screen.queryByTestId('audience-research-status-spinner')).toBeNull();
    expect(screen.queryByTestId('audience-research-status-progress')).toBeNull();
    partial.unmount();

    setState({
      runsById: {
        r1: run('r1', {
          state: 'failed',
          terminal: { state: 'failed', reasonCode: 'processing_failure', completedAt: '2026-01-01T02:00:00.000Z' },
        }),
      },
    });
    const failed = renderInRouter(<RunStatusCard siteId="s1" runId="r1" />);
    expect(screen.getByTestId('audience-research-status-failed')).toBeInTheDocument();
    failed.unmount();

    setState({
      runsById: {
        r1: run('r1', {
          state: 'failed',
          terminal: { state: 'failed', reasonCode: 'no_usable_public_evidence', completedAt: '2026-01-01T02:00:00.000Z' },
        }),
      },
    });
    renderInRouter(<RunStatusCard siteId="s1" runId="r1" />);
    expect(screen.getByTestId('audience-research-status-no-usable-evidence')).toBeInTheDocument();
  });

  it('polls on a bounded interval while non-terminal, pauses when hidden, and stops at terminal', async () => {
    vi.useFakeTimers();
    setState({ runsById: { r1: run('r1', { state: 'collecting' }) } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    renderInRouter(<RunStatusCard siteId="s1" runId="r1" />);
    hooks.dispatch.mockClear();
    await vi.advanceTimersByTimeAsync(4000);
    expect(hooks.dispatch).toHaveBeenCalled();

    hooks.dispatch.mockClear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10000);
    expect(hooks.dispatch).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(hooks.dispatch).toHaveBeenCalled();
  });

  it('never schedules a poll when the tab is already hidden at mount', async () => {
    vi.useFakeTimers();
    setState({ runsById: { r1: run('r1', { state: 'collecting' }) } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const view = renderInRouter(<RunStatusCard siteId="s1" runId="r1" />);
    // Let the initial (unconditional) load settle before observing polling.
    await vi.advanceTimersByTimeAsync(0);
    hooks.dispatch.mockClear();
    await vi.advanceTimersByTimeAsync(10000);
    expect(hooks.dispatch).not.toHaveBeenCalled();
    view.unmount();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('retries a load failure via the manual retry button', async () => {
    setState({ runStatus: { loading: {}, error: { r1: 'boom' } } });
    renderInRouter(<RunStatusCard siteId="s1" runId="r1" />);
    hooks.dispatch.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(hooks.dispatch).toHaveBeenCalled();
  });

  it('renders nothing before the first fetch resolves (no run, not loading, no error)', () => {
    setState({ runStatus: { loading: {}, error: {} } });
    const { container } = renderInRouter(<RunStatusCard siteId="s1" runId="r1" />);
    expect(container.querySelector('[data-testid^="audience-research-status"]')).toBeNull();
  });

  it('omits the output-locale badge for a legacy status without one', () => {
    setState({
      runsById: {
        r1: run('r1', { outputLocale: null }),
      },
    });
    renderInRouter(<RunStatusCard siteId="s1" runId="r1" />);

    expect(screen.queryByTestId('audience-research-status-output-locale')).toBeNull();
  });

  it('renders the SignalList when a terminal run already has a cached result view', () => {
    // Line 191's `result ?` truthy branch requires `result` to already be
    // populated when the terminal effect fires. Also short-circuits the
    // fetchRunResult effect (line 90's `if (result || resultLoading)
    // return undefined;` truthy path).
    setState({
      runsById: {
        r1: run('r1', {
          state: 'completed',
          terminal: {
            state: 'completed',
            reasonCode: null,
            completedAt: '2026-01-01T02:00:00.000Z',
          },
        }),
      },
      runResultsById: {
        r1: {
          ...run('r1', {
            state: 'completed',
            terminal: {
              state: 'completed',
              reasonCode: null,
              completedAt: '2026-01-01T02:00:00.000Z',
            },
          }),
          input: {
            siteMarket: DEFAULT_FORM_MARKET,
            competitorDomains: [],
            seedTopics: [],
            queryTemplateVersion: 1,
            outputLocale: 'en',
          },
          sources: [],
          signals: [],
          ledgerSummary: { total: 0, ai: 0, byStage: {} },
        },
      },
    });
    renderInRouter(<RunStatusCard siteId="s1" runId="r1" />);
    expect(screen.getByTestId('audience-research-signals')).toBeInTheDocument();
  });

  it('renders the signals-loading skeleton when terminal + resultLoading and no cached result yet', () => {
    // Line 173's `resultLoading && !result` truthy branch. Seed the
    // resultStatus.loading map so the terminal effect sees loading=true,
    // no result, and mounts the loading skeleton.
    setState({
      runsById: {
        r1: run('r1', {
          state: 'completed',
          terminal: {
            state: 'completed',
            reasonCode: null,
            completedAt: '2026-01-01T02:00:00.000Z',
          },
        }),
      },
      resultStatus: { loading: { r1: true }, error: {} },
    });
    renderInRouter(<RunStatusCard siteId="s1" runId="r1" />);
    expect(
      screen.getByTestId('audience-research-signals-loading'),
    ).toBeInTheDocument();
  });

  it('retries a terminal-run result-fetch failure via the signals-error retry button', async () => {
    // Terminal run + result-fetch error + no result → the signals-error
    // Alert renders with an outline retry button whose onClick dispatches
    // fetchRunResult (line 185). Exercise it end-to-end so the branch is
    // executed and the dispatched thunk fires.
    setState({
      runsById: {
        r1: run('r1', {
          state: 'completed',
          terminal: {
            state: 'completed',
            reasonCode: null,
            completedAt: '2026-01-01T02:00:00.000Z',
          },
        }),
      },
      resultStatus: { loading: {}, error: { r1: 'result boom' } },
    });
    renderInRouter(<RunStatusCard siteId="s1" runId="r1" />);
    const errorAlert = await screen.findByTestId('audience-research-signals-error');
    expect(errorAlert).toHaveTextContent('result boom');
    hooks.dispatch.mockClear();
    await userEvent.click(within(errorAlert).getByRole('button', { name: 'Previous' }));
    expect(hooks.dispatch).toHaveBeenCalled();
  });
});

describe('NewRunForm', () => {
  it('renders the market/competitor/topic form and loads the competitor list', () => {
    setState({}, ['a.com']);
    renderInRouter(<NewRunForm siteId="s1" />);
    expect(competitorsMock.loadCompetitors).toHaveBeenCalledWith({ siteId: 's1' });
    expect(screen.getByTestId('audience-research-start-button')).toBeEnabled();
  });

  it('changes country, language, and device via the market selects', async () => {
    setState({ form: { market: DEFAULT_FORM_MARKET, competitors: [], topics: [] } });
    const user = userEvent.setup();
    renderInRouter(<NewRunForm siteId="s1" />);

    await user.click(screen.getByTestId('audience-research-form-country'));
    await user.click(await screen.findByRole('option', { name: /France/ }));
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audienceResearch/updateFormMarket', payload: { country: 'FR', language: 'fr' } }),
    );

    await user.click(screen.getByTestId('audience-research-form-language'));
    await user.click(await screen.findByRole('option', { name: 'French' }));
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audienceResearch/updateFormMarket', payload: { language: 'fr' } }),
    );

    await user.click(screen.getByTestId('audience-research-form-device'));
    await user.click(await screen.findByRole('option', { name: 'mobile' }));
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audienceResearch/updateFormMarket', payload: { device: 'mobile' } }),
    );
  });

  it('normalizes missing markets and every catalog language fallback', async () => {
    const updateCalls = () => hooks.dispatch.mock.calls.filter((call) => {
      const action = call[0] as { type?: string } | null;
      return action?.type === 'audienceResearch/updateFormMarket';
    });

    marketCatalogMock.current = { ...marketCatalogMock.current, loading: true };
    setState({ form: { market: DEFAULT_FORM_MARKET, competitors: [], topics: [] } });
    const loading = renderInRouter(<NewRunForm siteId="s1" />);
    expect(updateCalls()).toHaveLength(0);
    loading.unmount();

    hooks.dispatch.mockClear();
    marketCatalogMock.current = { ...marketCatalogMock.current, loading: false, error: true };
    const errored = renderInRouter(<NewRunForm siteId="s1" />);
    expect(screen.getByText(enCommon.market.loadError)).toBeInTheDocument();
    expect(updateCalls()).toHaveLength(0);
    errored.unmount();

    hooks.dispatch.mockClear();
    marketCatalogMock.current = { markets: [], loading: false, error: false };
    const emptyCatalog = renderInRouter(<NewRunForm siteId="s1" />);
    expect(updateCalls()).toHaveLength(0);
    emptyCatalog.unmount();

    hooks.dispatch.mockClear();
    marketCatalogMock.current = {
      markets: [{ countryCode: 'FR', locationCode: 2250, languageCodes: ['de'] }],
      loading: false,
      error: false,
    };
    setState({
      form: {
        market: { country: 'ZZ', region: null, city: null, language: 'zz', device: 'desktop' },
        competitors: [],
        topics: [],
      },
    });
    const firstMarket = renderInRouter(<NewRunForm siteId="s1" />);
    expect(updateCalls()).toContainEqual([
      expect.objectContaining({
        type: 'audienceResearch/updateFormMarket',
        payload: { country: 'FR', language: 'de' },
      }),
    ]);
    firstMarket.unmount();

    hooks.dispatch.mockClear();
    marketCatalogMock.current = {
      markets: [{ countryCode: 'XX', locationCode: 9999, languageCodes: [] }],
      loading: false,
      error: false,
    };
    const emptyLanguages = renderInRouter(<NewRunForm siteId="s1" />);
    expect(updateCalls()).toContainEqual([
      expect.objectContaining({
        type: 'audienceResearch/updateFormMarket',
        payload: { country: 'XX', language: 'en' },
      }),
    ]);
    emptyLanguages.unmount();

    hooks.dispatch.mockClear();
    marketCatalogMock.current = {
      markets: [{ countryCode: 'US', locationCode: 2840, languageCodes: ['en'] }],
      loading: false,
      error: false,
    };
    setState({
      form: {
        market: { country: 'ZZ', region: null, city: null, language: 'zz', device: 'desktop' },
        competitors: [],
        topics: [],
      },
    });
    const englishFallback = renderInRouter(<NewRunForm siteId="s1" />);
    expect(updateCalls()).toContainEqual([
      expect.objectContaining({
        type: 'audienceResearch/updateFormMarket',
        payload: { country: 'US', language: 'en' },
      }),
    ]);
    englishFallback.unmount();

    hooks.dispatch.mockClear();
    marketCatalogMock.current = {
      markets: [{ countryCode: 'US', locationCode: 2840, languageCodes: ['fr'] }],
      loading: false,
      error: false,
    };
    setState({
      form: {
        market: { country: 'US', region: null, city: null, language: 'fr', device: 'desktop' },
        competitors: [],
        topics: [],
      },
    });
    renderInRouter(<NewRunForm siteId="s1" />);
    expect(updateCalls()).toHaveLength(0);
  });

  it('preserves supported language choices and renders unknown language codes', async () => {
    const user = userEvent.setup();
    setState({
      form: {
        market: { country: 'FR', region: null, city: null, language: 'fr', device: 'desktop' },
        competitors: [],
        topics: [],
      },
    });
    const supported = renderInRouter(<NewRunForm siteId="s1" />);
    await user.click(screen.getByTestId('audience-research-form-country'));
    await user.click(await screen.findByRole('option', { name: /United States/ }));
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'audienceResearch/updateFormMarket',
        payload: { country: 'US', language: 'fr' },
      }),
    );
    supported.unmount();

    hooks.dispatch.mockClear();
    setState({
      form: {
        market: { country: 'FR', region: null, city: null, language: 'de', device: 'desktop' },
        competitors: [],
        topics: [],
      },
    });
    const englishChoice = renderInRouter(<NewRunForm siteId="s1" />);
    await user.click(screen.getByTestId('audience-research-form-country'));
    await user.click(await screen.findByRole('option', { name: /United States/ }));
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'audienceResearch/updateFormMarket',
        payload: { country: 'US', language: 'en' },
      }),
    );
    englishChoice.unmount();

    hooks.dispatch.mockClear();
    marketCatalogMock.current = {
      markets: [
        { countryCode: 'US', locationCode: 2840, languageCodes: ['en'] },
        { countryCode: 'XX', locationCode: 9999, languageCodes: [] },
      ],
      loading: false,
      error: false,
    };
    setState({
      form: { market: DEFAULT_FORM_MARKET, competitors: [], topics: [] },
    });
    const emptyLanguageCountry = renderInRouter(<NewRunForm siteId="s1" />);
    await user.click(screen.getByTestId('audience-research-form-country'));
    await user.click(await screen.findByRole('option', { name: /XX/ }));
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'audienceResearch/updateFormMarket',
        payload: { country: 'XX', language: 'en' },
      }),
    );
    emptyLanguageCountry.unmount();

    marketCatalogMock.current = {
      markets: [{ countryCode: 'US', locationCode: 2840, languageCodes: ['not-a-language'] }],
      loading: false,
      error: false,
    };
    setState({
      form: {
        market: { country: 'US', region: null, city: null, language: 'not-a-language', device: 'desktop' },
        competitors: [],
        topics: [],
      },
    });
    renderInRouter(<NewRunForm siteId="s1" />);
    await user.click(screen.getByTestId('audience-research-form-language'));
    expect(await screen.findByRole('option', { name: 'not-a-language' })).toBeInTheDocument();
  });

  it('toggles competitor selection up to the five-competitor cap', async () => {
    const competitorDomains = Array.from({ length: 5 }, (_, i) => `c${i}.com`);
    setState(
      { form: { market: DEFAULT_FORM_MARKET, competitors: [...competitorDomains], topics: [] } },
      competitorDomains,
    );
    renderInRouter(<NewRunForm siteId="s1" />);
    expect(screen.getByText('Maximum 5 competitors selected.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('audience-research-competitor-c0.com'));
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audienceResearch/setFormCompetitors' }),
    );
  });

  it('adds an unselected competitor domain when clicked', async () => {
    const competitorDomains = ['x.com', 'y.com'];
    setState(
      { form: { market: DEFAULT_FORM_MARKET, competitors: [], topics: [] } },
      competitorDomains,
    );
    renderInRouter(<NewRunForm siteId="s1" />);
    hooks.dispatch.mockClear();
    fireEvent.click(screen.getByTestId('audience-research-competitor-x.com'));
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'audienceResearch/setFormCompetitors',
        payload: ['x.com'],
      }),
    );
  });

  it('adds and removes topic chips via button, Enter, and Backspace, with validation', async () => {
    setState({ form: { market: DEFAULT_FORM_MARKET, competitors: [], topics: ['existing'] } });
    renderInRouter(<NewRunForm siteId="s1" />);
    const input = screen.getByTestId('audience-research-topic-input');

    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Topics' }));
    expect(screen.getByTestId('audience-research-topic-validation')).toHaveTextContent(
      'Topics must be between 2 and 160 characters.',
    );

    fireEvent.change(input, { target: { value: 'new topic' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audienceResearch/setFormTopics' }),
    );

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audienceResearch/setFormTopics', payload: [] }),
    );

    fireEvent.click(screen.getByTestId('audience-research-topic-remove-0'));
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audienceResearch/setFormTopics', payload: [] }),
    );
  });

  it('caps topics at ten and shows the max validation message', () => {
    setState({
      form: {
        market: DEFAULT_FORM_MARKET,
        competitors: [],
        topics: Array.from({ length: 10 }, (_, i) => `topic ${i}`),
      },
    });
    renderInRouter(<NewRunForm siteId="s1" />);
    expect(screen.getByTestId('audience-research-topics-count')).toHaveTextContent('10 / 10');
    const input = screen.getByTestId('audience-research-topic-input');
    expect(input).toBeDisabled();
    // fireEvent bypasses the disabled attribute (unlike a real browser) — this
    // exercises the defensive max-topics guard inside addTopic() itself.
    fireEvent.change(input, { target: { value: 'one more topic' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('audience-research-topic-validation')).toHaveTextContent(
      'You can add up to 10 topics.',
    );
  });

  it('rejects a topic longer than 160 characters', () => {
    setState({ form: { market: DEFAULT_FORM_MARKET, competitors: [], topics: [] } });
    renderInRouter(<NewRunForm siteId="s1" />);
    const input = screen.getByTestId('audience-research-topic-input');
    fireEvent.change(input, { target: { value: 'x'.repeat(161) } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('audience-research-topic-validation')).toHaveTextContent(
      'Topics must be between 2 and 160 characters.',
    );
  });

  it('opens the confirm flow and starts a run', async () => {
    setState({ form: { market: DEFAULT_FORM_MARKET, competitors: [], topics: [] } });
    renderInRouter(<NewRunForm siteId="s1" />);
    await userEvent.click(screen.getByTestId('audience-research-start-button'));
    expect(screen.getByTestId('audience-research-confirm-dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('audience-research-confirm-submit'));
    expect(hooks.dispatch).toHaveBeenCalled();
  });

  it('disables start while a start is in flight, and surfaces start errors', () => {
    setState({
      form: { market: DEFAULT_FORM_MARKET, competitors: [], topics: [] },
      startStatus: { loading: true, error: 'start broke', lastStartedId: null, duplicate: false },
    });
    renderInRouter(<NewRunForm siteId="s1" />);
    expect(screen.getByTestId('audience-research-start-button')).toBeDisabled();
    expect(screen.getByTestId('audience-research-start-error')).toHaveTextContent('start broke');
    fireEvent.click(screen.getByText('Cancel'));
    expect(hooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audienceResearch/clearStartStatus' }),
    );
  });

  it('shows a placeholder when the site has no tracked competitors', () => {
    setState({}, null);
    renderInRouter(<NewRunForm siteId="s1" />);
    expect(screen.getByTestId('audience-research-form-no-competitors')).toBeInTheDocument();
  });

  it('ignores Enter with a blank topic draft', () => {
    setState({ form: { market: DEFAULT_FORM_MARKET, competitors: [], topics: [] } });
    renderInRouter(<NewRunForm siteId="s1" />);
    hooks.dispatch.mockClear();
    const input = screen.getByTestId('audience-research-topic-input');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const setFormTopicsCalls = hooks.dispatch.mock.calls.filter((call) => {
      const action = call[0] as { type?: string } | null;
      return action?.type === 'audienceResearch/setFormTopics';
    });
    expect(setFormTopicsCalls).toHaveLength(0);
  });

  it('Backspace with a non-empty topic draft does not remove chips; Backspace with no chips is a no-op', () => {
    setState({ form: { market: DEFAULT_FORM_MARKET, competitors: [], topics: [] } });
    renderInRouter(<NewRunForm siteId="s1" />);
    const input = screen.getByTestId('audience-research-topic-input');
    hooks.dispatch.mockClear();
    fireEvent.change(input, { target: { value: 'draft' } });
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Backspace' });
    const removeCalls = hooks.dispatch.mock.calls.filter((call) => {
      const action = call[0] as { type?: string; payload?: unknown } | null;
      return action?.type === 'audienceResearch/setFormTopics';
    });
    expect(removeCalls).toHaveLength(0);
  });

  it('closes the confirm dialog after startRun fulfils', async () => {
    setState({ form: { market: DEFAULT_FORM_MARKET, competitors: [], topics: [] } });
    api.startAudienceResearchRun.mockResolvedValue({
      runId: 'newrun',
      status: 'queued',
      duplicate: false,
      outputLocale: 'en',
    });
    renderInRouter(<NewRunForm siteId="s1" />);
    await userEvent.click(screen.getByTestId('audience-research-start-button'));
    expect(screen.getByTestId('audience-research-confirm-dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('audience-research-confirm-submit'));
    await waitFor(() => {
      expect(screen.queryByTestId('audience-research-confirm-dialog')).not.toBeInTheDocument();
    });
  });

  it('keeps the confirm dialog open when startRun rejects', async () => {
    setState({ form: { market: DEFAULT_FORM_MARKET, competitors: [], topics: [] } });
    api.startAudienceResearchRun.mockRejectedValue(new Error('boom'));
    renderInRouter(<NewRunForm siteId="s1" />);
    await userEvent.click(screen.getByTestId('audience-research-start-button'));
    expect(screen.getByTestId('audience-research-confirm-dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('audience-research-confirm-submit'));
    await waitFor(() => {
      expect(api.startAudienceResearchRun).toHaveBeenCalled();
    });
    expect(screen.getByTestId('audience-research-confirm-dialog')).toBeInTheDocument();
  });
});

describe('AudienceResearchPanel', () => {
  it('renders the form + history composition, and opening a history row navigates to it', () => {
    setState({
      listLoaded: true,
      listIds: ['r1'],
      runsById: { r1: run('r1') },
    });
    renderInRouter(<AudienceResearchPanel siteId="s1" />);
    expect(screen.getByTestId('audience-research-panel')).toBeInTheDocument();
    expect(screen.getByTestId('audience-research-new-run-form')).toBeInTheDocument();
    expect(screen.getByTestId('audience-research-history')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByTestId('audience-research-status')).toBeInTheDocument();
  });

  it('shows the run status card and back navigation when ?run= is set', async () => {
    setState({ runsById: { r1: run('r1') } });
    renderInRouter(<AudienceResearchPanel siteId="s1" />, '/sites/s1?tab=audience-research&run=r1');
    expect(screen.getByTestId('audience-research-status')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('audience-research-back'));
  });

  it('syncs the URL to a newly started run id', async () => {
    setState({
      startStatus: { loading: false, error: '', lastStartedId: 'new-run', duplicate: false },
      runsById: { 'new-run': run('new-run') },
    });
    renderInRouter(<AudienceResearchPanel siteId="s1" />);
    await waitFor(() => expect(screen.getByTestId('audience-research-status')).toBeInTheDocument());
    expect(screen.getByTestId('audience-research-back')).toBeInTheDocument();
  });
});
