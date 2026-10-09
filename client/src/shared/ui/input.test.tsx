import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from './input';

describe('Input direction', () => {
  it.each(['url', 'email'] as const)('pins type=%s to left-to-right', (type) => {
    render(<Input type={type} aria-label={type} />);
    expect(screen.getByLabelText(type)).toHaveAttribute('dir', 'ltr');
  });

  it('leaves other types to the page direction', () => {
    render(<Input type="text" aria-label="plain" />);
    expect(screen.getByLabelText('plain')).not.toHaveAttribute('dir');
  });

  it('lets a caller override the direction', () => {
    render(<Input type="url" dir="auto" aria-label="override" />);
    expect(screen.getByLabelText('override')).toHaveAttribute('dir', 'auto');
  });
});
