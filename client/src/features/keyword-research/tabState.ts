/**
 * URL query grammar for the keyword-intelligence workspace.
 *
 * The `?tab=` union lives ONLY on the standalone `/keyword-research` route —
 * the site-workspace embed keeps the plain research panel because `?tab=`
 * there is owned by `SITE_TABS` (documented rejected alternative in the spec).
 *
 * Per-view params (clone of the audience-research pattern — read-modify-write
 * over the CURRENT URLSearchParams, defaults removed from the URL,
 * `replace: true` on every write so unrelated params always survive):
 *   - gap view:      `pair` (competitor domain), `gapFilter` (all|missing|behind),
 *                    `q` (bounded text filter)
 *   - clusters view: `run` (64-hex run id), `decision` (all|pending|accepted|dismissed)
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTabParam } from '@shared/hooks/useTabParam';

/**
 * `live-trends` is a sibling of the Labs `trends` tab,
 * NOT a replacement: `trends` is the historical-volume surface metered against
 * `keyword_lookups`, `live-trends` is the live search-interest surface metered
 * against `trend_explorations`. The two are labelled "Historical volume" and
 * "Live search interest" so the distinction is visible, not inferred.
 */
export const WORKSPACE_TABS = [
  'research',
  'gap',
  'trends',
  'live-trends',
  'clusters',
] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];
export const DEFAULT_WORKSPACE_TAB: WorkspaceTab = 'research';

export function isWorkspaceTab(value: unknown): value is WorkspaceTab {
  return (
    typeof value === 'string' &&
    (WORKSPACE_TABS as readonly string[]).includes(value)
  );
}

/** `?tab=` per `.claude/rules/url-tab-state.md` — default research. */
export function useWorkspaceTab(): [WorkspaceTab, (tab: WorkspaceTab) => void] {
  return useTabParam<WorkspaceTab>(DEFAULT_WORKSPACE_TAB, WORKSPACE_TABS);
}

export const GAP_ROW_FILTERS = ['all', 'missing', 'behind'] as const;
export type GapRowFilter = (typeof GAP_ROW_FILTERS)[number];
export const DEFAULT_GAP_ROW_FILTER: GapRowFilter = 'all';

export function isGapRowFilter(value: unknown): value is GapRowFilter {
  return (
    typeof value === 'string' &&
    (GAP_ROW_FILTERS as readonly string[]).includes(value)
  );
}

export const CLUSTER_DECISION_FILTERS = [
  'all',
  'pending',
  'accepted',
  'dismissed',
] as const;
export type ClusterDecisionFilter = (typeof CLUSTER_DECISION_FILTERS)[number];
export const DEFAULT_CLUSTER_DECISION_FILTER: ClusterDecisionFilter = 'all';

// ---------------------------------------------------------------------------
// Live Keyword Trends URL grammar.
// Keys: `keywords` (comma-joined lowercased phrases, deduped, ≤5, clamped
// to the phrase length ceiling), `geo` (2..16 chars, lowercased), `language`
// (2..10 chars, lowercased). Missing/invalid values fall back silently.
// ---------------------------------------------------------------------------

export const LIVE_TRENDS_MAX_KEYWORDS = 5;
const LIVE_TRENDS_MAX_PHRASE_LENGTH = 200;
const LIVE_TRENDS_GEO_RE = /^[a-z0-9-]{2,16}$/;
const LIVE_TRENDS_LANG_RE = /^[a-z]{2}(-[a-z]{2,3})?$/;

/**
 * Stored-exploration history filter. URL-backed so a filtered history view is
 * shareable and survives refresh (url-tab-state rule). Reopening a stored run
 * is FREE, so filtering never touches the metered surface.
 */
export const LIVE_TRENDS_HISTORY_FILTERS = [
  'all',
  'succeeded',
  'failed',
  'refunded',
] as const;
export type LiveTrendsHistoryFilter =
  (typeof LIVE_TRENDS_HISTORY_FILTERS)[number];

export function isLiveTrendsHistoryFilter(
  value: unknown,
): value is LiveTrendsHistoryFilter {
  return (
    typeof value === 'string' &&
    (LIVE_TRENDS_HISTORY_FILTERS as readonly string[]).includes(value)
  );
}

export interface LiveTrendsQueryState {
  keywords: string[];
  geo: string | null;
  language: string | null;
  historyFilter: LiveTrendsHistoryFilter;
}

export function parseLiveTrendsQuery(
  search: URLSearchParams | string,
): LiveTrendsQueryState {
  const params =
    typeof search === 'string' ? new URLSearchParams(search) : search;
  const raw = (params.get('keywords') ?? '').split(',');
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const chunk of raw) {
    const phrase = chunk.trim().toLowerCase();
    if (phrase.length === 0) continue;
    if (phrase.length > LIVE_TRENDS_MAX_PHRASE_LENGTH) continue;
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    keywords.push(phrase);
    if (keywords.length >= LIVE_TRENDS_MAX_KEYWORDS) break;
  }
  const geoRaw = (params.get('geo') ?? '').trim().toLowerCase();
  const langRaw = (params.get('language') ?? '').trim().toLowerCase();
  const historyRaw = (params.get('history') ?? '').trim().toLowerCase();
  return {
    keywords,
    geo: LIVE_TRENDS_GEO_RE.test(geoRaw) ? geoRaw : null,
    language: LIVE_TRENDS_LANG_RE.test(langRaw) ? langRaw : null,
    historyFilter: isLiveTrendsHistoryFilter(historyRaw) ? historyRaw : 'all',
  };
}

