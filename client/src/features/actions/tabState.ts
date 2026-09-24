/**
 * URL query grammar for the Next Actions workspace (locked
 * contract).
 *
 * `?tab=actions` (owned by the site workspace) is the only tab authority.
 * This module owns the five optional filters — `state`, `source`,
 * `severity`, `confidence`, `effort` — plus the optional pagination
 * `cursor`. Rules, verbatim from the locked contract:
 *
 *   - invalid values are removed/replaced with defaults;
 *   - any filter change clears `cursor`;
 *   - unrelated parameters (`?tab=` above all) are preserved — every write
 *     is a read-modify-write over the CURRENT `URLSearchParams`;
 *   - writes use `replace: true` (tab-state convention) so filter clicks
 *     never pollute browser history.
 */
import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { safeInternalHref as validateInternalHref } from '@shared/utils/internalHref';
import {
  ACTION_CONFIDENCES,
  ACTION_EFFORTS,
  ACTION_SEVERITIES,
  ACTION_SOURCE_TYPES,
  ACTION_STATES,
  type ActionConfidence,
  type ActionEffort,
  type ActionSeverity,
  type ActionSourceType,
  type ActionState,
} from './types';

export const ACTIONS_STATE_FILTERS = ['all', ...ACTION_STATES] as const;
export type ActionsStateFilter = 'all' | ActionState;

export const ACTIONS_SOURCE_FILTERS = ['all', ...ACTION_SOURCE_TYPES] as const;
export type ActionsSourceFilter = 'all' | ActionSourceType;

export const ACTIONS_SEVERITY_FILTERS = ['all', ...ACTION_SEVERITIES] as const;
export type ActionsSeverityFilter = 'all' | ActionSeverity;

export const ACTIONS_CONFIDENCE_FILTERS = ['all', ...ACTION_CONFIDENCES] as const;
export type ActionsConfidenceFilter = 'all' | ActionConfidence;

export const ACTIONS_EFFORT_FILTERS = ['all', ...ACTION_EFFORTS] as const;
export type ActionsEffortFilter = 'all' | ActionEffort;

export interface ActionsQueryState {
  state: ActionsStateFilter;
  source: ActionsSourceFilter;
  severity: ActionsSeverityFilter;
  confidence: ActionsConfidenceFilter;
  effort: ActionsEffortFilter;
  cursor: string | null;
}

export const ACTIONS_FILTER_KEYS = [
  'state',
  'source',
  'severity',
  'confidence',
  'effort',
] as const;
export type ActionsFilterKey = (typeof ACTIONS_FILTER_KEYS)[number];

export const DEFAULT_ACTIONS_QUERY: ActionsQueryState = {
  state: 'all',
  source: 'all',
  severity: 'all',
  confidence: 'all',
  effort: 'all',
  cursor: null,
};

function inList(value: string | null, allowed: readonly string[]): boolean {
  return value !== null && allowed.includes(value);
}

/** Server cursor: opaque, bounded (the API caps it at 200 chars). */
const CURSOR_RE = /^[A-Za-z0-9_.:+/=-]{1,200}$/;

function normalizeCursor(value: string | null): string | null {
  if (!value) return null;
  return CURSOR_RE.test(value) ? value : null;
}

/**
 * Parse `location.search` (or a raw string) into the normalized grammar.
 * Unrecognized enum values fall back to `all`; malformed/oversized cursors
 * fall back to absent. Never throws.
 */
export function parseActionsQuery(
  search: URLSearchParams | string,
): ActionsQueryState {
  const params =
    typeof search === 'string' ? new URLSearchParams(search) : search;
  const state = params.get('state');
  const source = params.get('source');
  const severity = params.get('severity');
  const confidence = params.get('confidence');
  const effort = params.get('effort');
  return {
    state: inList(state, ACTIONS_STATE_FILTERS)
      ? (state as ActionsStateFilter)
      : 'all',
    source: inList(source, ACTIONS_SOURCE_FILTERS)
      ? (source as ActionsSourceFilter)
      : 'all',
    severity: inList(severity, ACTIONS_SEVERITY_FILTERS)
      ? (severity as ActionsSeverityFilter)
      : 'all',
    confidence: inList(confidence, ACTIONS_CONFIDENCE_FILTERS)
      ? (confidence as ActionsConfidenceFilter)
      : 'all',
    effort: inList(effort, ACTIONS_EFFORT_FILTERS)
      ? (effort as ActionsEffortFilter)
      : 'all',
    cursor: normalizeCursor(params.get('cursor')),
  };
}

/**
 * Apply a partial patch onto the CURRENT `URLSearchParams`
 * (read-modify-write) so unrelated params — `?tab=actions` above all —
 * survive untouched. Defaults (`all` / absent cursor) are removed from the
 * URL rather than written literally, keeping URLs short and canonical.
 *
 * Locked rule: touching ANY filter key clears `cursor`, unless the patch
 * itself sets a cursor explicitly (a pure pagination write).
 */
export function serializeActionsQuery(
  current: URLSearchParams,
  patch: Partial<ActionsQueryState>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  const touchesFilter = ACTIONS_FILTER_KEYS.some((key) => key in patch);
  for (const key of ACTIONS_FILTER_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined || value === null || value === 'all') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }
  if ('cursor' in patch) {
    const cursor = normalizeCursor(patch.cursor ?? null);
    if (cursor === null) next.delete('cursor');
    else next.set('cursor', cursor);
  } else if (touchesFilter) {
    next.delete('cursor');
  }
  return next;
}

/**
 * URL-authoritative read/write hook for the workspace grammar. `replace:
 * true` on every write so filter/pagination interaction never pushes
 * history entries; browser back/forward still moves across real route
 * navigations further up the stack.
 */
export function useActionsQuery(): [
  ActionsQueryState,
  (patch: Partial<ActionsQueryState>) => void,
] {
  const location = useLocation();
  const navigate = useNavigate();

  const state = useMemo(
    () => parseActionsQuery(location.search),
    [location.search],
  );

  const setState = useCallback(
    (patch: Partial<ActionsQueryState>) => {
      const params = new URLSearchParams(location.search);
      const next = serializeActionsQuery(params, patch);
      navigate(
        { pathname: location.pathname, search: next.toString() },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  return [state, setState];
}

/**
 * Client-side revalidation of the server's allowlisted internal
 * `sourceLink` (locked contract: internal links come from the server and
 * are revalidated client-side). Only a relative path starting with a single
 * `/` is renderable — `//host` (protocol-relative), backslashes, whitespace
 * and control characters are rejected. Returns `null` when unrenderable.
 */
export function safeInternalHref(value: string): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return null;
  }
  if (/\s/.test(value)) return null;
  if (
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    })
  ) {
    return null;
  }
  return validateInternalHref(value);
}

/**
 * Shared monotonic request sequence for `loadActions` dispatches. Every
 * surface (Actions panel, Overview top-five, report finding controls) draws
 * from the same counter so the slice's stale-fulfillment guard can compare
 * sequences across surfaces.
 */
let requestSeq = 0;
export function nextActionsRequestSeq(): number {
  requestSeq += 1;
  return requestSeq;
}
