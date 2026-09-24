import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@shared/api/client';
import type { ReportExportControlProps } from '@features/report-export';
import commonEn from '@shared/i18n/locales/en/common.json';
import en from '@shared/i18n/locales/en/contentIntelligence.json';
import ar from '@shared/i18n/locales/ar/contentIntelligence.json';
import type {
  ContentBriefDetail,
  ContentBriefListItem,
  ContentBriefListResponse,
} from './types';

const api = vi.hoisted(() => ({
  previewContentBrief: vi.fn(),
  createContentBrief: vi.fn(),
  listContentBriefs: vi.fn(),
  getContentBrief: vi.fn(),
  rescoreContentBrief: vi.fn(),
}));

vi.mock('./api', () => api);

vi.mock('@features/report-export', () => ({
  ReportExportControl: ({ kind, target, selection }: ReportExportControlProps) => (
    <div
      data-testid="report-export-control"
      data-kind={kind}
      data-scope={target.scope}
      data-selection={JSON.stringify(selection)}
    />
  ),
}));

import { ContentBriefEditorPage } from './components/ContentBriefEditorPage';
import { ContentBriefsPanel } from './components/ContentBriefsPanel';

const i18n = i18next.createInstance();
await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: { common: commonEn, contentIntelligence: en },
    ar: { contentIntelligence: ar },
  },
});

const NOW = '2026-08-01T12:00:00.000Z';

function item(overrides: Partial<ContentBriefListItem> = {}): ContentBriefListItem {
  return {
    id: 'brief-1',
    siteId: 's1',
    keyword: 'evidence led seo',
    status: 'completed',
    serpSource: 'stored',
    retainedDocumentCount: 1,
    halt: null,
    requestedAt: NOW,
    terminalAt: NOW,
    latestDraftVersion: 0,
    ...overrides,
  };
}

function detail(overrides: Partial<ContentBriefDetail> = {}): ContentBriefDetail {
  return {
    ...item(),
    creationEnabled: true,
    locale: 'en',
    serp: {
      source: 'stored',
      checkedAt: NOW,
      fetchedInsideUnit: false,
      paaRows: [
        {
          id: 'paa-1',
          question: '<img src=x onerror=alert(1)> What is proof?',
          answerDomain: 'answer.example',
          answerUrl: 'https://answer.example/source',
          trust: 'untrusted',
        },
      ],
    },
    documents: [
      {
        id: 'doc-1',
        sourceUrl: 'https://result.example/guide',
        title: '<script>alert(1)</script> Evidence guide',
        headings: [{ level: 1, text: '<b>Literal heading</b>' }],
        capturedAt: NOW,
        wordCount: 900,
        entityLabels: ['Article'],
        trust: 'untrusted',
      },
    ],
    corpusStats: {
      wordCount: { min: 800, max: 1_000, average: 900, documentCount: 1 },
      headingHistogram: { h1: 1, h2: 4, h3: 2, h4: 0, h5: 0, h6: 0 },
      entities: [{ label: 'Article', documentCount: 1 }],
      scrapeDates: [NOW],
    },
    outline: [
      {
        id: 'outline-1',
        heading: 'Explain the evidence',
        purpose: 'Give grounded guidance.',
        citations: ['doc-1', 'stat-word-average'],
        trust: 'untrusted',
      },
    ],
    questions: [{ question: 'What is proof?', citations: ['paa-1'], trust: 'untrusted' }],
    secondaryTerms: [{ id: 'term-1', term: 'proof driven seo' }],
    abstentions: ['contentBriefs.abstentions.malformedEvidence'],
    cost: {
      ceilingMicros: 120_000,
      initialMicros: 6_000,
      editorAiMicros: 0,
      residueMicros: 114_000,
      stages: [{ stage: 'scrape', costMicros: 1_000, source: 'estimated' }],
    },
    scoreHistory: [],
    ...overrides,
  };
}

