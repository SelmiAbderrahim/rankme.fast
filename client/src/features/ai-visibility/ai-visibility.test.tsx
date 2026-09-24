/**
 * ai-visibility feature — comprehensive branch-coverage test.
 *
 * Strategy for component tests:
 *   - Preload the store with `siteId: 's1'` matching the panel prop so the
 *     first useEffect guard (`sliceSiteIdRef.current === siteId`) fires and
 *     returns early — no re-dispatch, no racy API call.
 *   - Use `loaded: false` where we don't need suggestion data, so the second
 *     useEffect guard (`!loaded`) also returns early.
 *   - Default `mockResolvedValue` for the two background-fetch mocks covers
 *     the rare tests that DO trigger the second effect (loaded=true).
 *
 * To cover the `?? ''` / `?? null` right branches in rejected handlers we
 * dispatch raw `UnknownAction` objects with `payload: undefined` directly into
 * the reducer — the only way to reach those branches, since `rejectWithValue`
 * always provides a typed payload.
 */
import React from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import type { RootState } from '@app/store';
import { ApiError } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from './api';
import {
  AiVisibilityKpis,
  AiVisibilityPage,
  AiVisibilityPanel,
  AiVisibilityTrendChart,
  aiVisibilityReducer,
  aiVisibilityRoutes,
  addAllSuggestions,
  addPrompt,
  clearRefreshCooldown,
  DEFAULT_REFRESH_COOLDOWN_MS,
  loadAiVisibility,
  loadAiVisibilityTrend,
  loadStoredSuggestions,
  generateSuggestions,
  modelLabel,
  removePrompt,
  resolveAiVisibilityOutputLocale,
  resetAiVisibility,
  runAiVisibilityCheck,
  selectAiVisibilityAdding,
  selectAiVisibilityAddingAll,
  selectAiVisibilityCooldownUntil,
  selectAiVisibilityError,
  selectAiVisibilityLoaded,
  selectAiVisibilityLoading,
  selectAiVisibilityOverview,
  selectAiVisibilityRefreshError,
  selectAiVisibilityRefreshing,
  selectAiVisibilityRemovingId,
  selectAiVisibilitySiteId,
  selectAiVisibilitySuggestions,
  selectAiVisibilitySuggestionsError,
  selectAiVisibilitySuggestionsLoading,
  selectAiVisibilityTrend,
  selectAiVisibilityTrendError,
  selectAiVisibilityTrendLoading,
} from './index';
import type {
  AiTrackedPrompt,
  AiVisibilityOverview,
  AiVisibilityState,
  AiVisibilitySuggestion,
  AiVisibilityTrendPoint,
} from './types';

// ---------------------------------------------------------------------------
// Module mocks — hoisted before any imports are evaluated by vitest
// ---------------------------------------------------------------------------

