/** Role, access, pagination, and self-service behavior on the team page. */
import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { workspaceInitialState, workspaceReducer } from '@features/workspace';
import * as api from './api';
import { TeamPage } from './components/TeamPage';
import { initialState, teamReducer } from './store/slice';
import type { TeamMember, TeamOverview, TeamSiteOption } from './types';

const { mockUseAuthSession } = vi.hoisted(() => ({ mockUseAuthSession: vi.fn() }));

vi.mock('./api', () => ({
  fetchTeamRequest: vi.fn(),
  fetchGrantableSitesRequest: vi.fn(),
  inviteMemberRequest: vi.fn(),
  removeMemberRequest: vi.fn(),
  resendInviteRequest: vi.fn(),
  updateTeamMemberRequest: vi.fn(),
}));

vi.mock('@features/auth', () => ({
  useAuthSession: mockUseAuthSession,
}));

const mocked = vi.mocked(api);
const sites: TeamSiteOption[] = [
  { id: 'site-1', label: 'Main site', url: 'https://main.example' },
  { id: 'site-2', label: 'Docs', url: 'https://docs.example' },
];

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  id: 'm-1',
  email: 'member@example.com',
  role: 'member',
  userId: 'member-user',
  status: 'accepted',
  invitedAt: '2026-07-01T00:00:00.000Z',
  acceptedAt: '2026-07-02T00:00:00.000Z',
  expiresAt: '2099-07-08T00:00:00.000Z',
  siteAccess: { mode: 'all', siteIds: [] },
  ...over,
});

const overview = (over: Partial<TeamOverview> = {}): TeamOverview => ({
  members: [
    member({ id: 'owner', email: 'owner@example.com', role: 'owner', userId: 'owner-user' }),
    member(),
  ],
  meta: { total: 2, page: 1, pageSize: 25 },
  ...over,
});

const makeStore = (
  team: Partial<typeof initialState> = {},
  workspace: Partial<typeof workspaceInitialState> = {},
) => configureStore({
  reducer: { team: teamReducer, workspace: workspaceReducer },
  preloadedState: {
    team: { ...initialState, loaded: true, overview: overview(), ...team },
    workspace: { ...workspaceInitialState, ...workspace },
  },
});

const renderPage = (store = makeStore()) => render(
  <Provider store={store}>
    <I18nextProvider i18n={i18n}>
      <MemoryRouter><TeamPage /></MemoryRouter>
    </I18nextProvider>
  </Provider>,
);

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  mockUseAuthSession.mockReturnValue({
    authenticated: true,
    isPending: false,
    emailVerified: true,
    mustChangePassword: false,
    provisionalAccount: false,
    user: { id: 'member-user' },
  });
  mocked.fetchTeamRequest.mockResolvedValue(overview());
  mocked.fetchGrantableSitesRequest.mockResolvedValue(sites);
});