export function serializeLiveTrendsQuery(
  current: URLSearchParams,
  patch: Partial<LiveTrendsQueryState>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if ('keywords' in patch) {
    if (!patch.keywords || patch.keywords.length === 0) {
      next.delete('keywords');
    } else {
      next.set('keywords', patch.keywords.join(','));
    }
  }
  if ('geo' in patch) {
    if (!patch.geo) next.delete('geo');
    else next.set('geo', patch.geo);
  }
  if ('language' in patch) {
    if (!patch.language) next.delete('language');
    else next.set('language', patch.language);
  }
  if ('historyFilter' in patch) {
    if (!patch.historyFilter || patch.historyFilter === 'all') {
      next.delete('history');
    } else {
      next.set('history', patch.historyFilter);
    }
  }
  return next;
}

export function normalizeLiveTrendsQuery(
  current: URLSearchParams,
): URLSearchParams {
  return serializeLiveTrendsQuery(current, parseLiveTrendsQuery(current));
}

/**
 * URL-authoritative read/write hook for `?keywords=&geo=&language=&history=`.
 * `replace: true` on every write so form typing does not spam browser
 * history; direct-link and refresh restore state (url-tab-state rule).
 */
export function useLiveTrendsQuery(): [
  LiveTrendsQueryState,
  (patch: Partial<LiveTrendsQueryState>) => void,
] {
  const location = useLocation();
  const navigate = useNavigate();
  const state = useMemo(
    () => parseLiveTrendsQuery(location.search),
    [location.search],
  );
  useEffect(() => {
    const current = new URLSearchParams(location.search);
    const normalized = normalizeLiveTrendsQuery(current);
    if (normalized.toString() !== current.toString()) {
      navigate(
        { pathname: location.pathname, search: normalized.toString() },
        { replace: true },
      );
    }
  }, [location.pathname, location.search, navigate]);
  const setState = useCallback(
    (patch: Partial<LiveTrendsQueryState>) => {
      const params = new URLSearchParams(location.search);
      const next = serializeLiveTrendsQuery(params, patch);
      navigate(
        { pathname: location.pathname, search: next.toString() },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );
  return [state, setState];
}

export function isClusterDecisionFilter(
  value: unknown,
): value is ClusterDecisionFilter {
  return (
    typeof value === 'string' &&
    (CLUSTER_DECISION_FILTERS as readonly string[]).includes(value)
  );
}

/** Server run ids are 64 lowercase hex chars (`runIdParamSchema` mirror). */
const RUN_ID_RE = /^[a-f0-9]{64}$/;
/** Pair selection carries a normalized competitor domain. */
const PAIR_RE = /^[a-z0-9]([a-z0-9.-]{1,251})[a-z0-9]$/;
/** Bounded text filter — mirrors the 80-char phrase ceiling. */
const MAX_Q_LENGTH = 80;

export interface KeywordWorkspaceQueryState {
  pair: string | null;
  gapFilter: GapRowFilter;
  q: string;
  run: string | null;
  decision: ClusterDecisionFilter;
}

/**
 * Parse the current search string into the normalized grammar. Unknown enum
 * values fall back to their documented defaults; malformed/oversized ids and
 * filters fall back to absent. Never throws.
 */
export function parseKeywordWorkspaceQuery(
  search: URLSearchParams | string,
): KeywordWorkspaceQueryState {
  const params =
    typeof search === 'string' ? new URLSearchParams(search) : search;
  const pairRaw = (params.get('pair') ?? '').toLowerCase();
  const gapFilter = params.get('gapFilter');
  const qRaw = params.get('q') ?? '';
  const runRaw = params.get('run') ?? '';
  const decision = params.get('decision');
  return {
    pair: PAIR_RE.test(pairRaw) ? pairRaw : null,
    gapFilter: isGapRowFilter(gapFilter) ? gapFilter : DEFAULT_GAP_ROW_FILTER,
    q: qRaw.length > MAX_Q_LENGTH ? '' : qRaw,
    run: RUN_ID_RE.test(runRaw) ? runRaw : null,
    decision: isClusterDecisionFilter(decision)
      ? decision
      : DEFAULT_CLUSTER_DECISION_FILTER,
  };
}

const DEFAULTS: Record<keyof KeywordWorkspaceQueryState, string | null> = {
  pair: null,
  gapFilter: DEFAULT_GAP_ROW_FILTER,
  q: '',
  run: null,
  decision: DEFAULT_CLUSTER_DECISION_FILTER,
};

/**
 * Apply a partial patch onto the CURRENT params (read-modify-write). A key
 * set to `null`/its default is removed entirely so URLs stay canonical and
 * unrelated params (`?tab=`, prefill `?location=`, …) survive untouched.
 */
export function serializeKeywordWorkspaceQuery(
  current: URLSearchParams,
  patch: Partial<KeywordWorkspaceQueryState>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of Object.keys(patch) as (keyof KeywordWorkspaceQueryState)[]) {
    const value = patch[key];
    if (value === null || value === undefined || value === DEFAULTS[key]) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }
  return next;
}

/**
 * URL-authoritative read/write hook for the per-view grammar. `replace: true`
 * on every write (url-tab-state convention) so filter interaction does not
 * pollute browser history; back/forward still restores route-level entries.
 */
export function useKeywordWorkspaceQuery(): [
  KeywordWorkspaceQueryState,
  (patch: Partial<KeywordWorkspaceQueryState>) => void,
] {
  const location = useLocation();
  const navigate = useNavigate();

  const state = useMemo(
    () => parseKeywordWorkspaceQuery(location.search),
    [location.search],
  );

  const setState = useCallback(
    (patch: Partial<KeywordWorkspaceQueryState>) => {
      const params = new URLSearchParams(location.search);
      const next = serializeKeywordWorkspaceQuery(params, patch);
      navigate(
        { pathname: location.pathname, search: next.toString() },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  return [state, setState];
}
