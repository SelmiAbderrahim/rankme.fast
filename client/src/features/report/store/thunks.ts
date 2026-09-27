import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  downloadReportPdfRequest,
  fetchAuditRunsRequest,
  fetchLatestRunRequest,
  fetchReportRequest,
  fetchRunRequest,
  startAuditRequest,
} from '../api';
import { saveBlobAs } from '@features/report-export';
import { ApiError } from '@shared/api/client';
import { reportErrorMessage } from '../errorMessage';
import {
  presentationRequestIdentity,
  type PresentationRequestIdentity,
} from '@shared/i18n/requestIdentity';
import type {
  AuditReport,
  AuditRunListPage,
  PublicAuditRun,
  StartAuditResponse,
} from '../types';

export interface LoadReportArgs extends Partial<PresentationRequestIdentity> {
  siteId: string;
  runId?: string | undefined;
}

const requestIdentityFor = (
  input: Partial<PresentationRequestIdentity>,
): PresentationRequestIdentity =>
  input.presentationLocale !== undefined &&
  input.presentationGeneration !== undefined
    ? {
        presentationLocale: input.presentationLocale,
        presentationGeneration: input.presentationGeneration,
      }
    : presentationRequestIdentity();

const readInit = (identity: PresentationRequestIdentity, signal: AbortSignal) => ({
  ...identity,
  signal,
});

export interface LoadReportResult {
  siteId: string;
  runId: string;
  report: AuditReport | null;
  runStatus: PublicAuditRun['status'];
  /** Crawl ceiling of the resolved run (in-progress indicator). */
  pageCap?: number;
}

/**
 * Loads either the specified run's report OR — when no runId is given — the
 * latest run for the site. A site with no runs yet resolves to a "no run"
 * sentinel so the UI can prompt for the first audit.
 */
export const loadReport = createAsyncThunk<
  LoadReportResult | { siteId: string; noRun: true },
  LoadReportArgs,
  { rejectValue: string }
>('report/load', async (arg, { rejectWithValue, signal }) => {
  const { siteId, runId } = arg;
  const identity = requestIdentityFor(arg);
  try {
    let resolvedRunId = runId;
    let runStatus: PublicAuditRun['status'] = 'succeeded';
    if (!resolvedRunId) {
      const page: AuditRunListPage = await fetchLatestRunRequest(
        siteId,
        readInit(identity, signal),
      );
      const latest = page.runs[0];
      if (!latest) {
        return { siteId, noRun: true };
      }
      resolvedRunId = latest.id;
      runStatus = latest.status;
      if (runStatus !== 'succeeded') {
        return { siteId, runId: resolvedRunId, report: null, runStatus, pageCap: latest.pageCap };
      }
    } else {
      const { run } = await fetchRunRequest(resolvedRunId, readInit(identity, signal));
      runStatus = run.status;
      if (runStatus !== 'succeeded') {
        return { siteId, runId: resolvedRunId, report: null, runStatus, pageCap: run.pageCap };
      }
    }
    const report = await fetchReportRequest(resolvedRunId, readInit(identity, signal));
    return { siteId, runId: resolvedRunId, report, runStatus };
  } catch (err) {
    return rejectWithValue(reportErrorMessage(err, 'report:loadFailed'));
  }
});

export const startRetest = createAsyncThunk<
  StartAuditResponse,
  { siteId: string; requestedPageCap?: number },
  { rejectValue: string }
>('report/retest', async ({ siteId, requestedPageCap }, { rejectWithValue }) => {
  try {
    return await startAuditRequest(siteId, requestedPageCap);
  } catch (err) {
    return rejectWithValue(reportErrorMessage(err, 'report:retestFailed'));
  }
});

/**
 * Download the white-label PDF for a run (workstream B). A successful fetch
 * hands the bytes straight to the browser's download flow; a failure surfaces
 * the localized error next to the download affordance.
 */
export const downloadReportPdf = createAsyncThunk<
  void,
  { runId: string },
  { rejectValue: string }
>('report/downloadPdf', async ({ runId }, { rejectWithValue }) => {
  try {
    const blob = await downloadReportPdfRequest(runId);
    saveBlobAs(blob, `rankmefast-report-${runId}.pdf`);
  } catch (err) {
    return rejectWithValue(reportErrorMessage(err, 'report:pdf.error'));
  }
});

/** Load the site's recent audit runs for the report run-history block. */
export const loadRuns = createAsyncThunk<
  AuditRunListPage,
  { siteId: string } & Partial<PresentationRequestIdentity>,
  { rejectValue: string }
>('report/loadRuns', async (arg, { rejectWithValue, signal }) => {
  const { siteId } = arg;
  const identity = requestIdentityFor(arg);
  try {
    try {
      return await fetchAuditRunsRequest(siteId, 10, readInit(identity, signal));
    } catch (err) {
      // A page load fires several reads at once; a proxy rate limit or a
      // brief upstream hiccup answers one of them 429/5xx. Retry that read
      // once after a short pause instead of reporting the history as failed.
      if (!isTransientReadError(err) || signal.aborted) throw err;
      await waitFor(RUNS_RETRY_DELAY_MS, signal);
      return await fetchAuditRunsRequest(siteId, 10, readInit(identity, signal));
    }
  } catch (err) {
    return rejectWithValue(reportErrorMessage(err, 'report:history.loadFailed'));
  }
});

/** Pause before the single automatic retry of a transient history read. */
export const RUNS_RETRY_DELAY_MS = 800;
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
const isTransientReadError = (err: unknown): boolean =>
  err instanceof ApiError && TRANSIENT_STATUSES.has(err.status);
const waitFor = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export const pollRun = createAsyncThunk<
  PublicAuditRun,
  { runId: string } & Partial<PresentationRequestIdentity>,
  { rejectValue: string }
>('report/pollRun', async (arg, { rejectWithValue, signal }) => {
  const { runId } = arg;
  const identity = requestIdentityFor(arg);
  try {
    const { run } = await fetchRunRequest(runId, readInit(identity, signal));
    return run;
  } catch (err) {
    return rejectWithValue(reportErrorMessage(err, 'report:loadFailed'));
  }
});
