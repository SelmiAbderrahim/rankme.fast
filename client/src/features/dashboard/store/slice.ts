import { createSlice } from '@reduxjs/toolkit';
import { isRankJobSettled, isSiteMutation, isWorkspaceSwitch } from '@shared/cache/invalidation';
import { dashboardInitialState } from './initialState';
import { loadSiteHealth } from './thunks';

const dashboardSlice = createSlice({
  name: 'dashboard', initialState: dashboardInitialState, reducers: {},
  extraReducers: (builder) => builder
    .addCase(loadSiteHealth.pending, (state) => { state.loading = true; state.error = ''; })
    .addCase(loadSiteHealth.fulfilled, (state, action) => {
      state.loading = false; state.health = action.payload; state.loadedAt = Date.now();
    })
    .addCase(loadSiteHealth.rejected, (state, action) => {
      state.loading = false; state.loadedAt = null; state.error = action.payload ?? '';
    })
    .addMatcher(isSiteMutation, (state) => { state.loadedAt = null; })
    .addMatcher(isRankJobSettled, (state) => { state.loadedAt = null; })
    .addMatcher(isWorkspaceSwitch, (state) => { state.loadedAt = null; }),
});
export const dashboardReducer = dashboardSlice.reducer;
