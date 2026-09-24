import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, __resetCsrfTokenCacheForTests } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type { ReportExportControlProps } from '@features/report-export';
import * as api from './api';
import { ToxicityWorkspace } from './components/ToxicityWorkspace';
import { serializeDisavowPreview } from './disavow';
import type { SpendPreview, ToxicityRow, ToxicityRunDetail, ToxicityRunsPage } from './types';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  previewToxicityReview: vi.fn(),
  startToxicityReview: vi.fn(),
  fetchToxicityRuns: vi.fn(),
  fetchToxicityReview: vi.fn(),
  downloadToxicityDisavow: vi.fn(),
}));

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

const mocked = vi.mocked(api);
const globalFetchSpy = vi.spyOn(globalThis, 'fetch');
const RUN_ID = '507f1f77bcf86cd799439011';

const previewFixture = (overrides: Partial<SpendPreview> = {}): SpendPreview => ({
  feature: 'backlinks',
  operation: 'toxicity_review',
  cachedStatus: 'unknown',
  breakdown: [
    {
      operationKey: 'bulk_spam_score_and_rubric',
      metric: 'toxicity_reviews',
      productUnits: 1,
      cachedStatus: 'unknown',
    },
  ],
  estimatedAt: '2026-08-01T12:00:00.000Z',
  ...overrides,
});

const rowFixture = (
  id: string,
  band: ToxicityRow['band'],
  overrides: Partial<ToxicityRow> = {},
): ToxicityRow => ({
  id,
  url: `https://${band}.example/path`,
  domain: `${band}.example`,
  spamScore: band === 'toxic' ? 80 : band === 'watch' ? 45 : 10,
  band,
  signals:
    band === 'toxic'
      ? ['spam_toxic', 'broken', 'dofollow']
      : band === 'watch'
        ? ['spam_watch', 'dofollow']
        : ['spam_clean', 'nofollow'],
  firstSeen: '2026-01-01T00:00:00.000Z',
  lastSeen: '2026-07-01T00:00:00.000Z',
  dofollow: band !== 'clean',
  isBroken: band === 'toxic',
  capturedAt: '2026-08-01T12:00:00.000Z',
  rubricVersion: 'toxicity-rubric-v1',
  sourceKind: 'provider_observation',
  rationale: {
    status: band === 'toxic' ? 'annotated' : 'abstained',
    text: band === 'toxic' ? 'Stored score and broken-link observation.' : null,
    citedRowId: band === 'toxic' ? id : null,
    rubricVersion: 'toxicity-rubric-v1',
    sourceKind: 'provider_observation',
  },
  ...overrides,
});

const detailFixture = (overrides: Partial<ToxicityRunDetail> = {}): ToxicityRunDetail => ({
  runId: RUN_ID,
  siteId: 'site-1',
  domain: 'owned.example',
  status: 'succeeded',
  rubricVersion: 'toxicity-rubric-v1',
  sourceKind: 'provider_observation',
  retainedCount: 3,
  bulkDomainCount: 3,
  refunded: false,
  providerStatus: 'succeeded',
  aiStatus: 'succeeded',
  failureKind: null,
  estimatedCostMicros: 30_000,
  createdAt: '2026-08-01T12:00:00.000Z',
  completedAt: '2026-08-01T12:01:00.000Z',
  rows: [
    rowFixture('11111111-1111-4111-8111-111111111111', 'toxic'),
    rowFixture('22222222-2222-4222-8222-222222222222', 'watch'),
    rowFixture('33333333-3333-4333-8333-333333333333', 'clean'),
  ],
  ...overrides,
});

const runsFixture = (detail = detailFixture()): ToxicityRunsPage => ({
  runs: [{ ...detail, rows: undefined } as never],
  nextCursor: null,
});

