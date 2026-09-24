import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, __resetCsrfTokenCacheForTests } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from './api';
import {
  GapCompetitorCard,
  GapOverlapStats,
  GapWorkspace,
  compareGapRows,
  formatGapFirstSeen,
  orderGapRows,
  resolveGapLegStatus,
} from './components/GapWorkspace';
import { initialState, backlinksReducer, cancelGapPreview } from './store/slice';
import { selectGapPreview } from './store/selectors';
import { loadGapRun, previewGap, submitGap } from './store/thunks';
import type {
  LinkGapLeg,
  LinkGapRun,
  LinkGapState,
  LinkGapWireLegStatus,
  SpendPreview,
} from './types';
import { linkGapFormSchema, splitGapCompetitors } from './validation';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  previewLinkGap: vi.fn(),
  startLinkGap: vi.fn(),
  fetchLinkGapRun: vi.fn(),
}));

const mocked = vi.mocked(api);
const globalFetchSpy = vi.spyOn(globalThis, 'fetch');

const previewFixture = (overrides: Partial<SpendPreview> = {}): SpendPreview => ({
  feature: 'link_intelligence',
  operation: 'link-gap',
  cachedStatus: 'fresh_required',
  breakdown: [
    {
      operationKey: 'gap:rival.example',
      metric: 'link_intel_checks',
      productUnits: 1,
      cachedStatus: 'fresh_required',
    },
  ],
  estimatedAt: '2026-07-22T12:00:00.000Z',
  ...overrides,
});

const legFixture = (
  status: LinkGapWireLegStatus = 'ok',
  refunded = false,
  overrides: Partial<LinkGapLeg> = {},
): LinkGapLeg => ({
  competitor: 'rival.example',
  status,
  refunded,
  retainedCount: 2,
  result: {
    rows: [
      { domain: 'z-link.example', rank: 20, firstSeen: '2026-06-01T00:00:00.000Z' },
      { domain: 'a-link.example', rank: 90, firstSeen: null },
    ],
    overlap: { totalUnique: 10, exclusiveToCompetitor: 4, exclusivePct: 40 },
    observation: {
      capturedAt: '2026-07-22T12:01:00.000Z',
      source: 'provider_observation',
    },
  },
  ...overrides,
});

const runFixture = (
  legs: LinkGapLeg[] = [legFixture()],
  status: LinkGapRun['status'] = 'succeeded',
): LinkGapRun => ({
  runId: '507f1f77bcf86cd799439011',
  siteId: 'site-1',
  ownDomain: 'example.com',
  competitors: legs.map((leg) => leg.competitor),
  status,
  perLegOutcomes: legs.map(({ competitor, status: legStatus, refunded, retainedCount }) => ({
    competitor,
    status: legStatus,
    refunded,
    retainedCount,
  })),
  totalRefunded: legs.filter((leg) => leg.refunded).length,
  createdAt: '2026-07-22T12:00:00.000Z',
  completedAt: '2026-07-22T12:01:00.000Z',
  legs,
});

const cleanGap = (overrides: Partial<LinkGapState> = {}): LinkGapState => ({
  ...initialState.gap,
  ...overrides,
});

function makeStore(gap: Partial<LinkGapState> = {}) {
  return configureStore({
    reducer: { backlinks: backlinksReducer },
    preloadedState: {
      backlinks: {
        ...initialState,
        siteId: 'site-1',
        gap: cleanGap(gap),
      },
    },
  });
}

function renderWorkspace({
  gap,
  entry = '/sites/site-1/backlinks?tab=gap',
  ownDomain = 'example.com',
}: {
  gap?: Partial<LinkGapState>;
  entry?: string;
  ownDomain?: string;
} = {}) {
  const store = makeStore(gap);
  const view = render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[entry]}>
          <GapWorkspace siteId="site-1" ownDomain={ownDomain} />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return { ...view, store };
}

function renderLeg(leg: LinkGapLeg) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <GapCompetitorCard leg={leg} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  mocked.previewLinkGap.mockReset();
  mocked.startLinkGap.mockReset();
  mocked.fetchLinkGapRun.mockReset();
  mocked.fetchLinkGapRun.mockImplementation(() => new Promise(() => undefined));
  __resetCsrfTokenCacheForTests();
});

