import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import { authClient } from '../authClient';
import { SessionReauth } from './SessionReauth';

vi.mock('../authClient', () => ({
  authClient: {
    signIn: { email: vi.fn(), social: vi.fn() },
    twoFactor: { verifyTotp: vi.fn() },
  },
  withInlineTwoFactor: (run: () => Promise<unknown>) => run(),
}));

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  vi.clearAllMocks();
});

const renderPanel = (hasPassword: boolean, onConfirmed = vi.fn()) => {
  render(<I18nextProvider i18n={i18n}><MemoryRouter>
    <SessionReauth email="user@example.test" hasPassword={hasPassword} onConfirmed={onConfirmed} />
  </MemoryRouter></I18nextProvider>);
  return onConfirmed;
};

it('confirms a password account in place', async () => {
  vi.mocked(authClient.signIn.email).mockResolvedValue({ data: { user: { id: 'user' } }, error: null } as never);
  const confirmed = renderPanel(true);
  const password = screen.getByLabelText('Confirm your password');
  expect(password).toHaveFocus();
  fireEvent.change(password, { target: { value: 'synthetic-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(confirmed).toHaveBeenCalledTimes(1));
  expect(authClient.signIn.email).toHaveBeenCalledWith({
    email: 'user@example.test', password: 'synthetic-password', rememberMe: true,
  });
});

it('keeps a two-factor challenge on the panel', async () => {
  vi.mocked(authClient.signIn.email).mockResolvedValue({ data: { twoFactorRedirect: true }, error: null } as never);
  vi.mocked(authClient.twoFactor.verifyTotp).mockResolvedValue({ data: {}, error: null } as never);
  const confirmed = renderPanel(true);
  fireEvent.change(screen.getByLabelText('Confirm your password'), { target: { value: 'synthetic-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  const code = await screen.findByLabelText('Six-digit code');
  expect(code).toHaveFocus();
  fireEvent.change(code, { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(confirmed).toHaveBeenCalledTimes(1));
});

it('uses Google for an account without a password', async () => {
  vi.mocked(authClient.signIn.social).mockResolvedValue({ data: {}, error: null } as never);
  renderPanel(false);
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
  await waitFor(() => expect(authClient.signIn.social).toHaveBeenCalledWith({
    provider: 'google', callbackURL: '/settings/security',
  }));
});
