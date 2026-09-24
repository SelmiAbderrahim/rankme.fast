import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { readStoredWorkspaceId, writeStoredWorkspaceId } from '@features/workspace';
import * as api from './api';
import { teamReducer } from './store/slice';
import { TeamPage } from './components/TeamPage';
import { AcceptInvitePage } from './components/AcceptInvitePage';
import { InviteMemberForm } from './components/InviteMemberForm';
import { TeamMembersTable } from './components/TeamMembersTable';
import type { TeamMember, TeamOverview, TeamState } from './types';
import type { RootState } from '@app/store';
import { selectTeamOverview } from './store/selectors';

vi.mock('./api', () => ({
  fetchTeamRequest: vi.fn(),
  fetchGrantableSitesRequest: vi.fn(),
  fetchInvitationPreviewRequest: vi.fn(),
  inviteMemberRequest: vi.fn(),
  removeMemberRequest: vi.fn(),
  acceptInviteRequest: vi.fn(),
  rejectInviteRequest: vi.fn(),
}));
vi.mock('@features/auth', () => ({
  useAuthSession: vi.fn(() => ({
    authenticated: true,
    isPending: false,
    emailVerified: true,
    mustChangePassword: false,
    provisionalAccount: false,
    user: { id: 'user-1' },
    refetch: vi.fn(),
  })),
}));

const mocked = vi.mocked(api);

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  id: 'm-1',
  email: 'a@example.com',
  role: 'member',
  userId: null,
  status: 'pending',
  invitedAt: '2026-07-01T00:00:00.000Z',
  acceptedAt: null,
  expiresAt: '2026-07-08T00:00:00.000Z',
  siteAccess: { mode: 'all', siteIds: [] },
  ...over,
});

const overview = (over: Partial<TeamOverview> = {}): TeamOverview => ({
  members: [
    member({ id: 'owner', role: 'owner', status: 'accepted', email: 'o@example.com' }),
    member({ id: 'm-2', status: 'pending', email: 'pending@example.com' }),
  ],
  meta: { total: 2, page: 1, pageSize: 25 },
  ...over,
});

const baseState = (): TeamState => teamReducer(undefined, { type: '@@init' });

const makeStore = (preloaded?: Partial<TeamState>) =>
  configureStore({
    reducer: { team: teamReducer },
    preloadedState: { team: { ...baseState(), ...(preloaded ?? {}) } },
  });

type TeamStore = ReturnType<typeof makeStore>;

const renderWith = (
  ui: React.ReactNode,
  store: TeamStore = makeStore(),
  path = '/settings/team',
) => {
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/settings/team" element={ui} />
            <Route path="/team/accept/:token" element={ui} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return store;
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  writeStoredWorkspaceId(null);
  mocked.fetchTeamRequest.mockResolvedValue(overview());
  mocked.fetchGrantableSitesRequest.mockResolvedValue([]);
});

describe('TeamPage', () => {
  it('shows the skeleton while loading', () => {
    renderWith(<TeamPage />, makeStore({ loading: true }));
    expect(screen.getByTestId('team-skeleton')).toBeInTheDocument();
  });

  it('loads on mount and renders member rows', async () => {
    renderWith(<TeamPage />);
    await waitFor(() => expect(mocked.fetchTeamRequest).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Team' })).toBeInTheDocument();
    expect(screen.getByText('o@example.com')).toBeInTheDocument();
    expect(screen.getByText('pending@example.com')).toBeInTheDocument();
  });

  it('surfaces the load error and the retry button (labeled "Try again") reloads', async () => {
    const user = userEvent.setup();
    const store = makeStore({ loaded: true, loadError: 'Nope' });
    renderWith(<TeamPage />, store);
    // The raw error string stays in the Alert; the button reads "Try again".
    expect(screen.getByRole('alert')).toHaveTextContent('Nope');
    const retry = screen.getByRole('button', { name: 'Try again' });
    mocked.fetchTeamRequest.mockResolvedValue(overview());
    await user.click(retry);
    await waitFor(() => expect(mocked.fetchTeamRequest).toHaveBeenCalled());
  });

  it('renders the empty state when no members are returned', async () => {
    mocked.fetchTeamRequest.mockResolvedValue(overview({
      members: [],
      meta: { total: 0, page: 1, pageSize: 25 },
    }));
    renderWith(<TeamPage />);
    expect(await screen.findByText('No teammates yet. Invite someone above.')).toBeInTheDocument();
  });

  it('shows the removeError alert', async () => {
    const store = makeStore({ loaded: true, overview: overview(), removeError: 'cannot' });
    renderWith(<TeamPage />, store);
    expect(screen.getByRole('alert')).toHaveTextContent('cannot');
  });

  it('shows the success message alert', async () => {
    const store = makeStore({ loaded: true, overview: overview(), message: 'ok' });
    renderWith(<TeamPage />, store);
    expect(screen.getByRole('status')).toHaveTextContent('ok');
  });

  it('revoking a pending invite confirms via the dialog, then dispatches the thunk', async () => {
    const user = userEvent.setup();
    mocked.removeMemberRequest.mockResolvedValue({ message: 'Member removed.' });
    const store = makeStore({ loaded: true, overview: overview() });
    renderWith(<TeamPage />, store);
    await user.click(screen.getByTestId('member-actions-m-2'));
    await user.click(await screen.findByRole('menuitem', { name: 'Revoke invite' }));
    // The revoke-variant dialog copy renders; nothing has fired yet.
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Revoke this invite?');
    expect(mocked.removeMemberRequest).not.toHaveBeenCalled();
    await user.click(await screen.findByTestId('member-remove-confirm'));
    await waitFor(() => expect(mocked.removeMemberRequest).toHaveBeenCalledWith('m-2'));
  });

  it('the confirm button shows the busy spinner while the removal is in flight', async () => {
    const user = userEvent.setup();
    let resolveRemove: (value: { message: string }) => void = () => {};
    mocked.removeMemberRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveRemove = resolve;
      }),
    );
    const store = makeStore({ loaded: true, overview: overview() });
    renderWith(<TeamPage />, store);
    await user.click(screen.getByTestId('member-actions-m-2'));
    await user.click(await screen.findByRole('menuitem', { name: 'Revoke invite' }));
    const confirm = await screen.findByTestId('member-remove-confirm');
    await user.click(confirm);
    // Pending: aria-busy + the shared in-button spinner.
    await waitFor(() => expect(confirm).toHaveAttribute('aria-busy', 'true'));
    expect(confirm.querySelector('[data-slot="spinner"]')).not.toBeNull();
    // Resolve → the dialog closes (member removed), so the confirm button unmounts.
    resolveRemove({ message: 'Member removed.' });
    await waitFor(() =>
      expect(screen.queryByTestId('member-remove-confirm')).not.toBeInTheDocument(),
    );
  });
});

