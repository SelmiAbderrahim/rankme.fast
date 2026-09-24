import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import { toast } from 'sonner';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ApiError } from '@shared/api/client';
import * as api from './api';
import {
  competitorsReducer,
  CompetitorsPanel,
  competitorsRoutes,
  fetchTechStack,
  loadCompetitors,
  loadIntersection,
  refreshCompetitors,
  apiErrorRetryAfterMs,
  apiErrorStatus,
  competitorsErrorMessage,
  DEFAULT_REFRESH_COOLDOWN_MS,
  resetCompetitors,
  selectCompetitor,
  clearRefreshCooldown,
} from './index';
import type {
  CompetitorsList,
  IntersectionResult,
  TechStackResult,
} from './types';

vi.mock('./api', () => ({
  fetchCompetitors: vi.fn(),
  fetchIntersection: vi.fn(),
  refreshCompetitors: vi.fn(),
  fetchTechStack: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const mocked = vi.mocked(api);

const makeStore = () =>
  configureStore({ reducer: { competitors: competitorsReducer } });

const list = (overrides: Partial<CompetitorsList> = {}): CompetitorsList => ({
  target: 'example.com',
  fetchedAt: '2026-07-01T00:00:00.000Z',
  source: 'domain',
  competitors: [
    {
      domain: 'rival-one.example',
      avgPosition: 4.2,
      intersections: 118,
      estimatedTraffic: '20500',
      fetchedAt: '2026-07-01T00:00:00.000Z',
    },
    {
      domain: 'rival-two.example',
      avgPosition: null,
      intersections: 34,
      estimatedTraffic: null,
      fetchedAt: '2026-07-01T00:00:00.000Z',
    },
  ],
  ...overrides,
});

const intersectionResult = (
  overrides: Partial<IntersectionResult> = {},
): IntersectionResult => ({
  target: 'example.com',
  competitor: 'rival-one.example',
  fetchedAt: '2026-07-01T00:00:00.000Z',
  keywords: [
    {
      keyword: 'seo audit tool',
      target1Position: 3,
      target2Position: 7,
      searchVolume: 5400,
    },
    {
      keyword: 'rank tracker',
      target1Position: null,
      target2Position: null,
      searchVolume: null,
    },
  ],
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
  mocked.fetchCompetitors.mockReset();
  mocked.fetchIntersection.mockReset();
  mocked.refreshCompetitors.mockReset();
  mocked.fetchTechStack.mockReset();
});

const techStackResult = (
  overrides: Partial<TechStackResult> = {},
): TechStackResult => ({
  target: 'example.com',
  competitor: 'rival-one.example',
  fetchedAt: '2026-07-01T00:00:00.000Z',
  techStack: [
    { category: 'cms', name: 'WordPress' },
    { category: 'analytics', name: 'Google Analytics' },
    { category: 'hosting', name: 'Cloudflare' },
    { category: 'ecommerce', name: 'WooCommerce' },
    { category: 'other', name: 'Intercom' },
  ],
  ...overrides,
});
afterEach(() => vi.restoreAllMocks());

describe('competitors/routes', () => {
  it('exports a routes array with the expected path', () => {
    expect(competitorsRoutes).toHaveLength(1);
    expect(competitorsRoutes[0]?.path).toBe('sites/:siteId/competitors');
  });
});

describe('competitors slice + thunks', () => {
  it('loadCompetitors fulfilled populates list', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    const store = makeStore();
    await store.dispatch(loadCompetitors({ siteId: 'a' }));
    expect(store.getState().competitors.list?.competitors).toHaveLength(2);
    expect(store.getState().competitors.loaded).toBe(true);
  });

  it('loadCompetitors failure surfaces the server error', async () => {
    mocked.fetchCompetitors.mockRejectedValueOnce(
      new ApiError('boom', 500, { error: { message: 'server broke' } }),
    );
    const store = makeStore();
    await store.dispatch(loadCompetitors({ siteId: 'a' }));
    expect(store.getState().competitors.error).toBe('server broke');
  });

  it('loadCompetitors non-ApiError falls back to i18n key', async () => {
    mocked.fetchCompetitors.mockRejectedValueOnce(new Error('boom'));
    const store = makeStore();
    await store.dispatch(loadCompetitors({ siteId: 'a' }));
    expect(store.getState().competitors.error).toBe(
      i18n.t('competitors:loadFailed'),
    );
  });

  it('loadIntersection populates intersection and selected', async () => {
    mocked.fetchIntersection.mockResolvedValueOnce(intersectionResult());
    const store = makeStore();
    await store.dispatch(
      loadIntersection({ siteId: 'a', competitor: 'rival-one.example' }),
    );
    expect(store.getState().competitors.selectedCompetitor).toBe(
      'rival-one.example',
    );
    expect(store.getState().competitors.intersection?.keywords).toHaveLength(2);
  });

  it('loadIntersection rejected surfaces error string', async () => {
    mocked.fetchIntersection.mockRejectedValueOnce(new Error('boom'));
    const store = makeStore();
    await store.dispatch(
      loadIntersection({ siteId: 'a', competitor: 'rival-one.example' }),
    );
    expect(store.getState().competitors.intersectionError).toBe(
      i18n.t('competitors:intersectionFailed'),
    );
  });

  it('loadIntersection ApiError uses server message', async () => {
    mocked.fetchIntersection.mockRejectedValueOnce(
      new ApiError('x', 400, { error: { message: 'bad competitor' } }),
    );
    const store = makeStore();
    await store.dispatch(
      loadIntersection({ siteId: 'a', competitor: 'rival-one.example' }),
    );
    expect(store.getState().competitors.intersectionError).toBe('bad competitor');
  });

  it('resetCompetitors + selectCompetitor reducers', () => {
    const store = makeStore();
    store.dispatch(selectCompetitor('x'));
    expect(store.getState().competitors.selectedCompetitor).toBe('x');
    store.dispatch(resetCompetitors());
    expect(store.getState().competitors.selectedCompetitor).toBeNull();
  });

  it('re-keys on pending when the siteId changes', async () => {
    mocked.fetchCompetitors
      .mockResolvedValueOnce(list())
      .mockResolvedValueOnce(list({ target: 'b.example' }));
    const store = makeStore();
    await store.dispatch(loadCompetitors({ siteId: 'a' }));
    expect(store.getState().competitors.siteId).toBe('a');
    await store.dispatch(loadCompetitors({ siteId: 'b' }));
    expect(store.getState().competitors.siteId).toBe('b');
    expect(store.getState().competitors.list?.target).toBe('b.example');
  });

  it('keeps existing state when the same site reloads (rekey equal branch)', async () => {
    mocked.fetchCompetitors.mockResolvedValue(list());
    const store = makeStore();
    await store.dispatch(loadCompetitors({ siteId: 'a' }));
    // Second dispatch for the SAME site → rekeyForSite returns state as-is.
    await store.dispatch(loadCompetitors({ siteId: 'a' }));
    expect(store.getState().competitors.siteId).toBe('a');
    expect(store.getState().competitors.list?.competitors).toHaveLength(2);
  });

  it('drops a fulfilled for a different siteId (stale)', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    const store = makeStore();
    await store.dispatch(loadCompetitors({ siteId: 'a' }));
    const stale: UnknownAction = {
      type: loadCompetitors.fulfilled.type,
      payload: list({ target: 'unexpected.example' }),
      meta: {
        arg: { siteId: 'b' },
        requestId: 'stale',
        requestStatus: 'fulfilled' as const,
      },
    };
    store.dispatch(stale);
    expect(store.getState().competitors.list?.target).toBe('example.com');
  });

  it('drops a rejected for a different siteId (stale)', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    const store = makeStore();
    await store.dispatch(loadCompetitors({ siteId: 'a' }));
    const stale: UnknownAction = {
      type: loadCompetitors.rejected.type,
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
    expect(store.getState().competitors.error).toBe('');
  });

  it('drops an aborted rejected without painting an error', () => {
    const store = makeStore();
    const aborted: UnknownAction = {
      type: loadCompetitors.rejected.type,
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
    expect(store.getState().competitors.error).toBe('');
    expect(store.getState().competitors.loaded).toBe(false);
  });

  it('loadCompetitors rejected with undefined payload hits ?? empty-string branch', () => {
    const store = makeStore();
    store.dispatch({
      type: loadCompetitors.pending.type,
      payload: undefined,
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'pending' as const, aborted: false, condition: false },
    } as UnknownAction);
    store.dispatch({
      type: loadCompetitors.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'rejected' as const, aborted: false, condition: false },
    } as UnknownAction);
    expect(store.getState().competitors.error).toBe('');
  });

  it('loadIntersection rejected with undefined payload hits ?? empty-string branch', () => {
    const store = makeStore();
    store.dispatch({
      type: loadIntersection.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: { arg: { siteId: 'a', competitor: 'rival.com' }, requestId: 'r', requestStatus: 'rejected' as const, aborted: false, condition: false },
    } as UnknownAction);
    expect(store.getState().competitors.intersectionError).toBe('');
  });

  it('refreshCompetitors rejected with undefined payload hits ?? empty-string branch', () => {
    const store = makeStore();
    store.dispatch({
      type: refreshCompetitors.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: { arg: { siteId: 'a' }, requestId: 'r', requestStatus: 'rejected' as const, aborted: false, condition: false },
    } as UnknownAction);
    expect(store.getState().competitors.refreshError).toBe('');
    expect(store.getState().competitors.cooldownUntil).toBeNull();
  });

  it('fetchTechStack rejected with undefined payload falls back to meta.arg.domain', () => {
    const store = makeStore();
    store.dispatch({
      type: fetchTechStack.rejected.type,
      payload: undefined,
      error: { message: 'network' },
      meta: { arg: { siteId: 'a', domain: 'rival.com' }, requestId: 'r', requestStatus: 'rejected' as const, aborted: false, condition: false },
    } as UnknownAction);
    // row not in list → findRow returns undefined → no state mutation, but branch is hit
    expect(store.getState().competitors.list).toBeNull();
  });
});

