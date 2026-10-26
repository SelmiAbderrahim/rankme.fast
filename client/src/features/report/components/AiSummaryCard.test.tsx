import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
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
  it('publishes accepted summary states so its owner can keep the report snapshot current', async () => {
    const onStateChange = vi.fn();
    mocked.generateAiSummaryRequest.mockResolvedValue(summaryState('succeeded', storedSummary));
    render(
      <I18nextProvider i18n={i18n}>
        <AiSummaryCard runId="run-1" initial={null} requestedLocale="en" onStateChange={onStateChange} />
      </I18nextProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('report-ai-summary-cta'));
      await Promise.resolve();
    });
    expect(onStateChange).toHaveBeenCalledWith(summaryState('succeeded', storedSummary), 'run-1');
  });
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
    // The raw provider model id is an operator detail, never end-user copy.
    expect(screen.queryByText(/model-1/)).toBeNull();
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

describe('AiSummaryCard — structured summaries, freshness and progress', () => {
  const structured: AuditReportAiSummary = {
    ...storedSummary,
    basisRuleIds: ['not-indexed', 'faq-content-missing'],
    structured: {
      status: 'One page to fix now.',
      items: [
        { ruleId: 'not-indexed', what: 'Three pages are not indexed.', why: 'They cannot appear in search.', firstStep: 'Inspect each URL.', whereToAct: 'google' },
        { ruleId: 'title-missing-or-weak', what: 'Titles are weak.', why: 'Readers see them first.', firstStep: 'Rewrite them.', whereToAct: 'report' },
      ],
    },
  };
  const renderWithRouter = (props: Partial<React.ComponentProps<typeof AiSummaryCard>> = {}) =>
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AiSummaryCard runId="run-1" siteId="site-1" initial={structured} requestedLocale="en" {...props} />
        </MemoryRouter>
      </I18nextProvider>,
    );

  it('renders the status, each item with where to act, and the evidence count', () => {
    renderWithRouter();
    expect(screen.getByTestId('report-ai-summary-status')).toHaveTextContent('One page to fix now.');
    const items = screen.getAllByTestId('report-ai-summary-item');
    expect(items).toHaveLength(2);
    const links = screen.getAllByTestId('report-ai-summary-act');
    expect(links[0]).toHaveAttribute('href', '/sites/site-1?tab=google');
    expect(links[1]).toHaveAttribute('href', '/sites/site-1?tab=report&finding=title-missing-or-weak');
    expect(screen.getByTestId('report-ai-summary-basis')).toBeInTheDocument();
    expect(screen.queryByTestId('report-ai-summary-stale')).not.toBeInTheDocument();
  });

  it('renders a status-only structured summary without an item list', () => {
    renderWithRouter({ initial: { ...structured, structured: { status: 'Nothing urgent.', items: [] } } });
    expect(screen.getByTestId('report-ai-summary-status')).toHaveTextContent('Nothing urgent.');
    expect(screen.queryByTestId('report-ai-summary-item')).not.toBeInTheDocument();
  });

  it('leaves out item links when no site is known', () => {
    renderWithRouter({ siteId: undefined });
    expect(screen.queryByTestId('report-ai-summary-act')).not.toBeInTheDocument();
  });

  it('hides a stale summary until asked, marks it, and offers to regenerate', async () => {
    const user = userEvent.setup();
    mocked.generateAiSummaryRequest.mockResolvedValue(summaryState('queued', structured));
    renderWithRouter({
      initialFreshness: { stale: true, reason: 'triage_changed', evidenceRuleIds: ['not-indexed'], changedRuleIds: ['not-indexed'] },
    });
    expect(screen.getByTestId('report-ai-summary-stale')).toBeInTheDocument();
    expect(screen.queryByTestId('report-ai-summary-status')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('report-ai-summary-toggle-previous'));
    expect(screen.getByTestId('report-ai-summary-stale-marker')).toBeInTheDocument();
    expect(screen.getByTestId('report-ai-summary-status')).toBeInTheDocument();
    expect(screen.queryByTestId('report-ai-summary-basis')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('report-ai-summary-toggle-previous'));
    expect(screen.queryByTestId('report-ai-summary-status')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('report-ai-summary-stale-regenerate'));
    expect(mocked.generateAiSummaryRequest).toHaveBeenCalledWith('run-1', 'en');
  });

  it('treats a decision taken on this page as stale, and renders text-only summaries muted when stale', async () => {
    const user = userEvent.setup();
    renderWithRouter({ initial: storedSummary, triageChanged: true });
    expect(screen.getByTestId('report-ai-summary-stale')).toBeInTheDocument();
    await user.click(screen.getByTestId('report-ai-summary-toggle-previous'));
    expect(screen.getByTestId('report-ai-summary-text')).toHaveClass('text-muted-foreground');
  });

  it('shows the server stage and elapsed time while a job runs', async () => {
    vi.useFakeTimers();
    mocked.fetchAiSummaryStateRequest.mockResolvedValue({
      ...summaryState('running', null),
      progress: { stage: 'writing_summary', requestedAt: '2026-07-03T00:00:00.000Z', startedAt: null, finishedAt: null, elapsedMs: 65_000, failureCode: null },
    });
    renderWithRouter({ initial: null, initialStatus: 'queued' });
    expect(screen.getByTestId('report-ai-summary-stage')).toHaveAttribute('data-stage', 'queued');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByTestId('report-ai-summary-stage')).toHaveAttribute('data-stage', 'writing_summary');
    expect(screen.getByTestId('report-ai-summary-elapsed')).toHaveTextContent('1:');
  });

  it('explains a failure by its code and offers to try again', async () => {
    const user = userEvent.setup();
    mocked.generateAiSummaryRequest.mockResolvedValue({
      ...summaryState('failed', null),
      progress: { stage: null, requestedAt: '2026-07-03T00:00:00.000Z', startedAt: null, finishedAt: '2026-07-03T00:00:12.000Z', elapsedMs: 12_000, failureCode: 'timeout' },
    });
    renderWithRouter({ initial: null });
    await user.click(screen.getByTestId('report-ai-summary-cta'));
    expect(await screen.findByTestId('report-ai-summary-error')).toHaveTextContent('took too long');
    mocked.generateAiSummaryRequest.mockResolvedValue(summaryState('succeeded', structured));
    await user.click(screen.getByTestId('report-ai-summary-try-again'));
    expect(await screen.findByTestId('report-ai-summary-status')).toBeInTheDocument();
    expect(screen.getByTestId('report-ai-summary-announcer')).toHaveTextContent('Your AI summary is ready.');
  });

  it('announces a failed generation without a code and falls back to the generic message', async () => {
    const user = userEvent.setup();
    mocked.generateAiSummaryRequest.mockResolvedValue(summaryState('queued', null));
    mocked.fetchAiSummaryStateRequest.mockResolvedValue(summaryState('failed', null));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithRouter({ initial: null });
    await user.click(screen.getByTestId('report-ai-summary-cta'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByTestId('report-ai-summary-error')).toBeInTheDocument();
    expect(screen.queryByTestId('report-ai-summary-try-again')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-ai-summary-announcer')).toHaveTextContent('could not be written');
  });
});
