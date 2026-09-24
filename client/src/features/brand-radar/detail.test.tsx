import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import {
  mentionFixture,
  scanDetailFixture,
  scanFixture,
} from './__fixtures__/scans';
import { BrandRadarPage } from './components/BrandRadarPage';
import { brandRadarReducer } from './store/slice';
import type {
  BrandRadarDigestState,
  BrandRadarHalt,
  BrandRadarMentionRow,
  BrandRadarScanDetail,
  BrandRadarScanSummary,
  BrandRadarStatus,
} from './types';

const PANEL_SITE = '65f000000000000000000abc';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

const SCAN_ID = '65f000000000000000000001';
const PRIOR_SCAN_ID = '65f000000000000000000002';

let search = '';
const LocationProbe = () => {
  search = useLocation().search;
  return null;
};

const renderDetail = (entry = `/brand-radar?scan=${SCAN_ID}`) => {
  search = '';
  const store = configureStore({
    reducer: { brandRadar: brandRadarReducer },
  });
  return {
    store,
    ...render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[entry]}>
            <BrandRadarPage siteId={PANEL_SITE} />
            <LocationProbe />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    ),
  };
};

interface Wiring {
  list?: () => unknown;
  detail?: () => unknown;
  mentions?: (cursor: string | null) => unknown;
}

const routeApi = (wiring: Wiring = {}) => {
  mockedApiClient.mockImplementation((path: string) => {
    if (path.includes('/mentions')) {
      const cursor = new URLSearchParams(path.split('?')[1] ?? '').get('cursor');
      return Promise.resolve(
        wiring.mentions?.(cursor) ?? { items: [mentionFixture()], nextCursor: null },
      ) as never;
    }
    if (/\/brand-radar\/scans\/[^/?]+$/.test(path)) {
      return Promise.resolve(wiring.detail?.() ?? scanDetailFixture()) as never;
    }
    if (path.startsWith(`/sites/${PANEL_SITE}/brand-radar/scans`)) {
      return Promise.resolve(
        wiring.list?.() ?? { items: [scanFixture()], nextCursor: null },
      ) as never;
    }
    return Promise.resolve({}) as never;
  });
};

const detailFor = (
  status: BrandRadarStatus,
  digestState: BrandRadarDigestState,
  overrides: Partial<BrandRadarScanDetail> = {},
): BrandRadarScanDetail =>
  scanDetailFixture({ id: SCAN_ID, status, digestState, ...overrides });

