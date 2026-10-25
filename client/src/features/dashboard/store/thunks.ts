import { createAsyncThunk } from '@reduxjs/toolkit';
import { apiErrorMessage } from '@shared/api/errorMessage';
import { CACHE_TTL_MS, shouldLoad, type CacheLoadOptions } from '@shared/cache/freshness';
import { fetchSiteHealthRequest } from '../api';
import { dashboardInitialState } from './initialState';
import type { DashboardState, SiteHealthResponse } from '../types';

export const loadSiteHealth = createAsyncThunk<SiteHealthResponse, CacheLoadOptions | void,
  { rejectValue: string; state: { dashboard: DashboardState } }>(
  'dashboard/loadSiteHealth',
  async (_options, { rejectWithValue }) => {
    try { return await fetchSiteHealthRequest(); }
    catch (err) { return rejectWithValue(apiErrorMessage(err, 'common:dashboard.health.loadFailed')); }
  },
  { condition: (options, { getState }) => {
    const { loading, loadedAt } = getState().dashboard ?? dashboardInitialState;
    return shouldLoad({ loading, loadedAt }, options, CACHE_TTL_MS.siteHealth);
  } },
);
