import { shareInFlight, withInFlightInvalidation } from '@shared/lib/inFlight';
import { CACHE_TTL_MS, shouldLoad } from '@shared/cache/freshness';
import type { SitesState } from '../types';
import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  createSiteRequest,
  deleteSiteRequest,
  fetchSitesRequest,
  pauseSiteRequest,
  resumeSiteRequest,
  updateSiteRequest,
} from '../api';
import { siteErrorMessage } from '../errorMessage';
import type { LoadSitesArgs, Site, SiteListPage } from '../types';

export const loadSites = createAsyncThunk<SiteListPage, LoadSitesArgs, { rejectValue: string }>(
  'sites/load',
  async ({ cursor }, { rejectWithValue }) => {
    try {
      return await shareInFlight(`sites:${cursor ?? ''}`, () => fetchSitesRequest(cursor));
    } catch (err) {
      return rejectWithValue(siteErrorMessage(err, 'sites:loadFailed'));
    }
  },
  {
    condition: (options, { getState }) => {
      const sites = (getState() as { sites: SitesState }).sites;
      if (sites.loading) return false;
      if (options.cursor || options.direction === 'next' || options.direction === 'prev' || sites.currentCursor !== null) return true;
      return shouldLoad({ loadedAt: sites.loadedAt ?? null, loading: false }, options, CACHE_TTL_MS.sites);
    },
  },
);

export const addSite = createAsyncThunk<
  { site: Site; message: string },
  string,
  { rejectValue: string }
>('sites/add', async (url, { rejectWithValue }) => {
  try {
    return await withInFlightInvalidation('sites:', () => createSiteRequest(url));
  } catch (err) {
    return rejectWithValue(siteErrorMessage(err, 'sites:addFailed'));
  }
});

export const removeSite = createAsyncThunk<
  { id: string; message: string },
  string,
  { rejectValue: string }
>('sites/remove', async (id, { rejectWithValue }) => {
  try {
    const { message } = await withInFlightInvalidation('sites:', () => deleteSiteRequest(id));
    return { id, message };
  } catch (err) {
    return rejectWithValue(siteErrorMessage(err, 'sites:deleteFailed'));
  }
});

export const renameSite = createAsyncThunk<
  { site: Site; message: string },
  { id: string; displayName: string },
  { rejectValue: string }
>('sites/rename', async ({ id, displayName }, { rejectWithValue }) => {
  try {
    return await withInFlightInvalidation('sites:', () => updateSiteRequest(id, displayName));
  } catch (err) {
    return rejectWithValue(siteErrorMessage(err, 'sites:renameFailed'));
  }
});

export const pauseSite = createAsyncThunk<
  { site: Site; message: string },
  string,
  { rejectValue: string }
>('sites/pause', async (id, { rejectWithValue }) => {
  try {
    return await withInFlightInvalidation('sites:', () => pauseSiteRequest(id));
  } catch (err) {
    return rejectWithValue(siteErrorMessage(err, 'sites:pauseFailed'));
  }
});

export const resumeSite = createAsyncThunk<
  { site: Site; message: string },
  string,
  { rejectValue: string }
>('sites/resume', async (id, { rejectWithValue }) => {
  try {
    return await withInFlightInvalidation('sites:', () => resumeSiteRequest(id));
  } catch (err) {
    return rejectWithValue(siteErrorMessage(err, 'sites:resumeFailed'));
  }
});
