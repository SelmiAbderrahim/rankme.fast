import type { RootState } from '@app/store';
import { initialState } from './slice';

// The lazy-loaded 'report' reducer is injected right before this tab's
// component renders, but RTK only materializes the slice into state on the
// NEXT dispatched action — the very first render still sees `state.report`
// as undefined, so every selector must fall back to the slice's own initial
// state rather than assume the key exists.
const selectSlice = (state: RootState) => state.report ?? initialState;

export const selectReport = (state: RootState) => selectSlice(state).report;
export const selectReportLoading = (state: RootState) => selectSlice(state).loading;
export const selectReportLoaded = (state: RootState) => selectSlice(state).loaded;
export const selectReportError = (state: RootState) => selectSlice(state).error;
export const selectReportRetesting = (state: RootState) => selectSlice(state).retesting;
export const selectReportRetestError = (state: RootState) => selectSlice(state).retestError;
export const selectReportRunId = (state: RootState) => selectSlice(state).runId;
export const selectReportSiteId = (state: RootState) => selectSlice(state).siteId;
export const selectReportRunStatus = (state: RootState) => selectSlice(state).runStatus;
export const selectReportRuns = (state: RootState) => selectSlice(state).runs;
export const selectReportRunsSiteId = (state: RootState) => selectSlice(state).runsSiteId;
export const selectReportPdfDownloading = (state: RootState) =>
  selectSlice(state).pdfDownloading;
export const selectReportPdfError = (state: RootState) => selectSlice(state).pdfError;