vi.mock('./api', () => ({
  fetchAiVisibility: vi.fn(),
  addAiVisibilityPrompt: vi.fn(),
  removeAiVisibilityPrompt: vi.fn(),
  checkAiVisibility: vi.fn(),
  fetchAiVisibilitySuggestions: vi.fn(),
  generateAiVisibilitySuggestions: vi.fn(),
  fetchAiVisibilityTrend: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// rootReducer.inject is called as a side effect inside the lazy route body.
// Stub the whole module so route.lazy() can be called without the real store.
vi.mock('@app/store', () => ({
  rootReducer: { inject: vi.fn() },
  store: { getState: vi.fn(() => ({})), dispatch: vi.fn(), subscribe: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Typed mock handle
// ---------------------------------------------------------------------------

type AnyFn = (...a: unknown[]) => unknown;
type MApi = {
  fetchAiVisibility: MockedFunction<typeof api.fetchAiVisibility>;
  addAiVisibilityPrompt: MockedFunction<typeof api.addAiVisibilityPrompt>;
  removeAiVisibilityPrompt: MockedFunction<typeof api.removeAiVisibilityPrompt>;
  checkAiVisibility: MockedFunction<typeof api.checkAiVisibility>;
  fetchAiVisibilitySuggestions: MockedFunction<typeof api.fetchAiVisibilitySuggestions>;
  generateAiVisibilitySuggestions: MockedFunction<
    typeof api.generateAiVisibilitySuggestions
  >;
  fetchAiVisibilityTrend: MockedFunction<typeof api.fetchAiVisibilityTrend>;
};
const mocked = vi.mocked(api) as MApi;

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const makeStore = (preloaded?: Partial<AiVisibilityState>) =>
  configureStore({
    reducer: { aiVisibility: aiVisibilityReducer },
    preloadedState: preloaded ? { aiVisibility: { ...emptyState(), ...preloaded } } : undefined,
  });

const emptyState = (): AiVisibilityState => ({
  siteId: null,
  overview: null,
  suggestions: [],
  suggestionsOutputLocale: null,
  trend: [],
  loading: false,
  loaded: false,
  suggestionsLoading: false,
  trendLoading: false,
  error: '',
  suggestionsError: '',
  trendError: '',
  isRefreshing: false,
  cooldownUntil: null,
  refreshError: '',
  adding: false,
  addingAll: false,
  removingId: null,
  suggestionsGeneratedAt: null,
  suggestionsGenerating: false,
  suggestionsCooldownUntil: null,
});

const makeOverview = (o: Partial<AiVisibilityOverview> = {}): AiVisibilityOverview => ({
  prompts: [],
  snapshots: [],
  shareOfVoicePct: null,
  sentiment: { positive: 0, neutral: 0, negative: 0 },
  notMentionedPrompts: [],
  checkedAt: null,
  ...o,
});

const makePrompt = (o: Partial<AiTrackedPrompt> = {}): AiTrackedPrompt => ({
  id: 'prompt-1',
  prompt: 'What is the best SEO tool?',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...o,
});

const makeSuggestion = (o: Partial<AiVisibilitySuggestion> = {}): AiVisibilitySuggestion => ({
  prompt: 'best SEO software',
  source: 'ai',
  funnelStage: 'consideration',
  promptType: 'categoryDiscovery',
  intent: 'commercial',
  branded: false,
  evidenceSource: 'keyword',
  evidenceRef: 'seo software',
  ...o,
});

const withProviders = (ui: React.ReactNode, store = makeStore()) =>
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{ui}</MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  Object.values(mocked).forEach((m) => (m as MockedFunction<AnyFn>).mockReset());
  // Safe defaults for background effects triggered when loaded=true.
  mocked.fetchAiVisibility.mockResolvedValue(makeOverview());
  mocked.fetchAiVisibilitySuggestions.mockResolvedValue({
    generatedAt: null,
    outputLocale: 'en',
    suggestions: [],
  });
  mocked.fetchAiVisibilityTrend.mockResolvedValue({ points: [] });
});

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// 1. Routes
// ---------------------------------------------------------------------------

describe('aiVisibilityRoutes', () => {
  it('exports one route with the expected path', () => {
    expect(aiVisibilityRoutes).toHaveLength(1);
    expect(aiVisibilityRoutes[0]?.path).toBe('sites/:siteId/ai-visibility');
  });

  it('legacy /ai-visibility path redirects to the workspace tab', () => {
    const route = aiVisibilityRoutes[0]!;
    expect(route.element).toBeTruthy();
    let dest = '';
    const Probe = () => {
      const l = useLocation();
      dest = l.pathname + l.search;
      return null;
    };
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/abc/ai-visibility']}>
            <Routes>
              <Route path="sites/:siteId/ai-visibility" element={route.element} />
              <Route path="sites/:siteId" element={<Probe />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(dest).toBe('/sites/abc?tab=ai-visibility');
  });
});

// ---------------------------------------------------------------------------
// 1b. First-render safety (regression — 404/error-boundary crash)
// ---------------------------------------------------------------------------

describe('AiVisibilityPanel — renders before the lazy slice materializes', () => {
  it('does not throw when `state.aiVisibility` is still undefined on first render', async () => {
    // Mirrors production exactly: SiteWorkspacePage's lazy loader calls
    // `rootReducer.inject({ reducerPath: 'aiVisibility', ... })` and renders
    // the panel in the same tick — but RTK's lazy-injected reducer only
    // materializes `state.aiVisibility` on the NEXT dispatched action, so the
    // panel's own first render must tolerate the key being absent. A bare
    // store with no `aiVisibility` key reproduces that exact precondition.
    const bareStore = configureStore({
      reducer: { unrelated: (s: Record<string, never> = {}) => s },
    });
    render(
      <Provider store={bareStore as never}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <AiVisibilityPanel siteId="s1" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(await screen.findByTestId('ai-visibility-panel')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. Reducer: loadAiVisibility
// ---------------------------------------------------------------------------

describe('reducer: loadAiVisibility', () => {
  it('pending re-keys state when siteId differs', () => {
    const store = makeStore({ siteId: 'old', loaded: true });
    store.dispatch({
      type: loadAiVisibility.pending.type,
      meta: { arg: { siteId: 'new' }, requestId: 'r', requestStatus: 'pending', aborted: false, condition: false },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.siteId).toBe('new');
    expect(s.loading).toBe(true);
    expect(s.loaded).toBe(false);
  });

  it('pending preserves data when siteId already matches', () => {
    const store = makeStore({ siteId: 'same', loaded: true, overview: makeOverview() });
    store.dispatch({
      type: loadAiVisibility.pending.type,
      meta: { arg: { siteId: 'same' }, requestId: 'r', requestStatus: 'pending', aborted: false, condition: false },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.loaded).toBe(true);
    expect(s.loading).toBe(true);
    expect(s.error).toBe('');
  });

  it('fulfilled sets overview when siteIds match', () => {
    const store = makeStore({ siteId: 'a' });
    store.dispatch({
      type: loadAiVisibility.fulfilled.type,
      payload: makeOverview({ shareOfVoicePct: 42 }),
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'fulfilled' },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.overview?.shareOfVoicePct).toBe(42);
    expect(s.loaded).toBe(true);
    expect(s.loading).toBe(false);
  });

  it('fulfilled drops stale response (siteId mismatch)', () => {
    const store = makeStore({ siteId: 'a' });
    store.dispatch({
      type: loadAiVisibility.fulfilled.type,
      payload: makeOverview(),
      meta: { arg: { siteId: 'b' }, requestId: 'r', requestStatus: 'fulfilled' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.overview).toBeNull();
  });

  it('rejected: aborted is a no-op (guard branch)', () => {
    const store = makeStore({ siteId: 'a', loading: true });
    store.dispatch({
      type: loadAiVisibility.rejected.type,
      payload: undefined,
      error: { message: 'AbortError' },
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'rejected', aborted: true, condition: false },
    } as UnknownAction);
    // guard fires — loading unchanged, error stays ''
    expect(store.getState().aiVisibility.loading).toBe(true);
    expect(store.getState().aiVisibility.error).toBe('');
  });

  it('rejected: stale siteId is a no-op (guard branch)', () => {
    const store = makeStore({ siteId: 'a', loading: true });
    store.dispatch({
      type: loadAiVisibility.rejected.type,
      payload: 'stale',
      error: { message: 'stale' },
      meta: { arg: { siteId: 'b' }, requestId: 'r', requestStatus: 'rejected', aborted: false, condition: false },
    } as UnknownAction);
    expect(store.getState().aiVisibility.error).toBe('');
  });

  it('rejected with payload sets error', () => {
    const store = makeStore({ siteId: 'a' });
    store.dispatch({
      type: loadAiVisibility.rejected.type,
      payload: 'not allowed',
      error: { message: 'not allowed' },
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'rejected', aborted: false, condition: false },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.error).toBe('not allowed');
    expect(s.loaded).toBe(true);
    expect(s.loading).toBe(false);
  });

  it('rejected with undefined payload covers the ?? right branch → ""', () => {
    // payload=undefined: action.payload ?? '' → '' (right branch)
    // ast-v8-to-istanbul 1.x counts each ?? branch individually; raw dispatch
    // with undefined payload is the only way to exercise them.
    const store = makeStore({ siteId: 'a' });
    store.dispatch({
      type: loadAiVisibility.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'rejected', aborted: false, condition: false },
    } as UnknownAction);
    expect(store.getState().aiVisibility.error).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 3. Reducer: addPrompt
// ---------------------------------------------------------------------------

describe('reducer: addPrompt', () => {
  it('pending sets adding=true and clears error', () => {
    const store = makeStore({ error: 'prev' });
    store.dispatch({ type: addPrompt.pending.type, meta: { requestId: 'r', requestStatus: 'pending' } } as UnknownAction);
    expect(store.getState().aiVisibility.adding).toBe(true);
    expect(store.getState().aiVisibility.error).toBe('');
  });

  it('fulfilled unshifts the prompt into overview', () => {
    const existing = makePrompt({ id: 'p0' });
    const store = makeStore({ overview: makeOverview({ prompts: [existing] }) });
    const fresh = makePrompt({ id: 'p1', prompt: 'new' });
    store.dispatch({
      type: addPrompt.fulfilled.type,
      payload: fresh,
      meta: { requestId: 'r', requestStatus: 'fulfilled' },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.adding).toBe(false);
    expect(s.overview?.prompts[0]?.id).toBe('p1');
    expect(s.overview?.prompts[1]?.id).toBe('p0');
  });

  it('fulfilled deduplicates: no-op when id already in list', () => {
    const p = makePrompt({ id: 'dup' });
    const store = makeStore({ overview: makeOverview({ prompts: [p] }) });
    store.dispatch({
      type: addPrompt.fulfilled.type,
      payload: p,
      meta: { requestId: 'r', requestStatus: 'fulfilled' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.overview?.prompts).toHaveLength(1);
  });

  it('fulfilled is a no-op when overview is null (guard branch)', () => {
    const store = makeStore({ overview: null });
    store.dispatch({
      type: addPrompt.fulfilled.type,
      payload: makePrompt(),
      meta: { requestId: 'r', requestStatus: 'fulfilled' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.overview).toBeNull();
  });

  it('rejected sets error from string payload', () => {
    const store = makeStore({ adding: true });
    store.dispatch({
      type: addPrompt.rejected.type,
      payload: 'Prompt already tracked',
      error: { message: 'conflict' },
      meta: { requestId: 'r', requestStatus: 'rejected' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.adding).toBe(false);
    expect(store.getState().aiVisibility.error).toBe('Prompt already tracked');
  });

  it('rejected with undefined payload → error = "" (right ?? branch)', () => {
    const store = makeStore({ adding: true });
    store.dispatch({
      type: addPrompt.rejected.type,
      payload: undefined,
      error: { message: 'unknown' },
      meta: { requestId: 'r', requestStatus: 'rejected' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.error).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 4. Reducer: removePrompt
// ---------------------------------------------------------------------------

describe('reducer: removePrompt', () => {
  it('pending sets removingId', () => {
    const store = makeStore();
    store.dispatch({
      type: removePrompt.pending.type,
      meta: { arg: { siteId: 'a', promptId: 'p1' }, requestId: 'r', requestStatus: 'pending' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.removingId).toBe('p1');
  });

  it('fulfilled filters the target prompt from overview', () => {
    const p1 = makePrompt({ id: 'p1' });
    const p2 = makePrompt({ id: 'p2', prompt: 'second' });
    const store = makeStore({ overview: makeOverview({ prompts: [p1, p2] }) });
    store.dispatch({
      type: removePrompt.fulfilled.type,
      payload: 'p1',
      meta: { requestId: 'r', requestStatus: 'fulfilled' },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.removingId).toBeNull();
    expect(s.overview?.prompts).toHaveLength(1);
    expect(s.overview?.prompts[0]?.id).toBe('p2');
  });

  it('fulfilled is a no-op when overview is null (guard branch)', () => {
    const store = makeStore({ overview: null, removingId: 'p1' });
    store.dispatch({
      type: removePrompt.fulfilled.type,
      payload: 'p1',
      meta: { requestId: 'r', requestStatus: 'fulfilled' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.overview).toBeNull();
    expect(store.getState().aiVisibility.removingId).toBeNull();
  });

  it('rejected clears removingId and sets error', () => {
    const store = makeStore({ removingId: 'p1' });
    store.dispatch({
      type: removePrompt.rejected.type,
      payload: 'delete failed',
      error: { message: 'server' },
      meta: { requestId: 'r', requestStatus: 'rejected' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.removingId).toBeNull();
    expect(store.getState().aiVisibility.error).toBe('delete failed');
  });

  it('rejected with undefined payload → error = "" (right ?? branch)', () => {
    const store = makeStore({ removingId: 'p1' });
    store.dispatch({
      type: removePrompt.rejected.type,
      payload: undefined,
      error: { message: 'unknown' },
      meta: { requestId: 'r', requestStatus: 'rejected' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.error).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 5. Reducer: runAiVisibilityCheck
// ---------------------------------------------------------------------------

describe('reducer: runAiVisibilityCheck', () => {
  it('pending sets isRefreshing and clears refreshError', () => {
    const store = makeStore({ refreshError: 'old' });
    store.dispatch({
      type: runAiVisibilityCheck.pending.type,
      meta: { requestId: 'r', requestStatus: 'pending' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.isRefreshing).toBe(true);
    expect(store.getState().aiVisibility.refreshError).toBe('');
  });

  it('fulfilled updates overview and marks loaded', () => {
    const store = makeStore();
    store.dispatch({
      type: runAiVisibilityCheck.fulfilled.type,
      payload: makeOverview({ shareOfVoicePct: 75 }),
      meta: { requestId: 'r', requestStatus: 'fulfilled' },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.isRefreshing).toBe(false);
    expect(s.loaded).toBe(true);
    expect(s.overview?.shareOfVoicePct).toBe(75);
  });

  it('rejected sets refreshError and cooldownUntil from payload', () => {
    const ts = Date.now() + 60_000;
    const store = makeStore({ isRefreshing: true });
    store.dispatch({
      type: runAiVisibilityCheck.rejected.type,
      payload: { error: 'check failed', cooldownUntil: ts },
      error: { message: 'check failed' },
      meta: { requestId: 'r', requestStatus: 'rejected' },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.isRefreshing).toBe(false);
    expect(s.refreshError).toBe('check failed');
    expect(s.cooldownUntil).toBe(ts);
  });

  it('rejected with undefined payload covers ?? right branches', () => {
    const store = makeStore({ isRefreshing: true });
    store.dispatch({
      type: runAiVisibilityCheck.rejected.type,
      payload: undefined,
      error: { message: 'unknown' },
      meta: { requestId: 'r', requestStatus: 'rejected' },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.refreshError).toBe('');
    expect(s.cooldownUntil).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Reducer: loadSuggestions
// ---------------------------------------------------------------------------

describe('reducer: loadStoredSuggestions', () => {
  it('pending sets suggestionsLoading and clears previous error', () => {
    const store = makeStore({ suggestionsError: 'prev' });
    store.dispatch({
      type: loadStoredSuggestions.pending.type,
      meta: {
        arg: { siteId: 's1', outputLocale: 'en' },
        requestId: 'r',
        requestStatus: 'pending',
      },
    } as UnknownAction);
    expect(store.getState().aiVisibility.suggestionsLoading).toBe(true);
    expect(store.getState().aiVisibility.suggestionsError).toBe('');
  });

  it('fulfilled populates suggestions and generatedAt', () => {
    const store = makeStore({ suggestionsOutputLocale: 'en' });
    store.dispatch({
      type: loadStoredSuggestions.fulfilled.type,
      payload: {
        generatedAt: '2026-02-01T00:00:00.000Z',
        outputLocale: 'en',
        suggestions: [makeSuggestion()],
      },
      meta: {
        arg: { siteId: 's1', outputLocale: 'en' },
        requestId: 'r',
        requestStatus: 'fulfilled',
      },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.suggestionsLoading).toBe(false);
    expect(s.suggestions).toHaveLength(1);
    expect(s.suggestionsGeneratedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('fulfilled with generatedAt null marks the never-generated state', () => {
    const store = makeStore({
      suggestionsGeneratedAt: '2026-01-01T00:00:00.000Z',
      suggestionsOutputLocale: 'en',
    });
    store.dispatch({
      type: loadStoredSuggestions.fulfilled.type,
      payload: { generatedAt: null, outputLocale: 'en', suggestions: [] },
      meta: {
        arg: { siteId: 's1', outputLocale: 'en' },
        requestId: 'r',
        requestStatus: 'fulfilled',
      },
    } as UnknownAction);
    expect(store.getState().aiVisibility.suggestionsGeneratedAt).toBeNull();
  });

  it('ignores a fulfilled suggestions read for a stale output locale', () => {
    const existing = makeSuggestion({ prompt: 'Keep the French result' });
    const store = makeStore({
      suggestions: [existing],
      suggestionsLoading: true,
      suggestionsOutputLocale: 'fr',
    });
    store.dispatch({
      type: loadStoredSuggestions.fulfilled.type,
      payload: {
        generatedAt: '2026-02-01T00:00:00.000Z',
        outputLocale: 'en',
        suggestions: [makeSuggestion({ prompt: 'Stale English result' })],
      },
      meta: {
        arg: { siteId: 's1', outputLocale: 'en' },
        requestId: 'r',
        requestStatus: 'fulfilled',
      },
    } as UnknownAction);

    expect(store.getState().aiVisibility.suggestions).toEqual([existing]);
    expect(store.getState().aiVisibility.suggestionsLoading).toBe(true);
  });

  // REGRESSION: a failed suggestions READ must not touch the shared
  // `cooldownUntil` — it drives the mention-check
  // RefreshButton, and writing them here disabled an unrelated control.
  it('rejected sets only suggestionsError and leaves the shared refresh state alone', () => {
    const store = makeStore({
      suggestionsLoading: true,
      suggestionsOutputLocale: 'en',
      cooldownUntil: null,
    });
    store.dispatch({
      type: loadStoredSuggestions.rejected.type,
      payload: 'suggestions failed',
      error: { message: 'suggestions failed' },
      meta: {
        aborted: false,
        arg: { siteId: 's1', outputLocale: 'en' },
        requestId: 'r',
        requestStatus: 'rejected',
      },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.suggestionsLoading).toBe(false);
    expect(s.suggestionsError).toBe('suggestions failed');
    expect(s.cooldownUntil).toBeNull();
    expect(s.suggestionsCooldownUntil).toBeNull();
  });

  it('rejected with undefined payload covers the ?? right branch', () => {
    const store = makeStore({ suggestionsLoading: true, suggestionsOutputLocale: 'en' });
    store.dispatch({
      type: loadStoredSuggestions.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: {
        aborted: false,
        arg: { siteId: 's1', outputLocale: 'en' },
        requestId: 'r',
        requestStatus: 'rejected',
      },
    } as UnknownAction);
    expect(store.getState().aiVisibility.suggestionsError).toBe('');
  });

  it.each([
    { aborted: true, activeLocale: 'en', actionLocale: 'en' },
    { aborted: false, activeLocale: 'fr', actionLocale: 'en' },
  ] as const)(
    'ignores aborted or stale-locale suggestion failures: %o',
    ({ aborted, activeLocale, actionLocale }) => {
      const store = makeStore({
        suggestionsLoading: true,
        suggestionsError: 'keep me',
        suggestionsOutputLocale: activeLocale,
      });
      store.dispatch({
        type: loadStoredSuggestions.rejected.type,
        payload: 'stale failure',
        error: { message: 'stale failure' },
        meta: {
          aborted,
          arg: { siteId: 's1', outputLocale: actionLocale },
          requestId: 'r',
          requestStatus: 'rejected',
        },
      } as UnknownAction);

      expect(store.getState().aiVisibility.suggestionsError).toBe('keep me');
      expect(store.getState().aiVisibility.suggestionsLoading).toBe(true);
    },
  );
});

describe('reducer: generateSuggestions', () => {
  it('pending sets generating and clears the previous error', () => {
    const store = makeStore({ suggestionsError: 'prev' });
    store.dispatch({
      type: generateSuggestions.pending.type,
      meta: {
        arg: { siteId: 's1', outputLocale: 'en' },
        requestId: 'r',
        requestStatus: 'pending',
      },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.suggestionsGenerating).toBe(true);
    expect(s.suggestionsError).toBe('');
  });

  it('fulfilled replaces the set and stamps generatedAt', () => {
    const store = makeStore({ suggestionsGenerating: true, suggestionsOutputLocale: 'en' });
    store.dispatch({
      type: generateSuggestions.fulfilled.type,
      payload: {
        generatedAt: '2026-03-01T00:00:00.000Z',
        outputLocale: 'en',
        suggestions: [makeSuggestion()],
      },
      meta: {
        arg: { siteId: 's1', outputLocale: 'en' },
        requestId: 'r',
        requestStatus: 'fulfilled',
      },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.suggestionsGenerating).toBe(false);
    expect(s.suggestions).toHaveLength(1);
    expect(s.suggestionsGeneratedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('rejected writes the suggestion-specific cooldown, never the shared one', () => {
    const ts = Date.now() + 30_000;
    const store = makeStore({ suggestionsGenerating: true, suggestionsOutputLocale: 'en' });
    store.dispatch({
      type: generateSuggestions.rejected.type,
      payload: { error: 'failed', cooldownUntil: ts },
      error: { message: 'failed' },
      meta: {
        aborted: false,
        arg: { siteId: 's1', outputLocale: 'en' },
        requestId: 'r',
        requestStatus: 'rejected',
      },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.suggestionsGenerating).toBe(false);
    expect(s.suggestionsError).toBe('failed');
    expect(s.suggestionsCooldownUntil).toBe(ts);
    expect(s.cooldownUntil).toBeNull();
  });

  it('rejected with undefined payload covers the ?? right branches', () => {
    const store = makeStore({ suggestionsGenerating: true, suggestionsOutputLocale: 'en' });
    store.dispatch({
      type: generateSuggestions.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: {
        aborted: false,
        arg: { siteId: 's1', outputLocale: 'en' },
        requestId: 'r',
        requestStatus: 'rejected',
      },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.suggestionsError).toBe('');
    expect(s.suggestionsCooldownUntil).toBeNull();
  });

  it('does not overwrite the current-locale miss with an older-locale generation response', () => {
    const store = makeStore({
      suggestionsGenerating: true,
      suggestionsOutputLocale: 'fr',
      suggestions: [],
    });
    store.dispatch({
      type: generateSuggestions.fulfilled.type,
      payload: {
        generatedAt: '2026-03-01T00:00:00.000Z',
        outputLocale: 'en',
        suggestions: [makeSuggestion()],
      },
      meta: {
        arg: { siteId: 's1', outputLocale: 'en' },
        requestId: 'r',
        requestStatus: 'fulfilled',
      },
    } as UnknownAction);
    const state = store.getState().aiVisibility;
    expect(state.suggestionsGenerating).toBe(true);
    expect(state.suggestionsOutputLocale).toBe('fr');
    expect(state.suggestions).toEqual([]);
  });

  it('does not surface an older-locale generation error after a language switch', () => {
    const store = makeStore({
      suggestionsGenerating: true,
      suggestionsOutputLocale: 'fr',
      suggestionsError: '',
    });
    store.dispatch({
      type: generateSuggestions.rejected.type,
      payload: { error: 'stale English error', cooldownUntil: null },
      error: { message: 'stale English error' },
      meta: {
        aborted: false,
        arg: { siteId: 's1', outputLocale: 'en' },
        requestId: 'r',
        requestStatus: 'rejected',
      },
    } as UnknownAction);
    const state = store.getState().aiVisibility;
    expect(state.suggestionsGenerating).toBe(true);
    expect(state.suggestionsOutputLocale).toBe('fr');
    expect(state.suggestionsError).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 7. Reducer: sync actions
// ---------------------------------------------------------------------------

describe('reducer: sync actions', () => {
  it('resetAiVisibility returns to initialState', () => {
    const store = makeStore({ siteId: 'a', overview: makeOverview(), loading: true, loaded: true, error: 'e' });
    store.dispatch(resetAiVisibility());
    const s = store.getState().aiVisibility;
    expect(s.siteId).toBeNull();
    expect(s.overview).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.loaded).toBe(false);
    expect(s.error).toBe('');
  });

  it('clearRefreshCooldown nullifies cooldownUntil', () => {
    const store = makeStore({ cooldownUntil: Date.now() + 60_000 });
    store.dispatch(clearRefreshCooldown());
    expect(store.getState().aiVisibility.cooldownUntil).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. Thunks (exercised via the mocked api module)
// ---------------------------------------------------------------------------

describe('thunks: loadAiVisibility', () => {
  it('success → overview in store', async () => {
    mocked.fetchAiVisibility.mockResolvedValueOnce(makeOverview({ shareOfVoicePct: 55 }));
    const store = makeStore();
    await store.dispatch(loadAiVisibility({ siteId: 'site1' }));
    expect(store.getState().aiVisibility.overview?.shareOfVoicePct).toBe(55);
  });

  it('error → error from message', async () => {
    mocked.fetchAiVisibility.mockRejectedValueOnce(
      new ApiError('Server Error', 500, { error: { message: 'internal' } }),
    );
    const store = makeStore();
    await store.dispatch(loadAiVisibility({ siteId: 'site1' }));
    expect(store.getState().aiVisibility.error).toBe('internal');
  });
});

describe('thunks: addPrompt', () => {
  it('success → prompt added', async () => {
    const p = makePrompt({ id: 'new1', prompt: 'test query?' });
    mocked.addAiVisibilityPrompt.mockResolvedValueOnce({ prompt: p });
    const store = makeStore({ siteId: 'a', overview: makeOverview() });
    await store.dispatch(addPrompt({ siteId: 'a', prompt: 'test query?' }));
    expect(store.getState().aiVisibility.overview?.prompts[0]?.id).toBe('new1');
  });

  it('error → error string set', async () => {
    mocked.addAiVisibilityPrompt.mockRejectedValueOnce(
      new ApiError('Conflict', 409, { error: { message: 'duplicate' } }),
    );
    const store = makeStore({ siteId: 'a', overview: makeOverview() });
    await store.dispatch(addPrompt({ siteId: 'a', prompt: 'dupe?' }));
    expect(store.getState().aiVisibility.error).toBe('duplicate');
  });
});

describe('thunks: removePrompt', () => {
  it('success → prompt removed', async () => {
    mocked.removeAiVisibilityPrompt.mockResolvedValueOnce(undefined);
    const store = makeStore({
      siteId: 'a',
      overview: makeOverview({ prompts: [makePrompt({ id: 'del1' })] }),
    });
    await store.dispatch(removePrompt({ siteId: 'a', promptId: 'del1' }));
    expect(store.getState().aiVisibility.overview?.prompts).toHaveLength(0);
  });

  it('error → error string set', async () => {
    mocked.removeAiVisibilityPrompt.mockRejectedValueOnce(
      new ApiError('Not Found', 404, { error: { message: 'not found' } }),
    );
    const store = makeStore({ siteId: 'a', overview: makeOverview() });
    await store.dispatch(removePrompt({ siteId: 'a', promptId: 'x' }));
    expect(store.getState().aiVisibility.error).toBe('not found');
  });
});

describe('thunks: runAiVisibilityCheck', () => {
  it('success → overview updated', async () => {
    mocked.checkAiVisibility.mockResolvedValueOnce(makeOverview({ shareOfVoicePct: 80 }));
    const store = makeStore({ siteId: 'a' });
    await store.dispatch(runAiVisibilityCheck({ siteId: 'a' }));
    expect(store.getState().aiVisibility.overview?.shareOfVoicePct).toBe(80);
  });

  it('429 with retryAfterMs → cooldownUntil from response', async () => {
    mocked.checkAiVisibility.mockRejectedValueOnce(
      new ApiError('Rate Limited', 429, { error: { message: '', details: { retryAfterMs: 30_000 } } }),
    );
    const before = Date.now();
    const store = makeStore({ siteId: 'a' });
    await store.dispatch(runAiVisibilityCheck({ siteId: 'a' }));
    expect(store.getState().aiVisibility.cooldownUntil).toBeGreaterThanOrEqual(before + 30_000);
    expect(store.getState().aiVisibility.refreshError).toBe('');
  });

  it('429 without retryAfterMs → DEFAULT_REFRESH_COOLDOWN_MS fallback', async () => {
    mocked.checkAiVisibility.mockRejectedValueOnce(
      new ApiError('Rate Limited', 429, { error: { message: '' } }),
    );
    const before = Date.now();
    const store = makeStore({ siteId: 'a' });
    await store.dispatch(runAiVisibilityCheck({ siteId: 'a' }));
    expect(store.getState().aiVisibility.cooldownUntil).toBeGreaterThanOrEqual(
      before + DEFAULT_REFRESH_COOLDOWN_MS,
    );
  });

  it('other error → refreshError set, no cooldown', async () => {
    mocked.checkAiVisibility.mockRejectedValueOnce(
      new ApiError('Server Error', 500, { error: { message: 'vendor down' } }),
    );
    const store = makeStore({ siteId: 'a' });
    await store.dispatch(runAiVisibilityCheck({ siteId: 'a' }));
    const s = store.getState().aiVisibility;
    expect(s.refreshError).toBe('vendor down');
    expect(s.cooldownUntil).toBeNull();
  });
});

describe('thunks: loadStoredSuggestions', () => {
  it('success → suggestions and generatedAt populated', async () => {
    mocked.fetchAiVisibilitySuggestions.mockResolvedValueOnce({
      generatedAt: '2026-02-01T00:00:00.000Z',
      outputLocale: 'en',
      suggestions: [makeSuggestion()],
    });
    const store = makeStore({ siteId: 'a' });
    await store.dispatch(loadStoredSuggestions({ siteId: 'a', outputLocale: 'en' }));
    const s = store.getState().aiVisibility;
    expect(s.suggestions).toHaveLength(1);
    expect(s.suggestionsGeneratedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('error → suggestionsError set and the shared refresh state untouched', async () => {
    mocked.fetchAiVisibilitySuggestions.mockRejectedValueOnce(
      new ApiError('Server Error', 500, { error: { message: 'suggestions unavailable' } }),
    );
    const store = makeStore({ siteId: 'a' });
    await store.dispatch(loadStoredSuggestions({ siteId: 'a', outputLocale: 'en' }));
    const s = store.getState().aiVisibility;
    expect(s.suggestionsError).toBe('suggestions unavailable');
    expect(s.cooldownUntil).toBeNull();
  });
});

describe('thunks: generateSuggestions', () => {
  it('success → set replaced and generatedAt stamped', async () => {
    mocked.generateAiVisibilitySuggestions.mockResolvedValueOnce({
      generatedAt: '2026-03-01T00:00:00.000Z',
      outputLocale: 'en',
      suggestions: [makeSuggestion()],
    });
    const store = makeStore({ siteId: 'a' });
    await store.dispatch(generateSuggestions({ siteId: 'a', outputLocale: 'en' }));
    const s = store.getState().aiVisibility;
    expect(s.suggestions).toHaveLength(1);
    expect(s.suggestionsGeneratedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('429 with retryAfterMs → suggestionsCooldownUntil set', async () => {
    mocked.generateAiVisibilitySuggestions.mockRejectedValueOnce(
      new ApiError('Rate Limited', 429, {
        error: { message: '', details: { retryAfterMs: 15_000 } },
      }),
    );
    const before = Date.now();
    const store = makeStore({ siteId: 'a' });
    await store.dispatch(generateSuggestions({ siteId: 'a', outputLocale: 'en' }));
    const s = store.getState().aiVisibility;
    expect(s.suggestionsCooldownUntil).toBeGreaterThanOrEqual(before + 15_000);
    expect(s.cooldownUntil).toBeNull();
  });

  it('429 without retryAfterMs → DEFAULT_REFRESH_COOLDOWN_MS fallback', async () => {
    mocked.generateAiVisibilitySuggestions.mockRejectedValueOnce(
      new ApiError('Rate Limited', 429, { error: { message: '' } }),
    );
    const before = Date.now();
    const store = makeStore({ siteId: 'a' });
    await store.dispatch(generateSuggestions({ siteId: 'a', outputLocale: 'en' }));
    expect(store.getState().aiVisibility.suggestionsCooldownUntil).toBeGreaterThanOrEqual(
      before + DEFAULT_REFRESH_COOLDOWN_MS,
    );
  });

  it('other error → suggestionsError set', async () => {
    mocked.generateAiVisibilitySuggestions.mockRejectedValueOnce(
      new ApiError('Server Error', 502, { error: { message: 'could not generate' } }),
    );
    const store = makeStore({ siteId: 'a' });
    await store.dispatch(generateSuggestions({ siteId: 'a', outputLocale: 'en' }));
    const s = store.getState().aiVisibility;
    expect(s.suggestionsError).toBe('could not generate');
  });
});

// ---------------------------------------------------------------------------
// 9. Selectors
// ---------------------------------------------------------------------------

describe('selectors', () => {
  it('all 13 selectors read the correct slice fields', () => {
    const ts = Date.now() + 60_000;
    const store = makeStore({
      siteId: 'sel',
      overview: makeOverview({ shareOfVoicePct: 33 }),
      suggestions: [makeSuggestion()],
      loading: true,
      loaded: true,
      suggestionsLoading: true,
      error: 'sel-error',
      suggestionsError: 'sug-error',
      isRefreshing: true,
      cooldownUntil: ts,
      refreshError: 'ref-error',
      adding: true,
      removingId: 'r1',
    });
    // Scoped test store holds only the aiVisibility slice; selectors are
    // typed against the full RootState, so widen through unknown.
    const s = store.getState() as unknown as RootState;
    expect(selectAiVisibilitySiteId(s)).toBe('sel');
    expect(selectAiVisibilityOverview(s)?.shareOfVoicePct).toBe(33);
    expect(selectAiVisibilitySuggestions(s)).toHaveLength(1);
    expect(selectAiVisibilityLoading(s)).toBe(true);
    expect(selectAiVisibilityLoaded(s)).toBe(true);
    expect(selectAiVisibilitySuggestionsLoading(s)).toBe(true);
    expect(selectAiVisibilityError(s)).toBe('sel-error');
    expect(selectAiVisibilitySuggestionsError(s)).toBe('sug-error');
    expect(selectAiVisibilityRefreshing(s)).toBe(true);
    expect(selectAiVisibilityCooldownUntil(s)).toBe(ts);
    expect(selectAiVisibilityRefreshError(s)).toBe('ref-error');
    expect(selectAiVisibilityAdding(s)).toBe(true);
    expect(selectAiVisibilityRemovingId(s)).toBe('r1');
  });
});

// ---------------------------------------------------------------------------
// 10. AiVisibilityPage — siteId resolution branches
// ---------------------------------------------------------------------------

describe('AiVisibilityPage', () => {
  it('uses siteId prop (left branch of first ??)', () => {
    // siteIdProp="prop-site" → "prop-site" ?? ... = "prop-site"
    withProviders(<AiVisibilityPage siteId="prop-site" />);
    expect(screen.getByTestId('ai-visibility-panel')).toBeInTheDocument();
  });

  it('falls back to URL param when prop is absent (right ?? left ?? branches)', () => {
    // siteIdProp=undefined → undefined ?? params.siteId → "url-site"
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/url-site/ai-visibility']}>
            <Routes>
              <Route path="/sites/:siteId/ai-visibility" element={<AiVisibilityPage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getByTestId('ai-visibility-panel')).toBeInTheDocument();
  });

  it('falls back to "" when neither prop nor URL param present (right ?? right ?? branch)', () => {
    // siteIdProp=undefined + useParams returns {} → undefined ?? undefined → ""
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/']}>
            <AiVisibilityPage />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getByTestId('ai-visibility-panel')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 11. AiVisibilityPanel — component states
//
// All tests preload `siteId: 's1'` matching the prop to short-circuit the
// first useEffect and `loaded: false` to short-circuit the second useEffect.
// ---------------------------------------------------------------------------

describe('AiVisibilityPanel', () => {
  it('shows loading skeleton when loading=true and loaded=false', () => {
    const store = makeStore({ siteId: 's1', loading: true, loaded: false });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByTestId('ai-visibility-loading')).toBeInTheDocument();
  });

  it('hides loading skeleton when loaded=true', () => {
    const store = makeStore({ siteId: 's1', loading: false, loaded: true, overview: makeOverview() });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.queryByTestId('ai-visibility-loading')).not.toBeInTheDocument();
  });

  it('renders error alert when error is set', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview(), error: 'Something went wrong' });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByTestId('ai-visibility-error')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByTestId('ai-visibility-retry')).toBeInTheDocument();
  });

  it('retry button re-dispatches the AI-visibility loader', async () => {
    mocked.fetchAiVisibility.mockResolvedValueOnce(makeOverview({ shareOfVoicePct: 12 }));
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview(),
      error: 'boom',
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    const retry = screen.getByTestId('ai-visibility-retry');
    expect(retry).toHaveTextContent(i18n.t('common:retry'));
    await userEvent.click(retry);
    await waitFor(() =>
      expect(mocked.fetchAiVisibility).toHaveBeenCalledWith('s1', expect.anything()),
    );
  });

  it('renders empty prompts message when prompts array is empty', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview({ prompts: [] }) });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByTestId('ai-visibility-prompts')).toBeInTheDocument();
    expect(screen.getByText('No prompts tracked yet.')).toBeInTheDocument();
    // Empty carries a title + CTA that focuses the track-prompt form.
    expect(screen.getByTestId('ai-visibility-prompts-empty')).toBeInTheDocument();
    expect(screen.getByTestId('ai-visibility-prompts-empty-cta')).toBeInTheDocument();
  });

  it('prompts empty-state CTA focuses the track-prompt input', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview({ prompts: [] }) });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    fireEvent.click(screen.getByTestId('ai-visibility-prompts-empty-cta'));
    expect(screen.getByLabelText('Tracked prompt')).toHaveFocus();
  });

  it('renders prompts table rows when prompts exist', () => {
    const p = makePrompt({ id: 'p1', prompt: 'Is this tool good?' });
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview({ prompts: [p] }) });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByText('Is this tool good?')).toBeInTheDocument();
  });

  it('renders "Mentioned" + positive sentiment from matching snapshot', () => {
    const p = makePrompt({ id: 'p1', prompt: 'Positive query?' });
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview({
        prompts: [p],
        snapshots: [{ prompt: 'Positive query?', model: 'gpt-4', mentioned: true, citedUrl: null, sentiment: 'positive', checkedAt: '2026-07-01T00:00:00.000Z' }],
      }),
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByText('Mentioned')).toBeInTheDocument();
    expect(screen.getByText('Spoken about warmly')).toBeInTheDocument();
  });

  it('renders "Not mentioned" + neutral sentiment', () => {
    const p = makePrompt({ id: 'p2', prompt: 'Neutral query?' });
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview({
        prompts: [p],
        snapshots: [{ prompt: 'Neutral query?', model: 'gemini', mentioned: false, citedUrl: null, sentiment: 'neutral', checkedAt: '2026-07-01T00:00:00.000Z' }],
      }),
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByText('Not mentioned')).toBeInTheDocument();
    expect(screen.getByText('Spoken about plainly')).toBeInTheDocument();
  });

  it('renders negative sentiment chip', () => {
    const p = makePrompt({ id: 'p3', prompt: 'Negative query?' });
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview({
        prompts: [p],
        snapshots: [{ prompt: 'Negative query?', model: 'claude', mentioned: true, citedUrl: null, sentiment: 'negative', checkedAt: '2026-07-01T00:00:00.000Z' }],
      }),
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByText('Spoken about critically')).toBeInTheDocument();
  });

  it('renders "Not evaluated" chip when prompt has no snapshot', () => {
    const p = makePrompt({ id: 'p4', prompt: 'Unknown?' });
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview({ prompts: [p], snapshots: [] }),
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByText('Not evaluated')).toBeInTheDocument();
  });

  it('renders share-of-voice bar widths when shareOfVoicePct is set', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview({ shareOfVoicePct: 60 }) });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByTestId('ai-visibility-brand-bar').style.width).toBe('60%');
    expect(screen.getByTestId('ai-visibility-competitor-bar').style.width).toBe('40%');
  });

  it('renders 0% bars and "No data" text when shareOfVoicePct is null', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview({ shareOfVoicePct: null }) });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByTestId('ai-visibility-brand-bar').style.width).toBe('0%');
    expect(screen.getAllByText('No data').length).toBeGreaterThanOrEqual(1);
  });

  it('disables submit and shows capReached message when 10 prompts tracked', () => {
    const prompts = Array.from({ length: 10 }, (_, i) =>
      makePrompt({ id: `p${i}`, prompt: `Prompt ${i}` }),
    );
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview({ prompts }) });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByRole('button', { name: /track prompt/i })).toBeDisabled();
    expect(screen.getByText(/You can track up to 10 prompts per site\./i)).toBeInTheDocument();
  });

  it('dispatches addPrompt on form submit with a non-empty value', async () => {
    mocked.addAiVisibilityPrompt.mockResolvedValueOnce({
      prompt: makePrompt({ id: 'new1', prompt: 'my query' }),
    });
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview() });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);

    const input = screen.getByLabelText('Tracked prompt');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'my query' } });
    });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() =>
      expect(mocked.addAiVisibilityPrompt).toHaveBeenCalledWith('s1', 'my query'),
    );
  });

  it('does not dispatch addPrompt when input is empty', async () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview() });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    fireEvent.submit(screen.getByLabelText('Tracked prompt').closest('form')!);
    await act(async () => {});
    expect(mocked.addAiVisibilityPrompt).not.toHaveBeenCalled();
  });

  it('add button shows spinner + aria-busy + loadingLabel while adding=true', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview(), adding: true });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    const btn = screen.getByRole('button', { name: /adding/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn.querySelector('svg')).toHaveClass('animate-spin');
  });

  // Destructive remove is gated behind an AlertDialog -----------------

  it('clicking the row trash opens the confirm dialog without removing yet', async () => {
    const p = makePrompt({ id: 'del1', prompt: 'To delete' });
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview({ prompts: [p] }) });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    fireEvent.click(screen.getByRole('button', { name: 'Remove prompt' }));
    expect(await screen.findByTestId('ai-visibility-remove-dialog')).toBeInTheDocument();
    expect(mocked.removeAiVisibilityPrompt).not.toHaveBeenCalled();
  });

  it('confirming the dialog removes the prompt and closes the dialog', async () => {
    mocked.removeAiVisibilityPrompt.mockResolvedValueOnce(undefined);
    const p = makePrompt({ id: 'del1', prompt: 'To delete' });
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview({ prompts: [p] }) });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    fireEvent.click(screen.getByRole('button', { name: 'Remove prompt' }));
    fireEvent.click(await screen.findByTestId('ai-visibility-confirm-remove'));
    await waitFor(() =>
      expect(mocked.removeAiVisibilityPrompt).toHaveBeenCalledWith('s1', 'del1'),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('ai-visibility-remove-dialog')).not.toBeInTheDocument(),
    );
  });

  it('confirm button spins + is aria-busy while the removal is in flight', async () => {
    let resolveRemove: () => void = () => undefined;
    mocked.removeAiVisibilityPrompt.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveRemove = resolve)),
    );
    const p = makePrompt({ id: 'del1' });
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview({ prompts: [p] }) });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    fireEvent.click(screen.getByRole('button', { name: 'Remove prompt' }));
    const confirm = await screen.findByTestId('ai-visibility-confirm-remove');
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(confirm.querySelector('svg')).toHaveClass('animate-spin');
    resolveRemove();
    await waitFor(() =>
      expect(screen.queryByTestId('ai-visibility-remove-dialog')).not.toBeInTheDocument(),
    );
  });

  it('a failed removal keeps the dialog open (false branch of fulfilled.match)', async () => {
    mocked.removeAiVisibilityPrompt.mockRejectedValueOnce(new Error('boom'));
    const p = makePrompt({ id: 'del1' });
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview({ prompts: [p] }) });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    fireEvent.click(screen.getByRole('button', { name: 'Remove prompt' }));
    fireEvent.click(await screen.findByTestId('ai-visibility-confirm-remove'));
    await waitFor(() => expect(mocked.removeAiVisibilityPrompt).toHaveBeenCalled());
    expect(screen.getByTestId('ai-visibility-remove-dialog')).toBeInTheDocument();
  });

  it('the dialog Cancel button dismisses without removing', async () => {
    const p = makePrompt({ id: 'del1' });
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview({ prompts: [p] }) });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    fireEvent.click(screen.getByRole('button', { name: 'Remove prompt' }));
    const cancel = await screen.findByRole('button', {
      name: i18n.t('aiVisibility:prompts.confirmRemove.cancel'),
    });
    await userEvent.click(cancel);
    await waitFor(() =>
      expect(screen.queryByTestId('ai-visibility-remove-dialog')).not.toBeInTheDocument(),
    );
    expect(mocked.removeAiVisibilityPrompt).not.toHaveBeenCalled();
  });

  it('pressing Escape dismisses the dialog', async () => {
    const p = makePrompt({ id: 'del1' });
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview({ prompts: [p] }) });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    fireEvent.click(screen.getByRole('button', { name: 'Remove prompt' }));
    await screen.findByTestId('ai-visibility-remove-dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByTestId('ai-visibility-remove-dialog')).not.toBeInTheDocument(),
    );
  });

  it('dispatches runAiVisibilityCheck on refresh button click', async () => {
    mocked.checkAiVisibility.mockResolvedValueOnce(makeOverview());
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      isRefreshing: false,
      cooldownUntil: null,
      overview: makeOverview({ prompts: [makePrompt()] }),
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    // data-testid="ai-visibility-refresh" is forwarded to the <button> via RefreshButton
    const btn = screen.getByTestId('ai-visibility-refresh');
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(mocked.checkAiVisibility).toHaveBeenCalledWith('s1'));
  });

  it('refresh button is disabled when promptCount === 0', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview({ prompts: [] }) });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByTestId('ai-visibility-refresh')).toBeDisabled();
  });

  // Suggestions section ----------------------------------------------------------

  it('shows suggestions loading skeleton while suggestionsLoading=true', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview(), suggestionsLoading: true });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    const panel = screen.getByTestId('ai-visibility-suggestions');
    expect(panel.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows suggestions error when suggestionsError is set', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview(), suggestionsError: 'Could not load suggested prompts.' });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByText('Could not load suggested prompts.')).toBeInTheDocument();
  });

  it('shows empty state when suggestions array is empty', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview(), suggestions: [] });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByText('No suggestions yet')).toBeInTheDocument();
    expect(
      screen.getByText('Track keywords on the Keywords tab or run an audit to unlock suggestions.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('ai-visibility-suggestions-empty-cta')).toBeInTheDocument();
  });

  it('suggestions empty-state CTA focuses the track-prompt input', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview(), suggestions: [] });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    fireEvent.click(screen.getByTestId('ai-visibility-suggestions-empty-cta'));
    expect(screen.getByLabelText('Tracked prompt')).toHaveFocus();
  });

  it('badges an AI-generated suggestion and shows no volume number', () => {
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview(),
      suggestions: [makeSuggestion({ prompt: 'top SEO tools', source: 'ai' })],
      suggestionsGeneratedAt: '2026-02-01T00:00:00.000Z',
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByText('top SEO tools')).toBeInTheDocument();
    expect(screen.getByText('AI suggested')).toBeInTheDocument();
    // The old "N AI searches" line was DataForSEO PAA/Google volume mislabelled
    // as AI demand; it must not come back.
    expect(screen.queryByText(/AI searches/)).not.toBeInTheDocument();
  });

  it('renders a template suggestion without the AI badge', () => {
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview(),
      suggestions: [makeSuggestion({ prompt: 'obscure query', source: 'template' })],
      suggestionsGeneratedAt: '2026-02-01T00:00:00.000Z',
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByText('obscure query')).toBeInTheDocument();
    expect(screen.queryByText('AI suggested')).not.toBeInTheDocument();
  });

  it('dispatches addPrompt from suggestion "Track this" button', async () => {
    mocked.addAiVisibilityPrompt.mockResolvedValueOnce({
      prompt: makePrompt({ id: 'sug1', prompt: 'best SEO software' }),
    });
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview(),
      suggestions: [makeSuggestion({ prompt: 'best SEO software' })],
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    fireEvent.click(screen.getByRole('button', { name: 'Track this' }));
    await waitFor(() =>
      expect(mocked.addAiVisibilityPrompt).toHaveBeenCalledWith('s1', 'best SEO software'),
    );
  });

  // useEffect branches -----------------------------------------------------------

  it('first effect aborts in-flight load when siteId prop changes', async () => {
    const store = makeStore();
    const { rerender } = render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <AiVisibilityPanel siteId="site-a" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    rerender(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <AiVisibilityPanel siteId="site-b" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await waitFor(() =>
      expect(mocked.fetchAiVisibility).toHaveBeenCalledWith('site-b', expect.anything()),
    );
  });

  it('second effect dispatches loadSuggestions when loaded=true', async () => {
    const store = makeStore({ siteId: 's1', loaded: true, overview: makeOverview() });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    await waitFor(() =>
      expect(mocked.fetchAiVisibilitySuggestions).toHaveBeenCalledWith(
        's1',
        'en',
        expect.anything(),
      ),
    );
  });

  it('language switching performs only an exact-locale stored read', async () => {
    mocked.fetchAiVisibilitySuggestions.mockImplementation(
      async (_siteId, outputLocale) => ({
        generatedAt: null,
        outputLocale,
        suggestions: [],
      }),
    );
    const store = makeStore({
      siteId: 's1',
      loaded: true,
      overview: makeOverview(),
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    await waitFor(() =>
      expect(mocked.fetchAiVisibilitySuggestions).toHaveBeenCalledWith(
        's1',
        'en',
        expect.anything(),
      ),
    );

    await act(async () => {
      await changeLanguage('fr');
    });

    await waitFor(() =>
      expect(mocked.fetchAiVisibilitySuggestions).toHaveBeenCalledWith(
        's1',
        'fr',
        expect.anything(),
      ),
    );
    expect(mocked.generateAiVisibilitySuggestions).not.toHaveBeenCalled();
  });

  it('third effect fires toast.error when refreshError is non-empty', async () => {
    const { toast } = await import('sonner');
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview(), refreshError: 'Vendor is down' });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    await waitFor(() =>
      expect((toast as unknown as { error: MockedFunction<AnyFn> }).error).toHaveBeenCalledWith('Vendor is down'),
    );
  });

  it('latestByPrompt deduplicates snapshots (false branch of !map.has)', () => {
    // Two snapshots with the same prompt → second is silently skipped (false branch of !map.has)
    const p = makePrompt({ id: 'p1', prompt: 'Dupe query?' });
    const snap1 = { prompt: 'Dupe query?', model: 'gpt-4', mentioned: true, citedUrl: null, sentiment: 'positive' as const, checkedAt: '2026-07-01T00:00:00.000Z' };
    const snap2 = { prompt: 'Dupe query?', model: 'gemini', mentioned: false, citedUrl: null, sentiment: 'neutral' as const, checkedAt: '2026-07-02T00:00:00.000Z' };
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview({ prompts: [p], snapshots: [snap1, snap2] }),
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    // Only the first snapshot wins; "Mentioned" is displayed (not "Not mentioned")
    expect(screen.getByText('Mentioned')).toBeInTheDocument();
  });

  it('submit does not clear prompt input when addPrompt is rejected (false branch of fulfilled.match)', async () => {
    mocked.addAiVisibilityPrompt.mockRejectedValueOnce(new Error('quota exceeded'));
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview() });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);

    const input = screen.getByLabelText('Tracked prompt') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'my failing query' } });
    });
    await act(async () => {
      fireEvent.submit(input.closest('form')!);
    });

    // addPrompt was called but rejected → setPrompt('') is NOT called
    await waitFor(() =>
      expect(mocked.addAiVisibilityPrompt).toHaveBeenCalledWith('s1', 'my failing query'),
    );
    // input value preserved (prompt not cleared)
    expect(input.value).toBe('my failing query');
  });
});

