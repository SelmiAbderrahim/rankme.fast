import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { ApiError } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from '../api';
import type {
  AuditReportAiSummary,
  AuditSummaryState,
  AuditSummaryStatus,
} from '../types';
import { AiSummaryCard } from './AiSummaryCard';

vi.mock('../api', () => ({
  fetchAiSummaryStateRequest: vi.fn(),
  generateAiSummaryRequest: vi.fn(),
  fetchReportRequest: vi.fn(),
  fetchLatestRunRequest: vi.fn(),
  fetchRunRequest: vi.fn(),
  startAuditRequest: vi.fn(),
}));

const mocked = vi.mocked(api);

const storedSummary: AuditReportAiSummary = {
  text: 'You should fix your titles first.',
  locale: 'en',
  model: 'model-1',
  truncated: false,
  createdAt: '2026-07-03T00:00:00.000Z',
};

const summaryState = (
  status: AuditSummaryStatus,
  aiSummary: AuditReportAiSummary | null,
): AuditSummaryState => ({
  status,
  aiSummary,
  requestedLocale: 'en',
  availableLocales: aiSummary ? ['en'] : [],
});

const renderCard = (
  initial: AuditReportAiSummary | null = null,
  initialStatus?: AuditSummaryStatus,
) =>
  render(
    <I18nextProvider i18n={i18n}>
      <AiSummaryCard
        runId="run-1"
        initial={initial}
        initialStatus={initialStatus}
        requestedLocale="en"
      />
    </I18nextProvider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AiSummaryCard', () => {
  it('renders the CTA and docs link when no summary exists', () => {
    renderCard();
    expect(screen.getByTestId('report-ai-summary-cta')).toHaveTextContent('Summarize my fixes');
    expect(screen.queryByTestId('report-ai-summary-regenerate')).toBeNull();
    expect(screen.getByTestId('docs-link-ai-summary')).toHaveAttribute('href', '/docs/ai-summary');
  });

  it('renders a stored summary, attribution, and regeneration control', () => {
    renderCard(storedSummary);
    expect(screen.getByTestId('report-ai-summary-text')).toHaveTextContent(storedSummary.text);
    expect(screen.getByTestId('report-ai-summary-regenerate')).toBeInTheDocument();
    expect(screen.getByText(/AI-generated/)).toBeInTheDocument();
    expect(screen.getByText(/model-1/)).toBeInTheDocument();
    expect(screen.queryByTestId('report-ai-summary-truncated')).toBeNull();
  });

  it('renders the shortened note for truncated summaries', () => {
    renderCard({ ...storedSummary, text: 'Partial…', truncated: true });
    expect(screen.getByTestId('report-ai-summary-truncated')).toHaveTextContent(
      'Summary was shortened.',
    );
  });

  it('enqueues, shows loading, polls, and renders the completed summary', async () => {
    vi.useFakeTimers();
    mocked.generateAiSummaryRequest.mockResolvedValue(summaryState('queued', null));
    mocked.fetchAiSummaryStateRequest.mockResolvedValue(
      summaryState('succeeded', { ...storedSummary, text: 'Fresh summary.' }),
    );
    renderCard();
    await act(async () => {
      fireEvent.click(screen.getByTestId('report-ai-summary-cta'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('report-ai-summary-loading')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('report-ai-summary-text')).toHaveTextContent('Fresh summary.');
    expect(screen.queryByTestId('report-ai-summary-loading')).toBeNull();
  });

  it('resumes polling after refresh and continues while the server remains active', async () => {
    vi.useFakeTimers();
    mocked.fetchAiSummaryStateRequest
      .mockResolvedValueOnce(summaryState('running', null))
      .mockResolvedValueOnce(summaryState('succeeded', storedSummary));
    renderCard(null, 'running');
    expect(screen.getByTestId('report-ai-summary-loading')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocked.fetchAiSummaryStateRequest).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('report-ai-summary-text')).toHaveTextContent(storedSummary.text);
  });

  it('keeps the previous summary visible while regeneration runs, then replaces it', async () => {
    vi.useFakeTimers();
    mocked.generateAiSummaryRequest.mockResolvedValue(summaryState('queued', storedSummary));
    mocked.fetchAiSummaryStateRequest.mockResolvedValue(
      summaryState('succeeded', { ...storedSummary, text: 'Second pass.' }),
    );
    renderCard(storedSummary, 'succeeded');
    await act(async () => {
      fireEvent.click(screen.getByTestId('report-ai-summary-regenerate'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('report-ai-summary-text')).toHaveTextContent(storedSummary.text);
    expect(screen.getByTestId('report-ai-summary-loading')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('report-ai-summary-text')).toHaveTextContent('Second pass.');
  });

  it('ignores a generation response for a different locale', async () => {
    mocked.generateAiSummaryRequest.mockResolvedValue({
      ...summaryState('succeeded', { ...storedSummary, text: 'Résumé français.' }),
      requestedLocale: 'fr',
      availableLocales: ['fr'],
    });
    renderCard();

    await userEvent.click(screen.getByTestId('report-ai-summary-cta'));

    expect(screen.queryByText('Résumé français.')).toBeNull();
    expect(screen.getByTestId('report-ai-summary-loading')).toBeInTheDocument();
  });

  it('shows the unavailable message when polling fails or the durable job failed', async () => {
    vi.useFakeTimers();
    mocked.fetchAiSummaryStateRequest.mockRejectedValue(new TypeError('offline'));
    const first = renderCard(null, 'running');
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('report-ai-summary-error')).toHaveTextContent(/unaffected/i);
    first.unmount();
    renderCard(null, 'failed');
    expect(screen.getByTestId('report-ai-summary-error')).toHaveTextContent(/unaffected/i);
  });

  it('maps POST failures to cap-reached or generic unavailable messages', async () => {
    mocked.generateAiSummaryRequest.mockRejectedValueOnce(
      new ApiError('cap', 402, { error: 'capReached' }),
    );
    const first = renderCard();
    await userEvent.click(screen.getByTestId('report-ai-summary-cta'));
    expect(await screen.findByTestId('report-ai-summary-error')).toHaveTextContent(
      /monthly AI summary limit/i,
    );
    first.unmount();

    mocked.generateAiSummaryRequest.mockRejectedValueOnce(new TypeError('offline'));
    renderCard();
    await userEvent.click(screen.getByTestId('report-ai-summary-cta'));
    expect(await screen.findByTestId('report-ai-summary-error')).toHaveTextContent(/unaffected/i);
  });

  it('shows a failed response and aborts an in-flight poll on unmount', async () => {
    vi.useFakeTimers();
    mocked.generateAiSummaryRequest.mockResolvedValue(summaryState('failed', null));
    const first = renderCard();
    await act(async () => {
      fireEvent.click(screen.getByTestId('report-ai-summary-cta'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('report-ai-summary-error')).toHaveTextContent(/unaffected/i);
    first.unmount();

    mocked.fetchAiSummaryStateRequest.mockImplementation(
      (_runId, _locale, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const second = renderCard(null, 'running');
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    const signal = mocked.fetchAiSummaryStateRequest.mock.calls[0]?.[2]?.signal;
    second.unmount();
    expect(signal?.aborted).toBe(true);

    let resolvePoll:
      | ((value: AuditSummaryState) => void)
      | undefined;
    mocked.fetchAiSummaryStateRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );
    const third = renderCard(null, 'running');
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    third.unmount();
    await act(async () => {
      resolvePoll?.(summaryState('succeeded', storedSummary));
      await Promise.resolve();
    });
  });
});
