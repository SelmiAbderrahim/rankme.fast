import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { maliciousTrafficDetail } from './__fixtures__/xss';
import { SnapshotDetail } from './components/SnapshotDetail';
import type { TrafficSnapshotDetail } from './types';

vi.mock('@features/report-export', () => ({
  ReportExportControl: ({ target }: { target: { siteId?: string } }) => (
    <div data-testid="report-export-control" data-site={target.siteId} />
  ),
}));

const renderDetail = (props: {
  detail: TrafficSnapshotDetail | null;
  loading?: boolean;
  error?: string;
}) =>
  render(
    <I18nextProvider i18n={i18n}>
      <SnapshotDetail
        detail={props.detail}
        loading={props.loading ?? false}
        error={props.error}
      />
    </I18nextProvider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('SnapshotDetail', () => {
  it('labels every stat Estimate, repeats the coverage note, and exposes chart data', () => {
    renderDetail({
      detail: {
        ...maliciousTrafficDetail,
        siteId: 'site-1',
        snapshot: {
          ...maliciousTrafficDetail.snapshot!,
          payload: {
            ...maliciousTrafficDetail.snapshot!.payload,
            history: [
              ...maliciousTrafficDetail.snapshot!.payload.history,
              {
                ...maliciousTrafficDetail.snapshot!.payload.history[0]!,
                capturedAt: '2026-07-01T00:00:00.000Z',
                traffic: {
                  ...maliciousTrafficDetail.snapshot!.payload.history[0]!.traffic,
                  value: 1200,
                },
              },
            ],
          },
        },
      },
    });
    for (const id of ['monthlyVisits', 'rank', 'keywords']) {
      expect(within(screen.getByTestId(`traffic-stat-${id}`)).getByText('Estimate')).toBeVisible();
    }
    expect(
      screen.getAllByText("Modeled from the provider's index, not analytics data.").length,
    ).toBeGreaterThanOrEqual(4);
    expect(screen.getByTestId('traffic-history-chart').querySelector('svg')).toBeInTheDocument();
    expect(screen.getByTestId('report-export-control')).toHaveAttribute('data-site', 'site-1');
    const fallback = screen.getByTestId('traffic-history-table-fallback');
    expect(within(fallback).getByText('Estimated rank, traffic, and keyword history')).toBeInTheDocument();
  });

  it('shows the partial-retention coverage strip and missing nullable values honestly', () => {
    const partial: TrafficSnapshotDetail = {
      ...maliciousTrafficDetail,
      status: 'partial',
      retainedOps: { traffic: true, rankOverview: false, history: true },
      snapshot: {
        ...maliciousTrafficDetail.snapshot!,
        payload: {
          ...maliciousTrafficDetail.snapshot!.payload,
          domainRank: {
            ...maliciousTrafficDetail.snapshot!.payload.domainRank,
            value: null,
          },
          keywordCount: {
            ...maliciousTrafficDetail.snapshot!.payload.keywordCount,
            value: null,
          },
          history: [
            {
              ...maliciousTrafficDetail.snapshot!.payload.history[0]!,
              rank: {
                ...maliciousTrafficDetail.snapshot!.payload.history[0]!.rank,
                value: null,
              },
            },
          ],
        },
      },
    };
    renderDetail({ detail: partial });
    expect(screen.getByTestId('traffic-detail-partial')).toHaveTextContent(
      '2 of three provider operations were retained',
    );
    expect(screen.getAllByText('Not available')).toHaveLength(3);
  });

  it('renders failed, queued, loading, error, empty-detail, and empty-history states', () => {
    const failed = renderDetail({
      detail: { ...maliciousTrafficDetail, status: 'failed', snapshot: null, refunded: true },
    });
    expect(screen.getByTestId('traffic-detail-failed')).toHaveTextContent('refunded');
    failed.unmount();

    const queued = renderDetail({
      detail: { ...maliciousTrafficDetail, status: 'queued', snapshot: null },
    });
    expect(screen.getByText('Snapshot queued')).toBeInTheDocument();
    queued.unmount();

    const loading = renderDetail({ detail: null, loading: true });
    expect(loading.container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
    loading.unmount();

    const error = renderDetail({ detail: null, error: 'wire failed' });
    expect(screen.getByRole('alert')).toHaveTextContent('wire failed');
    error.unmount();

    const empty = renderDetail({ detail: null });
    expect(empty.container).toBeEmptyDOMElement();
    empty.unmount();

    renderDetail({
      detail: {
        ...maliciousTrafficDetail,
        snapshot: {
          ...maliciousTrafficDetail.snapshot!,
          payload: { ...maliciousTrafficDetail.snapshot!.payload, history: [] },
        },
      },
    });
    expect(screen.getByText('No history points were retained for this snapshot.')).toBeVisible();
  });

  it('falls back to the raw country code when Intl has no display label', () => {
    vi.spyOn(Intl.DisplayNames.prototype, 'of').mockReturnValue(undefined);
    renderDetail({ detail: maliciousTrafficDetail });
    expect(screen.getByText('US')).toBeInTheDocument();
  });

  it('mirrors history on the shared RTL x-axis and formats Arabic numerals', async () => {
    await changeLanguage('ar');
    const history = [
      maliciousTrafficDetail.snapshot!.payload.history[0]!,
      {
        ...maliciousTrafficDetail.snapshot!.payload.history[0]!,
        capturedAt: '2026-07-01T00:00:00.000Z',
        traffic: {
          ...maliciousTrafficDetail.snapshot!.payload.history[0]!.traffic,
          value: 1200,
        },
      },
    ];
    renderDetail({
      detail: {
        ...maliciousTrafficDetail,
        snapshot: {
          ...maliciousTrafficDetail.snapshot!,
          payload: { ...maliciousTrafficDetail.snapshot!.payload, history },
        },
      },
    });

    const chart = screen.getByTestId('traffic-history-chart').querySelector('svg')!;
    expect(chart).toHaveAttribute('data-rtl', 'true');
    const circles = chart.querySelectorAll('circle');
    expect(Number(circles[0]!.getAttribute('cx'))).toBeGreaterThan(
      Number(circles[1]!.getAttribute('cx')),
    );
    expect(screen.getByTestId('traffic-stat-monthlyVisits')).toHaveTextContent(
      new Intl.NumberFormat('ar').format(1200),
    );
    expect(screen.getByTestId('traffic-history-table-fallback')).toHaveTextContent(
      new Intl.NumberFormat('ar').format(1000),
    );
  });
});