// ---------------------------------------------------------------------------
// 12. Reducer: addAllSuggestions
// ---------------------------------------------------------------------------

describe('reducer: addAllSuggestions', () => {
  it('pending sets addingAll and clears error', () => {
    const store = makeStore({ error: 'prev' });
    store.dispatch({
      type: addAllSuggestions.pending.type,
      meta: { requestId: 'r', requestStatus: 'pending' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.addingAll).toBe(true);
    expect(store.getState().aiVisibility.error).toBe('');
  });

  it('fulfilled merges the batch, skipping ids already present', () => {
    const existing = makePrompt({ id: 'dup' });
    const store = makeStore({ overview: makeOverview({ prompts: [existing] }) });
    store.dispatch({
      type: addAllSuggestions.fulfilled.type,
      payload: [existing, makePrompt({ id: 'fresh', prompt: 'fresh one' })],
      meta: { requestId: 'r', requestStatus: 'fulfilled' },
    } as UnknownAction);
    const s = store.getState().aiVisibility;
    expect(s.addingAll).toBe(false);
    expect(s.overview?.prompts).toHaveLength(2);
    expect(s.overview?.prompts[0]?.id).toBe('fresh');
  });

  it('fulfilled is a no-op when overview is null (guard branch)', () => {
    const store = makeStore({ overview: null, addingAll: true });
    store.dispatch({
      type: addAllSuggestions.fulfilled.type,
      payload: [makePrompt()],
      meta: { requestId: 'r', requestStatus: 'fulfilled' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.overview).toBeNull();
    expect(store.getState().aiVisibility.addingAll).toBe(false);
  });

  it('rejected sets error from payload; undefined payload → "" (both ?? branches)', () => {
    const store = makeStore({ addingAll: true });
    store.dispatch({
      type: addAllSuggestions.rejected.type,
      payload: 'bulk failed',
      error: { message: 'x' },
      meta: { requestId: 'r', requestStatus: 'rejected' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.error).toBe('bulk failed');
    store.dispatch({
      type: addAllSuggestions.rejected.type,
      payload: undefined,
      error: { message: 'x' },
      meta: { requestId: 'r', requestStatus: 'rejected' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.error).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 13. Reducer: loadAiVisibilityTrend
// ---------------------------------------------------------------------------

const makeTrendPoint = (o: Partial<AiVisibilityTrendPoint> = {}): AiVisibilityTrendPoint => ({
  day: '2026-07-01',
  mentionedRatePct: 50,
  shareOfVoicePct: 40,
  checks: 4,
  ...o,
});

describe('reducer: loadAiVisibilityTrend', () => {
  it('pending sets trendLoading and clears trendError', () => {
    const store = makeStore({ trendError: 'prev' });
    store.dispatch({
      type: loadAiVisibilityTrend.pending.type,
      meta: { requestId: 'r', requestStatus: 'pending' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.trendLoading).toBe(true);
    expect(store.getState().aiVisibility.trendError).toBe('');
  });

  it('fulfilled stores the points', () => {
    const store = makeStore();
    store.dispatch({
      type: loadAiVisibilityTrend.fulfilled.type,
      payload: [makeTrendPoint()],
      meta: { requestId: 'r', requestStatus: 'fulfilled' },
    } as UnknownAction);
    expect(store.getState().aiVisibility.trend).toHaveLength(1);
    expect(store.getState().aiVisibility.trendLoading).toBe(false);
  });

  it('rejected: aborted is a no-op (guard branch)', () => {
    const store = makeStore({ trendLoading: true });
    store.dispatch({
      type: loadAiVisibilityTrend.rejected.type,
      payload: undefined,
      error: { message: 'AbortError' },
      meta: { requestId: 'r', requestStatus: 'rejected', aborted: true, condition: false },
    } as UnknownAction);
    expect(store.getState().aiVisibility.trendLoading).toBe(true);
  });

  it('rejected sets trendError from payload; undefined payload → "" (?? branches)', () => {
    const store = makeStore({ trendLoading: true });
    store.dispatch({
      type: loadAiVisibilityTrend.rejected.type,
      payload: 'trend down',
      error: { message: 'x' },
      meta: { requestId: 'r', requestStatus: 'rejected', aborted: false, condition: false },
    } as UnknownAction);
    expect(store.getState().aiVisibility.trendError).toBe('trend down');
    store.dispatch({
      type: loadAiVisibilityTrend.rejected.type,
      payload: undefined,
      error: { message: 'x' },
      meta: { requestId: 'r', requestStatus: 'rejected', aborted: false, condition: false },
    } as UnknownAction);
    expect(store.getState().aiVisibility.trendError).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 14. Thunks: addAllSuggestions + loadAiVisibilityTrend
// ---------------------------------------------------------------------------

describe('thunks: addAllSuggestions', () => {
  it('adds every prompt serially and merges them into the overview', async () => {
    mocked.addAiVisibilityPrompt
      .mockResolvedValueOnce({ prompt: makePrompt({ id: 'b1', prompt: 'one' }) })
      .mockResolvedValueOnce({ prompt: makePrompt({ id: 'b2', prompt: 'two' }) });
    const store = makeStore({ siteId: 'a', overview: makeOverview() });
    await store.dispatch(addAllSuggestions({ siteId: 'a', prompts: ['one', 'two'] }));
    expect(mocked.addAiVisibilityPrompt).toHaveBeenNthCalledWith(1, 'a', 'one');
    expect(mocked.addAiVisibilityPrompt).toHaveBeenNthCalledWith(2, 'a', 'two');
    expect(store.getState().aiVisibility.overview?.prompts).toHaveLength(2);
  });

  it('stops at the first 402 and keeps the prompts that landed', async () => {
    mocked.addAiVisibilityPrompt
      .mockResolvedValueOnce({ prompt: makePrompt({ id: 'b1', prompt: 'one' }) })
      .mockRejectedValueOnce(
        new ApiError('Payment Required', 402, { error: { message: 'cap' } }),
      );
    const store = makeStore({ siteId: 'a', overview: makeOverview() });
    await store.dispatch(addAllSuggestions({ siteId: 'a', prompts: ['one', 'two', 'three'] }));
    expect(mocked.addAiVisibilityPrompt).toHaveBeenCalledTimes(2);
    expect(store.getState().aiVisibility.overview?.prompts).toHaveLength(1);
    expect(store.getState().aiVisibility.error).toBe('');
  });

  it('rejects with the error message when the FIRST add fails with a non-402', async () => {
    mocked.addAiVisibilityPrompt.mockRejectedValueOnce(
      new ApiError('Server Error', 500, { error: { message: 'boom' } }),
    );
    const store = makeStore({ siteId: 'a', overview: makeOverview() });
    await store.dispatch(addAllSuggestions({ siteId: 'a', prompts: ['one', 'two'] }));
    expect(store.getState().aiVisibility.error).toBe('boom');
    expect(mocked.addAiVisibilityPrompt).toHaveBeenCalledTimes(1);
  });

  it('resolves empty (no reject) when the FIRST add hits the 402 cap', async () => {
    mocked.addAiVisibilityPrompt.mockRejectedValueOnce(
      new ApiError('Payment Required', 402, { error: { message: 'cap' } }),
    );
    const store = makeStore({ siteId: 'a', overview: makeOverview() });
    const action = await store.dispatch(
      addAllSuggestions({ siteId: 'a', prompts: ['one'] }),
    );
    expect(addAllSuggestions.fulfilled.match(action)).toBe(true);
    expect(store.getState().aiVisibility.error).toBe('');
  });
});

describe('thunks: loadAiVisibilityTrend', () => {
  it('success → points in store', async () => {
    mocked.fetchAiVisibilityTrend.mockResolvedValueOnce({ points: [makeTrendPoint()] });
    const store = makeStore({ siteId: 'a' });
    await store.dispatch(loadAiVisibilityTrend({ siteId: 'a' }));
    expect(store.getState().aiVisibility.trend).toHaveLength(1);
  });

  it('failure → trendError set', async () => {
    mocked.fetchAiVisibilityTrend.mockRejectedValueOnce(
      new ApiError('Server Error', 500, { error: { message: 'no trend' } }),
    );
    const store = makeStore({ siteId: 'a' });
    await store.dispatch(loadAiVisibilityTrend({ siteId: 'a' }));
    expect(store.getState().aiVisibility.trendError).toBe('no trend');
  });
});

// ---------------------------------------------------------------------------
// 15. New selectors
// ---------------------------------------------------------------------------

describe('selectors: trend + addingAll', () => {
  it('read the correct slice fields', () => {
    const store = makeStore({
      trend: [makeTrendPoint()],
      trendLoading: true,
      trendError: 't-err',
      addingAll: true,
    });
    const s = store.getState() as unknown as RootState;
    expect(selectAiVisibilityTrend(s)).toHaveLength(1);
    expect(selectAiVisibilityTrendLoading(s)).toBe(true);
    expect(selectAiVisibilityTrendError(s)).toBe('t-err');
    expect(selectAiVisibilityAddingAll(s)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 16. AiVisibilityKpis (pure component)
// ---------------------------------------------------------------------------

const renderWithI18n = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

describe('AiVisibilityKpis', () => {
  const richOverview = makeOverview({
    prompts: [makePrompt({ id: 'p1', prompt: 'q one' }), makePrompt({ id: 'p2', prompt: 'q two' })],
    snapshots: [
      { prompt: 'q one', model: 'chatgpt', mentioned: true, citedUrl: null, sentiment: 'positive', checkedAt: '2026-07-01T00:00:00.000Z' },
      { prompt: 'q one', model: 'claude', mentioned: true, citedUrl: null, sentiment: null, checkedAt: '2026-07-01T00:00:00.000Z' },
      { prompt: 'q two', model: 'chatgpt', mentioned: false, citedUrl: null, sentiment: 'negative', checkedAt: '2026-07-01T00:00:00.000Z' },
    ],
    shareOfVoicePct: 66,
    sentiment: { positive: 1, neutral: 2, negative: 3 },
  });

  it('renders share-of-voice pct, mentioned x of y, and the sentiment split', () => {
    renderWithI18n(<AiVisibilityKpis overview={richOverview} />);
    expect(screen.getByTestId('ai-visibility-kpi-share')).toHaveTextContent('66%');
    // distinct mentioned prompts = 1 ('q one'), total = 2
    expect(screen.getByTestId('ai-visibility-kpi-mentioned')).toHaveTextContent('1 of 2');
    const tone = screen.getByTestId('ai-visibility-kpi-sentiment');
    expect(tone).toHaveTextContent('1 warm');
    expect(tone).toHaveTextContent('2 plain');
    expect(tone).toHaveTextContent('3 critical');
  });

  it('renders "No data" when shareOfVoicePct is null', () => {
    renderWithI18n(
      <AiVisibilityKpis overview={makeOverview({ shareOfVoicePct: null })} />,
    );
    expect(screen.getByTestId('ai-visibility-kpi-share')).toHaveTextContent('No data');
  });
});

// ---------------------------------------------------------------------------
// 17. AiVisibilityTrendChart (pure component) + modelLabel
// ---------------------------------------------------------------------------

describe('AiVisibilityTrendChart', () => {
  it('shows the empty state with fewer than two plottable points', () => {
    renderWithI18n(<AiVisibilityTrendChart points={[makeTrendPoint()]} />);
    expect(screen.getByTestId('ai-visibility-trend-empty')).toBeInTheDocument();
  });

  it('renders the SVG line, latest line, and the hidden data table', () => {
    const points = [
      makeTrendPoint({ day: '2026-07-01', mentionedRatePct: 50, shareOfVoicePct: 40, checks: 4 }),
      makeTrendPoint({ day: '2026-07-02', mentionedRatePct: 75, shareOfVoicePct: null, checks: 4 }),
      makeTrendPoint({ day: '2026-07-03', mentionedRatePct: null, shareOfVoicePct: null, checks: 0 }),
    ];
    renderWithI18n(<AiVisibilityTrendChart points={points} />);
    expect(screen.getByTestId('ai-visibility-trend-svg')).toBeInTheDocument();
    // latest plottable = 75%
    expect(screen.getByText(/75% of checks/)).toBeInTheDocument();
    const table = screen.getByTestId('ai-visibility-trend-table');
    // null-rate day still listed in the accessible table as "No data"
    expect(table).toHaveTextContent('No data');
    expect(table).toHaveTextContent('50%');
    expect(table).toHaveTextContent('40%');
  });
});

describe('modelLabel', () => {
  it('maps known engines and falls back to the raw string', () => {
    expect(modelLabel('chat_gpt')).toBe('ChatGPT');
    expect(modelLabel('CHATGPT')).toBe('ChatGPT');
    expect(modelLabel('perplexity')).toBe('Perplexity');
    expect(modelLabel('google-ai-mode')).toBe('Google AI');
    expect(modelLabel('mystery-engine')).toBe('mystery-engine');
  });
});

// ---------------------------------------------------------------------------
// 18. Panel — new surfaces (last checked, cost, KPIs, engine details,
//     not-mentioned, trend card, track-all, onboarding, source chip)
// ---------------------------------------------------------------------------

describe('AiVisibilityPanel — new surfaces', () => {
  const engineOverview = makeOverview({
    prompts: [makePrompt({ id: 'p1', prompt: 'engine query' })],
    snapshots: [
      { prompt: 'engine query', model: 'chatgpt', mentioned: true, citedUrl: 'https://example.com/cited', sentiment: 'positive', checkedAt: '2026-07-02T10:00:00.000Z' },
      { prompt: 'engine query', model: 'claude', mentioned: false, citedUrl: null, sentiment: null, checkedAt: '2026-07-02T10:00:00.000Z' },
      // duplicate (prompt, model) — older row must be ignored by enginesByPrompt
      { prompt: 'engine query', model: 'chatgpt', mentioned: false, citedUrl: null, sentiment: null, checkedAt: '2026-07-01T10:00:00.000Z' },
    ],
    checkedAt: '2026-07-02T10:00:00.000Z',
  });

  it('shows the last-checked timestamp when checkedAt is set', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: engineOverview });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    const label = screen.getByTestId('ai-visibility-last-checked');
    expect(label).toHaveTextContent(/Last checked/);
    expect(label).not.toHaveTextContent('Not checked yet');
  });

  it('shows "Not checked yet" when checkedAt is null', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview() });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByTestId('ai-visibility-last-checked')).toHaveTextContent('Not checked yet');
  });

  it('expands a prompt row into the per-engine breakdown with a cited link, deduped per engine', async () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: engineOverview });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.queryByTestId('ai-visibility-engine-details')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ai-visibility-expand-p1'));
    const details = await screen.findByTestId('ai-visibility-engine-details');
    expect(details).toHaveTextContent('ChatGPT');
    expect(details).toHaveTextContent('Claude');
    // ChatGPT appears once (older duplicate dropped) and keeps the newest row's link
    const link = screen.getByTestId('ai-visibility-cited-url');
    expect(link).toHaveAttribute('href', 'https://example.com/cited');
    expect(link).toHaveAttribute('target', '_blank');
    expect(details).toHaveTextContent('No cited page');
    // collapse again
    fireEvent.click(screen.getByTestId('ai-visibility-expand-p1'));
    expect(screen.queryByTestId('ai-visibility-engine-details')).not.toBeInTheDocument();
  });

  it('renders no expand toggle for prompts without snapshots', () => {
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview({ prompts: [makePrompt({ id: 'p9', prompt: 'no data yet' })] }),
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.queryByTestId('ai-visibility-expand-p9')).not.toBeInTheDocument();
  });

  it('renders the not-mentioned callout only when the list is non-empty', () => {
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview({ notMentionedPrompts: ['ghost prompt'] }),
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByTestId('ai-visibility-not-mentioned')).toHaveTextContent('ghost prompt');
  });

  it('hides the not-mentioned callout when empty', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview() });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.queryByTestId('ai-visibility-not-mentioned')).not.toBeInTheDocument();
  });

  it('fires a success toast and reloads the trend after a fulfilled check', async () => {
    const { toast } = await import('sonner');
    mocked.checkAiVisibility.mockResolvedValueOnce(
      makeOverview({
        prompts: [makePrompt({ id: 'p1', prompt: 'engine query' })],
        snapshots: [
          { prompt: 'engine query', model: 'chatgpt', mentioned: true, citedUrl: null, sentiment: null, checkedAt: '2026-07-02T10:00:00.000Z' },
        ],
      }),
    );
    const store = makeStore({ siteId: 's1', loaded: false, overview: engineOverview });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    fireEvent.click(screen.getByTestId('ai-visibility-refresh'));
    await waitFor(() =>
      expect(
        (toast as unknown as { success: MockedFunction<AnyFn> }).success,
      ).toHaveBeenCalledWith('Checked 1 prompts — AI answers mention you for 1.'),
    );
    await waitFor(() => expect(mocked.fetchAiVisibilityTrend).toHaveBeenCalledWith('s1', expect.anything()));
  });

  it('does not toast when the check rejects (false branch of fulfilled.match)', async () => {
    const { toast } = await import('sonner');
    (toast as unknown as { success: MockedFunction<AnyFn> }).success.mockClear();
    mocked.checkAiVisibility.mockRejectedValueOnce(
      new ApiError('Server Error', 500, { error: { message: 'down' } }),
    );
    const store = makeStore({ siteId: 's1', loaded: false, overview: engineOverview });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    fireEvent.click(screen.getByTestId('ai-visibility-refresh'));
    await waitFor(() => expect(mocked.checkAiVisibility).toHaveBeenCalled());
    expect(
      (toast as unknown as { success: MockedFunction<AnyFn> }).success,
    ).not.toHaveBeenCalled();
  });

  it('trend card: skeleton while loading, alert on error, chart when data', () => {
    const loadingStore = makeStore({ siteId: 's1', loaded: false, overview: makeOverview(), trendLoading: true });
    const { unmount } = withProviders(<AiVisibilityPanel siteId="s1" />, loadingStore);
    expect(screen.getByTestId('ai-visibility-trend-loading')).toBeInTheDocument();
    unmount();

    const errorStore = makeStore({ siteId: 's1', loaded: false, overview: makeOverview(), trendError: 'trend broke' });
    const second = withProviders(<AiVisibilityPanel siteId="s1" />, errorStore);
    expect(screen.getByTestId('ai-visibility-trend-error')).toHaveTextContent('trend broke');
    second.unmount();

    const dataStore = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview(),
      trend: [
        makeTrendPoint({ day: '2026-07-01', mentionedRatePct: 25 }),
        makeTrendPoint({ day: '2026-07-02', mentionedRatePct: 50 }),
      ],
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, dataStore);
    expect(screen.getByTestId('ai-visibility-trend-svg')).toBeInTheDocument();
  });

  it('loads the trend alongside suggestions when loaded=true', async () => {
    const store = makeStore({ siteId: 's1', loaded: true, overview: makeOverview() });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    await waitFor(() =>
      expect(mocked.fetchAiVisibilityTrend).toHaveBeenCalledWith('s1', expect.anything()),
    );
  });

  it('"Track all" adds only untracked suggestions up to the cap slots', async () => {
    mocked.addAiVisibilityPrompt.mockResolvedValue({ prompt: makePrompt({ id: 'bulk1', prompt: 'fresh suggestion' }) });
    const nine = Array.from({ length: 9 }, (_, i) => makePrompt({ id: `t${i}`, prompt: `tracked ${i}` }));
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview({ prompts: nine }),
      suggestions: [
        makeSuggestion({ prompt: 'tracked 0' }), // already tracked — filtered out
        makeSuggestion({ prompt: 'fresh suggestion' }),
        makeSuggestion({ prompt: 'second fresh' }), // beyond the single free slot
      ],
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    fireEvent.click(screen.getByTestId('ai-visibility-track-all'));
    await waitFor(() => expect(mocked.addAiVisibilityPrompt).toHaveBeenCalledTimes(1));
    expect(mocked.addAiVisibilityPrompt).toHaveBeenCalledWith('s1', 'fresh suggestion');
  });

  it('"Track all" is a no-op when every free slot is used (guard branch)', () => {
    const ten = Array.from({ length: 10 }, (_, i) => makePrompt({ id: `t${i}`, prompt: `tracked ${i}` }));
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview({ prompts: ten }),
      suggestions: [makeSuggestion({ prompt: 'fresh suggestion' })],
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    const btn = screen.getByTestId('ai-visibility-track-all');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(mocked.addAiVisibilityPrompt).not.toHaveBeenCalled();
  });

  it('onboarding: empty prompts + suggestions present → "Track suggested prompts" CTA dispatches the bulk add', async () => {
    mocked.addAiVisibilityPrompt.mockResolvedValue({ prompt: makePrompt({ id: 'ob1', prompt: 'suggested one' }) });
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview({ prompts: [] }),
      suggestions: [makeSuggestion({ prompt: 'suggested one' })],
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.queryByTestId('ai-visibility-prompts-empty-cta')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ai-visibility-onboarding-track-all'));
    await waitFor(() =>
      expect(mocked.addAiVisibilityPrompt).toHaveBeenCalledWith('s1', 'suggested one'),
    );
  });

  it('onboarding: both empty → suggestions empty state points to the Keywords tab', () => {
    const store = makeStore({ siteId: 's1', loaded: false, overview: makeOverview(), suggestions: [] });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getByTestId('ai-visibility-suggestions-empty')).toHaveTextContent(
      /Keywords tab/,
    );
    // prompts empty state keeps the manual CTA
    expect(screen.getByTestId('ai-visibility-prompts-empty-cta')).toBeInTheDocument();
  });

  it('renders the "AI suggested" chip only for source === "ai"', () => {
    const store = makeStore({
      siteId: 's1',
      loaded: false,
      overview: makeOverview({ prompts: [makePrompt()] }),
      suggestions: [
        makeSuggestion({ prompt: 'ai one', source: 'ai' }),
        makeSuggestion({ prompt: 'template one', source: 'template' }),
      ],
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, store);
    expect(screen.getAllByText('AI suggested')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Prompt-suggestion generation (panel surface)
// ---------------------------------------------------------------------------

describe('AiVisibilityPanel — prompt-suggestion generation', () => {
  const baseStore = (state: Partial<AiVisibilityState> = {}) =>
    makeStore({ siteId: 's1', loaded: true, overview: makeOverview(), ...state });

  it('generates and confirms the new suggestion count', async () => {
    const user = userEvent.setup();
    mocked.generateAiVisibilitySuggestions.mockResolvedValue({
      generatedAt: '2026-03-01T00:00:00.000Z',
      outputLocale: 'en',
      suggestions: [makeSuggestion()],
    });
    withProviders(<AiVisibilityPanel siteId="s1" />, baseStore());

    await user.click(screen.getByTestId('ai-visibility-generate-suggestions'));
    await waitFor(() =>
      expect(mocked.generateAiVisibilitySuggestions).toHaveBeenCalledWith('s1', 'en'),
    );
    const { toast } = await import('sonner');
    await waitFor(() =>
      expect((toast as unknown as { success: MockedFunction<AnyFn> }).success)
        .toHaveBeenCalled(),
    );
    expect(screen.getByTestId('ai-visibility-suggestions')).toHaveTextContent(
      'Output language: English',
    );
  });

  it('falls back to English when i18n exposes an unsupported resolved locale', () => {
    expect(resolveAiVisibilityOutputLocale('pt')).toBe('en');
    expect(resolveAiVisibilityOutputLocale('ar')).toBe('ar');
  });

  it('raises no success toast when the run is refused', async () => {
    const user = userEvent.setup();
    mocked.generateAiVisibilitySuggestions.mockRejectedValue(new Error('refused'));
    // The sonner mock lives at module scope, so a prior test's toast survives.
    const { toast } = await import('sonner');
    const success = (toast as unknown as { success: MockedFunction<AnyFn> }).success;
    success.mockClear();
    withProviders(<AiVisibilityPanel siteId="s1" />, baseStore());

    await user.click(screen.getByTestId('ai-visibility-generate-suggestions'));
    await waitFor(() => expect(mocked.generateAiVisibilitySuggestions).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('ai-visibility-generate-suggestions')).toBeEnabled(),
    );
    expect(success).not.toHaveBeenCalled();
  });

  it('says a completed generation returned nothing rather than asking for keywords', () => {
    withProviders(
      <AiVisibilityPanel siteId="s1" />,
      // `loaded: false` keeps the mount refetch (which would reset
      // `generatedAt`) out of the way — this asserts the stored state alone.
      makeStore({
        siteId: 's1',
        loaded: false,
        overview: makeOverview(),
        suggestionsGeneratedAt: '2026-03-01T00:00:00.000Z',
        suggestions: [],
      }),
    );
    const empty = screen.getByTestId('ai-visibility-suggestions-empty');
    expect(empty).toHaveTextContent(
      i18n.t('suggestions.emptyGenerated', { ns: 'aiVisibility' }),
    );
  });
});
