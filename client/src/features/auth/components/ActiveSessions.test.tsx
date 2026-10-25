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
    $fetch: vi.fn(),
    revokeOtherSessions: vi.fn(),
  },
}));

const useSession = authClient.useSession as unknown as Mock;
const listSessions = authClient.listSessions as unknown as Mock;
const revokeSession = authClient.$fetch as unknown as Mock;
const revokeOtherSessions = authClient.revokeOtherSessions as unknown as Mock;

const ok = (data: unknown) => ({ data, error: null });
const fail = (error: { status?: number; code?: string } = { status: 400 }) => ({ data: null, error });

const sess = (id: string, userAgent: string | null = 'Chrome on macOS', ipAddress: string | null = '1.2.3.4') => ({
  id,
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
  useSession.mockReturnValue({ data: { session: { id: 'cur' }, user: { id: 'u1', email: 'owner@example.test' } }, isPending: false });
});

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

describe('ActiveSessions device labels', () => {
  it('shows "Browser on OS" without exposing the raw user-agent', async () => {
    listSessions.mockResolvedValue(ok([sess('cur', CHROME_MAC)]));
    renderWithLocale();
    const label = await screen.findByText('Chrome 154 on macOS');
    expect(label).not.toHaveAttribute('title');
    expect(screen.queryByText(/Mozilla\/5\.0/)).not.toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
  });

  it('names just the part it recognises', async () => {
    listSessions.mockResolvedValue(
      ok([sess('a', 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101'), sess('b', 'Firefox/131.0')]),
    );
    renderWithLocale();
    expect(await screen.findByText('Linux')).toBeInTheDocument();
    expect(screen.getByText('Firefox 131')).toBeInTheDocument();
  });

  it('keeps an unrecognised agent out of the visible device label', async () => {
    const long = `custom-client/1.0 ${'x'.repeat(200)}`;
    listSessions.mockResolvedValue(ok([sess('a', 'curl/8.4.0'), sess('b', long)]));
    renderWithLocale();
    expect(await screen.findAllByText('Unknown device')).toHaveLength(2);
    expect(screen.queryByText(long)).not.toBeInTheDocument();
  });

  it('shows the last-active time when the session carries one, and omits it otherwise', async () => {
    listSessions.mockResolvedValue(
      ok([
        sess('cur', CHROME_MAC),
        { ...sess('other', 'curl/8.4.0'), updatedAt: '2026-10-05T10:30:00.000Z' },
      ]),
    );
    renderWithLocale();
    await screen.findByText('Chrome 154 on macOS');
    const expected = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date('2026-10-05T10:30:00.000Z'));
    expect(screen.getByText(`Last active ${expected}`)).toBeInTheDocument();
    expect(screen.getAllByText(/Last active/)).toHaveLength(1);
    expect(screen.getByText('Active now')).toBeInTheDocument();
  });

  it('uses createdAt when updatedAt is absent', async () => {
    listSessions.mockResolvedValue(
      ok([{ ...sess('other', CHROME_MAC), createdAt: '2026-10-01T08:00:00.000Z' }]),
    );
    renderWithLocale();
    expect(await screen.findByText(/Last active/)).toBeInTheDocument();
  });
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
    expect(screen.getAllByText('Unknown device')).toHaveLength(2);
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
    expect(revokeSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke session' }));
    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith('/revoke-session', {
      method: 'POST', body: { sessionId: 'other' },
    }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument(),
    );
  });

  it('surfaces an error alert when a single revoke fails', async () => {
    listSessions.mockResolvedValue(ok([sess('cur'), sess('other')]));
    revokeSession.mockResolvedValue(fail());
    renderWithLocale();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke session' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not revoke that session. Try again.',
    );
  });

  it('keeps the revocation pending until confirmed and lets the user cancel', async () => {
    listSessions.mockResolvedValue(ok([sess('cur'), sess('other')]));
    renderWithLocale();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(screen.getByText('Revoke this session?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(revokeSession).not.toHaveBeenCalled();
  });

  it('asks for a fresh identity when Better Auth says the session is stale', async () => {
    listSessions.mockResolvedValue(fail({ status: 403, code: 'SESSION_NOT_FRESH' }));
    renderWithLocale();
    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
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
    listSessions.mockResolvedValueOnce(fail({ status: 503 })).mockResolvedValueOnce(ok([sess('cur')]));
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

  it('falls back to an empty current id when there is no session', async () => {
    useSession.mockReturnValue({ data: null, isPending: false });
    listSessions.mockResolvedValue(ok([sess('a'), sess('b')]));
    renderWithLocale();
    // No current id → every row is "other" → two revoke buttons.
    expect(await screen.findAllByRole('button', { name: 'Revoke' })).toHaveLength(2);
  });

  it('renders in Arabic (RTL) and dark mode without crashing', async () => {
    document.documentElement.classList.add('dark');
    listSessions.mockResolvedValue(ok([sess('cur')]));
    renderWithLocale('ar');
    expect(await screen.findByText('هذا الجهاز')).toBeInTheDocument();
  });
});
