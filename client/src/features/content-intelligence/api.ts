import { apiClient } from '@shared/api/client';
import type {
  AnalysesPage,
  CancelResponse,
  ContentAnalysis,
  AnalysisBriefSection,
  AnalysisBriefVersion,
  AnalysisDraftVersion,
  PreflightResponse,
  StartAnalysisResponse,
  ContentRecommendationEvent,
  ContentRecommendationState,
  RecommendationApplicationCheck,
  RecommendationOutcome,
  CancelInventoryResponse,
  InventoryRunDetail,
  InventoryRunsPage,
  StartInventoryResponse,
  AddCompetitorResponse,
  CancelCompetitorRunResponse,
  CompetitorContentRunDetail,
  CompetitorContentRunsPage,
  CompetitorProfileSource,
  CompetitorProfileStatus,
  ListCompetitorsResponse,
  MutateCompetitorResponse,
  StartCompetitorRunResponse,
  SuggestCompetitorsResponse,
  ContentMonitorStatus,
  ContentMonitorTargetKind,
  CreatedMonitorResponse,
  DeleteMonitorResponse,
  ListMonitorsResponse,
  MonitorFeedResponse,
  MonitorNotificationPrefResponse,
  MutateMonitorResponse,
} from './types';

export interface StartAnalysisPayload {
  siteId: string;
  ownedUrl: string;
  keyword: string;
  locale: string;
  clientKey?: string;
  reviewedPageMatches?: Array<{
    landscapeReportId: string;
    landscapeOpportunityId?: string | null;
    suggestionId: string;
  }>;
}

