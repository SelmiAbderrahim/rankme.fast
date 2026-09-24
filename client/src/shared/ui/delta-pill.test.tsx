import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeltaPill } from './delta-pill';

describe('DeltaPill', () => {
  it('colors a positive change good when higher is better (default)', () => {
    render(<DeltaPill value={12} data-testid="d" />);
    const pill = screen.getByTestId('d');
    expect(pill).toHaveTextContent('+12');
    expect(pill).toHaveAttribute('data-good', 'yes');
    expect(pill).toHaveClass('text-success');
  });

  it('colors a negative change bad when higher is better', () => {
    render(<DeltaPill value={-3} data-testid="d" />);
    const pill = screen.getByTestId('d');
    expect(pill).toHaveTextContent('-3');
    expect(pill).toHaveAttribute('data-good', 'no');
    expect(pill).toHaveClass('text-destructive');
  });

  it('inverts goodness when lower is better (rank position)', () => {
    render(<DeltaPill value={-2} goodDirection="down" data-testid="d" />);
    const pill = screen.getByTestId('d');
    expect(pill).toHaveAttribute('data-good', 'yes');
    expect(pill).toHaveClass('text-success');
  });

  it('renders zero as neutral', () => {
    render(<DeltaPill value={0} data-testid="d" />);
    const pill = screen.getByTestId('d');
    expect(pill).toHaveAttribute('data-good', 'neutral');
    expect(pill).toHaveClass('text-muted-foreground');
  });

  it('renders null as an em-dash, neutral', () => {
    render(<DeltaPill value={null} data-testid="d" />);
    const pill = screen.getByTestId('d');
    expect(pill).toHaveTextContent('—');
    expect(pill).toHaveAttribute('data-good', 'neutral');
  });

  it('uses a custom formatter for the magnitude', () => {
    render(
      <DeltaPill value={1500} format={(n) => `${n / 1000}k`} data-testid="d" />,
    );
    expect(screen.getByTestId('d')).toHaveTextContent('+1.5k');
  });
});
