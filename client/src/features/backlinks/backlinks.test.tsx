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
  backlinksReducer,
  BacklinksPanel,
  backlinksRoutes,
  loadList,
  loadSummary,
  refreshSummary,
  apiErrorRetryAfterMs,
  apiErrorStatus,
  backlinksErrorMessage,
  DEFAULT_REFRESH_COOLDOWN_MS,
  resetBacklinks,
  setCursor,
  clearRefreshCooldown,
} from './index';
import { BacklinksPage } from './components/BacklinksPage';
import type { BacklinkList, BacklinkSummary } from './types';

vi.mock('./api', () => ({
  fetchBacklinkSummary: vi.fn(),
  fetchBacklinksList: vi.fn(),
  refreshBacklinkSummary: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const mocked = vi.mocked(api);

const makeStore = () =>
  configureStore({ reducer: { backlinks: backlinksReducer } });

const makeWorkspaceStore = () =>
  configureStore({
    reducer: {
      backlinks: backlinksReducer,
      sites: (
        state = {
          items: [{ id: 'abc', domain: 'example.com' }],
          loaded: true,
        },
      ) => state,
    },
  });

const summary = (overrides: Partial<BacklinkSummary> = {}): BacklinkSummary => ({
  domainRating: 62,
  backlinks: 1543,
  referringDomains: 208,
  brokenBacklinks: 12,
  firstSeen: '2024-05-14T08:31:04.000Z',
  fetchedAt: '2026-07-01T00:00:00.000Z',
  cached: false,
  delta: {
    domainRating: 3,
    backlinks: 40,
    referringDomains: 5,
    brokenBacklinks: -2,
  },
  ...overrides,
});

const list = (overrides: Partial<BacklinkList> = {}): BacklinkList => ({
  rows: [
    {
      urlFrom: 'https://blog.example.net/best-tools',
      urlTo: 'https://example.com/',
      anchor: 'example tool',
      dofollow: true,
      isBroken: false,
      firstSeen: '2024-05-14T08:31:04.000Z',
      lastSeen: '2026-06-30T12:00:00.000Z',
    },
    {
      urlFrom: 'https://news.example.org/x',
      urlTo: 'https://example.com/pricing',
      anchor: null,
      dofollow: false,
      isBroken: true,
      firstSeen: null,
      lastSeen: null,
    },
  ],
  nextCursor: 'next-token',
  cached: false,
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
  mocked.fetchBacklinkSummary.mockReset();
  mocked.fetchBacklinksList.mockReset();
  mocked.refreshBacklinkSummary.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('backlinks/routes', () => {
  it('exports a routes array with the expected path', () => {
    expect(backlinksRoutes).toHaveLength(1);
    expect(backlinksRoutes[0]?.path).toBe('sites/:siteId/backlinks');
  });
});

describe('backlinks slice + thunks', () => {
  it('loadSummary fulfilled populates summary', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    const store = makeStore();
    await store.dispatch(loadSummary({ siteId: 'a' }));
    const state = store.getState().backlinks;
    expect(state.summary?.backlinks).toBe(1543);
    expect(state.loaded).toBe(true);
  });

  it('loadSummary rejected surfaces the server error', async () => {
    mocked.fetchBacklinkSummary.mockRejectedValueOnce(
      new ApiError('boom', 500, { error: { message: 'server broke' } }),
    );
    const store = makeStore();
    await store.dispatch(loadSummary({ siteId: 'a' }));
    expect(store.getState().backlinks.error).toBe('server broke');
  });

  it('loadList with plain error falls back to i18n key', async () => {
    mocked.fetchBacklinksList.mockRejectedValueOnce(new Error('boom'));
    const store = makeStore();
    await store.dispatch(loadList({ siteId: 'a' }));
    expect(store.getState().backlinks.error).toBe(i18n.t('backlinks:loadFailed'));
  });

  it('loadSummary with plain (non-ApiError) failure falls back to i18n key', async () => {
    mocked.fetchBacklinkSummary.mockRejectedValueOnce(new Error('boom'));
    const store = makeStore();
    await store.dispatch(loadSummary({ siteId: 'a' }));
    expect(store.getState().backlinks.error).toBe(i18n.t('backlinks:loadFailed'));
  });

  it('resetBacklinks + setCursor reducers', () => {
    const store = makeStore();
    store.dispatch(setCursor('token'));
    expect(store.getState().backlinks.cursor).toBe('token');
    store.dispatch(resetBacklinks());
    expect(store.getState().backlinks.cursor).toBeNull();
  });

  it('appends rows on cursor load and keeps previous rows', async () => {
    mocked.fetchBacklinksList
      .mockResolvedValueOnce(list())
      .mockResolvedValueOnce({
        ...list(),
        rows: list().rows.slice(0, 1),
        nextCursor: null,
      });
    const store = makeStore();
    await store.dispatch(loadList({ siteId: 'a' }));
    await store.dispatch(loadList({ siteId: 'a', cursor: 'next-token' }));
    // 2 rows from the first page + 1 more = 3 rows total.
    expect(store.getState().backlinks.list?.rows).toHaveLength(3);
    expect(store.getState().backlinks.cursor).toBeNull();
  });

  it('replaces rows on a fresh (no-cursor) load', async () => {
    mocked.fetchBacklinksList
      .mockResolvedValueOnce(list())
      .mockResolvedValueOnce({
        ...list(),
        rows: list().rows.slice(0, 1),
      });
    const store = makeStore();
    await store.dispatch(loadList({ siteId: 'a' }));
    await store.dispatch(loadList({ siteId: 'a' }));
    // Second call had no cursor → replaces the first page.
    expect(store.getState().backlinks.list?.rows).toHaveLength(1);
  });

  it('appends onto a null list without crashing (?? [] arm)', async () => {
    mocked.fetchBacklinksList.mockResolvedValueOnce(list());
    const store = makeStore();
    // Prime the slice's siteId but leave list null.
    await store.dispatch(loadSummary({ siteId: 'a' }));
    // Cursor branch onto a null list.
    await store.dispatch(loadList({ siteId: 'a', cursor: 'x' }));
    expect(store.getState().backlinks.list?.rows).toHaveLength(2);
  });

  it('drops a fulfilled for a different siteId (stale response)', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    const store = makeStore();
    await store.dispatch(loadSummary({ siteId: 'a' }));
    // Simulate a stale fulfilled for site-b arriving after site-a is loaded.
    const staleAction: UnknownAction = {
      type: loadSummary.fulfilled.type,
      payload: summary({ backlinks: 9999 }),
      meta: {
        arg: { siteId: 'b' },
        requestId: 'stale',
        requestStatus: 'fulfilled' as const,
      },
    };
    store.dispatch(staleAction);
    expect(store.getState().backlinks.summary?.backlinks).toBe(1543);
  });

  it('re-keys on pending when the siteId changes', async () => {
    mocked.fetchBacklinkSummary
      .mockResolvedValueOnce(summary())
      .mockResolvedValueOnce(summary({ backlinks: 7 }));
    const store = makeStore();
    await store.dispatch(loadSummary({ siteId: 'a' }));
    expect(store.getState().backlinks.siteId).toBe('a');
    await store.dispatch(loadSummary({ siteId: 'b' }));
    expect(store.getState().backlinks.siteId).toBe('b');
    expect(store.getState().backlinks.summary?.backlinks).toBe(7);
  });

  it('drops an aborted rejected without painting an error', async () => {
    const rejectedAction: UnknownAction = {
      type: loadSummary.rejected.type,
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
    const store = makeStore();
    store.dispatch(rejectedAction);
    expect(store.getState().backlinks.error).toBe('');
    expect(store.getState().backlinks.loaded).toBe(false);
  });

  it('drops a rejected for a different siteId (stale)', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    const store = makeStore();
    await store.dispatch(loadSummary({ siteId: 'a' }));
    const staleRejected: UnknownAction = {
      type: loadSummary.rejected.type,
      payload: { error: 'stale err' },
      error: { message: 'boom' },
      meta: {
        arg: { siteId: 'b' },
        requestId: 'stale',
        requestStatus: 'rejected' as const,
        aborted: false,
        condition: false,
      },
    };
    store.dispatch(staleRejected);
    expect(store.getState().backlinks.error).toBe('');
  });

  it('drops loadList rejected for a different siteId', async () => {
    mocked.fetchBacklinksList.mockResolvedValueOnce(list());
    const store = makeStore();
    await store.dispatch(loadList({ siteId: 'a' }));
    const staleRejected: UnknownAction = {
      type: loadList.rejected.type,
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
    store.dispatch(staleRejected);
    expect(store.getState().backlinks.error).toBe('');
  });

  it('drops loadList fulfilled for a different siteId', async () => {
    mocked.fetchBacklinksList.mockResolvedValueOnce(list());
    const store = makeStore();
    await store.dispatch(loadList({ siteId: 'a' }));
    const stale: UnknownAction = {
      type: loadList.fulfilled.type,
      payload: {
        rows: [],
        nextCursor: null,
        cached: false,
      },
      meta: {
        arg: { siteId: 'b' },
        requestId: 'stale',
        requestStatus: 'fulfilled' as const,
      },
    };
    store.dispatch(stale);
    // Dropped (wrong siteId) → keeps site-a's rows.
    expect(store.getState().backlinks.list?.rows).toHaveLength(2);
  });

  it('drops loadList aborted rejected without painting error', () => {
    const store = makeStore();
    const aborted: UnknownAction = {
      type: loadList.rejected.type,
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
    expect(store.getState().backlinks.error).toBe('');
    expect(store.getState().backlinks.loaded).toBe(false);
  });

  it('loadSummary rejected with undefined payload hits ?? empty-string branch', () => {
    const store = makeStore();
    store.dispatch({
      type: loadSummary.pending.type,
      payload: undefined,
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'pending' as const, aborted: false, condition: false },
    } as UnknownAction);
    store.dispatch({
      type: loadSummary.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'rejected' as const, aborted: false, condition: false },
    } as UnknownAction);
    expect(store.getState().backlinks.error).toBe('');
  });

  it('loadList rejected with undefined payload hits ?? empty-string branch', () => {
    const store = makeStore();
    store.dispatch({
      type: loadList.pending.type,
      payload: undefined,
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'pending' as const, aborted: false, condition: false },
    } as UnknownAction);
    store.dispatch({
      type: loadList.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'rejected' as const, aborted: false, condition: false },
    } as UnknownAction);
    expect(store.getState().backlinks.error).toBe('');
  });

  it('refreshSummary rejected with undefined payload hits ?? empty-string branch', () => {
    const store = makeStore();
    store.dispatch({
      type: refreshSummary.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'rejected' as const, aborted: false, condition: false },
    } as UnknownAction);
    expect(store.getState().backlinks.refreshError).toBe('');
    expect(store.getState().backlinks.cooldownUntil).toBeNull();
  });
});