/** Two settled scans on the same query — the minimum a trend chart needs. */
const trendList = (): BrandRadarScanSummary[] => [
  scanFixture({
    id: SCAN_ID,
    retainedRowCount: 42,
    createdAt: '2026-07-20T10:00:00.000Z',
    terminalAt: '2026-07-20T10:05:00.000Z',
  }),
  scanFixture({
    id: PRIOR_SCAN_ID,
    retainedRowCount: 36,
    createdAt: '2026-07-13T10:00:00.000Z',
    terminalAt: '2026-07-13T10:05:00.000Z',
  }),
];

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mockedApiClient.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('brand-radar scan detail — state map', () => {
  it('labels the frozen digest locale separately from the market language', async () => {
    routeApi({
      detail: () => detailFor('completed', 'digest_present', {
        language: 'fr',
        outputLocale: 'de',
      }),
    });
    renderDetail();
    expect(await screen.findByTestId('brand-radar-detail-output-locale')).toHaveTextContent(
      'Output languageDeutsch',
    );
    expect(screen.getByText('All countries · French')).toBeInTheDocument();
  });

  it('omits the output-locale field for legacy scan details without one', async () => {
    routeApi({
      detail: () => detailFor('completed', 'digest_present', { outputLocale: null }),
    });
    renderDetail();

    await screen.findByTestId('brand-radar-detail');
    expect(screen.queryByTestId('brand-radar-detail-output-locale')).toBeNull();
  });

  it('labels all-market and malformed provider market codes safely', async () => {
    routeApi({
      detail: () => detailFor('completed', 'digest_present', {
        countryCode: null,
        language: null,
      }),
    });
    const allMarkets = renderDetail();
    expect(await screen.findByText('All countries · All languages')).toBeInTheDocument();
    allMarkets.unmount();

    routeApi({
      detail: () => detailFor('completed', 'digest_present', {
        countryCode: 'invalid_country',
        language: 'invalid_language',
      }),
    });
    renderDetail();
    expect(await screen.findByText('Unknown country · Unknown language')).toBeInTheDocument();
  });

  it.each([
    ['queued', 'pending', 'brand-radar-detail-pending'],
    ['running', 'pending', 'brand-radar-detail-pending'],
    ['completed_empty', 'digest_absent', 'brand-radar-detail-empty'],
    ['completed_partial', 'digest_present', 'brand-radar-detail-partial'],
    ['failed', 'digest_absent', 'brand-radar-detail-failed'],
  ] as Array<[BrandRadarStatus, BrandRadarDigestState, string]>)(
    'renders the mapped banner for %s / %s',
    async (status, digestState, testId) => {
      routeApi({ detail: () => detailFor(status, digestState) });
      renderDetail();
      expect(await screen.findByTestId(testId)).toBeInTheDocument();
    },
  );

  it('renders a queued scan with no ETA, no percentage and no invented finish time', async () => {
    routeApi({ detail: () => detailFor('queued', 'pending', { terminalAt: null }) });
    renderDetail();
    const banner = await screen.findByTestId('brand-radar-detail-pending');
    expect(banner).toHaveTextContent('Waiting to start');
    expect(banner.textContent).not.toMatch(/%|minutes? remaining|ETA/i);
    expect(screen.getByTestId('brand-radar-detail')).toHaveTextContent('Still running');
  });

  it('renders NO chart for completed_empty', async () => {
    routeApi({ detail: () => detailFor('completed_empty', 'digest_absent') });
    renderDetail();
    await screen.findByTestId('brand-radar-detail-empty');
    expect(screen.queryByTestId('brand-radar-sentiment')).toBeNull();
    expect(screen.queryByTestId('brand-radar-trend-chart')).toBeNull();
  });

  it('discloses the returned credit on a refunded failure, and stays silent otherwise', async () => {
    routeApi({
      detail: () =>
        detailFor('failed', 'digest_absent', {
          refund: { state: 'refunded', unit: 1 },
        }),
    });
    const view = renderDetail();
    expect(await screen.findByTestId('brand-radar-detail-refund')).toBeInTheDocument();
    expect(screen.getByTestId('brand-radar-detail-failed')).toHaveTextContent(
      'your scan credit was returned',
    );
    view.unmount();

    routeApi({ detail: () => detailFor('failed', 'digest_absent') });
    renderDetail();
    await screen.findByTestId('brand-radar-detail-failed');
    expect(screen.queryByTestId('brand-radar-detail-refund')).toBeNull();
    expect(screen.getByTestId('brand-radar-detail-failed').textContent).not.toContain(
      'not refunded',
    );
  });

  it.each([
    ['digest_present', 'brand-radar-digest-sentences'],
    ['digest_absent', 'brand-radar-digest-absent'],
    ['no_reliable_digest', 'brand-radar-digest-withheld'],
    ['pending', 'brand-radar-digest-pending'],
  ] as Array<[BrandRadarDigestState, string]>)(
    'renders the %s digest state',
    async (digestState, testId) => {
      routeApi({ detail: () => detailFor('completed', digestState) });
      renderDetail();
      expect(await screen.findByTestId(testId)).toBeInTheDocument();
    },
  );

  // The halt contract: the banner says WHICH stage
  // halted and WHY, in the exact sentence for each shipped combination.
  it.each([
    [
      'completed_partial',
      'brand-radar-detail-partial',
      { stage: 'summary', reason: 'cost_ceiling' },
      'stopped before the mention-summary step',
    ],
    [
      'completed_partial',
      'brand-radar-detail-partial',
      { stage: 'summary', reason: 'provider_error' },
      'failed during the mention-summary step',
    ],
    [
      'completed_partial',
      'brand-radar-detail-partial',
      { stage: 'brand_digest', reason: 'cost_ceiling' },
      'stopped before the AI digest step',
    ],
    [
      'completed_partial',
      'brand-radar-detail-partial',
      { stage: 'brand_digest', reason: 'digest_failed' },
      'AI digest could not be produced reliably',
    ],
    [
      'failed',
      'brand-radar-detail-failed',
      { stage: 'search', reason: 'provider_error' },
      'failed while searching for mentions',
    ],
    [
      'failed',
      'brand-radar-detail-failed',
      { stage: 'scan', reason: 'processing_failure' },
      'stalled during processing',
    ],
  ] as Array<
    [BrandRadarStatus, string, BrandRadarHalt, string]
  >)(
    'names the halted stage on %s (%#)',
    async (status, testId, halt, sentence) => {
      routeApi({
        detail: () => detailFor(status, 'digest_absent', { halt }),
      });
      renderDetail();
      const banner = await screen.findByTestId(testId);
      expect(banner).toHaveTextContent(sentence);
      expect(banner).toHaveAttribute(
        'data-halt',
        `${halt.stage}_${halt.reason}`,
      );
    },
  );

  it('falls back to the generic copy when halt is null or unknown', async () => {
    routeApi({
      detail: () => detailFor('completed_partial', 'digest_absent', { halt: null }),
    });
    const view = renderDetail();
    let banner = await screen.findByTestId('brand-radar-detail-partial');
    expect(banner).toHaveTextContent('Collection stopped before the end');
    expect(banner).not.toHaveAttribute('data-halt');
    view.unmount();

    // A future server combination the client does not know yet must degrade
    // to the generic copy, never render a raw i18n key.
    routeApi({
      detail: () =>
        detailFor('completed_partial', 'digest_absent', {
          halt: { stage: 'summary', reason: 'processing_failure' },
        }),
    });
    renderDetail();
    banner = await screen.findByTestId('brand-radar-detail-partial');
    expect(banner).toHaveTextContent('Collection stopped before the end');
    expect(banner).not.toHaveAttribute('data-halt');
    expect(banner.textContent).not.toContain('detail.halt');
  });
});