function renderWorkspace({
  entry = '/sites/site-1/backlinks?tab=toxicity',
}: { entry?: string } = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[entry]}>
        <ToxicityWorkspace siteId="site-1" />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  __resetCsrfTokenCacheForTests();
  mocked.fetchToxicityRuns.mockResolvedValue({ runs: [], nextCursor: null });
  mocked.fetchToxicityReview.mockResolvedValue(detailFixture());
  mocked.previewToxicityReview.mockResolvedValue(previewFixture());
  mocked.startToxicityReview.mockResolvedValue({
    runId: RUN_ID,
    siteId: 'site-1',
    status: 'queued',
    reservedUnits: 1,
    rowClamp: 1000,
  });
  mocked.downloadToxicityDisavow.mockResolvedValue(
    '# RankMeFast link review export\n# rubric: toxicity-rubric-v1\n# generated: 2026-08-01\ndomain:toxic.example\n',
  );
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:toxicity-download'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
});

describe('toxicity spend preview and states', () => {
  it('cancels a disclosed preview without starting or spending', async () => {
    renderWorkspace();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Preview review spend' }));
    expect(await screen.findByTestId('toxicity-preview')).toHaveTextContent(
      'Up to 1,000 rows · 100 scored domains',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocked.startToxicityReview).not.toHaveBeenCalled();
  });

  it('confirms once and opens the URL-backed run', async () => {
    renderWorkspace();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Preview review spend' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm and use 1 unit' }));
    await waitFor(() => expect(mocked.startToxicityReview).toHaveBeenCalledWith('site-1', 'en'));
    await waitFor(() =>
      expect(mocked.fetchToxicityReview).toHaveBeenCalledWith(
        RUN_ID,
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it('renders disabled, failed-refund, running, and empty states honestly', async () => {
    mocked.previewToxicityReview.mockRejectedValueOnce(new ApiError('off', 503, null));
    const second = renderWorkspace();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Preview review spend' }));
    expect(await screen.findByTestId('toxicity-disabled')).toBeInTheDocument();
    second.unmount();

    mocked.fetchToxicityReview.mockResolvedValueOnce(
      detailFixture({
        status: 'failed',
        refunded: true,
        providerStatus: 'failed',
        failureKind: 'provider_failed',
        rows: [],
      }),
    );
    const fourth = renderWorkspace({
      entry: `/sites/site-1/backlinks?tab=toxicity&toxRun=${RUN_ID}`,
    });
    expect(await screen.findByTestId('toxicity-failed')).toHaveTextContent('unit was refunded');
    fourth.unmount();

    mocked.fetchToxicityReview.mockResolvedValueOnce(
      detailFixture({ status: 'running', rows: [] }),
    );
    const fifth = renderWorkspace({
      entry: `/sites/site-1/backlinks?tab=toxicity&toxRun=${RUN_ID}`,
    });
    expect(await screen.findByTestId('toxicity-running')).toBeInTheDocument();
    fifth.unmount();

    mocked.fetchToxicityReview.mockResolvedValueOnce(detailFixture({ rows: [], retainedCount: 0 }));
    renderWorkspace({ entry: `/sites/site-1/backlinks?tab=toxicity&toxRun=${RUN_ID}` });
    expect(await screen.findByTestId('toxicity-empty')).toBeInTheDocument();
  });

  it('maps generic transport failures, including a failed start', async () => {
    mocked.previewToxicityReview.mockRejectedValueOnce(new Error('preview failed'));
    const failedPreview = renderWorkspace();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Preview review spend' }));
    expect(await screen.findByTestId('toxicity-start-error')).toBeInTheDocument();
    failedPreview.unmount();

    mocked.startToxicityReview.mockRejectedValueOnce(new Error('start failed'));
    renderWorkspace();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Preview review spend' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm and use 1 unit' }));
    expect(await screen.findByTestId('toxicity-start-error')).toBeInTheDocument();
  });
});

