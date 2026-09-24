import { apiClient } from '@shared/api/client';
import type { SupportedLocale } from '@shared/i18n';
import type {
  KeywordClusterPreview,
  KeywordClusterRunDetail,
  KeywordClusterRunSummary,
  KeywordClusterSelectableKeyword,
} from './types';

interface KeywordPage {
  keywords: Array<{
    id: string;
    phrase: string;
    active: boolean;
    engine: string;
  }>;
  nextCursor: string | null;
}

const MAX_CLUSTER_KEYWORDS = 200;

export const previewKeywordClusterRun = (
  siteId: string,
  keywordIds: readonly string[],
): Promise<KeywordClusterPreview> =>
  apiClient<KeywordClusterPreview>(
    `/sites/${siteId}/keyword-cluster-runs/preview`,
    { method: 'POST', body: { keywordIds } },
  );

export const startKeywordClusterRun = (
  siteId: string,
  locale: SupportedLocale,
  keywordIds: readonly string[],
): Promise<KeywordClusterRunDetail> =>
  apiClient<KeywordClusterRunDetail>(`/sites/${siteId}/keyword-cluster-runs`, {
    method: 'POST',
    body: { locale, keywordIds },
  });

/** Load the bounded Google-keyword scope used by the explicit run picker. */
export async function fetchKeywordClusterKeywords(
  siteId: string,
  signal?: AbortSignal,
): Promise<KeywordClusterSelectableKeyword[]> {
  const selected: KeywordClusterSelectableKeyword[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const page: KeywordPage = await apiClient<KeywordPage>(
      `/sites/${siteId}/keywords${query}`,
      signal ? { signal } : {},
    );
    for (const keyword of page.keywords) {
      if (keyword.active && keyword.engine === 'google') {
        selected.push({ id: keyword.id, phrase: keyword.phrase });
        if (selected.length === MAX_CLUSTER_KEYWORDS) return selected;
      }
    }
    cursor = page.nextCursor;
  } while (cursor);
  return selected;
}

export const fetchKeywordClusterRuns = (
  siteId: string,
  signal?: AbortSignal,
): Promise<{ items: KeywordClusterRunSummary[] }> =>
  apiClient<{ items: KeywordClusterRunSummary[] }>(
    `/sites/${siteId}/keyword-cluster-runs`,
    signal ? { signal } : {},
  );

export const fetchKeywordClusterRun = (
  runId: string,
  signal?: AbortSignal,
): Promise<KeywordClusterRunDetail> =>
  apiClient<KeywordClusterRunDetail>(
    `/keyword-cluster-runs/${runId}`,
    signal ? { signal } : {},
  );
