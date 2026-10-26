import { createAction, type UnknownAction } from '@reduxjs/toolkit';

/** Shared action contracts avoid imports between feature internals. */
export const WORKSPACE_SWITCH_ACTION_TYPE = 'workspace/setActiveWorkspace';
export const isWorkspaceSwitch = (action: UnknownAction): boolean =>
  action.type === WORKSPACE_SWITCH_ACTION_TYPE;

export const SITE_MUTATION_ACTION_TYPES = [
  'sites/add/fulfilled',
  'sites/remove/fulfilled',
  'sites/rename/fulfilled',
  'sites/pause/fulfilled',
  'sites/resume/fulfilled',
] as const;
export const isSiteMutation = (action: UnknownAction): boolean =>
  (SITE_MUTATION_ACTION_TYPES as readonly string[]).includes(action.type);

/** A completed rank job makes keyword-derived answers stale. */
export const rankJobSettled = createAction<{ siteId: string; jobId: string }>('ranks/jobSettled');
export const isRankJobSettled = (action: UnknownAction): boolean => rankJobSettled.match(action);

/** Bootstrap reads made obsolete by a completed mutation. */
export const invalidatedBootstrapReads = (action: UnknownAction): readonly string[] => {
  if (isSiteMutation(action)) return ['sites/load/pending'];
  if (action.type === 'teamInbox/accept/fulfilled' || action.type === 'team/accept/fulfilled') {
    return ['teamInbox/load/pending', 'workspace/load/pending'];
  }
  if (action.type === 'teamInbox/reject/fulfilled') return ['teamInbox/load/pending'];
  return [];
};
