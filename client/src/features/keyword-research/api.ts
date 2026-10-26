import { apiClient } from '@shared/api/client';
import type {
  ClusterDecisionKind,
  ClusterDecisionResponse,
  ClusterRun,
  ClusterRunsResponse,
  GapResponse,
  HistoryResponse,
  IdeasResponse,
  IntentResponse,
  KeywordSpendPreview,
  LongTailResponse,
  MetricsResponse,
  OverviewResponse,
  RelatedResponse,
  StoredKeywordsResponse,
  StoredResearchResult,
  TrendsExplorationDto,
  TrendsListResponse,
  TrendsResponse,
  TrendsSpendPreview,
  TrendsStoredRunSummary,
} from './types';

export interface MetricsRequestBody {
  keywords: string[];
  locationCode: number;
  languageCode: string;
  /** Site Research tab: attributes the history row to this site. */
  siteId?: string;
  /** One UUID per Research press, sent on BOTH the metrics and intent calls. */
  lookupId?: string;
}

export const fetchMetricsRequest = (
  body: MetricsRequestBody,
): Promise<MetricsResponse> =>
  apiClient<MetricsResponse>('/keyword-research/metrics', {
    method: 'POST',
    body,
  });

export interface RelatedRequestBody {
  keyword: string;
  locationCode: number;
  languageCode: string;
  siteId?: string;
}

export const fetchRelatedRequest = (
  body: RelatedRequestBody,
): Promise<RelatedResponse> =>
  apiClient<RelatedResponse>('/keyword-research/related', {
    method: 'POST',
    body,
  });

export interface IntentRequestBody {
  keywords: string[];
  locationCode: number;
  languageCode: string;
  /** Site Research tab: attributes the history row to this site. */
  siteId?: string;
  /** Same UUID as the paired metrics call. */
  lookupId?: string;
}

export const fetchIntentRequest = (
  body: IntentRequestBody,
): Promise<IntentResponse> =>
  apiClient<IntentResponse>('/keyword-research/intent', {
    method: 'POST',
    body,
  });

export interface IdeasRequestBody {
  seed: string;
  locationCode: number;
  languageCode: string;
  siteId?: string;
}

export const fetchIdeasRequest = (
  body: IdeasRequestBody,
): Promise<IdeasResponse> =>
  apiClient<IdeasResponse>('/keyword-research/ideas', {
    method: 'POST',
    body,
  });

export const fetchLongTailRequest = (
  body: IdeasRequestBody,
): Promise<LongTailResponse> =>
  apiClient<LongTailResponse>('/keyword-research/long-tail', {
    method: 'POST',
    body,
  });

export interface HistoryRequestArgs {
  cursor?: string;
  limit?: number;
  /** Site Research tab: only that site's lookups (server-filtered). */
  siteId?: string;
}

export const fetchHistoryRequest = (
  args: HistoryRequestArgs = {},
): Promise<HistoryResponse> => {
  const params = new URLSearchParams();
  if (args.cursor !== undefined) params.set('cursor', args.cursor);
  if (args.limit !== undefined) params.set('limit', String(args.limit));
  if (args.siteId !== undefined) params.set('siteId', args.siteId);
  const qs = params.toString();
  return apiClient<HistoryResponse>(
    `/keyword-research/history${qs ? `?${qs}` : ''}`,
  );
};

/**
 * Re-open one history row from the shared cache. No provider is called and no
 * history row is written (server `historyResultsHandler`).
 */
export const fetchStoredResultRequest = (
  historyId: string,
): Promise<StoredResearchResult> =>
  apiClient<StoredResearchResult>(
    `/keyword-research/history/${encodeURIComponent(historyId)}/results`,
  );

export interface StoredKeywordsRequestArgs {
  locationCode: number;
  languageCode: string;
  q?: string;
  limit?: number;
}

/** Every phrase the account already stored for one market. Never calls a provider. */
export const fetchStoredKeywordsRequest = (
  args: StoredKeywordsRequestArgs,
): Promise<StoredKeywordsResponse> => {
  const params = new URLSearchParams({
    locationCode: String(args.locationCode),
    languageCode: args.languageCode,
  });
  if (args.q) params.set('q', args.q);
  if (args.limit !== undefined) params.set('limit', String(args.limit));
  return apiClient<StoredKeywordsResponse>(`/keyword-research/stored-keywords?${params.toString()}`);
};

// ---------------------------------------------------------------------------
// Gap / overview / trends / preview / clusters / decisions.
// Thin wrappers over the server contract; request bodies mirror
// the server zod schemas verbatim.
// ---------------------------------------------------------------------------

export interface GapRequestBody {
  ownDomain: string;
  competitors: string[];
  locationCode: number;
  languageCode: string;
}

