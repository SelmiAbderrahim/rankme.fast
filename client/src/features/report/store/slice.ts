import { createSlice } from '@reduxjs/toolkit';
import type { ReportState } from '../types';
import { downloadReportPdf, loadReport, loadRuns, pollRun, startRetest } from './thunks';
import {
  presentationCacheKey,
  presentationLocaleChanged,
  presentationRequestIdentity,
  type PresentationRequestIdentity,
} from '@shared/i18n/requestIdentity';
import { DEFAULT_LOCALE } from '@shared/i18n/locales';

export const initialState: ReportState = {
  presentationLocale: DEFAULT_LOCALE,
  presentationGeneration: 0,
  reportCacheKey: presentationCacheKey('report:unselected', {
    presentationLocale: DEFAULT_LOCALE,
  }),
  runId: null,
  siteId: null,
  report: null,
  loading: false,
  loaded: false,
  error: '',
  retesting: false,
  retestError: '',
  runStatus: null,
  runs: [],
  runsLoading: false,
  runsLoaded: false,
  runsSiteId: null,
  pdfDownloading: false,
  pdfError: '',
};

const identityFor = (
  arg: Partial<PresentationRequestIdentity>,
): PresentationRequestIdentity =>
  arg.presentationLocale !== undefined && arg.presentationGeneration !== undefined
    ? {
        presentationLocale: arg.presentationLocale,
        presentationGeneration: arg.presentationGeneration,
      }
    : presentationRequestIdentity();

const matchesIdentity = (
  state: ReportState,
  arg: Partial<PresentationRequestIdentity>,
): boolean =>
  arg.presentationGeneration === undefined ||
  (arg.presentationLocale === state.presentationLocale &&
    arg.presentationGeneration === state.presentationGeneration);

const reportSlice = createSlice({
  name: 'report',
  initialState,
  reducers: {
    clearReportMessages: (state) => {
      state.error = '';
      state.retestError = '';
      state.pdfError = '';
    },
    resetReport: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadReport.pending, (state, action) => {
        const identity = identityFor(action.meta.arg);
        state.presentationLocale = identity.presentationLocale;
        state.presentationGeneration = identity.presentationGeneration;
        state.reportCacheKey = presentationCacheKey(
          `report:${action.meta.arg.siteId}:${action.meta.arg.runId ?? 'latest'}`,
          identity,
        );
        state.loading = true;
        state.error = '';
        state.report = null;
        state.loaded = false;
        if (state.siteId !== action.meta.arg.siteId) {
          state.siteId = action.meta.arg.siteId;
          state.report = null;
          state.loaded = false;
          state.runId = null;
        }
      })
      .addCase(loadReport.fulfilled, (state, action) => {
        if (!matchesIdentity(state, action.meta.arg)) return;
        if (action.meta.arg.siteId !== state.siteId) return;
        state.loading = false;
        state.loaded = true;
        if ('noRun' in action.payload) {
          state.report = null;
          state.runId = null;
          state.runStatus = null;
          return;
        }
        state.runId = action.payload.runId;
        state.runStatus = action.payload.runStatus;
        state.report = action.payload.report ?? null;
      })
      .addCase(loadReport.rejected, (state, action) => {
        if (action.meta.aborted) return;
        if (!matchesIdentity(state, action.meta.arg)) return;
        if (action.meta.arg.siteId !== state.siteId) return;
        state.loading = false;
        state.error = action.payload ?? '';
      })
      .addCase(startRetest.pending, (state) => {
        state.retesting = true;
        state.retestError = '';
      })
      .addCase(startRetest.fulfilled, (state, action) => {
        state.retesting = false;
        state.runId = action.payload.run.id;
        state.runStatus = action.payload.run.status;
      })
      .addCase(startRetest.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.retesting = false;
        state.retestError = action.payload ?? '';
      })
      .addCase(pollRun.fulfilled, (state, action) => {
        if (!matchesIdentity(state, action.meta.arg)) return;
        state.runStatus = action.payload.status;
        state.runId = action.payload.id;
      })
      .addCase(loadRuns.pending, (state, action) => {
        const identity = identityFor(action.meta.arg);
        state.presentationLocale = identity.presentationLocale;
        state.presentationGeneration = identity.presentationGeneration;
        state.runsLoading = true;
        if (state.runsSiteId !== action.meta.arg.siteId) {
          state.runs = [];
          state.runsLoaded = false;
          state.runsSiteId = action.meta.arg.siteId;
        }
      })
      .addCase(loadRuns.fulfilled, (state, action) => {
        if (!matchesIdentity(state, action.meta.arg)) return;
        state.runsLoading = false;
        state.runsLoaded = true;
        state.runs = action.payload.runs;
      })
      .addCase(loadRuns.rejected, (state, action) => {
        if (action.meta.aborted || !matchesIdentity(state, action.meta.arg)) return;
        state.runsLoading = false;
      })
      .addCase(downloadReportPdf.pending, (state) => {
        state.pdfDownloading = true;
        state.pdfError = '';
      })
      .addCase(downloadReportPdf.fulfilled, (state) => {
        state.pdfDownloading = false;
      })
      .addCase(downloadReportPdf.rejected, (state, action) => {
        state.pdfDownloading = false;
        state.pdfError = action.payload ?? '';
      })
      .addCase(presentationLocaleChanged, (state, action) => {
        state.presentationLocale = action.payload.locale;
        state.presentationGeneration = action.payload.generation;
        state.reportCacheKey = presentationCacheKey(
          `report:${state.siteId ?? 'unselected'}:${state.runId ?? 'latest'}`,
          { presentationLocale: action.payload.locale },
        );
        state.report = null;
        state.loading = false;
        state.loaded = false;
        state.error = '';
        state.runsLoading = false;
        state.runsLoaded = false;
        state.runsSiteId = null;
        state.retestError = '';
        state.pdfError = '';
      });
  },
});

export const { clearReportMessages, resetReport } = reportSlice.actions;
export const reportReducer = reportSlice.reducer;