export function startAnalysis(
  payload: StartAnalysisPayload,
  init: { signal?: AbortSignal } = {},
): Promise<StartAnalysisResponse> {
  const { siteId, ...body } = payload;
  return apiClient<StartAnalysisResponse>(
    `/sites/${encodeURIComponent(siteId)}/content-analyses`,
    { method: 'POST', body, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export interface PreflightPayload {
  siteId: string;
  ownedUrl: string;
  keyword: string;
  locale: string;
}

export function preflightAnalysis(
  payload: PreflightPayload,
  init: { signal?: AbortSignal } = {},
): Promise<PreflightResponse> {
  const { siteId, ...body } = payload;
  return apiClient<PreflightResponse>(
    `/sites/${encodeURIComponent(siteId)}/content-analyses/preflight`,
    { method: 'POST', body, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export interface ListAnalysesPayload {
  siteId: string;
  cursor?: string;
  limit?: number;
}

export function listAnalyses(
  payload: ListAnalysesPayload,
  init: { signal?: AbortSignal } = {},
): Promise<AnalysesPage> {
  const params = new URLSearchParams();
  if (payload.cursor) params.set('cursor', payload.cursor);
  if (payload.limit) params.set('limit', String(payload.limit));
  const q = params.toString();
  return apiClient<AnalysesPage>(
    `/sites/${encodeURIComponent(payload.siteId)}/content-analyses${q ? `?${q}` : ''}`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function getAnalysis(
  analysisId: string,
  siteId?: string,
  init: { signal?: AbortSignal } = {},
): Promise<ContentAnalysis> {
  const params = new URLSearchParams();
  if (siteId) params.set('siteId', siteId);
  const query = params.toString();
  return apiClient<ContentAnalysis>(
    `/content-analyses/${encodeURIComponent(analysisId)}${query ? `?${query}` : ''}`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function cancelAnalysis(
  analysisId: string,
  init: { signal?: AbortSignal } = {},
): Promise<CancelResponse> {
  return apiClient<CancelResponse>(
    `/content-analyses/${encodeURIComponent(analysisId)}/cancel`,
    { method: 'POST', body: {}, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function regenerateAnalysis(
  analysisId: string,
  init: { signal?: AbortSignal } = {},
): Promise<StartAnalysisResponse> {
  return apiClient<StartAnalysisResponse>(
    `/content-analyses/${encodeURIComponent(analysisId)}/regenerate`,
    { method: 'POST', body: {}, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function saveDraftVersion(
  analysisId: string,
  markdown: string,
  clientKey: string,
): Promise<{ version: AnalysisDraftVersion }> {
  return apiClient<{ version: AnalysisDraftVersion }>(
    `/content-analyses/${encodeURIComponent(analysisId)}/draft-versions`,
    { method: 'POST', body: { markdown, clientKey } },
  );
}

export function saveBriefVersion(
  analysisId: string,
  sections: AnalysisBriefSection[],
  clientKey: string,
): Promise<{ version: AnalysisBriefVersion }> {
  return apiClient<{ version: AnalysisBriefVersion }>(
    `/content-analyses/${encodeURIComponent(analysisId)}/brief-versions`,
    { method: 'POST', body: { sections, clientKey } },
  );
}

export interface RecommendationMutationPayload {
  analysisId: string;
  recommendationId: string;
  action: 'accept' | 'dismiss' | 'apply' | 'undo';
  analysisVersion: string;
  expectedVersion: number;
  clientKey: string;
  note?: string;
}

export function mutateRecommendation(
  payload: RecommendationMutationPayload,
): Promise<{ state: ContentRecommendationState }> {
  const { analysisId, recommendationId, action, ...body } = payload;
  return apiClient<{ state: ContentRecommendationState }>(
    `/content-analyses/${encodeURIComponent(analysisId)}/recommendations/${encodeURIComponent(recommendationId)}/${action}`,
    {
      method: 'POST',
      body: action === 'apply' ? { ...body, confirm: true } : body,
    },
  );
}

export function listRecommendationHistory(
  analysisId: string,
  recommendationId: string,
): Promise<{ events: ContentRecommendationEvent[] }> {
  return apiClient<{ events: ContentRecommendationEvent[] }>(
    `/content-analyses/${encodeURIComponent(analysisId)}/recommendations/${encodeURIComponent(recommendationId)}/history`,
    { method: 'GET' },
  );
}

export function getRecommendationApplicationCheck(
  analysisId: string,
  recommendationId: string,
): Promise<RecommendationApplicationCheck> {
  return apiClient<RecommendationApplicationCheck>(
    `/content-analyses/${encodeURIComponent(analysisId)}/recommendations/${encodeURIComponent(recommendationId)}/application-check`,
    { method: 'GET' },
  );
}

export function getRecommendationOutcome(
  analysisId: string,
  recommendationId: string,
): Promise<RecommendationOutcome> {
  return apiClient<RecommendationOutcome>(
    `/content-analyses/${encodeURIComponent(analysisId)}/recommendations/${encodeURIComponent(recommendationId)}/outcome`,
    { method: 'GET' },
  );
}

// ---------------------------------------------------------------------------
// Content Inventory — site-scoped endpoints under
// /api/sites/:siteId/content-intelligence/inventory[/:runId[/cancel]].
// ---------------------------------------------------------------------------

export interface StartInventoryPayload {
  siteId: string;
  pageLimit: number;
  allowedPaths: string[];
  excludedPaths: string[];
  sitemapSeeds: string[];
  locale: string;
  clientKey?: string;
}

export function startInventory(
  payload: StartInventoryPayload,
  init: { signal?: AbortSignal } = {},
): Promise<StartInventoryResponse> {
  const { siteId, ...body } = payload;
  return apiClient<StartInventoryResponse>(
    `/sites/${encodeURIComponent(siteId)}/content-intelligence/inventory`,
    { method: 'POST', body, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export interface ListInventoryPayload {
  siteId: string;
  cursor?: string;
  limit?: number;
}

export function listInventoryRuns(
  payload: ListInventoryPayload,
  init: { signal?: AbortSignal } = {},
): Promise<InventoryRunsPage> {
  const params = new URLSearchParams();
  if (payload.cursor) params.set('cursor', payload.cursor);
  if (payload.limit) params.set('limit', String(payload.limit));
  const q = params.toString();
  return apiClient<InventoryRunsPage>(
    `/sites/${encodeURIComponent(payload.siteId)}/content-intelligence/inventory${q ? `?${q}` : ''}`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function getInventoryRun(
  siteId: string,
  runId: string,
  init: { signal?: AbortSignal } = {},
): Promise<InventoryRunDetail> {
  return apiClient<InventoryRunDetail>(
    `/sites/${encodeURIComponent(siteId)}/content-intelligence/inventory/${encodeURIComponent(runId)}`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function cancelInventory(
  siteId: string,
  runId: string,
  init: { signal?: AbortSignal } = {},
): Promise<CancelInventoryResponse> {
  return apiClient<CancelInventoryResponse>(
    `/sites/${encodeURIComponent(siteId)}/content-intelligence/inventory/${encodeURIComponent(runId)}/cancel`,
    { method: 'POST', body: {}, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

// ---------------------------------------------------------------------------
// Competitor content intelligence (Agency) — site-scoped endpoints
// under /api/sites/:siteId/competitor-content/*.
// ---------------------------------------------------------------------------

export function suggestCompetitors(
  siteId: string,
  init: { signal?: AbortSignal } = {},
): Promise<SuggestCompetitorsResponse> {
  return apiClient<SuggestCompetitorsResponse>(
    `/sites/${encodeURIComponent(siteId)}/competitor-content/suggestions`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function listCompetitors(
  siteId: string,
  status: CompetitorProfileStatus | 'all',
  init: { signal?: AbortSignal } = {},
): Promise<ListCompetitorsResponse> {
  return apiClient<ListCompetitorsResponse>(
    `/sites/${encodeURIComponent(siteId)}/competitor-content/competitors?status=${encodeURIComponent(status)}`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export interface AddCompetitorPayload {
  siteId: string;
  url: string;
  source: CompetitorProfileSource;
}

export function addCompetitor(
  payload: AddCompetitorPayload,
  init: { signal?: AbortSignal } = {},
): Promise<AddCompetitorResponse> {
  const { siteId, ...body } = payload;
  return apiClient<AddCompetitorResponse>(
    `/sites/${encodeURIComponent(siteId)}/competitor-content/competitors`,
    { method: 'POST', body, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function archiveCompetitor(
  siteId: string,
  competitorId: string,
  init: { signal?: AbortSignal } = {},
): Promise<MutateCompetitorResponse> {
  return apiClient<MutateCompetitorResponse>(
    `/sites/${encodeURIComponent(siteId)}/competitor-content/competitors/${encodeURIComponent(competitorId)}/archive`,
    { method: 'POST', body: {}, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function restoreCompetitor(
  siteId: string,
  competitorId: string,
  init: { signal?: AbortSignal } = {},
): Promise<MutateCompetitorResponse> {
  return apiClient<MutateCompetitorResponse>(
    `/sites/${encodeURIComponent(siteId)}/competitor-content/competitors/${encodeURIComponent(competitorId)}/restore`,
    { method: 'POST', body: {}, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export interface StartCompetitorRunPayload {
  siteId: string;
  competitorIds?: string[];
  ownedUrl?: string;
  reviewedPageMatches?: Array<{
    landscapeReportId: string;
    landscapeOpportunityId?: string | null;
    suggestionId: string;
  }>;
  competitorUrls?: Array<{ competitorId: string; url: string }>;
  keyword?: string;
  pageLimit: number;
  locale: string;
  clientKey?: string;
}

export function startCompetitorRun(
  payload: StartCompetitorRunPayload,
  init: { signal?: AbortSignal } = {},
): Promise<StartCompetitorRunResponse> {
  const { siteId, ...body } = payload;
  return apiClient<StartCompetitorRunResponse>(
    `/sites/${encodeURIComponent(siteId)}/competitor-content/runs`,
    { method: 'POST', body, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export interface ListCompetitorRunsPayload {
  siteId: string;
  cursor?: string;
  limit?: number;
}

export function listCompetitorRuns(
  payload: ListCompetitorRunsPayload,
  init: { signal?: AbortSignal } = {},
): Promise<CompetitorContentRunsPage> {
  const params = new URLSearchParams();
  if (payload.cursor) params.set('cursor', payload.cursor);
  if (payload.limit) params.set('limit', String(payload.limit));
  const q = params.toString();
  return apiClient<CompetitorContentRunsPage>(
    `/sites/${encodeURIComponent(payload.siteId)}/competitor-content/runs${q ? `?${q}` : ''}`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function getCompetitorRun(
  siteId: string,
  runId: string,
  init: { signal?: AbortSignal } = {},
): Promise<CompetitorContentRunDetail> {
  return apiClient<CompetitorContentRunDetail>(
    `/sites/${encodeURIComponent(siteId)}/competitor-content/runs/${encodeURIComponent(runId)}`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function cancelCompetitorRun(
  siteId: string,
  runId: string,
  init: { signal?: AbortSignal } = {},
): Promise<CancelCompetitorRunResponse> {
  return apiClient<CancelCompetitorRunResponse>(
    `/sites/${encodeURIComponent(siteId)}/competitor-content/runs/${encodeURIComponent(runId)}/cancel`,
    { method: 'POST', body: {}, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

// ---------------------------------------------------------------------------
// Public-page change monitoring (Agency) — site-scoped endpoints
// under /api/sites/:siteId/content-monitoring/monitors[/:monitorId[/pause|resume]].
// The email-change notification toggle reuses the shared /api/users/notifications
// preference endpoint (`emailMonitorChange` channel).
// ---------------------------------------------------------------------------

export function listMonitors(
  siteId: string,
  status: ContentMonitorStatus | 'all',
  init: { signal?: AbortSignal } = {},
): Promise<ListMonitorsResponse> {
  return apiClient<ListMonitorsResponse>(
    `/sites/${encodeURIComponent(siteId)}/content-monitoring/monitors?status=${encodeURIComponent(status)}`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export interface CreateMonitorPayload {
  siteId: string;
  targetUrl: string;
  targetKind: ContentMonitorTargetKind;
  locale: string;
}

export function createMonitor(
  payload: CreateMonitorPayload,
  init: { signal?: AbortSignal } = {},
): Promise<CreatedMonitorResponse> {
  const { siteId, ...body } = payload;
  return apiClient<CreatedMonitorResponse>(
    `/sites/${encodeURIComponent(siteId)}/content-monitoring/monitors`,
    { method: 'POST', body, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export interface GetMonitorPayload {
  siteId: string;
  monitorId: string;
  cursor?: string;
  limit?: number;
}

export function getMonitorFeed(
  payload: GetMonitorPayload,
  init: { signal?: AbortSignal } = {},
): Promise<MonitorFeedResponse> {
  const params = new URLSearchParams();
  if (payload.cursor) params.set('cursor', payload.cursor);
  if (payload.limit) params.set('limit', String(payload.limit));
  const q = params.toString();
  return apiClient<MonitorFeedResponse>(
    `/sites/${encodeURIComponent(payload.siteId)}/content-monitoring/monitors/${encodeURIComponent(payload.monitorId)}${q ? `?${q}` : ''}`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function pauseMonitor(
  siteId: string,
  monitorId: string,
  init: { signal?: AbortSignal } = {},
): Promise<MutateMonitorResponse> {
  return apiClient<MutateMonitorResponse>(
    `/sites/${encodeURIComponent(siteId)}/content-monitoring/monitors/${encodeURIComponent(monitorId)}/pause`,
    { method: 'POST', body: {}, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function resumeMonitor(
  siteId: string,
  monitorId: string,
  init: { signal?: AbortSignal } = {},
): Promise<MutateMonitorResponse> {
  return apiClient<MutateMonitorResponse>(
    `/sites/${encodeURIComponent(siteId)}/content-monitoring/monitors/${encodeURIComponent(monitorId)}/resume`,
    { method: 'POST', body: {}, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function deleteMonitor(
  siteId: string,
  monitorId: string,
  init: { signal?: AbortSignal } = {},
): Promise<DeleteMonitorResponse> {
  return apiClient<DeleteMonitorResponse>(
    `/sites/${encodeURIComponent(siteId)}/content-monitoring/monitors/${encodeURIComponent(monitorId)}`,
    { method: 'DELETE', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function getMonitorNotifications(
  init: { signal?: AbortSignal } = {},
): Promise<MonitorNotificationPrefResponse> {
  return apiClient<MonitorNotificationPrefResponse>('/users/notifications', {
    method: 'GET',
    ...(init.signal ? { signal: init.signal } : {}),
  });
}

export function patchMonitorNotifications(
  value: boolean,
  init: { signal?: AbortSignal } = {},
): Promise<MonitorNotificationPrefResponse> {
  return apiClient<MonitorNotificationPrefResponse>('/users/notifications', {
    method: 'PATCH',
    body: { emailMonitorChange: value },
    ...(init.signal ? { signal: init.signal } : {}),
  });
}
