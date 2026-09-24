import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '@app/store';
import { initialState } from './mcpPermissionsSlice';

// The account route injects this slice lazily; first-render selectors must use
// the slice's own initial state until RTK materializes the reducer key.
const selectMcpPermissionsState = (state: RootState) =>
  state.mcpPermissions ?? initialState;

export const selectMcpPermissions = createSelector(
  selectMcpPermissionsState,
  (state) => state.settings,
);
export const selectMcpPermissionsLoading = createSelector(
  selectMcpPermissionsState,
  (state) => state.loading,
);
export const selectMcpPermissionsLoaded = createSelector(
  selectMcpPermissionsState,
  (state) => state.loaded,
);
export const selectMcpPermissionsLoadError = createSelector(
  selectMcpPermissionsState,
  (state) => state.loadError,
);
export const selectMcpPermissionsSaving = createSelector(
  selectMcpPermissionsState,
  (state) => state.saving,
);
export const selectMcpPermissionsSaveError = createSelector(
  selectMcpPermissionsState,
  (state) => state.saveError,
);
export const selectMcpPermissionsSaved = createSelector(
  selectMcpPermissionsState,
  (state) => state.saved,
);