describe('errorMessage helpers', () => {
  it('backlinksErrorMessage returns server message from ApiError', () => {
    const err = new ApiError('x', 400, { error: { message: 'hi' } });
    expect(backlinksErrorMessage(err, 'backlinks:loadFailed')).toBe('hi');
  });

  it('backlinksErrorMessage falls back on empty message', () => {
    const err = new ApiError('x', 400, { error: { message: '' } });
    expect(backlinksErrorMessage(err, 'backlinks:loadFailed')).toBe(
      i18n.t('backlinks:loadFailed'),
    );
  });

  it('backlinksErrorMessage falls back on non-ApiError', () => {
    expect(backlinksErrorMessage(new Error('nope'), 'backlinks:loadFailed')).toBe(
      i18n.t('backlinks:loadFailed'),
    );
  });

  it('backlinksErrorMessage falls back when ApiError.data has no message', () => {
    const err = new ApiError('x', 400, undefined);
    expect(backlinksErrorMessage(err, 'backlinks:loadFailed')).toBe(
      i18n.t('backlinks:loadFailed'),
    );
  });

  it('apiErrorStatus returns status for ApiError; null for others', () => {
    expect(apiErrorStatus(new ApiError('x', 402, undefined))).toBe(402);
    expect(apiErrorStatus(new Error('boom'))).toBeNull();
  });
});

