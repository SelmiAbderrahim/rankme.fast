import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { RootState } from '@app/store';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type { AuthSessionState } from '@features/auth';
import { SITE_TABS } from '@features/sites';
import {
  fetchTrafficSnapshot,
  fetchTrafficSnapshots,
  previewTrafficSnapshot,
  requestTrafficSnapshot,
} from './api';
import { estimateObservation, maliciousTrafficDetail } from './__fixtures__/xss';
import {
  TRAFFIC_DETAIL_POLL_MS,
  TrafficInsightsPanel,
} from './components/TrafficInsightsPanel';
import { TrafficInsightsRedirect, trafficRoutes } from './routes';
import {
  clearPreview,
  clearTrafficDetail,
  initialTrafficSnapshotsState,
  trafficSnapshotsReducer,
} from './store/slice';
import * as selectors from './store/selectors';
import { fetchList, fetchOne, previewSnapshot, requestSnapshot } from './store/thunks';
import type {
  TrafficSnapshotListResponse,
  TrafficSnapshotRequestResult,
  TrafficSnapshotsState,
  TrafficSpendPreview,
} from './types';

let authState: AuthSessionState = {
  authenticated: true,
  isPending: false,
  emailVerified: true,
  user: null,
};

vi.mock('@features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/auth')>()),
  useAuthSession: () => authState,
}));

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

const listResponse = (withRow = false): TrafficSnapshotListResponse => ({
  snapshots: withRow
    ? [
        {
          id: maliciousTrafficDetail.id,
          siteId: 'site-1',
          targetDomain: 'example.com',
          capturedAt: maliciousTrafficDetail.snapshot!.capturedAt,
          payload: maliciousTrafficDetail.snapshot!.payload,
        },
      ]
    : [],
  nextCursor: null,
});

const spendPreview: TrafficSpendPreview = {
  breakdown: [
    {
      operationKey: 'traffic:example.com',
      metric: 'traffic_snapshots',
      productUnits: 1,
      cachedStatus: 'fresh_required',
    },
  ],
};

const requestResult: TrafficSnapshotRequestResult = {
  runId: maliciousTrafficDetail.id,
  status: 'queued',
  targetDomain: 'example.com',
  reservedUnits: 1,
  cached: false,
};

const makeStore = (state?: Partial<TrafficSnapshotsState>) =>
  configureStore({
    reducer: { trafficSnapshots: trafficSnapshotsReducer },
    preloadedState: state
      ? { trafficSnapshots: { ...initialTrafficSnapshotsState, ...state } }
      : undefined,
  });

const renderPanel = (
  entry = '/sites/site-1?tab=traffic',
  state?: Partial<TrafficSnapshotsState>,
  siteDomain?: string,
) => {
  const store = makeStore({ siteId: 'site-1', ...state });
  return {
    store,
    ...render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[entry]}>
            <TrafficInsightsPanel siteId="site-1" siteDomain={siteDomain} />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    ),
  };
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mockedApiClient.mockReset();
  authState = {
    authenticated: true,
    isPending: false,
    emailVerified: true,
    user: null,
  };
});

