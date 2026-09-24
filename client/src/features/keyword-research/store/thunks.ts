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
}

export interface MetricsRejectPayload {
  error: string;
}

export const loadMetrics = createAsyncThunk<
  MetricsResponse,
  LoadMetricsArgs,
  { rejectValue: MetricsRejectPayload }
>('keywordResearch/loadMetrics', async (args, { rejectWithValue }) => {
  try {
    return await fetchMetricsRequest(args);
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
}

export const loadRelated = createAsyncThunk<
  RelatedResponse,
  LoadRelatedArgs,
  { rejectValue: string }
>('keywordResearch/loadRelated', async (args, { rejectWithValue }) => {
  try {
    return await fetchRelatedRequest(args);
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
}

export const fetchIntent = createAsyncThunk<
  IntentResponse,
  LoadIntentArgs,
  { rejectValue: string }
>('keywordResearch/fetchIntent', async (args, { rejectWithValue }) => {
  try {
    return await fetchIntentRequest(args);
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
}

export interface IdeasRejectPayload {
  error: string;
}

export const fetchIdeas = createAsyncThunk<
  IdeasResponse,
  LoadIdeasArgs,
  { rejectValue: IdeasRejectPayload }
>('keywordResearch/fetchIdeas', async (args, { rejectWithValue }) => {
  try {
    return await fetchIdeasRequest(args);
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
>('keywordResearch/fetchLongTail', async (args, { rejectWithValue }) => {
  try {
    return await fetchLongTailRequest(args);
  } catch (err) {
    return rejectWithValue({
      error: keywordResearchErrorMessage(err, 'keywordResearch:longTail.error'),
    });
  }
});

export interface LoadHistoryArgs {
  cursor?: string;
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
>('keywordResearch/runGap', async (args, { rejectWithValue }) => {
  try {
    return await fetchGapRequest(args);
  } catch (err) {
    return rejectWithValue(toPaidReject(err, 'keywordResearch:gap.loadFailed'));
  }
});

export const runOverview = createAsyncThunk<
  OverviewResponse,
  OverviewRequestBody,
  { rejectValue: PaidRejectPayload }
>('keywordResearch/runOverview', async (args, { rejectWithValue }) => {
  try {
    return await fetchOverviewRequest(args);
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
>('keywordResearch/runTrends', async (args, { rejectWithValue }) => {
  try {
    return await fetchTrendsRequest(args);
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
>('keywordResearch/runClusters', async (args, { rejectWithValue }) => {
  try {
    return await runClustersRequest(args);
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
