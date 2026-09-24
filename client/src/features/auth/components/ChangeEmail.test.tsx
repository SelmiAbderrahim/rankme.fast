import { afterEach, describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { ChangeEmail } from './ChangeEmail';
import { SecuritySettings } from './SecuritySettings';
import { authClient } from '../authClient';
import { useAuthSession } from '../useAuthSession';
import { i18n, initI18n } from '@shared/i18n';

vi.mock('../authClient', () => ({
  authClient: {
    changeEmail: vi.fn(),
    changePassword: vi.fn(),
    useSession: vi.fn(() => ({ data: null, isPending: false })),
    // ActiveSessions (a SecuritySettings child) calls these on mount. A
    // never-resolving list keeps it in its (static) loading state so the host
    // render has no post-render state update to wrap in act().
    listSessions: vi.fn(() => new Promise(() => {})),
    revokeSession: vi.fn(async () => ({ data: null, error: null })),
    revokeOtherSessions: vi.fn(async () => ({ data: null, error: null })),
  },
}));

vi.mock('../useAuthSession', () => ({ useAuthSession: vi.fn() }));

const changeEmail = authClient.changeEmail as unknown as Mock;

const ok = (data: unknown = { status: true }) => ({ data, error: null });
const fail = (error: { status?: number; code?: string; message?: string }) => ({
  data: null,
  error,
});

const CURRENT = 'owner@example.com';

const mockSession = (email = CURRENT) => {
  vi.mocked(useAuthSession).mockReturnValue({
    authenticated: true,
    isPending: false,
    emailVerified: true,
    user: {
      id: 'u1',
      email,
      name: 'Owner',
      emailVerified: true,
      image: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as unknown as ReturnType<typeof useAuthSession>['user'],
  });
};

const renderWithLocale = (ui: React.ReactNode, locale = 'en') => {
  initI18n({ initialLocale: 'en' });
  void i18n.changeLanguage(locale);
  document.documentElement.classList.remove('dark');
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{ui}</MemoryRouter>
    </I18nextProvider>,
  );
};

const fillNewEmail = (labelText: string, value: string) => {
  fireEvent.change(screen.getByLabelText(labelText), { target: { value } });
};

beforeEach(() => {
  vi.clearAllMocks();
  initI18n({ initialLocale: 'en' });
  void i18n.changeLanguage('en');
  mockSession();
});

afterEach(() => vi.unstubAllEnvs());

describe('ChangeEmail', () => {
  it('displays the current account email in a read-only field', () => {
    renderWithLocale(<ChangeEmail />);
    const current = screen.getByLabelText('Current email') as HTMLInputElement;
    expect(current.value).toBe(CURRENT);
    expect(current).toHaveAttribute('readonly');
  });

  it('blocks submit and shows an inline error on a malformed email', async () => {
    renderWithLocale(<ChangeEmail />);
    fillNewEmail('New email', 'not-an-email');
    fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(changeEmail).not.toHaveBeenCalled();
  });

  it('blocks submit and shows an inline error when the new email matches the current one', async () => {
    renderWithLocale(<ChangeEmail />);
    fillNewEmail('New email', CURRENT);
    fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));
    expect(
      await screen.findByText('The new email must differ from your current one'),
    ).toBeInTheDocument();
    expect(changeEmail).not.toHaveBeenCalled();
  });

  it('is case-insensitive when comparing the new email to the current one', async () => {
    renderWithLocale(<ChangeEmail />);
    fillNewEmail('New email', CURRENT.toUpperCase());
    fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));
    expect(
      await screen.findByText('The new email must differ from your current one'),
    ).toBeInTheDocument();
    expect(changeEmail).not.toHaveBeenCalled();
  });

  it('calls changeEmail with an env-derived callbackURL and renders the pending state', async () => {
    vi.stubEnv('VITE_APP_URL', 'https://app.example.com');
    changeEmail.mockResolvedValue(ok());
    renderWithLocale(<ChangeEmail />);
    fillNewEmail('New email', 'fresh@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));
    await waitFor(() =>
      expect(changeEmail).toHaveBeenCalledWith({
        newEmail: 'fresh@example.com',
        callbackURL: 'https://app.example.com/settings/security',
      }),
    );
    // The pending banner surfaces the pending new address (does NOT change
    // the active email displayed on the page).
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('fresh@example.com');
    // Read-only current-email input still shows the OLD address.
    expect((screen.getByLabelText('Current email') as HTMLInputElement).value).toBe(
      CURRENT,
    );
    // The new-email input is cleared post-submit.
    expect((screen.getByLabelText('New email') as HTMLInputElement).value).toBe('');
  });

  it('shows a generic "unavailable" error on a duplicate-email rejection', async () => {
    changeEmail.mockResolvedValue(fail({ status: 409, code: 'EMAIL_ALREADY_EXISTS' }));
    renderWithLocale(<ChangeEmail />);
    fillNewEmail('New email', 'taken@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'That email address is unavailable. Please try a different one.',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('maps unknown errors through the shared auth error catalog', async () => {
    changeEmail.mockResolvedValue(fail({ status: 500 }));
    renderWithLocale(<ChangeEmail />);
    fillNewEmail('New email', 'fresh@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our end. Please try again.',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('maps a 429 rate-limit to the localized message', async () => {
    changeEmail.mockResolvedValue(fail({ status: 429 }));
    renderWithLocale(<ChangeEmail />);
    fillNewEmail('New email', 'fresh@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('shows the shared loading affordance in-flight and restores it on success', async () => {
    let resolve!: (value: unknown) => void;
    changeEmail.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderWithLocale(<ChangeEmail />);
    fillNewEmail('New email', 'fresh@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));
    const pending = await screen.findByRole('button', { name: 'Sending…' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(pending.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
    resolve(ok());
    const restored = await screen.findByRole('button', { name: 'Send verification link' });
    expect(restored).not.toBeDisabled();
    expect(restored).not.toHaveAttribute('aria-busy');
    expect(restored.querySelector('[data-slot="spinner"]')).not.toBeInTheDocument();
  });

  it('restores the loading affordance after a failed email change', async () => {
    changeEmail.mockResolvedValue(fail({ status: 500 }));
    renderWithLocale(<ChangeEmail />);
    fillNewEmail('New email', 'fresh@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));
    await screen.findByRole('alert');
    const restored = screen.getByRole('button', { name: 'Send verification link' });
    expect(restored).not.toHaveAttribute('aria-busy');
    expect(restored.querySelector('[data-slot="spinner"]')).not.toBeInTheDocument();
  });

  it('falls back to an empty current-email string when no session user is present', () => {
    vi.mocked(useAuthSession).mockReturnValue({
      authenticated: false,
      isPending: false,
      emailVerified: false,
      user: null,
    });
    renderWithLocale(<ChangeEmail />);
    expect((screen.getByLabelText('Current email') as HTMLInputElement).value).toBe('');
  });

  it('renders localized labels under Arabic (RTL)', async () => {
    renderWithLocale(<ChangeEmail />, 'ar');
    expect(
      await screen.findByRole('button', { name: 'إرسال رابط التأكيد' }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('البريد الإلكتروني الجديد')).toBeInTheDocument();
  });

  it('renders correctly in dark mode', () => {
    document.documentElement.classList.add('dark');
    renderWithLocale(<ChangeEmail />);
    expect(
      screen.getByRole('button', { name: 'Send verification link' }),
    ).toBeInTheDocument();
    document.documentElement.classList.remove('dark');
  });
});

describe('SecuritySettings hosts both cards', () => {
  it('renders the header, ChangePassword card, and ChangeEmail card', () => {
    renderWithLocale(<SecuritySettings />);
    expect(screen.getByRole('heading', { level: 1, name: 'Security' })).toBeInTheDocument();
    expect(screen.getByText('Change password')).toBeInTheDocument();
    expect(screen.getByText('Change email')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Update password' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Send verification link' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Active sessions')).toBeInTheDocument();
    expect(screen.getByText('Delete account')).toBeInTheDocument();
  });

  it('is theme-agnostic (dark)', () => {
    document.documentElement.classList.add('dark');
    renderWithLocale(<SecuritySettings />);
    expect(screen.getByText('Change email')).toBeInTheDocument();
    cleanup();
    document.documentElement.classList.remove('dark');
  });
});