describe('traffic API wrappers', () => {
  it('uses thin typed apiClient calls for request, preview, detail, and list variants', async () => {
    mockedApiClient
      .mockResolvedValueOnce(requestResult)
      .mockResolvedValueOnce(spendPreview)
      .mockResolvedValueOnce(maliciousTrafficDetail)
      .mockResolvedValueOnce(listResponse())
      .mockResolvedValueOnce(listResponse());
    await requestTrafficSnapshot({ targetDomain: 'example.com' });
    await previewTrafficSnapshot(['example.com']);
    await fetchTrafficSnapshot('id/unsafe', 'site/a');
    await fetchTrafficSnapshots({});
    const controller = new AbortController();
    await fetchTrafficSnapshots(
      {
        siteId: 'site/a',
        domain: 'a+b.example',
        from: '2026-01-01',
        to: '2026-02-01',
        cursor: 'c+=',
      },
      { signal: controller.signal },
    );

    expect(mockedApiClient).toHaveBeenNthCalledWith(1, '/competitors/traffic-snapshots', {
      method: 'POST',
      body: { targetDomain: 'example.com' },
    });
    expect(mockedApiClient).toHaveBeenNthCalledWith(2, '/competitors/traffic-snapshots/preview', {
      method: 'POST',
      body: { domains: ['example.com'] },
    });
    expect(mockedApiClient).toHaveBeenNthCalledWith(
      3,
      '/competitors/traffic-snapshots/id%2Funsafe?siteId=site%2Fa',
    );
    expect(mockedApiClient).toHaveBeenNthCalledWith(4, '/competitors/traffic-snapshots');
    expect(String(mockedApiClient.mock.calls[4]?.[0])).toContain('domain=a%2Bb.example');
    expect(String(mockedApiClient.mock.calls[4]?.[0])).toContain('siteId=site%2Fa');
    expect(mockedApiClient.mock.calls[4]?.[1]).toEqual({ signal: controller.signal });
  });
});

