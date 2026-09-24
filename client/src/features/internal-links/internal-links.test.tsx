import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@shared/api/client';
import type { ReportExportControlProps } from '@features/report-export';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import {
  InternalLinksPage,
  internalLinkLocale,
  inventorySurfaceHref,
} from './components/InternalLinksPage';
import { NewRunPanel } from './components/NewRunPanel';
import { RunList } from './components/RunList';
import { StateNotice, type InternalLinkNoticeKind } from './components/StateNotice';
import { SuggestionList } from './components/SuggestionList';
import type {
  InternalLinkPreview,
  InternalLinkRunDetail,
  InternalLinkRunSummary,
  InternalLinkSuggestion,
  InternalLinkUiState,
} from './types';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

vi.mock('@features/report-export', () => ({
  ReportExportControl: ({ kind, target, selection }: ReportExportControlProps) => (
    <button
      type="button"
      className="focus-visible:ring"
      data-testid="report-export-control"
      data-kind={kind}
      data-scope={target.scope}
      data-selection={JSON.stringify(selection)}
    >
      Export report
    </button>
  ),
}));

const mockedApi = vi.mocked(apiClient);
const SITE = 'a'.repeat(24);
const RUN = 'b'.repeat(24);
const DATE = '2026-08-01T10:00:00.000Z';
let search = '';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const suggestion = (
  overrides: Partial<InternalLinkSuggestion> = {},
): InternalLinkSuggestion => ({
  id: 'link-0123456789abcdefabcd',
  sourceUrl: 'https://example.test/blog/source',
  sourceSection: '/blog',
  sourceWordCount: 900,
  targetUrl: 'https://example.test/services/target',
  targetFlag: 'orphan',
  targetInboundCount: 0,
  confidence: 'high',
  sharedQueries: ['seo audit'],
  headingMatches: ['audit', 'technical'],
  anchorText: 'technical SEO audit',
  inventoryDate: DATE,
  rank: 1,
  rankingSource: 'ai',
  ...overrides,
});

const summary = (
  overrides: Partial<InternalLinkRunSummary> = {},
): InternalLinkRunSummary => ({
  id: RUN,
  siteId: SITE,
  status: 'completed',
  aiStatus: 'applied',
  inventoryDate: DATE,
  gscSnapshotDate: '2026-07-31',
  candidateRulesVersion: '2026-08-02.1',
  suggestionCount: 2,
  refunded: false,
  requestedAt: DATE,
  startedAt: DATE,
  completedAt: DATE,
  error: null,
  ...overrides,
});

const detail = (
  overrides: Partial<InternalLinkRunDetail> = {},
): InternalLinkRunDetail => ({
  ...summary(),
  suggestions: [
    suggestion(),
    suggestion({
      id: 'link-fedcba9876543210fedc',
      sourceUrl: 'javascript:alert(1)<img src=x onerror=window.__linkPwned=1>',
      sourceSection: '/guides',
      targetUrl: '<script>window.__targetPwned=1</script>',
      targetFlag: 'weakly_linked',
      targetInboundCount: 1,
      confidence: 'low',
      sharedQueries: [],
      headingMatches: [],
      anchorText: '=SUM(1)<svg onload=window.__anchorPwned=1>',
      rank: null,
      rankingSource: 'deterministic',
    }),
  ],
  ...overrides,
});

const readyPreview = (
  overrides: Partial<InternalLinkPreview> = {},
): InternalLinkPreview => ({
  ready: true,
  reason: null,
  inventoryDate: DATE,
  freshnessDays: 7,
  ...overrides,
});

interface ApiHandlers {
  list?: () => unknown;
  preview?: () => unknown;
  start?: () => unknown;
  run?: () => unknown;
  csv?: () => unknown;
}

const resolved = (fn: (() => unknown) | undefined, fallback: unknown) => {
  try {
    return Promise.resolve(fn ? fn() : fallback) as never;
  } catch (error) {
    return Promise.reject(error) as never;
  }
};