describe('brand-radar scan detail — charts', () => {
  it('renders the sentiment bar and a table fallback with identical values', async () => {
    routeApi({
      detail: () =>
        detailFor('completed', 'digest_present', {
          sentimentDistribution: { positive: 60, neutral: 20, negative: 15, unknown: 5 },
        }),
    });
    renderDetail();
    await screen.findByTestId('brand-radar-sentiment');

    for (const [key, percent] of [
      ['positive', 60],
      ['neutral', 20],
      ['negative', 15],
      ['unknown', 5],
    ] as Array<[string, number]>) {
      expect(screen.getByTestId(`brand-radar-sentiment-segment-${key}`)).toHaveStyle({
        width: `${percent}%`,
      });
      expect(screen.getByTestId(`brand-radar-sentiment-row-${key}`)).toHaveTextContent(
        `${percent}%`,
      );
    }
  });

  it('renders the trend chart with a table fallback once two settled scans exist', async () => {
    routeApi({ list: () => ({ items: trendList(), nextCursor: null }) });
    renderDetail();
    expect(await screen.findByTestId('brand-radar-trend-chart')).toBeInTheDocument();
    const rows = screen.getAllByTestId('brand-radar-trend-row');
    expect(rows).toHaveLength(2);
    // Oldest first, and only the viewed scan carries a server-side delta.
    expect(rows[0]).toHaveTextContent('36');
    expect(rows[0]).toHaveTextContent('Not compared');
    expect(rows[1]).toHaveTextContent('42');
    expect(rows[1]).toHaveTextContent('+6');
  });

  it('says so honestly when trend is null, and never renders a zero', async () => {
    routeApi({
      list: () => ({ items: trendList(), nextCursor: null }),
      detail: () => detailFor('completed', 'digest_present', { trend: null }),
    });
    renderDetail();
    expect(await screen.findByTestId('brand-radar-trend-null')).toHaveTextContent(
      'First scan for this query',
    );
    expect(screen.queryByTestId('brand-radar-trend-chart')).toBeNull();
  });

  it('asks for another run when the prior scan is not on the loaded page', async () => {
    routeApi({ list: () => ({ items: [scanFixture({ id: SCAN_ID })], nextCursor: null }) });
    renderDetail();
    expect(await screen.findByTestId('brand-radar-trend-needmore')).toBeInTheDocument();
    expect(screen.queryByTestId('brand-radar-trend-chart')).toBeNull();
  });

  it('lists the top citing domains with their server counts', async () => {
    routeApi({});
    renderDetail();
    const rows = await screen.findAllByTestId('brand-radar-top-domain-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('news.example');
    expect(rows[0]).toHaveTextContent('12');
  });
});

describe('brand-radar mention table', () => {
  it('renders a safe outbound link, and no anchor at all when the URL was rejected', async () => {
    routeApi({
      mentions: () => ({
        items: [
          mentionFixture({ id: 'm1', url: 'https://ok.example/post', domain: 'ok.example' }),
          mentionFixture({ id: 'm2', url: null, domain: 'blocked.example' }),
        ],
        nextCursor: null,
      }),
    });
    renderDetail();
    const link = await screen.findByTestId('brand-radar-mention-link');
    expect(link).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('href', 'https://ok.example/post');

    const plain = screen.getByTestId('brand-radar-mention-plain-domain');
    expect(plain).toHaveTextContent('blocked.example');
    expect(plain.closest('a')).toBeNull();
  });

  it('renders hostile vendor text as inert text nodes', async () => {
    routeApi({
      detail: () =>
        detailFor('completed', 'digest_present', {
          brandQuery: '<img src=x onerror=alert(1)>',
          digestSentences: [
            { text: '<script>alert(1)</script>', citedRowIds: [] },
          ],
        }),
      mentions: () => ({
        items: [
          mentionFixture({
            id: 'm1',
            title: '<script>alert(1)</script>',
            snippet: '<img src=x onerror=alert(1)>',
            domain: '<script>evil</script>',
            url: null,
          }),
        ],
        nextCursor: null,
      }),
    });
    const { container } = renderDetail();
    await screen.findByTestId('brand-radar-mention-row');

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText('<script>alert(1)</script>').length).toBeGreaterThan(0);
    expect(screen.getByTestId('brand-radar-mention-plain-domain')).toHaveTextContent(
      '<script>evil</script>',
    );
    expect(screen.getByTestId('brand-radar-detail-query')).toHaveTextContent(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('filters the loaded page by tone, site and date, and normalizes the URL', async () => {
    const user = userEvent.setup();
    routeApi({
      mentions: () => ({
        items: [
          mentionFixture({
            id: 'm1',
            polarity: 'positive',
            domain: 'news.example',
            observedAt: '2026-07-19T08:00:00.000Z',
          }),
          mentionFixture({
            id: 'm2',
            polarity: 'negative',
            domain: 'forum.example',
            observedAt: '2026-07-25T08:00:00.000Z',
            url: null,
          }),
          mentionFixture({
            id: 'm3',
            polarity: 'neutral',
            domain: 'undated.example',
            observedAt: null,
            url: null,
          }),
        ],
        nextCursor: null,
      }),
    });
    renderDetail();
    await screen.findAllByTestId('brand-radar-mention-row');
    expect(screen.getAllByTestId('brand-radar-mention-row')).toHaveLength(3);

    await user.selectOptions(screen.getByTestId('brand-radar-sentiment-filter'), 'negative');
    await waitFor(() =>
      expect(new URLSearchParams(search).get('sentiment')).toBe('negative'),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId('brand-radar-mention-row')).toHaveLength(1),
    );

    await user.selectOptions(screen.getByTestId('brand-radar-sentiment-filter'), 'all');
    await waitFor(() =>
      expect(screen.getAllByTestId('brand-radar-mention-row')).toHaveLength(3),
    );

    await user.type(screen.getByTestId('brand-radar-domain-filter'), 'NEWS');
    await waitFor(() => expect(new URLSearchParams(search).get('domain')).toBe('news'));
    await waitFor(() =>
      expect(screen.getAllByTestId('brand-radar-mention-row')).toHaveLength(1),
    );

    await user.clear(screen.getByTestId('brand-radar-domain-filter'));
    await waitFor(() => expect(new URLSearchParams(search).has('domain')).toBe(false));

    // A date window excludes both the out-of-range row and the undated one.
    await user.type(screen.getByTestId('brand-radar-from-filter'), '2026-07-18');
    await user.type(screen.getByTestId('brand-radar-to-filter'), '2026-07-20');
    await waitFor(() =>
      expect(screen.getAllByTestId('brand-radar-mention-row')).toHaveLength(1),
    );
    expect(screen.getAllByTestId('brand-radar-mention-row')[0]).toHaveTextContent(
      'news.example',
    );
  });

  it('shows the honest empty state when a filter matches nothing on the page', async () => {
    routeApi({ mentions: () => ({ items: [mentionFixture()], nextCursor: null }) });
    renderDetail(`/brand-radar?scan=${SCAN_ID}&domain=absent.example`);
    const note = await screen.findByTestId('brand-radar-mentions-filtered');
    expect(note).toHaveTextContent('No mention on this page matches those filters.');
    expect(screen.getByText('Filters apply to the mentions loaded on this page.')).toBeInTheDocument();
  });

  it('appends a keyset page without duplicating rows', async () => {
    const user = userEvent.setup();
    routeApi({
      mentions: (cursor) =>
        cursor === null
          ? {
              items: [mentionFixture({ id: 'm1' }), mentionFixture({ id: 'm2' })],
              nextCursor: 'cursor-2',
            }
          : {
              // The server repeats the boundary row; the slice must not.
              items: [mentionFixture({ id: 'm2' }), mentionFixture({ id: 'm3' })],
              nextCursor: null,
            },
    });
    renderDetail();
    await waitFor(() =>
      expect(screen.getAllByTestId('brand-radar-mention-row')).toHaveLength(2),
    );
    await user.click(screen.getByTestId('brand-radar-mentions-more'));
    await waitFor(() =>
      expect(screen.getAllByTestId('brand-radar-mention-row')).toHaveLength(3),
    );
    expect(screen.queryByTestId('brand-radar-mentions-more')).toBeNull();
  });
});

describe('brand-radar digest citations', () => {
  it('links a resolvable citation to its row and names an unresolvable one', async () => {
    const user = userEvent.setup();
    routeApi({
      detail: () =>
        detailFor('completed', 'digest_present', {
          digestSentences: [
            { text: 'Coverage grew.', citedRowIds: ['m1', 'missing-row'] },
          ],
        }),
      mentions: () => ({
        items: [mentionFixture({ id: 'm1', domain: 'news.example' })],
        nextCursor: null,
      }),
    });
    renderDetail();
    await user.click(await screen.findByTestId('brand-radar-citation-trigger'));

    const resolved = await screen.findByTestId('brand-radar-citation-resolved');
    expect(resolved).toHaveAttribute('href', '#brand-radar-mention-m1');
    expect(document.getElementById('brand-radar-mention-m1')).not.toBeNull();
    expect(screen.getByTestId('brand-radar-citation-unresolved')).toHaveTextContent(
      'Citation not in this page',
    );
  });
});

describe('brand-radar CSV export', () => {
  it('serializes the loaded rows client-side without any network call', async () => {
    const user = userEvent.setup();
    const rows: BrandRadarMentionRow[] = [
      mentionFixture({ id: 'm1', title: '=SUM(1)' }),
      mentionFixture({ id: 'm2', url: null, domain: 'blocked.example' }),
    ];
    routeApi({ mentions: () => ({ items: rows, nextCursor: null }) });

    // jsdom's Blob has no `.text()`, so capture the serialized payload at
    // construction time instead of reading it back off the blob.
    const blobParts: string[] = [];
    class CapturingBlob {
      constructor(parts: string[]) {
        blobParts.push(parts.join(''));
      }
    }
    vi.stubGlobal('Blob', CapturingBlob);
    const createObjectURL = vi.fn(() => 'blob:brand-radar');
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    renderDetail();
    await screen.findAllByTestId('brand-radar-mention-row');
    const callsBefore = mockedApiClient.mock.calls.length;

    await user.click(screen.getByTestId('brand-radar-export'));

    expect(mockedApiClient.mock.calls).toHaveLength(callsBefore);
    expect(blobParts).toHaveLength(1);
    const captured = blobParts[0]!;
    expect(captured.split('\r\n')[0]).toContain(
      'scan_id,captured_at,brand_query,mention_url,domain,title,snippet,sentiment,observed_at',
    );
    expect(captured).toContain("'=SUM(1)");
    expect(screen.getByText('Free — reads data you already paid for.')).toBeInTheDocument();
  });
});

describe('brand-radar detail errors and navigation', () => {
  it('renders an honest error when the scan is not the account’s', async () => {
    routeApi({
      detail: () => {
        throw new ApiError('not found', 404, {
          error: { message: 'We could not find that scan.' },
        });
      },
    });
    renderDetail();
    expect(await screen.findByText('We could not find that scan.')).toBeInTheDocument();
  });

  it('renders an honest error when the mention cursor is rejected', async () => {
    routeApi({
      mentions: () => {
        throw new ApiError('bad request', 400, {
          error: { message: 'That page cursor is not valid.' },
        });
      },
    });
    renderDetail();
    expect(await screen.findByText('That page cursor is not valid.')).toBeInTheDocument();
  });

  it('retries the detail read on demand', async () => {
    const user = userEvent.setup();
    let failed = false;
    routeApi({
      detail: () => {
        if (!failed) {
          failed = true;
          throw new ApiError('boom', 500, { error: { message: 'Server said no.' } });
        }
        return scanDetailFixture({ id: SCAN_ID });
      },
    });
    renderDetail();
    await screen.findByText('Server said no.');
    await user.click(screen.getByTestId('brand-radar-detail-retry'));
    expect(await screen.findByTestId('brand-radar-detail-query')).toHaveTextContent(
      'RankMeFast',
    );
  });

  it('opens a scan from the list and returns to it', async () => {
    const user = userEvent.setup();
    routeApi({ list: () => ({ items: [scanFixture({ id: SCAN_ID })], nextCursor: null }) });
    renderDetail(`/sites/${PANEL_SITE}?tab=brand-radar`);

    const row = await screen.findByTestId('brand-radar-row');
    await user.click(within(row).getByTestId('brand-radar-open-scan'));
    await waitFor(() => expect(new URLSearchParams(search).get('scan')).toBe(SCAN_ID));
    expect(await screen.findByTestId('brand-radar-detail')).toBeInTheDocument();

    await user.click(screen.getByTestId('brand-radar-detail-back'));
    await waitFor(() => expect(new URLSearchParams(search).has('scan')).toBe(false));
    expect(screen.getByTestId('brand-radar-row')).toBeInTheDocument();
  });

  it('shows a loading affordance before the detail lands', async () => {
    let resolveDetail: (value: unknown) => void = () => undefined;
    mockedApiClient.mockImplementation((path: string) => {
      if (path.includes('/mentions')) {
        return Promise.resolve({ items: [], nextCursor: null }) as never;
      }
      if (/\/brand-radar\/scans\/[^/?]+$/.test(path)) {
        return new Promise((resolve) => {
          resolveDetail = resolve;
        }) as never;
      }
      return Promise.resolve({ items: [], nextCursor: null }) as never;
    });
    renderDetail();
    expect(await screen.findByTestId('brand-radar-detail-loading')).toBeInTheDocument();
    resolveDetail(scanDetailFixture({ id: SCAN_ID }));
    expect(await screen.findByTestId('brand-radar-detail-query')).toBeInTheDocument();
  });
});