describe('owner access editing', () => {
  it('updates role and selected-site access as one server-validated command', async () => {
    const user = userEvent.setup();
    const updated = member({
      role: 'admin',
      siteAccess: { mode: 'selected', siteIds: ['site-1'] },
    });
    mocked.updateTeamMemberRequest.mockResolvedValue({ member: updated, message: 'saved' });
    renderPage();
    await waitFor(() => expect(mocked.fetchGrantableSitesRequest).toHaveBeenCalled());
    await user.click(screen.getByTestId('member-actions-m-1'));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit role and access' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByLabelText('Role'));
    await user.click(await screen.findByRole('option', { name: 'Admin' }));
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Selected sites' })).toBeEnabled());
    await user.click(within(dialog).getByRole('radio', { name: 'Selected sites' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save access' }));
    await waitFor(() => expect(mocked.updateTeamMemberRequest).toHaveBeenCalledWith({
      id: 'm-1',
      role: 'admin',
      siteAccess: { mode: 'selected', siteIds: ['site-1'] },
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('validates an empty selected scope and lets the owner cancel', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('member-actions-m-1'));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit role and access' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Selected sites' })).toBeEnabled());
    await user.click(within(dialog).getByRole('radio', { name: 'Selected sites' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Main site' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save access' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Select at least one site.');
    expect(mocked.updateTeamMemberRequest).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the editor available when the update is rejected', async () => {
    const user = userEvent.setup();
    mocked.updateTeamMemberRequest.mockRejectedValue(new TypeError('offline'));
    renderPage();
    await user.click(screen.getByTestId('member-actions-m-1'));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit role and access' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not update/i);
    expect(dialog).toBeInTheDocument();
  });
});

describe('bounded managers and site catalog failures', () => {
  const foreignAdmin = {
    workspaces: [
      { accountId: 'own', label: 'Me', role: 'owner' as const, isOwn: true },
      {
        accountId: 'boss', label: 'Boss', role: 'admin' as const, isOwn: false,
        siteAccess: { mode: 'selected' as const, siteIds: ['site-1'] },
      },
    ],
    activeWorkspaceId: 'boss',
  };

  it('allows an Admin to invite Members but not grant Admin or All-sites access', async () => {
    renderPage(makeStore({}, foreignAdmin));
    expect(screen.getByText('Admins can invite Members only.')).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'All sites' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Selected sites' })).toBeChecked());
    await userEvent.click(screen.getByTestId('member-actions-m-1'));
    expect(screen.queryByRole('menuitem', { name: 'Edit role and access' })).not.toBeInTheDocument();
  });

  it('shows a localized error when the full site catalog cannot load', async () => {
    mocked.fetchGrantableSitesRequest.mockRejectedValue(new TypeError('offline'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the sites/i);
  });

  it('does not update state after a resolved or rejected site request outlives the page', async () => {
    let resolveSites: (value: TeamSiteOption[]) => void = () => {};
    mocked.fetchGrantableSitesRequest.mockReturnValueOnce(new Promise((resolve) => {
      resolveSites = resolve;
    }));
    const resolved = renderPage();
    await waitFor(() => expect(mocked.fetchGrantableSitesRequest).toHaveBeenCalledTimes(1));
    resolved.unmount();
    resolveSites(sites);
    await Promise.resolve();

    let rejectSites: (reason: unknown) => void = () => {};
    mocked.fetchGrantableSitesRequest.mockReturnValueOnce(new Promise((_, reject) => {
      rejectSites = reject;
    }));
    const rejected = renderPage();
    await waitFor(() => expect(mocked.fetchGrantableSitesRequest).toHaveBeenCalledTimes(2));
    rejected.unmount();
    rejectSites(new TypeError('offline'));
    await Promise.resolve();
  });
});

describe('roster navigation and self-service', () => {
  it('debounces search and pages both directions', async () => {
    const user = userEvent.setup();
    const paged = overview({ meta: { total: 60, page: 2, pageSize: 25 } });
    const store = makeStore({ overview: paged, page: 2 });
    renderPage(store);
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(mocked.fetchTeamRequest).toHaveBeenCalledWith({ query: undefined, page: 1 }));
    mocked.fetchTeamRequest.mockResolvedValue(overview({ meta: { total: 60, page: 1, pageSize: 25 } }));
    mocked.fetchTeamRequest.mockClear();
    await user.type(screen.getByLabelText('Search by email'), 'ada');
    await waitFor(() => expect(mocked.fetchTeamRequest).toHaveBeenCalledWith({ query: 'ada', page: 1 }));
    await screen.findByText('Page 1 of 3 · 60 member(s)');
    mocked.fetchTeamRequest.mockClear();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mocked.fetchTeamRequest).toHaveBeenCalledWith({ query: 'ada', page: 2 }));
  });

  it('limits a plain member to leaving their own row and hides invitation controls', async () => {
    const user = userEvent.setup();
    const workspace = {
      workspaces: [
        { accountId: 'own', label: 'Me', role: 'owner' as const, isOwn: true },
        { accountId: 'boss', label: 'Boss', role: 'member' as const, isOwn: false },
      ],
      activeWorkspaceId: 'boss',
    };
    renderPage(makeStore({}, workspace));
    expect(screen.queryByRole('button', { name: 'Send invite' })).not.toBeInTheDocument();
    await user.click(screen.getByTestId('member-actions-m-1'));
    expect(await screen.findByRole('menuitem', { name: 'Leave workspace' })).toBeInTheDocument();
    expect(screen.queryByTestId('member-actions-owner')).not.toBeInTheDocument();
  });

  it('does not expose any removal action before the current user identity is available', () => {
    mockUseAuthSession.mockReturnValue({
      authenticated: true,
      isPending: false,
      emailVerified: true,
      mustChangePassword: false,
      provisionalAccount: false,
      user: null,
    });
    const workspace = {
      workspaces: [
        { accountId: 'own', label: 'Me', role: 'owner' as const, isOwn: true },
        { accountId: 'boss', label: 'Boss', role: 'member' as const, isOwn: false },
      ],
      activeWorkspaceId: 'boss',
    };
    renderPage(makeStore({}, workspace));
    expect(screen.queryByTestId('member-actions-m-1')).not.toBeInTheDocument();
  });

  it('resends a pending invitation from its roster action', async () => {
    const user = userEvent.setup();
    const pending = member({
      id: 'pending', email: 'pending@example.com', status: 'pending', acceptedAt: null,
    });
    mocked.resendInviteRequest.mockResolvedValue({
      member: pending,
      emailDelivered: true,
      outcomeUnknown: false,
      message: 'resent',
    });
    renderPage(makeStore({ overview: overview({ members: [pending] }) }));
    await user.click(screen.getByTestId('member-actions-pending'));
    await user.click(await screen.findByRole('menuitem', { name: 'Resend invite' }));
    await waitFor(() => expect(mocked.resendInviteRequest).toHaveBeenCalledWith('pending'));
  });

  it('surfaces resend and member-update errors when no removal error takes precedence', () => {
    const resend = renderPage(makeStore({ resendError: 'resend failed' }));
    expect(screen.getByRole('alert')).toHaveTextContent('resend failed');
    resend.unmount();
    renderPage(makeStore({ updateError: 'update failed' }));
    expect(screen.getByRole('alert')).toHaveTextContent('update failed');
  });

  it('renders expiration and omits resend for accepted rows', async () => {
    const user = userEvent.setup();
    const stale = member({
      id: 'stale', email: 'stale@example.com', status: 'pending', acceptedAt: null,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    renderPage(makeStore({
      overview: overview({ members: [member({ id: 'owner', role: 'owner' }), member(), stale] }),
    }));
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Jan 1, 2020')).toBeInTheDocument();
    await user.click(screen.getByTestId('member-actions-m-1'));
    expect(screen.queryByRole('menuitem', { name: 'Resend invite' })).not.toBeInTheDocument();
  });
});
