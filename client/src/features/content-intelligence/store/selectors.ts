import type { RootState } from '@app/store';
import { initialState, type ContentIntelligenceState } from './slice';

type ContentIntelligenceRootState = RootState | {
  contentIntelligence?: ContentIntelligenceState;
};

function slice(state: ContentIntelligenceRootState): ContentIntelligenceState {
  if ('contentIntelligence' in state && state.contentIntelligence) {
    return state.contentIntelligence;
  }
  return initialState;
}

export function selectAnalyses(state: ContentIntelligenceRootState) {
  return slice(state).analyses;
}

export function selectAnalysesNextCursor(state: ContentIntelligenceRootState) {
  return slice(state).nextCursor;
}

export function selectListLoading(state: ContentIntelligenceRootState) {
  return slice(state).listLoading;
}

export function selectListLoaded(state: ContentIntelligenceRootState) {
  return slice(state).listLoaded;
}

export function selectListError(state: ContentIntelligenceRootState) {
  return slice(state).listError;
}

export function selectAnalysisSiteId(state: ContentIntelligenceRootState) {
  return slice(state).siteId;
}

export function selectAnalysisById(siteId: string, id: string | null | undefined) {
  return (state: ContentIntelligenceRootState) => {
    if (!id) return undefined;
    const current = slice(state);
    if (current.siteId !== siteId) return undefined;
    const analysis = current.detail[id];
    return analysis?.siteId === siteId ? analysis : undefined;
  };
}

export function selectDetailLoading(siteId: string, id: string | null | undefined) {
  return (state: ContentIntelligenceRootState) => {
    if (!id) return false;
    const current = slice(state);
    return current.siteId === siteId && Boolean(current.detailLoading[id]);
  };
}

export function selectDetailError(siteId: string, id: string | null | undefined) {
  return (state: ContentIntelligenceRootState) => {
    if (!id) return '';
    const current = slice(state);
    return current.siteId === siteId ? (current.detailError[id] ?? '') : '';
  };
}

export function selectSubmitting(state: ContentIntelligenceRootState) {
  return slice(state).submitting;
}

export function selectSubmitError(state: ContentIntelligenceRootState) {
  return slice(state).submitError;
}

export function selectLastStartedId(state: ContentIntelligenceRootState) {
  return slice(state).lastStartedId;
}

export function selectFormDraft(state: ContentIntelligenceRootState) {
  return slice(state).formDraft;
}

export function selectCancelling(id: string) {
  return (state: ContentIntelligenceRootState) => Boolean(slice(state).cancelling[id]);
}

export function selectRegenerating(id: string) {
  return (state: ContentIntelligenceRootState) => Boolean(slice(state).regenerating[id]);
}

// ---------------------------------------------------------------------------
// Content Inventory selectors.
// ---------------------------------------------------------------------------

export function selectInventoryRuns(state: ContentIntelligenceRootState) {
  return slice(state).inventory.runs;
}

export function selectInventoryNextCursor(state: ContentIntelligenceRootState) {
  return slice(state).inventory.nextCursor;
}

export function selectInventoryListLoading(state: ContentIntelligenceRootState) {
  return slice(state).inventory.listLoading;
}

export function selectInventoryListLoaded(state: ContentIntelligenceRootState) {
  return slice(state).inventory.listLoaded;
}

export function selectInventoryListError(state: ContentIntelligenceRootState) {
  return slice(state).inventory.listError;
}

export function selectInventoryRunById(id: string | null | undefined) {
  return (state: ContentIntelligenceRootState) => {
    if (!id) return undefined;
    return slice(state).inventory.detail[id];
  };
}

export function selectInventoryDetailLoading(id: string | null | undefined) {
  return (state: ContentIntelligenceRootState) => {
    if (!id) return false;
    return Boolean(slice(state).inventory.detailLoading[id]);
  };
}

export function selectInventoryDetailError(id: string | null | undefined) {
  return (state: ContentIntelligenceRootState) => {
    if (!id) return '';
    return slice(state).inventory.detailError[id] ?? '';
  };
}

export function selectInventorySubmitting(state: ContentIntelligenceRootState) {
  return slice(state).inventory.submitting;
}

export function selectInventorySubmitError(state: ContentIntelligenceRootState) {
  return slice(state).inventory.submitError;
}

export function selectInventoryLastStartedRunId(state: ContentIntelligenceRootState) {
  return slice(state).inventory.lastStartedRunId;
}

export function selectInventoryCancelling(id: string) {
  return (state: ContentIntelligenceRootState) =>
    Boolean(slice(state).inventory.cancelling[id]);
}

// ---------------------------------------------------------------------------
// Competitor content intelligence selectors.
// ---------------------------------------------------------------------------

function cc(state: ContentIntelligenceRootState) {
  return slice(state).competitorContent;
}

export function selectCompetitorProfiles(state: ContentIntelligenceRootState) {
  return cc(state).profiles;
}

export function selectCompetitorProfilesLoading(state: ContentIntelligenceRootState) {
  return cc(state).profilesLoading;
}

export function selectCompetitorProfilesLoaded(state: ContentIntelligenceRootState) {
  return cc(state).profilesLoaded;
}

export function selectCompetitorProfilesError(state: ContentIntelligenceRootState) {
  return cc(state).profilesError;
}

export function selectCompetitorSuggestions(state: ContentIntelligenceRootState) {
  return cc(state).suggestions;
}

export function selectCompetitorSuggestionsLoading(state: ContentIntelligenceRootState) {
  return cc(state).suggestionsLoading;
}

