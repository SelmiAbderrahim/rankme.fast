import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import { NotFoundRoute } from './NotFoundRoute';

const session = vi.hoisted(() => ({
  current: { authenticated: false, isPending: false } as { authenticated: boolean; isPending: boolean },
}));

vi.mock('@features/auth', () => ({
  useAuthSession: () => session.current,
  SessionPending: () => <p>session-pending</p>,
  RequirePasswordCurrent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock('./PublicLayout', () => ({
  PublicLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="public-shell">{children}</div>
  ),
}));

const renderRoute = () => {
  const router = createMemoryRouter([{ path: '*', element: <NotFoundRoute /> }], {
    initialEntries: ['/nope'],
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
};

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  session.current = { authenticated: false, isPending: false };
});

afterEach(() => {
  delete window.__SSR__;
});

describe('NotFoundRoute', () => {
  it('renders the 404 inside the authenticated app shell for a signed-in user', () => {
    session.current = { authenticated: true, isPending: false };
    renderRoute();
    expect(screen.getByTestId('app-shell')).toHaveTextContent('Page not found');
    expect(screen.queryByTestId('public-shell')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeInTheDocument();
  });

  it('keeps the public shell for a signed-out visitor', () => {
    renderRoute();
    expect(screen.getByTestId('public-shell')).toHaveTextContent('Page not found');
    expect(screen.queryByTestId('app-shell')).toBeNull();
  });

  it('waits for the session instead of flashing signed-out chrome on a client-only render', () => {
    session.current = { authenticated: false, isPending: true };
    renderRoute();
    expect(screen.getByText('session-pending')).toBeInTheDocument();
    expect(screen.queryByTestId('public-shell')).toBeNull();
  });

  it('matches the server-rendered public markup while hydrating, then swaps to the app shell', () => {
    window.__SSR__ = true;
    session.current = { authenticated: false, isPending: true };
    const { unmount } = renderRoute();
    expect(screen.getByTestId('public-shell')).toBeInTheDocument();
    unmount();

    session.current = { authenticated: true, isPending: false };
    renderRoute();
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  });
});
