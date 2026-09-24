import { apiClient } from '@shared/api/client';
import type {
  AudienceResearchInput,
  DecideSignalRequest,
  ListRunsResult,
  RunResultView,
  RunStatusView,
  SignalDecisionResult,
  StartRunResponse,
} from './types';

export interface RunApiInit {
  signal?: AbortSignal;
}

export function startAudienceResearchRun(
  siteId: string,
  input: AudienceResearchInput,
  init: RunApiInit = {},
): Promise<StartRunResponse> {
  return apiClient<StartRunResponse>(
    `/sites/${encodeURIComponent(siteId)}/audience-research/runs`,
    { method: 'POST', body: input, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export interface ListAudienceResearchRunsParams {
  limit?: number;
  cursor?: string;
}

export function listAudienceResearchRuns(
  siteId: string,
  params: ListAudienceResearchRunsParams = {},
  init: RunApiInit = {},
): Promise<ListRunsResult> {
  const search = new URLSearchParams();
  if (params.limit) search.set('limit', String(params.limit));
  if (params.cursor) search.set('cursor', params.cursor);
  const q = search.toString();
  return apiClient<ListRunsResult>(
    `/sites/${encodeURIComponent(siteId)}/audience-research/runs${q ? `?${q}` : ''}`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function getAudienceResearchRun(
  siteId: string,
  runId: string,
  init: RunApiInit = {},
): Promise<RunStatusView> {
  return apiClient<RunStatusView>(
    `/sites/${encodeURIComponent(siteId)}/audience-research/runs/${encodeURIComponent(runId)}`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function getAudienceResearchRunResult(
  siteId: string,
  runId: string,
  init: RunApiInit = {},
): Promise<RunResultView> {
  return apiClient<RunResultView>(
    `/sites/${encodeURIComponent(siteId)}/audience-research/runs/${encodeURIComponent(runId)}/result`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

/**
 * POST decision — the only mutation on a signal. The body carries ONLY
 * `{ decision, destination|reason, idempotencyKey }`. The server
 * derives every non-idempotency response field from the immutable
 * signal; the client never authors evidence, confidence, priority, or
 * destination class.
 */
export function postAudienceResearchSignalDecision(
  request: DecideSignalRequest,
  init: RunApiInit = {},
): Promise<SignalDecisionResult> {
  const { siteId, runId, signalId, ...body } = request;
  return apiClient<SignalDecisionResult>(
    `/sites/${encodeURIComponent(siteId)}/audience-research/runs/${encodeURIComponent(runId)}/signals/${encodeURIComponent(signalId)}/decision`,
    { method: 'POST', body, ...(init.signal ? { signal: init.signal } : {}) },
  );
}
