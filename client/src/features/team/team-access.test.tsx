import { useState } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from './api';
import { EditMemberAccessDialog } from './components/EditMemberAccessDialog';
import { InviteMemberForm } from './components/InviteMemberForm';
import { TeamSiteAccessFields } from './components/TeamSiteAccessFields';
import { TeamMembersTable } from './components/TeamMembersTable';
import { teamReducer } from './store/slice';
import type { TeamMember, TeamSiteAccessInput, TeamSiteOption } from './types';

vi.mock('./api', () => ({ inviteMemberRequest: vi.fn() }));
const mocked = vi.mocked(api);

const sites: TeamSiteOption[] = [
  { id: 'site-1', label: 'Main site', url: 'https://one.example' },
  { id: 'site-2', label: 'Docs', url: 'https://docs.example' },
];
const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  id: 'm-1', email: 'member@example.com', role: 'member', userId: 'u-1', status: 'accepted',
  invitedAt: '2026-08-01T00:00:00.000Z', acceptedAt: '2026-08-02T00:00:00.000Z',
  expiresAt: '2026-08-08T00:00:00.000Z',
  siteAccess: { mode: 'selected', siteIds: ['site-1'] },
  ...over,
});

const AccessHarness = ({ allowAll = true, available = sites }: { allowAll?: boolean; available?: TeamSiteOption[] }) => {
  const [value, setValue] = useState<TeamSiteAccessInput>(
    allowAll ? { mode: 'all' } : { mode: 'selected', siteIds: ['site-1'] },
  );
  return (
    <TeamSiteAccessFields
      idPrefix="test"
      value={value}
      sites={available}
      allowAll={allowAll}
      showValidation
      onChange={setValue}
    />
  );
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
});

