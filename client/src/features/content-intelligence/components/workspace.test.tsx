import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { ApiError } from '@shared/api/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import commonEn from '@shared/i18n/locales/en/common.json';
import en from '@shared/i18n/locales/en/contentIntelligence.json';
import type { ContentAnalysis } from '../types';
import { analysisStatusReceived, initialState, updateFormDraft } from '../store/slice';

const hooks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
}));

const api = vi.hoisted(() => ({
  listAnalyses: vi.fn(),
  getAnalysis: vi.fn(),
  preflightAnalysis: vi.fn(),
  startAnalysis: vi.fn(),
  cancelAnalysis: vi.fn(),
  regenerateAnalysis: vi.fn(),
  getAnalysisStatus: vi.fn(),
  getAnalysisRetryPreview: vi.fn(),
  retryAnalysis: vi.fn(),
  saveDraftVersion: vi.fn(),
  saveBriefVersion: vi.fn(),
}));

const suggestionsApi = vi.hoisted(() => ({
  fetchPagesList: vi.fn(),
  fetchTrackedKeywords: vi.fn(),
}));

vi.mock('@shared/hooks/redux', () => ({
  useAppDispatch: () => hooks.dispatch,
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) => selector(hooks.state),
}));

vi.mock('@features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/auth')>()),
  useAuthSession: () => ({
    authenticated: true,
    isPending: false,
    emailVerified: true,
    user: { id: 'account-a' },
  }),
}));

vi.mock('../api', () => api);
vi.mock('@features/pages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/pages')>()),
  fetchPagesList: suggestionsApi.fetchPagesList,
}));
vi.mock('@features/ranks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/ranks')>()),
  fetchTrackedKeywords: suggestionsApi.fetchTrackedKeywords,
}));

vi.mock('./RecommendationWorkflow', () => ({
  RecommendationWorkflow: ({ onChanged }: { onChanged: () => void }) => (
    <button type="button" onClick={onChanged}>refresh recommendations</button>
  ),
}));

vi.mock('@features/content-briefs', () => ({
  ContentBriefsPanel: ({ siteId }: { siteId: string }) => (
    <div data-testid="content-briefs-workspace-seam" data-site-id={siteId} />
  ),
}));

vi.mock('@features/report-export', () => ({
  ReportExportControl: ({
    kind,
    target,
    selection,
  }: {
    kind: string;
    target: { resourceId: string };
    selection: { sections?: string[] };
  }) => (
    <div
      data-testid="report-export-control"
      data-kind={kind}
      data-resource-id={target.resourceId}
      data-sections={selection.sections?.join(',') ?? ''}
    />
  ),
}));

import { AnalysisDetail } from './AnalysisDetail';
import { AnalysisList } from './AnalysisList';
import { ContentIntelligencePage } from './ContentIntelligencePage';
import { ContentIntelligencePanel } from './ContentIntelligencePanel';
import { NewAnalysisForm } from './NewAnalysisForm';

const i18n = i18next.createInstance();
await i18n.init({
  lng: 'en',
  resources: { en: { common: commonEn, contentIntelligence: en } },
  interpolation: { escapeValue: false },
});

function analysis(overrides: Partial<ContentAnalysis> = {}): ContentAnalysis {
  return {
    analysisId: 'a1',
    siteId: 's1',
    ownedUrl: 'https://example.com/guide',
    keyword: 'content audit',
    locale: 'en',
    status: 'completed',
    stages: [],
    warnings: [],
    scorecard: null,
    schemaVersion: '2026-07-15.1',
    scorecardV2: null,
    owned: { url: 'https://example.com/guide', contentHash: 'hash' },
    recommendations: [],
    recommendationStates: [],
    brief: null,
    draft: null,
    citations: [],
    error: null,
    reservation: { key: 'k', reservedUnits: 1, refundedAt: null, refundReason: null },
    costMicros: 0,
    aiCostMicros: 0,
    requestedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

const RUNNING_PROGRESS = {
  terminal: false,
  stepIndex: 2,
  stepCount: 7,
  stepKey: 'collecting_owned' as const,
  failureReasonCode: null,
  retryAction: null,
};

const FAILED_ERROR = {
  category: 'provider_unavailable' as const,
  messageKey: 'contentIntelligence.errors.providerUnavailable',
  retryable: false,
  terminal: true,
};

const FAILED_PROGRESS = {
  ...RUNNING_PROGRESS,
  terminal: true,
  failureReasonCode: 'provider_unavailable' as const,
  retryAction: 'retry' as const,
};

function retryPreview() {
  return {
    analysisId: 'a1',
    ownedUrl: 'https://example.com/guide',
    keyword: 'content audit',
    failureReasonCode: 'provider_unavailable',
  };
}

function setState(contentOverrides: Partial<typeof initialState> = {}) {
  hooks.state = {
    contentIntelligence: { ...initialState, siteId: 's1', ...contentOverrides },
  };
}

function installThunkDispatch() {
  hooks.dispatch.mockImplementation((action: unknown) => {
    if (typeof action === 'function') {
      return action(hooks.dispatch, () => hooks.state, undefined);
    }
    return action;
  });
}

function renderInRouter(node: React.ReactNode, path = '/sites/s1?tab=content') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.useRealTimers();
  hooks.dispatch.mockReset();
  for (const mock of Object.values(api)) mock.mockReset();
  api.listAnalyses.mockResolvedValue({ items: [], nextCursor: null });
  api.getAnalysis.mockResolvedValue(analysis());
  api.preflightAnalysis.mockResolvedValue({ ok: true, reason: null });
  api.startAnalysis.mockResolvedValue({ analysisId: 'started', status: 'queued', duplicate: false, message: 'ok' });
  api.cancelAnalysis.mockResolvedValue({ ok: true });
  api.getAnalysisStatus.mockResolvedValue({ analysisId: 'a1', status: 'scoring', ...RUNNING_PROGRESS });
  api.regenerateAnalysis.mockResolvedValue({ analysisId: 'regenerated', status: 'queued', duplicate: false, message: 'ok' });
  api.saveDraftVersion.mockResolvedValue({
    version: {
      versionId: 'saved-v1',
      markdown: 'changed words here',
      wordCount: 3,
      savedAt: '2026-07-02T00:00:00Z',
    },
  });
  api.saveBriefVersion.mockResolvedValue({
    version: {
      versionId: 'brief-saved-v1',
      sections: [
        { heading: 'Updated plan', body: 'Updated guidance' },
        { heading: 'Second plan', body: 'Second guidance' },
      ],
      savedAt: '2026-07-02T00:00:00Z',
    },
  });
  suggestionsApi.fetchPagesList.mockReset();
  suggestionsApi.fetchTrackedKeywords.mockReset();
  suggestionsApi.fetchPagesList.mockResolvedValue({
    items: [{ url: 'https://example.com/from-pages' }],
    nextCursor: null,
  });
  suggestionsApi.fetchTrackedKeywords.mockResolvedValue({
    keywords: [{ phrase: 'tracked query' }],
  });
  setState();
  installThunkDispatch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AnalysisList', () => {
  it('renders loading, error/retry, and empty/new states', async () => {
    setState({ listLoading: true, listLoaded: false });
    const first = renderInRouter(<AnalysisList siteId="s1" onOpen={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByTestId('content-analysis-list')).toHaveTextContent('Content analyses');
    expect(first.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    first.unmount();

    const retry = vi.fn();
    hooks.dispatch.mockImplementation((action: unknown) => {
      retry(action);
      return typeof action === 'function'
        ? action(hooks.dispatch, () => hooks.state, undefined)
        : action;
    });
    setState({ listLoaded: true, listError: 'network error' });
    const second = renderInRouter(<AnalysisList siteId="s1" onOpen={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByTestId('content-list-error')).toHaveTextContent('network error');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalled();
    second.unmount();

    setState({ listLoaded: true });
    const onNew = vi.fn();
    renderInRouter(<AnalysisList siteId="s1" onOpen={vi.fn()} onNew={onNew} />);
    await userEvent.click(screen.getByTestId('content-list-empty-cta'));
    expect(onNew).toHaveBeenCalled();
  });

  it('renders all status variants, scores, dates, pagination, open, and polling', async () => {
    vi.useFakeTimers();
    const items = [
      analysis({ analysisId: 'complete', status: 'completed', requestedAt: '2026-07-15T00:00:00Z', completedAt: '2026-07-16T00:00:00Z', scorecard: { readabilityScore: 90, coverageScore: 60, structureScore: 30, warnings: [] } }),
      analysis({ analysisId: 'failed', status: 'failed' }),
      analysis({ analysisId: 'cancelled', status: 'cancelled' }),
      analysis({ analysisId: 'partial', status: 'partial' }),
      analysis({
        analysisId: 'queued',
        status: 'queued',
        stages: [{ name: 'queued', startedAt: '2026-07-01T00:00:00Z', completedAt: '2026-07-01T00:00:01Z', error: null }],
        warnings: [{ code: 'competitors_partial', messageKey: 'x', message: 'Some competitors were unavailable.' }],
        scorecardV2: {
          version: 'v2',
          total: 71,
          sections: [],
        },
      }),
    ];
    setState({ analyses: items, nextCursor: 'next', listLoaded: true });
    const onOpen = vi.fn();
    const view = renderInRouter(<AnalysisList siteId="s1" onOpen={onOpen} onNew={vi.fn()} />);
    expect(screen.getByTestId('content-row-complete')).toHaveTextContent('60');
    expect(screen.getByTestId('content-row-failed')).toHaveTextContent('Failed');
    expect(screen.getByTestId('content-row-cancelled')).toHaveTextContent('Cancelled');
    expect(screen.getByTestId('content-row-partial')).toHaveTextContent('Partial');
    const mobileComplete = within(screen.getByTestId('content-card-complete'));
    expect(mobileComplete.getByText('Completed')).toBeInTheDocument();
    expect(mobileComplete.getByText('60')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]!);
    expect(onOpen).toHaveBeenCalledWith('complete');
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel analysis' }));
    expect(api.cancelAnalysis).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('content-list-load-more'));
    await vi.advanceTimersByTimeAsync(8000);
    expect(api.listAnalyses.mock.calls.length).toBeGreaterThanOrEqual(3);
    view.unmount();

    setState({ analyses: [analysis()], nextCursor: null, listLoaded: true });
    const noCursor = renderInRouter(<AnalysisList siteId="s1" onOpen={vi.fn()} onNew={vi.fn()} />);
    expect(screen.queryByTestId('content-list-load-more')).toBeNull();
    noCursor.unmount();
  });

  it('hides stale-site rows and pauses, resumes, then aborts an active poll', async () => {
    vi.useFakeTimers();
    const setVisibility = (value: 'hidden' | 'visible') =>
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => value,
      });

    setState({
      siteId: 'other-site',
      analyses: [analysis({ status: 'queued' })],
      nextCursor: 'stale',
      listLoaded: true,
      listError: 'stale error',
    });
    const stale = renderInRouter(<AnalysisList siteId="s1" onOpen={vi.fn()} onNew={vi.fn()} />);
    expect(screen.queryByTestId('content-row-a1')).toBeNull();
    expect(stale.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    stale.unmount();

    setVisibility('hidden');
    setState({ analyses: [analysis({ status: 'queued' })], listLoaded: true });
    api.listAnalyses
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockImplementationOnce((_payload, init) => new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        void resolve;
      }));
    const view = renderInRouter(<AnalysisList siteId="s1" onOpen={vi.fn()} onNew={vi.fn()} />);
    api.listAnalyses.mockClear();
    await vi.advanceTimersByTimeAsync(8000);
    fireEvent(document, new Event('visibilitychange'));
    expect(api.listAnalyses).not.toHaveBeenCalled();
    setVisibility('visible');
    fireEvent(document, new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(4000);
    expect(api.listAnalyses).toHaveBeenCalledTimes(1);
    const signal = api.listAnalyses.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await vi.runAllTimersAsync();
    setVisibility('visible');
  });
});

