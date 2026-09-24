import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { TooltipProvider } from '@shared/ui/tooltip';
import { ThemeProvider } from '@shared/theme/ThemeProvider';
import { i18n, initI18n } from '@shared/i18n';
import { useAuthSession, type AuthSessionState } from '@features/auth';
import { workspaceInitialState, workspaceReducer, type WorkspaceState } from '@features/workspace';

// Stub the vendored (coverage-excluded) sidebar primitive so these tests can
// drive the mobile/collapse branches of the app-shell components directly.
const sidebar = {
  isMobile: false,
  setOpenMobile: vi.fn(),
  toggleSidebar: vi.fn(),
};
vi.mock('@shared/ui/sidebar', () => ({
  useSidebar: () => sidebar,
  Sidebar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/auth')>()),
  useAuthSession: vi.fn(),
}));

// The inbox has its own integration coverage. Keep the app-shell suite focused
// on topbar layout and avoid starting its polling loop in every test case.
vi.mock('@features/team/components/InvitationInbox', () => ({
  InvitationInbox: () => <button type="button" aria-label="Team invitations" />,
}));

import { AppSidebar } from './AppSidebar';
import { AppTopbar } from './AppTopbar';
import { MinimalLayout } from './MinimalLayout';

const setSession = (over: Partial<AuthSessionState['user']> | null) => {
  vi.mocked(useAuthSession).mockReturnValue({
    authenticated: over !== null,
    isPending: false,
    emailVerified: true,
    user: over === null ? null : ({ role: 'Member', ...over } as AuthSessionState['user']),
  } satisfies AuthSessionState);
};

const makeStore = (workspace: Partial<WorkspaceState> = {}) =>
  configureStore({
    reducer: { workspace: workspaceReducer },
    preloadedState: {
      workspace: { ...workspaceInitialState, ...workspace },
    },
  });

const Wrap = ({
  children,
  entries = ['/dashboard'],
  workspace = {},
}: {
  children: React.ReactNode;
  entries?: string[];
  workspace?: Partial<WorkspaceState>;
}) => (
  <Provider store={makeStore(workspace)}>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={entries}>{children}</MemoryRouter>
        </TooltipProvider>
      </ThemeProvider>
    </I18nextProvider>
  </Provider>
);

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  sidebar.isMobile = false;
  sidebar.setOpenMobile.mockClear();
  sidebar.toggleSidebar.mockClear();
});

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('AppSidebar', () => {
  const expectLinkIcon = (name: string | RegExp, iconClass: string) => {
    const icon = screen.getByRole('link', { name }).querySelector('svg');
    expect(icon).toHaveClass(iconClass);
  };

  it('renders grouped nav and marks the active route', () => {
    setSession({ role: 'Member' });
    render(
      <Wrap>
        <AppSidebar />
      </Wrap>,
    );
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Tools')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'AI Assistant' })).toHaveAttribute(
      'href',
      '/assistant',
    );
    expect(screen.getByRole('link', { name: 'Sites' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
    expect(screen.queryByRole('link', { name: 'Guides' })).not.toBeInTheDocument();
    expectLinkIcon('Dashboard', 'lucide-layout-dashboard');
    expectLinkIcon('AI Assistant', 'lucide-bot');
    expectLinkIcon('Sites', 'lucide-earth');
    expectLinkIcon(/Keyword research/, 'lucide-search');
    expectLinkIcon('Alerts', 'lucide-bell-ring');
    expectLinkIcon('Docs', 'lucide-book-open-text');
    expectLinkIcon('Profile', 'lucide-circle-user-round');
    expect(screen.queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument();
    expectLinkIcon('Team', 'lucide-users-round');
    expectLinkIcon('Notifications', 'lucide-bell');
    expectLinkIcon('Security', 'lucide-lock-keyhole');
  });

  it('closes the mobile drawer when a nav item is tapped on mobile', async () => {
    sidebar.isMobile = true;
    setSession({ role: 'Member' });
    render(
      <Wrap>
        <AppSidebar />
      </Wrap>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'Sites' }));
    expect(sidebar.setOpenMobile).toHaveBeenCalledWith(false);
  });

  it('does not call setOpenMobile when a nav item is clicked on desktop (isMobile=false)', async () => {
    sidebar.isMobile = false;
    setSession({ role: 'Member' });
    render(
      <Wrap>
        <AppSidebar />
      </Wrap>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'Sites' }));
    expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
  });

  it('places the sidebar on the right for RTL locales', async () => {
    await i18n.changeLanguage('ar');
    setSession({ role: 'Member' });
    render(
      <Wrap>
        <AppSidebar />
      </Wrap>,
    );
    expect(screen.getByText('نظرة عامة')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'الوثائق' })).toHaveAttribute('href', '/ar/docs');
    await i18n.changeLanguage('en');
  });

  it('uses the unprefixed Docs route for an unsupported language', async () => {
    await i18n.changeLanguage('xx-unsupported');
    setSession({ role: 'Member' });
    render(
      <Wrap>
        <AppSidebar />
      </Wrap>,
    );
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
    await i18n.changeLanguage('en');
  });

});

const LocationProbe = () => {
  const location = useLocation();
  return <span data-testid="loc">{location.pathname}</span>;
};