function listResponse(
  items: ContentBriefListItem[] = [],
  nextCursor: string | null = null,
  creationEnabled = true,
): ContentBriefListResponse {
  return { creationEnabled, items, nextCursor };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPanel(path = '/sites/s1?tab=content&view=briefs') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <ContentBriefsPanel siteId="s1" />
        <LocationProbe />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function renderEditor(path = '/sites/s1/content-briefs/brief-1/editor') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/sites/:siteId/content-briefs/:briefId/editor" element={<ContentBriefEditorPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

async function getEnabledTargetKeyword() {
  const input = screen.getByLabelText('Target keyword');
  await waitFor(() => expect(input).toBeEnabled());
  return input;
}

function failure(status: number, message = ''): ApiError {
  return new ApiError('request failed', status, message ? { error: { message } } : {});
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  for (const mock of Object.values(api)) mock.mockReset();
  api.listContentBriefs.mockResolvedValue(listResponse());
  api.previewContentBrief.mockResolvedValue({});
  api.createContentBrief.mockResolvedValue({
    briefId: 'brief-created',
    status: 'queued',
    reservedUnits: 1,
    duplicate: false,
  });
  api.getContentBrief.mockResolvedValue(detail());
  api.rescoreContentBrief.mockResolvedValue(detail());
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
});

