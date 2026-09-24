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
      return await fetchSitesRequest(cursor);
    } catch (err) {
      return rejectWithValue(siteErrorMessage(err, 'sites:loadFailed'));
    }
  },
);

export const addSite = createAsyncThunk<
  { site: Site; message: string },
  string,
  { rejectValue: string }
>('sites/add', async (url, { rejectWithValue }) => {
  try {
    return await createSiteRequest(url);
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
    const { message } = await deleteSiteRequest(id);
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
    return await updateSiteRequest(id, displayName);
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
    return await pauseSiteRequest(id);
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
    return await resumeSiteRequest(id);
  } catch (err) {
    return rejectWithValue(siteErrorMessage(err, 'sites:resumeFailed'));
  }
});
