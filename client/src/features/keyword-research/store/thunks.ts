import { createAsyncThunk } from '@reduxjs/toolkit';
import type { ApiError } from '@shared/api/client';
import {
  exploreLiveTrendsRequest,
  fetchClusterRunRequest,
  fetchClusterRunsRequest,
  fetchGapRequest,
  fetchHistoryRequest,
  fetchIdeasRequest,
  fetchIntentRequest,
  fetchKeywordPreviewRequest,
  fetchLiveTrendsListRequest,
  fetchLiveTrendsRunRequest,
  fetchLongTailRequest,
  fetchMetricsRequest,
  fetchOverviewRequest,
  fetchRelatedRequest,
  fetchStoredResultRequest,
  fetchTrendsRequest,
  postClusterDecisionRequest,
  previewLiveTrendsRequest,
  runClustersRequest,
  type ClusterDecisionRequestBody,
  type ClusterRunRequestBody,
  type ClusterRunsRequestArgs,
  type GapRequestBody,
  type LiveTrendsExploreRequestBody,
  type LiveTrendsListRequestArgs,
  type OverviewRequestBody,
  type PreviewRequestBody,
  type TrendsRequestBody,
} from '../api';
import { apiErrorStatus, keywordResearchErrorMessage } from '../errorMessage';
import type {
  ClusterDecisionResponse,
  ClusterRun,
  ClusterRunsResponse,
  GapResponse,
  HistoryResponse,
  IdeasResponse,
  IntentResponse,
  KeywordMetric,
  KeywordSpendPreview,
  LongTailResponse,
  LiveTrendsErrorKind,
  MetricsResponse,
  OverviewResponse,
  RelatedKeyword,
  RelatedResponse,
  StoredResearchResult,
  TrendsExplorationDto,
  TrendsListResponse,
  TrendsResponse,
  TrendsSpendPreview,
  TrendsStoredRunSummary,
} from '../types';

export interface LoadMetricsArgs {
  keywords: string[];
  locationCode: number;
  languageCode: string;
  siteId?: string;
  /** Shared with the paired intent call so history can fold the two records. */
  lookupId?: string;
}

export interface MetricsRejectPayload {
  error: string;
}

export const loadMetrics = createAsyncThunk<
  MetricsResponse,
  LoadMetricsArgs,
  { rejectValue: MetricsRejectPayload }
>('keywordResearch/loadMetrics', async (args, { rejectWithValue, dispatch, getState }) => {
  try {
    const result = await fetchMetricsRequest(args);
    refreshHistoryAfterResearch(dispatch, getState);
    return result;
  } catch (err) {
    return rejectWithValue({
      error: keywordResearchErrorMessage(err, 'keywordResearch:loadFailed'),
    });
  }
});

export interface LoadRelatedArgs {
  keyword: string;
  locationCode: number;
  languageCode: string;
  siteId?: string;
}

export const loadRelated = createAsyncThunk<
  RelatedResponse,
  LoadRelatedArgs,
  { rejectValue: string }
>('keywordResearch/loadRelated', async (args, { rejectWithValue, dispatch, getState }) => {
  try {
    const result = await fetchRelatedRequest(args);
    refreshHistoryAfterResearch(dispatch, getState);
    return result;
  } catch (err) {
    return rejectWithValue(
      keywordResearchErrorMessage(err, 'keywordResearch:relatedFailed'),
    );
  }
});

export interface LoadIntentArgs {
  keywords: string[];
  locationCode: number;
  languageCode: string;
  siteId?: string;
  /** Same value as the paired metrics call. */
  lookupId?: string;
}

export const fetchIntent = createAsyncThunk<
  IntentResponse,
  LoadIntentArgs,
  { rejectValue: string }
>('keywordResearch/fetchIntent', async (args, { rejectWithValue, dispatch, getState }) => {
  try {
    const result = await fetchIntentRequest(args);
    refreshHistoryAfterResearch(dispatch, getState);
    return result;
  } catch (err) {
    return rejectWithValue(
      keywordResearchErrorMessage(err, 'keywordResearch:intentFailed'),
    );
  }
});

