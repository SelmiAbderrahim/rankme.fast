import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  fetchBacklinkRun,
  fetchBacklinkRuns,
  fetchLinkGapRun,
  fetchBacklinkSummary,
  fetchBacklinksList,
  previewDeepPull as requestDeepPullPreview,
  previewLinkGap as requestLinkGapPreview,
  refreshBacklinkSummary,
  startDeepPull as requestDeepPullStart,
  startLinkGap as requestLinkGapStart,
} from '../api';
import {
  apiErrorRetryAfterMs,
  apiErrorStatus,
  backlinksErrorMessage,
} from '../errorMessage';
import type {
  BacklinkList,
  BacklinkSummary,
  BacklinkPullType,
  BacklinkRun,
  DeepPullErrorKind,
  LinkGapRun,
  SpendPreview,
} from '../types';
import type {
  PreviewDeepPullInput,
  PreviewLinkGapInput,
  StartDeepPullInput,
} from '../api';

export interface RejectPayload {
  error: string;
}

export interface RefreshRejectPayload extends RejectPayload {
  /** Epoch ms until which the refresh button stays disabled (429 only). */
  cooldownUntil: number | null;
}

export interface DeepPullRejectPayload {
  error: string;
  kind: DeepPullErrorKind;
}

function deepPullReject(error: unknown, fallbackKey: string): DeepPullRejectPayload {
  const status = apiErrorStatus(error);
  return {
    error: backlinksErrorMessage(error, fallbackKey),
    kind: status === 503 ? 'disabled' : 'unknown',
  };
}

/** Fallback cooldown when a 429 arrives without a parsable retryAfterMs. */
export const DEFAULT_REFRESH_COOLDOWN_MS = 60_000;

export const loadSummary = createAsyncThunk<
  BacklinkSummary | null,
  { siteId: string },
  { rejectValue: RejectPayload }
>('backlinks/loadSummary', async ({ siteId }, { rejectWithValue, signal }) => {
  try {
    return await fetchBacklinkSummary(siteId, { signal });
  } catch (err) {
    return rejectWithValue({
      error: backlinksErrorMessage(err, 'backlinks:loadFailed'),
    });
  }
});

export const refreshSummary = createAsyncThunk<
  BacklinkSummary,
  { siteId: string },
  { rejectValue: RefreshRejectPayload }
>('backlinks/refreshSummary', async ({ siteId }, { rejectWithValue }) => {
  try {
    return await refreshBacklinkSummary(siteId);
  } catch (err) {
    const status = apiErrorStatus(err);
    if (status === 429) {
      // Cooldown, not an error state — the button shows a countdown instead.
      return rejectWithValue({
        error: '',
        cooldownUntil:
          Date.now() + (apiErrorRetryAfterMs(err) ?? DEFAULT_REFRESH_COOLDOWN_MS),
      });
    }
    return rejectWithValue({
      error: backlinksErrorMessage(err, 'backlinks:refresh.failed'),
      cooldownUntil: null,
    });
  }
});

export const loadList = createAsyncThunk<
  BacklinkList,
  { siteId: string; cursor?: string; limit?: number },
  { rejectValue: RejectPayload }
>('backlinks/loadList', async (args, { rejectWithValue, signal }) => {
  try {
    return await fetchBacklinksList(args, { signal });
  } catch (err) {
    return rejectWithValue({
      error: backlinksErrorMessage(err, 'backlinks:loadFailed'),
    });
  }
});

export const previewDeepPull = createAsyncThunk<
  SpendPreview,
  PreviewDeepPullInput,
  { rejectValue: DeepPullRejectPayload }
>('backlinks/previewDeepPull', async (input, { rejectWithValue }) => {
  try {
    return await requestDeepPullPreview(input);
  } catch (error) {
    return rejectWithValue(deepPullReject(error, 'backlinks:intelligence.errors.preview'));
  }
});

export const submitDeepPull = createAsyncThunk<
  BacklinkRun,
  StartDeepPullInput,
  { rejectValue: DeepPullRejectPayload }
>('backlinks/submitDeepPull', async (input, { rejectWithValue, signal }) => {
  try {
    const started = await requestDeepPullStart(input);
    return await fetchBacklinkRun(started.runId, { signal });
  } catch (error) {
    return rejectWithValue(deepPullReject(error, 'backlinks:intelligence.errors.submit'));
  }
});

export const loadLatestDeepPull = createAsyncThunk<
  BacklinkRun | null,
  { siteId: string; type: BacklinkPullType },
  { rejectValue: DeepPullRejectPayload }
>('backlinks/loadLatestDeepPull', async ({ siteId, type }, { rejectWithValue, signal }) => {
  try {
    const page = await fetchBacklinkRuns(siteId, type, { signal });
    const latest = page.runs[0];
    return latest ? await fetchBacklinkRun(latest.runId, { signal }) : null;
  } catch (error) {
    return rejectWithValue(deepPullReject(error, 'backlinks:intelligence.errors.load'));
  }
});

export const previewGap = createAsyncThunk<
  SpendPreview,
  PreviewLinkGapInput,
  { rejectValue: DeepPullRejectPayload }
>('backlinks/previewGap', async (input, { rejectWithValue }) => {
  try {
    return await requestLinkGapPreview(input);
  } catch (error) {
    return rejectWithValue(deepPullReject(error, 'backlinks:gap.errors.preview'));
  }
});

export interface SubmitGapInput extends PreviewLinkGapInput {
  siteId: string;
}

export const submitGap = createAsyncThunk<
  LinkGapRun,
  SubmitGapInput,
  { rejectValue: DeepPullRejectPayload }
>('backlinks/submitGap', async ({ siteId, competitors }, { rejectWithValue, signal }) => {
  try {
    const started = await requestLinkGapStart({ siteId, competitors });
    return await fetchLinkGapRun(started.runId, { signal });
  } catch (error) {
    return rejectWithValue(deepPullReject(error, 'backlinks:gap.errors.submit'));
  }
});

export const loadGapRun = createAsyncThunk<
  LinkGapRun,
  { runId: string },
  { rejectValue: DeepPullRejectPayload }
>('backlinks/loadGapRun', async ({ runId }, { rejectWithValue, signal }) => {
  try {
    return await fetchLinkGapRun(runId, { signal });
  } catch (error) {
    return rejectWithValue(deepPullReject(error, 'backlinks:gap.errors.load'));
  }
});
