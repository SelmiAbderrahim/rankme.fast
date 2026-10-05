import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { TooltipProvider } from '@shared/ui/tooltip';
import { ThemeProvider } from '@shared/theme/ThemeProvider';
import { i18n, initI18n } from '@shared/i18n';
import { useAuthSession, type AuthSessionState } from '@features/auth';
import { sitesReducer, type Site } from '@features/sites';
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

const SITES: Site[] = [
  { id: 's1', url: 'https://acme.example', domain: 'acme.example', displayName: 'Acme Shop' },
  { id: 's2', url: 'https://plain.example', domain: 'plain.example', displayName: 'plain.example' },
  { id: 's3', url: 'https://nameless.example', domain: 'nameless.example', displayName: '' },
] as Site[];

const makeStore = (workspace: Partial<WorkspaceState> = {}, sites: Site[] = []) =>
  configureStore({
    reducer: { workspace: workspaceReducer, sites: sitesReducer },
    preloadedState: {
      workspace: { ...workspaceInitialState, ...workspace },
      sites: { ...sitesReducer(undefined, { type: '@@init' }), items: sites },
    },
  });

const Wrap = ({
  children,
  entries = ['/dashboard'],
  workspace = {},
  sites = [],
}: {
  children: React.ReactNode;
  entries?: string[];
  workspace?: Partial<WorkspaceState>;
  sites?: Site[];
}) => (
  <Provider store={makeStore(workspace, sites)}>
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
    // Docs leave the SPA: a new tab, never a same-tab jump that drops the shell.
    const docs = screen.getByRole('link', { name: /^Docs/ });
    expect(docs).toHaveAttribute('href', '/docs');
    expect(docs).toHaveAttribute('target', '_blank');
    expect(docs).toHaveAttribute('rel', 'noopener noreferrer');
    expect(docs).toHaveAccessibleName('Docs Opens in a new tab');
    expect(screen.getByRole('link', { name: 'Sites' })).not.toHaveAttribute('target');
    expect(screen.queryByRole('link', { name: 'Guides' })).not.toBeInTheDocument();
    expectLinkIcon('Dashboard', 'lucide-layout-dashboard');
    expectLinkIcon('AI Assistant', 'lucide-bot');
    expectLinkIcon('Sites', 'lucide-earth');
    expectLinkIcon(/Keyword research/, 'lucide-search');
    expectLinkIcon('Alerts', 'lucide-bell-ring');
    expectLinkIcon(/^Docs/, 'lucide-book-open-text');
    expectLinkIcon('Profile', 'lucide-circle-user-round');
    expect(screen.queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument();
    expectLinkIcon('Team', 'lucide-users-round');
    expectLinkIcon('Notifications', 'lucide-bell');
    expectLinkIcon('Security', 'lucide-lock-keyhole');
  });

  describe('single active item', () => {
    const activeLinks = () =>
      screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((link) => link.textContent);

    const renderAt = (entry: string) => {
      setSession({ role: 'Member' });
      render(
        <Wrap entries={[entry]}>
          <AppSidebar />
        </Wrap>,
      );
    };

    it('highlights only Alerts on /dashboard/alerts', () => {
      renderAt('/dashboard/alerts');
      expect(activeLinks()).toEqual(['Alerts']);
    });

    it('highlights only Dashboard on /dashboard', () => {
      renderAt('/dashboard');
      expect(activeLinks()).toEqual(['Dashboard']);
    });

    it('highlights Security, not Profile, on the Profile security tab', () => {
      renderAt('/profile?tab=security');
      expect(activeLinks()).toEqual(['Security']);
    });

    it('highlights Notifications, not Profile, on the Profile notifications tab', () => {
      renderAt('/profile?tab=notifications');
      expect(activeLinks()).toEqual(['Notifications']);
    });

    it('keeps Profile active on its own and on non-mirrored tabs', () => {
      renderAt('/profile');
      expect(activeLinks()).toEqual(['Profile']);
      document.body.innerHTML = '';
      renderAt('/profile?tab=branding');
      expect(activeLinks()).toEqual(['Profile']);
    });

    it('highlights the canonical settings routes and nothing for an unknown route', () => {
      renderAt('/settings/security');
      expect(activeLinks()).toEqual(['Security']);
      document.body.innerHTML = '';
      renderAt('/nowhere');
      expect(activeLinks()).toEqual([]);
    });
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

  it('offers the shared language switcher in the mobile drawer and closes it after a change', async () => {
    sidebar.isMobile = true;
    setSession({ role: 'Member' });
    render(
      <Wrap>
        <AppSidebar />
      </Wrap>,
    );
    const select = screen.getByRole('combobox', { name: 'Language' });
    expect(select).toHaveAttribute('id', 'language-switcher-drawer');
    await userEvent.selectOptions(select, 'fr');
    await waitFor(() => expect(i18n.language).toBe('fr'));
    expect(sidebar.setOpenMobile).toHaveBeenCalledWith(false);
  });

  it('does not render a second language switcher in the desktop sidebar', () => {
    sidebar.isMobile = false;
    setSession({ role: 'Member' });
    render(
      <Wrap>
        <AppSidebar />
      </Wrap>,
    );
    expect(screen.queryByRole('combobox', { name: 'Language' })).not.toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: /^الوثائق/ })).toHaveAttribute('href', '/ar/docs');
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
    expect(screen.getByRole('link', { name: /^Docs/ })).toHaveAttribute('href', '/docs');
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

  const searchBox = () => screen.getByRole('combobox', { name: 'Search' });

  it('lists every sidebar destination on focus, including Alerts, AI Assistant and Exports', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.click(searchBox());
    const list = screen.getByRole('listbox', { name: 'Search' });
    const names = within(list)
      .getAllByRole('option')
      .map((option) => option.textContent);
    for (const label of [
      'Dashboard',
      'AI Assistant',
      'Sites',
      'Keyword research',
      'Alerts',
      'Docs',
      'Exports and shares',
      'Profile',
      'Team',
      'Notifications',
      'Security',
    ]) {
      expect(names).toContain(label);
    }
  });

  it('navigates to a destination that the old datalist never offered', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.type(searchBox(), 'Alerts{Enter}');
    expect(screen.getByTestId('loc')).toHaveTextContent('/dashboard/alerts');
  });

  it('matches on a partial query and clears the box after navigating', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.type(searchBox(), 'keyword{Enter}');
    expect(screen.getByTestId('loc')).toHaveTextContent('/keyword-research');
    expect(searchBox()).toHaveValue('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('matches loosely (in-order letters) as a fallback', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.type(searchBox(), 'kwr{Enter}');
    expect(screen.getByTestId('loc')).toHaveTextContent('/keyword-research');
  });

  it('shows a "No results" state and does not navigate on an unmatched query', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.type(searchBox(), 'zzzz{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('No results for “zzzz”');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent('/dashboard');
  });

  it('does nothing on Enter with a blank query when the list is closed', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    searchBox().focus();
    await userEvent.keyboard('{Escape}{Enter}');
    expect(screen.getByTestId('loc')).toHaveTextContent('/dashboard');
  });

  it('supports arrow-key navigation with aria-activedescendant and wraps', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.click(searchBox());
    const options = () => within(screen.getByRole('listbox')).getAllByRole('option');
    expect(searchBox()).toHaveAttribute('aria-activedescendant', options()[0]!.id);
    await userEvent.keyboard('{ArrowDown}');
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(options().at(-1)).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('loc')).toHaveTextContent('/settings/security');
  });

  it('reopens on ArrowDown, and Escape closes and clears', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.type(searchBox(), 'sec');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(searchBox()).toHaveValue('');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(searchBox()).toHaveAttribute('aria-expanded', 'true');
  });

  it('ArrowDown with no results only keeps the empty state', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.type(searchBox(), 'zzzz');
    await userEvent.keyboard('{ArrowDown}{ArrowUp}');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('selects an option by mouse and highlights on hover', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.click(searchBox());
    const team = screen.getByRole('option', { name: 'Team' });
    await userEvent.hover(team);
    expect(team).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(team);
    expect(screen.getByTestId('loc')).toHaveTextContent('/settings/team');
  });

  it('closes the list on blur', async () => {
    setSession({ role: 'Member' });
    renderTopbar();
    await userEvent.click(searchBox());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.tab();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('uses the localized docs route and hides owner/admin pages like the sidebar does', async () => {
    await i18n.changeLanguage('ar');
    setSession({ role: 'Member' });
    renderTopbar();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await userEvent.type(screen.getByRole('combobox', { name: 'بحث' }), 'الوثائق{Enter}');
    expect(open).toHaveBeenCalledWith('/ar/docs', '_blank', 'noopener,noreferrer');
    // The SPA route is untouched: docs open in a new tab.
    expect(screen.getByTestId('loc')).not.toHaveTextContent('/ar/docs');
    open.mockRestore();
  });

  it('uses the unprefixed docs route for an unsupported language', async () => {
    await i18n.changeLanguage('xx-unsupported');
    setSession({ role: 'Member' });
    renderTopbar();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await userEvent.type(searchBox(), 'Docs{Enter}');
    expect(open).toHaveBeenCalledWith('/docs', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('applies the workspace role policy to search results', async () => {
    setSession({ role: 'Member' });
    render(
      <Wrap
        workspace={{
          workspaces: [
            { accountId: 'own-1', label: 'me@example.com', role: 'owner', isOwn: true },
            { accountId: 'owner-2', label: 'boss@example.com', role: 'member', isOwn: false },
          ],
          activeWorkspaceId: 'owner-2',
        }}
      >
        <AppTopbar />
      </Wrap>,
    );
    await userEvent.click(searchBox());
    expect(screen.queryByRole('option', { name: 'Team' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sites' })).toBeInTheDocument();
  });

  describe('sites already in the store', () => {
    const renderWithSites = () =>
      render(
        <Wrap sites={SITES}>
          <AppTopbar />
          <LocationProbe />
        </Wrap>,
      );

    it('finds a site by name or domain and opens its workspace', async () => {
      setSession({ role: 'Member' });
      renderWithSites();
      await userEvent.type(searchBox(), 'acme.ex');
      const option = screen.getByRole('option', { name: /Acme Shop/ });
      expect(option).toHaveTextContent('acme.example');
      await userEvent.keyboard('{Enter}');
      expect(screen.getByTestId('loc')).toHaveTextContent('/sites/s1');
    });

    it('lists sites in a Sites group when browsing, without a duplicate hint', async () => {
      setSession({ role: 'Member' });
      renderWithSites();
      await userEvent.click(searchBox());
      expect(screen.getByRole('group', { name: 'Sites' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'plain.example' })).toBeInTheDocument();
    });

    it('falls back to the domain for a site without a display name', async () => {
      setSession({ role: 'Member' });
      renderWithSites();
      await userEvent.type(searchBox(), 'nameless{Enter}');
      expect(screen.getByTestId('loc')).toHaveTextContent('/sites/s3');
    });

    it('ranks a prefix hit ahead of a substring hit', async () => {
      setSession({ role: 'Member' });
      renderWithSites();
      await userEvent.type(searchBox(), 'plain');
      expect(within(screen.getByRole('listbox')).getAllByRole('option')[0]).toHaveTextContent(
        'plain.example',
      );
    });
  });

  describe('mobile entry point', () => {
    it('opens the same combobox in a dialog, navigates and closes', async () => {
      setSession({ role: 'Member' });
      renderTopbar();
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      const dialog = await screen.findByRole('dialog', { name: 'Search' });
      const input = within(dialog).getByRole('combobox', { name: 'Search' });
      expect(input).toHaveFocus();
      expect(within(dialog).getByRole('listbox')).toBeInTheDocument();
      await userEvent.type(input, 'Exports{Enter}');
      expect(screen.getByTestId('loc')).toHaveTextContent('/exports');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('keeps Escape for the dialog and clicking an option closes it', async () => {
      setSession({ role: 'Member' });
      renderTopbar();
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      const dialog = await screen.findByRole('dialog', { name: 'Search' });
      await userEvent.click(within(dialog).getByRole('option', { name: 'Team' }));
      expect(screen.getByTestId('loc')).toHaveTextContent('/settings/team');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      await screen.findByRole('dialog', { name: 'Search' });
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
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
