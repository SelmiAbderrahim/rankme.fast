import { createAsyncThunk } from '@reduxjs/toolkit';
import { fetchLocalSeo, refreshLocalSeo as refreshLocalSeoRequest } from '../api';
import {
  apiErrorRetryAfterMs,
  apiErrorStatus,
  localSeoErrorMessage,
} from '../errorMessage';
import type { LocalSeoRefreshResult, LocalSeoSnapshot } from '../types';

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