describe('content briefs list and request flow', () => {
  it('renders loading then empty and removes an invalid URL filter', async () => {
    let resolveList: ((value: ContentBriefListResponse) => void) | undefined;
    api.listContentBriefs.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    renderPanel('/sites/s1?tab=content&view=briefs&briefStatus=crafted&keep=1');
    expect(screen.getByLabelText('Loading briefs…')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('Target keyword')).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?tab=content&view=briefs&keep=1'));
    resolveList?.(listResponse());
    expect(await screen.findByText('No briefs yet')).toBeInTheDocument();
    expect(screen.getByLabelText('Target keyword')).not.toBeDisabled();
  });

  it('lists, filters, opens, paginates, and retries URL-backed results', async () => {
    api.listContentBriefs
      .mockResolvedValueOnce(listResponse([item()], 'next'))
      .mockResolvedValueOnce(listResponse([item({ id: 'brief-2', keyword: 'second keyword' })]))
      .mockResolvedValueOnce(listResponse([item()]));
    renderPanel();
    expect(await screen.findByTestId('content-brief-row-brief-1')).toHaveTextContent('evidence led seo');
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByTestId('content-brief-row-brief-2')).toBeInTheDocument();
    expect(api.listContentBriefs).toHaveBeenLastCalledWith('s1', 'all', 'next');

    await userEvent.click(screen.getByRole('combobox', { name: 'Status filter' }));
    await userEvent.click(screen.getByRole('option', { name: 'Complete' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('briefStatus=completed'));

    await userEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]!);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('brief=brief-1'));
  });

  it('previews normalized input, discloses unmetered usage, and cancels without spend', async () => {
    renderPanel();
    const pendingInput = screen.getByLabelText('Target keyword');
    fireEvent.submit(pendingInput.closest('form')!);
    expect(api.previewContentBrief).not.toHaveBeenCalled();
    const input = await getEnabledTargetKeyword();
    fireEvent.submit(input.closest('form')!);
    expect(api.previewContentBrief).not.toHaveBeenCalled();
    await userEvent.type(input, '  Evidence   Led SEO  ');
    await userEvent.click(screen.getByRole('button', { name: 'Review estimate' }));
    expect(await screen.findByTestId('content-brief-preview')).toHaveTextContent(
      'Plan usage limits are not metered in self-hosted mode.',
    );
    expect(api.previewContentBrief).toHaveBeenCalledWith(
      's1',
      { keyword: 'Evidence Led SEO', locale: 'en' },
    );
    expect(screen.getByRole('button', { name: 'Create brief' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.createContentBrief).not.toHaveBeenCalled();
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('keeps a reviewed estimate inert if creation is disabled before confirmation', async () => {
    api.listContentBriefs
      .mockResolvedValueOnce(listResponse([], 'next', true))
      .mockResolvedValueOnce(listResponse([], null, false));
    renderPanel();
    await userEvent.type(await getEnabledTargetKeyword(), 'proof');
    await userEvent.click(screen.getByRole('button', { name: 'Review estimate' }));
    const confirm = await screen.findByRole('button', { name: 'Create brief' });
    expect(confirm).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(screen.getByTestId('brief-state-disabled')).toBeInTheDocument();

    // A stale programmatic event cannot bypass the runtime disabled guard.
    type FiberNode = { memoizedProps?: Record<string, unknown>; return: FiberNode | null };
    const fiberKey = Object.keys(confirm).find((key) => key.startsWith('__reactFiber'));
    let node = fiberKey
      ? (confirm as unknown as Record<string, FiberNode>)[fiberKey] ?? null
      : null;
    let onClick: (() => void) | null = null;
    while (node) {
      if (typeof node.memoizedProps?.onClick === 'function') {
        onClick = node.memoizedProps.onClick as () => void;
        break;
      }
      node = node.return;
    }
    expect(onClick).not.toBeNull();
    await act(async () => {
      onClick?.();
      await Promise.resolve();
    });
    expect(api.createContentBrief).not.toHaveBeenCalled();
  });

  it('confirms a preview once and opens the queued detail', async () => {
    api.getContentBrief.mockResolvedValue(detail({
      id: 'brief-created',
      status: 'queued',
      terminalAt: null,
      corpusStats: null,
      documents: [],
      outline: [],
      questions: [],
      secondaryTerms: [],
      abstentions: [],
    }));
    renderPanel();
    await userEvent.type(await getEnabledTargetKeyword(), 'proof');
    await userEvent.click(screen.getByRole('button', { name: 'Review estimate' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create brief' }));
    expect(await screen.findByTestId('content-brief-running')).toBeInTheDocument();
    expect(api.createContentBrief).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location')).toHaveTextContent('brief=brief-created');
  });

  it('renders an honest creation failure after a successful preview', async () => {
    api.createContentBrief.mockRejectedValue(failure(500));
    renderPanel();
    await userEvent.type(await getEnabledTargetKeyword(), 'proof');
    await userEvent.click(screen.getByRole('button', { name: 'Review estimate' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create brief' }));
    expect(await screen.findByTestId('brief-state-failed')).toBeInTheDocument();
  });

  it('removes the status URL parameter when All is selected', async () => {
    api.listContentBriefs.mockResolvedValue(listResponse([item()]));
    renderPanel('/sites/s1?tab=content&view=briefs&briefStatus=completed');
    await screen.findByTestId('content-brief-row-brief-1');
    await userEvent.click(screen.getByRole('combobox', { name: 'Status filter' }));
    await userEvent.click(screen.getByRole('option', { name: 'All statuses' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('?tab=content&view=briefs'),
    );
    expect(screen.getByTestId('location')).not.toHaveTextContent('briefStatus=');
  });

  it('shows a retryable pagination failure and ignores an aborted list request', async () => {
    api.listContentBriefs
      .mockResolvedValueOnce(listResponse([item()], 'next'))
      .mockRejectedValueOnce(failure(500));
    const first = renderPanel();
    await screen.findByTestId('content-brief-row-brief-1');
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByTestId('brief-state-failed')).toBeInTheDocument();
    first.unmount();

    let rejectList: ((reason: unknown) => void) | undefined;
    api.listContentBriefs.mockReturnValue(
      new Promise((_, reject) => {
        rejectList = reject;
      }),
    );
    const aborted = renderPanel();
    aborted.unmount();
    await act(async () => {
      rejectList?.(failure(500));
      await Promise.resolve();
    });
  });

  it.each([
    [503, 'disabled', 'Content briefs are unavailable'],
    [500, 'failed', 'The brief could not finish'],
  ] as const)('maps preview status %s to the honest %s state', async (status, kind, copy) => {
    api.previewContentBrief.mockRejectedValue(failure(status));
    renderPanel();
    await userEvent.type(await getEnabledTargetKeyword(), 'proof');
    await userEvent.click(screen.getByRole('button', { name: 'Review estimate' }));
    expect(await screen.findByTestId(`brief-state-${kind}`)).toHaveTextContent(copy);
  });

  it.each([
    [503, 'disabled'],
    [500, 'failed'],
  ] as const)('maps list status %s to %s and retries failures', async (status, kind) => {
    api.listContentBriefs.mockRejectedValueOnce(failure(status));
    renderPanel();
    expect(await screen.findByTestId(`brief-state-${kind}`)).toBeInTheDocument();
    if (kind === 'failed') {
      api.listContentBriefs.mockResolvedValueOnce(listResponse());
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('No briefs yet')).toBeInTheDocument();
    }
  });

  it('shows a paginated kill-switch refusal without a retry action', async () => {
    api.listContentBriefs
      .mockResolvedValueOnce(listResponse([item()], 'next'))
      .mockRejectedValueOnce(failure(503));
    renderPanel();
    await screen.findByTestId('content-brief-row-brief-1');
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByTestId('brief-state-disabled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('keeps stored rows available while creation is paused', async () => {
    api.listContentBriefs.mockResolvedValue(listResponse([item()], null, false));
    renderPanel();
    expect(await screen.findByTestId('content-brief-row-brief-1')).toBeInTheDocument();
    expect(screen.getByTestId('brief-state-disabled')).toBeInTheDocument();
    expect(screen.getByLabelText('Target keyword')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review estimate' })).toBeDisabled();
    expect(api.previewContentBrief).not.toHaveBeenCalled();
  });
});

describe('content brief detail states', () => {
  it('renders dates, corpus, literal hostile text, citations, PAA, terms, and abstention copy', async () => {
    api.getContentBrief.mockResolvedValue(detail({
      halt: { stage: 'brief_ai', reason: 'malformed_output' },
      status: 'completed_partial',
    }));
    const view = renderPanel('/sites/s1?tab=content&view=briefs&brief=brief-1');
    const panel = await screen.findByTestId('content-brief-detail');
    expect(panel).toHaveTextContent('Top-10 average from pages scraped on');
    expect(panel).toHaveTextContent('800–1000');
    expect(panel).toHaveTextContent('<script>alert(1)</script> Evidence guide');
    expect(view.container.querySelector('script')).toBeNull();
    expect(screen.getByTestId('brief-citation-doc-1')).toBeInTheDocument();
    expect(screen.getByTestId('brief-citation-paa-1')).toBeInTheDocument();
    expect(panel).toHaveTextContent('proof driven seo');
    expect(screen.getByTestId('content-brief-halt-brief_ai')).toHaveTextContent('ungrounded AI response');
    expect(screen.getByTestId('content-brief-abstentions')).toHaveTextContent('Ungrounded or malformed AI output was discarded');
    expect(screen.getByRole('link', { name: /Evidence guide/ })).toHaveAttribute(
      'rel',
      'nofollow ugc noopener noreferrer',
    );
    expect(screen.getByRole('link', { name: 'Open editor' })).toHaveAttribute('href', '/sites/s1/content-briefs/brief-1/editor');
  });

  it('renders empty evidence, missing stats, absent sections, and a failed terminal', async () => {
    api.getContentBrief.mockResolvedValue(detail({
      status: 'failed',
      documents: [],
      corpusStats: null,
      outline: [],
      questions: [],
      secondaryTerms: [],
      serp: { source: 'fetched', checkedAt: NOW, fetchedInsideUnit: true, paaRows: [] },
      abstentions: ['contentBriefs.abstentions.noDocuments', 'unknown.code'],
    }));
    renderPanel('/sites/s1?tab=content&view=briefs&brief=brief-1');
    expect(await screen.findByTestId('brief-state-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('content-brief-corpus')).toBeNull();
    expect(screen.getByText('No source document was retained.')).toBeInTheDocument();
    expect(screen.getByText('The model abstained because the stored evidence was insufficient.')).toBeInTheDocument();
    expect(screen.getByText('No cited question survived the evidence checks.')).toBeInTheDocument();
    expect(screen.getByText('No stored cluster contains this keyword.')).toBeInTheDocument();
    expect(screen.getByTestId('content-brief-abstentions')).toHaveTextContent('A section was omitted');
  });

  it('renders nullable corpus guidance and both linked and unlinked source labels', async () => {
    api.getContentBrief.mockResolvedValue(
      detail({
        corpusStats: {
          wordCount: { min: null, max: null, average: null, documentCount: 2 },
          headingHistogram: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
          entities: [],
          scrapeDates: [],
        },
        documents: [
          {
            id: 'doc-1',
            sourceUrl: null,
            title: 'Unlinked retained title',
            headings: [],
            capturedAt: NOW,
            wordCount: 0,
            entityLabels: [],
            trust: 'untrusted',
          },
          {
            id: 'doc-2',
            sourceUrl: 'https://result.example/untitled',
            title: '',
            headings: [],
            capturedAt: NOW,
            wordCount: 0,
            entityLabels: [],
            trust: 'untrusted',
          },
        ],
      }),
    );
    renderPanel('/sites/s1?tab=content&view=briefs&brief=brief-1');
    const corpus = await screen.findByTestId('content-brief-corpus');
    expect(corpus).toHaveTextContent('—–—');
    expect(corpus).toHaveTextContent('no retained dates');
    expect(corpus).toHaveTextContent('No structured-data entities were retained');
    expect(screen.getByText('Unlinked retained title')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://result.example/untitled' })).toBeInTheDocument();
  });

  it('polls a running brief and replaces it with the completed state', async () => {
    vi.useFakeTimers();
    api.getContentBrief
      .mockResolvedValueOnce(detail({ status: 'running', terminalAt: null }))
      .mockResolvedValueOnce(detail());
    renderPanel('/sites/s1?tab=content&view=briefs&brief=brief-1');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('content-brief-running')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(screen.queryByTestId('content-brief-running')).toBeNull();
    expect(api.getContentBrief).toHaveBeenCalledTimes(2);
  });

  it('renders detail disabled and generic failures without leaking raw objects', async () => {
    api.getContentBrief.mockRejectedValue(failure(503));
    const first = renderPanel('/sites/s1?tab=content&view=briefs&brief=brief-1');
    expect(await screen.findByTestId('brief-state-disabled')).toBeInTheDocument();
    first.unmount();
    api.getContentBrief.mockRejectedValue(failure(500));
    renderPanel('/sites/s1?tab=content&view=briefs&brief=brief-1');
    expect(await screen.findByTestId('brief-state-failed')).toBeInTheDocument();
  });

  it('keeps a stored detail readable while creation is paused', async () => {
    api.getContentBrief.mockResolvedValue(detail({ creationEnabled: false }));
    renderPanel('/sites/s1?tab=content&view=briefs&brief=brief-1');
    expect(await screen.findByTestId('content-brief-detail')).toHaveTextContent('evidence led seo');
    expect(screen.getByTestId('brief-state-disabled')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open editor' })).toBeInTheDocument();
  });

  it('does not publish detail state after the view is unmounted', async () => {
    let resolveDetail: ((value: ContentBriefDetail) => void) | undefined;
    api.getContentBrief.mockReturnValue(
      new Promise((resolve) => {
        resolveDetail = resolve;
      }),
    );
    const first = renderPanel('/sites/s1?tab=content&view=briefs&brief=brief-1');
    first.unmount();
    await act(async () => {
      resolveDetail?.(detail());
      await Promise.resolve();
    });

    let rejectDetail: ((reason: unknown) => void) | undefined;
    api.getContentBrief.mockReturnValue(
      new Promise((_, reject) => {
        rejectDetail = reject;
      }),
    );
    const second = renderPanel('/sites/s1?tab=content&view=briefs&brief=brief-1');
    second.unmount();
    await act(async () => {
      rejectDetail?.(failure(500));
      await Promise.resolve();
    });
  });

  it('returns from detail while preserving tab, view, and status state', async () => {
    renderPanel('/sites/s1?tab=content&view=briefs&briefStatus=completed&brief=brief-1');
    await screen.findByTestId('content-brief-detail');
    await userEvent.click(screen.getByRole('button', { name: 'Back to briefs' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?tab=content&view=briefs&briefStatus=completed'));
    expect(screen.getByTestId('location')).not.toHaveTextContent('brief=');
  });
});

describe('content brief editor', () => {
  it('passes the latest immutable draft version to report export', async () => {
    api.getContentBrief.mockResolvedValue(detail({ latestDraftVersion: 7 }));
    renderEditor();
    expect(await screen.findByTestId('report-export-control')).toHaveAttribute(
      'data-selection',
      JSON.stringify({ draftVersion: 7 }),
    );
  });

  it('loads the latest draft, re-scores it, and focuses the newest immutable history entry', async () => {
    const existing = detail({
      scoreHistory: [{
        version: 1,
        draft: 'Earlier draft',
        comparison: {
          wordCount: 2, corpusMin: 800, corpusMax: 1_000, corpusAverage: 900,
          wordDeltaFromAverage: -898, headingCount: 0, corpusAverageHeadings: 7,
          matchedEntities: 0, totalEntities: 1, deterministicScore: 2,
        },
        aiScore: null, aiRationale: null, aiCitations: [], aiCostMicros: 0,
        aiDisclosure: 'cost_ceiling', createdAt: NOW, trust: 'untrusted',
      }],
    });
    const updated = detail({
      scoreHistory: [...existing.scoreHistory, {
        version: 2,
        draft: '# Better draft',
        comparison: {
          wordCount: 2, corpusMin: 800, corpusMax: 1_000, corpusAverage: 900,
          wordDeltaFromAverage: -898, headingCount: 1, corpusAverageHeadings: 7,
          matchedEntities: 1, totalEntities: 1, deterministicScore: 35,
        },
        aiScore: 72, aiRationale: '<b>Grounded literal rationale</b>', aiCitations: ['doc-1'],
        aiCostMicros: 5_000, aiDisclosure: 'scored', createdAt: NOW, trust: 'untrusted',
      }],
    });
    api.getContentBrief.mockResolvedValue(existing);
    api.rescoreContentBrief.mockResolvedValue(updated);
    const view = renderEditor();
    const textarea = await screen.findByLabelText('Draft');
    expect(textarea).toHaveValue('Earlier draft');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, '# Better draft');
    await userEvent.click(screen.getByRole('button', { name: 'Score this version' }));
    const newest = await screen.findByTestId('content-brief-score-2');
    await waitFor(() => expect(newest.parentElement).toHaveFocus());
    expect(screen.getByTestId('content-brief-score-2')).toHaveTextContent('AI guidance: 72/100');
    expect(screen.getByTestId('content-brief-score-2')).toHaveTextContent('<b>Grounded literal rationale</b>');
    expect(view.container.querySelector('b')).toBeNull();
    expect(api.rescoreContentBrief).toHaveBeenCalledWith('s1', 'brief-1', { draft: '# Better draft', locale: 'en' });
    expect(screen.getByRole('link', { name: 'Back to briefs' })).toHaveAttribute('href', '/sites/s1?tab=content&view=briefs&brief=brief-1');
  });

  it.each(['cost_ceiling', 'provider_error', 'malformed_output'] as const)(
    'renders deterministic-only history for %s',
    async (aiDisclosure) => {
      api.getContentBrief.mockResolvedValue(detail({
        scoreHistory: [{
          version: 1,
          draft: 'Draft',
          comparison: {
            wordCount: 1, corpusMin: null, corpusMax: null, corpusAverage: null,
            wordDeltaFromAverage: null, headingCount: 0, corpusAverageHeadings: null,
            matchedEntities: 0, totalEntities: 0, deterministicScore: 0,
          },
          aiScore: null, aiRationale: null, aiCitations: [], aiCostMicros: 0,
          aiDisclosure, createdAt: NOW, trust: 'untrusted',
        }],
      }));
      renderEditor();
      expect(await screen.findByText('Deterministic guidance only')).toBeInTheDocument();
      expect(screen.getByTestId('content-brief-score-1')).not.toHaveTextContent('ranking guarantee');
    },
  );

  it('renders load and re-score failures and enforces the client draft bound', async () => {
    api.getContentBrief.mockRejectedValueOnce(failure(404, 'Brief not found'));
    const missing = renderEditor();
    expect(await screen.findByText('Brief not found')).toBeInTheDocument();
    missing.unmount();

    api.getContentBrief.mockResolvedValue(detail());
    api.rescoreContentBrief.mockRejectedValue(failure(429, 'Slow down'));
    renderEditor();
    const textarea = await screen.findByLabelText('Draft');
    expect(textarea).toHaveAttribute('maxlength', '50000');
    await userEvent.type(textarea, 'Draft');
    await userEvent.click(screen.getByRole('button', { name: 'Score this version' }));
    expect(await screen.findByText('Slow down')).toBeInTheDocument();
  });

  it('shows stored editor history but prevents re-scoring while creation is paused', async () => {
    api.getContentBrief.mockResolvedValue(detail({ creationEnabled: false }));
    renderEditor();
    expect(await screen.findByTestId('content-brief-editor')).toBeInTheDocument();
    expect(screen.getByTestId('brief-state-disabled')).toBeInTheDocument();
    expect(screen.getByLabelText('Draft')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Score this version' })).toBeDisabled();
    expect(screen.getByTestId('report-export-control')).toHaveAttribute('data-kind', 'content.brief');
    expect(screen.getByTestId('report-export-control')).toHaveAttribute(
      'data-scope',
      'site_resource',
    );
    expect(api.rescoreContentBrief).not.toHaveBeenCalled();
  });

  it('handles disabled, plain, empty, and aborted editor loads without stale state', async () => {
    api.getContentBrief.mockRejectedValueOnce(failure(503));
    const disabled = renderEditor();
    expect(await screen.findByText('This feature is currently disabled. Stored data remains unchanged.')).toBeInTheDocument();
    disabled.unmount();

    api.getContentBrief.mockRejectedValueOnce(new Error('plain failure'));
    const plain = renderEditor();
    expect(await screen.findByText('We could not load this brief.')).toBeInTheDocument();
    plain.unmount();

    api.getContentBrief.mockResolvedValueOnce(null);
    const empty = renderEditor();
    expect(await screen.findByText('We could not load this brief.')).toBeInTheDocument();
    empty.unmount();

    api.getContentBrief.mockResolvedValueOnce(detail());
    renderEditor();
    const textarea = await screen.findByLabelText('Draft');
    fireEvent.submit(textarea.closest('form')!);
    expect(api.rescoreContentBrief).not.toHaveBeenCalled();

    let rejectLoad: ((reason: unknown) => void) | undefined;
    api.getContentBrief.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectLoad = reject;
      }),
    );
    const aborted = renderEditor();
    aborted.unmount();
    await act(async () => {
      rejectLoad?.(failure(500));
      await Promise.resolve();
    });
  });

  it('renders Arabic RTL copy and uses logical directional utilities only', async () => {
    await i18n.changeLanguage('ar');
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    renderEditor();
    expect(await screen.findByTestId('content-brief-editor')).toHaveTextContent('محرر المسودة');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    for (const source of [
      (await import('./components/ContentBriefsPanel.tsx?raw') as { default: string }).default,
      (await import('./components/ContentBriefEditorPage.tsx?raw') as { default: string }).default,
    ]) {
      expect(source).not.toMatch(/\b(?:left|right|ml-|mr-|pl-|pr-|text-left|text-right)\b/);
      expect(source).not.toContain('dangerouslySetInnerHTML');
    }
  });
});