describe('NewAnalysisForm', () => {
  it('applies a deep-link draft only after the content store rekeys to its site', async () => {
    const prefill = {
      ownedUrl: 'https://example.com/reviewed',
      keyword: 'reviewed handoff',
    };
    setState({ siteId: 'old-site' });
    const form = () => (
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <NewAnalysisForm siteId="s1" prefill={prefill} />
        </MemoryRouter>
      </I18nextProvider>
    );
    const view = render(form());
    expect(hooks.dispatch).not.toHaveBeenCalledWith(updateFormDraft(prefill));

    hooks.state = {
      ...hooks.state,
      contentIntelligence: {
        ...(hooks.state.contentIntelligence as typeof initialState),
        siteId: 's1',
      },
    };
    view.rerender(form());
    await waitFor(() => expect(hooks.dispatch).toHaveBeenCalledWith(updateFormDraft(prefill)));
  });

  it('initializes detected locale plus prefills and lists every included deliverable', async () => {
    renderInRouter(
      <NewAnalysisForm
        siteId="s1"
        prefill={{ ownedUrl: 'https://example.com/p', keyword: 'prefilled', locale: 'de' }}
      />,
    );
    await waitFor(() => expect(hooks.dispatch).toHaveBeenCalledWith(updateFormDraft({ ownedUrl: 'https://example.com/p', keyword: 'prefilled', locale: 'de' })));
    expect(hooks.dispatch).toHaveBeenCalledWith(updateFormDraft({ locale: 'en' }));
    const preview = screen.getByTestId('content-form-preview');
    for (const key of ['owned', 'competitors', 'scorecard', 'brief', 'draft'] as const) {
      expect(preview).toHaveTextContent(en.form.included[key]);
    }
    expect(preview).toHaveTextContent(en.form.included.providerCall);
    await userEvent.click(screen.getByTestId('content-form-locale'));
    const localeOptions = await screen.findAllByRole('option');
    fireEvent.click(localeOptions[2]!);
    expect(hooks.dispatch).toHaveBeenCalledWith(updateFormDraft({ locale: 'fr' }));
  });

  it('separates the detected-language sentence from the override hint', () => {
    renderInRouter(<NewAnalysisForm siteId="s1" />);
    expect(screen.getByTestId('content-form-locale-hint').textContent).toMatch(
      /^Detected from your account language: \S+\. You can override it for this output\.$/,
    );
    expect(screen.getByTestId('content-form-preview')).not.toHaveTextContent(/operator/i);
  });

  it('renders reviewed competitor sources safely and carries reviewed matches into submission', async () => {
    const reviewedPageMatches = [{
      landscapeReportId: '0123456789abcdef01234567',
      landscapeOpportunityId: 'opportunity-1',
      suggestionId: 'match-1',
    }];
    setState({
      formDraft: {
        ownedUrl: 'https://example.com/page',
        keyword: 'reviewed keyword',
        locale: 'en',
        consent: true,
      },
    });
    renderInRouter(
      <NewAnalysisForm
        siteId="s1"
        prefill={{
          reviewedCompetitorUrls: ['https://rival.example/page', 'javascript:alert(1)'],
          reviewedPageMatches,
        }}
      />,
    );

    expect(screen.getByRole('link', { name: 'https://rival.example/page' })).toHaveAttribute(
      'href',
      'https://rival.example/page',
    );
    expect(screen.queryByRole('link', { name: 'javascript:alert(1)' })).not.toBeInTheDocument();
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
    fireEvent.submit(screen.getByTestId('content-form-submit').closest('form')!);
    await waitFor(() => expect(api.startAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ reviewedPageMatches }),
      expect.anything(),
    ));
  });

  it.each([
    ['url_invalid', 'Enter a valid URL.'],
    ['off_origin', "URL must match your site's origin."],
    ['url_unsafe', 'URL is not publicly reachable.'],
    ['not_owned', 'That URL does not belong to a site you own.'],
    ['unknown', ''],
  ])('maps preflight reason %s without submitting', async (reason, text) => {
    setState({ formDraft: { ownedUrl: 'https://example.com/p', keyword: 'query', locale: 'en', consent: true } });
    api.preflightAnalysis.mockResolvedValueOnce({ ok: false, reason });
    renderInRouter(<NewAnalysisForm siteId="s1" />);
    fireEvent.submit(screen.getByTestId('content-form-submit').closest('form')!);
    if (text) expect(await screen.findByText(text)).toBeInTheDocument();
    else await waitFor(() => expect(api.startAnalysis).not.toHaveBeenCalled());
  });

  it('requires consent, submits after a failed preflight request, and clears errors', async () => {
    const onSubmitted = vi.fn();
    setState({
      submitError: 'old server error',
      formDraft: { ownedUrl: 'https://example.com/p', keyword: 'query', locale: '', consent: false },
    });
    const view = renderInRouter(<NewAnalysisForm siteId="s1" onSubmitted={onSubmitted} prefill={{}} />);
    fireEvent.submit(screen.getByTestId('content-form-submit').closest('form')!);
    expect(await screen.findByText('Consent is required.')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('content-form-url'), { target: { value: 'https://example.com/new' } });
    fireEvent.change(screen.getByTestId('content-form-keyword'), { target: { value: 'new keyword' } });
    expect(hooks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'contentIntelligence/clearSubmitError' }));
    view.unmount();

    setState({ formDraft: { ownedUrl: 'https://example.com/p', keyword: 'query', locale: 'en', consent: true } });
    api.preflightAnalysis.mockRejectedValueOnce(new Error('offline'));
    renderInRouter(<NewAnalysisForm siteId="s1" onSubmitted={onSubmitted} />);
    fireEvent.submit(screen.getByTestId('content-form-submit').closest('form')!);
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith('started'));
    expect(api.startAnalysis).toHaveBeenCalled();
  });

  it('keeps a rejected submission visible with destructive server guidance', async () => {
    setState({
      submitError: 'Could not start',
      formDraft: { ownedUrl: 'https://example.com/p', keyword: 'query', locale: 'en', consent: true },
    });
    api.startAnalysis.mockRejectedValueOnce(new Error('offline'));
    renderInRouter(<NewAnalysisForm siteId="s1" />);
    expect(screen.getByTestId('content-form-server-error')).toHaveClass('text-destructive');
    fireEvent.submit(screen.getByTestId('content-form-submit').closest('form')!);
    await waitFor(() => expect(api.startAnalysis).toHaveBeenCalled());
  });

  it('ignores submits while submitting and handles checkbox changes', () => {
    setState({ submitting: true, formDraft: { ownedUrl: '', keyword: '', locale: 'en', consent: true } });
    renderInRouter(<NewAnalysisForm siteId="s1" />);
    expect(screen.getByTestId('content-form-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('content-form-consent'));
    expect(hooks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'contentIntelligence/updateFormDraft' }));
    fireEvent.submit(screen.getByTestId('content-form-submit').closest('form')!);
    expect(api.preflightAnalysis).not.toHaveBeenCalled();
  });

  it.each([
    ['ftp://example.com/page', 'keyword', 'Enter a valid URL.'],
    ['not a URL', 'keyword', 'Enter a valid URL.'],
    ['https://other.example/page', 'keyword', "URL must match your site's origin."],
    ['https://example.com/page', 'x'.repeat(201), 'Use 200 characters or fewer.'],
  ])('validates manual page and keyword input %s', async (ownedUrl, keyword, message) => {
    setState({ formDraft: { ownedUrl, keyword, locale: 'xx', consent: true } });
    renderInRouter(<NewAnalysisForm siteId="s1" siteOrigin="https://example.com" />);
    fireEvent.blur(screen.getByTestId('content-form-url'));
    fireEvent.blur(screen.getByTestId('content-form-keyword'));
    fireEvent.submit(screen.getByTestId('content-form-submit').closest('form')!);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(api.preflightAnalysis).not.toHaveBeenCalled();
  });

  it('flags a pasted keyword list at once, counts characters, and never truncates', () => {
    const pasted =
      'Podcast transcript generator free, Transcript podcast spotify, Best transcript podcast app';
    setState({
      formDraft: { ownedUrl: 'https://example.com/page', keyword: pasted, locale: 'en', consent: true },
    });
    const view = renderInRouter(<NewAnalysisForm siteId="s1" siteOrigin="https://example.com" />);
    const input = screen.getByTestId('content-form-keyword');
    expect(input).not.toHaveAttribute('maxLength');
    expect(input).toHaveValue(pasted);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter one search query, not a list. Start a separate analysis for each keyword.')).toBeInTheDocument();
    const counter = screen.getByTestId('content-form-keyword-counter');
    expect(counter).toHaveTextContent(`${pasted.length}/200 characters`);
    expect(counter).toHaveClass('text-muted-foreground');
    expect(input).toHaveAttribute('aria-describedby', counter.id);
    view.unmount();

    setState({
      formDraft: { ownedUrl: 'https://example.com/page', keyword: 'y'.repeat(230), locale: 'en', consent: true },
    });
    const long = renderInRouter(<NewAnalysisForm siteId="s1" siteOrigin="https://example.com" />);
    expect(screen.getByTestId('content-form-keyword')).toHaveValue('y'.repeat(230));
    expect(screen.getByTestId('content-form-keyword-counter')).toHaveClass('text-destructive');
    expect(screen.getByText('Use 200 characters or fewer.')).toBeInTheDocument();
    long.unmount();

    // "Required" still waits for blur.
    setState({
      formDraft: { ownedUrl: 'https://example.com/page', keyword: '', locale: 'en', consent: true },
    });
    const empty = renderInRouter(<NewAnalysisForm siteId="s1" siteOrigin="https://example.com" />);
    expect(screen.queryByText('Enter or choose a target keyword.')).toBeNull();
    fireEvent.blur(screen.getByTestId('content-form-keyword'));
    expect(screen.getByText('Enter or choose a target keyword.')).toBeInTheDocument();
    empty.unmount();
  });

  it.each([
    ['seven comma-separated keywords', 'a1, b2, c3, d4, e5, f6, g7'],
    ['one comma between two queries', 'seo audit, site audit'],
    ['semicolons', 'seo audit; site audit'],
    ['a tab', 'seo audit\tsite audit'],
    ['fullwidth commas', '播客转录，免费工具'],
  ])('rejects %s inline, keeps what was typed, and does not submit', async (_label, keyword) => {
    setState({
      formDraft: { ownedUrl: 'https://example.com/page', keyword, locale: 'en', consent: true },
    });
    renderInRouter(<NewAnalysisForm siteId="s1" siteOrigin="https://example.com" />);
    const input = screen.getByTestId('content-form-keyword');
    expect(input).toHaveValue(keyword);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('content-form-keyword-error')).toHaveTextContent(
      'Enter one search query, not a list. Start a separate analysis for each keyword.',
    );
    fireEvent.submit(screen.getByTestId('content-form-submit').closest('form')!);
    expect(api.preflightAnalysis).not.toHaveBeenCalled();
    expect(api.startAnalysis).not.toHaveBeenCalled();
  });

  it('accepts a keyword of exactly 200 characters and rejects 201 without truncating either', async () => {
    const atLimit = `${'word '.repeat(39)}wordsx`.slice(0, 200);
    expect(atLimit).toHaveLength(200);
    setState({
      formDraft: { ownedUrl: 'https://example.com/page', keyword: atLimit, locale: 'en', consent: true },
    });
    const ok = renderInRouter(<NewAnalysisForm siteId="s1" siteOrigin="https://example.com" />);
    expect(screen.getByTestId('content-form-keyword')).toHaveValue(atLimit);
    expect(screen.getByTestId('content-form-keyword')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByTestId('content-form-keyword-error')).toBeNull();
    expect(screen.getByTestId('content-form-keyword-counter')).toHaveTextContent('200/200 characters');
    expect(screen.getByTestId('content-form-keyword-counter')).not.toHaveClass('text-destructive');
    ok.unmount();

    const over = `${atLimit}p`;
    setState({
      formDraft: { ownedUrl: 'https://example.com/page', keyword: over, locale: 'en', consent: true },
    });
    renderInRouter(<NewAnalysisForm siteId="s1" siteOrigin="https://example.com" />);
    expect(screen.getByTestId('content-form-keyword')).toHaveValue(over);
    expect(screen.getByTestId('content-form-keyword-error')).toHaveTextContent('Use 200 characters or fewer.');
    expect(screen.getByTestId('content-form-keyword-counter')).toHaveTextContent('201/200 characters');
    fireEvent.submit(screen.getByTestId('content-form-submit').closest('form')!);
    expect(api.preflightAnalysis).not.toHaveBeenCalled();
    expect(api.startAnalysis).not.toHaveBeenCalled();
  });

  it('refuses an unconsented submit before preflight and offers known pages and keywords', async () => {
    setState({
      formDraft: { ownedUrl: 'https://example.com/page', keyword: 'query', locale: 'en', consent: false },
    });
    const view = renderInRouter(
      <NewAnalysisForm
        siteId="s1"
        siteOrigin="https://example.com"
        knownPages={['https://example.com/page']}
        suggestedKeywords={['query']}
      />,
    );
    expect(view.container.querySelector('option[value="https://example.com/page"]')).toBeInTheDocument();
    expect(view.container.querySelector('option[value="query"]')).toBeInTheDocument();
    fireEvent.blur(screen.getByTestId('content-form-consent'));
    expect(await screen.findByText('Consent is required.')).toBeInTheDocument();
    fireEvent.submit(screen.getByTestId('content-form-submit').closest('form')!);
    expect(api.preflightAnalysis).not.toHaveBeenCalled();
  });
});

