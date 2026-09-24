import { createSlice } from '@reduxjs/toolkit';
import { createPermissiveMcpSettings } from '../mcpScopes';
import type { McpPermissionsState } from '../types';
import {
  loadMcpPermissions,
  saveMcpPermissions,
} from './mcpPermissionsThunks';

export const initialState: McpPermissionsState = {
  settings: createPermissiveMcpSettings(),
  loading: false,
  loaded: false,
  loadError: '',
  saving: false,
  saveError: '',
  saved: false,
};

const mcpPermissionsSlice = createSlice({
  name: 'mcpPermissions',
  initialState,
  reducers: {
    clearMcpPermissionsMessages: (state) => {
      state.loadError = '';
      state.saveError = '';
      state.saved = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadMcpPermissions.pending, (state) => {
        state.loading = true;
        state.loadError = '';
      })
      .addCase(loadMcpPermissions.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.settings = action.payload;
      })
      .addCase(loadMcpPermissions.rejected, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.loadError = action.payload ?? '';
      })
      .addCase(saveMcpPermissions.pending, (state) => {
        state.saving = true;
        state.saveError = '';
        state.saved = false;
      })
      .addCase(saveMcpPermissions.fulfilled, (state, action) => {
        state.saving = false;
        state.settings = action.payload;
        state.saved = true;
      })
      .addCase(saveMcpPermissions.rejected, (state, action) => {
        state.saving = false;
        state.saveError = action.payload ?? '';
      });
  },
});

export const { clearMcpPermissionsMessages } = mcpPermissionsSlice.actions;
export const mcpPermissionsReducer = mcpPermissionsSlice.reducer;
