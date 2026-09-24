import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  initialGeogridState,
  type GeogridFormState,
  type GeogridSize,
  type GeogridState,
} from '../types';
import {
  loadGeogridScan,
  loadGeogridScans,
  previewGeogrid,
  submitGeogridScan,
} from './thunks';

const slice = createSlice({
  name: 'geogrid',
  initialState: initialGeogridState,
  reducers: {
    /** Switching sites drops every stored read so no other site's scan leaks. */
    setGeogridSiteId: (state, action: PayloadAction<string>) => {
      if (state.siteId === action.payload) return state;
      return { ...initialGeogridState, siteId: action.payload } satisfies GeogridState;
    },
    setGeogridFormField: (
      state,
      action: PayloadAction<
        | { field: 'keywordId' | 'centerLat' | 'centerLng'; value: string }
        | { field: 'spacingMeters' | 'zoom'; value: number }
        | { field: 'gridSize'; value: GeogridSize }
      >,
    ) => {
      const { field, value } = action.payload;
      (state.form as Record<string, unknown>)[field] = value;
      // Any definition change invalidates the estimate — a stale preview must
      // never be presented as the cost of the edited grid.
      state.preview = null;
      state.previewDefinition = null;
      state.previewStatus = 'idle';
      state.previewGate = null;
    },
    clearGeogridPreview: (state) => {
      state.preview = null;
      state.previewDefinition = null;
      state.previewStatus = 'idle';
      state.previewGate = null;
    },
    clearGeogridSubmitGate: (state) => {
      state.submitGate = null;
    },
    resetGeogrid: () => initialGeogridState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadGeogridScans.pending, (state) => {
        state.scansStatus = 'loading';
        state.scansGate = null;
      })
      .addCase(loadGeogridScans.fulfilled, (state, action) => {
        state.scansStatus = 'ready';
        state.scans = action.payload.scans;
      })
      .addCase(loadGeogridScans.rejected, (state, action) => {
        state.scansStatus = 'error';
        state.scansGate = action.payload ?? { kind: 'failed', message: '' };
      })
      .addCase(loadGeogridScan.pending, (state) => {
        state.detailStatus = 'loading';
        state.detailGate = null;
      })
      .addCase(loadGeogridScan.fulfilled, (state, action) => {
        state.detailStatus = 'ready';
        state.detail = action.payload;
      })
      .addCase(loadGeogridScan.rejected, (state, action) => {
        state.detailStatus = 'error';
        state.detail = null;
        state.detailGate = action.payload ?? { kind: 'failed', message: '' };
      })
      .addCase(previewGeogrid.pending, (state) => {
        state.previewStatus = 'loading';
        state.previewGate = null;
      })
      .addCase(previewGeogrid.fulfilled, (state, action) => {
        state.previewStatus = 'ready';
        state.preview = action.payload;
        state.previewDefinition = action.meta.arg.definition;
      })
      .addCase(previewGeogrid.rejected, (state, action) => {
        state.previewStatus = 'error';
        state.preview = null;
        state.previewDefinition = null;
        state.previewGate = action.payload ?? { kind: 'failed', message: '' };
      })
      .addCase(submitGeogridScan.pending, (state) => {
        state.submitting = true;
        state.submitGate = null;
      })
      .addCase(submitGeogridScan.fulfilled, (state) => {
        state.submitting = false;
        state.preview = null;
        state.previewDefinition = null;
        state.previewStatus = 'idle';
      })
      .addCase(submitGeogridScan.rejected, (state, action) => {
        state.submitting = false;
        state.submitGate = action.payload ?? { kind: 'failed', message: '' };
      });
  },
});

export const {
  clearGeogridPreview,
  clearGeogridSubmitGate,
  resetGeogrid,
  setGeogridFormField,
  setGeogridSiteId,
} = slice.actions;

export const geogridReducer = slice.reducer;
export { initialGeogridState };
export type { GeogridFormState };
