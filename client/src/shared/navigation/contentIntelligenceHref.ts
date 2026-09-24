export interface ContentAnalysisPrefill {
  siteId: string;
  ownedUrl?: string | undefined;
  keyword?: string | undefined;
  source?: 'report' | 'keyword' | 'gsc' | 'competitor' | undefined;
}

/** Build a validated, context-preserving Content Intelligence deep link. */
export function contentAnalysisHref(input: ContentAnalysisPrefill): string {
  const params = new URLSearchParams({ tab: 'content', view: 'analyses' });
  if (input.ownedUrl) params.set('prefillUrl', input.ownedUrl);
  if (input.keyword) params.set('prefillKeyword', input.keyword);
  if (input.source) params.set('source', input.source);
  return `/sites/${encodeURIComponent(input.siteId)}?${params.toString()}`;
}
