import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusChip } from './status-chip';

describe('StatusChip', () => {
  it('renders localized text with a soft-tint tone', () => {
    render(<StatusChip tone="success">Completed</StatusChip>);
    const chip = screen.getByText('Completed');
    expect(chip).toHaveAttribute('data-tone', 'success');
    expect(chip).toHaveClass('bg-success/10', 'text-success', 'rounded-full');
  });

  it('defaults to the muted tone', () => {
    render(<StatusChip>None</StatusChip>);
    expect(screen.getByText('None')).toHaveAttribute('data-tone', 'muted');
  });

  it('renders a decorative dot but keeps the text (never color alone)', () => {
    render(
      <StatusChip tone="destructive" dot>
        Failed
      </StatusChip>,
    );
    const chip = screen.getByText('Failed');
    expect(chip.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(chip).toHaveTextContent('Failed');
  });

  it('omits the dot by default', () => {
    render(<StatusChip tone="info">Running</StatusChip>);
    expect(
      screen.getByText('Running').querySelector('span'),
    ).toBeNull();
  });
});