describe('api helpers', async () => {
  const realApi = await vi.importActual<typeof import('./api')>('./api');

  it('fetchBacklinksList builds cursor + limit query', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [], nextCursor: null, cached: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await realApi.fetchBacklinksList({ siteId: 's', cursor: 'c', limit: 10 });
    expect((spy.mock.calls[0]?.[0] as string).includes('cursor=c&limit=10')).toBe(true);
  });

  it('fetchBacklinksList omits query string when no args', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [], nextCursor: null, cached: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await realApi.fetchBacklinksList({ siteId: 's' });
    expect(spy.mock.calls[0]?.[0]).not.toContain('?');
  });

  it('fetchBacklinkSummary hits the summary path', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(summary()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await realApi.fetchBacklinkSummary('s');
    expect(spy.mock.calls[0]?.[0]).toContain('/sites/s/backlinks/summary');
  });

  it('fetchBacklinkSummary forwards an AbortSignal via init', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(summary()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const controller = new AbortController();
    await realApi.fetchBacklinkSummary('s', { signal: controller.signal });
    const signal = (spy.mock.calls[0]?.[1] as RequestInit).signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal).not.toBe(controller.signal);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it('fetchBacklinksList forwards an AbortSignal via init', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [], nextCursor: null, cached: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const controller = new AbortController();
    await realApi.fetchBacklinksList({ siteId: 's' }, { signal: controller.signal });
    const signal = (spy.mock.calls[0]?.[1] as RequestInit).signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal).not.toBe(controller.signal);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it('refreshBacklinkSummary POSTs to the refresh path', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      // Auto-CSRF fetches a token first, then the real POST.
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ csrfToken: 'x' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(summary()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    await realApi.refreshBacklinkSummary('s');
    expect(spy.mock.calls[1]?.[0]).toContain('/sites/s/backlinks/refresh');
    expect((spy.mock.calls[1]?.[1] as RequestInit).method).toBe('POST');
  });
});

