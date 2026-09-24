import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation, useSearchParams } from 'react-router-dom';
import { apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { compareTrafficSnapshots } from './api';
import { estimateObservation } from './__fixtures__/xss';
import { SnapshotList } from './components/SnapshotList';
import { TrafficCompareChart } from './components/TrafficCompareChart';
import { readTrafficCompareIds, TrafficCompareView } from './components/TrafficCompareView';
import type {
  TrafficSnapshotCompareResponse,
  TrafficSnapshotListResponse,
  TrafficSnapshotSummary,
} from './types';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

vi.mock('@features/report-export', () => ({
  ReportExportControl: ({ target }: { target: { siteId?: string } }) => (
    <div data-testid="report-export-control" data-site={target.siteId} />
  ),
}));

const mockedApiClient = vi.mocked(apiClient);

const snapshot = (index: number): TrafficSnapshotSummary => ({
  id: `${index}`.padStart(24, String(index)),
  siteId: null,
  targetDomain: `rival-${index}.example`,
  capturedAt: `2026-07-${String(index).padStart(2, '0')}T12:00:00.000Z`,
  payload: {
    monthlyOrganicVisits: {
      value: index * 1_000,
      observation: estimateObservation,
    },
    topCountries: [
      {
        countryCode: index % 2 === 0 ? 'DE' : 'US',
        visits: { value: index * 700, observation: estimateObservation },
      },
    ],
    domainRank: { value: index * 10, observation: estimateObservation },
    keywordCount: { value: index * 100, observation: estimateObservation },
    history: [
      {
        capturedAt: '2026-05-01T00:00:00.000Z',
        rank: { value: index * 12, observation: estimateObservation },
        traffic: { value: index * 800, observation: estimateObservation },
        keywordCount: { value: index * 80, observation: estimateObservation },
      },
      {
        capturedAt: '2026-06-01T00:00:00.000Z',
        rank: { value: index * 10, observation: estimateObservation },
        traffic: { value: index * 1_000, observation: estimateObservation },
        keywordCount: { value: index * 100, observation: estimateObservation },
      },
    ],
    retained: { traffic: true, rankOverview: true, history: true },
  },
});

const response = (count: number): TrafficSnapshotCompareResponse => ({
  snapshots: Array.from({ length: count }, (_, index) => snapshot(index + 1)),
  axes: { countryCodes: ['US', 'DE'] },
  warning: null,
});

const CompareHarness = ({ onCollapse = vi.fn() }: { onCollapse?: (id: string) => void }) => {
  const [params] = useSearchParams();
  const ids = readTrafficCompareIds(params);
  return (
    <>
      {ids.length >= 2 ? (
        <TrafficCompareView ids={ids} siteId="site-1" onCollapse={onCollapse} />
      ) : null}
      <output data-testid="compare-search">{useLocation().search}</output>
    </>
  );
};

const SearchProbe = ({ testId }: { testId: string }) => (
  <output data-testid={testId}>{useLocation().search}</output>
);

const renderCompare = (ids: string[], onCollapse?: (id: string) => void) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/sites/site-1?tab=traffic&ids=${ids.join(',')}`]}>
        <CompareHarness onCollapse={onCollapse} />
      </MemoryRouter>
    </I18nextProvider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mockedApiClient.mockReset();
});

describe('TrafficCompareView', () => {
  it.each([2, 3, 4, 5])('renders %i stored snapshots in id order', async (count) => {
    mockedApiClient.mockResolvedValueOnce(response(count));
    const ids = response(count).snapshots.map((item) => item.id);
    renderCompare(ids);

    expect(await screen.findByTestId(`traffic-compare-card-${ids[count - 1]}`)).toBeVisible();
    expect(screen.getAllByText('Estimate').length).toBeGreaterThan(count);
    expect(screen.getByTestId('report-export-control')).toHaveAttribute('data-site', 'site-1');
    const series = screen
      .getAllByTestId('traffic-compare-chart')[0]!
      .querySelectorAll('[data-series-id]');
    expect([...series].map((element) => element.getAttribute('data-series-id'))).toEqual(ids);
  });

  it('refuses a sixth id, warns, and calls the stored compare endpoint with five', async () => {
    mockedApiClient.mockResolvedValueOnce(response(5));
    const ids = response(5)
      .snapshots.map((item) => item.id)
      .concat('666666666666666666666666');
    renderCompare(ids);

    expect(await screen.findByTestId('traffic-compare-clamped')).toHaveTextContent(
      'The sixth snapshot was not added',
    );
    await waitFor(() =>
      expect(screen.getByTestId('compare-search')).not.toHaveTextContent(ids[5]!),
    );
    expect(mockedApiClient).toHaveBeenCalledWith(
      expect.stringContaining(`ids=${encodeURIComponent(ids.slice(0, 5).join(','))}`),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(String(mockedApiClient.mock.calls[0]?.[0])).toContain('siteId=site-1');
  });

  it('renders a response-boundary warning as localized prose instead of its key', async () => {
    const result = response(2);
    result.warning = {
      code: 'RESULT_SET_CLAMPED',
      messageKey: 'trafficInsights.compare.clamped',
      messageVars: { count: 5 },
      message: 'تم تقليص مجموعة النتائج إلى خمس لقطات.',
    };
    mockedApiClient.mockResolvedValueOnce(result);
    renderCompare(result.snapshots.map((item) => item.id));

    expect(await screen.findByTestId('traffic-compare-clamped')).toHaveTextContent(
      'تم تقليص مجموعة النتائج إلى خمس لقطات.',
    );
    expect(screen.getByTestId('traffic-compare-clamped')).not.toHaveTextContent(
      'trafficInsights.compare.clamped',
    );
  });

  it('drops below two into detail and removes ids from the shareable URL', async () => {
    mockedApiClient.mockResolvedValueOnce(response(2));
    const onCollapse = vi.fn();
    const ids = response(2).snapshots.map((item) => item.id);
    renderCompare(ids, onCollapse);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove rival-1.example from comparison' }),
    );
    expect(onCollapse).toHaveBeenCalledWith(ids[1]);
    expect(screen.getByTestId('compare-search')).not.toHaveTextContent('ids=');
  });

  it('removes one of three while keeping a shareable comparison URL', async () => {
    mockedApiClient.mockResolvedValueOnce(response(3)).mockResolvedValueOnce(response(2));
    const onCollapse = vi.fn();
    const ids = response(3).snapshots.map((item) => item.id);
    renderCompare(ids, onCollapse);

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Remove rival-2.example from comparison',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('compare-search')).not.toHaveTextContent(ids[1]!),
    );
    expect(screen.getByTestId('compare-search')).toHaveTextContent(ids[0]!);
    expect(screen.getByTestId('compare-search')).toHaveTextContent(ids[2]!);
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it('silently renders only rows returned for the current account', async () => {
    mockedApiClient.mockResolvedValueOnce({
      snapshots: [snapshot(1)],
      axes: { countryCodes: ['US'] },
    });
    renderCompare([snapshot(1).id, snapshot(2).id]);

    expect((await screen.findAllByText('rival-1.example'))[0]).toBeVisible();
    expect(screen.queryByText('rival-2.example')).not.toBeInTheDocument();
  });

  it('ships an accessible table fallback for the overlay chart', async () => {
    mockedApiClient.mockResolvedValueOnce(response(2));
    renderCompare([snapshot(1).id, snapshot(2).id]);

    const fallback = await screen.findByTestId('traffic-compare-table-fallback');
    expect(fallback).toHaveTextContent('Show the accessible comparison table');
    expect(fallback.querySelector('caption')).toHaveTextContent(
      'Estimated monthly traffic history by snapshot',
    );
  });

  it('renders unavailable aligned values without inferring missing data', async () => {
    const first = snapshot(1);
    first.payload.domainRank.value = null;
    first.payload.keywordCount.value = null;
    mockedApiClient.mockResolvedValueOnce({
      snapshots: [first, snapshot(2)],
      axes: { countryCodes: ['US', 'FR'] },
    });
    renderCompare([first.id, snapshot(2).id]);

    expect((await screen.findAllByText('Not available')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('uses the unknown-country label when an axis code cannot be localized', async () => {
    mockedApiClient.mockResolvedValueOnce({
      snapshots: [snapshot(1), snapshot(2)],
      axes: { countryCodes: [''] },
    });
    renderCompare([snapshot(1).id, snapshot(2).id]);
    expect(await screen.findByText('Unknown country')).toBeVisible();
  });

  it('shows compare failures and keeps the retry button loading in place', async () => {
    mockedApiClient
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(new Promise(() => undefined));
    renderCompare([snapshot(1).id, snapshot(2).id]);

    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not compare these traffic snapshots.',
    );
    await userEvent.click(retry);
    expect(screen.getByRole('button', { name: 'Trying again…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('does not paint a late compare failure after the view unmounts', async () => {
    let rejectRequest!: (reason: unknown) => void;
    mockedApiClient.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectRequest = reject;
      }),
    );
    const rendered = renderCompare([snapshot(1).id, snapshot(2).id]);
    rendered.unmount();
    rejectRequest(new Error('late'));
    await Promise.resolve();
    await Promise.resolve();
  });

  it('covers empty, one-point, and unaligned chart histories', () => {
    const empty = snapshot(1);
    empty.payload.history = [];
    const onePoint = snapshot(2);
    onePoint.payload.history = [onePoint.payload.history[0]!];
    const first = render(
      <I18nextProvider i18n={i18n}>
        <TrafficCompareChart snapshots={[empty, onePoint]} />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('traffic-compare-chart').querySelector('polyline')).toBeNull();
    expect(screen.getByTestId('traffic-compare-table-fallback')).toHaveTextContent('—');
    first.unmount();

    render(
      <I18nextProvider i18n={i18n}>
        <TrafficCompareChart snapshots={[empty]} />
      </I18nextProvider>,
    );
    expect(screen.getByText('No comparable history points were retained.')).toBeVisible();
  });

  it('supports keyboard-only selection, compare, and removal', async () => {
    const list: TrafficSnapshotListResponse = {
      snapshots: Array.from({ length: 6 }, (_, index) => snapshot(index + 1)),
      nextCursor: null,
    };
    const user = userEvent.setup();
    const first = render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/sites/site-1?tab=traffic']}>
          <SnapshotList data={list} status="succeeded" onOpen={vi.fn()} />
          <SearchProbe testId="selection-search" />
        </MemoryRouter>
      </I18nextProvider>,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes[0]!.focus();
    await user.keyboard(' ');
    checkboxes[1]!.focus();
    await user.keyboard(' ');
    checkboxes[2]!.focus();
    await user.keyboard(' ');
    await user.keyboard(' ');
    const compare = screen.getByRole('button', { name: 'Compare 2 snapshots' });
    compare.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('selection-search')).toHaveTextContent(
      `ids=${snapshot(1).id}%2C${snapshot(2).id}`,
    );
    first.unmount();

    mockedApiClient.mockResolvedValueOnce(response(2));
    const onCollapse = vi.fn();
    renderCompare([snapshot(1).id, snapshot(2).id], onCollapse);
    const remove = await screen.findByRole('button', {
      name: 'Remove rival-1.example from comparison',
    });
    remove.focus();
    await user.keyboard('{Enter}');
    expect(onCollapse).toHaveBeenCalledWith(snapshot(2).id);
  });

  it('refuses a sixth checkbox selection in the stored list', async () => {
    const list: TrafficSnapshotListResponse = {
      snapshots: Array.from({ length: 6 }, (_, index) => snapshot(index + 1)),
      nextCursor: null,
    };
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <SnapshotList data={list} status="succeeded" onOpen={vi.fn()} />
        </MemoryRouter>
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    const checkboxes = screen.getAllByRole('checkbox');
    for (const checkbox of checkboxes) await user.click(checkbox);

    expect(screen.getByTestId('traffic-compare-selection-warning')).toHaveTextContent(
      'The sixth snapshot was not added',
    );
    expect(checkboxes[5]).not.toBeChecked();
  });

  it('exposes the compare API wrapper and encoded id order', async () => {
    mockedApiClient.mockResolvedValueOnce(response(2));
    const ids = [snapshot(2).id, snapshot(1).id];
    await compareTrafficSnapshots(ids);
    expect(mockedApiClient).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(ids.join(','))),
      undefined,
    );
  });

  it('parses unique non-empty ids from URL state', () => {
    expect(readTrafficCompareIds(new URLSearchParams('ids=a,,a,b'))).toEqual(['a', 'b']);
    expect(readTrafficCompareIds(new URLSearchParams())).toEqual([]);
  });

  it('mirrors the comparison history x-axis in Arabic', async () => {
    await changeLanguage('ar');
    render(
      <I18nextProvider i18n={i18n}>
        <TrafficCompareChart snapshots={[snapshot(1), snapshot(2)]} />
      </I18nextProvider>,
    );

    const chart = screen.getByTestId('traffic-compare-chart').querySelector('svg')!;
    expect(chart).toHaveAttribute('data-rtl', 'true');
    const firstSeries = chart.querySelector('[data-series-id]')!;
    const [first, second] = (firstSeries.getAttribute('points') ?? '')
      .split(' ')
      .map((point) => Number(point.split(',')[0]));
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!).toBeGreaterThan(second!);
  });
});