describe('toxicity URL state, loading, and run history', () => {
  it('removes invalid URL filters and renders a run-list failure', async () => {
    mocked.fetchToxicityRuns.mockRejectedValue(new Error('list failed'));
    renderWorkspace({
      entry: '/sites/site-1/backlinks?tab=toxicity&toxStatus=invalid&toxBand=invalid',
    });
    expect(await screen.findByText('Stored link reviews could not be loaded.')).toBeInTheDocument();
    expect(mocked.fetchToxicityRuns).toHaveBeenCalledWith(
      'site-1',
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('renders every run status and clears a URL-backed status filter', async () => {
    const statuses = ['succeeded', 'failed', 'running', 'queued'] as const;
    mocked.fetchToxicityRuns.mockResolvedValue({
      runs: statuses.map((status, index) => ({
        ...runsFixture().runs[0]!,
        runId: `${RUN_ID.slice(0, -1)}${index}`,
        status,
        createdAt: index === 0 ? 'not-a-date' : '2026-08-01T12:00:00.000Z',
      })),
      nextCursor: null,
    });
    renderWorkspace({ entry: '/sites/site-1/backlinks?tab=toxicity&toxStatus=failed' });
    expect(await screen.findByText('not-a-date')).toBeInTheDocument();
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Queued').length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Filter reviews by status'));
    await user.click(await screen.findByRole('option', { name: 'All statuses' }));
    await waitFor(() =>
      expect(mocked.fetchToxicityRuns).toHaveBeenCalledWith(
        'site-1',
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it('polls a queued review until it succeeds', async () => {
    mocked.fetchToxicityReview
      .mockResolvedValueOnce(detailFixture({ status: 'queued', rows: [] }))
      .mockResolvedValueOnce(detailFixture());
    renderWorkspace({ entry: `/sites/site-1/backlinks?tab=toxicity&toxRun=${RUN_ID}` });
    expect(await screen.findByTestId('toxicity-running')).toBeInTheDocument();
    expect(await screen.findByTestId('toxicity-results', {}, { timeout: 2500 })).toBeInTheDocument();
    expect(mocked.fetchToxicityReview).toHaveBeenCalledTimes(2);
  });

  it('ignores a detail resolution and rejection after cleanup', async () => {
    let resolveDetail!: (value: ToxicityRunDetail) => void;
    mocked.fetchToxicityReview.mockImplementationOnce(
      () => new Promise((resolve) => (resolveDetail = resolve)),
    );
    const resolved = renderWorkspace({
      entry: `/sites/site-1/backlinks?tab=toxicity&toxRun=${RUN_ID}`,
    });
    await waitFor(() => expect(mocked.fetchToxicityReview).toHaveBeenCalled());
    resolved.unmount();
    resolveDetail(detailFixture());
    await Promise.resolve();

    let rejectDetail!: (reason: Error) => void;
    mocked.fetchToxicityReview.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectDetail = reject)),
    );
    const rejected = renderWorkspace({
      entry: `/sites/site-1/backlinks?tab=toxicity&toxRun=${RUN_ID}`,
    });
    await waitFor(() => expect(mocked.fetchToxicityReview).toHaveBeenCalledTimes(2));
    rejected.unmount();
    rejectDetail(new Error('late failure'));
    await Promise.resolve();
  });

  it('ignores an aborted run-list failure after cleanup', async () => {
    let rejectRuns!: (reason: Error) => void;
    mocked.fetchToxicityRuns.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectRuns = reject)),
    );
    const rendered = renderWorkspace();
    await waitFor(() => expect(mocked.fetchToxicityRuns).toHaveBeenCalled());
    rendered.unmount();
    rejectRuns(new Error('late list failure'));
    await Promise.resolve();
  });
});