export function selectCompetitorSuggestionsLoaded(state: ContentIntelligenceRootState) {
  return cc(state).suggestionsLoaded;
}

export function selectCompetitorSuggestionsError(state: ContentIntelligenceRootState) {
  return cc(state).suggestionsError;
}

export function selectCompetitorAddingKey(state: ContentIntelligenceRootState) {
  return cc(state).addingKey;
}

export function selectCompetitorAddError(state: ContentIntelligenceRootState) {
  return cc(state).addError;
}

export function selectCompetitorMutating(id: string) {
  return (state: ContentIntelligenceRootState) => Boolean(cc(state).mutatingId[id]);
}

export function selectCompetitorMutateError(state: ContentIntelligenceRootState) {
  return cc(state).mutateError;
}

export function selectCompetitorRuns(state: ContentIntelligenceRootState) {
  return cc(state).runs;
}

export function selectCompetitorRunsNextCursor(state: ContentIntelligenceRootState) {
  return cc(state).nextCursor;
}

export function selectCompetitorListLoading(state: ContentIntelligenceRootState) {
  return cc(state).listLoading;
}

export function selectCompetitorListLoaded(state: ContentIntelligenceRootState) {
  return cc(state).listLoaded;
}

export function selectCompetitorListError(state: ContentIntelligenceRootState) {
  return cc(state).listError;
}

export function selectCompetitorRunById(id: string | null | undefined) {
  return (state: ContentIntelligenceRootState) => {
    if (!id) return undefined;
    return cc(state).detail[id];
  };
}

export function selectCompetitorDetailLoading(id: string | null | undefined) {
  return (state: ContentIntelligenceRootState) => {
    if (!id) return false;
    return Boolean(cc(state).detailLoading[id]);
  };
}

export function selectCompetitorDetailError(id: string | null | undefined) {
  return (state: ContentIntelligenceRootState) => {
    if (!id) return '';
    return cc(state).detailError[id] ?? '';
  };
}

export function selectCompetitorSubmitting(state: ContentIntelligenceRootState) {
  return cc(state).submitting;
}

export function selectCompetitorSubmitError(state: ContentIntelligenceRootState) {
  return cc(state).submitError;
}

export function selectCompetitorLastStartedRunId(state: ContentIntelligenceRootState) {
  return cc(state).lastStartedRunId;
}

export function selectCompetitorCancelling(id: string) {
  return (state: ContentIntelligenceRootState) => Boolean(cc(state).cancelling[id]);
}

// ---------------------------------------------------------------------------
// Public-page change monitoring selectors.
// ---------------------------------------------------------------------------

function mon(state: ContentIntelligenceRootState) {
  return slice(state).monitoring;
}

export function selectMonitors(state: ContentIntelligenceRootState) {
  return mon(state).monitors;
}

export function selectMonitorActiveLimit(state: ContentIntelligenceRootState) {
  return mon(state).activeLimit;
}

export function selectMonitorUsedSlots(state: ContentIntelligenceRootState) {
  return mon(state).usedSlots;
}

export function selectMonitorListLoading(state: ContentIntelligenceRootState) {
  return mon(state).listLoading;
}

export function selectMonitorListLoaded(state: ContentIntelligenceRootState) {
  return mon(state).listLoaded;
}

export function selectMonitorListError(state: ContentIntelligenceRootState) {
  return mon(state).listError;
}

export function selectMonitorById(id: string | null | undefined) {
  return (state: ContentIntelligenceRootState) => {
    if (!id) return undefined;
    return mon(state).detail[id];
  };
}

export function selectMonitorFeed(id: string | null | undefined) {
  return (state: ContentIntelligenceRootState) => {
    if (!id) return [];
    return mon(state).feed[id] ?? [];
  };
}

export function selectMonitorFeedCursor(id: string | null | undefined) {
  return (state: ContentIntelligenceRootState) => {
    if (!id) return null;
    return mon(state).feedCursor[id] ?? null;
  };
}

export function selectMonitorDetailLoading(id: string | null | undefined) {
  return (state: ContentIntelligenceRootState) => {
    if (!id) return false;
    return Boolean(mon(state).detailLoading[id]);
  };
}

export function selectMonitorDetailError(id: string | null | undefined) {
  return (state: ContentIntelligenceRootState) => {
    if (!id) return '';
    return mon(state).detailError[id] ?? '';
  };
}

export function selectMonitorSubmitting(state: ContentIntelligenceRootState) {
  return mon(state).submitting;
}

export function selectMonitorSubmitError(state: ContentIntelligenceRootState) {
  return mon(state).submitError;
}

export function selectMonitorLastCreatedId(state: ContentIntelligenceRootState) {
  return mon(state).lastCreatedMonitorId;
}

export function selectMonitorMutating(id: string) {
  return (state: ContentIntelligenceRootState) => Boolean(mon(state).mutatingId[id]);
}

export function selectMonitorMutateError(state: ContentIntelligenceRootState) {
  return mon(state).mutateError;
}

export function selectMonitorNotificationPref(state: ContentIntelligenceRootState) {
  return mon(state).notificationPref;
}

export function selectMonitorNotificationLoading(state: ContentIntelligenceRootState) {
  return mon(state).notificationLoading;
}

export function selectMonitorNotificationSaving(state: ContentIntelligenceRootState) {
  return mon(state).notificationSaving;
}

export function selectMonitorNotificationError(state: ContentIntelligenceRootState) {
  return mon(state).notificationError;
}
