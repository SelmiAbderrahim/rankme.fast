import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '@app/store';
import { initialState, type ActionsState } from './slice';
import { presentationCacheKey } from '@shared/i18n/requestIdentity';
import type { SupportedLocale } from '@shared/i18n/locales';

type ActionsRootState = RootState | { actions?: ActionsState };

function slice(state: ActionsRootState): ActionsState {
  if ('actions' in state && state.actions) return state.actions;
  return initialState;
}

export function selectActionsSiteId(state: ActionsRootState) {
  return slice(state).siteId;
}

export function selectActions(state: ActionsRootState) {
  return slice(state).items;
}

export function selectActionsNextCursor(state: ActionsRootState) {
  return slice(state).nextCursor;
}

export function selectActionsListStatus(state: ActionsRootState) {
  return slice(state).listStatus;
}

export function selectActionsListError(state: ActionsRootState) {
  return slice(state).listError;
}

export function selectSourceStatus(state: ActionsRootState) {
  return slice(state).sourceStatus;
}

export function selectAllSourcesUnavailable(state: ActionsRootState): boolean {
  const envelope = slice(state).sourceStatus;
  const values = Object.values(envelope);
  if (values.length === 0) return false;
  return values.every((v) => v?.status === 'unavailable');
}

export function selectAnyPartialSource(state: ActionsRootState): boolean {
  const envelope = slice(state).sourceStatus;
  return Object.values(envelope).some(
    (v) => v?.status === 'unavailable' || v?.status === 'stale',
  );
}

const localizedActionKey = (
  actionId: string,
  locale: SupportedLocale,
): string =>
  presentationCacheKey(`action-history:${actionId}`, {
    presentationLocale: locale,
  });

export function selectActionHistory(
  actionId: string | null | undefined,
  locale?: SupportedLocale,
) {
  return (state: ActionsRootState) => {
    if (!actionId) return undefined;
    const current = slice(state);
    return current.history[
      localizedActionKey(actionId, locale ?? current.presentationLocale)
    ];
  };
}

export function selectActionPending(
  kind: 'state' | 'retest' | 'history',
  actionId: string | null | undefined,
  locale?: SupportedLocale,
) {
  return (state: ActionsRootState) => {
    if (!actionId) return false;
    const current = slice(state);
    const key =
      kind === 'history'
        ? localizedActionKey(actionId, locale ?? current.presentationLocale)
        : actionId;
    return Boolean(current.pending[kind][key]);
  };
}

export function selectActionError(
  kind: 'state' | 'retest' | 'history',
  actionId: string | null | undefined,
  locale?: SupportedLocale,
) {
  return (state: ActionsRootState) => {
    if (!actionId) return '';
    const current = slice(state);
    const key =
      kind === 'history'
        ? localizedActionKey(actionId, locale ?? current.presentationLocale)
        : actionId;
    return current.errors[kind][key] ?? '';
  };
}

export function selectActionConflict(actionId: string | null | undefined) {
  return (state: ActionsRootState) => {
    if (!actionId) return false;
    return Boolean(slice(state).conflictIds[actionId]);
  };
}

export function selectLastRetestRunId(state: ActionsRootState) {
  return slice(state).lastRetestRunId;
}

/** Overview widget: first 5 items in server order. */
export const selectOverviewActions = createSelector(
  [selectActions],
  (items) => items.slice(0, 5),
);

/**
 * Find the audit action for a given ruleId — used by the report page to map
 * its findings to unified action rows. Audit action identity is
 * run-independent (`sourceId === ruleId`), so a decision survives later
 * audits. Returns null when the server hasn't included it yet (fresh audits,
 * before the actions reader indexed the run).
 */
export function selectAuditActionByRuleId(ruleId: string) {
  return (
    state: ActionsRootState,
  ): {
    id: string;
    version: number;
    state: ActionsState['items'][number]['state'];
    reappearedAfterFix: boolean;
  } | null => {
    const items = slice(state).items;
    const match = items.find(
      (i) => i.sourceType === 'audit_finding' && i.sourceId === ruleId,
    );
    if (!match) return null;
    return {
      id: match.id,
      version: match.version,
      state: match.state,
      reappearedAfterFix: match.reappearedAfterFix,
    };
  };
}