describe('scored rows and disavow builder', () => {
  it('renders all bands, signals, cited rationale, and URL-backed band filtering', async () => {
    renderWorkspace({ entry: `/sites/site-1/backlinks?tab=toxicity&toxRun=${RUN_ID}` });
    expect(await screen.findByTestId('toxicity-table')).toHaveTextContent('toxic.example');
    expect(screen.getByTestId('toxicity-table')).toHaveTextContent('watch.example');
    expect(screen.getByTestId('toxicity-table')).toHaveTextContent('clean.example');
    expect(screen.getByTestId('toxicity-table')).toHaveTextContent('Broken');
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Rationale' })[0]!);
    expect(await screen.findByText('Stored score and broken-link observation.')).toBeVisible();

    const filter = screen.getByLabelText('Filter rows by rubric band');
    await userEvent.setup().click(filter);
    await userEvent.setup().click(await screen.findByRole('option', { name: 'Watch' }));
    await waitFor(() =>
      expect(screen.getByTestId('toxicity-table')).not.toHaveTextContent('toxic.example'),
    );
    expect(screen.getByTestId('toxicity-table')).toHaveTextContent('watch.example');
    await userEvent.setup().click(filter);
    await userEvent.setup().click(await screen.findByRole('option', { name: 'All bands' }));
    await waitFor(() => expect(screen.getByTestId('toxicity-table')).toHaveTextContent('toxic.example'));
  });

  it('seeds toxic rows only and forwards the live selection to report export under the review banner', async () => {
    renderWorkspace({ entry: `/sites/site-1/backlinks?tab=toxicity&toxRun=${RUN_ID}` });
    const preview = await screen.findByTestId('disavow-preview');
    expect(preview).toHaveTextContent('domain:toxic.example');
    expect(preview).not.toHaveTextContent('domain:watch.example');

    await userEvent
      .setup()
      .click(screen.getByRole('checkbox', { name: 'Include watch.example in the file' }));
    expect(preview).toHaveTextContent('domain:watch.example');
    const banner = screen.getByTestId('disavow-review-banner');
    const exportControl = within(banner).getByTestId('report-export-control');
    expect(exportControl).toHaveAttribute('data-kind', 'backlinks.disavow');
    expect(exportControl).toHaveAttribute('data-scope', 'site_resource');
    expect(exportControl.getAttribute('data-selection')).toContain(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(exportControl.getAttribute('data-selection')).toContain(
      '22222222-2222-4222-8222-222222222222',
    );
  });

  it('renders hostile domain and URL fixtures as inert text and excludes them from preview grammar', async () => {
    mocked.fetchToxicityReview.mockResolvedValueOnce(
      detailFixture({
        rows: [
          rowFixture('11111111-1111-4111-8111-111111111111', 'toxic', {
            domain: 'evil.example"><img src=x onerror=alert(1)>',
            url: 'javascript:alert(1)',
          }),
        ],
        retainedCount: 1,
      }),
    );
    const { container } = renderWorkspace({
      entry: `/sites/site-1/backlinks?tab=toxicity&toxRun=${RUN_ID}`,
    });
    expect(await screen.findAllByText('evil.example"><img src=x onerror=alert(1)>')).toHaveLength(
      2,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('disavow-preview').textContent).not.toContain('evil.example');
  });

  it('reopens stored runs free and persists the status filter in request state', async () => {
    mocked.fetchToxicityRuns.mockResolvedValue(runsFixture());
    renderWorkspace();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    await waitFor(() => expect(mocked.fetchToxicityReview).toHaveBeenCalled());
    expect(mocked.previewToxicityReview).not.toHaveBeenCalled();
    expect(mocked.startToxicityReview).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('Filter reviews by status'));
    await user.click(await screen.findByRole('option', { name: 'Failed' }));
    await waitFor(() =>
      expect(mocked.fetchToxicityRuns).toHaveBeenCalledWith(
        'site-1',
        'failed',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it('renders partial observations, abstention, missing and invalid dates, then closes the run', async () => {
    mocked.fetchToxicityReview.mockResolvedValueOnce(
      detailFixture({
        providerStatus: 'partial_failed',
        rows: [
          rowFixture('22222222-2222-4222-8222-222222222222', 'watch', {
            firstSeen: null,
            lastSeen: 'date-unavailable',
          }),
        ],
        retainedCount: 1,
      }),
    );
    renderWorkspace({ entry: `/sites/site-1/backlinks?tab=toxicity&toxRun=${RUN_ID}` });
    expect(await screen.findByText('Partial provider observations')).toBeInTheDocument();
    expect(screen.getByTestId('toxicity-table')).toHaveTextContent('—');
    expect(screen.getByTestId('toxicity-table')).toHaveTextContent('date-unavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Rationale' }));
    expect(
      await screen.findByText('The AI abstained; the deterministic band is unchanged.'),
    ).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back to new review' }));
    expect(await screen.findByTestId('toxicity-start')).toBeInTheDocument();
  });

  it('shows a consumed failed run and an active detail-load failure', async () => {
    mocked.fetchToxicityReview.mockResolvedValueOnce(
      detailFixture({
        status: 'failed',
        refunded: false,
        providerStatus: 'failed',
        failureKind: 'ceiling_halted',
        rows: [],
      }),
    );
    const consumed = renderWorkspace({
      entry: `/sites/site-1/backlinks?tab=toxicity&toxRun=${RUN_ID}`,
    });
    expect(await screen.findByTestId('toxicity-failed')).toHaveTextContent(
      'reserved unit was consumed',
    );
    consumed.unmount();

    mocked.fetchToxicityReview.mockRejectedValueOnce(new Error('detail failed'));
    renderWorkspace({ entry: `/sites/site-1/backlinks?tab=toxicity&toxRun=${RUN_ID}` });
    expect(await screen.findByTestId('toxicity-detail-error')).toBeInTheDocument();
  });

  it('switches a selected row to URL scope and forwards that scope to report export', async () => {
    renderWorkspace({ entry: `/sites/site-1/backlinks?tab=toxicity&toxRun=${RUN_ID}` });
    await screen.findByTestId('disavow-builder');
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Scope for toxic.example'));
    await user.click(await screen.findByRole('option', { name: 'Exact URL' }));
    expect(screen.getByTestId('disavow-preview')).toHaveTextContent(
      'https://toxic.example/path',
    );
    const exportControl = screen
      .getAllByTestId('report-export-control')
      .find((control) => control.getAttribute('data-kind') === 'backlinks.disavow');
    expect(exportControl).toHaveAttribute(
      'data-selection',
      JSON.stringify({
        entries: [{ rowId: '11111111-1111-4111-8111-111111111111', kind: 'url' }],
      }),
    );
  });
});

describe('toxicity locale and encoding contracts', () => {
  it('uses RTL direction and keeps keyboard focus on every primary action in Arabic', async () => {
    await changeLanguage('ar');
    renderWorkspace();
    const workspace = screen.getByTestId('toxicity-workspace');
    expect(workspace).toHaveAttribute('dir', 'rtl');
    const previewButton = screen.getByRole('button', { name: 'معاينة تكلفة المراجعة' });
    await userEvent.setup().tab();
    expect(previewButton).toHaveFocus();
    expect(previewButton.className).toContain('focus-visible:');
  });

  it('neutralizes unknown rows, formula prefixes, control lines, and unsafe URLs in previews', () => {
    const safe = rowFixture('11111111-1111-4111-8111-111111111111', 'toxic');
    const hostile = rowFixture('22222222-2222-4222-8222-222222222222', 'toxic', {
      domain: '=evil.example',
      url: 'https://evil.example/\n# injected',
    });
    const output = serializeDisavowPreview(
      [safe, hostile],
      [
        { rowId: safe.id, kind: 'domain' },
        { rowId: hostile.id, kind: 'domain' },
        { rowId: hostile.id, kind: 'url' },
        { rowId: 'unknown', kind: 'domain' },
      ],
      'toxicity-rubric-v1',
      new Date('2026-08-01T00:00:00.000Z'),
    );
    expect(output).toContain('domain:toxic.example');
    expect(output).not.toContain('evil.example');
    expect(output).not.toContain('injected');
    expect(
      output
        .split('\n')
        .filter(Boolean)
        .every((line) => /^(#|domain:|https?:\/\/)/u.test(line)),
    ).toBe(true);
  });

  it.each(['evil.example\u007f', 'evil.example\u202e', 'evil.example\u2066']) (
    'rejects every control and bidi domain range in preview text: %j',
    (domain) => {
      const row = rowFixture('11111111-1111-4111-8111-111111111111', 'toxic', { domain });
      expect(
        serializeDisavowPreview(
          [row],
          [{ rowId: row.id, kind: 'domain' }],
          'toxicity-rubric-v1',
          new Date('2026-08-01T00:00:00.000Z'),
        ),
      ).not.toContain('evil.example');
    },
  );

  it('canonicalizes safe previews, dedupes selections, orders domains before URLs, and rejects every URL boundary', () => {
    const domain = rowFixture('11111111-1111-4111-8111-111111111111', 'toxic', {
      domain: 'B.Example.',
    });
    const url = rowFixture('22222222-2222-4222-8222-222222222222', 'watch', {
      url: 'https://a.example/path#fragment',
    });
    const invalidRows = [
      rowFixture('33333333-3333-4333-8333-333333333333', 'toxic', {
        url: ' https://trim.example/',
      }),
      rowFixture('44444444-4444-4444-8444-444444444444', 'toxic', {
        url: `https://large.example/${'a'.repeat(2048)}`,
      }),
      rowFixture('55555555-5555-4555-8555-555555555555', 'toxic', {
        url: 'ftp://protocol.example/file',
      }),
      rowFixture('66666666-6666-4666-8666-666666666666', 'toxic', {
        url: 'https://user:pass@userinfo.example/',
      }),
      rowFixture('77777777-7777-4777-8777-777777777777', 'toxic', {
        url: 'not a URL',
      }),
      rowFixture('88888888-8888-4888-8888-888888888888', 'toxic', {
        url: `https://unicode.example/${'é'.repeat(1000)}`,
      }),
    ];
    const output = serializeDisavowPreview(
      [domain, url, ...invalidRows],
      [
        { rowId: url.id, kind: 'url' },
        { rowId: domain.id, kind: 'domain' },
        { rowId: domain.id, kind: 'domain' },
        ...invalidRows.map((row) => ({ rowId: row.id, kind: 'url' as const })),
      ],
      'toxicity-rubric-v1',
      new Date('2026-08-01T00:00:00.000Z'),
    );
    expect(output).toBe(
      '# RankMeFast link review export\n' +
        '# rubric: toxicity-rubric-v1\n' +
        '# generated: 2026-08-01\n' +
        'domain:b.example\n' +
        'https://a.example/path\n',
    );
  });
});

describe('toxicity API transport', () => {
  const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('posts preview/start/download and builds encoded list/detail reads with optional filters and signals', async () => {
    const realApi = await vi.importActual<typeof import('./api')>('./api');

    globalFetchSpy
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-preview' }))
      .mockResolvedValueOnce(jsonResponse(previewFixture()));
    await realApi.previewToxicityReview('site-1');
    expect(globalFetchSpy.mock.calls[1]?.[0]).toContain('/backlinks/toxicity/preview');

    __resetCsrfTokenCacheForTests();
    globalFetchSpy
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-start' }))
      .mockResolvedValueOnce(jsonResponse({ runId: RUN_ID }));
    await realApi.startToxicityReview('site-1', 'ar');
    expect(globalFetchSpy.mock.calls[1]?.[0]).toContain('/backlinks/toxicity');

    globalFetchSpy.mockReset().mockResolvedValueOnce(jsonResponse(runsFixture()));
    await realApi.fetchToxicityRuns('site/id');
    expect(globalFetchSpy.mock.calls[0]?.[0]).toContain('siteId=site%2Fid&limit=20');

    const controller = new AbortController();
    globalFetchSpy.mockReset().mockResolvedValueOnce(jsonResponse(runsFixture()));
    await realApi.fetchToxicityRuns('site-1', 'failed', { signal: controller.signal });
    expect(globalFetchSpy.mock.calls[0]?.[0]).toContain('status=failed');

    globalFetchSpy.mockReset().mockResolvedValueOnce(jsonResponse(detailFixture()));
    await realApi.fetchToxicityReview('run/id');
    expect(globalFetchSpy.mock.calls[0]?.[0]).toContain('run%2Fid');

    globalFetchSpy.mockReset().mockResolvedValueOnce(jsonResponse(detailFixture()));
    await realApi.fetchToxicityReview(RUN_ID, 'toxic', { signal: controller.signal });
    expect(globalFetchSpy.mock.calls[0]?.[0]).toContain('?band=toxic');

    __resetCsrfTokenCacheForTests();
    globalFetchSpy
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-download' }))
      .mockResolvedValueOnce(
        new Response('domain:toxic.example\n', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );
    expect(
      await realApi.downloadToxicityDisavow(RUN_ID, [
        { rowId: '11111111-1111-4111-8111-111111111111', kind: 'domain' },
      ]),
    ).toBe('domain:toxic.example\n');
    expect(globalFetchSpy.mock.calls[1]?.[0]).toContain(`/backlinks/toxicity/${RUN_ID}/disavow`);
  });
});
