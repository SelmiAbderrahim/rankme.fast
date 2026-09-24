import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { ChangePassword } from './ChangePassword';
import { SecuritySettings } from './SecuritySettings';
import { authClient } from '../authClient';
import { i18n, initI18n } from '@shared/i18n';

const sessionRefetch = vi.hoisted(() => vi.fn());

vi.mock('../authClient', () => ({
  authClient: {
    changePassword: vi.fn(),
    useSession: vi.fn(() => ({ data: null, isPending: false, refetch: sessionRefetch })),
    // ActiveSessions (a SecuritySettings child) calls these on mount. A
    // never-resolving list keeps it in its (static) loading state so the host
    // render has no post-render state update to wrap in act().
    listSessions: vi.fn(() => new Promise(() => {})),
    revokeSession: vi.fn(async () => ({ data: null, error: null })),
    revokeOtherSessions: vi.fn(async () => ({ data: null, error: null })),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const changePassword = authClient.changePassword as unknown as Mock;
const toastSuccess = toast.success as unknown as Mock;

const ok = (data: unknown = {}) => ({ data, error: null });
const fail = (error: { status?: number; code?: string; message?: string }) => ({
  data: null,
  error,
});

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

const fill = (current: string, next: string, confirm: string) => {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: confirm },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset back to English after any per-test locale switch
  initI18n({ initialLocale: 'en' });
  void i18n.changeLanguage('en');
});

describe('ChangePassword', () => {
  it('blocks submit and shows inline errors on empty fields', async () => {
    renderWithLocale(<ChangePassword />);
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Please enter your current password')).toBeInTheDocument();
    expect(screen.getByText('Please enter a new password')).toBeInTheDocument();
    expect(screen.getByText('Please confirm the new password')).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rejects a too-short new password inline', async () => {
    renderWithLocale(<ChangePassword />);
    fill('oldpassword-1', 'short', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(
      await screen.findByText('Password must be at least 8 characters.'),
    ).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rejects confirm ≠ new inline', async () => {
    renderWithLocale(<ChangePassword />);
    fill('oldpassword-1', 'brand-new-pass', 'different-value');
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Passwords must match')).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rejects new === current inline', async () => {
    renderWithLocale(<ChangePassword />);
    fill('samepassword-1', 'samepassword-1', 'samepassword-1');
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(
      await screen.findByText('The new password must differ from the current password'),
    ).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('calls changePassword with revokeOtherSessions=true and shows success', async () => {
    changePassword.mockResolvedValue(ok({ token: 'new-token' }));
    renderWithLocale(<ChangePassword />);
    fill('oldpassword-1', 'brand-new-pass', 'brand-new-pass');
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: 'oldpassword-1',
        newPassword: 'brand-new-pass',
        revokeOtherSessions: true,
      }),
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'Password updated. Other sessions were signed out.',
      ),
    );
    // Fields cleared post-success
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Confirm new password') as HTMLInputElement).value).toBe('');
  });

  it('refreshes the session before running the success continuation', async () => {
    changePassword.mockResolvedValue(ok({ token: 'new-token' }));
    sessionRefetch.mockResolvedValue(undefined);
    const onSuccess = vi.fn(async () => undefined);
    renderWithLocale(<ChangePassword onSuccess={onSuccess} />);
    fill('oldpassword-1', 'brand-new-pass', 'brand-new-pass');
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(sessionRefetch).toHaveBeenCalledTimes(1);
    expect(sessionRefetch.mock.invocationCallOrder[0]).toBeLessThan(
      onSuccess.mock.invocationCallOrder[0]!,
    );
  });

  it('renders wrong-current-password error inline without leaking; clears password fields', async () => {
    changePassword.mockResolvedValue(fail({ status: 400, code: 'INVALID_PASSWORD' }));
    renderWithLocale(<ChangePassword />);
    fill('wrongpassword-1', 'brand-new-pass', 'brand-new-pass');
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The current password is incorrect.');
    // Password fields cleared to avoid stale entries; no toast.
    expect(toastSuccess).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Confirm new password') as HTMLInputElement).value).toBe('');
  });

  it('maps unknown errors through the shared auth error catalog', async () => {
    changePassword.mockResolvedValue(fail({ status: 500 }));
    renderWithLocale(<ChangePassword />);
    fill('oldpassword-1', 'brand-new-pass', 'brand-new-pass');
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our end. Please try again.',
    );
  });

  it('maps a 429 rate-limit to the localized message', async () => {
    changePassword.mockResolvedValue(fail({ status: 429 }));
    renderWithLocale(<ChangePassword />);
    fill('oldpassword-1', 'brand-new-pass', 'brand-new-pass');
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('shows the shared loading affordance in-flight and restores it on success', async () => {
    let resolve!: (value: unknown) => void;
    changePassword.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderWithLocale(<ChangePassword />);
    fill('oldpassword-1', 'brand-new-pass', 'brand-new-pass');
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    const pending = await screen.findByRole('button', { name: 'Updating…' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(pending.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
    resolve(ok());
    const restored = await screen.findByRole('button', { name: 'Update password' });
    expect(restored).not.toBeDisabled();
    expect(restored).not.toHaveAttribute('aria-busy');
    expect(restored.querySelector('[data-slot="spinner"]')).not.toBeInTheDocument();
  });

  it('restores the loading affordance after a failed change', async () => {
    changePassword.mockResolvedValue(fail({ status: 500 }));
    renderWithLocale(<ChangePassword />);
    fill('oldpassword-1', 'brand-new-pass', 'brand-new-pass');
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    await screen.findByRole('alert');
    const restored = screen.getByRole('button', { name: 'Update password' });
    expect(restored).not.toHaveAttribute('aria-busy');
    expect(restored.querySelector('[data-slot="spinner"]')).not.toBeInTheDocument();
  });

  it('renders localized labels under Arabic (RTL)', async () => {
    renderWithLocale(<ChangePassword />, 'ar');
    expect(
      await screen.findByRole('button', { name: 'تحديث كلمة المرور' }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('كلمة المرور الحالية')).toBeInTheDocument();
  });

  it('renders correctly in dark mode', () => {
    document.documentElement.classList.add('dark');
    renderWithLocale(<ChangePassword />);
    expect(screen.getByRole('button', { name: 'Update password' })).toBeInTheDocument();
    document.documentElement.classList.remove('dark');
  });
});

describe('SecuritySettings page', () => {
  it('renders the security header and every security card', () => {
    renderWithLocale(<SecuritySettings />);
    expect(screen.getByRole('heading', { level: 1, name: 'Security' })).toBeInTheDocument();
    expect(screen.getByText('Change password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update password' })).toBeInTheDocument();
    // The two features surfaced onto this page.
    expect(screen.getByText('Active sessions')).toBeInTheDocument();
    expect(screen.getByText('Delete account')).toBeInTheDocument();
  });

  it('is theme-agnostic (dark)', () => {
    document.documentElement.classList.add('dark');
    renderWithLocale(<SecuritySettings />);
    expect(screen.getByRole('heading', { level: 1, name: 'Security' })).toBeInTheDocument();
    cleanup();
    document.documentElement.classList.remove('dark');
  });
});