describe('AppTopbar', () => {
  const renderTopbar = () =>
    render(
      <Wrap>
        <AppTopbar />
        <LocationProbe />
      </Wrap>,
    );

  it('toggles the sidebar from the collapse button', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(sidebar.toggleSidebar).toHaveBeenCalled();
  });

  // `<input list=…>` reports role combobox (not searchbox); the LanguageSwitcher
  // combobox is named "Language", so name:"Search" is unambiguous.
  const searchBox = () => screen.getByRole('combobox', { name: 'Search' });

  it('quick-jumps to a nav destination on an exact search match', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.type(searchBox(), 'Sites{Enter}');
    expect(screen.getByTestId('loc')).toHaveTextContent('/sites');
    await userEvent.type(searchBox(), 'Docs{Enter}');
    expect(screen.getByTestId('loc')).toHaveTextContent('/docs');
  });

  it('quick-jumps on a partial (includes) match', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.type(searchBox(), 'keyword{Enter}');
    expect(screen.getByTestId('loc')).toHaveTextContent('/keyword-research');
  });

  it('does nothing on an empty or unmatched query', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.type(searchBox(), '   {Enter}');
    expect(screen.getByTestId('loc')).toHaveTextContent('/dashboard');
    await userEvent.type(searchBox(), 'zzz{Enter}');
    expect(screen.getByTestId('loc')).toHaveTextContent('/dashboard');
  });

  it('renders avatar initials from a display name', () => {
    setSession({ name: 'Ada Lovelace', email: 'ada@example.com' });
    renderTopbar();
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('falls back to email, then to a placeholder, for initials', () => {
    setSession({ name: '', email: 'zoe@example.com' });
    const { unmount } = renderTopbar();
    expect(screen.getByText('ZO')).toBeInTheDocument();
    unmount();
    setSession({ name: '', email: '' });
    renderTopbar();
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('opens the account menu with sign-out', async () => {
    setSession({ name: 'Ada Lovelace', email: 'ada@example.com', image: 'x.png' });
    renderTopbar();
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('offers a keyboard-reachable, safe new-tab bug-report link', async () => {
    const user = userEvent.setup();
    setSession({ name: 'Ada Lovelace', email: 'ada@example.com' });
    renderTopbar();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    const link = await screen.findByRole('menuitem', { name: 'Report a bug' });
    expect(link).toHaveAttribute('href', expect.stringContaining('mailto:'));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(link).toHaveFocus();
  });

  it('renders the bug-report entry in an RTL locale', async () => {
    setSession({ name: 'Ada Lovelace', email: 'ada@example.com' });
    await i18n.changeLanguage('ar');
    renderTopbar();
    await userEvent.click(screen.getByRole('button', { name: /الحساب/u }));
    expect(await screen.findByRole('menuitem', { name: /الإبلاغ عن خطأ/u })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

  it('quick-jumps to the profile page', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.type(searchBox(), 'Profile{Enter}');
    expect(screen.getByTestId('loc')).toHaveTextContent('/profile');
  });

  it('renders the team invitation inbox trigger in the topbar', () => {
    setSession({ role: 'Member' });
    renderTopbar();
    expect(screen.getByRole('button', { name: 'Team invitations' })).toBeInTheDocument();
  });

  it('labels the account-menu settings item as Notifications', async () => {
    setSession({ name: 'Ada', email: 'ada@example.com' });
    renderTopbar();
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(await screen.findByRole('menuitem', { name: 'Notifications' })).toBeInTheDocument();
  });
});

describe('MinimalLayout', () => {
  it('renders the shared header/footer around a centered outlet', () => {
    setSession(null);
    render(
      <Wrap entries={['/login']}>
        <Routes>
          <Route element={<MinimalLayout />}>
            <Route path="/login" element={<div>AUTH CARD</div>} />
          </Route>
        </Routes>
      </Wrap>,
    );
    expect(screen.getByText('AUTH CARD')).toBeInTheDocument();
    expect(screen.getByText(/All Rights Reserved/)).toBeInTheDocument();
  });
});

describe('AppSidebar workspace-role gating', () => {
  const FOREIGN_MEMBER: Partial<WorkspaceState> = {
    workspaces: [
      { accountId: 'own-1', label: 'me@example.com', role: 'owner', isOwn: true },
      { accountId: 'owner-2', label: 'boss@example.com', role: 'member', isOwn: false },
    ],
    activeWorkspaceId: 'owner-2',
  };

  it('hides owner-only destinations from a member inside a foreign workspace', () => {
    setSession({ role: 'Member' });
    render(
      <Wrap workspace={FOREIGN_MEMBER}>
        <AppSidebar />
      </Wrap>,
    );
    expect(screen.queryByText('Google Search Console')).not.toBeInTheDocument();
    // Team management is admin+, so a plain member loses it too.
    expect(screen.queryByText('Team')).not.toBeInTheDocument();
    // Ordinary product work stays.
    expect(screen.getByText('Sites')).toBeInTheDocument();
  });

  it('keeps the team entry for an admin member', () => {
    setSession({ role: 'Member' });
    const workspace: Partial<WorkspaceState> = {
      workspaces: [
        { accountId: 'own-1', label: 'me@example.com', role: 'owner', isOwn: true },
        { accountId: 'owner-2', label: 'boss@example.com', role: 'admin', isOwn: false },
      ],
      activeWorkspaceId: 'owner-2',
    };
    render(
      <Wrap workspace={workspace}>
        <AppSidebar />
      </Wrap>,
    );
    expect(screen.getByText('Team')).toBeInTheDocument();
  });

  it('keeps every entry in the user own workspace', () => {
    setSession({ role: 'Member' });
    render(
      <Wrap>
        <AppSidebar />
      </Wrap>,
    );
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
  });
});
