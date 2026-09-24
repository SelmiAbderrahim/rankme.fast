import { apiClient } from '@shared/api/client';
import type {
  CompetitorDiscovery,
  CompetitorProfile,
  CompetitorsList,
  DiscoverySpendPreview,
  IntersectionResult,
  LandscapeClass,
  LandscapeDetail,
  LandscapeManifest,
  LandscapePreview,
  LandscapeState,
  LandscapeSummary,
  TechStackResult,
} from './types';

const intelligenceBase = (siteId: string) =>
  `/sites/${encodeURIComponent(siteId)}/competitor-intelligence`;

export const fetchCompetitors = (
  siteId: string,
  init?: { signal?: AbortSignal },
): Promise<CompetitorsList> => {
  const path = `/sites/${siteId}/competitors`;
  return init
    ? apiClient<CompetitorsList>(path, init)
    : apiClient<CompetitorsList>(path);
};

/** Manual refresh — POST because it spends vendor budget. */
export const refreshCompetitors = (siteId: string): Promise<CompetitorsList> =>
  apiClient<CompetitorsList>(`/sites/${siteId}/competitors/refresh`, { method: 'POST' });

export const fetchIntersection = (
  siteId: string,
  competitor: string,
  init?: { signal?: AbortSignal },
): Promise<IntersectionResult> => {
  const params = new URLSearchParams();
  params.set('competitor', competitor);
  const path = `/sites/${siteId}/competitors/intersection?${params.toString()}`;
  return init
    ? apiClient<IntersectionResult>(path, init)
    : apiClient<IntersectionResult>(path);
};

/** On-demand tech-stack lookup for one competitor domain. */
export const fetchTechStack = (
  siteId: string,
  domain: string,
): Promise<TechStackResult> =>
  apiClient<TechStackResult>(
    `/sites/${siteId}/competitors/${encodeURIComponent(domain)}/tech-stack`,
  );

export const fetchCompetitorProfiles = (
  siteId: string,
  status: 'active' | 'archived' | 'all' = 'all',
  signal?: AbortSignal,
): Promise<{ items: CompetitorProfile[] }> => {
  const params = new URLSearchParams({ status });
  return apiClient(`${intelligenceBase(siteId)}/competitors?${params.toString()}`, { signal });
};

export const addCompetitorProfile = (
  siteId: string,
  body: { url: string; source: 'suggested' | 'manual' },
  idempotencyKey: string,
): Promise<{ profile: CompetitorProfile; duplicate: boolean }> =>
  apiClient(`${intelligenceBase(siteId)}/competitors`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body,
  });

export const changeCompetitorProfileStatus = (
  siteId: string,
  competitorId: string,
  action: 'archive' | 'restore',
  idempotencyKey: string,
): Promise<{ profile: CompetitorProfile }> =>
  apiClient(
    `${intelligenceBase(siteId)}/competitors/${encodeURIComponent(competitorId)}/${action}`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {},
    },
  );

export const previewDiscoverySpend = (siteId: string): Promise<DiscoverySpendPreview> =>
  apiClient(`${intelligenceBase(siteId)}/discovery/preview`, {
    method: 'POST',
    body: {},
  });

export const fetchLatestDiscovery = (
  siteId: string,
  signal?: AbortSignal,
): Promise<{ discovery: CompetitorDiscovery }> =>
  apiClient(`${intelligenceBase(siteId)}/discovery`, { signal });

export const refreshDiscovery = (
  siteId: string,
  idempotencyKey: string,
): Promise<{ discovery: CompetitorDiscovery; replayed: boolean }> =>
  apiClient(`${intelligenceBase(siteId)}/discovery/refresh`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: {},
  });

export const previewLandscapeSpend = (
  siteId: string,
  competitorProfileIds: string[],
): Promise<LandscapePreview> =>
  apiClient(`${intelligenceBase(siteId)}/landscapes/preview`, {
    method: 'POST',
    body: { competitorProfileIds },
  });

export const startLandscapeRun = (
  siteId: string,
  body: { competitorProfileIds: string[]; locale: string },
  idempotencyKey: string,
): Promise<{
  run: { runId: string; state: LandscapeState; duplicate: boolean; reservedUnits: number };
}> =>
  apiClient(`${intelligenceBase(siteId)}/landscapes`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body,
  });

export const fetchLandscapeRuns = (
  siteId: string,
  input: { state?: LandscapeState; limit?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<{ items: LandscapeSummary[]; nextCursor: string | null }> => {
  const params = new URLSearchParams();
  if (input.state) params.set('state', input.state);
  if (input.limit) params.set('limit', String(input.limit));
  if (input.cursor) params.set('cursor', input.cursor);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return apiClient(`${intelligenceBase(siteId)}/landscapes${suffix}`, { signal: input.signal });
};

export const fetchLandscapeDetail = (
  siteId: string,
  runId: string,
  input: {
    className?: LandscapeClass;
    competitor?: string;
    q?: string;
    limit?: number;
    cursor?: string;
    signal?: AbortSignal;
  } = {},
): Promise<LandscapeDetail> => {
  const params = new URLSearchParams();
  if (input.className) params.set('class', input.className);
  if (input.competitor) params.set('competitor', input.competitor);
  if (input.q) params.set('q', input.q);
  if (input.limit) params.set('limit', String(input.limit));
  if (input.cursor) params.set('cursor', input.cursor);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return apiClient(
    `${intelligenceBase(siteId)}/landscapes/${encodeURIComponent(runId)}${suffix}`,
    { signal: input.signal },
  );
};

export const cancelLandscapeRun = (
  siteId: string,
  runId: string,
  idempotencyKey: string,
): Promise<{ run: LandscapeSummary }> =>
  apiClient(
    `${intelligenceBase(siteId)}/landscapes/${encodeURIComponent(runId)}/cancel`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {},
    },
  );

export const acceptLandscapeRecommendation = (
  siteId: string,
  runId: string,
  opportunityId: string,
  idempotencyKey: string,
): Promise<{ acceptance: { acceptanceId: string; actionId: string; replayed: boolean } }> =>
  apiClient(
    `${intelligenceBase(siteId)}/landscapes/${encodeURIComponent(runId)}/opportunities/${encodeURIComponent(opportunityId)}/accept`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {},
    },
  );

export const reviewLandscapePageMatch = (
  siteId: string,
  runId: string,
  suggestionId: string,
  body: {
    decision: 'approved' | 'rejected';
    ownedUrl: string | null;
    competitorUrl: string | null;
    version: number;
  },
  idempotencyKey: string,
): Promise<{
  review: LandscapeManifest['pageSuggestions'][number]['review'];
  replayed: boolean;
}> =>
  apiClient(
    `${intelligenceBase(siteId)}/landscapes/${encodeURIComponent(runId)}/page-matches/${encodeURIComponent(suggestionId)}`,
    {
      method: 'PUT',
      headers: { 'Idempotency-Key': idempotencyKey },
      body,
    },
  );
