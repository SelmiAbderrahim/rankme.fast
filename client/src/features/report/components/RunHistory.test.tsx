import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { reportReducer } from '../store/slice';
import type { PublicAuditRun, ReportState } from '../types';
import { RunHistory } from './RunHistory';
import * as api from '../api';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  fetchAuditRunsRequest: vi.fn(),
}));
const mocked = vi.mocked(api);

const run = (
  id: string,
  status: PublicAuditRun['status'] = 'succeeded',
): PublicAuditRun => ({
  id,
  siteId: 's1',
  status,
  pageCap: 25,
  pagesCrawled: 10,
  vendorTaskId: null,
  startedAt: null,
  finishedAt: null,
  error: null,
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
});

const makeStore = (report?: Partial<ReportState>) =>
  configureStore({
    reducer: { report: reportReducer },
    preloadedState: report
      ? { report: { ...reportReducer(undefined, { type: '@@init' }), ...report } }
      : undefined,
  });

const renderRH = (store: ReturnType<typeof makeStore>, siteId = 's1') =>
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <RunHistory siteId={siteId} />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
});

describe('RunHistory', () => {
  it('loads and lists recent runs, each deep-linking to its run', async () => {
    mocked.fetchAuditRunsRequest.mockResolvedValue({
      runs: [run('r-1'), run('r-2', 'failed')],
      nextCursor: null,
    });
    renderRH(makeStore());
    expect(await screen.findByTestId('report-run-r-1')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'View this run' })[0]).toHaveAttribute(
      'href',
      '/sites/s1/report/r-1',
    );
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows an empty message when there are no runs', async () => {
    mocked.fetchAuditRunsRequest.mockResolvedValue({ runs: [], nextCursor: null });
    renderRH(makeStore());
    expect(await screen.findByTestId('report-run-history-empty')).toBeInTheDocument();
  });

  it('does not throw when the runs load fails', async () => {
    mocked.fetchAuditRunsRequest.mockRejectedValue(new Error('boom'));
    renderRH(makeStore());
    await waitFor(() => expect(mocked.fetchAuditRunsRequest).toHaveBeenCalled());
    expect(screen.getByTestId('report-run-history-empty')).toBeInTheDocument();
  });

  it('does not refetch when runs are already loaded for the same site', () => {
    const store = makeStore({ runs: [run('r-9')], runsSiteId: 's1', runsLoaded: true });
    renderRH(store);
    expect(mocked.fetchAuditRunsRequest).not.toHaveBeenCalled();
    expect(screen.getByTestId('report-run-r-9')).toBeInTheDocument();
  });

  it('refetches and resets when the preloaded runs belong to a different site', async () => {
    mocked.fetchAuditRunsRequest.mockResolvedValue({ runs: [run('r-3')], nextCursor: null });
    const store = makeStore({ runs: [run('old')], runsSiteId: 'other', runsLoaded: true });
    renderRH(store, 's1');
    expect(await screen.findByTestId('report-run-r-3')).toBeInTheDocument();
    expect(screen.queryByTestId('report-run-old')).toBeNull();
  });
});
