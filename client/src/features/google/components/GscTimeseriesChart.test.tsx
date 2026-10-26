/**
 * GscTimeseriesChart tests — svg + sr-only table, the clicks/impressions metric
 * toggle (pointer + keyboard), and the empty state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { GscTimeseriesChart } from './GscTimeseriesChart';
import type { GscSummaryTimeseriesPoint } from '../types';

const points: GscSummaryTimeseriesPoint[] = [
  { date: '2026-06-08', clicks: 5, impressions: 111, ctr: 0.045, position: 8.2 },
  { date: '2026-06-09', clicks: 8, impressions: 222, ctr: 0.036, position: 9.3 },
  { date: '2026-06-10', clicks: 12, impressions: 333, ctr: 0.03, position: 10.4 },
];

const renderChart = (data: GscSummaryTimeseriesPoint[]) =>
  render(
    <I18nextProvider i18n={i18n}>
      <GscTimeseriesChart points={data} />
    </I18nextProvider>,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('GscTimeseriesChart', () => {
  it('renders an accessible svg plus a visually-hidden table with one row per point', () => {
    renderChart(points);
    const svg = screen.getByRole('group', { name: /^Daily Clicks/ });
    expect(svg.getAttribute('aria-label')).toBe('Daily Clicks for the last 28 days');
    const table = screen.getByTestId('gsc-timeseries-table');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(points.length);
    // Each point's clicks/impressions land in the table.
    expect(within(table).getByText('5')).toBeInTheDocument();
    expect(within(table).getByText('111')).toBeInTheDocument();
  });

  it('a day without impressions has no CTR or position in the table', () => {
    renderChart([...points, { date: '2026-06-11', clicks: 0, impressions: 0, ctr: 0, position: 0 }]);
    const row = screen.getAllByRole('row').at(-1)!;
    expect(within(row).getAllByText('No data')).toHaveLength(2);
    expect(within(row).queryByText('0%')).not.toBeInTheDocument();
  });

  it('toggles the charted metric, flipping aria-pressed and the aria-label', async () => {
    const user = userEvent.setup();
    renderChart(points);
    const clicksBtn = screen.getByRole('button', { name: 'Clicks' });
    const impressionsBtn = screen.getByRole('button', { name: 'Impressions' });

    expect(clicksBtn).toHaveAttribute('aria-pressed', 'true');
    expect(impressionsBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('gsc-timeseries-svg').getAttribute('aria-label')).toBe(
      'Daily Clicks for the last 28 days',
    );

    await user.click(impressionsBtn);
    expect(impressionsBtn).toHaveAttribute('aria-pressed', 'true');
    expect(clicksBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('gsc-timeseries-svg').getAttribute('aria-label')).toBe(
      'Daily Impressions for the last 28 days',
    );

    // Toggle back to cover the other direction.
    await user.click(clicksBtn);
    expect(clicksBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('is keyboard-operable — Enter on a focused toggle switches the metric', async () => {
    const user = userEvent.setup();
    renderChart(points);
    const impressionsBtn = screen.getByRole('button', { name: 'Impressions' });
    impressionsBtn.focus();
    await user.keyboard('{Enter}');
    expect(impressionsBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('gsc-timeseries-svg').getAttribute('aria-label')).toBe(
      'Daily Impressions for the last 28 days',
    );
  });

  it('interpolates the days prop into the chart label (7-day range)', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <GscTimeseriesChart points={points} days={7} />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('gsc-timeseries-svg').getAttribute('aria-label')).toBe(
      'Daily Clicks for the last 7 days',
    );
  });

  it('renders the empty label (no svg) when there are no points', () => {
    renderChart([]);
    expect(screen.getByTestId('gsc-timeseries-empty')).toHaveTextContent(
      'No daily data yet.',
    );
    expect(screen.queryByTestId('gsc-timeseries-point')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gsc-timeseries-svg')).not.toBeInTheDocument();
  });

  it('renders under Arabic locale', async () => {
    await changeLanguage('ar');
    renderChart(points);
    expect(screen.getByTestId('gsc-timeseries-svg')).toBeInTheDocument();
    await changeLanguage('en');
  });
});


describe('GscTimeseriesChart axes, tooltip and zero state', () => {
  const dayPoints = (values: number[]): GscSummaryTimeseriesPoint[] =>
    values.map((clicks, i) => ({
      date: `2026-06-${String(8 + i).padStart(2, '0')}`,
      clicks,
      impressions: clicks * 10,
      ctr: 0.1,
      position: 5,
    }));

  it('draws a y-axis scale from an explicit zero baseline and date ticks that include the first and last day', () => {
    renderChart(dayPoints([5, 8, 12]));
    // Max 12 -> step 5 -> ticks 0, 5, 10, 15.
    const yTicks = screen.getAllByTestId('gsc-timeseries-ytick').map((el) => el.textContent);
    expect(yTicks).toEqual(['0', '5', '10', '15']);
    const xTicks = screen.getAllByTestId('gsc-timeseries-xtick').map((el) => el.textContent!.replace(/[\u2066\u2069]/g, ''));
    expect(xTicks).toEqual(['Jun 8', 'Jun 9', 'Jun 10']);
    expect(screen.queryByTestId('gsc-timeseries-no-activity')).toBeNull();
  });

  it('thins the x-axis to a handful of date ticks on long ranges', () => {
    renderChart(dayPoints(Array.from({ length: 22 }, (_, i) => i)));
    const xTicks = screen.getAllByTestId('gsc-timeseries-xtick').map((el) => el.textContent!.replace(/[\u2066\u2069]/g, ''));
    expect(xTicks.length).toBeLessThanOrEqual(6);
    expect(xTicks[0]).toBe('Jun 8');
    expect(xTicks.at(-1)).toBe('Jun 29');
  });

  it('shows the exact values of every metric in a tooltip on hover and hides it on leave', () => {
    renderChart(dayPoints([5, 1234, 12]));
    expect(screen.queryByTestId('gsc-timeseries-tooltip')).toBeNull();
    fireEvent.pointerEnter(screen.getAllByTestId('gsc-timeseries-hit')[1]!);
    const tooltip = screen.getByTestId('gsc-timeseries-tooltip');
    expect(tooltip).toHaveTextContent('Jun 9, 2026');
    expect(tooltip).toHaveTextContent('Clicks: 1,234');
    expect(tooltip).toHaveTextContent('Impressions: 12,340');
    fireEvent.pointerLeave(screen.getByTestId('gsc-timeseries-svg'));
    expect(screen.queryByTestId('gsc-timeseries-tooltip')).toBeNull();
  });

  it('every point is a labelled, keyboard-reachable stop (one tab stop, roving)', () => {
    renderChart(dayPoints([5, 8, 12]));
    const dots = screen.getAllByTestId('gsc-timeseries-point');
    expect(dots[0]).toHaveAttribute('aria-label', 'Jun 8, 2026: Clicks 5, Impressions 50');
    // Only the latest day is in the tab order until focus moves.
    expect(dots.map((dot) => dot.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
  });

  it('arrow, Home and End keys move focus between points and the tooltip follows; blur clears it', async () => {
    const user = userEvent.setup();
    renderChart(dayPoints([5, 8, 12, 3]));
    const dots = screen.getAllByTestId('gsc-timeseries-point');
    act(() => dots[3]!.focus());
    expect(screen.getByTestId('gsc-timeseries-tooltip')).toHaveTextContent('Clicks: 3');
    await user.keyboard('{ArrowLeft}');
    expect(dots[2]).toHaveFocus();
    expect(screen.getByTestId('gsc-timeseries-tooltip')).toHaveTextContent('Clicks: 12');
    await user.keyboard('{Home}');
    expect(dots[0]).toHaveFocus();
    await user.keyboard('{ArrowLeft}'); // clamped at the first point
    expect(dots[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(dots[1]).toHaveFocus();
    await user.keyboard('{End}');
    expect(dots[3]).toHaveFocus();
    await user.keyboard('{ArrowRight}'); // clamped at the last point
    expect(dots[3]).toHaveFocus();
    // An unrelated key neither moves focus nor swallows the event.
    await user.keyboard('a');
    expect(dots[3]).toHaveFocus();
    // The focused point is now the tab stop; leaving the chart hides the tooltip.
    expect(dots[3]).toHaveAttribute('tabindex', '0');
    act(() => dots[3]!.blur());
    expect(screen.queryByTestId('gsc-timeseries-tooltip')).toBeNull();
  });

  it('an all-zero series is drawn flat on an explicit zero baseline and says there was no activity', () => {
    renderChart(dayPoints([0, 0, 0]));
    expect(screen.getByTestId('gsc-timeseries-no-activity')).toHaveTextContent(
      'No clicks in this period.',
    );
    const yTicks = screen.getAllByTestId('gsc-timeseries-ytick').map((el) => el.textContent);
    expect(yTicks).toEqual(['0', '1']);
    // The table fallback still carries the zero rows.
    const rows = within(screen.getByTestId('gsc-timeseries-table')).getAllByRole('row');
    expect(rows).toHaveLength(4);
  });

  it('opens on impressions when there are no clicks but there are impressions, and names the empty metric', async () => {
    const user = userEvent.setup();
    renderChart(
      dayPoints([0, 0]).map((p, i) => ({ ...p, impressions: i === 1 ? 4 : 0 })),
    );
    // Impressions are visible straight away, not hidden behind an empty clicks chart.
    expect(screen.queryByTestId('gsc-timeseries-no-activity')).toBeNull();
    expect(screen.getByRole('button', { name: 'Impressions' })).toHaveAttribute('aria-pressed', 'true');
    // Clicks stay selectable, and their empty state says it is about clicks.
    await user.click(screen.getByRole('button', { name: 'Clicks' }));
    expect(screen.getByTestId('gsc-timeseries-no-activity')).toHaveTextContent('No clicks in this period.');
    // The viewer's choice sticks: it is not reset by the default.
    expect(screen.getByRole('button', { name: 'Clicks' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Impressions' }));
    expect(screen.queryByTestId('gsc-timeseries-no-activity')).toBeNull();
  });

  it('names an empty impressions series as impressions', async () => {
    const user = userEvent.setup();
    renderChart(dayPoints([3, 4]).map((p) => ({ ...p, impressions: 0 })));
    await user.click(screen.getByRole('button', { name: 'Impressions' }));
    expect(screen.getByTestId('gsc-timeseries-no-activity')).toHaveTextContent('No impressions in this period.');
  });

  it('draws at the measured pixel width, so labels keep their size, with a readable minimum', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    rect.mockReturnValue({ width: 420 } as DOMRect);
    const first = renderChart(dayPoints([5, 8, 12]));
    const svg = screen.getByTestId('gsc-timeseries-svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 420 200');
    expect(svg).toHaveAttribute('width', '420');
    first.unmount();
    rect.mockReturnValue({ width: 90 } as DOMRect);
    renderChart(dayPoints([5, 8, 12]));
    expect(screen.getByTestId('gsc-timeseries-svg')).toHaveAttribute('width', '280');
    rect.mockRestore();
  });

  it('the tooltip grows inward at the edges and opens below a point near the top', () => {
    renderChart(dayPoints([5, 8, 15]));
    const hits = screen.getAllByTestId('gsc-timeseries-hit');
    fireEvent.pointerEnter(hits[0]!);
    expect(screen.getByTestId('gsc-timeseries-tooltip')).toHaveAttribute('data-placement', 'above-start');
    fireEvent.pointerEnter(hits[1]!);
    expect(screen.getByTestId('gsc-timeseries-tooltip')).toHaveAttribute('data-placement', 'above-center');
    // The highest value sits at the top-right: open below, grow leftwards.
    fireEvent.pointerEnter(hits[2]!);
    expect(screen.getByTestId('gsc-timeseries-tooltip')).toHaveAttribute('data-placement', 'below-end');
  });

  it('a single day still renders an axis and one point', () => {
    renderChart(dayPoints([7]));
    expect(screen.getAllByTestId('gsc-timeseries-point')).toHaveLength(1);
    expect(screen.getAllByTestId('gsc-timeseries-xtick')).toHaveLength(1);
  });
});