describe('AnalysisDetail', () => {
  it('renders loading, error, and absent analysis states', () => {
    setState({ detailLoading: { a1: true } });
    const loading = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.getByTestId('content-detail-loading')).toBeInTheDocument();
    loading.unmount();
    setState({ detailError: { a1: 'not found' } });
    const onBack = vi.fn();
    const error = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={onBack} onRegenerated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(api.getAnalysis).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to analyses' }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByTestId('content-detail-error')).toHaveTextContent('not found');
    error.unmount();
    setState();
    const empty = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.queryByTestId('content-detail')).toBeNull();
    empty.unmount();
  });

  it('renders complete evidence, safely edits/copies/exports/saves, refreshes, and regenerates', async () => {
    vi.useFakeTimers();
    const full = analysis({
      status: 'partial',
      warnings: [
        {
          code: 'keyword_unavailable',
          messageKey: 'x',
          message: 'Keyword evidence was unavailable, so keyword-specific comparisons are missing.',
        },
        { code: 'limited', messageKey: 'x', message: 'Evidence is limited.' },
      ],
      scorecard: { readabilityScore: 80, coverageScore: 70, structureScore: 60, warnings: [] },
      brief: { versionId: 'v1', sections: [{ heading: 'Plan', body: '<img src=x onerror=alert(1)><script>alert(1)</script>' }], citations: [] },
      draft: { versionId: 'v1', markdown: 'first draft', wordCount: 2, citations: [] },
      draftVersions: [
        { versionId: 'saved-v1', markdown: 'old duplicate', wordCount: 2, savedAt: '2026-06-01T00:00:00Z' },
        { versionId: 'prior-v1', markdown: 'prior version', wordCount: 2, savedAt: '2026-05-01T00:00:00Z' },
      ],
      citations: [
        { sourceId: 'safe', url: 'https://example.com/source', title: 'Source' },
        { sourceId: 'unsafe', url: 'javascript:alert(1)', title: null },
      ],
      requestedAt: '2026-07-01T00:00:00Z',
      completedAt: '2026-07-02T00:00:00Z',
      reservation: { key: 'k', reservedUnits: 1, refundedAt: '2026-07-02T00:00:00Z', refundReason: 'owned_page_unusable' },
    });
    setState({ detail: { a1: full } });
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const view = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.getByTestId('content-detail-partial')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('content-detail-partial')).getByText(
        /Keyword evidence was unavailable/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('content-detail-refunded')).toBeNull();
    expect(screen.getByDisplayValue('Plan')).toBeInTheDocument();
    expect(screen.getByDisplayValue('<img src=x onerror=alert(1)><script>alert(1)</script>')).toBeInTheDocument();
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.querySelector('script')).toBeNull();
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    expect(screen.queryByRole('link', { name: 'javascript:alert(1)' })).toBeNull();
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('content-draft-textarea'), { target: { value: 'changed words here' } });
    expect(screen.getByText(/unsaved changes/)).toBeInTheDocument();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));
    expect(writeText).toHaveBeenCalledWith('changed words here');
    const exportControls = screen.getAllByTestId('report-export-control');
    expect(exportControls).toHaveLength(2);
    expect(exportControls[0]).toHaveAttribute('data-kind', 'content.analysis');
    expect(exportControls[0]).toHaveAttribute('data-resource-id', 'a1');
    expect(exportControls[1]).toHaveAttribute('data-sections', 'draft');
    fireEvent.click(screen.getByTestId('content-draft-save'));
    await vi.advanceTimersByTimeAsync(50);
    expect(screen.getByText('Version saved.')).toBeInTheDocument();
    expect(api.saveDraftVersion).toHaveBeenCalledWith('a1', 'changed words here', expect.any(String));
    api.saveDraftVersion.mockResolvedValueOnce({
      version: {
        versionId: 'saved-v2',
        markdown: 'second saved version',
        wordCount: 3,
        savedAt: '2026-07-03T00:00:00Z',
      },
    });
    fireEvent.change(screen.getByTestId('content-draft-textarea'), { target: { value: 'second saved version' } });
    fireEvent.click(screen.getByTestId('content-draft-save'));
    await vi.advanceTimersByTimeAsync(50);
    expect(api.saveDraftVersion).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2500);
    fireEvent.click(screen.getByText('refresh recommendations'));
    fireEvent.click(screen.getByTestId('content-detail-regenerate'));
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(api.regenerateAnalysis).toHaveBeenCalled();
    view.unmount();
  });

  it('reports a failed save and clears a pending notice on unmount', async () => {
    vi.useFakeTimers();
    setState({ detail: { a1: analysis({
      draft: { versionId: 'v1', markdown: 'draft', wordCount: 1, citations: [] },
    }) } });
    const first = renderInRouter(
      <AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />,
    );
    let finishSave: ((value: { version: { versionId: string; markdown: string; wordCount: number; savedAt: string } }) => void) | undefined;
    api.saveDraftVersion.mockImplementationOnce(() => new Promise((resolve) => {
      finishSave = resolve;
    }));
    fireEvent.change(screen.getByTestId('content-draft-textarea'), { target: { value: 'pending save' } });
    const savingButton = screen.getByTestId('content-draft-save');
    await act(async () => {
      savingButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      savingButton.removeAttribute('disabled');
      savingButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.saveDraftVersion).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishSave?.({
        version: { versionId: 'pending-v1', markdown: 'pending save', wordCount: 2, savedAt: '2026-07-04T00:00:00Z' },
      });
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Version saved.');
    first.unmount();

    vi.useRealTimers();
    api.saveDraftVersion.mockRejectedValueOnce(new Error('save failed'));
    setState({ detail: { a1: analysis({
      draft: { versionId: 'v1', markdown: 'draft', wordCount: 1, citations: [] },
    }) } });
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    fireEvent.change(screen.getByTestId('content-draft-textarea'), { target: { value: 'will fail' } });
    fireEvent.click(screen.getByTestId('content-draft-save'));
    expect(await screen.findByText('This version could not be saved. Try again.')).toBeInTheDocument();
  });

  it('edits, validates, saves, deduplicates, and reports failures for brief versions', async () => {
    const full = analysis({
      brief: {
        versionId: 'brief-v1',
        sections: [
          { heading: 'Plan', body: 'Guidance' },
          { heading: 'Second', body: 'More guidance' },
        ],
        citations: [],
      },
      briefVersions: [
        {
          versionId: 'brief-saved-v1',
          sections: [{ heading: 'Duplicate', body: 'Old duplicate' }],
          savedAt: '2026-06-01T00:00:00Z',
        },
        {
          versionId: 'brief-prior-v1',
          sections: [{ heading: 'Prior', body: 'Prior guidance' }],
          savedAt: '2026-05-01T00:00:00Z',
        },
      ],
    });
    setState({ detail: { a1: full } });
    let finishSave: ((value: {
      version: {
        versionId: string;
        sections: Array<{ heading: string; body: string }>;
        savedAt: string;
      };
    }) => void) | undefined;
    api.saveBriefVersion.mockImplementationOnce(() => new Promise((resolve) => {
      finishSave = resolve;
    }));
    renderInRouter(
      <AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />,
    );

    const firstHeading = screen.getByLabelText('Section 1 heading');
    fireEvent.change(firstHeading, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Save brief version' })).toBeDisabled();
    fireEvent.change(firstHeading, { target: { value: 'Updated plan' } });
    const bodies = screen.getAllByLabelText('Section guidance');
    fireEvent.change(bodies[1]!, { target: { value: 'Second guidance' } });
    expect(screen.getByText('You have unsaved brief changes.')).toBeInTheDocument();

    const save = screen.getByRole('button', { name: 'Save brief version' });
    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      save.removeAttribute('disabled');
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.saveBriefVersion).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishSave?.({
        version: {
          versionId: 'brief-saved-v1',
          sections: [
            { heading: 'Updated plan', body: 'Guidance' },
            { heading: 'Second', body: 'Second guidance' },
          ],
          savedAt: '2026-07-02T00:00:00Z',
        },
      });
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Brief version saved.');
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(1);

    api.saveBriefVersion.mockRejectedValueOnce(new Error('save failed'));
    fireEvent.change(firstHeading, { target: { value: 'Another plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save brief version' }));
    expect(
      await screen.findByText('This brief version could not be saved. Try again.'),
    ).toBeInTheDocument();
  });

  it('shows copy recovery and discards unsaved edits before going back', async () => {
    const onBack = vi.fn();
    const writeText = vi.fn()
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    setState({ detail: { a1: analysis({
      draft: { versionId: 'v1', markdown: 'draft', wordCount: 1, citations: [] },
    }) } });
    renderInRouter(
      <AnalysisDetail siteId="s1" analysisId="a1" onBack={onBack} onRegenerated={vi.fn()} />,
    );
    fireEvent.change(screen.getByTestId('content-draft-textarea'), {
      target: { value: 'unsaved draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));
    expect(await screen.findByText('The draft could not be copied.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try copying again' }));
    expect(await screen.findByText('Copied to clipboard.')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('content-detail-back'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and leave' }));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
  });

  it('blocks data-router navigation until unsaved edits are kept or discarded', async () => {
    setState({ detail: { a1: analysis({
      draft: { versionId: 'v1', markdown: 'draft', wordCount: 1, citations: [] },
    }) } });
    const router = createMemoryRouter(
      [
        {
          path: '/detail',
          element: (
            <I18nextProvider i18n={i18n}>
              <AnalysisDetail
                siteId="s1"
                analysisId="a1"
                onBack={vi.fn()}
                onRegenerated={vi.fn()}
              />
            </I18nextProvider>
          ),
        },
        { path: '/elsewhere', element: <div>Destination route</div> },
      ],
      { initialEntries: ['/detail'] },
    );
    render(<RouterProvider router={router} />);
    fireEvent.change(screen.getByTestId('content-draft-textarea'), {
      target: { value: 'dirty draft' },
    });

    await act(async () => {
      await router.navigate('/elsewhere');
    });
    expect(screen.getByText('Discard unsaved draft changes?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByTestId('content-detail')).toBeInTheDocument();

    await act(async () => {
      await router.navigate('/elsewhere');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard and leave' }));
    expect(await screen.findByText('Destination route')).toBeInTheDocument();
  });

  it('renders the v2 score alternatives, an empty partial warning set, and deduplicated sources', () => {
    setState({ detail: { a1: analysis({
      status: 'partial',
      scorecardV2: {
        version: 'v2',
        total: 63,
        sections: [
          { key: 'readability', score: 80, weight: 40, confidence: 0.4, reason: 'limited', reasonKey: 'contentIntelligence.reasons.unknown', reasonText: 'Limited evidence lowers confidence in this section.' },
          { key: 'coverage', score: 70, weight: 35, confidence: 0.8, reason: 'strong', reasonKey: 'contentIntelligence.reasons.coverage.strong', reasonText: 'The available evidence supports this section.' },
          { key: 'structure', score: 40, weight: 25, confidence: 0.8, reason: 'needs work', reasonKey: 'contentIntelligence.reasons.structure.needsWork', reasonText: 'The available evidence shows room to improve this section.' },
        ],
      },
      citations: [
        { sourceId: 'owned-copy', url: 'https://example.com/guide', title: 'Owned duplicate' },
        { sourceId: 'comparison-1', url: 'https://comparison.example/page', title: null },
        { sourceId: 'comparison-duplicate', url: 'https://comparison.example/page', title: 'Duplicate' },
      ],
    }) } });
    const v2Detail = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.getByTestId('content-detail-partial')).toBeInTheDocument();
    expect(within(screen.getByTestId('content-detail-partial')).queryByRole('list')).toBeNull();
    expect(screen.getByText('Limited evidence lowers confidence in this section.')).toBeInTheDocument();
    expect(screen.getByText('The available evidence supports this section.')).toBeInTheDocument();
    expect(screen.getByText('The available evidence shows room to improve this section.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'https://comparison.example/page' })).toHaveLength(1);
    v2Detail.unmount();

    setState({ detail: { a1: analysis({
      owned: null,
      scorecard: { readabilityScore: 73, coverageScore: 64, structureScore: 55, warnings: [] },
    }) } });
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.getByText('73')).toBeInTheDocument();
    expect(within(screen.getByTestId('content-detail-sources')).getByRole('link', { name: 'Owned page' }))
      .toHaveAttribute('href', 'https://example.com/guide');
  });

  it('keeps retryable failures regeneratable and falls back to generic failure copy', () => {
    setState({ detail: { a1: analysis({
      status: 'failed',
      error: { category: 'unknown_category', messageKey: 'x', retryable: true, terminal: true },
    }) } });
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.getByTestId('content-detail-failed')).toHaveTextContent('The analysis stopped before it finished.');
    expect(screen.queryByTestId('content-detail-failure-reason')).toBeNull();
    // The retry lives in the failure alert; no second regenerate button below.
    expect(
      within(screen.getByTestId('content-detail-failed')).getByTestId('content-detail-retry'),
    ).toHaveTextContent('Try again');
    expect(screen.queryByTestId('content-detail-regenerate')).toBeNull();
  });

  it('explains an owned-page failure without a recorded reason and offers nothing to export', () => {
    for (const category of ['owned_page_unusable', 'owned_fetch_failed'] as const) {
      setState({ detail: { a1: analysis({
        status: 'failed',
        error: { category, messageKey: 'x', retryable: false, terminal: true },
        recommendations: [],
      }) } });
      const view = renderInRouter(
        <AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />,
      );
      expect(screen.getByTestId('content-detail-failure-unknown')).toHaveTextContent(
        'The usual ones are a robots.txt block',
      );
      expect(screen.queryByTestId('content-detail-failure-reason')).toBeNull();
      expect(screen.queryByTestId('report-export-control')).toBeNull();
      view.unmount();
    }
  });

  it('explains an owned-page failure with a safe reason, a hint, and a retry for a legacy row', async () => {
    const onRegenerated = vi.fn();
    setState({ detail: { a1: analysis({
      status: 'failed',
      error: {
        category: 'owned_page_unusable',
        messageKey: 'x',
        retryable: false,
        terminal: true,
        reason: 'http_error',
        httpStatus: 403,
      },
      recommendations: [],
    }) } });
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={onRegenerated} />);
    const failed = screen.getByTestId('content-detail-failed');
    expect(failed).toHaveTextContent('Your page could not be read.');
    expect(screen.getByTestId('content-detail-failure-reason')).toHaveTextContent(
      'Your page answered with HTTP status 403 instead of its content.',
    );
    expect(failed).toHaveTextContent('Check that the URL is correct');
    fireEvent.click(within(failed).getByTestId('content-detail-retry'));
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(onRegenerated).toHaveBeenCalledWith('regenerated'));
  });

  it('replaces the empty opportunities, brief, draft and sources cards of a failed run with one explanation', () => {
    const failedError = {
      category: 'owned_page_unusable',
      messageKey: 'x',
      retryable: false,
      terminal: true,
      reason: 'http_error',
      httpStatus: 404,
    };
    setState({ detail: { a1: analysis({ status: 'failed', error: failedError, recommendations: [] }) } });
    const empty = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    for (const id of ['content-detail-brief', 'content-detail-draft', 'content-detail-sources', 'recommendation-empty', 'content-detail-regenerate']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    // The (mocked) opportunities workflow is not rendered for a run with no opportunities.
    expect(screen.queryByRole('button', { name: 'refresh recommendations' })).toBeNull();
    expect(screen.getByTestId('content-detail-failure-reason')).toHaveTextContent('HTTP status 404');
    expect(screen.getAllByTestId('content-detail-failed-no-output')).toHaveLength(1);
    expect(screen.getByTestId('content-detail-failed-no-output')).toHaveTextContent(
      'This run stopped before it produced anything, so there are no content opportunities, brief or draft to show.',
    );
    empty.unmount();

    // A failed run that did save a brief keeps the sections that have content.
    const brief = { versionId: 'v1', sections: [{ heading: 'Plan', body: 'Guidance' }], citations: [] };
    const recommendation = {
      id: 'r1', section: 'coverage', ruleId: 'x', direction: 'add' as const, confidence: 0.9,
      messageKey: 'k', message: 'Add a section', evidenceSourceIds: [],
    };
    setState({ detail: { a1: analysis({
      status: 'failed',
      error: failedError,
      brief,
      recommendations: [recommendation],
      citations: [{ sourceId: 'c', url: 'https://example.com/rival', title: 'Rival' }],
    }) } });
    const partial = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.getByTestId('content-detail-brief')).toBeInTheDocument();
    expect(screen.getByTestId('content-detail-sources')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'refresh recommendations' })).toBeInTheDocument();
    expect(screen.queryByTestId('content-detail-draft')).toBeNull();
    expect(screen.getByTestId('content-detail-failed-no-output')).toBeInTheDocument();
    partial.unmount();

    // Every section present: nothing is hidden, so no "nothing produced" line.
    setState({ detail: { a1: analysis({
      status: 'failed',
      error: failedError,
      brief,
      draft: { versionId: 'v1', markdown: 'draft', wordCount: 1, citations: [] },
      recommendations: [recommendation],
    }) } });
    const full = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.getByTestId('content-detail-draft')).toBeInTheDocument();
    expect(screen.queryByTestId('content-detail-failed-no-output')).toBeNull();
    full.unmount();

    // A legacy failed row with no recorded error keeps the old layout and invents no reason.
    setState({ detail: { a1: analysis({ status: 'failed', error: null, recommendations: [] }) } });
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.getByTestId('content-detail-brief')).toBeInTheDocument();
    expect(screen.queryByTestId('content-detail-failed')).toBeNull();
    expect(screen.queryByTestId('content-detail-failed-no-output')).toBeNull();
  });

  it('keeps every section of a completed run even when some are empty', () => {
    setState({ detail: { a1: analysis({ status: 'completed' }) } });
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    for (const id of ['content-detail-brief', 'content-detail-draft', 'content-detail-sources']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('content-detail-failed-no-output')).toBeNull();
  });

  it('shows the redirect path and the media type our own request recorded', () => {
    setState({ detail: { a1: analysis({
      status: 'failed',
      error: {
        category: 'owned_page_unusable',
        messageKey: 'x',
        retryable: false,
        terminal: true,
        reason: 'redirect_limit',
        httpStatus: null,
        finalUrl: null,
        contentType: null,
        redirectChain: [
          { url: 'https://example.com/a', status: 301 },
          { url: 'https://example.com/b', status: 302 },
        ],
      },
      recommendations: [],
    }) } });
    const first = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.getByTestId('content-detail-redirect-path')).toHaveTextContent(
      'Redirect path: 301 https://example.com/a → 302 https://example.com/b',
    );
    expect(screen.getByTestId('content-detail-failed')).toHaveTextContent('Point the address straight at the final page');
    first.unmount();

    setState({ detail: { a1: analysis({
      status: 'failed',
      error: {
        category: 'owned_page_unusable',
        messageKey: 'x',
        retryable: false,
        terminal: true,
        reason: 'non_html',
        contentType: 'application/pdf',
        redirectChain: [],
      },
      recommendations: [],
    }) } });
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.getByTestId('content-detail-failure-reason')).toHaveTextContent(
      'This address serves application/pdf, not a web page.',
    );
    expect(screen.queryByTestId('content-detail-redirect-path')).toBeNull();
  });

  it('says which final address a redirected page was read at', () => {
    setState({ detail: { a1: analysis({
      status: 'completed',
      owned: {
        url: 'https://example.com/',
        contentHash: 'h',
        finalUrl: 'https://example.com/en',
        redirectChain: [{ url: 'https://example.com/', status: 301 }],
      },
    }) } });
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.getByTestId('content-detail-final-url')).toHaveTextContent(
      'Read at https://example.com/en after a redirect',
    );
  });

  it('renders every failure reason and ignores unknown ones; no retry for non-retryable service faults', () => {
    const reasons = [
      ['robots_blocked', 'robots.txt blocks our reader'],
      ['access_denied', 'refused access'],
      ['timeout', 'took too long to load'],
      ['temporarily_unavailable', 'could not be loaded this time'],
      ['empty_content', 'only with JavaScript'],
      ['too_large', 'too large to read'],
      ['unsafe_url', 'not publicly reachable'],
      ['unreadable', 'form we could not read'],
      ['redirect_loop', 'redirects loop back on themselves'],
      ['redirect_limit', 'redirects more than five times'],
      ['unsafe_redirect', 'redirects to an address that is not publicly reachable'],
      ['non_html', 'serves , not a web page'],
    ] as const;
    for (const [reason, text] of reasons) {
      setState({ detail: { a1: analysis({
        status: 'failed',
        error: { category: 'owned_fetch_failed', messageKey: 'x', retryable: true, terminal: true, reason, httpStatus: null },
      }) } });
      const view = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
      expect(screen.getByTestId('content-detail-failure-reason')).toHaveTextContent(text);
      view.unmount();
    }
    setState({ detail: { a1: analysis({
      status: 'failed',
      error: { category: 'provider_unavailable', messageKey: 'x', retryable: false, terminal: true, reason: 'future_reason' },
    }) } });
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.queryByTestId('content-detail-failure-reason')).toBeNull();
    expect(screen.queryByTestId('content-detail-retry')).toBeNull();
    expect(screen.queryByTestId('content-detail-regenerate')).toBeNull();
  });

  it('aborts an active status poll when the selected analysis unmounts', async () => {
    vi.useFakeTimers();
    setState({ detail: { a1: analysis({ status: 'scoring' }) } });
    api.getAnalysisStatus.mockImplementationOnce((_analysisId, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const view = renderInRouter(
      <AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />,
    );
    await vi.advanceTimersByTimeAsync(2000);
    const signal = api.getAnalysisStatus.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await vi.runAllTimersAsync();
  });

  it('renders progress from server state, moves the step on, and cancels', async () => {
    vi.useFakeTimers();
    setState({
      detail: {
        a1: analysis({
          status: 'scoring',
          progress: { ...RUNNING_PROGRESS, stepIndex: 5, stepKey: 'scoring' },
        }),
      },
    });
    const view = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    // Live progress card: spinner, honest finished-step bar (4/7 ≈ 57%),
    // current stage label, and "Step 5 of 7".
    expect(screen.getByTestId('content-detail-progress')).toBeInTheDocument();
    expect(screen.getByTestId('content-detail-progress-spinner')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '57');
    expect(screen.getByTestId('content-detail-progress-step')).toHaveTextContent('Step 5 of 7');
    expect(screen.getByTestId('content-detail-progress-note')).toHaveTextContent('updates automatically');
    expect(screen.getByText('Brief is not available for this run.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Owned page' })).toHaveAttribute(
      'href',
      'https://example.com/guide',
    );
    const next = { analysisId: 'a1', status: 'generating_brief' as const, ...RUNNING_PROGRESS, stepIndex: 6, stepKey: 'generating_brief' as const };
    api.getAnalysisStatus.mockResolvedValueOnce(next);
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.getAnalysisStatus).toHaveBeenCalledWith('a1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(hooks.dispatch).toHaveBeenCalledWith(analysisStatusReceived({ siteId: 's1', job: next }));
    fireEvent.click(screen.getByTestId('content-detail-cancel'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel analysis' }));
    expect(api.cancelAnalysis).toHaveBeenCalled();
    view.unmount();
  });

  it('falls back to the run status for progress when the server sent none', () => {
    setState({ detail: { a1: analysis({ status: 'scoring' }) } });
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.getByTestId('content-detail-progress-step')).toHaveTextContent('Step 5 of 7');
  });

  it('loads the full result as soon as the status read is terminal', async () => {
    vi.useFakeTimers();
    installThunkDispatch();
    setState({ detail: { a1: analysis({ status: 'collecting_owned' }) } });
    const view = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    await vi.advanceTimersByTimeAsync(0);
    api.getAnalysis.mockClear();
    api.getAnalysisStatus.mockResolvedValueOnce({
      analysisId: 'a1',
      status: 'failed',
      ...RUNNING_PROGRESS,
      terminal: true,
      failureReasonCode: 'provider_unavailable',
      retryAction: 'retry',
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.getAnalysis).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('says the run is still going once the status poll reaches its time limit', async () => {
    vi.useFakeTimers();
    setState({ detail: { a1: analysis({ status: 'scoring' }) } });
    api.getAnalysisStatus.mockResolvedValue({ analysisId: 'a1', status: 'scoring', ...RUNNING_PROGRESS, stepIndex: 5, stepKey: 'scoring' });
    const view = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 5_000);
    expect(screen.getByTestId('content-detail-progress-note')).toHaveTextContent(
      'Still running. You can leave this page and come back later; the result will be here.',
    );
    view.unmount();
  });

  it('moves focus to the outcome heading when a watched run ends', () => {
    setState({ detail: { a1: analysis({ status: 'collecting_owned' }) } });
    const onBack = vi.fn();
    const onRegenerated = vi.fn();
    const view = renderInRouter(
      <AnalysisDetail siteId="s1" analysisId="a1" onBack={onBack} onRegenerated={onRegenerated} />,
    );
    setState({ detail: { a1: analysis({ status: 'failed', error: FAILED_ERROR, progress: FAILED_PROGRESS }) } });
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/sites/s1?tab=content']}>
          <AnalysisDetail siteId="s1" analysisId="a1" onBack={onBack} onRegenerated={onRegenerated} />
        </MemoryRouter>
      </I18nextProvider>,
    );
    const heading = screen.getByRole('heading', { name: 'This analysis stopped early' });
    expect(heading).toHaveFocus();
    expect(screen.queryByTestId('content-detail-progress')).toBeNull();
    view.unmount();
  });

  it('explains each failure code and the way out', () => {
    const copy = {
      provider_unavailable: 'Our content service is unavailable right now.',
      page_unreachable: 'We could not read your page.',
      page_blocked: 'Your page blocks our reader',
      page_too_large: 'too large to read in one pass',
      timeout: 'took too long to respond',
      internal: 'Something went wrong on our side.',
    } as const;
    for (const [code, text] of Object.entries(copy)) {
      setState({ detail: { a1: analysis({
        status: 'failed',
        error: FAILED_ERROR,
        progress: { ...FAILED_PROGRESS, failureReasonCode: code as keyof typeof copy },
      }) } });
      const view = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
      expect(screen.getByTestId('content-detail-failure-code')).toHaveTextContent(text);
      view.unmount();
    }
    setState({ detail: { a1: analysis({
      status: 'failed',
      error: FAILED_ERROR,
      progress: { ...FAILED_PROGRESS, retryAction: null },
    }) } });
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.queryByTestId('content-detail-retry')).toBeNull();
    expect(screen.queryByTestId('content-detail-edit-url')).toBeNull();
  });

  it('offers Edit the URL for a page problem', () => {
    const failed = analysis({
      status: 'failed',
      error: { ...FAILED_ERROR, category: 'owned_page_unusable', reason: 'robots_blocked' },
      progress: { ...FAILED_PROGRESS, failureReasonCode: 'page_blocked', retryAction: 'edit_url' },
    });
    setState({ detail: { a1: failed } });
    const onEditUrl = vi.fn();
    const view = renderInRouter(
      <AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} onEditUrl={onEditUrl} />,
    );
    expect(screen.queryByTestId('content-detail-retry')).toBeNull();
    fireEvent.click(screen.getByTestId('content-detail-edit-url'));
    expect(onEditUrl).toHaveBeenCalledWith(failed);
    view.unmount();
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.queryByTestId('content-detail-edit-url')).toBeNull();
  });

  it('tries again with consent prefilled but still confirmed', async () => {
    setState({ detail: { a1: analysis({ status: 'failed', error: FAILED_ERROR, progress: FAILED_PROGRESS }) } });
    api.getAnalysisRetryPreview.mockResolvedValue(retryPreview());
    api.retryAnalysis.mockResolvedValue({ analysisId: 'retried', status: 'queued', duplicate: false, message: 'ok' });
    const onRegenerated = vi.fn();
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={onRegenerated} />);
    await userEvent.click(screen.getByTestId('content-detail-retry'));
    const dialog = await screen.findByTestId('content-retry-dialog');
    expect(await within(dialog).findByTestId('content-retry-request')).toHaveTextContent('https://example.com/guide');
    expect(within(dialog).getByTestId('content-retry-request')).toHaveTextContent('content audit');
    expect(within(dialog).getByTestId('content-retry-consent')).toHaveAttribute('aria-checked', 'true');
    expect(api.retryAnalysis).not.toHaveBeenCalled();
    // Unticking blocks the confirm and says why.
    await userEvent.click(within(dialog).getByTestId('content-retry-consent'));
    expect(within(dialog).getByTestId('content-retry-confirm')).toBeDisabled();
    expect(within(dialog).getByText('Consent is required.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByTestId('content-retry-consent'));
    await userEvent.click(within(dialog).getByTestId('content-retry-confirm'));
    await waitFor(() => expect(onRegenerated).toHaveBeenCalledWith('retried'));
    expect(api.retryAnalysis).toHaveBeenCalledWith('a1', true);
    await waitFor(() => expect(screen.queryByTestId('content-retry-dialog')).toBeNull());
  });

  it('handles preview failures, start errors and closing while the preview loads', async () => {
    setState({ detail: { a1: analysis({ status: 'failed', error: FAILED_ERROR, progress: FAILED_PROGRESS }) } });
    api.getAnalysisRetryPreview
      .mockRejectedValueOnce(new ApiError('down', 503, {}))
      .mockResolvedValueOnce(retryPreview())
      .mockImplementationOnce((_id, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
    api.retryAnalysis.mockRejectedValue(new ApiError('conflict', 409, { error: { message: 'This analysis cannot be retried as it is.' } }));
    const onRegenerated = vi.fn();
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={onRegenerated} />);
    await userEvent.click(screen.getByTestId('content-detail-retry'));
    let dialog = await screen.findByTestId('content-retry-dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The details of this analysis could not be loaded.');
    expect(within(dialog).getByTestId('content-retry-confirm')).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(await within(dialog).findByTestId('content-retry-request')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByTestId('content-retry-confirm'));
    expect(await within(dialog).findByTestId('content-retry-error')).toHaveTextContent('cannot be retried');
    expect(onRegenerated).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('content-retry-dialog')).toBeNull());

    // Closing while the preview is still loading aborts that read.
    await userEvent.click(screen.getByTestId('content-detail-retry'));
    dialog = await screen.findByTestId('content-retry-dialog');
    expect(within(dialog).getByRole('status')).toHaveTextContent('Loading');
    const signal = api.getAnalysisRetryPreview.mock.calls[2]?.[1]?.signal as AbortSignal;
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(signal.aborted).toBe(true));

    // A preview that lands after the dialog closed is dropped.
    let resolveLate: ((value: unknown) => void) | undefined;
    api.getAnalysisRetryPreview.mockImplementationOnce(() => new Promise((resolve) => { resolveLate = resolve; }));
    await userEvent.click(screen.getByTestId('content-detail-retry'));
    await screen.findByTestId('content-retry-dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('content-retry-dialog')).toBeNull());
    await act(async () => {
      resolveLate?.(retryPreview());
      await Promise.resolve();
    });
    expect(screen.queryByTestId('content-retry-request')).toBeNull();
  });

  it('switches the workspace to the freshly regenerated run', async () => {
    setState({ detail: { a1: analysis({ status: 'completed' }) } });
    const onRegenerated = vi.fn();
    renderInRouter(
      <AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={onRegenerated} />,
    );
    fireEvent.click(screen.getByTestId('content-detail-regenerate'));
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(onRegenerated).toHaveBeenCalledWith('regenerated'));
  });

  it('does not navigate when regenerate fails', async () => {
    api.regenerateAnalysis.mockRejectedValue(new Error('boom'));
    setState({ detail: { a1: analysis({ status: 'completed' }) } });
    const onRegenerated = vi.fn();
    renderInRouter(
      <AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={onRegenerated} />,
    );
    fireEvent.click(screen.getByTestId('content-detail-regenerate'));
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(api.regenerateAnalysis).toHaveBeenCalled());
    expect(onRegenerated).not.toHaveBeenCalled();
  });

  it('shows a stopped-early alert with the mapped reason for a failed run', () => {
    setState({
      detail: {
        a1: analysis({
          status: 'failed',
          error: { category: 'serp_failed', messageKey: 'x', retryable: false, terminal: true },
        }),
      },
    });
    renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    expect(screen.getByTestId('content-detail-failed')).toHaveTextContent(
      'The search results could not be read.',
    );
  });
});

