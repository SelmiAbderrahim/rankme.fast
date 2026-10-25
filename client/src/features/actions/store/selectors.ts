import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '@app/store';
import { initialState, type ActionsState } from './slice';
import type { ActionState } from '../types';
import { isResolvedActionState } from '../auditDecisions';
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

/**
 * Overview widget: the first 5 still-actionable items (open or planned) in
 * server order, severity first. The slice can hold rows another surface
 * loaded (the Actions tab, the report mapping), so resolved rows are dropped
 * here as well as in the Overview's own `state` filter.
 */
export const selectOverviewActions = createSelector([selectActions], (items) =>
  items.filter((item) => !isResolvedActionState(item.state)).slice(0, 5),
);

/**
 * Current decision per audit rule for one site: the dedicated resolved-
 * decisions read, overlaid by any audit rows already in the list (those are
 * updated in place when the user changes a state, so they win).
 */
export const selectAuditDecisionStates = createSelector(
  [
    (state: ActionsRootState) => slice(state).auditDecisions,
    (state: ActionsRootState) => slice(state).siteId,
    selectActions,
    (_state: ActionsRootState, siteId: string) => siteId,
  ],
  (auditDecisions, listSiteId, items, siteId): Readonly<Record<string, ActionState>> => {
    const states: Record<string, ActionState> =
      auditDecisions.siteId === siteId ? { ...auditDecisions.byRuleId } : {};
    if (listSiteId === siteId) {
      for (const item of items) {
        if (item.sourceType === 'audit_finding') states[item.sourceId] = item.state;
      }
    }
    return states;
  },
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
