import type { RootState } from '@app/store';
import { initialReportExportState } from './slice';

const selectSlice = (state: RootState) => state.reportExport ?? initialReportExportState;

export const selectReportExportCapabilities = (state: RootState) =>
  selectSlice(state).capabilities;
export const selectReportExportEnabled = (state: RootState) => selectSlice(state).enabled;
export const selectReportExportCapabilitiesLoading = (state: RootState) =>
  selectSlice(state).capabilitiesLoading;
export const selectReportExportCapabilitiesLoaded = (state: RootState) =>
  selectSlice(state).capabilitiesLoaded;
export const selectReportExportCapabilitiesError = (state: RootState) =>
  selectSlice(state).capabilitiesError;
export const selectReportSnapshots = (state: RootState) => selectSlice(state).snapshots;
export const selectReportSnapshotsCursor = (state: RootState) =>
  selectSlice(state).snapshotsCursor;
export const selectReportSnapshotsLoading = (state: RootState) =>
  selectSlice(state).snapshotsLoading;
export const selectReportSnapshotsLoaded = (state: RootState) =>
  selectSlice(state).snapshotsLoaded;
export const selectReportSnapshotsError = (state: RootState) =>
  selectSlice(state).snapshotsError;
export const selectReportShares = (state: RootState) => selectSlice(state).shares;
export const selectReportSharesCursor = (state: RootState) => selectSlice(state).sharesCursor;
export const selectReportSharesLoading = (state: RootState) => selectSlice(state).sharesLoading;
export const selectReportSharesLoaded = (state: RootState) => selectSlice(state).sharesLoaded;
export const selectReportSharesError = (state: RootState) => selectSlice(state).sharesError;
export const selectReportExportActiveOperation = (state: RootState) =>
  selectSlice(state).activeOperation;
export const selectReportExportOperationError = (state: RootState) =>
  selectSlice(state).operationError;
