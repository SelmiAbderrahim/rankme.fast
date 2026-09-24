/**
 * Unified report-export integration plus legacy white-label PDF thunk
 * compatibility coverage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ApiError } from '@shared/api/client';
import * as api from '../api';
import { saveBlobAs } from '../download';
import { reportReducer } from '../store/slice';
import { downloadReportPdf } from '../store/thunks';
import { ReportPage } from './ReportPage';
import type { AuditReport, ReportState } from '../types';

vi.mock('../api', () => ({
  fetchReportRequest: vi.fn(),
  fetchLatestRunRequest: vi.fn(),
  fetchRunRequest: vi.fn(),
  startAuditRequest: vi.fn(),
  generateAiSummaryRequest: vi.fn(),
  downloadReportPdfRequest: vi.fn(),
}));

vi.mock('../download', () => ({
  saveBlobAs: vi.fn(),
}));

const reportExportMock = vi.hoisted(() => ({
  control: vi.fn(),
  saveBlobAs: vi.fn(),
}));

vi.mock('@features/report-export', () => ({
  ReportExportControl: (props: unknown) => {
    reportExportMock.control(props);
    return <button data-testid="report-export-control">Export or share</button>;
  },
  saveBlobAs: reportExportMock.saveBlobAs,
}));

const mocked = vi.mocked(api);

const makeReport = (): AuditReport => ({
  runId: 'run-1',
  counts: { fixNow: 0, watch: 0, passed: 1 },
  findings: [
    {
      ruleId: 'llms-txt-missing',
      bucket: 'passed',
      severity: 'info',
      affectedUrls: [],
      copy: {
        titleKey: 'auditRules.llms-txt-missing.title',
        whyKey: 'auditRules.llms-txt-missing.why',
        fixKey: 'auditRules.llms-txt-missing.fix',
        passedLabelKey: 'auditRules.llms-txt-missing.passedLabel',
        title: 'llms.txt file not published',
        why: 'llms.txt is emerging.',
        fix: 'Publish a short llms.txt.',
        passedLabel: 'Your llms.txt file is published.',
      },
    },
  ],
  diff: { entries: [], summary: { fixed: 0, regressed: 0, new: 0, unchanged: 0 } },
  pageSpeed: null,
});

const baseState = (): ReportState => reportReducer(undefined, { type: '@@init' });

const makeStore = (preloaded?: Partial<ReportState>) =>
  configureStore({
    reducer: { report: reportReducer },
    preloadedState: {
      report: {
        ...baseState(),
        loaded: true,
        siteId: 'site-1',
        runId: 'run-1',
        // null keeps the "refetch after a finished run" effect quiet so the
        // suite renders purely from the seeded state.
        runStatus: null,
        report: makeReport(),
        ...preloaded,
      },
    },
  });

type Store = ReturnType<typeof makeStore>;

const renderPage = (store: Store = makeStore()) => {
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/sites/site-1/report']}>
          <Routes>
            <Route path="/sites/:siteId/report" element={<ReportPage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return store;
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
});

describe('report export control', () => {
  it('renders the unified control with the active report selection', () => {
    renderPage();
    expect(screen.getByTestId('report-export-control')).toBeInTheDocument();
    expect(reportExportMock.control).toHaveBeenLastCalledWith({
      kind: 'audit.run',
      target: { scope: 'site_resource', siteId: 'site-1', resourceId: 'run-1' },
      selection: { buckets: ['fixNow'] },
    });
  });

  it('does not render the control before a report exists', () => {
    renderPage(makeStore({ report: null, runId: null, runStatus: null }));
    expect(screen.queryByTestId('report-export-control')).not.toBeInTheDocument();
    expect(reportExportMock.control).not.toHaveBeenCalled();
  });
});

describe('downloadReportPdf thunk (store-level)', () => {
  it('downloads the blob and hands it to saveBlobAs', async () => {
    const blob = new Blob(['%PDF-'], { type: 'application/pdf' });
    mocked.downloadReportPdfRequest.mockResolvedValue(blob);
    const store = makeStore();
    await store.dispatch(downloadReportPdf({ runId: 'run-1' }));
    expect(mocked.downloadReportPdfRequest).toHaveBeenCalledWith('run-1');
    expect(reportExportMock.saveBlobAs).toHaveBeenCalledWith(
      blob,
      'rankmefast-report-run-1.pdf',
    );
  });

  it('sets pending state while the PDF is prepared', () => {
    const store = makeStore({ pdfError: 'old error' });
    store.dispatch(downloadReportPdf.pending('req-0', { runId: 'run-1' }));
    expect(store.getState().report.pdfDownloading).toBe(true);
    expect(store.getState().report.pdfError).toBe('');
  });

  it('stores a localized server error', async () => {
    mocked.downloadReportPdfRequest.mockRejectedValue(
      new ApiError('status 500', 500, { error: { message: 'Rapport indisponible.' } }),
    );
    const store = makeStore();
    await store.dispatch(downloadReportPdf({ runId: 'run-1' }));
    expect(store.getState().report.pdfError).toBe('Rapport indisponible.');
  });

  it('uses the localized fallback for a non-API failure', async () => {
    mocked.downloadReportPdfRequest.mockRejectedValue(new Error('network down'));
    const store = makeStore();
    await store.dispatch(downloadReportPdf({ runId: 'run-1' }));
    expect(store.getState().report.pdfError).toBe(
      'Could not prepare the PDF. Please try again.',
    );
  });

  it('treats a payload-less rejection as a plain failure', () => {
    const store = makeStore();
    store.dispatch(
      downloadReportPdf.rejected(new Error('aborted'), 'req-1', { runId: 'run-1' }),
    );
    expect(store.getState().report.pdfError).toBe('');
    expect(store.getState().report.pdfDownloading).toBe(false);
  });

  it('clears the downloading flag after a later successful download', async () => {
    const store = makeStore({ pdfError: 'old error' });
    mocked.downloadReportPdfRequest.mockResolvedValue(
      new Blob(['%PDF-'], { type: 'application/pdf' }),
    );
    await store.dispatch(downloadReportPdf({ runId: 'run-1' }));
    expect(store.getState().report.pdfError).toBe('');
    expect(store.getState().report.pdfDownloading).toBe(false);
  });
});

describe('saveBlobAs', () => {
  it('creates, clicks, and cleans up a temporary object-URL anchor', async () => {
    // Use the real implementation for this one test.
    const actual = await vi.importActual<
      typeof import('../../report-export/download')
    >('../../report-export/download');
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    try {
      actual.saveBlobAs(new Blob(['x']), 'file.pdf');
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
      expect(document.querySelector('a[download="file.pdf"]')).toBeNull();
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('is mocked for the component suite', () => {
    expect(vi.isMockFunction(saveBlobAs)).toBe(true);
  });
});
