import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { changeLanguage, initI18n } from '@shared/i18n';
import { PositionDelta, type PositionChangeValue } from './PositionDelta';

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

const change = (direction: PositionChangeValue['direction'], positionDelta: number | null): PositionChangeValue => ({ currentPosition: 2, previousPosition: 4, positionDelta, direction, window: { range: '7d', comparison: 'previous_sync' } });

describe('position movement', () => {
  it.each([[3, 'improved', 'Improved by 3 positions'], [-3, 'declined', 'Declined by 3 positions'], [0.01, 'unchanged', 'No change in position'], [null, 'new', 'No previous data'], [undefined, 'new', 'No previous data']] as const)('interprets legacy movement %s consistently', (fallbackDelta, direction, label) => {
    render(<PositionDelta fallbackDelta={fallbackDelta} testId="delta" />);
    expect(screen.getByTestId('delta')).toHaveAttribute('data-direction', direction);
    expect(screen.getByTestId('delta')).toHaveTextContent(label);
  });

  it('prefers the explicit position contract and explains its comparison window', () => {
    const { rerender } = render(<PositionDelta change={change('improved', -2)} fallbackDelta={-50} testId="delta" variant="full" className="font-bold" />);
    expect(screen.getByTestId('delta')).toHaveAttribute('data-direction', 'improved');
    expect(screen.getByTestId('delta')).toHaveClass('text-success', 'font-bold');
    expect(screen.getByTestId('delta')).toHaveAttribute('title', expect.stringContaining('last 7 days'));
    expect(screen.getByTestId('delta').querySelector('.sr-only')).toHaveTextContent('Improved by 2 positions');
    rerender(<PositionDelta change={change('declined', 2)} testId="delta" />);
    expect(screen.getByTestId('delta')).toHaveClass('text-destructive');
    expect(screen.getByTestId('delta').querySelector('bdi')).toHaveTextContent('2');
    rerender(<PositionDelta change={change('unchanged', 0.01)} testId="delta" />);
    expect(screen.getByTestId('delta')).toHaveAttribute('data-direction', 'unchanged');
  });

  it.each([['entered', 'Entered the rankings'], ['dropped', 'Dropped out of the rankings'], ['unranked', 'Not ranked in either check'], ['new', 'No previous data']] as const)('preserves the %s classification without a numeric comparison', (kind, label) => {
    render(<PositionDelta change={change(null, null)} movement={{ kind, amount: null }} testId="delta" />);
    expect(screen.getByTestId('delta')).toHaveAttribute('data-direction', kind);
    expect(screen.getByTestId('delta')).toHaveTextContent(label);
  });

  it('never invents a numeric comparison when earlier position data is missing', () => {
    const { rerender } = render(<PositionDelta change={change(null, null)} movement={{ kind: 'improved', amount: 5 }} testId="delta" />);
    expect(screen.getByTestId('delta')).toHaveAttribute('data-direction', 'new');
    rerender(<PositionDelta change={change('improved', null)} testId="delta" />);
    expect(screen.getByTestId('delta')).toHaveTextContent('No previous data');
    rerender(<PositionDelta movement={{ kind: 'declined', amount: 1 }} testId="delta" />);
    expect(screen.getByTestId('delta')).toHaveTextContent('Declined by 1 position');
    expect(screen.getByTestId('delta')).toHaveAttribute('title', expect.stringContaining('latest check'));
  });

  it('formats Arabic movement with an isolated number and translated plural copy', async () => {
    await changeLanguage('ar');
    render(<PositionDelta fallbackDelta={2} testId="delta" />);
    expect(screen.getByTestId('delta').querySelector('bdi')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTestId('delta').querySelector('bdi')).toHaveTextContent(new Intl.NumberFormat('ar').format(2));
    expect(screen.getByTestId('delta').querySelector('.sr-only')?.textContent).not.toContain('positionDelta');
  });
});
