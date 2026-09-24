import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { readStoredWorkspaceId, writeStoredWorkspaceId } from '../storage';
import type { WorkspaceState } from '../types';
import { loadWorkspaces } from './thunks';

export const workspaceInitialState: WorkspaceState = {
  workspaces: [],
  // Rehydrated optimistically so the very first API call already carries the
  // header the user left off with; `loadWorkspaces` validates it immediately
  // after and resets if the membership is gone.
  activeWorkspaceId: readStoredWorkspaceId(),
  status: 'idle',
  loadError: '',
};

const workspaceSlice = createSlice({
  name: 'workspace',
  initialState: workspaceInitialState,
  reducers: {
    setActiveWorkspace(state, action: PayloadAction<string | null>) {
      const next = action.payload;
      const known = state.workspaces.find((w) => w.accountId === next);
      // Selecting an unknown workspace, or the caller's own, both resolve to
      // "no header" — the server treats an absent header and the caller's own
      // id identically.
      const resolved = next === null || !known || known.isOwn ? null : next;
      state.activeWorkspaceId = resolved;
      writeStoredWorkspaceId(resolved);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadWorkspaces.pending, (state) => {
        state.status = 'loading';
        state.loadError = '';
      })
      .addCase(loadWorkspaces.fulfilled, (state, action) => {
        state.status = 'loaded';
        state.workspaces = action.payload;
        // Re-validate the rehydrated id against what the server just said. A
        // revoked membership would otherwise 404 every request with no way out
        // of the loop but clearing site data.
        const active = state.activeWorkspaceId;
        if (active !== null) {
          const match = action.payload.find((w) => w.accountId === active);
          if (!match || match.isOwn) {
            state.activeWorkspaceId = null;
            writeStoredWorkspaceId(null);
          }
        }
      })
      .addCase(loadWorkspaces.rejected, (state, action) => {
        state.status = 'failed';
        state.loadError = action.payload ?? '';
      });
  },
});

export const { setActiveWorkspace } = workspaceSlice.actions;
export const workspaceReducer = workspaceSlice.reducer;
