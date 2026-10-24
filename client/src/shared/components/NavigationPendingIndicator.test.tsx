import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '@shared/i18n';
import { NavigationPendingIndicator } from './NavigationPendingIndicator';

beforeEach(() => { initI18n({ initialLocale: 'en' }); });

describe('navigation progress', () => {
  it('announces a pending route load and clears when the destination renders', async () => {
    let finish!: () => void;
    const loading = new Promise<void>((resolve) => { finish = resolve; });
    const router = createMemoryRouter([{
      element: <><NavigationPendingIndicator /><Outlet /></>,
      children: [
        { path: '/', element: <p>Dashboard content</p> },
        { path: '/report', loader: async () => { await loading; return null; }, element: <p>Report content</p> },
      ],
    }]);
    render(<RouterProvider router={router} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    let navigation!: Promise<void>;
    act(() => { navigation = router.navigate('/report'); });
    expect(screen.getByRole('status')).toHaveTextContent('Loading page…');
    expect(screen.getByText('Dashboard content')).toBeInTheDocument();
    await act(async () => { finish(); await navigation; });
    expect(screen.getByText('Report content')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    router.dispose();
  });

  it('stays idle in a declarative router', () => {
    render(<MemoryRouter><NavigationPendingIndicator /></MemoryRouter>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
