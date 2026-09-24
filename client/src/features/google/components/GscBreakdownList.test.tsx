/**
 * GscBreakdownList tests — labels + `value · rate`, the proportion bar
 * (guarded when the total is zero), the empty state, and progressbar ARIA.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { GscBreakdownList, type GscBreakdownRow } from './GscBreakdownList';

const rows: GscBreakdownRow[] = [
  { id: 'usa', label: 'USA', value: 70, rate: 0.1 },
  { id: 'fra', label: 'FRA', value: 20, rate: 0.05 },
];

const renderList = (props: Partial<Parameters<typeof GscBreakdownList>[0]> = {}) =>
  render(
    <I18nextProvider i18n={i18n}>
      <GscBreakdownList
        testId="breakdown"
        title="Top countries"
        caption="Clicks by country"
        keyHeader="Country"
        valueHeader="Clicks · CTR"
        emptyLabel="No country data yet."
        rows={rows}
        total={100}
        {...props}
      />
    </I18nextProvider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('GscBreakdownList', () => {
  it('renders each row with its label and combined value · rate cell', () => {
    renderList();
    expect(screen.getByText('USA')).toBeInTheDocument();
    expect(screen.getByText('FRA')).toBeInTheDocument();
    expect(screen.getByText('70 · 10%')).toBeInTheDocument();
    expect(screen.getByText('20 · 5%')).toBeInTheDocument();
  });

  it('renders the sr-only value-column header passed by the caller', () => {
    renderList();
    expect(
      screen.getByRole('columnheader', { name: 'Clicks · CTR' }),
    ).toBeInTheDocument();
  });

  it('sizes the proportion bar by share of the total', () => {
    renderList();
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute('aria-valuenow', '70');
    expect(bars[0]).toHaveAttribute('aria-valuemin', '0');
    expect(bars[0]).toHaveAttribute('aria-valuemax', '100');
    // The inner fill span carries the proportional width.
    expect((bars[0]?.firstElementChild as HTMLElement | null)?.style.width).toBe('70%');
    expect(bars[1]).toHaveAttribute('aria-valuenow', '20');
  });

  it('guards against divide-by-zero — a zero total renders 0% bars', () => {
    renderList({ total: 0 });
    const bars = screen.getAllByRole('progressbar');
    expect(bars[0]).toHaveAttribute('aria-valuenow', '0');
    expect((bars[0]?.firstElementChild as HTMLElement | null)?.style.width).toBe('0%');
  });

  it('renders the empty label and no table when rows are empty', () => {
    renderList({ rows: [] });
    expect(screen.getByTestId('breakdown-empty')).toHaveTextContent(
      'No country data yet.',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
