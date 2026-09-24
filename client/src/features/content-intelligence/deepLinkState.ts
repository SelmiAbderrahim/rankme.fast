const OBJECT_ID_HEX = /^[0-9a-f]{24}$/;
const LANDSCAPE_REFERENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTENT_SOURCES = ['report', 'keyword', 'gsc', 'competitor'] as const;

const MAX_URL_LENGTH = 2_048;
const MAX_KEYWORD_LENGTH = 200;

function canonicalHttpUrl(raw: string | null, requiredOrigin?: string): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (!value || value.length > MAX_URL_LENGTH) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (requiredOrigin && parsed.origin !== new URL(requiredOrigin).origin) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function canonicalKeyword(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  return value.length > 0 && value.length <= MAX_KEYWORD_LENGTH ? value : null;
}

function canonicalLandscapeId(raw: string | null): string | null {
  return raw !== null && LANDSCAPE_REFERENCE_ID.test(raw) ? raw : null;
}

function replaceOrDelete(
  params: URLSearchParams,
  name: string,
  raw: string | null,
  canonical: string | null,
): void {
  if (raw === null) return;
  if (canonical === null) params.delete(name);
  else if (canonical !== raw) params.set(name, canonical);
}

export interface ContentAnalysisDeepLinkState {
  analysisId: string | null;
  canonicalParams: URLSearchParams;
  prefill?: {
    ownedUrl?: string;
    keyword?: string;
    reviewedCompetitorUrls?: string[];
    reviewedPageMatches?: Array<{
      landscapeReportId: string;
      landscapeOpportunityId?: string;
      suggestionId: string;
    }>;
  };
}

/**
 * Parse and canonicalize every content-analysis URL-state value before React
 * can reflect it. Free-text values are bounded and normalized, enum/identifier
 * values use their server contract shapes, and URLs are restricted to HTTP(S).
 */
export function readContentAnalysisDeepLink(
  current: URLSearchParams,
  siteOrigin?: string,
): ContentAnalysisDeepLinkState {
  const canonicalParams = new URLSearchParams(current);

  const rawAnalysisId = current.get('analysis');
  const analysisId = rawAnalysisId !== null && OBJECT_ID_HEX.test(rawAnalysisId)
    ? rawAnalysisId
    : null;
  replaceOrDelete(canonicalParams, 'analysis', rawAnalysisId, analysisId);

  const rawSource = current.get('source');
  const source = rawSource !== null && (CONTENT_SOURCES as readonly string[]).includes(rawSource)
    ? rawSource
    : null;
  replaceOrDelete(canonicalParams, 'source', rawSource, source);

  const rawOwnedUrl = current.get('prefillUrl');
  const ownedUrl = canonicalHttpUrl(rawOwnedUrl, siteOrigin);
  replaceOrDelete(canonicalParams, 'prefillUrl', rawOwnedUrl, ownedUrl);

  const rawKeyword = current.get('prefillKeyword');
  const keyword = canonicalKeyword(rawKeyword);
  replaceOrDelete(canonicalParams, 'prefillKeyword', rawKeyword, keyword);

  const rawCompetitorUrl = current.get('reviewedCompetitorUrls');
  const competitorUrl = canonicalHttpUrl(rawCompetitorUrl);
  replaceOrDelete(
    canonicalParams,
    'reviewedCompetitorUrls',
    rawCompetitorUrl,
    competitorUrl,
  );

  const rawReportId = current.get('landscapeReport');
  const reportId = rawReportId !== null && OBJECT_ID_HEX.test(rawReportId)
    ? rawReportId
    : null;
  replaceOrDelete(canonicalParams, 'landscapeReport', rawReportId, reportId);

  const rawMatchId = current.get('match');
  const matchId = canonicalLandscapeId(rawMatchId);
  replaceOrDelete(canonicalParams, 'match', rawMatchId, matchId);

  const rawOpportunityId = current.get('opportunity');
  const opportunityId = canonicalLandscapeId(rawOpportunityId);
  replaceOrDelete(canonicalParams, 'opportunity', rawOpportunityId, opportunityId);

  if (!reportId || !matchId) {
    canonicalParams.delete('landscapeReport');
    canonicalParams.delete('match');
    canonicalParams.delete('opportunity');
  }

  const hasPrefill = ownedUrl !== null || keyword !== null;
  if (!hasPrefill) {
    canonicalParams.delete('reviewedCompetitorUrls');
    canonicalParams.delete('landscapeReport');
    canonicalParams.delete('match');
    canonicalParams.delete('opportunity');
  }

  return {
    analysisId,
    canonicalParams,
    ...(hasPrefill
      ? {
          prefill: {
            ...(ownedUrl !== null ? { ownedUrl } : {}),
            ...(keyword !== null ? { keyword } : {}),
            ...(competitorUrl !== null ? { reviewedCompetitorUrls: [competitorUrl] } : {}),
            ...(reportId !== null && matchId !== null
              ? {
                  reviewedPageMatches: [{
                    landscapeReportId: reportId,
                    ...(opportunityId !== null
                      ? { landscapeOpportunityId: opportunityId }
                      : {}),
                    suggestionId: matchId,
                  }],
                }
              : {}),
          },
        }
      : {}),
  };
}