describe('gap zod mirror', () => {
  it('normalizes and dedupes domains, drops blanks, and splits comma/newline input', () => {
    expect(splitGapCompetitors(' rival.example,\n\nWWW.RIVAL.example ')).toEqual([
      'rival.example',
      'WWW.RIVAL.example',
    ]);
    expect(
      linkGapFormSchema.parse({
        ownDomain: 'WWW.Example.com',
        competitors: ['rival.example', 'WWW.RIVAL.example', ''],
      }),
    ).toEqual({ ownDomain: 'example.com', competitors: ['rival.example'] });
  });

  it('rejects own-domain competitors, empty lists, over-limit lists, and invalid domains', () => {
    const cases = [
      { ownDomain: 'example.com', competitors: ['www.example.com'] },
      { ownDomain: 'example.com', competitors: [''] },
      {
        ownDomain: 'example.com',
        competitors: ['a.example', 'b.example', 'c.example', 'd.example'],
      },
      { ownDomain: 'example.com', competitors: ['javascript:alert(1)'] },
    ];
    for (const value of cases) expect(linkGapFormSchema.safeParse(value).success).toBe(false);
  });
});

describe('gap form preview and confirm', () => {
  it('dedupes before preview and cancel never starts a paid run', async () => {
    mocked.previewLinkGap.mockResolvedValue(previewFixture());
    renderWorkspace();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText('Competitor domains'),
      'Rival.example\nwww.rival.example',
    );
    await user.click(screen.getByRole('button', { name: 'Preview gap spend' }));
    await waitFor(() =>
      expect(mocked.previewLinkGap).toHaveBeenCalledWith({
        ownDomain: 'example.com',
        competitors: ['rival.example'],
      }),
    );
    expect(screen.getByTestId('link-intel-preview')).toHaveTextContent('self-hosted');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocked.startLinkGap).not.toHaveBeenCalled();
  });

  it('confirms once with normalized competitors and opens the stored run URL', async () => {
    const run = runFixture([], 'queued');
    mocked.previewLinkGap.mockResolvedValue(previewFixture());
    mocked.startLinkGap.mockResolvedValue({
      runId: run.runId,
      siteId: 'site-1',
      ownDomain: 'example.com',
      competitors: ['rival.example'],
      status: 'queued',
      reservedUnits: 1,
    });
    mocked.fetchLinkGapRun.mockResolvedValue(run);
    renderWorkspace();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Competitor domains'), 'Rival.example');
    await user.click(screen.getByRole('button', { name: 'Preview gap spend' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm and spend 1 units' }));
    await waitFor(() => expect(mocked.startLinkGap).toHaveBeenCalledTimes(1));
    expect(mocked.startLinkGap).toHaveBeenCalledWith({
      siteId: 'site-1',
      competitors: ['rival.example'],
    });
    expect(mocked.fetchLinkGapRun).toHaveBeenCalledWith(
      run.runId,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    ['', 'Enter at least one competitor domain.'],
    ['example.com', 'Your own domain cannot be a competitor.'],
    ['a.example,b.example,c.example,d.example', 'Enter no more than three competitor domains.'],
    ['javascript:alert(1)', 'Enter valid domain names.'],
  ])('shows inline validation for %j', async (competitors, message) => {
    renderWorkspace();
    if (competitors) await userEvent.type(screen.getByLabelText('Competitor domains'), competitors);
    await userEvent.click(screen.getByRole('button', { name: 'Preview gap spend' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(mocked.previewLinkGap).not.toHaveBeenCalled();
  });

  it('invalidates a stale preview when either editable input changes', async () => {
    mocked.previewLinkGap.mockResolvedValue(previewFixture());
    const rendered = renderWorkspace();
    await userEvent.type(screen.getByLabelText('Competitor domains'), 'rival.example');
    await userEvent.click(screen.getByRole('button', { name: 'Preview gap spend' }));
    await screen.findByTestId('link-intel-preview');
    await userEvent.type(screen.getByLabelText('Competitor domains'), 'x');
    expect(screen.queryByTestId('link-intel-preview')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Your domain'), 'x');
    rendered.rerender(
      <Provider store={rendered.store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <GapWorkspace siteId="site-1" ownDomain="new.example" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getByLabelText('Your domain')).toHaveValue('example.comx');
  });

  it('does not submit when a preloaded preview has no confirmed form input', async () => {
    renderWorkspace({ gap: { preview: previewFixture() } });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and spend 1 units' }));
    expect(mocked.startLinkGap).not.toHaveBeenCalled();
  });

  it('uses one unit in the confirmation label without finite quota claims', () => {
    renderWorkspace({ gap: { preview: previewFixture() } });
    expect(screen.getByTestId('link-gap-confirm')).toHaveTextContent(
      'Confirm and spend 1 units',
    );
  });

  it('keeps the preview visible and does not navigate when paid submit fails', async () => {
    mocked.previewLinkGap.mockResolvedValue(previewFixture());
    mocked.startLinkGap.mockRejectedValue(new Error('network'));
    renderWorkspace();
    await userEvent.type(screen.getByLabelText('Competitor domains'), 'rival.example');
    await userEvent.click(screen.getByRole('button', { name: 'Preview gap spend' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm and spend 1 units' }));
    expect(await screen.findByTestId('link-gap-error')).toBeInTheDocument();
    expect(screen.getByTestId('link-intel-preview')).toBeInTheDocument();
  });
});

describe('Link-gap accessibility and RTL', () => {
  it('supports keyboard-only traversal with visible focus on every form control', async () => {
    renderWorkspace();
    const user = userEvent.setup();
    for (const testId of ['link-gap-own-domain', 'link-gap-competitors', 'link-gap-preview']) {
      await user.tab();
      const control = screen.getByTestId(testId);
      expect(control).toHaveFocus();
      expect(control.className).toContain('focus-visible:');
    }
  });

  it('sets dir=rtl on the form, stored results, and every gap state', async () => {
    await changeLanguage('ar');
    const form = renderWorkspace();
    expect(screen.getByTestId('link-gap-workspace')).toHaveAttribute('dir', 'rtl');
    form.unmount();

    const stored = renderWorkspace({
      gap: { run: runFixture() },
      entry: '/sites/site-1/backlinks?tab=gap&runId=507f1f77bcf86cd799439011',
    });
    expect(screen.getByTestId('link-gap-results')).toHaveAttribute('dir', 'rtl');
    stored.unmount();

    renderWorkspace({ gap: { errorKind: 'disabled' } });
    expect(screen.getByTestId('link-gap-disabled')).toHaveAttribute('dir', 'rtl');
  });

  it('gives outbound result links a visible keyboard focus ring', () => {
    renderLeg(
      legFixture('ok', false, {
        result: {
          ...legFixture().result!,
          rows: [{ domain: 'safe.example', rank: 42, url: 'https://safe.example' }],
        },
      }),
    );
    const link = screen.getByRole('link', { name: 'safe.example' });
    expect(link.className).toContain('focus-visible:ring-[3px]');
  });
});

describe('kill-switch and error states', () => {
  it('classifies a disabled preview as localized product-unavailable', async () => {
    mocked.previewLinkGap.mockRejectedValue(
      new ApiError('disabled', 503, { error: { message: 'paused' } }),
    );
    renderWorkspace();
    await userEvent.type(screen.getByLabelText('Competitor domains'), 'rival.example');
    await userEvent.click(screen.getByRole('button', { name: 'Preview gap spend' }));
    expect(await screen.findByTestId('link-gap-disabled')).toHaveTextContent('New runs are paused');
  });

  it('renders the reducer-provided generic error state', () => {
    renderWorkspace({ gap: { error: 'wire broke', errorKind: 'unknown' } });
    expect(screen.getByTestId('link-gap-error')).toHaveTextContent('wire broke');
  });
});

describe('stored results and hostile content', () => {
  it('loads a runId directly without firing a preview and renders server overlap math', async () => {
    const run = runFixture();
    mocked.fetchLinkGapRun.mockResolvedValue(run);
    renderWorkspace({ entry: `/sites/site-1/backlinks?tab=gap&runId=${run.runId}` });
    expect(await screen.findByTestId('link-gap-results')).toHaveTextContent('Complete');
    expect(screen.getByTestId('gap-overlap-stats')).toHaveTextContent('10');
    expect(screen.getByTestId('gap-overlap-stats')).toHaveTextContent('40.0%');
    expect(mocked.previewLinkGap).not.toHaveBeenCalled();
  });

  it('renders partial and loading/error/missing stored-run states', () => {
    const run = runFixture([legFixture('failed', true, { result: null })], 'failed');
    const partial = renderWorkspace({
      entry: `/sites/site-1/backlinks?tab=gap&runId=${run.runId}`,
      gap: { run },
    });
    expect(screen.getByTestId('link-gap-results')).toHaveTextContent('Partial');
    partial.unmount();

    const loading = renderWorkspace({
      entry: '/sites/site-1/backlinks?tab=gap&runId=queued',
      gap: { run: runFixture([], 'running') },
    });
    expect(screen.getByTestId('link-gap-run-loading')).toBeInTheDocument();
    loading.unmount();

    const failedRun = { ...runFixture(), runId: 'bad' };
    const failed = renderWorkspace({
      entry: '/sites/site-1/backlinks?tab=gap&runId=bad',
      gap: { run: failedRun, error: 'not found', errorKind: 'unknown' },
    });
    expect(screen.getByTestId('link-gap-run-error')).toHaveTextContent('not found');
    failed.unmount();

    renderWorkspace({ entry: '/sites/site-1/backlinks?tab=gap&runId=missing' });
    expect(screen.getByTestId('link-gap-run-loading')).toBeInTheDocument();
  });

  it('renders all four refund truth-table pills with semantic tones', () => {
    const legs = [
      legFixture('ok'),
      legFixture('failed', true, { competitor: 'failed.example', result: null }),
      legFixture('zeroRetained', false, { competitor: 'empty-consumed.example', result: null }),
      legFixture('zeroRetained', true, { competitor: 'empty-refunded.example', result: null }),
    ];
    for (const leg of legs) {
      const rendered = renderLeg(leg);
      const status = resolveGapLegStatus(leg.status, leg.refunded);
      expect(screen.getByTestId(`gap-leg-status-${status}`)).toHaveAttribute(
        'data-tone',
        status === 'ok'
          ? 'success'
          : status === 'provider_failed_refunded'
            ? 'warning'
            : status === 'zero_retained_refunded'
              ? 'info'
              : 'muted',
      );
      rendered.unmount();
    }
  });

  it('renders malicious competitor/row content inert and guards an unsafe outbound URL', () => {
    const hostile = legFixture('ok', false, {
      competitor: '</script><script>alert(1)</script>',
      result: {
        rows: [
          {
            domain: '<script>alert(2)</script>',
            rank: null,
            firstSeen: '<a href=javascript:1>first</a>',
            url: 'javascript:alert(3)',
          },
        ],
        overlap: null,
        observation: {
          capturedAt: '2026-07-22T12:01:00.000Z',
          source: 'provider_observation',
        },
      },
    });
    const rendered = renderLeg(hostile);
    expect(rendered.container).toHaveTextContent('</script><script>alert(1)</script>');
    expect(rendered.container).toHaveTextContent('<a href=javascript:1>first</a>');
    expect(rendered.container.querySelector('script')).toBeNull();
    expect(rendered.container.querySelectorAll('a')).toHaveLength(1);
    expect(rendered.container.querySelector('a')).toHaveAttribute('href', '#');
    expect(rendered.container.querySelector('a')).toHaveAttribute(
      'rel',
      'nofollow ugc noopener noreferrer',
    );
  });

  it('sorts rank descending with nulls last and formats valid, invalid, and empty dates', () => {
    expect(
      orderGapRows([
        { domain: 'z.example', rank: null },
        { domain: 'b.example', rank: 50 },
        { domain: 'a.example', rank: 50 },
      ]).map((row) => row.domain),
    ).toEqual(['a.example', 'b.example', 'z.example']);
    expect(
      compareGapRows({ domain: 'null.example', rank: null }, { domain: 'ranked.example', rank: 1 }),
    ).toBeGreaterThan(0);
    expect(
      compareGapRows({ domain: 'ranked.example', rank: 1 }, { domain: 'null.example', rank: null }),
    ).toBeLessThan(0);
    expect(
      compareGapRows({ domain: 'a.example', rank: null }, { domain: 'b.example', rank: null }),
    ).toBeLessThan(0);
    expect(formatGapFirstSeen(null, 'en')).toBe('—');
    expect(formatGapFirstSeen('<b>bad</b>', 'en')).toBe('<b>bad</b>');
    expect(formatGapFirstSeen('2026-01-02T00:00:00.000Z', 'en')).toContain('2026');
  });

  it('renders unavailable overlap and an empty result using no client-side math', () => {
    const rendered = renderLeg(legFixture('zeroRetained', false, { result: null }));
    expect(screen.getByTestId('gap-overlap-stats')).toHaveTextContent('—');
    expect(screen.getByText('No exclusive domains')).toBeInTheDocument();
    rendered.unmount();
    render(
      <I18nextProvider i18n={i18n}>
        <GapOverlapStats
          overlap={{ totalUnique: 1000, exclusiveToCompetitor: 250, exclusivePct: 25.25 }}
          locale="en"
        />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('gap-overlap-stats')).toHaveTextContent('1,000');
    expect(screen.getByTestId('gap-overlap-stats')).toHaveTextContent('25.3%');
  });
});

describe('gap thunks, reducer, selectors, and API wire helpers', () => {
  it.each([
    [503, 'disabled'],
    [500, 'unknown'],
  ] as const)('classifies preview HTTP %s as %s', async (status, kind) => {
    mocked.previewLinkGap.mockRejectedValue(
      new ApiError('failed', status, { error: { message: 'failed' } }),
    );
    const store = makeStore();
    await store.dispatch(previewGap({ ownDomain: 'example.com', competitors: ['rival.example'] }));
    expect(store.getState().backlinks.gap.errorKind).toBe(kind);
  });

  it('covers preview, cancellation, submit failures, read failures, and aborted reads', async () => {
    const store = makeStore();
    mocked.previewLinkGap.mockResolvedValue(previewFixture());
    await store.dispatch(previewGap({ ownDomain: 'example.com', competitors: ['rival.example'] }));
    expect(store.getState().backlinks.gap.preview).not.toBeNull();
    store.dispatch(cancelGapPreview());
    expect(store.getState().backlinks.gap.preview).toBeNull();

    mocked.startLinkGap.mockRejectedValue(
      new ApiError('disabled', 503, { error: { message: 'disabled' } }),
    );
    await store.dispatch(
      submitGap({
        siteId: 'site-1',
        ownDomain: 'example.com',
        competitors: ['rival.example'],
      }),
    );
    expect(store.getState().backlinks.gap.errorKind).toBe('disabled');

    mocked.fetchLinkGapRun.mockRejectedValueOnce(new Error('network'));
    await store.dispatch(loadGapRun({ runId: 'network' }));
    expect(store.getState().backlinks.gap.errorKind).toBe('unknown');
    const errorBeforeAbort = store.getState().backlinks.gap.error;
    store.dispatch({
      type: loadGapRun.rejected.type,
      payload: { error: 'aborted', kind: 'unknown' },
      meta: { arg: { runId: 'r' }, requestId: 'r', requestStatus: 'rejected', aborted: true },
    });
    expect(store.getState().backlinks.gap.error).toBe(errorBeforeAbort);
  });

  it('uses reducer fallbacks and reads the gap preview selector', () => {
    const store = makeStore();
    for (const thunk of [previewGap, submitGap, loadGapRun]) {
      store.dispatch({
        type: thunk.rejected.type,
        payload: undefined,
        meta: { arg: {}, requestId: 'r', requestStatus: 'rejected', aborted: false },
      });
    }
    expect(store.getState().backlinks.gap.errorKind).toBe('unknown');
    expect(selectGapPreview(store.getState() as never)).toBeNull();
    const withPreview = makeStore({ preview: previewFixture() });
    expect(selectGapPreview(withPreview.getState() as never)).not.toBeNull();
  });

  it('posts preview/start and reads encoded run IDs with and without init', async () => {
    const realApi = await vi.importActual<typeof import('./api')>('./api');
    const jsonResponse = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    let spy = globalFetchSpy
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(jsonResponse(previewFixture()));
    await realApi.previewLinkGap({ ownDomain: 'example.com', competitors: ['rival.example'] });
    expect(spy.mock.calls[1]?.[0]).toContain('/backlinks/gap/preview');

    __resetCsrfTokenCacheForTests();
    spy = globalFetchSpy
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(jsonResponse({ runId: 'r' }));
    await realApi.startLinkGap({ siteId: 'site-1', competitors: ['rival.example'] });
    expect(spy.mock.calls[1]?.[0]).toContain('/backlinks/gap');

    globalFetchSpy.mockReset().mockResolvedValueOnce(jsonResponse(runFixture()));
    await realApi.fetchLinkGapRun('run/id');
    expect(globalFetchSpy.mock.calls[0]?.[0]).toContain('run%2Fid');
    const controller = new AbortController();
    globalFetchSpy.mockReset().mockResolvedValueOnce(jsonResponse(runFixture()));
    await realApi.fetchLinkGapRun('run', { signal: controller.signal });
  });
});
