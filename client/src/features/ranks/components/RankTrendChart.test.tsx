/**
 * Rank trend chart: an empty state below two checks; with
 * data, a labelled inverted position axis, dated time axis, chart tokens, a
 * pointer/keyboard tooltip and the table fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type { Keyword, RankHistoryMissedCheck, RankHistoryPoint } from '../types';
import { RankTrendChart, positionDomain, positionTicks } from './RankTrendChart';

const keyword = {
  id: 'k1',
  phrase: 'rewards app',
  latestPosition: 4,
  delta: 2,
} as unknown as Keyword;

const point = (day: number, position: number | null): RankHistoryPoint => ({
  checkedAt: `2026-09-${String(day).padStart(2, '0')}T08:00:00.000Z`,
  position,
  rankAbsolute: position,
  source: 'fresh',
  foundUrl: null,
  aiOverviewPresent: null,
  aiCited: null,
  aiCitedUrl: null,
  observationMeta: null,
});

const renderChart = (series: RankHistoryPoint[], missedChecks: RankHistoryMissedCheck[] = []) =>
  render(
    <I18nextProvider i18n={i18n}>
      <RankTrendChart keyword={keyword} series={series} missedChecks={missedChecks} />
    </I18nextProvider>,
  );

const missed = (day: number, status: 'failed' | 'skipped' = 'failed'): RankHistoryMissedCheck => ({
  periodKey: `2026-09-${day}`,
  status,
  reason: status === 'failed' ? 'vendor_unavailable' : 'cap_reached',
  attemptedAt: `2026-09-${String(day).padStart(2, '0')}T08:12:00.000Z`,
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('RankTrendChart', () => {
  it.each([
    ['no checks', []],
    ['one check', [point(1, 7)]],
  ])('shows "Needs two or more checks" for %s, never a one-point line', (_label, series) => {
    renderChart(series);
    expect(screen.getByTestId('rank-trend-empty')).toHaveTextContent('Needs two or more checks');
    expect(screen.getByTestId('rank-trend-empty')).toHaveTextContent(
      "The trend line appears after this keyword's second rank check.",
    );
    expect(screen.queryByTestId('rank-trend-svg')).toBeNull();
    expect(screen.queryByTestId('rank-trend-table')).toBeNull();
    // The latest position and change stay visible.
    expect(screen.getByTestId('rank-trend-latest')).toHaveTextContent('4');
  });

  it('draws position 1 at the top, labels the position axis and both ends of the time axis', () => {
    renderChart([point(1, 12), point(8, 3), point(15, 1)]);
    const svg = screen.getByTestId('rank-trend-svg');
    expect(svg).toHaveAttribute('direction', 'ltr');
    const ys = screen.getAllByTestId('rank-trend-point').map((c) => Number(c.getAttribute('cy')));
    // 12 → 3 → 1: each better position sits higher (smaller y).
    expect(ys[0]).toBeGreaterThan(ys[1]!);
    expect(ys[1]).toBeGreaterThan(ys[2]!);
    const ticks = screen.getAllByTestId('rank-trend-tick').map((tick) => within(tick).getByText(/\d+/).textContent);
    // Round positions, both ends included, not arbitrary ones like 13.
    expect(ticks).toEqual(['1', '5', '10', '15']);
    expect(screen.getByTestId('rank-trend-axis-title')).toHaveTextContent('Position');
    // The title is its own line above the plot, never among the top tick labels.
    expect(svg).not.toContainElement(screen.getByTestId('rank-trend-axis-title'));
    expect(screen.getByTestId('rank-trend-first-date')).toHaveTextContent('Sep 1, 2026');
    // Axis dates read left to right in every UI language (isolated).
    expect(screen.getByTestId('rank-trend-first-date').textContent).toBe('\u2066Sep 1, 2026\u2069');
    expect(screen.getByTestId('rank-trend-last-date')).toHaveTextContent('Sep 15, 2026');
    // Single series on the shared chart token.
    expect(screen.getAllByTestId('rank-trend-segment')[0]).toHaveClass('stroke-chart-1');
    expect(screen.getAllByTestId('rank-trend-point')[0]).toHaveClass('fill-chart-1');
    // The data stays available as a table.
    expect(within(screen.getByTestId('rank-trend-table')).getAllByRole('row')).toHaveLength(4);
  });

  it('reads each check with the keyboard and announces it in a tooltip', async () => {
    const user = userEvent.setup();
    renderChart([point(1, 12), point(8, 3), point(15, 1)]);
    const plot = screen.getByRole('group', { name: 'Rank history. Use the arrow keys to read each check.' });
    await user.tab();
    expect(plot).toHaveFocus();
    // Focus starts on the latest check.
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sep 15, 2026 · position 1');
    expect(plot).toHaveAttribute('aria-describedby', 'rank-trend-tooltip');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sep 8, 2026 · position 3');
    await user.keyboard('{Home}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sep 1, 2026 · position 12');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sep 1, 2026 · position 12');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sep 8, 2026 · position 3');
    await user.keyboard('{End}{ArrowUp}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sep 15, 2026 · position 1');
    await user.keyboard('a');
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(plot).not.toHaveAttribute('aria-describedby');
    // From nothing, an arrow starts at the latest check.
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sep 8, 2026 · position 3');
    await user.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows the check nearest the pointer and hides it when the pointer leaves', () => {
    renderChart([point(1, 12), point(8, 3), point(15, 1)]);
    const plot = screen.getByTestId('rank-trend-plot');
    plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 220 }) as DOMRect;
    // jsdom has no PointerEvent coordinates; give the event its clientX.
    const moveTo = (clientX: number) => {
      const event = createEvent.pointerMove(plot);
      Object.defineProperty(event, 'clientX', { value: clientX });
      fireEvent(plot, event);
    };
    moveTo(20);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sep 1, 2026 · position 12');
    moveTo(340);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sep 8, 2026 · position 3');
    moveTo(639);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sep 15, 2026 · position 1');
    fireEvent.pointerLeave(plot);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('keeps a readable range: at least four positions, inside 1–100', () => {
    expect(positionDomain([1, 1])).toEqual({ top: 1, bottom: 5 });
    expect(positionDomain([99, 100])).toEqual({ top: 96, bottom: 100 });
    // Widened to round positions so every label is a meaningful number.
    expect(positionDomain([10, 40])).toEqual({ top: 1, bottom: 50 });
    expect(positionDomain([30, 70])).toEqual({ top: 20, bottom: 80 });
    expect(positionTicks({ top: 1, bottom: 5 })).toEqual([1, 2, 3, 4, 5]);
    expect(positionTicks({ top: 1, bottom: 50 })).toEqual([1, 10, 20, 30, 40, 50]);
    expect(positionTicks({ top: 20, bottom: 80 })).toEqual([20, 40, 60, 80]);
  });

  it('draws at the measured pixel width so labels keep their size', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 360 } as DOMRect);
    renderChart([point(1, 12), point(8, 3), point(15, 1)]);
    const svg = screen.getByTestId('rank-trend-svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 360 220');
    expect(svg).toHaveAttribute('width', '360');
    // Never narrower than a readable minimum.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100 } as DOMRect);
    cleanup();
    renderChart([point(1, 12), point(8, 3), point(15, 1)]);
    expect(screen.getByTestId('rank-trend-svg')).toHaveAttribute('width', '240');
  });

  it('keeps the tooltip inside the plot: grows inward at the edges and opens below near the top', async () => {
    const user = userEvent.setup();
    renderChart([point(1, 12), point(8, 3), point(15, 1)]);
    await user.tab();
    // Latest check: right edge, best rank (top of the plot).
    expect(screen.getByTestId('rank-trend-tooltip')).toHaveAttribute('data-placement', 'below-end');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('rank-trend-tooltip')).toHaveAttribute('data-placement', 'below-center');
    await user.keyboard('{Home}');
    // First check: left edge, worst rank (bottom of the plot).
    expect(screen.getByTestId('rank-trend-tooltip')).toHaveAttribute('data-placement', 'above-start');
  });

  it('names every kind of check in the tooltip: unranked, failed and skipped', async () => {
    const user = userEvent.setup();
    renderChart(
      [point(7, 35), point(14, null), point(28, 46)],
      [missed(10, 'failed'), missed(20, 'skipped')],
    );
    await user.tab();
    // Events in time order: 7 ranked, 10 failed, 14 unranked, 20 skipped, 28 ranked.
    await user.keyboard('{Home}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sep 7, 2026 · position 35');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Sep 10, 2026/);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/failed/i);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Sep 14, 2026/);
    // The focused unranked check is drawn larger than the others.
    expect(screen.getByTestId('rank-trend-unranked')).toHaveAttribute('r', '5');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Sep 20, 2026/);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/skipped/i);
  });

  it('describes every change the delta can show', () => {
    const view = renderChart([point(1, 5), point(2, 4)]);
    expect(screen.getByTestId('rank-trend-delta')).toHaveTextContent('Improved by 2 positions');
    view.unmount();
    for (const [delta, text] of [
      [null, 'No previous data'],
      [0, 'No change in position'],
      [1, 'Improved by 1 position'],
      [-1, 'Declined by 1 position'],
      [-3, 'Declined by 3 positions'],
    ] as const) {
      const one = render(
        <I18nextProvider i18n={i18n}>
          <RankTrendChart keyword={{ ...keyword, delta, latestPosition: null } as Keyword} series={[]} />
        </I18nextProvider>,
      );
      expect(screen.getByTestId('rank-trend-delta')).toHaveTextContent(text);
      expect(screen.getByTestId('rank-trend-latest')).toHaveTextContent('Not in top 100');
      one.unmount();
    }
  });

  it('keeps a failed weekly check between two stored ones as a labelled gap, never a rank', () => {
    // Sep 28 = 35 and Oct 12 = 46 are stored; Oct 5 failed. Same shape, shifted into September here.
    renderChart([point(7, 35), point(21, 46)], [missed(14)]);
    // Two ranked points and one failure marker, in time order along a real time axis.
    const points = screen.getAllByTestId('rank-trend-point');
    expect(points).toHaveLength(2);
    const marker = screen.getByTestId('rank-trend-missed');
    expect(marker).toHaveAttribute('data-status', 'failed');
    const xs = [...points.map((p) => Number(p.getAttribute('cx')))];
    const markerX = Number(marker.querySelector('line')!.getAttribute('x1'));
    expect(markerX).toBeGreaterThan(xs[0]!);
    expect(markerX).toBeLessThan(xs[1]!);
    // Roughly midway: the failure was attempted twelve minutes after the 08:00 checks.
    expect(Math.abs(markerX - xs[0]! - (xs[1]! - markerX))).toBeLessThan(2);
    // The line crossing the failure is dashed and says why.
    expect(screen.queryByTestId('rank-trend-segment')).toBeNull();
    expect(screen.getByTestId('rank-trend-gap')).toHaveAttribute('stroke-dasharray');
    expect(screen.getByTestId('rank-trend-gap-note')).toHaveTextContent('Dashed lines cross a check that recorded no rank.');
    // Nothing was invented: the table lists the failure, not a position.
    const rows = within(screen.getByTestId('rank-trend-table')).getAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'DatePosition',
      'Sep 7, 202635',
      'Sep 14, 2026Check failed',
      'Sep 21, 202646',
    ]);
  });

  it('draws a skipped check differently from a failed one only in its label', () => {
    renderChart([point(7, 35), point(21, 46)], [missed(14, 'skipped')]);
    expect(screen.getByTestId('rank-trend-missed')).toHaveAttribute('data-status', 'skipped');
    expect(within(screen.getByTestId('rank-trend-table')).getByText('Check skipped')).toBeInTheDocument();
  });

  it('plots a check that found no rank in the lane below the positions and bridges it with a dashed line', () => {
    renderChart([point(1, 12), point(8, null), point(15, 9)]);
    const unranked = screen.getByTestId('rank-trend-unranked');
    const rankedYs = screen.getAllByTestId('rank-trend-point').map((c) => Number(c.getAttribute('cy')));
    // Below every ranked position, and hollow.
    expect(Number(unranked.getAttribute('cy'))).toBeGreaterThan(Math.max(...rankedYs));
    expect(unranked).toHaveClass('fill-background');
    expect(screen.getAllByTestId('rank-trend-gap')).toHaveLength(2);
    expect(within(screen.getByTestId('rank-trend-table')).getByText('Not in top 100')).toBeInTheDocument();
  });

  it('places checks by real time, so uneven gaps look uneven', () => {
    renderChart([point(1, 12), point(2, 11), point(30, 9)]);
    const xs = screen.getAllByTestId('rank-trend-point').map((p) => Number(p.getAttribute('cx')));
    expect(xs[1]! - xs[0]!).toBeLessThan((xs[2]! - xs[1]!) / 10);
  });

  it('announces a missed check in the tooltip', async () => {
    const user = userEvent.setup();
    renderChart([point(7, 35), point(21, 46)], [missed(14)]);
    await user.tab();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sep 14, 2026: check failed, no rank recorded');
  });
});