export interface LoadIdeasArgs {
  seed: string;
  locationCode: number;
  languageCode: string;
  siteId?: string;
}

export interface IdeasRejectPayload {
  error: string;
}

export const fetchIdeas = createAsyncThunk<
  IdeasResponse,
  LoadIdeasArgs,
  { rejectValue: IdeasRejectPayload }
>('keywordResearch/fetchIdeas', async (args, { rejectWithValue, dispatch, getState }) => {
  try {
    const result = await fetchIdeasRequest(args);
    refreshHistoryAfterResearch(dispatch, getState);
    return result;
  } catch (err) {
    return rejectWithValue({
      error: keywordResearchErrorMessage(err, 'keywordResearch:ideasError'),
    });
  }
});

export const fetchLongTail = createAsyncThunk<
  LongTailResponse,
  LoadIdeasArgs,
  { rejectValue: IdeasRejectPayload }
>('keywordResearch/fetchLongTail', async (args, { rejectWithValue, dispatch, getState }) => {
  try {
    const result = await fetchLongTailRequest(args);
    refreshHistoryAfterResearch(dispatch, getState);
    return result;
  } catch (err) {
    return rejectWithValue({
      error: keywordResearchErrorMessage(err, 'keywordResearch:longTail.error'),
    });
  }
});

export interface LoadHistoryArgs {
  cursor?: string;
  /** Site Research tab scope; omitted = the account-wide list. */
  siteId?: string;
}

export interface HistoryRejectPayload {
  error: string;
}

export const loadHistory = createAsyncThunk<
  HistoryResponse,
  LoadHistoryArgs,
  { rejectValue: HistoryRejectPayload }
>('keywordResearch/loadHistory', async (args, { rejectWithValue }) => {
  try {
    return await fetchHistoryRequest(args);
  } catch (err) {
    return rejectWithValue({
      error: keywordResearchErrorMessage(err, 'keywordResearch:history.loadFailed'),
    });
  }
});

export interface OpenStoredArgs {
  historyId: string;
}

export interface OpenStoredRejectPayload {
  error: string;
}

/**
 * Re-open a history row from the shared cache. Deliberately does NOT refresh
 * history afterwards: a stored read writes no history record, so there is
 * nothing new to list.
 */
export const openStoredResearch = createAsyncThunk<
  StoredResearchResult,
  OpenStoredArgs,
  { rejectValue: OpenStoredRejectPayload }
>('keywordResearch/openStoredResearch', async ({ historyId }, { rejectWithValue }) => {
  try {
    return await fetchStoredResultRequest(historyId);
  } catch (err) {
    return rejectWithValue({
      error: keywordResearchErrorMessage(err, 'keywordResearch:stored.loadFailed'),
    });
  }
});

/**
 * Every successful research call lands a row in the server's research
 * history, so a history list already on screen ("Recent research", the
 * workspace export control) is stale the moment a lookup resolves. Refetch
 * the first page, but only when some view has loaded history; otherwise the
 * next mount loads it fresh anyway. Concurrent refreshes (metrics + intent
 * fire together) are ordered by the slice: only the newest first-page load is
 * applied.
 */
function refreshHistoryAfterResearch(
  dispatch: (action: ReturnType<typeof loadHistory>) => unknown,
  getState: () => unknown,
): void {
  const slice = (
    getState() as {
      keywordResearch?: { historyLoaded?: boolean; historySiteId?: string | null };
    }
  ).keywordResearch;
  if (!slice?.historyLoaded) return;
  // Refresh the list that is on screen: a site Research tab stays scoped to
  // its site, the standalone page stays account-wide.
  const siteId = slice.historySiteId;
  void dispatch(loadHistory(siteId ? { siteId } : {}));
}

// ---------------------------------------------------------------------------
// Workspace thunks. Every vendor-backed thunk rejects with a shared payload:
// the localized message plus the HTTP status (409 drives the decision banner).
// ---------------------------------------------------------------------------

