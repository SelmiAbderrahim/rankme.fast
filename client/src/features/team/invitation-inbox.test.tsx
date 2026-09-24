import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { workspaceReducer } from '@features/workspace';
import * as api from './api';
import { InvitationInbox } from './components/InvitationInbox';
import { teamInboxReducer } from './store/inboxSlice';
import type { PendingInvitation } from './types';

vi.mock('./api', () => ({
  fetchPendingInvitationsRequest: vi.fn(),
  acceptPendingInvitationRequest: vi.fn(),
  rejectPendingInvitationRequest: vi.fn(),
  fetchWorkspacesRequest: vi.fn(),
}));
const mocked = vi.mocked(api);

const invitation = (over: Partial<PendingInvitation> = {}): PendingInvitation => ({
  id: 'invite-1', email: 'me@example.com', role: 'member', userId: 'u-1', status: 'pending',
  invitedAt: '2026-08-01T00:00:00.000Z', acceptedAt: null,
  expiresAt: '2099-08-08T00:00:00.000Z',
  siteAccess: { mode: 'selected', siteIds: ['site-1'], sites: [{ id: 'site-1', label: 'Main' }] },
  teamId: 'team-1', teamName: 'Acme', inviterName: 'Ada', requiresPasswordChange: false,
  ...over,
});

const renderInbox = (preloadedInvitations: PendingInvitation[] = []) => render(
  <Provider store={configureStore({
    reducer: { teamInbox: teamInboxReducer, workspace: workspaceReducer },
    preloadedState: {
      teamInbox: {
        invitations: preloadedInvitations,
        status: preloadedInvitations.length > 0 ? 'loaded' as const : 'idle' as const,
        actionId: null,
        error: '',
        message: '',
      },
    },
  })}>
    <I18nextProvider i18n={i18n}>
      <MemoryRouter><InvitationInbox /></MemoryRouter>
    </I18nextProvider>
  </Provider>,
);

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  mocked.fetchPendingInvitationsRequest.mockResolvedValue({ invitations: [invitation()] });
  mocked.fetchWorkspacesRequest.mockResolvedValue({ workspaces: [] });
});

describe('actionable invitation inbox', () => {
  it('loads a durable count and exposes role, sites, inviter, and expiry', async () => {
    const user = userEvent.setup();
    renderInbox();
    const trigger = await screen.findByRole('button', { name: 'Team invitations, 1 pending' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Acme')).toBeInTheDocument();
    expect(within(dialog).getByText('Invited by Ada')).toBeInTheDocument();
    expect(within(dialog).getByText(/Member · Main/)).toBeInTheDocument();
  });

  it('accepts from the inbox and refreshes available workspaces', async () => {
    const user = userEvent.setup();
    mocked.acceptPendingInvitationRequest.mockResolvedValue({
      member: invitation({ status: 'accepted', acceptedAt: '2026-08-02T00:00:00.000Z' }),
      message: 'joined',
    });
    renderInbox();
    await user.click(await screen.findByRole('button', { name: 'Team invitations, 1 pending' }));
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(mocked.acceptPendingInvitationRequest).toHaveBeenCalledWith('invite-1'));
    expect(mocked.fetchWorkspacesRequest).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Team invitations' })).toBeInTheDocument();
  });

  it('requires confirmation before rejecting', async () => {
    const user = userEvent.setup();
    mocked.rejectPendingInvitationRequest.mockResolvedValue({ message: 'rejected' });
    renderInbox();
    await user.click(await screen.findByRole('button', { name: 'Team invitations, 1 pending' }));
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(mocked.rejectPendingInvitationRequest).not.toHaveBeenCalled();
    const confirmation = await screen.findByRole('alertdialog');
    await user.click(within(confirmation).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(mocked.rejectPendingInvitationRequest).toHaveBeenCalledWith('invite-1'));
  });

  it('blocks acceptance until a provisioned password is replaced', async () => {
    mocked.fetchPendingInvitationsRequest.mockResolvedValue({
      invitations: [invitation({ requiresPasswordChange: true })],
    });
    const user = userEvent.setup();
    renderInbox();
    await user.click(await screen.findByRole('button', { name: 'Team invitations, 1 pending' }));
    expect(await screen.findByRole('button', { name: 'Accept' })).toBeDisabled();
  });

  it('shows a localized load failure without inventing an unread count', async () => {
    mocked.fetchPendingInvitationsRequest.mockRejectedValue(new TypeError('offline'));
    const user = userEvent.setup();
    renderInbox();
    await user.click(await screen.findByRole('button', { name: 'Team invitations' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
  });

  it('caps large badges, renders fallback site counts, and stays open after one of two accepts', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 100 }, (_, index) => invitation({
      id: `invite-${index}`,
      teamName: index === 0 ? 'Acme' : `Team ${index}`,
      siteAccess: index === 0
        ? { mode: 'selected', siteIds: ['one', 'two'] }
        : { mode: 'all', siteIds: [] },
    }));
    mocked.fetchPendingInvitationsRequest.mockResolvedValue({ invitations: many });
    mocked.acceptPendingInvitationRequest.mockResolvedValue({
      member: { ...many[0]!, status: 'accepted', acceptedAt: '2026-08-02T00:00:00.000Z' },
      message: 'joined',
    });
    renderInbox(many);
    expect(screen.getByText('99+')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Team invitations, 100 pending' }));
    expect(await screen.findByText(/Member · 2 site\(s\)/)).toBeInTheDocument();
    await user.click((await screen.findAllByRole('button', { name: 'Accept' }))[0]!);
    await waitFor(() => expect(mocked.acceptPendingInvitationRequest).toHaveBeenCalledWith('invite-0'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows a loading skeleton and keeps failed actions available for retry', async () => {
    const user = userEvent.setup();
    mocked.fetchPendingInvitationsRequest.mockImplementation(() => new Promise(() => {}));
    const pending = renderInbox();
    await user.click(screen.getByRole('button', { name: 'Team invitations' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog').querySelector('[aria-busy="true"]')).not.toBeNull();
    });
    pending.unmount();

    mocked.fetchPendingInvitationsRequest.mockResolvedValue({ invitations: [invitation()] });
    mocked.acceptPendingInvitationRequest.mockRejectedValue(new TypeError('offline'));
    renderInbox();
    await user.click(await screen.findByRole('button', { name: 'Team invitations, 1 pending' }));
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('refreshes on focus and supports closing the sheet', async () => {
    const user = userEvent.setup();
    renderInbox();
    await waitFor(() => expect(mocked.fetchPendingInvitationsRequest).toHaveBeenCalledTimes(1));
    globalThis.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(mocked.fetchPendingInvitationsRequest).toHaveBeenCalledTimes(2));
    await user.click(await screen.findByRole('button', { name: 'Team invitations, 1 pending' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('places the inbox on the inline-start side for RTL locales', async () => {
    const user = userEvent.setup();
    await changeLanguage('ar');
    renderInbox([invitation()]);
    await user.click(screen.getAllByRole('button')[0]!);
    expect(await screen.findByRole('dialog')).toHaveClass('left-0');
    await changeLanguage('en');
  });

  it('cancels safely and exposes a failed rejection after closing the confirmation', async () => {
    const user = userEvent.setup();
    mocked.rejectPendingInvitationRequest.mockRejectedValue(new TypeError('offline'));
    renderInbox();
    await user.click(await screen.findByRole('button', { name: 'Team invitations, 1 pending' }));
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(mocked.rejectPendingInvitationRequest).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be rejected/i);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