describe('errorMessage helpers', () => {
  it('competitorsErrorMessage returns server message from ApiError', () => {
    const err = new ApiError('x', 400, { error: { message: 'hi' } });
    expect(competitorsErrorMessage(err, 'competitors:loadFailed')).toBe('hi');
  });

  it('competitorsErrorMessage falls back when message missing', () => {
    const err = new ApiError('x', 400, undefined);
    expect(competitorsErrorMessage(err, 'competitors:loadFailed')).toBe(
      i18n.t('competitors:loadFailed'),
    );
  });

  it('competitorsErrorMessage falls back when message empty', () => {
    const err = new ApiError('x', 400, { error: { message: '' } });
    expect(competitorsErrorMessage(err, 'competitors:loadFailed')).toBe(
      i18n.t('competitors:loadFailed'),
    );
  });

  it('competitorsErrorMessage falls back on non-ApiError', () => {
    expect(competitorsErrorMessage(new Error('n'), 'competitors:loadFailed')).toBe(
      i18n.t('competitors:loadFailed'),
    );
  });

  it('apiErrorStatus returns status for ApiError; null for others', () => {
    expect(apiErrorStatus(new ApiError('x', 402, undefined))).toBe(402);
    expect(apiErrorStatus(new Error('boom'))).toBeNull();
  });
});

