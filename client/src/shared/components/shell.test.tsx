import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TooltipProvider } from '@shared/ui/tooltip';
import { ThemeProvider } from '@shared/theme/ThemeProvider';
import { i18n, initI18n } from '@shared/i18n';
import { sitesReducer } from '@features/sites';
import { Header } from './Header';
import { Footer } from './Footer';
import { appVersion } from '@shared/config/version';
import { releaseStage } from '@shared/config/release';
import { AppLayout } from './AppLayout';
import { useAuthSession, type AuthSessionState } from '@features/auth';
import { routes, appShellRoutes } from '@app/routes';

vi.mock('@features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/auth')>()),
  useAuthSession: vi.fn(),
}));

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
});

// AppLayout renders AppBreadcrumbs, which reads `state.sites` — the sites
// reducer is static in the real store, so the harness must carry it too.
const store = configureStore({
  reducer: { sites: sitesReducer },
});

const Shell = ({ children }: { children: React.ReactNode }) => (
  <Provider store={store}>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </ThemeProvider>
    </I18nextProvider>
  </Provider>
);

const mockSession = (authenticated: boolean) => {
  vi.mocked(useAuthSession).mockReturnValue({
    authenticated,
    isPending: false,
    emailVerified: authenticated,
    user: null,
  } satisfies AuthSessionState);
};

const renderWithAuth = (ui: React.ReactNode, authenticated: boolean) => {
  mockSession(authenticated);
  return render(
    <MemoryRouter>
      <Shell>{ui}</Shell>
    </MemoryRouter>,
  );
};

describe('Header', () => {
  it('shows the product nav for an authenticated user', () => {
    renderWithAuth(<Header />, true);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Guides' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Logout' })).toBeInTheDocument();
  });

  it('shows login/register for an anonymous visitor', () => {
    renderWithAuth(<Header />, false);
    expect(screen.getByRole('link', { name: 'Login' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Register' })).toBeInTheDocument();
  });

  it('opens the mobile menu and closes it when a link is tapped', async () => {
    const user = userEvent.setup();
    renderWithAuth(<Header />, true);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    // Mobile nav renders the same links; tapping one fires the close handler.
    const dashboardLinks = await screen.findAllByRole('link', {
      name: 'Dashboard',
    });
    await user.click(dashboardLinks[dashboardLinks.length - 1]!);
  });

  it('authed marketing mobile menu fires the auth-action close handlers', async () => {
    const user = userEvent.setup();
    renderWithAuth(<Header variant="marketing" />, true);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    // Mobile auth-action Dashboard button (last Dashboard link is in the sheet).
    const dash = await screen.findAllByRole('link', { name: 'Dashboard' });
    await user.click(dash[dash.length - 1]!);
    // Re-open and tap the Logout auth-action to fire its close handler.
    await user.click(screen.getByRole('button', { name: /menu/i }));
    const logout = await screen.findAllByRole('link', { name: /log\s?out/i });
    await user.click(logout[logout.length - 1]!);
  });

  it('anon marketing mobile menu fires the CTA close handler', async () => {
    const user = userEvent.setup();
    renderWithAuth(<Header variant="marketing" />, false);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    const register = await screen.findAllByRole('link', { name: 'Register' });
    await user.click(register[register.length - 1]!);
  });
});

describe('Footer', () => {
  it('renders the authenticated link set + copyright', () => {
    renderWithAuth(<Footer />, true);
    expect(screen.getByText(`v${appVersion} · ${releaseStage()}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText(/All Rights Reserved/)).toBeInTheDocument();
  });

  it('renders the anonymous link set', () => {
    renderWithAuth(<Footer />, false);
    expect(screen.getByRole('link', { name: 'Register' })).toBeInTheDocument();
  });

});

describe('AppLayout', () => {
  it('renders header, footer, and the routed outlet', () => {
    mockSession(false);
    render(
      <MemoryRouter initialEntries={['/x']}>
        <Shell>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/x" element={<div>OUTLET</div>} />
            </Route>
          </Routes>
        </Shell>
      </MemoryRouter>,
    );
    expect(screen.getByText('OUTLET')).toBeInTheDocument();
    expect(screen.getByText(/All Rights Reserved/)).toBeInTheDocument();
  });
});

describe('route tree', () => {
  it('composes marketing + app-shell routes', () => {
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
    expect(appShellRoutes[0]?.children?.length).toBeGreaterThan(0);
  });
});
