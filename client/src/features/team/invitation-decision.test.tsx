import { configureStore } from '@reduxjs/toolkit';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import {
  readStoredWorkspaceId,
  workspaceReducer,
  writeStoredWorkspaceId,
} from '@features/workspace';
import { useAuthSession } from '@features/auth';
import * as api from './api';
import { AcceptInvitePage } from './components/AcceptInvitePage';
import { PendingInvitationsPage } from './components/PendingInvitationsPage';
import { RejectInvitePage } from './components/RejectInvitePage';
import { teamInboxReducer } from './store/inboxSlice';
import type { AuthSessionState } from '@features/auth';
import type { PendingInvitation } from './types';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/auth')>()),
  useAuthSession: vi.fn(),
  authClient: { signOut },
}));
vi.mock('./api', () => ({
  fetchInvitationPreviewRequest: vi.fn(),
  acceptInviteRequest: vi.fn(),
  rejectInviteRequest: vi.fn(),
  fetchPendingInvitationsRequest: vi.fn(),
  acceptPendingInvitationRequest: vi.fn(),
  rejectPendingInvitationRequest: vi.fn(),
  fetchWorkspacesRequest: vi.fn(),
}));
const mocked = vi.mocked(api);

const session = (over: Partial<AuthSessionState> = {}): AuthSessionState => ({
  authenticated: true, isPending: false, emailVerified: true,
  mustChangePassword: false, provisionalAccount: false,
  user: { id: 'u-1' } as AuthSessionState['user'], refetch: vi.fn(), ...over,
});
const preview = (action: 'accept' | 'reject') => ({
  invitation: {
    id: 'invite-1', teamId: 'team-1', teamName: 'Acme', inviterName: 'Ada', role: 'member' as const,
    siteAccess: { mode: 'all' as const, siteIds: [] }, expiresAt: '2099-08-08T00:00:00.000Z',
  },
  action,
  requiresAuthentication: action === 'accept',
});
const invitation: PendingInvitation = {
  id: 'invite-1', email: 'me@example.com', role: 'member', userId: 'u-1', status: 'pending',
  invitedAt: '2026-08-01T00:00:00.000Z', acceptedAt: null,
  expiresAt: '2099-08-08T00:00:00.000Z', siteAccess: { mode: 'all', siteIds: [] },
  teamId: 'team-1', teamName: 'Acme', inviterName: 'Ada', requiresPasswordChange: false,
};

const Location = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
};

const renderDecision = (kind: 'accept' | 'reject') => render(
  <I18nextProvider i18n={i18n}>
    <MemoryRouter initialEntries={[`/team/${kind}/abcdefghijklmnop`]}>
      <Routes>
        <Route path="/team/accept/:token" element={<AcceptInvitePage />} />
        <Route path="/team/reject/:token" element={<RejectInvitePage />} />
      </Routes>
    </MemoryRouter>
  </I18nextProvider>,
);

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  writeStoredWorkspaceId(null);
  vi.mocked(useAuthSession).mockReturnValue(session());
});