const routeApi = (handlers: ApiHandlers = {}) => {
  mockedApi.mockImplementation((path: string, options?: { method?: string; headers?: HeadersInit }) => {
    if (path.endsWith('/export.csv')) return resolved(handlers.csv, '\ufeffsource_url\r\n');
    if (path.includes('/internal-link-runs/preview')) {
      return resolved(handlers.preview, readyPreview());
    }
    if (path.startsWith('/sites/') && path.endsWith('/internal-link-runs') && options?.method === 'POST') {
      return resolved(handlers.start, detail({ status: 'queued', aiStatus: 'pending', suggestions: [] }));
    }
    if (path.startsWith('/sites/') && path.endsWith('/internal-link-runs')) {
      return resolved(handlers.list, { items: [summary()] });
    }
    if (path.startsWith('/internal-link-runs/')) return resolved(handlers.run, detail());
    return Promise.reject(new Error(`unexpected API path: ${path}`)) as never;
  });
};

const LocationProbe = () => {
  search = useLocation().search;
  return null;
};

const renderWithI18n = (node: React.ReactNode, entry = `/sites/${SITE}?tab=internal-links`) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[entry]}>
        {node}
        <LocationProbe />
      </MemoryRouter>
    </I18nextProvider>,
  );

const renderPage = (entry = `/sites/${SITE}?tab=internal-links`) =>
  renderWithI18n(<InternalLinksPage siteId={SITE} />, entry);

