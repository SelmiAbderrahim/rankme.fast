import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import commonEn from '@shared/i18n/locales/en/common.json';
import en from '@shared/i18n/locales/en/contentIntelligence.json';
import type { ContentAnalysis } from '../types';
import { initialState, updateFormDraft } from '../store/slice';

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
    ['https://example.com/page', 'x'.repeat(201), 'Keep the target keyword under 200 characters.'],
  ])('validates manual page and keyword input %s', async (ownedUrl, keyword, message) => {
    setState({ formDraft: { ownedUrl, keyword, locale: 'xx', consent: true } });
    renderInRouter(<NewAnalysisForm siteId="s1" siteOrigin="https://example.com" />);
    fireEvent.blur(screen.getByTestId('content-form-url'));
    fireEvent.blur(screen.getByTestId('content-form-keyword'));
    fireEvent.submit(screen.getByTestId('content-form-submit').closest('form')!);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(api.preflightAnalysis).not.toHaveBeenCalled();
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
    expect(screen.getByTestId('content-detail-regenerate')).toBeInTheDocument();
  });

  it('aborts an active detail poll when the selected analysis unmounts', async () => {
    vi.useFakeTimers();
    setState({ detail: { a1: analysis({ status: 'scoring' }) } });
    api.getAnalysis
      .mockResolvedValueOnce(analysis({ status: 'scoring' }))
      .mockImplementationOnce((_analysisId, _siteId, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
    const view = renderInRouter(
      <AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />,
    );
    await vi.advanceTimersByTimeAsync(4000);
    const signal = api.getAnalysis.mock.calls[1]?.[2]?.signal;
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await vi.runAllTimersAsync();
  });

  it('polls and cancels non-terminal analyses, showing live stage progress', async () => {
    vi.useFakeTimers();
    setState({
      detail: {
        a1: analysis({
          status: 'scoring',
          stages: [
            { name: 'queued', startedAt: '2026-07-01T00:00:00Z', completedAt: '2026-07-01T00:00:01Z', error: null },
            { name: 'collecting_owned', startedAt: '2026-07-01T00:00:01Z', completedAt: '2026-07-01T00:00:02Z', error: null },
            { name: 'scoring', startedAt: '2026-07-01T00:00:02Z', completedAt: null, error: null },
          ],
        }),
      },
    });
    const view = renderInRouter(<AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />);
    // Live progress card: spinner, honest completed-stage bar (2/7 ≈ 29%),
    // current stage label, and "Step 5 of 7".
    expect(screen.getByTestId('content-detail-progress')).toBeInTheDocument();
    expect(screen.getByTestId('content-detail-progress-spinner')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '29');
    expect(screen.getByTestId('content-detail-progress-step')).toHaveTextContent('Step 5 of 7');
    expect(screen.getByText('Brief is not available for this run.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Owned page' })).toHaveAttribute(
      'href',
      'https://example.com/guide',
    );
    await vi.advanceTimersByTimeAsync(4000);
    expect(api.getAnalysis).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('content-detail-cancel'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel analysis' }));
    expect(api.cancelAnalysis).toHaveBeenCalled();
    view.unmount();
  });

  it('pauses polling while the tab is hidden and resumes when it returns', async () => {
    vi.useFakeTimers();
    const setVisibility = (value: 'hidden' | 'visible') =>
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => value,
      });
    setVisibility('hidden');
    setState({ detail: { a1: analysis({ status: 'scoring' }) } });
    const view = renderInRouter(
      <AnalysisDetail siteId="s1" analysisId="a1" onBack={vi.fn()} onRegenerated={vi.fn()} />,
    );
    // Mounted hidden: no poll is scheduled even after the interval elapses.
    api.getAnalysis.mockClear();
    await vi.advanceTimersByTimeAsync(8000);
    fireEvent(document, new Event('visibilitychange'));
    expect(api.getAnalysis).not.toHaveBeenCalled();
    // Returning to the foreground re-fetches immediately.
    setVisibility('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(api.getAnalysis).toHaveBeenCalled();
    view.unmount();
    setVisibility('visible');
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
});
