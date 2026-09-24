import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useTabParam } from './useTabParam';

const TABS = ['general', 'members', 'security'] as const;
type Tab = (typeof TABS)[number];

const Harness = () => {
  const [tab, setTab] = useTabParam<Tab>('general', TABS);
  return (
    <div>
      <span data-testid="tab">{tab}</span>
      <button onClick={() => setTab('members')}>go-members</button>
      <button onClick={() => setTab('security')}>go-security</button>
    </div>
  );
};

const LocationProbe = () => {
  const loc = useLocation();
  return <span data-testid="search">{loc.search}</span>;
};

const NoValidHarness = () => {
  const [tab, setTab] = useTabParam<string>('general');
  return (
    <div>
      <span data-testid="tab-anything">{tab}</span>
      <button onClick={() => setTab('anything')}>go</button>
    </div>
  );
};

const CustomParamHarness = () => {
  const [tab, setTab] = useTabParam<Tab>('general', TABS, 'bucket');
  return (
    <div>
      <span data-testid="tab-custom">{tab}</span>
      <button onClick={() => setTab('members')}>set-members</button>
    </div>
  );
};

const renderAt = (search: string, Comp: React.ComponentType = Harness) =>
  render(
    <MemoryRouter initialEntries={[`/x${search}`]}>
      <Routes>
        <Route
          path="/x"
          element={
            <>
              <Comp />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

describe('useTabParam', () => {
  it('falls back to default when ?tab= is missing', () => {
    renderAt('');
    expect(screen.getByTestId('tab').textContent).toBe('general');
  });

  it('reads the active tab from ?tab=', () => {
    renderAt('?tab=members');
    expect(screen.getByTestId('tab').textContent).toBe('members');
  });

  it('normalizes an invalid value to the default and preserves unrelated params', async () => {
    renderAt('?tab=nope&utm=sweep');
    expect(screen.getByTestId('tab').textContent).toBe('general');
    await waitFor(() =>
      expect(screen.getByTestId('search').textContent).toBe('?tab=general&utm=sweep'),
    );
  });

  it('setTab writes ?tab= into the URL', () => {
    renderAt('');
    act(() => {
      screen.getByText('go-members').click();
    });
    expect(screen.getByTestId('search').textContent).toBe('?tab=members');
    expect(screen.getByTestId('tab').textContent).toBe('members');
  });

  it('preserves any raw string when validTabs is not provided', () => {
    renderAt('?tab=anything', NoValidHarness);
    expect(screen.getByTestId('tab-anything').textContent).toBe('anything');
  });

  it('setTab writes when no validTabs list is supplied', () => {
    renderAt('', NoValidHarness);
    act(() => {
      screen.getByText('go').click();
    });
    expect(screen.getByTestId('tab-anything').textContent).toBe('anything');
    expect(screen.getByTestId('search').textContent).toBe('?tab=anything');
  });

  it('uses a custom param name when provided', () => {
    renderAt('?bucket=members', CustomParamHarness);
    expect(screen.getByTestId('tab-custom').textContent).toBe('members');
  });

  it('setTab writes into the custom param name', () => {
    renderAt('', CustomParamHarness);
    act(() => {
      screen.getByText('set-members').click();
    });
    expect(screen.getByTestId('search').textContent).toBe('?bucket=members');
    expect(screen.getByTestId('tab-custom').textContent).toBe('members');
  });
});
