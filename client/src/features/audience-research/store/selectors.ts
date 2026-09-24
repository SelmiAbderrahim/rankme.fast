import type { RootState } from '@app/store';
import { initialState, type AudienceResearchState } from './slice';

type AudienceResearchRootState =
  | RootState
  | { audienceResearch?: AudienceResearchState };

/**
 * Falls back to `initialState` when the lazily-injected slice has not been
 * mounted yet (e.g. a selector read before `AudienceResearchPanel` injects
 * the reducer) — see the `lazy-slice-eager-reader` pattern used by every
 * other lazily-injected feature slice.
 */
function slice(state: AudienceResearchRootState): AudienceResearchState {
  if ('audienceResearch' in state && state.audienceResearch) {
    return state.audienceResearch;
  }
  return initialState;
}

export function selectAudienceResearchSiteId(state: AudienceResearchRootState) {
  return slice(state).siteId;
}

export function selectRuns(state: AudienceResearchRootState) {
  const s = slice(state);
  return s.listIds.map((id) => s.runsById[id]).filter((r): r is NonNullable<typeof r> => Boolean(r));
}

export function selectRunById(runId: string | null | undefined) {
  return (state: AudienceResearchRootState) => {
    if (!runId) return undefined;
    return slice(state).runsById[runId];
  };
}

export function selectRunResultById(runId: string | null | undefined) {
  return (state: AudienceResearchRootState) => {
    if (!runId) return undefined;
    return slice(state).runResultsById[runId];
  };
}

export function selectListLoading(state: AudienceResearchRootState) {
  return slice(state).listLoading;
}

export function selectListLoaded(state: AudienceResearchRootState) {
  return slice(state).listLoaded;
}

export function selectListError(state: AudienceResearchRootState) {
  return slice(state).listError;
}

export function selectListCursor(state: AudienceResearchRootState) {
  return slice(state).listCursor;
}

export function selectListCanGoPrev(state: AudienceResearchRootState) {
  return slice(state).listCursorStack.length > 0;
}

export function selectSelectedRunId(state: AudienceResearchRootState) {
  return slice(state).selectedRunId;
}

export function selectForm(state: AudienceResearchRootState) {
  return slice(state).form;
}

export function selectStartStatus(state: AudienceResearchRootState) {
  return slice(state).startStatus;
}

export function selectRunLoading(runId: string | null | undefined) {
  return (state: AudienceResearchRootState) => {
    if (!runId) return false;
    return Boolean(slice(state).runStatus.loading[runId]);
  };
}

export function selectRunError(runId: string | null | undefined) {
  return (state: AudienceResearchRootState) => {
    if (!runId) return '';
    return slice(state).runStatus.error[runId] ?? '';
  };
}

export function selectResultLoading(runId: string | null | undefined) {
  return (state: AudienceResearchRootState) => {
    if (!runId) return false;
    return Boolean(slice(state).resultStatus.loading[runId]);
  };
}

export function selectResultError(runId: string | null | undefined) {
  return (state: AudienceResearchRootState) => {
    if (!runId) return '';
    return slice(state).resultStatus.error[runId] ?? '';
  };
}

export function selectSignalTerminalDecision(signalId: string | null | undefined) {
  return (state: AudienceResearchRootState) => {
    if (!signalId) return undefined;
    return slice(state).decisions.terminal[signalId];
  };
}

export function selectSignalDecisionPending(signalId: string | null | undefined) {
  return (state: AudienceResearchRootState) => {
    if (!signalId) return undefined;
    return slice(state).decisions.pending[signalId];
  };
}

/**
 * True only while a decideSignal request is actually on the wire. Distinct
 * from `selectSignalDecisionPending`, which returns the RESERVED idempotency
 * key record that exists from the moment a decision dialog opens.
 */
export function selectSignalDecisionInFlight(signalId: string | null | undefined) {
  return (state: AudienceResearchRootState) => {
    if (!signalId) return false;
    // Optional-chained: state snapshots seeded before the `inFlight` map
    // existed (tests, persisted fixtures) must read as "not submitting".
    return Boolean(slice(state).decisions.inFlight?.[signalId]);
  };
}

export function selectSignalDecisionError(signalId: string | null | undefined) {
  return (state: AudienceResearchRootState) => {
    if (!signalId) return '';
    return slice(state).decisions.error[signalId] ?? '';
  };
}

export function selectSignalDecisionConflict(signalId: string | null | undefined) {
  return (state: AudienceResearchRootState) => {
    if (!signalId) return false;
    return Boolean(slice(state).decisions.conflict[signalId]);
  };
}
