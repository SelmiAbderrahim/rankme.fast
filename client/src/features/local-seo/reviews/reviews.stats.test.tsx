/**
 * Stats cards + the average-rating trend chart.
 *
 * The chart is decorative on its own — the accessible data table is the real
 * surface, so it is asserted for keyboard reach and for the gap-month rule
 * (`null` renders as "No data", never as zero stars).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ReviewStatsCards, shareOf } from './components/ReviewStatsCards';
import { ReviewTrendChart, trendSegments } from './components/ReviewTrendChart';
import { reviewStats } from './__fixtures__/reviews';

const renderNode = (node: ReactNode) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nextProvider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('review stats cards', () => {
  it('renders the histogram, velocity KPI and source mix from the server numbers', () => {
    renderNode(<ReviewStatsCards stats={reviewStats()} status="succeeded" error="" />);
    expect(screen.getByTestId('reviews-histogram-5')).toHaveTextContent('5 stars');
    expect(screen.getByTestId('reviews-histogram-unrated')).toHaveTextContent('No rating');
    expect(screen.getByTestId('reviews-velocity')).toHaveTextContent('In 2026-06');
    expect(screen.getByTestId('reviews-velocity')).toHaveTextContent('Average 1.3 a month');
    expect(screen.getByTestId('reviews-source-mix-google')).toHaveTextContent('3 · 75%');
    expect(screen.getByTestId('reviews-source-mix-tripadvisor')).toHaveTextContent('0 · 0%');
  });

  it('says nothing to chart rather than drawing an empty histogram', () => {
    renderNode(
      <ReviewStatsCards
        stats={reviewStats({
          totalReviews: 0,
          ratingHistogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unrated: 0 },
          monthlyVelocity: [],
          averageRatingTrend: [],
          sourceMix: { google: 0, trustpilot: 0, tripadvisor: 0, total: 0 },
        })}
        status="succeeded"
        error=""
      />,
    );
    expect(screen.getByTestId('reviews-stats-empty')).toHaveTextContent('Nothing to chart yet.');
    expect(screen.getByTestId('reviews-velocity')).toHaveTextContent('Nothing to chart yet.');
  });

  it('shows a skeleton, an error, then nothing at all', () => {
    const { rerender, container } = renderNode(
      <ReviewStatsCards stats={null} status="loading" error="" />,
    );
    expect(screen.getByTestId('reviews-stats-loading')).toHaveAttribute('aria-busy', 'true');
    const wrap = (node: ReactNode) => (
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{node}</MemoryRouter>
      </I18nextProvider>
    );
    rerender(wrap(<ReviewStatsCards stats={null} status="failed" error="Stats are down." />));
    expect(screen.getByTestId('reviews-stats-error')).toHaveTextContent('Stats are down.');
    rerender(wrap(<ReviewStatsCards stats={null} status="idle" error="" />));
    expect(container).toBeEmptyDOMElement();
  });

  it('never divides by zero', () => {
    expect(shareOf(3, 0)).toBe(0);
    expect(shareOf(1, 4)).toBe(25);
  });
});

describe('average-rating trend chart', () => {
  it('splits the line at gap months instead of dropping to zero', () => {
    const segments = trendSegments([4.5, null, 3], (index, value) => ({ x: index, y: value }));
    expect(segments).toEqual([[{ x: 0, y: 4.5 }], [{ x: 2, y: 3 }]]);
  });

  it('keeps contiguous points in one segment', () => {
    const segments = trendSegments([1, 2, null], (index, value) => ({ x: index, y: value }));
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(2);
  });

  it('renders the chart with an accessible label and a keyboard-reachable table', async () => {
    const user = userEvent.setup();
    renderNode(<ReviewTrendChart buckets={reviewStats().averageRatingTrend} />);
    expect(screen.getByRole('img', { name: 'Average star rating per month' })).toBeVisible();

    const fallback = screen.getByTestId('reviews-trend-table-fallback');
    const summary = within(fallback).getByText('Read as a table');
    await user.click(summary);

    const table = within(fallback).getByRole('table');
    expect(within(table).getByText('2026-04')).toBeVisible();
    // The gap month reads as "No data" in every series column.
    const gapRow = within(table).getByText('2026-05').closest('tr');
    expect(gapRow).not.toBeNull();
    expect(within(gapRow as HTMLElement).getAllByText('No data')).toHaveLength(4);
    // April: total 4.5 and Google 4.5 — both series render the same value.
    expect(within(table).getAllByText('4.5')).toHaveLength(2);
  });

  it('renders an honest empty state when there is no dated review', () => {
    renderNode(<ReviewTrendChart buckets={[]} />);
    expect(screen.getByTestId('reviews-trend-empty')).toHaveTextContent(
      'No dated reviews yet.',
    );
    expect(screen.queryByTestId('reviews-trend-chart')).not.toBeInTheDocument();
  });

  it('mirrors the x axis in Arabic while the table keeps chronological order', async () => {
    await changeLanguage('ar');
    renderNode(<ReviewTrendChart buckets={reviewStats().averageRatingTrend} />);
    expect(screen.getByTestId('reviews-trend-chart')).toHaveAttribute('data-rtl', 'true');
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((row) => (row as HTMLTableRowElement).cells[0]?.textContent)).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
    await changeLanguage('en');
  });
});