describe('InviteMemberForm', () => {
  it('submits the trimmed email and clears the input on success', async () => {
    const user = userEvent.setup();
    mocked.inviteMemberRequest.mockResolvedValue({
      member: member({ id: 'new', email: 'friend@example.com' }),
      emailDelivered: true,
      outcomeUnknown: false,
      message: 'sent',
    });
    const store = makeStore({ loaded: true, overview: overview() });
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <InviteMemberForm />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    const input = screen.getByLabelText('Email');
    await user.type(input, '  friend@example.com  ');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    await waitFor(() =>
      expect(mocked.inviteMemberRequest).toHaveBeenCalledWith({
        email: 'friend@example.com',
        role: 'member',
        siteAccess: { mode: 'all' },
      }),
    );
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('surfaces the server error inline', async () => {
    const user = userEvent.setup();
    mocked.inviteMemberRequest.mockRejectedValue(new TypeError('offline'));
    const store = makeStore({ loaded: true, overview: overview() });
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <InviteMemberForm />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await user.type(screen.getByLabelText('Email'), 'friend@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('rejects a malformed email inline without calling the API', async () => {
    const user = userEvent.setup();
    const store = makeStore({ loaded: true, overview: overview() });
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <InviteMemberForm />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    const input = screen.getByLabelText('Email');
    await user.type(input, 'not-an-email');
    // Bypass native type="email" validation — submit the form directly so the
    // component's own format guard (submit → setTouched → early return) runs.
    const form = input.closest('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a valid email address',
    );
    expect(mocked.inviteMemberRequest).not.toHaveBeenCalled();
  });

  it('ignores empty submissions', async () => {
    const user = userEvent.setup();
    const store = makeStore({ loaded: true, overview: overview() });
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <InviteMemberForm />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    // Whitespace-only input — the submit button is disabled by the guard,
    // so simulate the submission via form event.
    const form = screen.getByLabelText('Email').closest('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    void user;
    expect(mocked.inviteMemberRequest).not.toHaveBeenCalled();
  });

  it('shows the sending label while inviting', () => {
    const store = makeStore({
      loaded: true,
      overview: overview(),
      inviting: true,
    });
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <InviteMemberForm />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  });
});

describe('TeamMembersTable', () => {
  it('renders one row per member with role, status, and empty owner actions', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <TeamMembersTable
          members={overview().members}
          removingId={null}
          onRemove={() => {}}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(screen.queryByTestId('member-actions-owner')).toBeNull();
    expect(screen.getByTestId('member-actions-m-2')).toBeInTheDocument();
  });

  const renderTable = (
    members: TeamMember[],
    onRemove: (m: TeamMember) => void | Promise<unknown> = () => {},
    removingId: string | null = null,
  ) =>
    render(
      <I18nextProvider i18n={i18n}>
        <TeamMembersTable members={members} removingId={removingId} onRemove={onRemove} />
      </I18nextProvider>,
    );

  it('shows the Remove-variant dialog and confirms for accepted members', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderTable([
      member({ id: 'owner', role: 'owner', status: 'accepted' }),
      member({ id: 'active', status: 'accepted', email: 'active@example.com' }),
    ], onRemove);
    await user.click(screen.getByTestId('member-actions-active'));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    // Accepted-member copy (not the revoke variant).
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Remove this teammate?');
    expect(dialog).toHaveTextContent('active@example.com');
    await user.click(screen.getByTestId('member-remove-confirm'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('Cancel dismisses the dialog without removing', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderTable(overview().members, onRemove);
    await user.click(screen.getByTestId('member-actions-m-2'));
    await user.click(await screen.findByRole('menuitem', { name: 'Revoke invite' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('Escape dismisses the dialog without removing', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderTable(overview().members, onRemove);
    await user.click(screen.getByTestId('member-actions-m-2'));
    await user.click(await screen.findByRole('menuitem', { name: 'Revoke invite' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('disables the actions button while the row is being removed', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <TeamMembersTable
          members={overview().members}
          removingId="m-2"
          onRemove={() => {}}
        />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('member-actions-m-2')).toBeDisabled();
  });
});

describe('AcceptInvitePage', () => {
  const preview = {
    invitation: {
      id: 'm-1', teamId: 'team-1', teamName: 'Acme', inviterName: 'Ada', role: 'member' as const,
      siteAccess: { mode: 'selected' as const, siteIds: ['s-1'] },
      expiresAt: '2099-07-08T00:00:00.000Z',
    },
    action: 'accept' as const,
    requiresAuthentication: true,
  };

  it('previews without mutation and accepts only after the explicit click', async () => {
    const user = userEvent.setup();
    mocked.fetchInvitationPreviewRequest.mockResolvedValue(preview);
    mocked.acceptInviteRequest.mockResolvedValue({
      member: member({ id: 'x', status: 'accepted' }),
      message: 'joined',
    });
    renderWith(<AcceptInvitePage />, makeStore(), '/team/accept/abcdefghijklmnop');
    expect(await screen.findByText(/Ada invited you to Acme/)).toBeInTheDocument();
    expect(mocked.acceptInviteRequest).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(mocked.acceptInviteRequest).toHaveBeenCalledWith('abcdefghijklmnop'));
    expect(await screen.findByRole('status')).toHaveTextContent(/assigned workspace sites/);
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(readStoredWorkspaceId()).toBe('team-1');
  });

  it('surfaces the accept error', async () => {
    mocked.fetchInvitationPreviewRequest.mockRejectedValue(new TypeError('nope'));
    renderWith(<AcceptInvitePage />, makeStore(), '/team/accept/abcdefghijklmnop');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('renders the preview loading label while pending', () => {
    mocked.fetchInvitationPreviewRequest.mockReturnValue(new Promise(() => {}));
    renderWith(<AcceptInvitePage />, makeStore(), '/team/accept/abcdefghijklmnop');
    expect(screen.getByText('Checking the invitation…')).toBeInTheDocument();
  });

  it('does nothing when the URL has no token param', () => {
    const store = makeStore();
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/x']}>
            <Routes>
              <Route path="/x" element={<AcceptInvitePage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    // useParams().token is undefined; the `?? ''` fallback keeps it empty.
    expect(mocked.fetchInvitationPreviewRequest).not.toHaveBeenCalled();
  });
});

describe('InviteMemberForm — inline email validation', () => {
  it('shows an inline validation error for a malformed email, wired via aria-describedby', async () => {
    const user = userEvent.setup();
    renderWith(<InviteMemberForm />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'not-an-email');
    await user.tab();
    const err = await screen.findByRole('alert');
    expect(err).toHaveAttribute('id', 'team-invite-email-error');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'team-invite-email-error');
    // A valid address clears the inline error.
    await user.clear(input);
    await user.type(input, 'ok@example.com');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('TeamPage — renders before the lazy slice materializes', () => {
  it('does not throw when `state.team` is still undefined on first render', async () => {
    // `settings/team` lazy-injects the 'team' reducer and renders the page in
    // the same tick, but RTK only materializes the slice on the NEXT dispatched
    // action — so the page's very first render sees no `state.team` key. A bare
    // store reproduces that precondition; the selectors must fall back to
    // initialState rather than throw (an unguarded read here surfaced as the
    // route-level "Page not found" / "Something went wrong" error boundary —
    // the exact bug this guards against).
    const bareStore = configureStore({
      reducer: { unrelated: (s: Record<string, never> = {}) => s },
    });
    render(
      <Provider store={bareStore as never}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/settings/team']}>
            <Routes>
              <Route path="/settings/team" element={<TeamPage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(await screen.findByRole('heading', { name: 'Team' })).toBeInTheDocument();
  });
});

describe('team selectors — first-render guard', () => {
  it('falls back to initialState when the slice is not yet injected (undefined branch)', () => {
    const bare = {} as unknown as RootState;
    expect(selectTeamOverview(bare)).toBeNull();
  });

  it('reads the live slice when injected', () => {
    const withState = (over: Partial<TeamState>): RootState =>
      ({ team: { ...baseState(), ...over } }) as unknown as RootState;
    expect(selectTeamOverview(withState({ overview: overview() }))).toEqual(overview());
  });
});
