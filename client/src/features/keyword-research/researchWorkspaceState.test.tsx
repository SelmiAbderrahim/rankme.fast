import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResearchWorkspaceStateProvider, useResearchWorkspaceState } from './researchWorkspaceState';

const Consumer = () => {
  const state = useResearchWorkspaceState();
  if (!state) return null;
  return (
    <>
      <output data-testid="chips">{state.chips.join('|')}</output>
      <button type="button" onClick={() => state.setChips((current) => [...current, 'fourth'])}>add</button>
    </>
  );
};

const Switcher = () => {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setVisible((current) => !current)}>switch</button>
      {visible ? <Consumer /> : <span data-testid="other-tab">other tab</span>}
    </>
  );
};

describe('research workspace chip state', () => {
  it('keeps selected chips when the research tab unmounts and remounts', () => {
    render(
      <ResearchWorkspaceStateProvider initialChips={['one', 'two', 'three']}>
        <Switcher />
      </ResearchWorkspaceStateProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'add' }));
    expect(screen.getByTestId('chips')).toHaveTextContent('one|two|three|fourth');
    fireEvent.click(screen.getByRole('button', { name: 'switch' }));
    fireEvent.click(screen.getByRole('button', { name: 'switch' }));
    expect(screen.getByTestId('chips')).toHaveTextContent('one|two|three|fourth');
  });

  it('renders nothing for a consumer outside the workspace', () => {
    render(<Consumer />);
    expect(screen.queryByTestId('chips')).toBeNull();
  });
});
