import { render, screen } from '@testing-library/react';
import { FileText } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { StatCard } from './stat-card';

describe('StatCard', () => {
  it('chip variant renders a soft-tint card with value, label and icon', () => {
    render(
      <StatCard
        variant="chip"
        tone="success"
        label="Fix now"
        value="12"
        icon={FileText}
        data-testid="c"
      />,
    );
    const card = screen.getByTestId('c');
    expect(card).toHaveAttribute('data-variant', 'chip');
    expect(card).toHaveClass('bg-success/10');
    expect(card).toHaveTextContent('12');
    expect(card).toHaveTextContent('Fix now');
    expect(card.querySelector('svg')).not.toBeNull();
  });

  it('chip variant defaults to muted and omits the icon', () => {
    render(<StatCard variant="chip" label="None" value="0" data-testid="c" />);
    const card = screen.getByTestId('c');
    expect(card).toHaveClass('bg-muted');
    expect(card.querySelector('svg')).toBeNull();
  });

  it('meter variant renders a clamped cap-meter progressbar', () => {
    render(
      <StatCard
        variant="meter"
        label="Audits"
        value="8 / 10"
        tone="warning"
        icon={FileText}
        progress={1.4}
        progressLabel="80%"
        data-testid="c"
      />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByTestId('c')).toHaveTextContent('80%');
  });

  it('meter variant clamps negative progress to zero', () => {
    render(
      <StatCard variant="meter" label="X" value="0" progress={-1} data-testid="c" />,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'X');
  });

  it('kpi variant renders value, delta pill, context, chart and action', () => {
    render(
      <StatCard
        variant="kpi"
        label="Avg position"
        value="4.2"
        delta={{ value: -1, goodDirection: 'down' }}
        context="than last month"
        chart={<div data-testid="spark" />}
        action={<button type="button">See report</button>}
        data-testid="c"
      />,
    );
    const card = screen.getByTestId('c');
    expect(card).toHaveAttribute('data-variant', 'kpi');
    expect(card).toHaveTextContent('4.2');
    expect(card).toHaveTextContent('than last month');
    expect(screen.getByTestId('spark')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'See report' })).not.toBeNull();
    expect(card.querySelector('[data-slot="delta-pill"][data-good="yes"]')).not.toBeNull();
  });

  it('kpi variant renders bare without optional slots', () => {
    render(<StatCard variant="kpi" label="Score" value="90" data-testid="c" />);
    const card = screen.getByTestId('c');
    expect(card).toHaveTextContent('90');
    expect(card.querySelector('[data-slot="delta-pill"]')).toBeNull();
  });
});