describe('site access controls', () => {
  it('moves from All to a non-empty selected scope and validates an empty scope', async () => {
    const user = userEvent.setup();
    render(<I18nextProvider i18n={i18n}><AccessHarness /></I18nextProvider>);
    expect(screen.getByRole('radio', { name: 'All sites' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Selected sites' }));
    const first = screen.getByRole('checkbox', { name: 'Main site' });
    expect(first).toBeChecked();
    await user.click(first);
    expect(screen.getByRole('alert')).toHaveTextContent('Select at least one site.');
    await user.click(screen.getByRole('checkbox', { name: 'Docs' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('prevents a scoped Admin from granting All sites and explains an empty catalog', () => {
    const { rerender } = render(
      <I18nextProvider i18n={i18n}><AccessHarness allowAll={false} /></I18nextProvider>,
    );
    expect(screen.getByRole('radio', { name: 'All sites' })).toBeDisabled();
    rerender(<I18nextProvider i18n={i18n}><AccessHarness available={[]} /></I18nextProvider>);
    expect(screen.getByText(/Add a site before/)).toBeInTheDocument();
  });

  it('switches back to All access and supports deselecting a checked site', async () => {
    const user = userEvent.setup();
    render(<I18nextProvider i18n={i18n}><AccessHarness /></I18nextProvider>);
    await user.click(screen.getByRole('radio', { name: 'Selected sites' }));
    await user.click(screen.getByRole('checkbox', { name: 'Main site' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'All sites' }));
    expect(screen.getByRole('radio', { name: 'All sites' })).toBeChecked();
  });
});

describe('bounded invitation form and roster', () => {
  const makeStore = () => configureStore({ reducer: { team: teamReducer } });

  it('submits the selected role and site IDs as one command', async () => {
    const user = userEvent.setup();
    mocked.inviteMemberRequest.mockResolvedValue({
      member: member({ id: 'pending', email: 'admin@example.com', role: 'admin', status: 'pending' }),
      emailDelivered: true, outcomeUnknown: false, message: 'sent',
    });
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <InviteMemberForm sites={sites} canInviteAdmin canGrantAllSites />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.click(screen.getByLabelText('Role'));
    await user.click(await screen.findByRole('option', { name: 'Admin' }));
    await user.click(screen.getByRole('radio', { name: 'Selected sites' }));
    await user.click(screen.getByRole('checkbox', { name: 'Docs' }));
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    await waitFor(() => expect(mocked.inviteMemberRequest).toHaveBeenCalledWith({
      email: 'admin@example.com', role: 'admin',
      siteAccess: { mode: 'selected', siteIds: ['site-1', 'site-2'] },
    }));
  });

  it('tightens a draft when manager permissions change and resets to a valid scoped default', async () => {
    const user = userEvent.setup();
    mocked.inviteMemberRequest.mockResolvedValue({
      member: member({ id: 'pending', email: 'member2@example.com', status: 'pending' }),
      emailDelivered: true, outcomeUnknown: false, message: 'sent',
    });
    const store = makeStore();
    const form = (canInviteAdmin: boolean, canGrantAllSites: boolean) => (
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <InviteMemberForm
              sites={sites}
              canInviteAdmin={canInviteAdmin}
              canGrantAllSites={canGrantAllSites}
            />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>
    );
    const view = render(form(true, true));
    await user.click(screen.getByLabelText('Role'));
    await user.click(await screen.findByRole('option', { name: 'Admin' }));
    view.rerender(form(false, false));
    await waitFor(() => expect(screen.getByLabelText('Role')).toHaveTextContent('Member'));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Selected sites' })).toBeChecked());
    expect(screen.getByRole('checkbox', { name: 'Main site' })).toBeChecked();
    await user.type(screen.getByLabelText('Email'), 'member2@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    await waitFor(() => expect(mocked.inviteMemberRequest).toHaveBeenCalledWith({
      email: 'member2@example.com',
      role: 'member',
      siteAccess: { mode: 'selected', siteIds: ['site-1'] },
    }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Main site' })).toBeChecked());
  });

  it('initializes selected access and blocks dialog dismissal while saving', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSave = vi.fn();
    const dialog = (saving: boolean) => (
      <I18nextProvider i18n={i18n}>
        <EditMemberAccessDialog
          member={member()}
          sites={sites}
          saving={saving}
          onClose={onClose}
          onSave={onSave}
        />
      </I18nextProvider>
    );
    const view = render(dialog(false));
    expect(await screen.findByRole('checkbox', { name: 'Main site' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.rerender(dialog(true));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows scoped counts, All access, and only authorized row actions', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <TeamMembersTable
          members={[
            member(),
            member({ id: 'm-2', email: 'all@example.com', siteAccess: { mode: 'all', siteIds: [] } }),
          ]}
          removingId={null}
          onEdit={onEdit}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText('1 site(s)')).toBeInTheDocument();
    expect(screen.getByText('All sites')).toBeInTheDocument();
    await user.click(screen.getByTestId('member-actions-m-1'));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit role and access' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'm-1' }));
  });

  it('resends a pending row and tolerates a legacy row without an access payload', async () => {
    const user = userEvent.setup();
    const onResend = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <TeamMembersTable
          members={[
            member({ id: 'pending', status: 'pending', acceptedAt: null }),
            { ...member({ id: 'legacy', email: 'legacy@example.com' }), siteAccess: undefined } as unknown as TeamMember,
          ]}
          removingId={null}
          onResend={onResend}
        />
      </I18nextProvider>,
    );
    await user.click(screen.getByTestId('member-actions-pending'));
    await user.click(await screen.findByRole('menuitem', { name: 'Resend invite' }));
    expect(onResend).toHaveBeenCalledWith(expect.objectContaining({ id: 'pending' }));
    expect(screen.getAllByText('All sites')).not.toHaveLength(0);
  });

  it('distinguishes active, pending, and expired member statuses', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <TeamMembersTable
          members={[
            member({ id: 'active', status: 'accepted' }),
            member({ id: 'pending', status: 'pending', expiresAt: '2099-08-08T00:00:00.000Z' }),
            member({ id: 'expired', status: 'pending', expiresAt: '2020-08-08T00:00:00.000Z' }),
          ]}
          removingId={null}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });
});