export interface PaidRejectPayload {
  error: string;
  status: number | null;
}

function toPaidReject(err: unknown, fallbackKey: string): PaidRejectPayload {
  return {
    error: keywordResearchErrorMessage(err, fallbackKey),
    status: apiErrorStatus(err),
  };
}

export const fetchKeywordPreview = createAsyncThunk<
  KeywordSpendPreview,
  PreviewRequestBody,
  { rejectValue: PaidRejectPayload }
>('keywordResearch/fetchKeywordPreview', async (args, { rejectWithValue }) => {
  try {
    return await fetchKeywordPreviewRequest(args);
  } catch (err) {
    return rejectWithValue(toPaidReject(err, 'keywordResearch:previewFailed'));
  }
});

export const runGap = createAsyncThunk<
  GapResponse,
  GapRequestBody,
  { rejectValue: PaidRejectPayload }
>('keywordResearch/runGap', async (args, { rejectWithValue, dispatch, getState }) => {
  try {
    const result = await fetchGapRequest(args);
    refreshHistoryAfterResearch(dispatch, getState);
    return result;
  } catch (err) {
    return rejectWithValue(toPaidReject(err, 'keywordResearch:gap.loadFailed'));
  }
});

export const runOverview = createAsyncThunk<
  OverviewResponse,
  OverviewRequestBody,
  { rejectValue: PaidRejectPayload }
>('keywordResearch/runOverview', async (args, { rejectWithValue, dispatch, getState }) => {
  try {
    const result = await fetchOverviewRequest(args);
    refreshHistoryAfterResearch(dispatch, getState);
    return result;
  } catch (err) {
    return rejectWithValue(
      toPaidReject(err, 'keywordResearch:overview.loadFailed'),
    );
  }
});

export const runTrends = createAsyncThunk<
  TrendsResponse,
  TrendsRequestBody,
  { rejectValue: PaidRejectPayload }
>('keywordResearch/runTrends', async (args, { rejectWithValue, dispatch, getState }) => {
  try {
    const result = await fetchTrendsRequest(args);
    refreshHistoryAfterResearch(dispatch, getState);
    return result;
  } catch (err) {
    return rejectWithValue(
      toPaidReject(err, 'keywordResearch:trends.loadFailed'),
    );
  }
});

export const runClusters = createAsyncThunk<
  ClusterRun,
  ClusterRunRequestBody,
  { rejectValue: PaidRejectPayload }
>('keywordResearch/runClusters', async (args, { rejectWithValue, dispatch, getState }) => {
  try {
    const result = await runClustersRequest(args);
    refreshHistoryAfterResearch(dispatch, getState);
    return result;
  } catch (err) {
    return rejectWithValue(
      toPaidReject(err, 'keywordResearch:clusters.runFailed'),
    );
  }
});

export const loadClusterRuns = createAsyncThunk<
  ClusterRunsResponse,
  ClusterRunsRequestArgs,
  { rejectValue: PaidRejectPayload }
>('keywordResearch/loadClusterRuns', async (args, { rejectWithValue }) => {
  try {
    return await fetchClusterRunsRequest(args);
  } catch (err) {
    return rejectWithValue(
      toPaidReject(err, 'keywordResearch:clusters.listFailed'),
    );
  }
});

export const loadClusterRun = createAsyncThunk<
  ClusterRun,
  { runId: string },
  { rejectValue: PaidRejectPayload }
>('keywordResearch/loadClusterRun', async (args, { rejectWithValue }) => {
  try {
    return await fetchClusterRunRequest(args.runId);
  } catch (err) {
    return rejectWithValue(
      toPaidReject(err, 'keywordResearch:clusters.detailFailed'),
    );
  }
});

export interface DecideClusterArgs extends ClusterDecisionRequestBody {
  runId: string;
  clusterId: string;
}

export interface DecideClusterRejectPayload extends PaidRejectPayload {
  runId: string;
  clusterId: string;
}