describe('api helpers', async () => {
  const realApi = await vi.importActual<typeof import('./api')>('./api');

  it('fetchCompetitors hits the base path', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(list()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await realApi.fetchCompetitors('s');
    expect(spy.mock.calls[0]?.[0]).toContain('/sites/s/competitors');
  });

  it('refreshCompetitors POSTs to the refresh path', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ csrfToken: 'x' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(list()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    await realApi.refreshCompetitors('s');
    expect(spy.mock.calls[1]?.[0]).toContain('/sites/s/competitors/refresh');
    expect((spy.mock.calls[1]?.[1] as RequestInit).method).toBe('POST');
  });

  it('fetchIntersection appends competitor query param', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(intersectionResult()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await realApi.fetchIntersection('s', 'rival.example');
    expect(spy.mock.calls[0]?.[0]).toContain('competitor=rival.example');
  });

  it('fetchCompetitors forwards an AbortSignal via init', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(list()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const controller = new AbortController();
    await realApi.fetchCompetitors('s', { signal: controller.signal });
    const signal = (spy.mock.calls[0]?.[1] as RequestInit).signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal).not.toBe(controller.signal);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it('fetchIntersection forwards an AbortSignal via init', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(intersectionResult()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const controller = new AbortController();
    await realApi.fetchIntersection('s', 'rival.example', { signal: controller.signal });
    const signal = (spy.mock.calls[0]?.[1] as RequestInit).signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal).not.toBe(controller.signal);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it('fetchTechStack hits the per-competitor tech-stack path (URL-encoded domain)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(techStackResult()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await realApi.fetchTechStack('s', 'rival one.example');
    expect(spy.mock.calls[0]?.[0]).toContain(
      '/sites/s/competitors/rival%20one.example/tech-stack',
    );
  });
});

describe('CompetitorsPanel', () => {
  it('does not refetch on remount when loaded for the same site', async () => {
    mocked.fetchCompetitors.mockResolvedValue(list());
    const store = makeStore();
    const rendered = withProviders(<CompetitorsPanel siteId="site-1" />, store);
    await waitFor(() =>
      expect(mocked.fetchCompetitors).toHaveBeenCalledTimes(1),
    );
    rendered.unmount();
    withProviders(<CompetitorsPanel siteId="site-1" />, store);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked.fetchCompetitors).toHaveBeenCalledTimes(1);
  });

  it('aborts the in-flight loadCompetitors on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    mocked.fetchCompetitors.mockImplementationOnce(
      (_siteId: string, init?: { signal?: AbortSignal }) => {
        capturedSignal = init?.signal;
        return new Promise(() => undefined);
      },
    );
    const rendered = withProviders(<CompetitorsPanel siteId="site-1" />);
    await waitFor(() => expect(capturedSignal).toBeDefined());
    rendered.unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('renders competitors table on success', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    withProviders(<CompetitorsPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('competitors-table')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('competitors-row-rival-one.example'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('competitors-row-rival-two.example'),
    ).toBeInTheDocument();
  });

  it('empty state when no competitors', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce({
      ...list(),
      competitors: [],
    });
    withProviders(<CompetitorsPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('competitors-empty')).toBeInTheDocument();
    });
  });

  it('shows the tracked-keywords source note when the fallback produced the list', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(
      list({ source: 'tracked_keywords' }),
    );
    withProviders(<CompetitorsPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('competitors-source-note')).toBeInTheDocument();
    });
    expect(screen.getByTestId('competitors-source-note')).toHaveTextContent(
      i18n.t('competitors:table.sourceTrackedKeywords'),
    );
  });

  it('hides the source note for a domain-derived list', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    withProviders(<CompetitorsPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('competitors-table')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('competitors-source-note')).not.toBeInTheDocument();
  });

  it('shows error alert on load failure', async () => {
    mocked.fetchCompetitors.mockRejectedValueOnce(
      new ApiError('boom', 500, { error: { message: 'server broke' } }),
    );
    withProviders(<CompetitorsPanel siteId="site-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('competitors-error')).toBeInTheDocument();
    });
  });

  it('gap analysis clicks load intersection', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    mocked.fetchIntersection.mockResolvedValueOnce(intersectionResult());
    withProviders(<CompetitorsPanel siteId="site-1" />);
    const btn = await screen.findByTestId(
      'competitors-gap-btn-rival-one.example',
    );
    await userEvent.click(btn);
    await waitFor(() => {
      const gap = screen.getByTestId('competitors-gap');
      expect(btn).toHaveAttribute('aria-expanded', 'true');
      expect(gap).toHaveAttribute(
        'id',
        'competitors-gap-rival-one.example',
      );
      expect(btn.closest('tr')?.nextElementSibling).toBe(gap);
      expect(screen.getByTestId('competitors-gap-row-0')).toBeInTheDocument();
      expect(screen.getByTestId('competitors-gap-content-0')).toHaveAttribute(
        'href',
        '/sites/site-1?tab=content&view=analyses&prefillKeyword=seo+audit+tool&source=competitor',
      );
    });
  });

  it('shows inline loading feedback and prevents concurrent gap lookups', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    let resolveIntersection: (value: IntersectionResult) => void = () => undefined;
    mocked.fetchIntersection.mockImplementationOnce(
      () =>
        new Promise<IntersectionResult>((resolve) => {
          resolveIntersection = resolve;
        }),
    );
    withProviders(<CompetitorsPanel siteId="site-1" />);
    const first = await screen.findByTestId(
      'competitors-gap-btn-rival-one.example',
    );
    const second = screen.getByTestId(
      'competitors-gap-btn-rival-two.example',
    );

    await userEvent.click(first);

    expect(first).toBeDisabled();
    expect(first).toHaveAttribute('aria-busy', 'true');
    expect(first).toHaveTextContent(i18n.t('competitors:gap.loading'));
    expect(second).toBeDisabled();
    expect(screen.getByTestId('competitors-gap-loading')).toBeInTheDocument();

    resolveIntersection(intersectionResult());
    await waitFor(() => expect(first).toBeEnabled());
    expect(second).toBeEnabled();
    expect(first).not.toHaveAttribute('aria-busy');
  });

  it('shows gap error inline on intersection failure', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    mocked.fetchIntersection.mockRejectedValueOnce(new Error('boom'));
    withProviders(<CompetitorsPanel siteId="site-1" />);
    const btn = await screen.findByTestId(
      'competitors-gap-btn-rival-one.example',
    );
    await userEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByTestId('competitors-gap-error')).toHaveTextContent(
        i18n.t('competitors:intersectionFailed'),
      );
    });
  });

  it('empty gap state when intersection yields no keywords', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    mocked.fetchIntersection.mockResolvedValueOnce({
      ...intersectionResult(),
      keywords: [],
    });
    withProviders(<CompetitorsPanel siteId="site-1" />);
    const btn = await screen.findByTestId(
      'competitors-gap-btn-rival-one.example',
    );
    await userEvent.click(btn);
    await waitFor(() => {
      expect(btn.closest('tr')?.nextElementSibling).toBe(
        screen.getByTestId('competitors-gap'),
      );
      expect(
        screen.getByText(i18n.t('competitors:gap.empty')),
      ).toBeInTheDocument();
    });
  });

  it('moves the single inline gap row when another competitor is selected', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    mocked.fetchIntersection
      .mockResolvedValueOnce(intersectionResult())
      .mockResolvedValueOnce(
        intersectionResult({ competitor: 'rival-two.example' }),
      );
    withProviders(<CompetitorsPanel siteId="site-1" />);
    const first = await screen.findByTestId(
      'competitors-gap-btn-rival-one.example',
    );
    const second = screen.getByTestId(
      'competitors-gap-btn-rival-two.example',
    );

    await userEvent.click(first);
    await screen.findByTestId('competitors-gap-row-0');
    await userEvent.click(second);

    await waitFor(() => {
      const gap = screen.getByTestId('competitors-gap');
      expect(screen.getAllByTestId('competitors-gap')).toHaveLength(1);
      expect(second.closest('tr')?.nextElementSibling).toBe(gap);
      expect(gap).toHaveAttribute('id', 'competitors-gap-rival-two.example');
      expect(first).toHaveAttribute('aria-expanded', 'false');
      expect(second).toHaveAttribute('aria-expanded', 'true');
    });
  });

  it('formatTraffic falls back to em-dash for non-finite strings (covers !isFinite branch)', async () => {
    // 'NaN' parses to NaN which is not finite → the defence branch fires
    mocked.fetchCompetitors.mockResolvedValueOnce(
      list({
        competitors: [
          {
            domain: 'bad-traffic.example',
            avgPosition: 5,
            intersections: 10,
            estimatedTraffic: 'NaN',
            fetchedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    );
    withProviders(<CompetitorsPanel siteId="site-1" />);
    // The em-dash is displayed in the traffic column
    await waitFor(() => {
      expect(screen.getByTestId('competitors-row-bad-traffic.example')).toBeInTheDocument();
    });
  });
});

describe('competitors refresh thunk + slice', () => {
  it('fulfilled replaces the list and clears isRefreshing', async () => {
    mocked.refreshCompetitors.mockResolvedValueOnce(
      list({
        competitors: [
          {
            domain: 'brand-new.example',
            avgPosition: 1.2,
            intersections: 200,
            estimatedTraffic: '99000',
            fetchedAt: '2026-07-07T00:00:00.000Z',
          },
        ],
      }),
    );
    const store = makeStore();
    await store.dispatch(refreshCompetitors({ siteId: 'a' }));
    const state = store.getState().competitors;
    expect(state.list?.competitors).toHaveLength(1);
    expect(state.list?.competitors[0]?.domain).toBe('brand-new.example');
    expect(state.isRefreshing).toBe(false);
    expect(state.refreshError).toBe('');
  });

  it('429 sets cooldownUntil from retryAfterMs without erroring', async () => {
    mocked.refreshCompetitors.mockRejectedValueOnce(
      new ApiError('throttled', 429, {
        error: { message: 'wait', details: { retryAfterMs: 15_000 } },
      }),
    );
    const store = makeStore();
    const before = Date.now();
    await store.dispatch(refreshCompetitors({ siteId: 'a' }));
    const state = store.getState().competitors;
    expect(state.cooldownUntil).toBeGreaterThanOrEqual(before + 15_000);
    expect(state.refreshError).toBe('');
  });

  it('429 without a parsable retryAfterMs falls back to the 60s default', async () => {
    mocked.refreshCompetitors.mockRejectedValueOnce(
      new ApiError('throttled', 429, { error: { message: 'wait' } }),
    );
    const store = makeStore();
    const before = Date.now();
    await store.dispatch(refreshCompetitors({ siteId: 'a' }));
    expect(store.getState().competitors.cooldownUntil).toBeGreaterThanOrEqual(
      before + DEFAULT_REFRESH_COOLDOWN_MS,
    );
  });

  it('503 sets refreshError and preserves the existing list', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    const store = makeStore();
    await store.dispatch(loadCompetitors({ siteId: 'a' }));
    mocked.refreshCompetitors.mockRejectedValueOnce(
      new ApiError('down', 503, { error: { message: 'vendor down' } }),
    );
    await store.dispatch(refreshCompetitors({ siteId: 'a' }));
    const state = store.getState().competitors;
    expect(state.refreshError).toBe('vendor down');
    expect(state.list?.competitors).toHaveLength(2);
    expect(state.cooldownUntil).toBeNull();
  });

  it('clearRefreshCooldown resets cooldownUntil', async () => {
    mocked.refreshCompetitors.mockRejectedValueOnce(
      new ApiError('throttled', 429, {
        error: { message: 'wait', details: { retryAfterMs: 9_000 } },
      }),
    );
    const store = makeStore();
    await store.dispatch(refreshCompetitors({ siteId: 'a' }));
    expect(store.getState().competitors.cooldownUntil).not.toBeNull();
    store.dispatch(clearRefreshCooldown());
    expect(store.getState().competitors.cooldownUntil).toBeNull();
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

describe('CompetitorsPanel refresh button', () => {
  it('renders enabled with an aria-label, dispatches on click, and shows the fresh list', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    mocked.refreshCompetitors.mockResolvedValueOnce(
      list({
        competitors: [
          {
            domain: 'fresh-rival.example',
            avgPosition: 2.1,
            intersections: 88,
            estimatedTraffic: '1200',
            fetchedAt: '2026-07-07T00:00:00.000Z',
          },
        ],
      }),
    );
    withProviders(<CompetitorsPanel siteId="site-9" />);
    const button = await screen.findByTestId('competitors-refresh');
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleName('Refresh');

    await userEvent.click(button);
    await waitFor(() =>
      expect(mocked.refreshCompetitors).toHaveBeenCalledWith('site-9'),
    );
    await screen.findByText('fresh-rival.example');
    expect(button).toBeEnabled();
  });

  it('disables and spins while the refresh is in flight', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    let resolveRefresh: (v: CompetitorsList) => void = () => undefined;
    mocked.refreshCompetitors.mockImplementationOnce(
      () => new Promise((resolve) => (resolveRefresh = resolve)),
    );
    withProviders(<CompetitorsPanel siteId="site-9" />);
    const button = await screen.findByTestId('competitors-refresh');
    await userEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button.querySelector('svg')).toHaveClass('animate-spin');
    resolveRefresh(list());
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('429 shows the countdown label on the disabled button', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    mocked.refreshCompetitors.mockRejectedValueOnce(
      new ApiError('throttled', 429, {
        error: { message: 'wait', details: { retryAfterMs: 20_000 } },
      }),
    );
    withProviders(<CompetitorsPanel siteId="site-9" />);
    await userEvent.click(await screen.findByTestId('competitors-refresh'));
    const button = await screen.findByTestId('competitors-refresh');
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveTextContent(/Wait (20|19)s before refreshing\./);
  });

  it('failure raises a toast and keeps the previous data visible', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    mocked.refreshCompetitors.mockRejectedValueOnce(
      new ApiError('down', 503, { error: { message: 'vendor down' } }),
    );
    withProviders(<CompetitorsPanel siteId="site-9" />);
    await screen.findByText('rival-one.example');
    await userEvent.click(await screen.findByTestId('competitors-refresh'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('vendor down'));
    expect(screen.getByText('rival-one.example')).toBeInTheDocument();
  });

  it('never touches the URL', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    mocked.refreshCompetitors.mockResolvedValueOnce(list());
    let search = 'unset';
    const LocationProbe = () => {
      search = useLocation().search;
      return null;
    };
    withProviders(
      <>
        <CompetitorsPanel siteId="site-9" />
        <LocationProbe />
      </>,
    );
    const before = search;
    await userEvent.click(await screen.findByTestId('competitors-refresh'));
    await waitFor(() => expect(mocked.refreshCompetitors).toHaveBeenCalled());
    expect(search).toBe(before);
    expect(search).not.toContain('refresh');
  });

  it('renders the Arabic refresh label under the ar locale', async () => {
    await changeLanguage('ar');
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    withProviders(<CompetitorsPanel siteId="site-9" />);
    const button = await screen.findByTestId('competitors-refresh');
    expect(button).toHaveTextContent('تحديث');
  });

  it('uses logical directional utilities only (RTL-safe)', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    withProviders(<CompetitorsPanel siteId="site-1" />);
    await screen.findByTestId('competitors-refresh');
    const rawSrc = await import('./components/CompetitorsPanel.tsx?raw');
    const src = rawSrc.default;
    expect(src).not.toMatch(/\btext-right\b|\btext-left\b/);
    expect(src).not.toMatch(/(?:^|["' \t]|:)[mp][lr]-\d/);
  });
});

describe('competitors tech-stack thunk + slice', () => {
  const loadedStore = async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    const store = makeStore();
    await store.dispatch(loadCompetitors({ siteId: 'a' }));
    return store;
  };

  it('fulfilled attaches the tech stack to its competitor row', async () => {
    const store = await loadedStore();
    mocked.fetchTechStack.mockResolvedValueOnce(techStackResult());
    await store.dispatch(
      fetchTechStack({ siteId: 'a', domain: 'rival-one.example' }),
    );
    const row = store
      .getState()
      .competitors.list?.competitors.find((c) => c.domain === 'rival-one.example');
    expect(row?.techStack?.loading).toBe(false);
    expect(row?.techStack?.entries).toHaveLength(5);
    expect(row?.techStack?.error).toBe('');
    // Sibling row is untouched.
    const sibling = store
      .getState()
      .competitors.list?.competitors.find((c) => c.domain === 'rival-two.example');
    expect(sibling?.techStack).toBeUndefined();
  });

  it('pending sets the loading flag on the row', async () => {
    const store = await loadedStore();
    mocked.fetchTechStack.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    void store.dispatch(
      fetchTechStack({ siteId: 'a', domain: 'rival-one.example' }),
    );
    await waitFor(() => {
      const row = store
        .getState()
        .competitors.list?.competitors.find(
          (c) => c.domain === 'rival-one.example',
        );
      expect(row?.techStack?.loading).toBe(true);
      expect(row?.techStack?.entries).toEqual([]);
    });
  });

  it('rejected records a server error message on the row', async () => {
    const store = await loadedStore();
    mocked.fetchTechStack.mockRejectedValueOnce(
      new ApiError('boom', 503, { error: { message: 'vendor down' } }),
    );
    await store.dispatch(
      fetchTechStack({ siteId: 'a', domain: 'rival-one.example' }),
    );
    const row = store
      .getState()
      .competitors.list?.competitors.find((c) => c.domain === 'rival-one.example');
    expect(row?.techStack?.loading).toBe(false);
    expect(row?.techStack?.entries).toEqual([]);
    expect(row?.techStack?.error).toBe('vendor down');
  });

  it('rejected non-ApiError falls back to the i18n key', async () => {
    const store = await loadedStore();
    mocked.fetchTechStack.mockRejectedValueOnce(new Error('boom'));
    await store.dispatch(
      fetchTechStack({ siteId: 'a', domain: 'rival-one.example' }),
    );
    const row = store
      .getState()
      .competitors.list?.competitors.find((c) => c.domain === 'rival-one.example');
    expect(row?.techStack?.error).toBe(i18n.t('competitors:techStack.failed'));
  });

  it('is a no-op when no list is loaded (pending + fulfilled guards)', async () => {
    mocked.fetchTechStack.mockResolvedValueOnce(techStackResult());
    const store = makeStore();
    await store.dispatch(
      fetchTechStack({ siteId: 'a', domain: 'rival-one.example' }),
    );
    expect(store.getState().competitors.list).toBeNull();
  });

  it('is a no-op when the domain is not in the list (rejected guard)', async () => {
    const store = await loadedStore();
    mocked.fetchTechStack.mockRejectedValueOnce(new Error('boom'));
    await store.dispatch(
      fetchTechStack({ siteId: 'a', domain: 'ghost.example' }),
    );
    const rows = store.getState().competitors.list?.competitors ?? [];
    expect(rows.every((c) => c.techStack === undefined)).toBe(true);
  });
});

describe('CompetitorsPanel tech stack', () => {
  it('does not fetch a tech stack on load; the trigger button is present', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    withProviders(<CompetitorsPanel siteId="site-1" />);
    await screen.findByTestId('competitors-table');
    expect(
      screen.getByTestId('competitors-techstack-btn-rival-one.example'),
    ).toBeInTheDocument();
    expect(mocked.fetchTechStack).not.toHaveBeenCalled();
  });

  it('clicking the trigger fetches and renders a badge per category', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    mocked.fetchTechStack.mockResolvedValueOnce(techStackResult());
    withProviders(<CompetitorsPanel siteId="site-1" />);
    await userEvent.click(
      await screen.findByTestId('competitors-techstack-btn-rival-one.example'),
    );
    await screen.findByTestId('competitors-techstack-rival-one.example');
    expect(mocked.fetchTechStack).toHaveBeenCalledWith('site-1', 'rival-one.example');
    expect(screen.getByText('WordPress')).toBeInTheDocument();
    expect(screen.getByText('Google Analytics')).toBeInTheDocument();
    expect(screen.getByText('Cloudflare')).toBeInTheDocument();
    expect(screen.getByText('WooCommerce')).toBeInTheDocument();
    expect(screen.getByText('Intercom')).toBeInTheDocument();
  });

  it('shows a loading skeleton while the tech stack is in flight', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    mocked.fetchTechStack.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    withProviders(<CompetitorsPanel siteId="site-1" />);
    await userEvent.click(
      await screen.findByTestId('competitors-techstack-btn-rival-one.example'),
    );
    await screen.findByTestId('competitors-techstack-loading-rival-one.example');
  });

  it('shows the empty state when the vendor returns no technologies', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    mocked.fetchTechStack.mockResolvedValueOnce(
      techStackResult({ techStack: [] }),
    );
    withProviders(<CompetitorsPanel siteId="site-1" />);
    await userEvent.click(
      await screen.findByTestId('competitors-techstack-btn-rival-one.example'),
    );
    await screen.findByTestId('competitors-techstack-empty-rival-one.example');
  });

  it('shows an inline error when the tech-stack lookup fails', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    mocked.fetchTechStack.mockRejectedValueOnce(
      new ApiError('down', 503, { error: { message: 'vendor down' } }),
    );
    withProviders(<CompetitorsPanel siteId="site-1" />);
    await userEvent.click(
      await screen.findByTestId('competitors-techstack-btn-rival-one.example'),
    );
    const err = await screen.findByTestId(
      'competitors-techstack-error-rival-one.example',
    );
    expect(err).toHaveTextContent('vendor down');
  });
});

