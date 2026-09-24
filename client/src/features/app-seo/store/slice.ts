import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AppSeoRegistrationState, AppSeoState } from '../types';
import { loadAppProfiles, registerAppProfile, unregisterAppProfile } from './thunks';

export const initialAppSeoState: AppSeoState = {
  profiles: [],
  registration: { status: 'idle', message: '' },
};

const applyRejectedRegistration = (
  state: AppSeoState,
  action: PayloadAction<AppSeoRegistrationState | undefined, string, unknown, { message?: string }>,
) => {
  state.registration = action.payload ?? {
    status: 'failed',
    message: action.error.message ?? '',
  };
};

const appSeoSlice = createSlice({
  name: 'appSeo',
  initialState: initialAppSeoState,
  reducers: {
    clearAppSeoRegistration: (state) => {
      state.registration = { ...initialAppSeoState.registration };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadAppProfiles.pending, (state) => {
        state.registration = { status: 'loading', message: '' };
      })
      .addCase(loadAppProfiles.fulfilled, (state, action) => {
        state.profiles = action.payload;
        state.registration = { status: 'idle', message: '' };
      })
      .addCase(loadAppProfiles.rejected, (state, action) => {
        applyRejectedRegistration(state, action);
      })
      .addCase(registerAppProfile.pending, (state) => {
        state.registration = { status: 'loading', message: '' };
      })
      .addCase(registerAppProfile.fulfilled, (state, action) => {
        state.profiles.unshift(action.payload);
        state.registration = { status: 'succeeded', message: '' };
      })
      .addCase(registerAppProfile.rejected, (state, action) => {
        applyRejectedRegistration(state, action);
      })
      .addCase(unregisterAppProfile.pending, (state) => {
        state.registration = { status: 'loading', message: '' };
      })
      .addCase(unregisterAppProfile.fulfilled, (state, action) => {
        state.profiles = state.profiles.filter((profile) => profile.id !== action.payload);
        state.registration = { status: 'succeeded', message: '' };
      })
      .addCase(unregisterAppProfile.rejected, (state, action) => {
        applyRejectedRegistration(state, action);
      });
  },
});

export const { clearAppSeoRegistration } = appSeoSlice.actions;
export const appSeoReducer = appSeoSlice.reducer;
