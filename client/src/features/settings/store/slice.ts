import { createSlice } from '@reduxjs/toolkit';
import type { NotificationState } from '../types';
import {
  loadNotificationPreferences,
  toggleNotificationPreference,
} from './thunks';

export const initialState: NotificationState = {
  preferences: null,
  loading: false,
  loaded: false,
  loadError: '',
  saving: {},
  saveError: '',
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    clearSettingsMessages: (state) => {
      state.loadError = '';
      state.saveError = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadNotificationPreferences.pending, (state) => {
        state.loading = true;
        state.loadError = '';
      })
      .addCase(loadNotificationPreferences.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.preferences = action.payload;
      })
      .addCase(loadNotificationPreferences.rejected, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.loadError = action.payload ?? '';
      })
      // Optimistic toggle: flip the switch in place immediately so the UI
      // stays snappy. On reject we roll the switch back — see below.
      .addCase(toggleNotificationPreference.pending, (state, action) => {
        const { channel, value } = action.meta.arg;
        state.saving[channel] = true;
        state.saveError = '';
        if (state.preferences) {
          state.preferences = { ...state.preferences, [channel]: value };
        }
      })
      .addCase(toggleNotificationPreference.fulfilled, (state, action) => {
        const { channel } = action.payload;
        delete state.saving[channel];
        state.preferences = action.payload.preferences;
      })
      .addCase(toggleNotificationPreference.rejected, (state, action) => {
        const rejection = action.payload;
        // Roll back the optimistic toggle. `arg.value` was the intended value,
        // so the previous state was its inverse.
        const { channel, value } = action.meta.arg;
        delete state.saving[channel];
        if (state.preferences) {
          state.preferences = { ...state.preferences, [channel]: !value };
        }
        state.saveError = rejection?.message ?? '';
      });
  },
});

export const { clearSettingsMessages } = settingsSlice.actions;
export const settingsReducer = settingsSlice.reducer;