describe('BacklinksPanel', () => {
  it('renders summary + list rows on success', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    mocked.fetchBacklinksList.mockResolvedValueOnce(list());
    withProviders(<BacklinksPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('backlinks-summary')).toBeInTheDocument();
      expect(screen.getByTestId('backlinks-row-0')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId(/backlinks-delta-/)).not.toHaveLength(0);
  });

  it('load-more clicks fetch next cursor page', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    mocked.fetchBacklinksList
      .mockResolvedValueOnce(list())
      .mockResolvedValueOnce({ ...list(), nextCursor: null });
    withProviders(<BacklinksPanel siteId="site-1" />);
    const btn = await screen.findByTestId('backlinks-load-more');
    await userEvent.click(btn);
    await waitFor(() => {
      expect(mocked.fetchBacklinksList).toHaveBeenCalledWith(
        { siteId: 'site-1', cursor: 'next-token' },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('renders empty state when list is empty and loaded', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    mocked.fetchBacklinksList.mockResolvedValueOnce({
      rows: [],
      nextCursor: null,
      cached: false,
    });
    withProviders(<BacklinksPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('backlinks-empty')).toBeInTheDocument();
    });
  });

  it('renders empty state in overview view when summary is null', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(null);
    mocked.fetchBacklinksList.mockResolvedValueOnce({
      rows: [],
      nextCursor: null,
      cached: false,
    });
    withProviders(<BacklinksPanel siteId="site-1" view="overview" />);
    await waitFor(() => {
      expect(screen.getByTestId('backlinks-empty')).toBeInTheDocument();
    });
  });

  it('renders error alert on load failures', async () => {
    mocked.fetchBacklinkSummary.mockRejectedValueOnce(
      new ApiError('boom', 500, { error: { message: 'server broke' } }),
    );
    mocked.fetchBacklinksList.mockRejectedValueOnce(
      new ApiError('boom', 500, { error: { message: 'server broke' } }),
    );
    withProviders(<BacklinksPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('backlinks-error')).toBeInTheDocument();
    });
  });

  it('renders null-domain-rating summary as em-dash', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(
      summary({ domainRating: null, delta: null }),
    );
    mocked.fetchBacklinksList.mockResolvedValueOnce(list());
    withProviders(<BacklinksPanel siteId="site-1" />);
    await waitFor(() => {
      const card = screen.getByTestId('backlinks-summary-dr');
      expect(card).toHaveTextContent('—');
    });
  });

  it('does not refetch on remount when the slice is already loaded for the same site', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValue(summary());
    mocked.fetchBacklinksList.mockResolvedValue(list());
    const store = makeStore();
    const rendered = withProviders(<BacklinksPanel siteId="site-1" />, store);
    await waitFor(() =>
      expect(mocked.fetchBacklinkSummary).toHaveBeenCalledTimes(1),
    );
    expect(mocked.fetchBacklinksList).toHaveBeenCalledTimes(1);
    rendered.unmount();
    // Second mount for the same site: the guard reuses state — no metered refetch.
    withProviders(<BacklinksPanel siteId="site-1" />, store);
    // Give React a tick to process the effect.
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked.fetchBacklinkSummary).toHaveBeenCalledTimes(1);
    expect(mocked.fetchBacklinksList).toHaveBeenCalledTimes(1);
  });

  it('aborts the in-flight loadSummary on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    mocked.fetchBacklinkSummary.mockImplementationOnce(
      (_siteId: string, init?: { signal?: AbortSignal }) => {
        capturedSignal = init?.signal;
        return new Promise(() => undefined);
      },
    );
    mocked.fetchBacklinksList.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    const rendered = withProviders(<BacklinksPanel siteId="site-1" />);
    await waitFor(() => expect(capturedSignal).toBeDefined());
    rendered.unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('renders positive/negative/null delta correctly', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(
      summary({
        delta: {
          domainRating: null,
          backlinks: 100,
          referringDomains: -5,
          brokenBacklinks: 0,
        },
      }),
    );
    mocked.fetchBacklinksList.mockResolvedValueOnce(list());
    withProviders(<BacklinksPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('backlinks-delta-links')).toHaveTextContent('+100');
      expect(screen.getByTestId('backlinks-delta-refdomains')).toHaveTextContent('-5');
      expect(screen.getByTestId('backlinks-delta-dr')).toHaveTextContent('—');
    });
  });
});