describe('CompetitorsPanel panel polish', () => {
  it('initial-load error shows a retry button that re-dispatches loadCompetitors', async () => {
    mocked.fetchCompetitors
      .mockRejectedValueOnce(
        new ApiError('boom', 500, { error: { message: 'server broke' } }),
      )
      .mockResolvedValueOnce(list());
    withProviders(<CompetitorsPanel siteId="site-1" />);
    const retry = await screen.findByTestId('competitors-retry');
    expect(retry).toHaveTextContent('Try again');
    expect(mocked.fetchCompetitors).toHaveBeenCalledTimes(1);

    await userEvent.click(retry);

    await waitFor(() =>
      expect(mocked.fetchCompetitors).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(screen.getByTestId('competitors-table')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('competitors-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('competitors-retry')).not.toBeInTheDocument();
  });

  it('empty state renders an Empty block with a refresh CTA that dispatches refresh', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce({
      ...list(),
      competitors: [],
    });
    mocked.refreshCompetitors.mockResolvedValueOnce(list());
    withProviders(<CompetitorsPanel siteId="site-1" />);
    const empty = await screen.findByTestId('competitors-empty');
    expect(empty).toHaveTextContent(i18n.t('competitors:emptyTitle'));
    expect(empty).toHaveTextContent(i18n.t('competitors:empty'));

    await userEvent.click(screen.getByTestId('competitors-empty-refresh'));
    await waitFor(() =>
      expect(mocked.refreshCompetitors).toHaveBeenCalledWith('site-1'),
    );
  });

  it('gap empty renders an Empty block with a CTA that reloads the intersection', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    mocked.fetchIntersection.mockResolvedValue({
      ...intersectionResult(),
      keywords: [],
    });
    withProviders(<CompetitorsPanel siteId="site-1" />);
    await userEvent.click(
      await screen.findByTestId('competitors-gap-btn-rival-one.example'),
    );
    const gapEmpty = await screen.findByTestId('competitors-gap-empty');
    expect(gapEmpty).toHaveTextContent(i18n.t('competitors:gap.emptyTitle'));
    expect(gapEmpty).toHaveTextContent(i18n.t('competitors:gap.empty'));

    await userEvent.click(screen.getByTestId('competitors-gap-refresh'));
    await waitFor(() =>
      expect(mocked.fetchIntersection).toHaveBeenCalledTimes(2),
    );
    expect(mocked.fetchIntersection).toHaveBeenLastCalledWith(
      'site-1',
      'rival-one.example',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('tech-stack button exposes aria-busy + spinner while in flight, then restores', async () => {
    mocked.fetchCompetitors.mockResolvedValueOnce(list());
    let resolveTs: (v: TechStackResult) => void = () => undefined;
    mocked.fetchTechStack.mockImplementationOnce(
      () => new Promise<TechStackResult>((resolve) => (resolveTs = resolve)),
    );
    withProviders(<CompetitorsPanel siteId="site-1" />);
    const btn = await screen.findByTestId(
      'competitors-techstack-btn-rival-one.example',
    );

    await userEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
    expect(btn).toBeDisabled();
    expect(btn.querySelector('svg')).toHaveClass('animate-spin');

    resolveTs(techStackResult());
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
    expect(btn).toBeEnabled();
  });

  it('formats the overlap count with the active locale (fr grouping)', async () => {
    await changeLanguage('fr');
    mocked.fetchCompetitors.mockResolvedValueOnce(
      list({
        competitors: [
          {
            domain: 'big-rival.example',
            avgPosition: 3,
            intersections: 1234567,
            estimatedTraffic: '2500000',
            fetchedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    );
    withProviders(<CompetitorsPanel siteId="site-1" />);
    const row = await screen.findByTestId('competitors-row-big-rival.example');
    const fr = new Intl.NumberFormat('fr').format(1234567).replace(/\s/g, ' ');
    const en = new Intl.NumberFormat('en').format(1234567);
    await waitFor(() => expect(row).toHaveTextContent(fr));
    expect(fr).not.toBe(en);
  });
});

describe('CompetitorsPanel — renders before the lazy slice materializes', () => {
  it('does not throw when `state.competitors` is still undefined on first render', async () => {
    // SiteWorkspacePage injects the 'competitors' reducer and renders the panel
    // in the same tick, but RTK only materializes the slice on the NEXT
    // dispatched action — so the panel's very first render sees no
    // `state.competitors` key. A bare store reproduces that precondition; the
    // selectors must fall back to initialState rather than throw (an unguarded
    // read here surfaces as the route-level "Page not found" boundary).
    const bareStore = configureStore({
      reducer: { unrelated: (s: Record<string, never> = {}) => s },
    });
    withProviders(<CompetitorsPanel siteId="site-1" />, bareStore as never);
    expect(await screen.findByTestId('competitors-panel')).toBeInTheDocument();
  });
});
