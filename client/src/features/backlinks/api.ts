import { apiClient } from '@shared/api/client';
import type {
  BacklinkList,
  BacklinkPullType,
  BacklinkRun,
  BacklinkRunsPage,
  BacklinkSummary,
  LinkGapRun,
  SpendPreview,
  StartedBacklinkRun,
  StartedLinkGapRun,
  DisavowSelection,
  StartedToxicityRun,
  ToxicityBand,
  ToxicityRunDetail,
  ToxicityRunsPage,
  ToxicityRunStatus,
} from './types';

/**
 * Cache-only read — the server never spends vendor budget on a GET; `null`
 * means nobody has fetched this domain yet (refresh is the metered path).
 */
export const fetchBacklinkSummary = (
  siteId: string,
  init?: { signal?: AbortSignal },
): Promise<BacklinkSummary | null> => {
  const path = `/sites/${siteId}/backlinks/summary`;
  return init
    ? apiClient<BacklinkSummary | null>(path, init)
    : apiClient<BacklinkSummary | null>(path);
};

/** Manual refresh — POST because it spends vendor budget. */
export const refreshBacklinkSummary = (siteId: string): Promise<BacklinkSummary> =>
  apiClient<BacklinkSummary>(`/sites/${siteId}/backlinks/refresh`, { method: 'POST' });

export interface ListBacklinksArgs {
  siteId: string;
  cursor?: string;
  limit?: number;
}

export const fetchBacklinksList = (
  { siteId, cursor, limit }: ListBacklinksArgs,
  init?: { signal?: AbortSignal },
): Promise<BacklinkList> => {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (typeof limit === 'number') params.set('limit', String(limit));
  const qs = params.toString();
  const path = `/sites/${siteId}/backlinks${qs ? `?${qs}` : ''}`;
  return init ? apiClient<BacklinkList>(path, init) : apiClient<BacklinkList>(path);
};

export interface PreviewDeepPullInput {
  type: BacklinkPullType;
  domain?: string;
  limit?: number;
  domains?: string[];
}

export const previewDeepPull = (input: PreviewDeepPullInput): Promise<SpendPreview> =>
  apiClient<SpendPreview>('/backlinks/deep/preview', {
    method: 'POST',
    body: input,
  });

export interface StartDeepPullInput {
  type: BacklinkPullType;
  siteId: string;
  limit?: number;
  domains?: string[];
}

const DEEP_PULL_PATHS: Record<BacklinkPullType, string> = {
  refDomains: 'referring-domains',
  anchors: 'anchors',
  history: 'history',
  bulkRanks: 'bulk-ranks',
};

export const startDeepPull = ({ type, siteId, limit, domains }: StartDeepPullInput) =>
  apiClient<StartedBacklinkRun>(`/backlinks/deep/${DEEP_PULL_PATHS[type]}`, {
    method: 'POST',
    body: {
      siteId,
      ...(typeof limit === 'number' ? { limit } : {}),
      ...(domains ? { domains } : {}),
    },
  });

export const fetchBacklinkRuns = (
  siteId: string,
  type: BacklinkPullType,
  init?: { signal?: AbortSignal },
): Promise<BacklinkRunsPage> => {
  const params = new URLSearchParams({ siteId, type, limit: '1' });
  const path = `/backlinks/runs?${params.toString()}`;
  return init ? apiClient<BacklinkRunsPage>(path, init) : apiClient<BacklinkRunsPage>(path);
};

export const fetchBacklinkRun = (
  runId: string,
  init?: { signal?: AbortSignal },
): Promise<BacklinkRun> => {
  const path = `/backlinks/runs/${encodeURIComponent(runId)}`;
  return init ? apiClient<BacklinkRun>(path, init) : apiClient<BacklinkRun>(path);
};

export interface PreviewLinkGapInput {
  ownDomain: string;
  competitors: string[];
}

export const previewLinkGap = (input: PreviewLinkGapInput): Promise<SpendPreview> =>
  apiClient<SpendPreview>('/backlinks/gap/preview', {
    method: 'POST',
    body: input,
  });

export interface StartLinkGapInput {
  siteId: string;
  competitors: string[];
}

export const startLinkGap = (input: StartLinkGapInput): Promise<StartedLinkGapRun> =>
  apiClient<StartedLinkGapRun>('/backlinks/gap', {
    method: 'POST',
    body: input,
  });

export const fetchLinkGapRun = (
  runId: string,
  init?: { signal?: AbortSignal },
): Promise<LinkGapRun> => {
  const path = `/backlinks/gap/${encodeURIComponent(runId)}`;
  return init ? apiClient<LinkGapRun>(path, init) : apiClient<LinkGapRun>(path);
};

export const previewToxicityReview = (siteId: string): Promise<SpendPreview> =>
  apiClient<SpendPreview>('/backlinks/toxicity/preview', {
    method: 'POST',
    body: { siteId },
  });

export const startToxicityReview = (
  siteId: string,
  locale: string,
): Promise<StartedToxicityRun> =>
  apiClient<StartedToxicityRun>('/backlinks/toxicity', {
    method: 'POST',
    body: { siteId, locale },
  });

export const fetchToxicityRuns = (
  siteId: string,
  status?: ToxicityRunStatus,
  init?: { signal?: AbortSignal },
): Promise<ToxicityRunsPage> => {
  const params = new URLSearchParams({ siteId, limit: '20' });
  if (status) params.set('status', status);
  const path = `/backlinks/toxicity?${params.toString()}`;
  return init
    ? apiClient<ToxicityRunsPage>(path, init)
    : apiClient<ToxicityRunsPage>(path);
};

export const fetchToxicityReview = (
  runId: string,
  band?: ToxicityBand,
  init?: { signal?: AbortSignal },
): Promise<ToxicityRunDetail> => {
  const params = new URLSearchParams();
  if (band) params.set('band', band);
  const query = params.toString();
  const path = `/backlinks/toxicity/${encodeURIComponent(runId)}${query ? `?${query}` : ''}`;
  return init
    ? apiClient<ToxicityRunDetail>(path, init)
    : apiClient<ToxicityRunDetail>(path);
};

export const downloadToxicityDisavow = (
  runId: string,
  entries: DisavowSelection[],
): Promise<string> =>
  apiClient<string>(`/backlinks/toxicity/${encodeURIComponent(runId)}/disavow`, {
    method: 'POST',
    localeMode: 'artifact',
    allowLegacyNullContentLanguage: true,
    headers: { Accept: 'text/plain' },
    body: { entries },
  });
