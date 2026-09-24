import { describe, expect, it } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useContentView, CONTENT_SUB_VIEWS, isContentSubView } from './tabState';

function Harness() {
  const [view, setView] = useContentView();
  const location = useLocation();
  return (
    <div>
      <p data-testid="view">{view}</p>
      <p data-testid="search">{location.search}</p>
      <button onClick={() => setView('inventory')}>set-inventory</button>
      <button onClick={() => setView('competitors')}>set-competitors</button>
      <button onClick={() => setView(null)}>clear</button>
    </div>
  );
}

describe('useContentView', () => {
  it('defaults to analyses when absent', () => {
    render(
      <MemoryRouter initialEntries={['/sites/s?tab=content']}>
        <Routes>
          <Route path="/sites/:id" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('view').textContent).toBe('analyses');
  });

  it('canonically replaces an invalid value without reflecting it', async () => {
    render(
      <MemoryRouter initialEntries={['/sites/s?tab=content&view=bogus']}>
        <Routes>
          <Route path="/sites/:id" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('view').textContent).toBe('analyses');
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('view=analyses'));
    expect(document.body.innerHTML).not.toContain('<script>');
  });

  it('setView writes and clearing removes param while keeping tab', () => {
    render(
      <MemoryRouter initialEntries={['/sites/s?tab=content']}>
        <Routes>
          <Route path="/sites/:id" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    );
    act(() => {
      screen.getByText('set-inventory').click();
    });
    expect(screen.getByTestId('view').textContent).toBe('inventory');
    expect(screen.getByTestId('search').textContent).toContain('view=inventory');
    expect(screen.getByTestId('search').textContent).toContain('tab=content');
    act(() => {
      screen.getByText('set-competitors').click();
    });
    expect(screen.getByTestId('view').textContent).toBe('competitors');
    act(() => {
      screen.getByText('clear').click();
    });
    expect(screen.getByTestId('view').textContent).toBe('analyses');
    expect(screen.getByTestId('search').textContent).not.toContain('view=');
  });

  it('exports helpers', () => {
    expect(CONTENT_SUB_VIEWS).toHaveLength(5);
    expect(isContentSubView('inventory')).toBe(true);
    expect(isContentSubView('briefs')).toBe(true);
    expect(isContentSubView('nope')).toBe(false);
  });
});