describe('traffic slice, thunks, and selectors', () => {
  it('handles all fulfilled thunks and exposes every selector', async () => {
    mockedApiClient
      .mockResolvedValueOnce(spendPreview)
      .mockResolvedValueOnce(requestResult)
      .mockResolvedValueOnce(listResponse(true))
      .mockResolvedValueOnce(maliciousTrafficDetail);
    const store = makeStore();
    await store.dispatch(previewSnapshot({ domains: ['example.com'] }));
    expect(
      selectors.selectTrafficSnapshotPreview(store.getState() as RootState),
    ).toEqual(spendPreview);
    expect(selectors.selectTrafficPreviewStatus(store.getState() as RootState)).toBe('succeeded');
    await store.dispatch(requestSnapshot({ targetDomain: 'example.com' }));
    await store.dispatch(fetchList({}));
    await store.dispatch(fetchOne({ id: maliciousTrafficDetail.id }));
    const state = store.getState() as RootState;

    // A committed request clears the spend preview (no double-confirm).
    expect(selectors.selectTrafficSnapshotPreview(state)).toBeNull();
    expect(selectors.selectTrafficPreviewStatus(state)).toBe('idle');
    expect(selectors.selectTrafficLastRequest(state)).toEqual(requestResult);
    expect(selectors.selectTrafficSnapshotList(state)?.snapshots).toHaveLength(1);
    expect(selectors.selectTrafficSnapshotDetail(state)).toEqual(maliciousTrafficDetail);
    expect(selectors.selectTrafficSiteId(state)).toBeNull();
    expect(selectors.selectTrafficListStatus(state)).toBe('succeeded');
    expect(selectors.selectTrafficDetailStatus(state)).toBe('succeeded');
    expect(selectors.selectTrafficRequestStatus(state)).toBe('succeeded');
    expect(selectors.selectTrafficListError(state)).toBe('');
    expect(selectors.selectTrafficDetailError(state)).toBe('');
    expect(selectors.selectTrafficPreviewError(state)).toBe('');
    expect(selectors.selectTrafficRequestError(state)).toBe('');
    expect(selectors.selectTrafficPreviewErrorKind(state)).toBeNull();
    expect(selectors.selectTrafficRequestErrorKind(state)).toBeNull();
    expect(selectors.selectTrafficLocked(state)).toBe(false);

    store.dispatch(clearPreview());
    store.dispatch(clearTrafficDetail());
    expect(store.getState().trafficSnapshots.previewStatus).toBe('idle');
    expect(store.getState().trafficSnapshots.detail).toBeNull();
  });

  it('classifies locked and unknown request failures and covers read failures', async () => {
    const store = makeStore();
    mockedApiClient.mockRejectedValueOnce(
      new ApiError('payment required', 402, { error: { message: 'payment message' } }),
    );
    await store.dispatch(previewSnapshot({ domains: ['example.com'] }));
    expect(store.getState().trafficSnapshots.previewErrorKind).toBe('unknown');

    mockedApiClient.mockRejectedValueOnce(
      new ApiError('locked', 503, { error: { message: 'locked message' } }),
    );
    await store.dispatch(requestSnapshot({ targetDomain: 'example.com' }));
    expect(store.getState().trafficSnapshots.requestErrorKind).toBe('locked');
    expect(selectors.selectTrafficLocked(store.getState() as RootState)).toBe(true);

    mockedApiClient.mockRejectedValueOnce(new Error('unknown'));
    await store.dispatch(requestSnapshot({ targetDomain: 'example.com' }));
    expect(store.getState().trafficSnapshots.requestErrorKind).toBe('unknown');

    mockedApiClient.mockRejectedValueOnce(new Error('list'));
    await store.dispatch(fetchList({}));
    expect(store.getState().trafficSnapshots.listError).toBe(
      'Could not load stored traffic snapshots.',
    );

    mockedApiClient.mockRejectedValueOnce(new Error('detail'));
    await store.dispatch(fetchOne({ id: 'missing' }));
    expect(store.getState().trafficSnapshots.detailError).toBe(
      'Could not load this traffic snapshot.',
    );
  });

  it('keeps state on aborted lists, covers payload-less rejected fallbacks, and selector fallback', () => {
    let state = trafficSnapshotsReducer(undefined, { type: '@@init' });
    state = trafficSnapshotsReducer(state, {
      type: fetchList.rejected.type,
      meta: { aborted: true, arg: {} },
    });
    expect(state.listStatus).toBe('idle');
    for (const action of [
      { type: fetchList.rejected.type, meta: { aborted: false, arg: {} } },
      { type: fetchOne.rejected.type, meta: { arg: { id: 'missing' } } },
      { type: previewSnapshot.rejected.type, meta: { arg: { domains: [] } } },
      { type: requestSnapshot.rejected.type, meta: { arg: { targetDomain: 'example.com' } } },
    ]) {
      state = trafficSnapshotsReducer(state, action);
    }
    expect(state.listError).toBe('');
    expect(state.detailError).toBe('');
    expect(state.previewErrorKind).toBe('unknown');
    expect(state.requestErrorKind).toBe('unknown');

    const fallback = {} as RootState;
    expect(selectors.selectTrafficSnapshotList(fallback)).toBeNull();
    expect(selectors.selectTrafficLocked(fallback)).toBe(false);
  });

  it('re-keys by Site and ignores late responses from the previous Site', () => {
    const current = {
      ...initialTrafficSnapshotsState,
      siteId: 'site-b',
      listStatus: 'succeeded' as const,
      list: listResponse(),
    };
    const staleActions = [
      {
        type: fetchList.fulfilled.type,
        payload: listResponse(true),
        meta: { arg: { siteId: 'site-a' } },
      },
      {
        type: fetchOne.fulfilled.type,
        payload: maliciousTrafficDetail,
        meta: { arg: { id: maliciousTrafficDetail.id, siteId: 'site-a' } },
      },
      {
        type: previewSnapshot.fulfilled.type,
        payload: spendPreview,
        meta: { arg: { domains: ['example.com'], siteId: 'site-a' } },
      },
      {
        type: requestSnapshot.fulfilled.type,
        payload: requestResult,
        meta: { arg: { targetDomain: 'example.com', siteId: 'site-a' } },
      },
      {
        type: fetchList.rejected.type,
        meta: { aborted: false, arg: { siteId: 'site-a' } },
      },
      {
        type: fetchOne.rejected.type,
        meta: { arg: { id: 'missing', siteId: 'site-a' } },
      },
      {
        type: previewSnapshot.rejected.type,
        meta: { arg: { domains: [], siteId: 'site-a' } },
      },
      {
        type: requestSnapshot.rejected.type,
        meta: { arg: { targetDomain: 'example.com', siteId: 'site-a' } },
      },
    ];
    for (const action of staleActions) {
      expect(trafficSnapshotsReducer(current, action)).toEqual(current);
    }

    const rekeyed = trafficSnapshotsReducer(current, {
      type: fetchList.pending.type,
      meta: { arg: { siteId: 'site-c' } },
    });
    expect(rekeyed).toMatchObject({ siteId: 'site-c', list: null, detail: null });
  });
});

