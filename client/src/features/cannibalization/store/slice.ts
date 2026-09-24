import { createSlice } from '@reduxjs/toolkit';
import {
  initialCannibalizationState,
  type CannibalizationGate,
  type CannibalizationState,
} from '../types';
import {
  generateCannibalizationReportThunk,
  loadCannibalizationReport,
  loadCannibalizationReports,
  loadCannibalizationPrerequisites,
  previewCannibalizationReportThunk,
} from './thunks';

/**
 * `rejectWithValue` always supplies a gate; the `?? null` keeps the reducer
 * total for the (unreachable in practice) thrown-error path.
 */
const gateOf = (payload: CannibalizationGate | undefined): CannibalizationGate | null =>
  payload ?? null;

const slice = createSlice({
  name: 'cannibalization',
  initialState: initialCannibalizationState,
  reducers: {
    clearCannibalizationPreview: (state: CannibalizationState) => {
      state.preview = null;
      state.previewStatus = 'idle';
      state.previewGate = null;
      state.generateStatus = 'idle';
      state.generateGate = null;
    },
    resetCannibalization: () => initialCannibalizationState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadCannibalizationPrerequisites.pending, (state) => {
        state.sitesStatus = 'loading';
        state.sitesError = '';
        state.gscConnected = null;
      })
      .addCase(loadCannibalizationPrerequisites.fulfilled, (state, action) => {
        state.sitesStatus = 'succeeded';
        state.gscConnected = action.payload.gscConnected;
      })
      .addCase(loadCannibalizationPrerequisites.rejected, (state, action) => {
        state.sitesStatus = 'failed';
        state.sitesError = action.payload ?? '';
        state.gscConnected = null;
      })
      .addCase(loadCannibalizationReports.pending, (state) => {
        state.listStatus = 'loading';
        state.listGate = null;
      })
      .addCase(loadCannibalizationReports.fulfilled, (state, action) => {
        state.listStatus = 'succeeded';
        state.reports = action.payload;
      })
      .addCase(loadCannibalizationReports.rejected, (state, action) => {
        state.listStatus = 'failed';
        state.listGate = gateOf(action.payload);
      })
      .addCase(loadCannibalizationReport.pending, (state) => {
        state.detailStatus = 'loading';
        state.detailGate = null;
      })
      .addCase(loadCannibalizationReport.fulfilled, (state, action) => {
        state.detailStatus = 'succeeded';
        state.detail = action.payload;
      })
      .addCase(loadCannibalizationReport.rejected, (state, action) => {
        state.detailStatus = 'failed';
        state.detail = null;
        state.detailGate = gateOf(action.payload);
      })
      .addCase(previewCannibalizationReportThunk.pending, (state) => {
        state.previewStatus = 'loading';
        state.previewGate = null;
      })
      .addCase(previewCannibalizationReportThunk.fulfilled, (state, action) => {
        state.previewStatus = 'succeeded';
        state.preview = action.payload;
      })
      .addCase(previewCannibalizationReportThunk.rejected, (state, action) => {
        state.previewStatus = 'failed';
        state.preview = null;
        state.previewGate = gateOf(action.payload);
      })
      .addCase(generateCannibalizationReportThunk.pending, (state) => {
        state.generateStatus = 'loading';
        state.generateGate = null;
      })
      .addCase(generateCannibalizationReportThunk.fulfilled, (state, action) => {
        state.generateStatus = 'succeeded';
        state.detail = action.payload;
        state.detailStatus = 'succeeded';
        state.detailGate = null;
        state.preview = null;
        state.previewStatus = 'idle';
        // Newest first — the fresh report leads the list without a refetch.
        state.reports = [
          {
            id: action.payload.id,
            siteId: action.payload.siteId,
            windowDays: action.payload.windowDays,
            snapshotDate: action.payload.snapshotDate,
            generatedAt: action.payload.generatedAt,
            queriesAnalyzed: action.payload.queriesAnalyzed,
            candidateCount: action.payload.candidateCount,
            pagesInvolved: action.payload.pagesInvolved,
          },
          ...state.reports,
        ];
      })
      .addCase(generateCannibalizationReportThunk.rejected, (state, action) => {
        state.generateStatus = 'failed';
        state.generateGate = gateOf(action.payload);
      });
  },
});

export const { clearCannibalizationPreview, resetCannibalization } = slice.actions;
export const cannibalizationReducer = slice.reducer;
export const initialState = initialCannibalizationState;
