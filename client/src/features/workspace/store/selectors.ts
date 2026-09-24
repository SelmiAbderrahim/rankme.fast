import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '@app/store';
import { workspaceInitialState } from './slice';
import type { Workspace, WorkspaceState } from '../types';

/**
 * Every selector reads through this.
 *
 * The workspace reducer is registered eagerly, but the switcher lives in the
 * shared layout and therefore renders inside SSR and inside tests that build a
 * store from a subset of reducers. Falling back to `workspaceInitialState`
 * keeps those readers from crashing on an absent slice — the known
 * lazy-slice-eager-reader failure class.
 */
const selectSlice = (state: RootState): WorkspaceState =>
  state.workspace ?? workspaceInitialState;

export const selectWorkspaces = (state: RootState): Workspace[] =>
  selectSlice(state).workspaces;

export const selectActiveWorkspaceId = (state: RootState): string | null =>
  selectSlice(state).activeWorkspaceId;

export const selectWorkspaceStatus = (state: RootState): WorkspaceState['status'] =>
  selectSlice(state).status;

export const selectWorkspaceLoadError = (state: RootState): string =>
  selectSlice(state).loadError;

/** The workspace currently being worked in — the own entry when none is set. */
export const selectActiveWorkspace = createSelector(
  [selectWorkspaces, selectActiveWorkspaceId],
  (workspaces, activeId): Workspace | null => {
    if (activeId === null) return workspaces.find((w) => w.isOwn) ?? null;
    return workspaces.find((w) => w.accountId === activeId) ?? null;
  },
);

/** The caller's TEAM role in the active workspace; `owner` in their own. */
export const selectActiveWorkspaceRole = createSelector(
  [selectActiveWorkspace],
  (workspace) => workspace?.role ?? 'owner',
);

/** True when the user is working inside somebody else's workspace. */
export const selectIsForeignWorkspace = createSelector(
  [selectActiveWorkspaceId],
  (activeId) => activeId !== null,
);

/** The switcher is pointless with a single workspace, so it stays hidden. */
export const selectHasMultipleWorkspaces = createSelector(
  [selectWorkspaces],
  (workspaces) => workspaces.length > 1,
);
