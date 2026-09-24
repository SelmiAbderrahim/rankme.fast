import { describe, expect, it } from 'vitest';
import { makeStore, rootReducer } from '@app/store';
import { initialState, reportReducer } from './slice';
import {
  selectReport,
  selectReportError,
  selectReportLoaded,
  selectReportLoading,
  selectReportPdfDownloading,
  selectReportPdfError,
  selectReportRetestError,
  selectReportRetesting,
  selectReportRunId,
  selectReportRuns,
  selectReportRunsSiteId,
  selectReportRunStatus,
  selectReportSiteId,
} from './selectors';

const readAll = (state: ReturnType<ReturnType<typeof makeStore>['getState']>) => ({
  report: selectReport(state),
  loading: selectReportLoading(state),
  loaded: selectReportLoaded(state),
  error: selectReportError(state),
  retesting: selectReportRetesting(state),
  retestError: selectReportRetestError(state),
  runId: selectReportRunId(state),
  siteId: selectReportSiteId(state),
  runStatus: selectReportRunStatus(state),
  runs: selectReportRuns(state),
  runsSiteId: selectReportRunsSiteId(state),
  pdfDownloading: selectReportPdfDownloading(state),
  pdfError: selectReportPdfError(state),
});

describe('report selectors', () => {
  it('falls back to the slice initial state before lazy reducer materialization', () => {
    expect(readAll(makeStore().getState())).toEqual({
      report: null,
      loading: false,
      loaded: false,
      error: '',
      retesting: false,
      retestError: '',
      runId: null,
      siteId: null,
      runStatus: null,
      runs: [],
      runsSiteId: null,
      pdfDownloading: false,
      pdfError: '',
    });
  });

  it('reads every value from a materialized report slice', () => {
    rootReducer.inject({ reducerPath: 'report', reducer: reportReducer });
    const report = {
      ...initialState,
      loading: true,
      loaded: true,
      error: 'load failed',
      retesting: true,
      retestError: 'retest failed',
      runId: 'run-1',
      siteId: 'site-1',
      runStatus: 'running' as const,
      runsSiteId: 'site-1',
      pdfDownloading: true,
      pdfError: 'pdf failed',
    };
    expect(readAll(makeStore({ report }).getState())).toMatchObject({
      loading: true,
      loaded: true,
      error: 'load failed',
      retesting: true,
      retestError: 'retest failed',
      runId: 'run-1',
      siteId: 'site-1',
      runStatus: 'running',
      runsSiteId: 'site-1',
      pdfDownloading: true,
      pdfError: 'pdf failed',
    });
  });
});
