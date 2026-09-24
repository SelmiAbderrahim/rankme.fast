import { createSlice } from '@reduxjs/toolkit';
import type { BrandingState } from '../types';
import { loadBranding, saveBranding } from './brandingThunks';

export const initialState: BrandingState = {
  branding: { companyName: '', accentColor: '', logoDataUrl: null },
  loading: false,
  loaded: false,
  loadError: '',
  saving: false,
  saveError: '',
  saved: false,
};

const brandingSlice = createSlice({
  name: 'branding',
  initialState,
  reducers: {
    clearBrandingMessages: (state) => {
      state.loadError = '';
      state.saveError = '';
      state.saved = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadBranding.pending, (state) => {
        state.loading = true;
        state.loadError = '';
      })
      .addCase(loadBranding.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.branding = action.payload;
      })
      .addCase(loadBranding.rejected, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.loadError = action.payload ?? '';
      })
      .addCase(saveBranding.pending, (state) => {
        state.saving = true;
        state.saveError = '';
        state.saved = false;
      })
      .addCase(saveBranding.fulfilled, (state, action) => {
        state.saving = false;
        state.saved = true;
        state.branding = action.payload;
      })
      .addCase(saveBranding.rejected, (state, action) => {
        state.saving = false;
        state.saveError = action.payload ?? '';
      });
  },
});

export const { clearBrandingMessages } = brandingSlice.actions;
export const brandingReducer = brandingSlice.reducer;
