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
import { ApiError } from '@shared/api/client';
import userEvent from '@testing-library/user-event';
import { RUNS_RETRY_DELAY_MS } from '../store/thunks';
import { presentationLocaleChanged } from '@shared/i18n/requestIdentity';

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

  it('shows an error with a retry instead of the empty state when the load fails (issue #4)', async () => {
    mocked.fetchAuditRunsRequest.mockRejectedValueOnce(new Error('boom'));
    renderRH(makeStore());
    expect(await screen.findByTestId('report-run-history-error')).toHaveTextContent(
      "We couldn't load your audit history.",
    );
    expect(screen.queryByTestId('report-run-history-empty')).toBeNull();
    // Non-transient failures are not retried automatically.
    expect(mocked.fetchAuditRunsRequest).toHaveBeenCalledTimes(1);

    mocked.fetchAuditRunsRequest.mockResolvedValueOnce({ runs: [run('r-5')], nextCursor: null });
    await userEvent.setup().click(screen.getByTestId('report-run-history-retry'));
    expect(await screen.findByTestId('report-run-r-5')).toBeInTheDocument();
    expect(screen.queryByTestId('report-run-history-error')).toBeNull();
  });

  it('retries a transient 503 once before showing anything (issue #4)', async () => {
    mocked.fetchAuditRunsRequest
      .mockRejectedValueOnce(new ApiError('Service unavailable', 503, null))
      .mockResolvedValueOnce({ runs: [run('r-6')], nextCursor: null });
    renderRH(makeStore());
    expect(screen.getByTestId('report-run-history-loading')).toHaveTextContent('Loading audit history…');
    expect(
      await screen.findByTestId('report-run-r-6', {}, { timeout: RUNS_RETRY_DELAY_MS + 2000 }),
    ).toBeInTheDocument();
    expect(mocked.fetchAuditRunsRequest).toHaveBeenCalledTimes(2);
  });

  it('surfaces the error when the transient retry fails too, and refetches on the next mount', async () => {
    mocked.fetchAuditRunsRequest.mockRejectedValue(new ApiError('Too many requests', 429, null));
    const store = makeStore();
    const first = renderRH(store);
    expect(
      await screen.findByTestId('report-run-history-error', {}, { timeout: RUNS_RETRY_DELAY_MS + 2000 }),
    ).toBeInTheDocument();
    expect(mocked.fetchAuditRunsRequest).toHaveBeenCalledTimes(2);
    first.unmount();

    // Client-side navigation back to the report must not replay the failure.
    mocked.fetchAuditRunsRequest.mockReset();
    mocked.fetchAuditRunsRequest.mockResolvedValue({ runs: [run('r-7')], nextCursor: null });
    renderRH(store);
    expect(await screen.findByTestId('report-run-r-7')).toBeInTheDocument();
  });

  it('stops waiting to retry when the read is aborted by an unmount', async () => {
    mocked.fetchAuditRunsRequest.mockRejectedValueOnce(new ApiError('Bad gateway', 502, null));
    const store = makeStore();
    const view = renderRH(store);
    await waitFor(() => expect(mocked.fetchAuditRunsRequest).toHaveBeenCalledTimes(1));
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, RUNS_RETRY_DELAY_MS + 100));
    expect(mocked.fetchAuditRunsRequest).toHaveBeenCalledTimes(1);
    expect(store.getState().report.runsError).toBe('');
  });

  it('refetches on remount when the first read was aborted mid-flight (issue #4)', async () => {
    // The report page swaps to its skeleton while it reloads, unmounting the
    // card and aborting its read. The next mount must fetch again instead of
    // waiting forever on "Loading audit history…".
    let signalOfFirst: AbortSignal | undefined;
    mocked.fetchAuditRunsRequest.mockImplementationOnce(
      (_siteId, _limit, init) =>
        new Promise((_resolve, reject) => {
          signalOfFirst = init?.signal ?? undefined;
          signalOfFirst?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const store = makeStore();
    const first = renderRH(store);
    await waitFor(() => expect(mocked.fetchAuditRunsRequest).toHaveBeenCalledTimes(1));
    first.unmount();
    await waitFor(() => expect(signalOfFirst?.aborted).toBe(true));
    await waitFor(() => expect(store.getState().report.runsLoading).toBe(false));

    mocked.fetchAuditRunsRequest.mockResolvedValueOnce({ runs: [run('r-10')], nextCursor: null });
    renderRH(store);
    expect(await screen.findByTestId('report-run-r-10')).toBeInTheDocument();
    expect(mocked.fetchAuditRunsRequest).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('report-run-history-loading')).toBeNull();
  });

  it('refetches after a locale change aborts the in-flight read', async () => {
    mocked.fetchAuditRunsRequest.mockImplementationOnce(
      (_siteId, _limit, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    mocked.fetchAuditRunsRequest.mockResolvedValue({ runs: [run('r-11')], nextCursor: null });
    const store = makeStore();
    renderRH(store);
    await waitFor(() => expect(mocked.fetchAuditRunsRequest).toHaveBeenCalledTimes(1));
    store.dispatch(
      presentationLocaleChanged({
        locale: 'en',
        generation: 7,
        refreshGeneration: 7,
        reason: 'stale-mutation',
      }),
    );
    expect(await screen.findByTestId('report-run-r-11')).toBeInTheDocument();
    expect(mocked.fetchAuditRunsRequest).toHaveBeenCalledTimes(2);
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
