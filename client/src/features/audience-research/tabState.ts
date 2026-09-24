/**
 * URL query grammar for the Audience Research workspace.
 *
 * `run`/`signal` are free-form ids (or absent); the remaining four params are
 * closed enums that normalize to `all` on any unrecognized value. Unrelated
 * query params (notably the outer site-workspace `?tab=`) are always
 * preserved — every write here is a read-modify-write over the CURRENT
 * `URLSearchParams`, never a full replace.
 *
 * The server pagination cursor is intentionally NOT persisted in the URL
 * (matches the Content Intelligence / AI Visibility pattern —
 * records this choice explicitly).
 */
import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  AudienceResearchConfidence,
  AudienceResearchSignalType,
  AudienceResearchSourceType,
} from './types';

export const SIGNAL_TYPE_FILTERS = [
  'all',
  'complaint',
  'request',
  'question',
  'competitor_gap',
] as const satisfies readonly ('all' | AudienceResearchSignalType)[];
export type SignalTypeFilter = (typeof SIGNAL_TYPE_FILTERS)[number];

export const CONFIDENCE_FILTERS = [
  'all',
  'high',
  'medium',
  'low',
] as const satisfies readonly ('all' | AudienceResearchConfidence)[];
export type ConfidenceFilter = (typeof CONFIDENCE_FILTERS)[number];

export const SOURCE_TYPE_FILTERS = [
  'all',
  'forum',
  'review',
  'comparison',
  'question',
  'other',
] as const satisfies readonly ('all' | AudienceResearchSourceType)[];
export type SourceTypeFilter = (typeof SOURCE_TYPE_FILTERS)[number];

export const DECISION_FILTERS = ['all', 'pending', 'accepted', 'dismissed'] as const;
export type DecisionFilter = (typeof DECISION_FILTERS)[number];

export const DEFAULT_SIGNAL_TYPE_FILTER: SignalTypeFilter = 'all';
export const DEFAULT_CONFIDENCE_FILTER: ConfidenceFilter = 'all';
export const DEFAULT_SOURCE_TYPE_FILTER: SourceTypeFilter = 'all';
export const DEFAULT_DECISION_FILTER: DecisionFilter = 'all';

export interface AudienceResearchQueryState {
  run: string | null;
  signal: string | null;
  signalType: SignalTypeFilter;
  confidence: ConfidenceFilter;
  sourceType: SourceTypeFilter;
  decision: DecisionFilter;
}

export function isSignalTypeFilter(value: unknown): value is SignalTypeFilter {
  return typeof value === 'string' && (SIGNAL_TYPE_FILTERS as readonly string[]).includes(value);
}

export function isConfidenceFilter(value: unknown): value is ConfidenceFilter {
  return typeof value === 'string' && (CONFIDENCE_FILTERS as readonly string[]).includes(value);
}

export function isSourceTypeFilter(value: unknown): value is SourceTypeFilter {
  return typeof value === 'string' && (SOURCE_TYPE_FILTERS as readonly string[]).includes(value);
}

export function isDecisionFilter(value: unknown): value is DecisionFilter {
  return typeof value === 'string' && (DECISION_FILTERS as readonly string[]).includes(value);
}

const RUN_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const SIGNAL_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

function normalizeId(value: string | null, pattern: RegExp): string | null {
  if (!value) return null;
  return pattern.test(value) ? value : null;
}

/**
 * Parse `location.search` (or a raw string) into the normalized grammar.
 * Unrecognized enum values fall back to `all`; malformed/oversized ids fall
 * back to absent. Never throws.
 */
export function parseAudienceResearchQuery(
  search: URLSearchParams | string,
): AudienceResearchQueryState {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const signalType = params.get('signalType');
  const confidence = params.get('confidence');
  const sourceType = params.get('sourceType');
  const decision = params.get('decision');
  return {
    run: normalizeId(params.get('run'), RUN_ID_RE),
    signal: normalizeId(params.get('signal'), SIGNAL_ID_RE),
    signalType: isSignalTypeFilter(signalType) ? signalType : DEFAULT_SIGNAL_TYPE_FILTER,
    confidence: isConfidenceFilter(confidence) ? confidence : DEFAULT_CONFIDENCE_FILTER,
    sourceType: isSourceTypeFilter(sourceType) ? sourceType : DEFAULT_SOURCE_TYPE_FILTER,
    decision: isDecisionFilter(decision) ? decision : DEFAULT_DECISION_FILTER,
  };
}

const DEFAULTS: Record<keyof AudienceResearchQueryState, string | null> = {
  run: null,
  signal: null,
  signalType: DEFAULT_SIGNAL_TYPE_FILTER,
  confidence: DEFAULT_CONFIDENCE_FILTER,
  sourceType: DEFAULT_SOURCE_TYPE_FILTER,
  decision: DEFAULT_DECISION_FILTER,
};

/**
 * Apply a partial patch onto the CURRENT `URLSearchParams` (read-modify-write)
 * so every unrelated param — `?tab=audience-research`, or anything else —
 * survives untouched. A key set to `null` (or its documented default) is
 * removed from the query string entirely rather than written as the literal
 * default value, keeping URLs short and canonical.
 */
export function serializeAudienceResearchQuery(
  current: URLSearchParams,
  patch: Partial<AudienceResearchQueryState>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of Object.keys(patch) as (keyof AudienceResearchQueryState)[]) {
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
 * URL-authoritative read/write hook for the workspace grammar. `replace:
 * true` on every write (tab-state convention) so filter/drawer interaction
 * does not pollute browser history; back/forward still restores prior
 * selections because each distinct `navigate` with `replace: true` still
 * replaces the CURRENT history entry, and the browser's own back/forward
 * mechanism moves across whatever entries exist further up the stack
 * (route navigations, tab switches) — this hook never calls
 * `history.pushState`.
 */
export function useAudienceResearchQuery(): [
  AudienceResearchQueryState,
  (patch: Partial<AudienceResearchQueryState>) => void,
] {
  const location = useLocation();
  const navigate = useNavigate();

  const state = useMemo(
    () => parseAudienceResearchQuery(location.search),
    [location.search],
  );

  const setState = useCallback(
    (patch: Partial<AudienceResearchQueryState>) => {
      const params = new URLSearchParams(location.search);
      const next = serializeAudienceResearchQuery(params, patch);
      navigate(
        { pathname: location.pathname, search: next.toString() },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  return [state, setState];
}

/** Convenience — closing the evidence drawer removes ONLY `signal`. */
export function closeSignalDrawer(current: URLSearchParams): URLSearchParams {
  return serializeAudienceResearchQuery(current, { signal: null });
}