describe('ContentIntelligencePanel and page', () => {
  it('offers the canonical site origin as an owned-page suggestion', async () => {
    const view = renderInRouter(
      <ContentIntelligencePanel siteId="s1" siteOrigin="https://example.com" />,
    );
    await waitFor(() => expect(screen.getByTestId('content-form-url')).toHaveAttribute('list'));
    for (const tab of screen.getAllByRole('tab')) {
      const panelId = tab.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      expect(document.getElementById(panelId!)).toBeInTheDocument();
    }
    expect(view.container.querySelector('option[value="https://example.com"]')).toBeInTheDocument();
  });

  it('merges successful page and keyword suggestions without duplicates', async () => {
    setState({
      analyses: [analysis({
        ownedUrl: 'https://example.com/from-pages',
        keyword: 'tracked query',
      })],
      listLoaded: true,
    });
    const view = renderInRouter(
      <ContentIntelligencePanel siteId="s1" siteOrigin="https://example.com" />,
    );

    await waitFor(() => expect(suggestionsApi.fetchPagesList).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ range: '28d', sort: 'opportunity', limit: 100 }),
      expect.any(AbortSignal),
    ));
    await waitFor(() => expect(suggestionsApi.fetchTrackedKeywords).toHaveBeenCalledWith(
      's1',
      null,
      { signal: expect.any(AbortSignal) },
    ));
    await waitFor(() => {
      expect(view.container.querySelectorAll('option[value="https://example.com/from-pages"]')).toHaveLength(1);
      expect(view.container.querySelectorAll('option[value="tracked query"]')).toHaveLength(1);
    });
    expect(screen.queryByText('Loading known pages and tracked keywords…')).not.toBeInTheDocument();
  });

  it('keeps partial suggestions, reports the failed source, and retries both sources', async () => {
    suggestionsApi.fetchPagesList.mockRejectedValueOnce(new Error('pages offline'));
    suggestionsApi.fetchTrackedKeywords.mockResolvedValueOnce({
      keywords: [{ phrase: 'partial keyword' }],
    });
    setState({ listLoaded: true });
    const view = renderInRouter(<ContentIntelligencePanel siteId="s1" />);

    expect(await screen.findByText(/Some page or keyword suggestions could not be loaded/)).toBeInTheDocument();
    expect(view.container.querySelector('option[value="partial keyword"]')).toBeInTheDocument();
    suggestionsApi.fetchPagesList.mockResolvedValueOnce({
      items: [{ url: 'https://example.com/retried' }],
      nextCursor: null,
    });
    suggestionsApi.fetchTrackedKeywords.mockRejectedValueOnce(new Error('keywords offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Reload suggestions' }));
    await waitFor(() => expect(suggestionsApi.fetchPagesList).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(view.container.querySelector('option[value="https://example.com/retried"]')).toBeInTheDocument();
    });
    expect(screen.getByText(/Some page or keyword suggestions could not be loaded/)).toBeInTheDocument();
  });

  it('renders page composition, sub-views, and detail back navigation', async () => {
    const page = renderInRouter(<ContentIntelligencePage siteId="s1" />);
    expect(screen.getByTestId('content-new-analysis-form')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('content-view-monitoring'));
    expect(await screen.findByTestId('monitoring-panel')).toBeInTheDocument();
    page.unmount();

    const analysisId = '0123456789abcdef01234567';
    setState({ detail: { [analysisId]: analysis({ analysisId }) } });
    renderInRouter(<ContentIntelligencePanel siteId="s1" />, `/sites/s1?tab=content&analysis=${analysisId}`);
    expect(await screen.findByTestId('content-detail-regenerate')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('content-detail-back'));
    expect(await screen.findByTestId('content-new-analysis-form')).toBeInTheDocument();
  });

  it('ignores suggestions that settle after the panel unmounts', async () => {
    let resolvePages: ((value: unknown) => void) | undefined;
    suggestionsApi.fetchPagesList.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePages = resolve;
    }));
    setState({ listLoaded: true });
    const view = renderInRouter(<ContentIntelligencePanel siteId="s1" />);
    await waitFor(() => expect(suggestionsApi.fetchPagesList).toHaveBeenCalled());
    const signal = suggestionsApi.fetchPagesList.mock.calls[0]?.[2] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolvePages?.({ items: [{ url: 'https://example.com/late' }], nextCursor: null });
    });
  });

  it('focuses the new form from an empty list', () => {
    setState({ listLoaded: true });
    renderInRouter(<ContentIntelligencePanel siteId="s1" />);
    fireEvent.click(screen.getByTestId('content-list-empty-cta'));
    expect(screen.getByTestId('content-form-url')).toHaveFocus();
  });

  it('opens an analysis from the list and routes a successful submission', async () => {
    setState({ analyses: [analysis()], listLoaded: true });
    const listed = renderInRouter(<ContentIntelligencePanel siteId="s1" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]!);
    await waitFor(() => expect(screen.getByTestId('content-intelligence-panel')).toBeInTheDocument());
    listed.unmount();

    setState({
      listLoaded: true,
      formDraft: { ownedUrl: 'https://example.com/p', keyword: 'query', locale: 'en', consent: true },
    });
    renderInRouter(<ContentIntelligencePanel siteId="s1" />);
    fireEvent.submit(screen.getByTestId('content-form-submit').closest('form')!);
    await waitFor(() => expect(api.startAnalysis).toHaveBeenCalled());
  });

  it('renders the inventory panel for the inventory sub-view', () => {
    renderInRouter(<ContentIntelligencePanel siteId="s1" />, '/sites/s1?tab=content&view=inventory');
    expect(screen.getByTestId('inventory-panel')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-start-form')).toBeInTheDocument();
  });

  it('renders the competitor-content panel for the competitors sub-view', () => {
    renderInRouter(<ContentIntelligencePanel siteId="s1" />, '/sites/s1?tab=content&view=competitors');
    expect(screen.getByTestId('competitor-panel')).toBeInTheDocument();
  });

  it('routes briefs through the shared workspace', () => {
    renderInRouter(
      <ContentIntelligencePanel siteId="s1" />,
      '/sites/s1?tab=content&view=briefs',
    );
    expect(screen.getByTestId('content-briefs-workspace-seam')).toHaveAttribute(
      'data-site-id',
      's1',
    );
  });

  it('pushes deep-link prefill params into the new-analysis draft', async () => {
    setState({ listLoaded: true });
    const withUrl = renderInRouter(
      <ContentIntelligencePanel siteId="s1" />,
      '/sites/s1?tab=content&view=analyses&prefillUrl=https://example.com/x',
    );
    await waitFor(() =>
      expect(hooks.dispatch).toHaveBeenCalledWith(updateFormDraft({ ownedUrl: 'https://example.com/x' })),
    );
    withUrl.unmount();

    hooks.dispatch.mockClear();
    installThunkDispatch();
    setState({ listLoaded: true });
    renderInRouter(
      <ContentIntelligencePanel siteId="s1" />,
      '/sites/s1?tab=content&view=analyses&prefillKeyword=best+pricing',
    );
    await waitFor(() =>
      expect(hooks.dispatch).toHaveBeenCalledWith(updateFormDraft({ keyword: 'best pricing' })),
    );
  });

  it('returns to the list with the new-analysis form prefilled from the failed run', async () => {
    const id = '0123456789abcdef01234567';
    setState({
      detail: {
        [id]: analysis({
          analysisId: id,
          status: 'failed',
          error: { ...FAILED_ERROR, category: 'owned_page_unusable', reason: 'robots_blocked' },
          progress: { ...FAILED_PROGRESS, failureReasonCode: 'page_blocked', retryAction: 'edit_url' },
        }),
      },
    });
    const SearchProbe = () => <span data-testid="location-search">{useLocation().search}</span>;
    renderInRouter(
      <>
        <ContentIntelligencePanel siteId="s1" siteOrigin="https://example.com" />
        <SearchProbe />
      </>,
      `/sites/s1?tab=content&analysis=${id}`,
    );
    await userEvent.click(screen.getByTestId('content-detail-edit-url'));
    await waitFor(() => expect(screen.getByTestId('location-search')).not.toHaveTextContent('analysis='));
    const search = new URLSearchParams(screen.getByTestId('location-search').textContent ?? '');
    expect(search.get('prefillUrl')).toBe('https://example.com/guide');
    expect(search.get('prefillKeyword')).toBe('content audit');
  });
});
