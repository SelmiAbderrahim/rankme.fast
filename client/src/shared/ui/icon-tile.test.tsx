import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { IconTile } from './icon-tile';

describe('IconTile', () => {
  it('renders the icon in a soft-tinted tile with the chosen tone', () => {
    render(<IconTile icon={Activity} tone="warning" data-testid="tile" />);
    const tile = screen.getByTestId('tile');
    expect(tile).toHaveAttribute('data-tone', 'warning');
    expect(tile).toHaveClass('bg-warning/10', 'text-warning');
    expect(tile.querySelector('svg')).not.toBeNull();
  });

  it('defaults to muted tone and md size', () => {
    render(<IconTile icon={Activity} data-testid="tile" />);
    const tile = screen.getByTestId('tile');
    expect(tile).toHaveAttribute('data-tone', 'muted');
    expect(tile).toHaveClass('size-10', 'rounded-xl');
  });

  it('supports the sm size and chart tones', () => {
    render(<IconTile icon={Activity} tone="chart-3" size="sm" data-testid="tile" />);
    const tile = screen.getByTestId('tile');
    expect(tile).toHaveClass('size-8', 'rounded-lg', 'bg-chart-3/10', 'text-chart-3');
  });
});