export const decideCluster = createAsyncThunk<
  ClusterDecisionResponse,
  DecideClusterArgs,
  { rejectValue: DecideClusterRejectPayload }
>('keywordResearch/decideCluster', async (args, { rejectWithValue }) => {
  const { runId, clusterId, ...body } = args;
  try {
    return await postClusterDecisionRequest(runId, clusterId, body);
  } catch (err) {
    return rejectWithValue({
      ...toPaidReject(err, 'keywordResearch:clusters.decisionFailed'),
      runId,
      clusterId,
    });
  }
});

// ---------------------------------------------------------------------------
// Live Keyword Trends thunks (preview / explore / list / get).
// Rejection payload discriminates kill-switch / vendor-failed / not-found so
// the view can render the right honest-state card.
// ---------------------------------------------------------------------------

export interface LiveTrendsRejectPayload {
  error: string;
  kind: LiveTrendsErrorKind | null;
  status: number | null;
}

function toLiveTrendsReject(
  err: unknown,
  fallbackKey: string,
): LiveTrendsRejectPayload {
  const status = apiErrorStatus(err);
  let kind: LiveTrendsErrorKind | null = null;
  if (status === 503) {
    // The server emits a stable, non-vendor reason code. Never inspect the
    // localized message: Arabic (and every other locale) must classify the
    // same failure identically.
    const reason =
      ((err as ApiError).data as {
        error?: { details?: { reason?: unknown } };
      } | undefined)?.error?.details?.reason;
    kind =
      reason === 'provider_failed'
        ? 'providerFailed'
        : reason === 'disabled'
          ? 'unavailable'
          : 'unknown';
  } else if (status === 404) {
    kind = 'notFound';
  } else if (status !== null && status !== 0) {
    kind = 'unknown';
  }
  return {
    error: keywordResearchErrorMessage(err, fallbackKey),
    kind,
    status,
  };
}

export const previewLiveTrends = createAsyncThunk<
  TrendsSpendPreview,
  LiveTrendsExploreRequestBody,
  { rejectValue: LiveTrendsRejectPayload }
>(
  'keywordResearch/previewLiveTrends',
  async (args, { rejectWithValue }) => {
    try {
      return await previewLiveTrendsRequest(args);
    } catch (err) {
      return rejectWithValue(
        toLiveTrendsReject(err, 'keywordResearch:trends.preview.failed'),
      );
    }
  },
);

export const exploreLiveTrends = createAsyncThunk<
  TrendsExplorationDto,
  LiveTrendsExploreRequestBody,
  { rejectValue: LiveTrendsRejectPayload }
>(
  'keywordResearch/exploreLiveTrends',
  async (args, { rejectWithValue }) => {
    try {
      return await exploreLiveTrendsRequest(args);
    } catch (err) {
      return rejectWithValue(
        toLiveTrendsReject(err, 'keywordResearch:trends.explore.failed'),
      );
    }
  },
);

export const loadLiveTrendsList = createAsyncThunk<
  TrendsListResponse,
  LiveTrendsListRequestArgs,
  { rejectValue: LiveTrendsRejectPayload }
>(
  'keywordResearch/loadLiveTrendsList',
  async (args, { rejectWithValue }) => {
    try {
      return await fetchLiveTrendsListRequest(args);
    } catch (err) {
      return rejectWithValue(
        toLiveTrendsReject(err, 'keywordResearch:trends.history.failed'),
      );
    }
  },
);

export const loadLiveTrendsRun = createAsyncThunk<
  TrendsStoredRunSummary,
  { runId: string },
  { rejectValue: LiveTrendsRejectPayload }
>(
  'keywordResearch/loadLiveTrendsRun',
  async ({ runId }, { rejectWithValue }) => {
    try {
      return await fetchLiveTrendsRunRequest(runId);
    } catch (err) {
      return rejectWithValue(
        toLiveTrendsReject(err, 'keywordResearch:trends.storedRun.failed'),
      );
    }
  },
);

export type { KeywordMetric, RelatedKeyword };
