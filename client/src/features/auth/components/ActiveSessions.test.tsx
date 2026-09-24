import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { ActiveSessions } from './ActiveSessions';
import { authClient } from '../authClient';
import { i18n, initI18n } from '@shared/i18n';

vi.mock('../authClient', () => ({
  authClient: {
    useSession: vi.fn(() => ({ data: null, isPending: false })),
    listSessions: vi.fn(),
    revokeSession: vi.fn(),
    revokeOtherSessions: vi.fn(),
  },
}));

const useSession = authClient.useSession as unknown as Mock;
const listSessions = authClient.listSessions as unknown as Mock;
const revokeSession = authClient.revokeSession as unknown as Mock;
const revokeOtherSessions = authClient.revokeOtherSessions as unknown as Mock;

const ok = (data: unknown) => ({ data, error: null });
const fail = (error: { status?: number } = { status: 400 }) => ({ data: null, error });

const sess = (token: string, userAgent: string | null = 'Chrome on macOS', ipAddress: string | null = '1.2.3.4') => ({
  token,
  userAgent,
  ipAddress,
});

const renderWithLocale = (locale = 'en') => {
  initI18n({ initialLocale: 'en' });
  void i18n.changeLanguage(locale);
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ActiveSessions />
      </MemoryRouter>
    </I18nextProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  document.documentElement.classList.remove('dark');
  initI18n({ initialLocale: 'en' });
  void i18n.changeLanguage('en');
  useSession.mockReturnValue({ data: { session: { token: 'cur' }, user: { id: 'u1' } }, isPending: false });
});

describe('ActiveSessions', () => {
  it('shows a loading skeleton while the session list is in flight', () => {
    listSessions.mockReturnValue(new Promise(() => {}));
    renderWithLocale();
    expect(screen.getByTestId('sessions-loading')).toBeInTheDocument();
  });

  it('renders the current device as a badge (no revoke) and other devices with a revoke button', async () => {
    listSessions.mockResolvedValue(ok([sess('cur'), sess('other', null, null)]));
    renderWithLocale();
    expect(await screen.findByText('This device')).toBeInTheDocument();
    // Current row cannot be revoked; only the other device gets a button.
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);
    // Null user-agent falls back to the unknown-device label.
    expect(screen.getByText('Unknown device')).toBeInTheDocument();
    // "Sign out all other devices" appears because at least one other exists.
    expect(screen.getByRole('button', { name: 'Sign out all other devices' })).toBeInTheDocument();
  });

  it('renders the shared Empty composition (no CTA) and hides revoke-all when only the current device is signed in', async () => {
    listSessions.mockResolvedValue(ok([sess('cur')]));
    const { container } = renderWithLocale();
    expect(await screen.findByText("You're only signed in on this device.")).toBeInTheDocument();
    // The informational empty state is the shadcn Empty composition, not a bare <p>.
    expect(container.querySelector('[data-slot="empty"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="empty-title"]')).toHaveTextContent(
      'No other devices',
    );
    expect(container.querySelector('[data-slot="empty-description"]')).toHaveTextContent(
      "You're only signed in on this device.",
    );
    // Informational only — no action button inside the empty state.
    expect(
      screen.queryByRole('button', { name: 'Sign out all other devices' }),
    ).not.toBeInTheDocument();
  });

  it('revokes a single session and refetches the list', async () => {
    listSessions
      .mockResolvedValueOnce(ok([sess('cur'), sess('other')]))
      .mockResolvedValueOnce(ok([sess('cur')]));
    revokeSession.mockResolvedValue(ok(null));
    renderWithLocale();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith({ token: 'other' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument(),
    );
  });

  it('surfaces an error alert when a single revoke fails', async () => {
    listSessions.mockResolvedValue(ok([sess('cur'), sess('other')]));
    revokeSession.mockResolvedValue(fail());
    renderWithLocale();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not revoke that session. Try again.',
    );
  });

  it('signs out all other devices and refetches', async () => {
    listSessions
      .mockResolvedValueOnce(ok([sess('cur'), sess('other')]))
      .mockResolvedValueOnce(ok([sess('cur')]));
    revokeOtherSessions.mockResolvedValue(ok(null));
    renderWithLocale();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out all other devices' }));
    await waitFor(() => expect(revokeOtherSessions).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("You're only signed in on this device.")).toBeInTheDocument());
  });

  it('surfaces an error alert when signing out other devices fails', async () => {
    listSessions.mockResolvedValue(ok([sess('cur'), sess('other')]));
    revokeOtherSessions.mockResolvedValue(fail());
    renderWithLocale();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out all other devices' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not revoke that session. Try again.',
    );
  });

  it('shows a load error with a retry that succeeds on the second attempt', async () => {
    listSessions.mockResolvedValueOnce(fail()).mockResolvedValueOnce(ok([sess('cur')]));
    renderWithLocale();
    expect(await screen.findByText('Could not load your sessions.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('This device')).toBeInTheDocument();
  });

  it('treats a null data payload as a load error', async () => {
    listSessions.mockResolvedValue({ data: null, error: null });
    renderWithLocale();
    expect(await screen.findByText('Could not load your sessions.')).toBeInTheDocument();
  });

  it('falls back to an empty current token when there is no session', async () => {
    useSession.mockReturnValue({ data: null, isPending: false });
    listSessions.mockResolvedValue(ok([sess('a'), sess('b')]));
    renderWithLocale();
    // No current token → every row is "other" → two revoke buttons.
    expect(await screen.findAllByRole('button', { name: 'Revoke' })).toHaveLength(2);
  });

  it('renders in Arabic (RTL) and dark mode without crashing', async () => {
    document.documentElement.classList.add('dark');
    listSessions.mockResolvedValue(ok([sess('cur')]));
    renderWithLocale('ar');
    expect(await screen.findByText('هذا الجهاز')).toBeInTheDocument();
  });
});