describe('BacklinksPage', () => {
  it('reads siteId from the standalone route and renders the full workspace', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    render(
      <Provider store={makeWorkspaceStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/abc/backlinks']}>
            <Routes>
              <Route path="/sites/:siteId/backlinks" element={<BacklinksPage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(await screen.findByTestId('link-intelligence-workspace')).not.toHaveAttribute(
      'data-embedded',
    );
    expect(screen.getByTestId('link-intel-tab-overview')).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('heading', { level: 1, name: 'Link intelligence' })).toBeVisible();
    await waitFor(() =>
      expect(mocked.fetchBacklinkSummary).toHaveBeenCalledWith(
        'abc',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it('accepts an explicit siteId and uses the nested view parameter', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    render(
      <Provider store={makeWorkspaceStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/prop-site?tab=backlinks&view=overview']}>
            <BacklinksPage siteId="prop-site" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(await screen.findByTestId('link-intelligence-workspace')).toHaveAttribute(
      'data-embedded',
      'true',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Link intelligence' })).toBeVisible();
    await waitFor(() =>
      expect(mocked.fetchBacklinkSummary).toHaveBeenCalledWith(
        'prop-site',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });
});

describe('backlinks refresh thunk + slice', () => {
  it('fulfilled replaces the summary and clears isRefreshing', async () => {
    mocked.refreshBacklinkSummary.mockResolvedValueOnce(
      summary({ backlinks: 9999, cached: false }),
    );
    const store = makeStore();
    await store.dispatch(refreshSummary({ siteId: 'a' }));
    const state = store.getState().backlinks;
    expect(state.summary?.backlinks).toBe(9999);
    expect(state.isRefreshing).toBe(false);
    expect(state.refreshError).toBe('');
  });

  it('429 sets cooldownUntil from retryAfterMs without locking or erroring', async () => {
    mocked.refreshBacklinkSummary.mockRejectedValueOnce(
      new ApiError('throttled', 429, {
        error: { message: 'wait', details: { retryAfterMs: 42_000 } },
      }),
    );
    const store = makeStore();
    const before = Date.now();
    await store.dispatch(refreshSummary({ siteId: 'a' }));
    const state = store.getState().backlinks;
    expect(state.cooldownUntil).toBeGreaterThanOrEqual(before + 42_000);
    expect(state.refreshError).toBe('');
    expect(state.isRefreshing).toBe(false);
  });

  it('429 without a parsable retryAfterMs falls back to the 60s default', async () => {
    mocked.refreshBacklinkSummary.mockRejectedValueOnce(
      new ApiError('throttled', 429, { error: { message: 'wait' } }),
    );
    const store = makeStore();
    const before = Date.now();
    await store.dispatch(refreshSummary({ siteId: 'a' }));
    expect(store.getState().backlinks.cooldownUntil).toBeGreaterThanOrEqual(
      before + DEFAULT_REFRESH_COOLDOWN_MS,
    );
  });

  it('503 sets refreshError and preserves the existing summary', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    const store = makeStore();
    await store.dispatch(loadSummary({ siteId: 'a' }));
    mocked.refreshBacklinkSummary.mockRejectedValueOnce(
      new ApiError('down', 503, { error: { message: 'vendor down' } }),
    );
    await store.dispatch(refreshSummary({ siteId: 'a' }));
    const state = store.getState().backlinks;
    expect(state.refreshError).toBe('vendor down');
    expect(state.summary?.backlinks).toBe(1543);
    expect(state.cooldownUntil).toBeNull();
  });

  it('clearRefreshCooldown resets cooldownUntil', async () => {
    mocked.refreshBacklinkSummary.mockRejectedValueOnce(
      new ApiError('throttled', 429, {
        error: { message: 'wait', details: { retryAfterMs: 10_000 } },
      }),
    );
    const store = makeStore();
    await store.dispatch(refreshSummary({ siteId: 'a' }));
    expect(store.getState().backlinks.cooldownUntil).not.toBeNull();
    store.dispatch(clearRefreshCooldown());
    expect(store.getState().backlinks.cooldownUntil).toBeNull();
  });

  it('apiErrorRetryAfterMs parses only positive numeric details', () => {
    expect(
      apiErrorRetryAfterMs(
        new ApiError('x', 429, { error: { details: { retryAfterMs: 5000 } } }),
      ),
    ).toBe(5000);
    expect(
      apiErrorRetryAfterMs(
        new ApiError('x', 429, { error: { details: { retryAfterMs: 'soon' } } }),
      ),
    ).toBeNull();
    expect(
      apiErrorRetryAfterMs(
        new ApiError('x', 429, { error: { details: { retryAfterMs: 0 } } }),
      ),
    ).toBeNull();
    expect(apiErrorRetryAfterMs(new ApiError('x', 429, {}))).toBeNull();
    expect(apiErrorRetryAfterMs(new Error('plain'))).toBeNull();
  });
});

describe('BacklinksPanel refresh button', () => {
  it('renders enabled with an aria-label and dispatches the refresh on click, then reloads the list', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    mocked.fetchBacklinksList.mockResolvedValue(list());
    mocked.refreshBacklinkSummary.mockResolvedValueOnce(
      summary({ backlinks: 7777, delta: null }),
    );
    withProviders(<BacklinksPanel siteId="site-1" />);
    const button = await screen.findByTestId('backlinks-refresh');
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleName('Refresh');

    await userEvent.click(button);
    await waitFor(() =>
      expect(mocked.refreshBacklinkSummary).toHaveBeenCalledWith('site-1'),
    );
    // Fresh data replaces the stat cards…
    await screen.findByText('7,777');
    // …and the invalidated list is re-fetched (mount + post-refresh).
    await waitFor(() =>
      expect(mocked.fetchBacklinksList).toHaveBeenCalledTimes(2),
    );
    expect(button).toBeEnabled();
  });

  it('disables and spins while the refresh is in flight', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    mocked.fetchBacklinksList.mockResolvedValue(list());
    let resolveRefresh: (v: BacklinkSummary) => void = () => undefined;
    mocked.refreshBacklinkSummary.mockImplementationOnce(
      () => new Promise((resolve) => (resolveRefresh = resolve)),
    );
    withProviders(<BacklinksPanel siteId="site-1" />);
    const button = await screen.findByTestId('backlinks-refresh');
    await userEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button.querySelector('svg')).toHaveClass('animate-spin');
    resolveRefresh(summary());
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('429 shows the countdown label on the disabled button', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    mocked.fetchBacklinksList.mockResolvedValue(list());
    mocked.refreshBacklinkSummary.mockRejectedValueOnce(
      new ApiError('throttled', 429, {
        error: { message: 'wait', details: { retryAfterMs: 30_000 } },
      }),
    );
    withProviders(<BacklinksPanel siteId="site-1" />);
    await userEvent.click(await screen.findByTestId('backlinks-refresh'));
    const button = await screen.findByTestId('backlinks-refresh');
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveTextContent(/Wait (30|29)s before refreshing\./);
  });

  it('failure raises a toast and keeps the previous data visible', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    mocked.fetchBacklinksList.mockResolvedValue(list());
    mocked.refreshBacklinkSummary.mockRejectedValueOnce(
      new ApiError('down', 503, { error: { message: 'vendor down' } }),
    );
    withProviders(<BacklinksPanel siteId="site-1" />);
    await screen.findByText('1,543');
    await userEvent.click(await screen.findByTestId('backlinks-refresh'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('vendor down'));
    // Prior summary still on screen.
    expect(screen.getByText('1,543')).toBeInTheDocument();
  });

  it('never touches the URL', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    mocked.fetchBacklinksList.mockResolvedValue(list());
    mocked.refreshBacklinkSummary.mockResolvedValueOnce(summary());
    let search = 'unset';
    const LocationProbe = () => {
      search = useLocation().search;
      return null;
    };
    withProviders(
      <>
        <BacklinksPanel siteId="site-1" />
        <LocationProbe />
      </>,
    );
    const before = search;
    await userEvent.click(await screen.findByTestId('backlinks-refresh'));
    await waitFor(() =>
      expect(mocked.refreshBacklinkSummary).toHaveBeenCalled(),
    );
    expect(search).toBe(before);
    expect(search).not.toContain('refresh');
  });

  it('renders the Arabic refresh label under the ar locale', async () => {
    await changeLanguage('ar');
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    mocked.fetchBacklinksList.mockResolvedValue(list());
    withProviders(<BacklinksPanel siteId="site-1" />);
    const button = await screen.findByTestId('backlinks-refresh');
    expect(button).toHaveTextContent('تحديث');
  });

  it('uses logical directional utilities only (RTL-safe)', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    mocked.fetchBacklinksList.mockResolvedValue(list());
    withProviders(<BacklinksPanel siteId="site-1" />);
    await screen.findByTestId('backlinks-refresh');
    const rawSrc = await import('./components/BacklinksPanel.tsx?raw');
    const src = rawSrc.default;
    expect(src).not.toMatch(/\btext-right\b|\btext-left\b/);
    expect(src).not.toMatch(/(?:^|["' \t]|:)[mp][lr]-\d/);
  });
});

describe('BacklinksPanel panel polish', () => {
  it('initial-load error shows a retry button that re-dispatches both loaders', async () => {
    mocked.fetchBacklinkSummary
      .mockRejectedValueOnce(
        new ApiError('boom', 500, { error: { message: 'server broke' } }),
      )
      .mockResolvedValueOnce(summary());
    mocked.fetchBacklinksList
      .mockRejectedValueOnce(
        new ApiError('boom', 500, { error: { message: 'server broke' } }),
      )
      .mockResolvedValueOnce(list());
    withProviders(<BacklinksPanel siteId="site-1" />);
    const retry = await screen.findByTestId('backlinks-retry');
    expect(retry).toHaveTextContent('Try again');
    expect(mocked.fetchBacklinkSummary).toHaveBeenCalledTimes(1);
    expect(mocked.fetchBacklinksList).toHaveBeenCalledTimes(1);

    await userEvent.click(retry);

    // Both loader thunks re-dispatched.
    await waitFor(() =>
      expect(mocked.fetchBacklinkSummary).toHaveBeenCalledTimes(2),
    );
    expect(mocked.fetchBacklinksList).toHaveBeenCalledTimes(2);
    // Fulfilled retry paints the summary and clears the error + retry affordance.
    await waitFor(() =>
      expect(screen.getByTestId('backlinks-summary')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('backlinks-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('backlinks-retry')).not.toBeInTheDocument();
  });

  it('empty state renders an Empty block with a refresh CTA that dispatches refresh', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValue(summary());
    mocked.fetchBacklinksList.mockResolvedValue({
      rows: [],
      nextCursor: null,
      cached: false,
    });
    mocked.refreshBacklinkSummary.mockResolvedValueOnce(summary());
    withProviders(<BacklinksPanel siteId="site-1" />);
    const empty = await screen.findByTestId('backlinks-empty');
    expect(empty).toHaveTextContent(i18n.t('backlinks:emptyTitle'));
    expect(empty).toHaveTextContent(i18n.t('backlinks:empty'));

    await userEvent.click(screen.getByTestId('backlinks-empty-refresh'));
    await waitFor(() =>
      expect(mocked.refreshBacklinkSummary).toHaveBeenCalledWith('site-1'),
    );
  });

  it('load-more button exposes aria-busy + spinner while in flight, then restores', async () => {
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(summary());
    let resolveNext: (v: BacklinkList) => void = () => undefined;
    mocked.fetchBacklinksList
      .mockResolvedValueOnce(list())
      .mockImplementationOnce(
        () => new Promise<BacklinkList>((resolve) => (resolveNext = resolve)),
      );
    withProviders(<BacklinksPanel siteId="site-1" />);
    const btn = await screen.findByTestId('backlinks-load-more');

    await userEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
    expect(btn).toBeDisabled();
    expect(btn.querySelector('svg')).toHaveClass('animate-spin');

    resolveNext({ ...list(), nextCursor: 'more-token' });
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
    expect(btn).toBeEnabled();
  });

  it('formats large counts with the active locale (fr grouping)', async () => {
    await changeLanguage('fr');
    mocked.fetchBacklinkSummary.mockResolvedValueOnce(
      summary({ backlinks: 1234567, delta: null }),
    );
    mocked.fetchBacklinksList.mockResolvedValueOnce(list());
    withProviders(<BacklinksPanel siteId="site-1" />);
    const card = await screen.findByTestId('backlinks-summary-links');
    // jest-dom normalizes the DOM's narrow-no-break spaces to ASCII spaces —
    // normalize the expected the same way so the substring match holds.
    const fr = new Intl.NumberFormat('fr').format(1234567).replace(/\s/g, ' ');
    const en = new Intl.NumberFormat('en').format(1234567);
    await waitFor(() => expect(card).toHaveTextContent(fr));
    expect(fr).not.toBe(en);
  });
});

describe('BacklinksPanel — renders before the lazy slice materializes', () => {
  it('does not throw when `state.backlinks` is still undefined on first render', async () => {
    // SiteWorkspacePage injects the 'backlinks' reducer and renders the panel
    // in the same tick, but RTK only materializes the slice on the NEXT
    // dispatched action — so the panel's very first render sees no
    // `state.backlinks` key. A bare store reproduces that precondition; the
    // selectors must fall back to initialState rather than throw (an unguarded
    // read here surfaces as the route-level "Page not found" boundary).
    const bareStore = configureStore({
      reducer: { unrelated: (s: Record<string, never> = {}) => s },
    });
    withProviders(<BacklinksPanel siteId="s1" />, bareStore as never);
    expect(await screen.findByTestId('backlinks-panel')).toBeInTheDocument();
  });
});
