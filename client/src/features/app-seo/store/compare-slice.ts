import { createSlice } from '@reduxjs/toolkit';
import type { AppSeoCompareState } from '../compare-types';
import { loadAppSeoComparison } from './compare-thunks';

export const initialAppSeoCompareState: AppSeoCompareState = {
  siteId: null,
  profileId: null,
  comparison: null,
  status: 'idle',
  error: '',
};

const compareSlice = createSlice({
  name: 'appSeoCompare',
  initialState: initialAppSeoCompareState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadAppSeoComparison.pending, (state, action) => {
        state.status = 'loading';
        state.error = '';
        if (
          state.siteId !== action.meta.arg.siteId
          || state.profileId !== action.meta.arg.profileId
        ) {
          state.comparison = null;
        }
        state.siteId = action.meta.arg.siteId;
        state.profileId = action.meta.arg.profileId;
      })
      .addCase(loadAppSeoComparison.fulfilled, (state, action) => {
        state.comparison = action.payload;
        state.status = 'succeeded';
      })
      .addCase(loadAppSeoComparison.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload ?? '';
      });
  },
});

export const appSeoCompareReducer = compareSlice.reducer;