beforeEach(async () => {
  await initI18n();
  await changeLanguage('en');
  mockedApi.mockReset();
  search = '';
  delete (window as unknown as Record<string, unknown>).__linkPwned;
  delete (window as unknown as Record<string, unknown>).__targetPwned;
  delete (window as unknown as Record<string, unknown>).__anchorPwned;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('InternalLinksPage — saved runs and URL-backed filters', () => {
  it('lists the workspace site runs and switches to the new-run view', async () => {
    routeApi();
    const user = userEvent.setup();
    renderPage(`/sites/${SITE}?tab=internal-links`);
    expect(await screen.findByTestId('internal-links-run-list')).toBeInTheDocument();
    // The site comes from the route, so the panel never writes a `?siteId=`
    // and never renders a picker.
    expect(search).not.toContain('siteId=');
    expect(screen.queryByRole('combobox', { name: 'Site' })).toBeNull();
    await user.click(screen.getByTestId('internal-links-tab-new'));
    await waitFor(() => expect(search).toContain('view=new'));
  });

  it('reopens evidence, renders hostile values inertly, copies anchors, and filters in the URL', async () => {
    routeApi();
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    renderPage(`/sites/${SITE}?tab=internal-links&run=${RUN}`);
    expect(await screen.findByTestId('internal-links-suggestions')).toBeInTheDocument();
    const hostile = detail().suggestions[1]!;
    expect(screen.getByText(hostile.sourceUrl)).toBeInTheDocument();
    expect(screen.getByText(hostile.targetUrl)).toBeInTheDocument();
    expect(screen.getByText(hostile.anchorText)).toBeInTheDocument();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__linkPwned).toBeUndefined();
    expect((window as unknown as Record<string, unknown>).__targetPwned).toBeUndefined();
    expect((window as unknown as Record<string, unknown>).__anchorPwned).toBeUndefined();

    await user.click(screen.getAllByRole('button', { name: 'Why this pair was suggested' })[0]!);
    expect(screen.getByText('seo audit')).toBeInTheDocument();
    expect(screen.getByText('Target inbound links')).toBeInTheDocument();
    await user.click(screen.getByTestId(`internal-links-copy-${hostile.id}`));
    expect(writeText).toHaveBeenCalledWith(hostile.anchorText);
    expect(screen.getByTestId(`internal-links-copy-${hostile.id}`)).toHaveTextContent('Copied');
    const promptButtons = screen.getAllByRole('button', { name: 'Copy code prompt' });
    expect(promptButtons).toHaveLength(2);
    await user.click(promptButtons[0]!);
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(
        expect.stringContaining('"reference": "internal-link-suggestion"'),
      ),
    );
    expect(writeText.mock.calls.at(-1)?.[0]).toContain(
      '"anchorText": "technical SEO audit"',
    );

    await user.click(screen.getByRole('combobox', { name: 'Target flag' }));
    await user.click(await screen.findByRole('option', { name: 'Orphan' }));
    await waitFor(() => expect(search).toContain('target=orphan'));
    expect(screen.queryByText(hostile.targetUrl)).toBeNull();

    await user.click(screen.getByRole('combobox', { name: 'Source section' }));
    await user.click(await screen.findByRole('option', { name: '/blog' }));
    await waitFor(() => expect(search).toContain('section=%2Fblog'));
    await user.click(screen.getByRole('combobox', { name: 'Confidence' }));
    await user.click(await screen.findByRole('option', { name: 'High' }));
    await waitFor(() => expect(search).toContain('confidence=high'));
  });

  it('shows the filtered empty state and deterministic fallback disclosure', async () => {
    routeApi({ run: () => detail({ aiStatus: 'provider_failed' }) });
    renderPage(
      `/sites/${SITE}?tab=internal-links&run=${RUN}&target=orphan&confidence=low`,
    );
    expect(await screen.findByTestId('internal-links-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('internal-links-state-emptySuggestions')).toBeInTheDocument();
  });

  it('wires the completed run and URL-backed filters into the report export registry', async () => {
    routeApi();
    renderPage(
      `/sites/${SITE}?tab=internal-links&run=${RUN}&target=orphan&confidence=low`,
    );
    const exportControl = await screen.findByTestId('report-export-control');
    expect(exportControl).toHaveAttribute('data-kind', 'internal_links.run');
    expect(exportControl).toHaveAttribute('data-scope', 'site_resource');
    expect(exportControl).toHaveAttribute(
      'data-selection',
      JSON.stringify({ targetFlag: ['orphan'], confidence: ['low'] }),
    );
  });

  it('shows an empty list and failed list state honestly', async () => {
    routeApi({ list: () => ({ items: [] }) });
    const empty = renderPage();
    expect(await screen.findByTestId('internal-links-state-emptyRuns')).toBeInTheDocument();
    empty.unmount();
    routeApi({ list: () => { throw new Error('offline'); } });
    renderPage();
    expect(await screen.findByTestId('internal-links-state-failed')).toBeInTheDocument();
  });
});

describe('InternalLinksPage — preview and lifecycle states', () => {
  it('previews the inventory date, cancels without starting, then confirms', async () => {
    routeApi({ start: () => detail({ status: 'completed' }) });
    const user = userEvent.setup();
    renderPage(`/sites/${SITE}?tab=internal-links&view=new`);
    await user.click(await screen.findByTestId('internal-links-preview-button'));
    expect(await screen.findByTestId('internal-links-preview')).toHaveTextContent(
      'Plan usage limits are not metered in self-hosted mode.',
    );
    expect(screen.getByTestId('internal-links-preview-date')).toHaveTextContent(DATE);
    await user.click(screen.getByTestId('internal-links-cancel'));
    expect(screen.queryByTestId('internal-links-preview')).toBeNull();
    expect(
      mockedApi.mock.calls.filter(
        ([path, options]) =>
          path === `/sites/${SITE}/internal-link-runs` && options?.method === 'POST',
      ),
    ).toHaveLength(0);

    await user.click(screen.getByTestId('internal-links-preview-button'));
    await user.click(await screen.findByTestId('internal-links-confirm'));
    await waitFor(() => expect(search).toContain(`run=${RUN}`));
    expect(search).not.toContain('tab=new');
    expect(await screen.findByTestId('internal-links-suggestions')).toBeInTheDocument();
  });

  it.each(['missing', 'stale'] as const)('renders the %s inventory state and CTA', async (reason) => {
    routeApi({
      preview: () => readyPreview({
        ready: false,
        reason,
        inventoryDate: reason === 'stale' ? DATE : null,
      }),
    });
    const user = userEvent.setup();
    renderPage(`/sites/${SITE}?tab=internal-links&view=new`);
    await user.click(await screen.findByTestId('internal-links-preview-button'));
    const notice = await screen.findByTestId(`internal-links-state-${reason}`);
    expect(within(notice).getByRole('link')).toHaveAttribute(
      'href',
      inventorySurfaceHref(SITE),
    );
  });

  it.each([
    [503, 'disabled'],
    [429, 'rateLimited'],
    [500, 'failed'],
  ] as const)('maps preview HTTP %s to the %s state', async (status, gate) => {
    routeApi({ preview: () => { throw new ApiError('refused', status, null); } });
    const user = userEvent.setup();
    renderPage(`/sites/${SITE}?tab=internal-links&view=new`);
    await user.click(await screen.findByTestId('internal-links-preview-button'));
    expect(await screen.findByTestId(`internal-links-state-${gate}`)).toBeInTheDocument();
  });

  it('renders the disabled state when the start is refused by the kill switch', async () => {
    routeApi({ start: () => { throw new ApiError('off', 503, null); } });
    const user = userEvent.setup();
    renderPage(`/sites/${SITE}?tab=internal-links&view=new`);
    await user.click(await screen.findByTestId('internal-links-preview-button'));
    await user.click(await screen.findByTestId('internal-links-confirm'));
    expect(await screen.findByTestId('internal-links-state-disabled')).toBeInTheDocument();
  });

  it('renders a running run, polls it to completion, and exposes the results', async () => {
    let calls = 0;
    routeApi({
      list: () => ({
        items: [summary(), summary({ id: 'e'.repeat(24), siteId: SITE })],
      }),
      run: () => {
        calls += 1;
        return calls <= 2
          ? detail({ status: 'processing', aiStatus: 'pending', suggestions: [] })
          : detail();
      },
    });
    renderPage(`/sites/${SITE}?tab=internal-links&run=${RUN}`);
    expect(await screen.findByTestId('internal-links-running')).toBeInTheDocument();
    expect(
      await screen.findByTestId('internal-links-suggestions', {}, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('discloses a polling failure without replacing the still-running record', async () => {
    let calls = 0;
    routeApi({
      run: () => {
        calls += 1;
        if (calls === 1) {
          return detail({ status: 'queued', aiStatus: 'pending', suggestions: [] });
        }
        throw new ApiError('offline', 500, null);
      },
    });
    renderPage(`/sites/${SITE}?tab=internal-links&run=${RUN}`);
    expect(await screen.findByTestId('internal-links-running')).toBeInTheDocument();
    expect(await screen.findByTestId('internal-links-state-failed', {}, { timeout: 4_000 })).toBeInTheDocument();
  });

  it('renders failed, not-found, and run-list failure states', async () => {
    routeApi({ run: () => detail({ status: 'failed', suggestions: [] }) });
    const failed = renderPage(`/sites/${SITE}?tab=internal-links&run=${RUN}`);
    expect(await screen.findByTestId('internal-links-state-failed')).toBeInTheDocument();
    failed.unmount();

    routeApi({ run: () => { throw new ApiError('gone', 404, null); } });
    const gone = renderPage(`/sites/${SITE}?tab=internal-links&run=${RUN}`);
    expect(await screen.findByTestId('internal-links-state-notFound')).toBeInTheDocument();
    gone.unmount();

    routeApi({ list: () => { throw new ApiError('off', 503, null); } });
    renderPage(`/sites/${SITE}?tab=internal-links`);
    expect(await screen.findByTestId('internal-links-state-disabled')).toBeInTheDocument();
  });

  it('renders a completed run with no retained candidates as an honest empty state', async () => {
    routeApi({ run: () => detail({ suggestions: [], suggestionCount: 0 }) });
    renderPage(`/sites/${SITE}?tab=internal-links&run=${RUN}`);
    expect(await screen.findByTestId('internal-links-state-emptySuggestions')).toBeInTheDocument();
  });
});

describe('internal-link async cleanup guards', () => {
  it('ignores a list rejection that arrives after unmount', async () => {
    const pending = deferred<never>();
    routeApi({ list: () => pending.promise });
    const view = renderPage(`/sites/${SITE}?tab=internal-links`);
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        `/sites/${SITE}/internal-link-runs`,
        expect.any(Object),
      ),
    );
    view.unmount();
    await act(async () => pending.reject(new Error('late')));
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a detail %s that arrives after unmount',
    async (outcome) => {
      const pending = deferred<InternalLinkRunDetail>();
      routeApi({ run: () => pending.promise });
      const view = renderPage(`/sites/${SITE}?tab=internal-links&run=${RUN}`);
      await waitFor(() =>
        expect(mockedApi).toHaveBeenCalledWith(
          `/internal-link-runs/${RUN}`,
          expect.any(Object),
        ),
      );
      view.unmount();
      await act(async () => {
        if (outcome === 'resolve') pending.resolve(detail());
        else pending.reject(new Error('late'));
      });
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'ignores an in-flight poll %s after unmount',
    async (outcome) => {
      let calls = 0;
      const pending = deferred<InternalLinkRunDetail>();
      routeApi({
        run: () => {
          calls += 1;
          return calls === 1
            ? detail({ status: 'queued', aiStatus: 'pending', suggestions: [] })
            : pending.promise;
        },
      });
      const view = renderPage(`/sites/${SITE}?tab=internal-links&run=${RUN}`);
      expect(await screen.findByTestId('internal-links-running')).toBeInTheDocument();
      await waitFor(() => expect(calls).toBe(2), { timeout: 3_000 });
      view.unmount();
      await act(async () => {
        if (outcome === 'resolve') pending.resolve(detail());
        else pending.reject(new Error('late'));
      });
    },
  );
});

describe('internal-link presentation primitives', () => {
  it('normalizes locale input and builds the inventory deep link', () => {
    expect(internalLinkLocale('ar')).toBe('ar');
    expect(internalLinkLocale('en-US')).toBe('en');
    expect(inventorySurfaceHref(SITE)).toBe(`/sites/${SITE}?tab=content&view=inventory`);
  });

  it('discloses unmetered usage and locks cancel while the run starts', () => {
    renderWithI18n(
      <NewRunPanel
        preview={readyPreview()}
        previewing={false}
        starting
        gate={null}
        onPreview={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Plan usage limits are not metered in self-hosted mode.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('internal-links-preview-date')).toHaveTextContent(DATE);
    expect(screen.getByTestId('internal-links-cancel')).toBeDisabled();
  });

  it('falls back to the missing-inventory notice when an unready preview omits a reason', () => {
    renderWithI18n(
      <NewRunPanel
        inventoryHref="/inventory"
        preview={{ ...readyPreview(), ready: false, reason: null }}
        previewing={false}
        starting={false}
        gate={null}
        onPreview={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByTestId('internal-links-state-missing')).toBeInTheDocument();
  });

  it('renders active, failed, refunded runs and forwards the open action', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const other = 'd'.repeat(24);
    renderWithI18n(
      <RunList
        runs={[
          summary(),
          summary({ id: other, status: 'failed', refunded: true }),
        ]}
        activeRunId={RUN}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText('Run returned')).toBeInTheDocument();
    await user.click(screen.getByTestId(`internal-links-open-${other}`));
    expect(onOpen).toHaveBeenCalledWith(other);
  });

  it('renders every notice kind and its optional actions', () => {
    const kinds: InternalLinkNoticeKind[] = [
      'emptyRuns', 'emptySuggestions', 'missing', 'stale',
      'disabled', 'rateLimited', 'notFound', 'failed',
    ];
    for (const kind of kinds) {
      const view = renderWithI18n(
        <StateNotice kind={kind} inventoryHref={kind === 'missing' ? '/inventory' : undefined} />,
      );
      expect(screen.getByTestId(`internal-links-state-${kind}`)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('keeps the copy label when clipboard access fails and renders empty evidence', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    const row = suggestion({ sharedQueries: [], headingMatches: [], rank: null });
    renderWithI18n(<SuggestionList suggestions={[row]} />);
    await user.click(screen.getByTestId(`internal-links-copy-${row.id}`));
    expect(screen.getByTestId(`internal-links-copy-${row.id}`)).toHaveTextContent('Copy anchor');
    await user.click(screen.getByRole('button', { name: 'Why this pair was suggested' }));
    expect(screen.getAllByText('No evidence of this type')).toHaveLength(2);
  });

  it.each(['disabled', 'rateLimited', 'notFound', 'failed'] as InternalLinkUiState[])(
    'renders the direct %s gate in the new-run panel',
    (gate) => {
      renderWithI18n(
        <NewRunPanel
            preview={null}
          previewing={false}
          starting={false}
          gate={gate}
          onPreview={vi.fn()}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />,
      );
      expect(screen.getByTestId(`internal-links-state-${gate}`)).toBeInTheDocument();
    },
  );
});

describe('internal-link accessibility and RTL', () => {
  it.each([
    'InternalLinksPage',
    'NewRunPanel',
    'RunList',
    'StateNotice',
    'SuggestionList',
  ])('%s uses logical directional utilities', async (name) => {
    const source = (await import(`./components/${name}.tsx?raw`)) as { default: string };
    expect(source.default).not.toMatch(/\btext-(?:left|right)\b/u);
    expect(source.default).not.toMatch(/\bfloat-(?:left|right)\b/u);
    expect(source.default).not.toMatch(/(?:^|["' \t]|:)[mp][lr]-\d/u);
    expect(source.default).not.toMatch(/(?:^|["' \t]|:)(?:left|right)-\d/u);
  });

  it('renders translated Arabic in an RTL workspace without an LTR island', async () => {
    routeApi();
    await changeLanguage('ar');
    document.documentElement.setAttribute('lang', 'ar');
    document.documentElement.setAttribute('dir', 'rtl');
    renderPage(`/sites/${SITE}?tab=internal-links&run=${RUN}`);
    const page = await screen.findByTestId('internal-links-page');
    expect(screen.getByRole('heading', { name: 'اقتراحات الروابط الداخلية' })).toBeVisible();
    expect(page.ownerDocument.documentElement).toHaveAttribute('dir', 'rtl');
    for (const node of page.querySelectorAll('[dir]')) {
      expect(node).toHaveAttribute('dir', 'rtl');
    }
  });

  it('keeps preview confirmation, cancellation, evidence, copy, and export keyboard reachable', async () => {
    routeApi();
    const user = userEvent.setup();
    const previewView = renderPage(`/sites/${SITE}?tab=internal-links&view=new`);
    const previewButton = await screen.findByTestId('internal-links-preview-button');
    previewButton.focus();
    await user.keyboard('{Enter}');
    const confirm = await screen.findByTestId('internal-links-confirm');
    const cancel = screen.getByTestId('internal-links-cancel');
    confirm.focus();
    expect(confirm).toHaveFocus();
    expect(confirm.className).toContain('focus-visible:');
    await user.tab();
    expect(cancel).toHaveFocus();
    previewView.unmount();

    renderPage(`/sites/${SITE}?tab=internal-links&run=${RUN}`);
    const evidence = (await screen.findAllByRole('button', {
      name: 'Why this pair was suggested',
    }))[0]!;
    evidence.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Target inbound links')).toBeVisible();
    const copy = screen.getByTestId('internal-links-copy-link-0123456789abcdefabcd');
    copy.focus();
    expect(copy).toHaveFocus();
    const exportButton = screen.getByTestId('report-export-control');
    expect(exportButton).toHaveAccessibleName('Export report');
    expect(exportButton.className).toContain('focus-visible:');
  });

  it('marks an in-flight preview busy and disabled until it resolves', async () => {
    let resolvePreview: ((value: InternalLinkPreview) => void) | undefined;
    routeApi({
      preview: () =>
        new Promise<InternalLinkPreview>((resolve) => {
          resolvePreview = resolve;
        }),
    });
    const user = userEvent.setup();
    renderPage(`/sites/${SITE}?tab=internal-links&view=new`);
    const button = await screen.findByTestId('internal-links-preview-button');
    await user.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    expect(button).toBeDisabled();
    expect(button.className).toContain('disabled:cursor-not-allowed');
    resolvePreview?.(readyPreview());
    await screen.findByTestId('internal-links-preview');
  });
});
