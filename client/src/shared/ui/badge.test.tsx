import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './badge';

describe('Badge', () => {
  it('uses the strong control border for its outline variant', () => {
    render(<Badge variant="outline">Queued</Badge>);
    expect(screen.getByText('Queued')).toHaveClass('border-input');
  });

  it('pairs destructive fill with its semantic foreground', () => {
    render(<Badge variant="destructive">Failed</Badge>);
    expect(screen.getByText('Failed')).toHaveClass(
      'bg-destructive',
      'text-destructive-foreground',
    );
  });
});