describe('email invitation decisions', () => {
  it('persists the accepted workspace before handing off to the dashboard', async () => {
    const user = userEvent.setup();
    mocked.fetchInvitationPreviewRequest.mockResolvedValue(preview('accept'));
    mocked.acceptInviteRequest.mockResolvedValue({
      member: { ...invitation, status: 'accepted', acceptedAt: '2026-08-02T00:00:00.000Z' },
      message: 'joined',
    });
    renderDecision('accept');
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('status')).toHaveTextContent('assigned workspace sites');
    expect(readStoredWorkspaceId()).toBe('team-1');
  });

  it('uses a preview-only GET and confirms destructive rejection with a POST', async () => {
    const user = userEvent.setup();
    mocked.fetchInvitationPreviewRequest.mockResolvedValue(preview('reject'));
    mocked.rejectInviteRequest.mockResolvedValue({ message: 'rejected' });
    renderDecision('reject');
    expect(await screen.findByRole('heading', { level: 1, name: 'Reject team invitation' })).toBeInTheDocument();
    expect(await screen.findByText(/Ada invited you to Acme/)).toBeInTheDocument();
    expect(mocked.rejectInviteRequest).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Reject invitation' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(mocked.rejectInviteRequest).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Reject invitation' }));
    await waitFor(() => expect(mocked.rejectInviteRequest).toHaveBeenCalledWith('abcdefghijklmnop'));
    expect(await screen.findByRole('status')).toHaveTextContent('invitation has been rejected');
  });

  it('uses an allow-listed return path for signed-out acceptance', async () => {
    mocked.fetchInvitationPreviewRequest.mockResolvedValue(preview('accept'));
    vi.mocked(useAuthSession).mockReturnValue(session({ authenticated: false, user: null }));
    renderDecision('accept');
    expect(await screen.findByRole('link', { name: 'Sign in to accept' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fteam%2Faccept%2Fabcdefghijklmnop',
    );
    expect(mocked.acceptInviteRequest).not.toHaveBeenCalled();
  });

  it('routes a provisional user through mandatory password replacement', async () => {
    mocked.fetchInvitationPreviewRequest.mockResolvedValue(preview('accept'));
    vi.mocked(useAuthSession).mockReturnValue(session({ mustChangePassword: true }));
    renderDecision('accept');
    expect(await screen.findByRole('link', { name: 'Change password' })).toHaveAttribute(
      'href',
      '/team/change-password?returnTo=%2Fteam%2Faccept%2Fabcdefghijklmnop',
    );
  });

  it('rejects a preview for the wrong action without posting a mutation', async () => {
    mocked.fetchInvitationPreviewRequest.mockResolvedValue(preview('reject'));
    renderDecision('accept');
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i);
    expect(mocked.acceptInviteRequest).not.toHaveBeenCalled();
  });

  it('surfaces an accept POST failure while keeping the invitation actionable', async () => {
    const user = userEvent.setup();
    mocked.fetchInvitationPreviewRequest.mockResolvedValue({
      ...preview('accept'),
      invitation: {
        ...preview('accept').invitation,
        siteAccess: {
          mode: 'selected' as const,
          siteIds: ['site-1'],
          sites: [{ id: 'site-1', label: 'Main site' }],
        },
      },
    });
    mocked.acceptInviteRequest.mockRejectedValue(new TypeError('offline'));
    renderDecision('accept');
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i);
    expect(screen.getByText('Main site')).toBeInTheDocument();
  });

  it('reports a reject POST failure after explicit confirmation', async () => {
    const user = userEvent.setup();
    mocked.fetchInvitationPreviewRequest.mockResolvedValue(preview('reject'));
    mocked.rejectInviteRequest.mockRejectedValue(new TypeError('offline'));
    renderDecision('reject');
    await user.click(await screen.findByRole('button', { name: 'Reject invitation' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reject invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be rejected/i);
  });

  it('shows the invalid-link state when no token is present', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/decision']}>
          <Routes><Route path="/decision" element={<AcceptInvitePage />} /></Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i);
    expect(mocked.fetchInvitationPreviewRequest).not.toHaveBeenCalled();
  });

  it('ignores preview resolution and rejection after the route unmounts', async () => {
    let resolvePreview: (value: ReturnType<typeof preview>) => void = () => {};
    mocked.fetchInvitationPreviewRequest.mockReturnValueOnce(new Promise((resolve) => {
      resolvePreview = resolve;
    }));
    const resolving = renderDecision('accept');
    resolving.unmount();
    await act(async () => {
      resolvePreview(preview('accept'));
      await Promise.resolve();
    });

    let rejectPreview: (reason: unknown) => void = () => {};
    mocked.fetchInvitationPreviewRequest.mockReturnValueOnce(new Promise((_, reject) => {
      rejectPreview = reject;
    }));
    const rejecting = renderDecision('accept');
    rejecting.unmount();
    await act(async () => {
      rejectPreview(new TypeError('offline'));
      await Promise.resolve();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('recoverable provisional invitation page', () => {
  const renderPage = () => render(
    <Provider store={configureStore({
      reducer: { teamInbox: teamInboxReducer, workspace: workspaceReducer },
    })}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/team/invitations']}>
          <Routes>
            <Route path="*" element={<><PendingInvitationsPage /><Location /></>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );

  it('accepts, refreshes the session, and enters the product', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    vi.mocked(useAuthSession).mockReturnValue(session({ provisionalAccount: true, refetch }));
    mocked.fetchPendingInvitationsRequest.mockResolvedValue({ invitations: [invitation] });
    mocked.acceptPendingInvitationRequest.mockResolvedValue({
      member: { ...invitation, status: 'accepted', acceptedAt: '2026-08-02T00:00:00.000Z' },
      message: 'joined',
    });
    mocked.fetchWorkspacesRequest.mockResolvedValue({
      workspaces: [
        { accountId: 'u-1', label: 'Me', role: 'owner', isOwn: true },
        { accountId: 'team-1', label: 'Acme', role: 'member', isOwn: false },
      ],
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard');
    expect(readStoredWorkspaceId()).toBe('team-1');
  });

  it('rejects the last invite, then clears the provisional login', async () => {
    const user = userEvent.setup();
    vi.mocked(useAuthSession).mockReturnValue(session({ provisionalAccount: true }));
    mocked.fetchPendingInvitationsRequest.mockResolvedValue({ invitations: [invitation] });
    mocked.rejectPendingInvitationRequest.mockResolvedValue({ message: 'rejected' });
    signOut.mockResolvedValue({ data: null, error: null });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it('keeps a non-provisional user signed in after rejecting one of several invitations', async () => {
    const user = userEvent.setup();
    mocked.fetchPendingInvitationsRequest.mockResolvedValue({
      invitations: [invitation, { ...invitation, id: 'invite-2', teamName: 'Other' }],
    });
    mocked.rejectPendingInvitationRequest.mockResolvedValue({ message: 'rejected' });
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Reject' }))[0]!);
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(mocked.rejectPendingInvitationRequest).not.toHaveBeenCalled();
    await user.click((await screen.findAllByRole('button', { name: 'Reject' }))[0]!);
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(mocked.rejectPendingInvitationRequest).toHaveBeenCalled());
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/team/invitations');
  });

  it('keeps failed accept and reject decisions recoverable', async () => {
    const user = userEvent.setup();
    mocked.fetchPendingInvitationsRequest.mockResolvedValue({ invitations: [invitation] });
    mocked.acceptPendingInvitationRequest.mockRejectedValueOnce(new TypeError('offline'));
    mocked.rejectPendingInvitationRequest.mockRejectedValueOnce(new TypeError('offline'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i);
    expect(screen.getByTestId('location')).toHaveTextContent('/team/invitations');
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be rejected/i);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('continues to login cleanup when signing out a deleted provisional account fails', async () => {
    const user = userEvent.setup();
    vi.mocked(useAuthSession).mockReturnValue(session({ provisionalAccount: true }));
    mocked.fetchPendingInvitationsRequest.mockResolvedValue({ invitations: [invitation] });
    mocked.rejectPendingInvitationRequest.mockResolvedValue({ message: 'rejected' });
    signOut.mockRejectedValue(new TypeError('session already gone'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
  });

  it('renders selected-site labels and count fallbacks', async () => {
    mocked.fetchPendingInvitationsRequest.mockResolvedValue({
      invitations: [
        {
          ...invitation,
          siteAccess: {
            mode: 'selected', siteIds: ['site-1'], sites: [{ id: 'site-1', label: 'Main site' }],
          },
        },
        {
          ...invitation,
          id: 'invite-2',
          teamName: 'Other',
          siteAccess: { mode: 'selected', siteIds: ['site-1', 'site-2'] },
        },
      ],
    });
    renderPage();
    expect(await screen.findByText(/Member · Main site/)).toBeInTheDocument();
    expect(screen.getByText(/Member · 2 site\(s\)/)).toBeInTheDocument();
  });

  it('renders loading, load-error, and empty recovery states', async () => {
    mocked.fetchPendingInvitationsRequest.mockReturnValueOnce(new Promise(() => {}));
    const loading = renderPage();
    expect(screen.getByText('Review invitations waiting for your decision.')).toBeInTheDocument();
    loading.unmount();
    mocked.fetchPendingInvitationsRequest.mockRejectedValueOnce(new TypeError('offline'));
    const failed = renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
    failed.unmount();
    mocked.fetchPendingInvitationsRequest.mockResolvedValueOnce({ invitations: [] });
    renderPage();
    expect(await screen.findByText('No pending invitations')).toBeInTheDocument();
  });
});
