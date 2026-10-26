import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import { SecuritySettings } from './SecuritySettings';

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  requestReset: vi.fn(),
  user: { id: 'owner', email: 'owner@example.test' },
}));
vi.mock('../authClient', () => ({
  authClient: {
    listAccounts: mocks.listAccounts,
    requestPasswordReset: mocks.requestReset,
    useSession: () => ({ data: { user: mocks.user }, isPending: false }),
  },
}));
vi.mock('./ChangePassword', () => ({ ChangePassword: () => <p>Change credential password</p> }));
vi.mock('./TwoFactorSettings', () => ({ TwoFactorSettings: ({ hasPassword }: { hasPassword: boolean }) =>
  <p>{hasPassword ? 'Two-factor settings' : 'Password needed for two-factor'}</p> }));
vi.mock('./ChangeEmail', () => ({ ChangeEmail: () => null }));
vi.mock('./ActiveSessions', () => ({ ActiveSessions: () => null }));
vi.mock('./DeleteAccount', () => ({ DeleteAccount: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'owner', email: 'owner@example.test' };
  initI18n({ initialLocale: 'en' });
  mocks.requestReset.mockResolvedValue({ data: { status: true }, error: null });
});

const mount = () => render(<I18nextProvider i18n={i18n}><MemoryRouter>
  <SecuritySettings />
</MemoryRouter></I18nextProvider>);

it('shows password controls only after Better Auth confirms a credential account', async () => {
  mocks.listAccounts.mockResolvedValue({ data: [{ providerId: 'google' }, { providerId: 'credential' }] });
  mount();
  expect(await screen.findByText('Change credential password')).toBeInTheDocument();
  expect(screen.getByText('Two-factor settings')).toBeInTheDocument();
});

it('offers a single-use emailed setup path for a social-only account', async () => {
  mocks.listAccounts.mockResolvedValue({ data: [{ providerId: 'google' }] });
  mount();
  const button = await screen.findByRole('button', { name: 'Set a password' });
  expect(screen.queryByText('Change credential password')).not.toBeInTheDocument();
  expect(screen.getByText('Password needed for two-factor')).toBeInTheDocument();
  fireEvent.click(button);
  await waitFor(() => expect(mocks.requestReset).toHaveBeenCalledWith({
    email: 'owner@example.test', redirectTo: `${window.location.origin}/reset-password`,
  }));
  expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
  expect(button).toBeDisabled();
});

it('does not guess the credential state when lookup fails', async () => {
  mocks.listAccounts.mockResolvedValue({ error: { status: 503, message: '<script>secret</script>' } });
  mount();
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  expect(screen.queryByText('Change credential password')).not.toBeInTheDocument();
});

it('shows no password card for a social-only account without an email address', async () => {
  mocks.user = { id: 'owner' } as typeof mocks.user;
  mocks.listAccounts.mockResolvedValue({ data: [{ providerId: 'google' }] });
  mount();
  expect(await screen.findByText('Password needed for two-factor')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Set a password' })).not.toBeInTheDocument();
});
