import { createSlice } from '@reduxjs/toolkit';
import type { ReportExportState } from '../types';
import {
  createAndDownloadReport,
  loadReportExportCapabilities,
  loadReportShareCenter,
  loadReportSnapshots,
  redownloadReportSnapshot,
  removeReportSnapshot,
  revokeReportShareFromCenter,
} from './thunks';

export const initialReportExportState: ReportExportState = {
  capabilities: [],
  enabled: false,
  capabilitiesLoading: false,
  capabilitiesLoaded: false,
  capabilitiesError: '',
  snapshots: [],
  snapshotsCursor: null,
  snapshotsLoading: false,
  snapshotsLoaded: false,
  snapshotsError: '',
  shares: [],
  sharesCursor: null,
  sharesLoading: false,
  sharesLoaded: false,
  sharesError: '',
  activeOperation: null,
  operationError: '',
};

const operationKey = (action: { meta: { arg: { operationKey: string } } }) =>
  action.meta.arg.operationKey;

const reportExportSlice = createSlice({
  name: 'reportExport',
  initialState: initialReportExportState,
  reducers: {
    clearReportExportOperation: (state) => {
      state.activeOperation = null;
      state.operationError = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadReportExportCapabilities.pending, (state) => {
        state.capabilitiesLoading = true;
        state.capabilitiesError = '';
      })
      .addCase(loadReportExportCapabilities.fulfilled, (state, action) => {
        state.capabilitiesLoading = false;
        state.capabilitiesLoaded = true;
        state.enabled = action.payload.enabled;
        state.capabilities = action.payload.kinds;
      })
      .addCase(loadReportExportCapabilities.rejected, (state, action) => {
        state.capabilitiesLoading = false;
        state.capabilitiesLoaded = true;
        state.capabilitiesError = action.payload ?? '';
      })
      .addCase(loadReportSnapshots.pending, (state) => {
        state.snapshotsLoading = true;
        state.snapshotsError = '';
      })
      .addCase(loadReportSnapshots.fulfilled, (state, action) => {
        state.snapshotsLoading = false;
        state.snapshotsLoaded = true;
        state.snapshots = action.payload.append
          ? [...state.snapshots, ...action.payload.items]
          : action.payload.items;
        state.snapshotsCursor = action.payload.nextCursor;
      })
      .addCase(loadReportSnapshots.rejected, (state, action) => {
        state.snapshotsLoading = false;
        state.snapshotsLoaded = true;
        state.snapshotsError = action.payload ?? '';
      })
      .addCase(loadReportShareCenter.pending, (state) => {
        state.sharesLoading = true;
        state.sharesError = '';
      })
      .addCase(loadReportShareCenter.fulfilled, (state, action) => {
        state.sharesLoading = false;
        state.sharesLoaded = true;
        state.shares = action.payload.append
          ? [...state.shares, ...action.payload.items]
          : action.payload.items;
        state.sharesCursor = action.payload.nextCursor;
      })
      .addCase(loadReportShareCenter.rejected, (state, action) => {
        state.sharesLoading = false;
        state.sharesLoaded = true;
        state.sharesError = action.payload ?? '';
      });

    for (const thunk of [
      createAndDownloadReport,
      redownloadReportSnapshot,
      removeReportSnapshot,
      revokeReportShareFromCenter,
    ] as const) {
      builder.addCase(thunk.pending, (state, action) => {
        state.activeOperation = operationKey(action);
        state.operationError = '';
      });
      builder.addCase(thunk.rejected, (state, action) => {
        state.activeOperation = null;
        state.operationError = action.payload ?? '';
      });
    }
    builder
      .addCase(createAndDownloadReport.fulfilled, (state, action) => {
        state.activeOperation = null;
        const existing = state.snapshots.findIndex((item) => item.id === action.payload.id);
        if (existing >= 0) state.snapshots[existing] = action.payload;
        else state.snapshots.unshift(action.payload);
      })
      .addCase(redownloadReportSnapshot.fulfilled, (state) => {
        state.activeOperation = null;
      })
      .addCase(removeReportSnapshot.fulfilled, (state, action) => {
        state.activeOperation = null;
        state.snapshots = state.snapshots.filter((item) => item.id !== action.payload);
        state.shares = state.shares.map((share) =>
          share.snapshotId === action.payload
            ? { ...share, snapshot: null, revokedAt: share.revokedAt ?? new Date().toISOString() }
            : share,
        );
      })
      .addCase(revokeReportShareFromCenter.fulfilled, (state, action) => {
        state.activeOperation = null;
        const index = state.shares.findIndex((share) => share.id === action.payload.id);
        if (index >= 0) state.shares[index] = { ...state.shares[index]!, ...action.payload };
      });
  },
});

export const { clearReportExportOperation } = reportExportSlice.actions;
export const reportExportReducer = reportExportSlice.reducer;
