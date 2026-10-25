import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, expect, it, vi } from 'vitest';
import { rankJobSettled } from '@shared/cache/invalidation';
import { fetchSiteHealthRequest } from '../api';
import { dashboardReducer } from './slice';
import { loadSiteHealth } from './thunks';
import { selectSiteHealth, selectSiteHealthError } from './selectors';
import type { RootState } from '@app/store';
import { initI18n } from '@shared/i18n';

vi.mock('../api', () => ({ fetchSiteHealthRequest: vi.fn() }));
const fetch = vi.mocked(fetchSiteHealthRequest);
const empty = { generatedAt: '2026-10-20T00:00:00.000Z', limit: 10, totalSites: 0,
  activeSites: 0, pausedSites: 0, hasMore: false, sites: [], pausedList: [] };

beforeEach(() => { initI18n({ initialLocale: 'en' }); vi.clearAllMocks(); fetch.mockResolvedValue(empty); });

it('reuses a fresh stored health read and refreshes after a rank job settles', async () => {
  const store = configureStore({ reducer: { dashboard: dashboardReducer } });
  await store.dispatch(loadSiteHealth());
  await store.dispatch(loadSiteHealth());
  expect(fetch).toHaveBeenCalledTimes(1);
  store.dispatch(rankJobSettled({ siteId: 'site-1', jobId: 'job-1' }));
  await store.dispatch(loadSiteHealth());
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('retries a failed read and invalidates after site and workspace changes', async () => {
  const store = configureStore({ reducer: { dashboard: dashboardReducer } });
  fetch.mockRejectedValueOnce(new Error('offline'));
  await store.dispatch(loadSiteHealth());
  expect(selectSiteHealthError(store.getState() as RootState)).toBeTruthy();
  await store.dispatch(loadSiteHealth({ force: true }));
  expect(selectSiteHealth(store.getState() as RootState)).toEqual(empty);
  store.dispatch({ type: 'sites/rename/fulfilled' });
  expect(store.getState().dashboard.loadedAt).toBeNull();
  await store.dispatch(loadSiteHealth());
  store.dispatch({ type: 'workspace/setActiveWorkspace', payload: 'workspace-2' });
  expect(store.getState().dashboard.loadedAt).toBeNull();
});

it('uses safe initial selectors in a store without the dashboard slice', () => {
  const partial = {} as RootState;
  expect(selectSiteHealth(partial)).toBeNull();
  expect(selectSiteHealthError(partial)).toBe('');
});
