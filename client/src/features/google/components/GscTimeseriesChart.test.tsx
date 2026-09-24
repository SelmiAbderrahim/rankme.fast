/**
 * GscTimeseriesChart tests — svg + sr-only table, the clicks/impressions metric
 * toggle (pointer + keyboard), and the empty state.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('GscTimeseriesChart', () => {
  it('renders an accessible svg plus a visually-hidden table with one row per point', () => {
    renderChart(points);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toBe('Daily Clicks for the last 28 days');
    const table = screen.getByTestId('gsc-timeseries-table');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(points.length);
    // Each point's clicks/impressions land in the table.
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('111')).toBeInTheDocument();
  });

  it('toggles the charted metric, flipping aria-pressed and the aria-label', async () => {
    const user = userEvent.setup();
    renderChart(points);
    const clicksBtn = screen.getByRole('button', { name: 'Clicks' });
    const impressionsBtn = screen.getByRole('button', { name: 'Impressions' });

    expect(clicksBtn).toHaveAttribute('aria-pressed', 'true');
    expect(impressionsBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Daily Clicks for the last 28 days',
    );

    await user.click(impressionsBtn);
    expect(impressionsBtn).toHaveAttribute('aria-pressed', 'true');
    expect(clicksBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
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
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Daily Impressions for the last 28 days',
    );
  });

  it('interpolates the days prop into the chart label (7-day range)', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <GscTimeseriesChart points={points} days={7} />
      </I18nextProvider>,
    );
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Daily Clicks for the last 7 days',
    );
  });

  it('renders the empty label (no svg) when there are no points', () => {
    renderChart([]);
    expect(screen.getByTestId('gsc-timeseries-empty')).toHaveTextContent(
      'No daily data yet.',
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gsc-timeseries-svg')).not.toBeInTheDocument();
  });

  it('renders under Arabic locale', async () => {
    await changeLanguage('ar');
    renderChart(points);
    expect(screen.getByRole('img')).toBeInTheDocument();
    await changeLanguage('en');
  });
});