export const fetchGapRequest = (body: GapRequestBody): Promise<GapResponse> =>
  apiClient<GapResponse>('/keyword-research/gap', { method: 'POST', body });

export interface OverviewRequestBody {
  keywords: string[];
  locationCode: number;
  languageCode: string;
}

export const fetchOverviewRequest = (
  body: OverviewRequestBody,
): Promise<OverviewResponse> =>
  apiClient<OverviewResponse>('/keyword-research/overview', {
    method: 'POST',
    body,
  });

export interface TrendsRequestBody {
  keywords: string[];
  locationCode: number;
  languageCode: string;
}

export const fetchTrendsRequest = (
  body: TrendsRequestBody,
): Promise<TrendsResponse> =>
  apiClient<TrendsResponse>('/keyword-research/trends', {
    method: 'POST',
    body,
  });

/** Discriminated union mirroring the server `previewRequestSchema`. */
export type PreviewRequestBody =
  | ({ operation: 'gap' } & GapRequestBody)
  | ({ operation: 'overview' } & OverviewRequestBody)
  | ({ operation: 'trends' } & TrendsRequestBody);

export const fetchKeywordPreviewRequest = (
  body: PreviewRequestBody,
): Promise<KeywordSpendPreview> =>
  apiClient<KeywordSpendPreview>('/keyword-research/preview', {
    method: 'POST',
    body,
  });

export interface ClusterRunRequestBody {
  phrases: string[];
  locationCode: number;
  languageCode: string;
}

export const runClustersRequest = (
  body: ClusterRunRequestBody,
): Promise<ClusterRun> =>
  apiClient<ClusterRun>('/keyword-research/clusters', { method: 'POST', body });

export interface ClusterRunsRequestArgs {
  cursor?: string;
  limit?: number;
}

export const fetchClusterRunsRequest = (
  args: ClusterRunsRequestArgs = {},
): Promise<ClusterRunsResponse> => {
  const params = new URLSearchParams();
  if (args.cursor !== undefined) params.set('cursor', args.cursor);
  if (args.limit !== undefined) params.set('limit', String(args.limit));
  const qs = params.toString();
  return apiClient<ClusterRunsResponse>(
    `/keyword-research/clusters${qs ? `?${qs}` : ''}`,
  );
};

export const fetchClusterRunRequest = (runId: string): Promise<ClusterRun> =>
  apiClient<ClusterRun>(
    `/keyword-research/clusters/${encodeURIComponent(runId)}`,
  );

export interface ClusterDecisionRequestBody {
  kind: ClusterDecisionKind;
  idempotencyKey: string;
  note?: string;
  siteId?: string;
}

// ---------------------------------------------------------------------------
// Live Keyword Trends. Thin wrappers over the
// server routes. Request bodies mirror the server zod schemas verbatim.
// ---------------------------------------------------------------------------

export interface LiveTrendsExploreRequestBody {
  keywords: string[];
  geo?: string;
  language?: string;
  siteId?: string;
}

export const previewLiveTrendsRequest = (
  body: LiveTrendsExploreRequestBody,
): Promise<TrendsSpendPreview> =>
  apiClient<TrendsSpendPreview>('/keyword-research/trends/explore/preview', {
    method: 'POST',
    body,
  });

export const exploreLiveTrendsRequest = (
  body: LiveTrendsExploreRequestBody,
): Promise<TrendsExplorationDto> =>
  apiClient<TrendsExplorationDto>('/keyword-research/trends/explore', {
    method: 'POST',
    body,
  });

export interface LiveTrendsListRequestArgs {
  cursor?: string;
  limit?: number;
  siteId?: string;
}

export const fetchLiveTrendsListRequest = (
  args: LiveTrendsListRequestArgs = {},
): Promise<TrendsListResponse> => {
  const params = new URLSearchParams();
  if (args.cursor !== undefined) params.set('cursor', args.cursor);
  if (args.limit !== undefined) params.set('limit', String(args.limit));
  if (args.siteId !== undefined) params.set('siteId', args.siteId);
  const qs = params.toString();
  return apiClient<TrendsListResponse>(
    `/keyword-research/trends${qs ? `?${qs}` : ''}`,
  );
};

export const fetchLiveTrendsRunRequest = (
  runId: string,
): Promise<TrendsStoredRunSummary> =>
  apiClient<TrendsStoredRunSummary>(
    `/keyword-research/trends/${encodeURIComponent(runId)}`,
  );

export const postClusterDecisionRequest = (
  runId: string,
  clusterId: string,
  body: ClusterDecisionRequestBody,
): Promise<ClusterDecisionResponse> =>
  apiClient<ClusterDecisionResponse>(
    `/keyword-research/clusters/${encodeURIComponent(runId)}/clusters/${encodeURIComponent(clusterId)}/decision`,
    { method: 'POST', body },
  );