describe('TrafficInsightsPanel routing and auth state', () => {
  it('loads URL filters for an authenticated session and opens stored detail', async () => {
    mockedApiClient.mockImplementation(async (path) =>
      String(path).includes(`/${maliciousTrafficDetail.id}`)
        ? maliciousTrafficDetail
        : listResponse(true),
    );
    renderPanel('/sites/site-1?tab=traffic&domain=example.com&from=2026-01-01');
    expect(await screen.findByTestId('traffic-insights-panel')).toBeVisible();
    await waitFor(() =>
      expect(mockedApiClient).toHaveBeenCalledWith(
        expect.stringContaining('domain=example.com'),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    expect(String(mockedApiClient.mock.calls[0]?.[0])).toContain('siteId=site-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Open snapshot' }));
    expect(await screen.findByTestId('traffic-stat-monthlyVisits')).toBeVisible();
  });

  it('collapses a two-snapshot comparison into the remaining stored detail', async () => {
    const secondId = '222222222222222222222222';
    const firstSummary = listResponse(true).snapshots[0]!;
    const secondSummary = {
      ...firstSummary,
      id: secondId,
      targetDomain: 'second.example',
    };
    mockedApiClient.mockImplementation(async (path) => {
      const value = String(path);
      if (value.includes('/compare?')) {
        return {
          snapshots: [{ ...firstSummary, targetDomain: 'first.example' }, secondSummary],
          axes: { countryCodes: ['US'] },
        };
      }
      if (value.includes(`/${secondId}?siteId=site-1`)) {
        return {
          ...maliciousTrafficDetail,
          id: secondId,
          targetDomain: 'second.example',
        };
      }
      return listResponse();
    });
    renderPanel(`/sites/site-1?tab=traffic&ids=${firstSummary.id},${secondId}`);

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Remove first.example from comparison',
      }),
    );
    await waitFor(() =>
      expect(mockedApiClient).toHaveBeenCalledWith(
        `/competitors/traffic-snapshots/${secondId}?siteId=site-1`,
      ),
    );
    expect(await screen.findByText('second.example')).toBeVisible();
  });

  it('refreshes list and detail after a queued request enters state', async () => {
    mockedApiClient.mockImplementation(async (path) =>
      String(path).includes(`/${maliciousTrafficDetail.id}?siteId=site-1`)
        ? { ...maliciousTrafficDetail, snapshot: null, status: 'queued' }
        : listResponse(),
    );
    renderPanel('/sites/site-1?tab=traffic', { lastRequest: requestResult });
    expect(await screen.findByText('Snapshot queued')).toBeVisible();
    expect(
      mockedApiClient.mock.calls.filter(([path]) =>
        String(path).includes(`/${maliciousTrafficDetail.id}?siteId=site-1`),
      ),
    ).toHaveLength(1);
  });

  it('polls an in-flight run, then refreshes the stored list once it settles', async () => {
    vi.useFakeTimers();
    try {
      const isDetailCall = (path: unknown) =>
        String(path).includes(`/${maliciousTrafficDetail.id}?siteId=site-1`);
      const detailCalls = () => mockedApiClient.mock.calls.filter(([path]) => isDetailCall(path));
      const listCalls = () =>
        mockedApiClient.mock.calls.filter(
          ([path]) => {
            const value = String(path);
            return value === '/competitors/traffic-snapshots'
              || value.startsWith('/competitors/traffic-snapshots?');
          },
        );
      mockedApiClient.mockImplementation(async (path) => {
        if (!isDetailCall(path)) return listResponse();
        return detailCalls().length === 1
          ? { ...maliciousTrafficDetail, snapshot: null, status: 'running' }
          : maliciousTrafficDetail;
      });
      renderPanel('/sites/site-1?tab=traffic', { lastRequest: requestResult });
      await act(async () => {});
      expect(detailCalls()).toHaveLength(1);
      const listCallsWhileRunning = listCalls().length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TRAFFIC_DETAIL_POLL_MS);
      });
      expect(detailCalls()).toHaveLength(2);
      expect(screen.getByTestId('traffic-stat-monthlyVisits')).toBeVisible();
      // Settling triggers exactly one list refresh, then polling stops.
      expect(listCalls()).toHaveLength(listCallsWhileRunning + 1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TRAFFIC_DETAIL_POLL_MS * 3);
      });
      expect(detailCalls()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefills the request form with the workspace site domain without locking typing', async () => {
    mockedApiClient.mockResolvedValue(listResponse());
    renderPanel('/sites/site-1?tab=traffic', undefined, 'pulsy.org');
    expect(await screen.findByRole('textbox', { name: 'Domain' })).toHaveValue('pulsy.org');
    expect(screen.getByRole('button', { name: 'Preview snapshot' })).toBeEnabled();
  });

  it('masks another site stored traffic state while the slice re-keys', () => {
    mockedApiClient.mockReturnValue(new Promise(() => undefined));
    const { store } = renderPanel('/sites/site-1?tab=traffic', { siteId: 'site-other' });
    // The first render masked the foreign slice; the list read then re-keyed it.
    expect(store.getState().trafficSnapshots.siteId).toBe('site-1');
    expect(store.getState().trafficSnapshots.listStatus).toBe('loading');
  });

  it('renders pending and signed-out states without issuing product requests', () => {
    authState = { ...authState, authenticated: false, isPending: true };
    const pending = renderPanel();
    expect(pending.container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
    expect(mockedApiClient).not.toHaveBeenCalled();
    pending.unmount();

    authState = { ...authState, authenticated: false, isPending: false };
    renderPanel();
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in to view Traffic Insights.');
    expect(mockedApiClient).not.toHaveBeenCalled();
  });

  it('keeps stored reads in flow beside the kill-switch state', async () => {
    mockedApiClient.mockResolvedValue(listResponse());
    renderPanel('/sites/site-1?tab=traffic', {
      previewErrorKind: 'locked',
      previewError: 'Operator maintenance window.',
    });
    expect(await screen.findByTestId('traffic-kill-switch')).toHaveTextContent(
      'Operator maintenance window.',
    );
    expect(screen.getByRole('textbox', { name: 'Domain' })).toBeDisabled();
    expect(await screen.findByTestId('traffic-list-empty')).toBeVisible();
  });

  it('redirects the legacy route to the URL-backed traffic tab and preserves its route inventory', async () => {
    let location = '';
    const Probe = () => {
      const current = useLocation();
      location = `${current.pathname}${current.search}`;
      return null;
    };
    render(
      <MemoryRouter initialEntries={['/sites/site-1/traffic']}>
        <Routes>
          <Route path="sites/:siteId/traffic" element={trafficRoutes[0]?.element} />
          <Route path="sites/:siteId" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(location).toBe('/sites/site-1?tab=traffic'));
    expect(trafficRoutes[0]?.path).toBe('sites/:siteId/traffic');
    expect(SITE_TABS).toContain('traffic');
  });

  it('uses an empty site segment when the redirect is mounted without route params', () => {
    let location = '';
    const Probe = () => {
      location = `${useLocation().pathname}${useLocation().search}`;
      return null;
    };
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<TrafficInsightsRedirect />} />
          <Route path="/sites/" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(location).toBe('/sites/?tab=traffic');
  });
});

describe('estimate fixture sanity', () => {
  it('keeps the fixture source kind pinned to estimate', () => {
    expect(estimateObservation.sourceKind).toBe('estimate');
  });
});
