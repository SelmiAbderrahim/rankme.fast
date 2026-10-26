import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScrollArea } from './scroll-area';

describe('ScrollArea', () => {
  it('forwards viewport props so a content-only region can be reached by keyboard', () => {
    render(
      <ScrollArea viewportProps={{ tabIndex: 0, 'aria-label': 'Results' }}>
        <p>Plain text</p>
      </ScrollArea>,
    );
    expect(screen.getByLabelText('Results')).toHaveAttribute('data-slot', 'scroll-area-viewport');
    expect(screen.getByLabelText('Results')).toHaveAttribute('tabindex', '0');
  });

  it('renders without viewport props', () => {
    render(
      <ScrollArea>
        <p>Plain text</p>
      </ScrollArea>,
    );
    expect(screen.getByText('Plain text')).toBeInTheDocument();
  });
});
