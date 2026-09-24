import { createAsyncThunk } from '@reduxjs/toolkit';
import { apiErrorRetryAfterMs, apiErrorStatus } from '@shared/api/errorMessage';
import {
  checkNowRequest,
  createKeywordRequest,
  fetchKeywordHistoryRequest,
  fetchKeywordsRequest,
  fetchSerpFeatureDetailRequest,
  fetchSerpFeaturesRequest,
  removeKeywordRequest,
  updateCadenceRequest,
} from '../api';
import { ranksErrorMessage } from '../errorMessage';
import type {
  CadenceUpdateResponse,
  CheckNowResponse,
  CreateKeywordBody,
  CreateKeywordResponse,
  KeywordListPage,
  RankEngine,
  RankCadence,
  RankHistoryResponse,
  SerpFeatureDetail,
  SerpFeaturesResponse,
} from '../types';

/** Fallback cooldown when a 429 arrives without a parsable retryAfterMs. */
const DEFAULT_CHECK_COOLDOWN_MS = 60_000;

export interface CheckNowRejected {
  error: string;
  /** Epoch ms until which the button stays disabled (429 only). */
  cooldownUntil: number | null;
}

export type LoadDirection = 'initial' | 'next' | 'prev';

export interface LoadKeywordsArgs {
  siteId: string;
  cursor?: string | null;
  direction?: LoadDirection;
  /** Server-side filter; omission means every engine. */
  engine?: RankEngine;
}

export const loadKeywords = createAsyncThunk<
  KeywordListPage,
  LoadKeywordsArgs,
  { rejectValue: string }
>('ranks/load', async ({ siteId, cursor, engine }, { rejectWithValue, signal }) => {
  try {
    return await fetchKeywordsRequest(siteId, cursor, {
      signal,
      ...(engine ? { engine } : {}),
    });
  } catch (err) {
    return rejectWithValue(ranksErrorMessage(err, 'ranks:loadFailed'));
  }
});

export interface AddKeywordArgs extends CreateKeywordBody {
  siteId: string;
}

export const addKeyword = createAsyncThunk<
  CreateKeywordResponse,
  AddKeywordArgs,
  { rejectValue: string }
>('ranks/add', async ({ siteId, ...body }, { rejectWithValue }) => {
  try {
    return await createKeywordRequest(siteId, body);
  } catch (err) {
    return rejectWithValue(ranksErrorMessage(err, 'ranks:addFailed'));
  }
});

export const removeKeyword = createAsyncThunk<
  { id: string; message: string },
  string,
  { rejectValue: string }
>('ranks/remove', async (id, { rejectWithValue }) => {
  try {
    const { message } = await removeKeywordRequest(id);
    return { id, message };
  } catch (err) {
    return rejectWithValue(ranksErrorMessage(err, 'ranks:removeFailed'));
  }
});

export interface UpdateCadenceArgs {
  siteId: string;
  cadence: RankCadence;
  /** Previous cadence — used to roll back the slice on failure. */
  previous: RankCadence;
}

export const updateCadence = createAsyncThunk<
  CadenceUpdateResponse,
  UpdateCadenceArgs,
  { rejectValue: string }
>('ranks/updateCadence', async ({ siteId, cadence }, { rejectWithValue }) => {
  try {
    return await updateCadenceRequest(siteId, cadence);
  } catch (err) {
    return rejectWithValue(ranksErrorMessage(err, 'ranks:cadenceFailed'));
  }
});

export const checkNow = createAsyncThunk<
  CheckNowResponse,
  { siteId: string; keywordId?: string },
  { rejectValue: CheckNowRejected }
>('ranks/checkNow', async ({ siteId, keywordId }, { rejectWithValue }) => {
  try {
    return keywordId
      ? await checkNowRequest(siteId, keywordId)
      : await checkNowRequest(siteId);
  } catch (err) {
    // A 429 means the per-site cooldown is active — surface a countdown.
    const cooldownUntil =
      apiErrorStatus(err) === 429
        ? Date.now() + (apiErrorRetryAfterMs(err) ?? DEFAULT_CHECK_COOLDOWN_MS)
        : null;
    return rejectWithValue({
      error: ranksErrorMessage(err, 'ranks:checkFailed'),
      cooldownUntil,
    });
  }
});

export interface LoadHistoryArgs {
  keywordId: string;
}

export const loadKeywordHistory = createAsyncThunk<
  RankHistoryResponse,
  LoadHistoryArgs,
  { rejectValue: string }
>('ranks/loadHistory', async ({ keywordId }, { rejectWithValue, signal }) => {
  try {
    return await fetchKeywordHistoryRequest(keywordId, { signal });
  } catch (err) {
    return rejectWithValue(ranksErrorMessage(err, 'ranks:historyFailed'));
  }
});

// ---------------------------------------------------------------------------
// SERP feature tracking
// ---------------------------------------------------------------------------

/**
 * A 503 from either read means `SERP_FEATURE_TRACKING_ENABLED` is off. The
 * panel renders the honest "temporarily unavailable" state rather than an
 * error, so the surface never implies the user's data is gone.
 */
export interface SerpFeaturesRejected {
  error: string;
  disabled: boolean;
}

function toSerpRejection(err: unknown, fallbackKey: string): SerpFeaturesRejected {
  return {
    error: ranksErrorMessage(err, fallbackKey),
    disabled: apiErrorStatus(err) === 503,
  };
}

export const loadSerpFeatures = createAsyncThunk<
  SerpFeaturesResponse,
  { siteId: string },
  { rejectValue: SerpFeaturesRejected }
>('ranks/serpFeatures/load', async ({ siteId }, { rejectWithValue, signal }) => {
  try {
    return await fetchSerpFeaturesRequest(siteId, { signal });
  } catch (err) {
    return rejectWithValue(toSerpRejection(err, 'ranks:serpFeatures.error'));
  }
});

export const loadSerpFeatureDetail = createAsyncThunk<
  SerpFeatureDetail,
  { keywordId: string },
  { rejectValue: SerpFeaturesRejected }
>('ranks/serpFeatures/detail', async ({ keywordId }, { rejectWithValue, signal }) => {
  try {
    return await fetchSerpFeatureDetailRequest(keywordId, { signal });
  } catch (err) {
    return rejectWithValue(toSerpRejection(err, 'ranks:serpFeatures.error'));
  }
});
