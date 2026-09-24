import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import { toast } from 'sonner';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ApiError } from '@shared/api/client';
import * as api from './api';
import {
  localSeoReducer,
  LocalSeoPanel,
  LocalSeoPage,
  localSeoRoutes,
  loadLocalSeo,
  refreshLocalSeo,
  apiErrorRetryAfterMs,
  apiErrorStatus,
  localSeoErrorMessage,
  DEFAULT_REFRESH_COOLDOWN_MS,
  resetLocalSeo,
  clearRefreshCooldown,
  selectLocalSeoSiteId,
  selectLocalSeoSnapshot,
  selectLocalSeoLoading,
  selectLocalSeoLoaded,
  selectLocalSeoError,
  selectLocalSeoIsRefreshing,
  selectLocalSeoCooldownUntil,
  selectLocalSeoRefreshError,
} from './index';
import type { LocalSeoRefreshResult, LocalSeoSnapshot } from './types';

vi.mock('./api', () => ({
  fetchLocalSeo: vi.fn(),
  refreshLocalSeo: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const mocked = vi.mocked(api);

const makeStore = () =>
  configureStore({ reducer: { localSeo: localSeoReducer } });

const snapshot = (overrides: Partial<LocalSeoSnapshot> = {}): LocalSeoSnapshot => ({
  listings: [
    {
      source: 'Google Business',
      name: 'Acme Corp',
      address: '123 Main St',
      phone: '+1-555-0100',
      consistent: true,
    },
    {
      source: 'Yelp',
      name: 'Acme Corp',
      address: null,
      phone: null,
      consistent: false,
    },
  ],
  fetchedAt: '2026-07-01T00:00:00.000Z',
  reviews: {
    averageRating: 4.5,
    reviewCount: 123,
    unansweredQuestionCount: 2,
  },
  reviewsFetchedAt: '2026-07-01T00:00:00.000Z',
  localPack: [
    {
      keywordId: 'kw-1',
      phrase: 'plumbers near me',
      position: 2,
      totalPackSize: 3,
      checkedAt: '2026-07-01T00:00:00.000Z',
    },
  ],
  ...overrides,
});

const refreshResult = (
  overrides: Partial<LocalSeoRefreshResult> = {},
): LocalSeoRefreshResult => ({
  fetchedAt: '2026-07-02T00:00:00.000Z',
  listings: [
    {
      source: 'Google Business',
      name: 'Acme Corp',
      address: '123 Main St',
      phone: '+1-555-0100',
      consistent: true,
    },
  ],
  reviews: { averageRating: 4.7, reviewCount: 130 },
  qa: { unansweredCount: 1 },
  ...overrides,
});

const withProviders = (ui: React.ReactNode, store = makeStore()) =>
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{ui}</MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mocked.fetchLocalSeo.mockReset();
  mocked.refreshLocalSeo.mockReset();
});

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe('localSeo/routes', () => {
  it('exports a routes array with the expected path', () => {
    expect(localSeoRoutes).toHaveLength(1);
    expect(localSeoRoutes[0]?.path).toBe('sites/:siteId/local-seo');
  });

  it('legacy /local-seo path redirects to the workspace tab', () => {
    const route = localSeoRoutes[0]!;
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
          <MemoryRouter initialEntries={['/sites/abc/local-seo']}>
            <Routes>
              <Route path="sites/:siteId/local-seo" element={route.element} />
              <Route path="sites/:siteId" element={<Probe />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(dest).toBe('/sites/abc?tab=local-seo');
  });
});

// ---------------------------------------------------------------------------
// First-render safety (regression — 404/error-boundary crash)
// ---------------------------------------------------------------------------

describe('LocalSeoPanel — renders before the lazy slice materializes', () => {
  it('does not throw when `state.localSeo` is still undefined on first render', async () => {
    // Mirrors production exactly: SiteWorkspacePage's lazy loader calls
    // `rootReducer.inject({ reducerPath: 'localSeo', ... })` and renders the
    // panel in the same tick — but RTK's lazy-injected reducer only
    // materializes `state.localSeo` on the NEXT dispatched action, so the
    // panel's own first render must tolerate the key being absent. A bare
    // store with no `localSeo` key reproduces that exact precondition.
    const bareStore = configureStore({
      reducer: { unrelated: (s: Record<string, never> = {}) => s },
    });
    render(
      <Provider store={bareStore as never}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <LocalSeoPanel siteId="s1" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(await screen.findByTestId('local-seo-panel')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Slice + thunks (loadLocalSeo)
// ---------------------------------------------------------------------------

describe('localSeo slice + thunks', () => {
  it('loadLocalSeo fulfilled populates snapshot', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    const store = makeStore();
    await store.dispatch(loadLocalSeo({ siteId: 'a' }));
    expect(store.getState().localSeo.snapshot?.listings).toHaveLength(2);
    expect(store.getState().localSeo.loaded).toBe(true);
  });

  it('loadLocalSeo failure sets error', async () => {
    mocked.fetchLocalSeo.mockRejectedValueOnce(
      new ApiError('boom', 500, { error: { message: 'server broke' } }),
    );
    const store = makeStore();
    await store.dispatch(loadLocalSeo({ siteId: 'a' }));
    expect(store.getState().localSeo.error).toBe('server broke');
  });

  it('loadLocalSeo non-ApiError falls back to i18n key', async () => {
    mocked.fetchLocalSeo.mockRejectedValueOnce(new Error('boom'));
    const store = makeStore();
    await store.dispatch(loadLocalSeo({ siteId: 'a' }));
    expect(store.getState().localSeo.error).toBe(i18n.t('localSeo:loadFailed'));
  });

  it('resetLocalSeo resets state to initial', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    const store = makeStore();
    await store.dispatch(loadLocalSeo({ siteId: 'a' }));
    expect(store.getState().localSeo.loaded).toBe(true);
    store.dispatch(resetLocalSeo());
    expect(store.getState().localSeo.loaded).toBe(false);
    expect(store.getState().localSeo.siteId).toBeNull();
  });

  it('re-keys on pending when the siteId changes', async () => {
    mocked.fetchLocalSeo
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ fetchedAt: '2026-07-02T00:00:00.000Z' }));
    const store = makeStore();
    await store.dispatch(loadLocalSeo({ siteId: 'a' }));
    expect(store.getState().localSeo.siteId).toBe('a');
    await store.dispatch(loadLocalSeo({ siteId: 'b' }));
    expect(store.getState().localSeo.siteId).toBe('b');
  });

  it('keeps existing state when the same site reloads (rekeyForSite equal branch)', async () => {
    mocked.fetchLocalSeo.mockResolvedValue(snapshot());
    const store = makeStore();
    await store.dispatch(loadLocalSeo({ siteId: 'a' }));
    await store.dispatch(loadLocalSeo({ siteId: 'a' }));
    expect(store.getState().localSeo.siteId).toBe('a');
    expect(store.getState().localSeo.snapshot?.listings).toHaveLength(2);
  });

  it('drops a fulfilled for a different siteId (stale)', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    const store = makeStore();
    await store.dispatch(loadLocalSeo({ siteId: 'a' }));
    const stale: UnknownAction = {
      type: loadLocalSeo.fulfilled.type,
      payload: snapshot({ fetchedAt: '2099-01-01T00:00:00.000Z' }),
      meta: {
        arg: { siteId: 'b' },
        requestId: 'stale',
        requestStatus: 'fulfilled' as const,
      },
    };
    store.dispatch(stale);
    expect(store.getState().localSeo.snapshot?.fetchedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('drops a rejected for a different siteId (stale)', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    const store = makeStore();
    await store.dispatch(loadLocalSeo({ siteId: 'a' }));
    const stale: UnknownAction = {
      type: loadLocalSeo.rejected.type,
      payload: { error: 'stale' },
      error: { message: 'boom' },
      meta: {
        arg: { siteId: 'b' },
        requestId: 'stale',
        requestStatus: 'rejected' as const,
        aborted: false,
        condition: false,
      },
    };
    store.dispatch(stale);
    expect(store.getState().localSeo.error).toBe('');
  });

  it('drops an aborted rejected without painting an error', () => {
    const store = makeStore();
    const aborted: UnknownAction = {
      type: loadLocalSeo.rejected.type,
      payload: undefined,
      error: { message: 'Aborted', name: 'AbortError' },
      meta: {
        arg: { siteId: 'a' },
        requestId: 'req',
        requestStatus: 'rejected' as const,
        aborted: true,
        condition: false,
      },
    };
    store.dispatch(aborted);
    expect(store.getState().localSeo.error).toBe('');
    expect(store.getState().localSeo.loaded).toBe(false);
  });

  it('loadLocalSeo rejected with undefined payload hits ?? empty-string branch', () => {
    const store = makeStore();
    store.dispatch({
      type: loadLocalSeo.pending.type,
      payload: undefined,
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'pending' as const, aborted: false, condition: false },
    } as UnknownAction);
    store.dispatch({
      type: loadLocalSeo.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'rejected' as const, aborted: false, condition: false },
    } as UnknownAction);
    expect(store.getState().localSeo.error).toBe('');
  });
});

// ---------------------------------------------------------------------------
// errorMessage helpers
// ---------------------------------------------------------------------------

describe('errorMessage helpers', () => {
  it('localSeoErrorMessage returns server message from ApiError', () => {
    const err = new ApiError('x', 400, { error: { message: 'hi' } });
    expect(localSeoErrorMessage(err, 'localSeo:loadFailed')).toBe('hi');
  });

  it('localSeoErrorMessage falls back when message missing', () => {
    const err = new ApiError('x', 400, undefined);
    expect(localSeoErrorMessage(err, 'localSeo:loadFailed')).toBe(
      i18n.t('localSeo:loadFailed'),
    );
  });

  it('localSeoErrorMessage falls back when message empty', () => {
    const err = new ApiError('x', 400, { error: { message: '' } });
    expect(localSeoErrorMessage(err, 'localSeo:loadFailed')).toBe(
      i18n.t('localSeo:loadFailed'),
    );
  });

  it('localSeoErrorMessage falls back on non-ApiError', () => {
    expect(localSeoErrorMessage(new Error('n'), 'localSeo:loadFailed')).toBe(
      i18n.t('localSeo:loadFailed'),
    );
  });

  it('apiErrorStatus returns status for ApiError; null for others', () => {
    expect(apiErrorStatus(new ApiError('x', 409, undefined))).toBe(409);
    expect(apiErrorStatus(new Error('boom'))).toBeNull();
  });

  it('apiErrorRetryAfterMs parses only positive numeric details', () => {
    expect(
      apiErrorRetryAfterMs(
        new ApiError('x', 429, { error: { details: { retryAfterMs: 7000 } } }),
      ),
    ).toBe(7000);
    expect(apiErrorRetryAfterMs(new ApiError('x', 429, {}))).toBeNull();
    expect(apiErrorRetryAfterMs(new Error('plain'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Real API helpers (vi.importActual)
// ---------------------------------------------------------------------------

describe('api helpers', async () => {
  const realApi = await vi.importActual<typeof import('./api')>('./api');

  it('fetchLocalSeo (no init) hits the base GET path', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(snapshot()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await realApi.fetchLocalSeo('s');
    expect(spy.mock.calls[0]?.[0]).toContain('/sites/s/local-seo');
  });

  it('fetchLocalSeo forwards an AbortSignal via init (if-branch)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(snapshot()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const controller = new AbortController();
    await realApi.fetchLocalSeo('s', { signal: controller.signal });
    const signal = (spy.mock.calls[0]?.[1] as RequestInit).signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal).not.toBe(controller.signal);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it('refreshLocalSeo POSTs to the refresh path', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ csrfToken: 'tok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(refreshResult()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    await realApi.refreshLocalSeo('s');
    expect(spy.mock.calls[1]?.[0]).toContain('/sites/s/local-seo/refresh');
    expect((spy.mock.calls[1]?.[1] as RequestInit).method).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// Refresh thunk + slice
// ---------------------------------------------------------------------------

describe('localSeo refresh thunk + slice', () => {
  it('fulfilled merges into an existing snapshot (snapshot truthy branch)', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    const store = makeStore();
    await store.dispatch(loadLocalSeo({ siteId: 'a' }));

    mocked.refreshLocalSeo.mockResolvedValueOnce(refreshResult());
    await store.dispatch(refreshLocalSeo({ siteId: 'a' }));
    const state = store.getState().localSeo;
    expect(state.snapshot?.fetchedAt).toBe('2026-07-02T00:00:00.000Z');
    expect(state.snapshot?.listings).toHaveLength(1);
    expect(state.snapshot?.reviews?.averageRating).toBe(4.7);
    expect(state.isRefreshing).toBe(false);
    expect(state.refreshError).toBe('');
  });

  it('fulfilled creates snapshot with empty localPack when no prior snapshot (snapshot falsy branch)', async () => {
    const store = makeStore();
    mocked.refreshLocalSeo.mockResolvedValueOnce(refreshResult());
    await store.dispatch(refreshLocalSeo({ siteId: 'a' }));
    const state = store.getState().localSeo;
    expect(state.snapshot?.localPack).toEqual([]);
    expect(state.snapshot?.reviews?.reviewCount).toBe(130);
    expect(state.isRefreshing).toBe(false);
  });

  it('429 sets cooldownUntil from retryAfterMs without locking or erroring', async () => {
    mocked.refreshLocalSeo.mockRejectedValueOnce(
      new ApiError('throttled', 429, {
        error: { message: 'wait', details: { retryAfterMs: 15_000 } },
      }),
    );
    const store = makeStore();
    const before = Date.now();
    await store.dispatch(refreshLocalSeo({ siteId: 'a' }));
    const state = store.getState().localSeo;
    expect(state.cooldownUntil).toBeGreaterThanOrEqual(before + 15_000);
    expect(state.refreshError).toBe('');
  });

  it('429 without a parsable retryAfterMs falls back to the 60 s default', async () => {
    mocked.refreshLocalSeo.mockRejectedValueOnce(
      new ApiError('throttled', 429, { error: { message: 'wait' } }),
    );
    const store = makeStore();
    const before = Date.now();
    await store.dispatch(refreshLocalSeo({ siteId: 'a' }));
    expect(store.getState().localSeo.cooldownUntil).toBeGreaterThanOrEqual(
      before + DEFAULT_REFRESH_COOLDOWN_MS,
    );
  });

  it('503 sets refreshError and preserves existing snapshot', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    const store = makeStore();
    await store.dispatch(loadLocalSeo({ siteId: 'a' }));

    mocked.refreshLocalSeo.mockRejectedValueOnce(
      new ApiError('down', 503, { error: { message: 'vendor down' } }),
    );
    await store.dispatch(refreshLocalSeo({ siteId: 'a' }));
    const state = store.getState().localSeo;
    expect(state.refreshError).toBe('vendor down');
    expect(state.snapshot?.listings).toHaveLength(2);
    expect(state.cooldownUntil).toBeNull();
  });

  it('clearRefreshCooldown resets cooldownUntil', async () => {
    mocked.refreshLocalSeo.mockRejectedValueOnce(
      new ApiError('throttled', 429, {
        error: { message: 'wait', details: { retryAfterMs: 9_000 } },
      }),
    );
    const store = makeStore();
    await store.dispatch(refreshLocalSeo({ siteId: 'a' }));
    expect(store.getState().localSeo.cooldownUntil).not.toBeNull();
    store.dispatch(clearRefreshCooldown());
    expect(store.getState().localSeo.cooldownUntil).toBeNull();
  });

  it('refreshLocalSeo rejected with undefined payload hits ?? empty-string branch', () => {
    const store = makeStore();
    store.dispatch({
      type: refreshLocalSeo.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'rejected' as const, aborted: false, condition: false },
    } as UnknownAction);
    expect(store.getState().localSeo.refreshError).toBe('');
    expect(store.getState().localSeo.cooldownUntil).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe('selectors', () => {
  it('all selectors read initial state from state.localSeo', () => {
    const store = makeStore();
    const s = store.getState() as unknown as Parameters<typeof selectLocalSeoSiteId>[0];
    expect(selectLocalSeoSiteId(s)).toBeNull();
    expect(selectLocalSeoSnapshot(s)).toBeNull();
    expect(selectLocalSeoLoading(s)).toBe(false);
    expect(selectLocalSeoLoaded(s)).toBe(false);
    expect(selectLocalSeoError(s)).toBe('');
    expect(selectLocalSeoIsRefreshing(s)).toBe(false);
    expect(selectLocalSeoCooldownUntil(s)).toBeNull();
    expect(selectLocalSeoRefreshError(s)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// LocalSeoPanel — rendering states
// ---------------------------------------------------------------------------

describe('LocalSeoPanel', () => {
  it('shows the loading skeleton during the initial fetch', async () => {
    mocked.fetchLocalSeo.mockImplementationOnce(() => new Promise(() => undefined));
    withProviders(<LocalSeoPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('local-seo-loading')).toBeInTheDocument();
    });
  });

  it('shows the error alert on a failure', async () => {
    mocked.fetchLocalSeo.mockRejectedValueOnce(
      new ApiError('boom', 500, { error: { message: 'server broke' } }),
    );
    withProviders(<LocalSeoPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('local-seo-error')).toBeInTheDocument();
    });
  });

  it('renders listings card with consistent and inconsistent badge variants', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    withProviders(<LocalSeoPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('local-seo-listings')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('local-seo-listing-row-Google Business'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('local-seo-listing-row-Yelp')).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('localSeo:listings.consistent')),
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('localSeo:listings.inconsistent')),
    ).toBeInTheDocument();
    // address/phone nulls render as em-dash
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('renders reviews card with rating and review count', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    withProviders(<LocalSeoPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('local-seo-reviews')).toBeInTheDocument();
    });
    expect(screen.getByText('4.5')).toBeInTheDocument();
    expect(screen.getByText('123')).toBeInTheDocument();
  });

  it('formats a null averageRating as an em-dash (formatRating null branch)', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(
      snapshot({
        reviews: { averageRating: null, reviewCount: 5, unansweredQuestionCount: 0 },
      }),
    );
    withProviders(<LocalSeoPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('local-seo-reviews')).toBeInTheDocument();
    });
    // The em-dash value rendered by formatRating(null)
    const reviewsCard = screen.getByTestId('local-seo-reviews');
    expect(reviewsCard).toHaveTextContent('—');
  });

  it('renders local-pack card with ranked (#N) and not-ranked rows', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(
      snapshot({
        localPack: [
          {
            keywordId: 'kw-1',
            phrase: 'plumbers near me',
            position: 2,
            totalPackSize: 3,
            checkedAt: '2026-07-01T00:00:00.000Z',
          },
          {
            keywordId: 'kw-2',
            phrase: 'emergency plumber',
            position: null,
            totalPackSize: 3,
            checkedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    );
    withProviders(<LocalSeoPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('local-seo-local-pack')).toBeInTheDocument();
    });
    expect(screen.getByTestId('local-seo-local-pack-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('local-seo-local-pack-row-1')).toBeInTheDocument();
    // formatPosition(2, ...) → '#2'
    expect(screen.getByText('#2')).toBeInTheDocument();
    // formatPosition(null, ...) → notRanked label
    expect(
      screen.getByText(i18n.t('localSeo:localPack.notRanked')),
    ).toBeInTheDocument();
  });

  it('shows the empty state when the snapshot has no listings, reviews, or localPack', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(
      snapshot({ listings: [], reviews: null, reviewsFetchedAt: null, localPack: [] }),
    );
    withProviders(<LocalSeoPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('local-seo-empty')).toBeInTheDocument();
    });
    // Empty renders a title, description, and a refresh CTA.
    expect(screen.getByText(i18n.t('localSeo:emptyTitle'))).toBeInTheDocument();
    expect(screen.getByTestId('local-seo-empty-refresh')).toBeInTheDocument();
  });

  it('empty-state CTA dispatches a Local SEO refresh', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(
      snapshot({ listings: [], reviews: null, reviewsFetchedAt: null, localPack: [] }),
    );
    mocked.refreshLocalSeo.mockResolvedValueOnce(refreshResult());
    withProviders(<LocalSeoPanel siteId="site-1" />);
    const cta = await screen.findByTestId('local-seo-empty-refresh');
    await userEvent.click(cta);
    await waitFor(() =>
      expect(mocked.refreshLocalSeo).toHaveBeenCalledWith('site-1'),
    );
  });

  it('retry button re-dispatches the loader after a failed load (reject → retry → fulfilled)', async () => {
    mocked.fetchLocalSeo
      .mockRejectedValueOnce(
        new ApiError('boom', 500, { error: { message: 'server broke' } }),
      )
      .mockResolvedValueOnce(snapshot());
    withProviders(<LocalSeoPanel siteId="site-1" />);
    await screen.findByTestId('local-seo-error');
    const retry = screen.getByTestId('local-seo-retry');
    expect(retry).toHaveTextContent(i18n.t('common:retry'));
    await userEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByTestId('local-seo-listings')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('local-seo-error')).not.toBeInTheDocument();
    expect(mocked.fetchLocalSeo).toHaveBeenCalledTimes(2);
  });

  it('formats review + pack counts with the active locale (fr grouping)', async () => {
    await changeLanguage('fr');
    mocked.fetchLocalSeo.mockResolvedValueOnce(
      snapshot({
        reviews: {
          averageRating: 4.5,
          reviewCount: 12345,
          unansweredQuestionCount: 6789,
        },
        localPack: [
          {
            keywordId: 'kw',
            phrase: 'plombier',
            position: 1,
            totalPackSize: 1234,
            checkedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    );
    withProviders(<LocalSeoPanel siteId="site-1" />);
    await screen.findByTestId('local-seo-reviews');
    const nf = new Intl.NumberFormat('fr');
    const norm = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ');
    // fr groups thousands (unlike a bare digit run) — proves locale awareness.
    expect(nf.format(12345)).not.toBe('12345');
    const reviews = norm(screen.getByTestId('local-seo-reviews').textContent ?? '');
    expect(reviews).toContain(norm(nf.format(12345)));
    expect(reviews).toContain(norm(nf.format(6789)));
    const pack = norm(screen.getByTestId('local-seo-local-pack').textContent ?? '');
    expect(pack).toContain(norm(nf.format(1234)));
  });

  it('does not refetch on remount when the slice already holds that siteId', async () => {
    mocked.fetchLocalSeo.mockResolvedValue(snapshot());
    const store = makeStore();
    const rendered = withProviders(<LocalSeoPanel siteId="site-1" />, store);
    await waitFor(() =>
      expect(mocked.fetchLocalSeo).toHaveBeenCalledTimes(1),
    );
    rendered.unmount();
    withProviders(<LocalSeoPanel siteId="site-1" />, store);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked.fetchLocalSeo).toHaveBeenCalledTimes(1);
  });

  it('aborts the in-flight loadLocalSeo on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    mocked.fetchLocalSeo.mockImplementationOnce(
      (_siteId: string, init?: { signal?: AbortSignal }) => {
        capturedSignal = init?.signal;
        return new Promise(() => undefined);
      },
    );
    const rendered = withProviders(<LocalSeoPanel siteId="site-1" />);
    await waitFor(() => expect(capturedSignal).toBeDefined());
    rendered.unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LocalSeoPage
// ---------------------------------------------------------------------------

describe('LocalSeoPage', () => {
  it('reads siteId from the route param and renders the panel', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/abc/local-seo']}>
            <LocalSeoPage />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('local-seo-panel')).toBeInTheDocument();
    });
  });

  it('accepts an explicit siteId prop (workspace embed path)', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <LocalSeoPage siteId="prop-site" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await waitFor(() =>
      expect(mocked.fetchLocalSeo).toHaveBeenCalledWith(
        'prop-site',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// LocalSeoPanel — refresh button
// ---------------------------------------------------------------------------

describe('LocalSeoPanel refresh button', () => {
  it('renders enabled with the correct aria-label, dispatches on click', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    mocked.refreshLocalSeo.mockResolvedValueOnce(refreshResult());
    withProviders(<LocalSeoPanel siteId="site-9" />);
    const button = await screen.findByTestId('local-seo-refresh');
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleName(i18n.t('localSeo:refresh.button'));
    await userEvent.click(button);
    await waitFor(() =>
      expect(mocked.refreshLocalSeo).toHaveBeenCalledWith('site-9'),
    );
    expect(button).toBeEnabled();
  });

  it('disables and spins while the refresh is in flight', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    let resolveRefresh: (v: LocalSeoRefreshResult) => void = () => undefined;
    mocked.refreshLocalSeo.mockImplementationOnce(
      () => new Promise((resolve) => (resolveRefresh = resolve)),
    );
    withProviders(<LocalSeoPanel siteId="site-9" />);
    const button = await screen.findByTestId('local-seo-refresh');
    await userEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button.querySelector('svg')).toHaveClass('animate-spin');
    resolveRefresh(refreshResult());
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('429 shows the countdown label on the disabled button', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    mocked.refreshLocalSeo.mockRejectedValueOnce(
      new ApiError('throttled', 429, {
        error: { message: 'wait', details: { retryAfterMs: 20_000 } },
      }),
    );
    withProviders(<LocalSeoPanel siteId="site-9" />);
    await userEvent.click(await screen.findByTestId('local-seo-refresh'));
    const button = await screen.findByTestId('local-seo-refresh');
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveTextContent(/Refresh in (20|19)s/);
  });

  it('failure raises a toast and keeps the previous data visible', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    mocked.refreshLocalSeo.mockRejectedValueOnce(
      new ApiError('down', 503, { error: { message: 'vendor down' } }),
    );
    withProviders(<LocalSeoPanel siteId="site-9" />);
    await screen.findByText('Google Business');
    await userEvent.click(await screen.findByTestId('local-seo-refresh'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('vendor down'));
    expect(screen.getByText('Google Business')).toBeInTheDocument();
  });

  it('never touches the URL on refresh', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    mocked.refreshLocalSeo.mockResolvedValueOnce(refreshResult());
    let search = 'unset';
    const LocationProbe = () => {
      search = useLocation().search;
      return null;
    };
    withProviders(
      <>
        <LocalSeoPanel siteId="site-9" />
        <LocationProbe />
      </>,
    );
    const before = search;
    await userEvent.click(await screen.findByTestId('local-seo-refresh'));
    await waitFor(() => expect(mocked.refreshLocalSeo).toHaveBeenCalled());
    expect(search).toBe(before);
    expect(search).not.toContain('refresh');
  });

  it('renders the Arabic refresh label under the ar locale', async () => {
    await changeLanguage('ar');
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    withProviders(<LocalSeoPanel siteId="site-9" />);
    const button = await screen.findByTestId('local-seo-refresh');
    expect(button).toHaveTextContent('تحديث البيانات المحلية');
  });

  it('uses logical directional utilities only (RTL-safe)', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(snapshot());
    withProviders(<LocalSeoPanel siteId="site-1" />);
    await screen.findByTestId('local-seo-refresh');
    const rawSrc = await import('./components/LocalSeoPanel.tsx?raw');
    const src = rawSrc.default;
    expect(src).not.toMatch(/\btext-right\b|\btext-left\b/);
    expect(src).not.toMatch(/(?:^|["' \t]|:)[mp][lr]-\d/);
  });
});
