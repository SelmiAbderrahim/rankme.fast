import { createAsyncThunk } from '@reduxjs/toolkit';
import { fetchLocalBusinessSetup, fetchLocalSeo, refreshLocalSeo as refreshLocalSeoRequest, searchLocalBusinessRequest, selectLocalBusinessRequest, } from '../api';
import {
  apiErrorRetryAfterMs,
  apiErrorStatus,
  localSeoErrorMessage,
} from '../errorMessage';
import type { LocalBusinessSetup, LocalSeoRefreshResult, LocalSeoSnapshot } from '../types';

export interface RejectPayload {
  error: string;
}

export interface RefreshRejectPayload extends RejectPayload {
  /** Epoch ms until which the refresh button stays disabled (429 only). */
  cooldownUntil: number | null;
}

/** Fallback cooldown when a 429 arrives without a parsable retryAfterMs. */
export const DEFAULT_REFRESH_COOLDOWN_MS = 60_000;

export const loadLocalSeo = createAsyncThunk<
  LocalSeoSnapshot,
  { siteId: string },
  { rejectValue: RejectPayload }
>('localSeo/loadLocalSeo', async ({ siteId }, { rejectWithValue, signal }) => {
  try {
    return await fetchLocalSeo(siteId, { signal });
  } catch (err) {
    return rejectWithValue({ error: localSeoErrorMessage(err, 'localSeo:loadFailed') });
  }
});

export const refreshLocalSeo = createAsyncThunk<
  LocalSeoRefreshResult,
  { siteId: string },
  { rejectValue: RefreshRejectPayload }
>('localSeo/refreshLocalSeo', async ({ siteId }, { rejectWithValue }) => {
  try {
    return await refreshLocalSeoRequest(siteId);
  } catch (err) {
    const status = apiErrorStatus(err);
    if (status === 429) {
      return rejectWithValue({
        error: '',
        cooldownUntil:
          Date.now() + (apiErrorRetryAfterMs(err) ?? DEFAULT_REFRESH_COOLDOWN_MS),
      });
    }
    return rejectWithValue({
      error: localSeoErrorMessage(err, 'localSeo:refresh.failed'),
      cooldownUntil: null,
    });
  }
});

/** Business setup. Rejections carry localized text. */
export const loadLocalBusinessSetup = createAsyncThunk<
  LocalBusinessSetup,
  { siteId: string },
  { rejectValue: string }
>('localSeo/loadLocalBusinessSetup', async ({ siteId }, { rejectWithValue }) => {
  try {
    return await fetchLocalBusinessSetup(siteId);
  } catch (err) {
    return rejectWithValue(localSeoErrorMessage(err, 'localSeo:setup.loadFailed'));
  }
});

export const searchLocalBusiness = createAsyncThunk<
  LocalBusinessSetup,
  { siteId: string; query: string },
  { rejectValue: string }
>('localSeo/searchLocalBusiness', async ({ siteId, query }, { rejectWithValue }) => {
  try {
    return await searchLocalBusinessRequest(siteId, query);
  } catch (err) {
    return rejectWithValue(localSeoErrorMessage(err, 'localSeo:setup.searchFailed'));
  }
});

export const selectLocalBusiness = createAsyncThunk<
  LocalBusinessSetup,
  { siteId: string; candidateId: string },
  { rejectValue: string }
>('localSeo/selectLocalBusiness', async ({ siteId, candidateId }, { rejectWithValue }) => {
  try {
    return await selectLocalBusinessRequest(siteId, candidateId);
  } catch (err) {
    return rejectWithValue(localSeoErrorMessage(err, 'localSeo:setup.selectFailed'));
  }
});
