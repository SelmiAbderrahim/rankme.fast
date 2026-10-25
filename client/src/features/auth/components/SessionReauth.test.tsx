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

const text = (key: string) => i18n.t(key, { ns: 'auth' });
const submitPassword = (value = 'synthetic-password') => {
  if (value) fireEvent.change(screen.getByLabelText('Confirm your password'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
};

it('asks for a password before contacting the server', async () => {
  renderPanel(true);
  submitPassword('');
  expect(await screen.findByText(text('twoFactor.passwordRequired'))).toBeInTheDocument();
  expect(screen.getByLabelText('Confirm your password')).toHaveAttribute('aria-invalid', 'true');
  expect(authClient.signIn.email).not.toHaveBeenCalled();
});

it('tells a wrong password apart from other sign-in failures', async () => {
  vi.mocked(authClient.signIn.email).mockResolvedValueOnce({ data: null, error: { status: 401 } } as never);
  renderPanel(true);
  submitPassword();
  expect(await screen.findByText(text('change.wrongCurrent'))).toBeInTheDocument();

  vi.mocked(authClient.signIn.email).mockResolvedValueOnce({ data: null, error: { code: 'INVALID_EMAIL_OR_PASSWORD' } } as never);
  submitPassword();
  await waitFor(() => expect(authClient.signIn.email).toHaveBeenCalledTimes(2));
  expect(await screen.findByText(text('change.wrongCurrent'))).toBeInTheDocument();

  vi.mocked(authClient.signIn.email).mockResolvedValueOnce({ data: null, error: { status: 500 } } as never);
  submitPassword();
  expect(await screen.findByText(text('security.sessions.reauth.failed'))).toBeInTheDocument();

  vi.mocked(authClient.signIn.email).mockResolvedValueOnce({ data: null, error: null } as never);
  submitPassword();
  await waitFor(() => expect(authClient.signIn.email).toHaveBeenCalledTimes(4));
  expect(await screen.findByText(text('security.sessions.reauth.failed'))).toBeInTheDocument();

  vi.mocked(authClient.signIn.email).mockRejectedValueOnce(new Error('offline'));
  submitPassword();
  await waitFor(() => expect(authClient.signIn.email).toHaveBeenCalledTimes(5));
  expect(await screen.findByText(text('security.sessions.reauth.failed'))).toBeInTheDocument();
});

it('rejects an empty, wrong or failed two-factor code', async () => {
  vi.mocked(authClient.signIn.email).mockResolvedValue({ data: { twoFactorRedirect: true }, error: null } as never);
  const confirmed = renderPanel(true);
  submitPassword();
  const code = await screen.findByLabelText('Six-digit code');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText(text('twoFactor.invalidCode'))).toBeInTheDocument();
  expect(code).toHaveAttribute('aria-invalid', 'true');

  vi.mocked(authClient.twoFactor.verifyTotp).mockResolvedValueOnce({ data: null, error: { status: 400 } } as never);
  fireEvent.change(code, { target: { value: ' 123456 ' } });
  expect(code).toHaveValue('123456');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(authClient.twoFactor.verifyTotp).toHaveBeenCalledWith({ code: '123456' }));
  expect(await screen.findByText(text('twoFactor.invalidCode'))).toBeInTheDocument();

  vi.mocked(authClient.twoFactor.verifyTotp).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText(text('security.sessions.reauth.failed'))).toBeInTheDocument();
  expect(confirmed).not.toHaveBeenCalled();
});

it('reports a Google confirmation that fails or is rejected', async () => {
  vi.mocked(authClient.signIn.social).mockResolvedValueOnce({ data: null, error: { status: 400 } } as never);
  renderPanel(false);
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
  expect(await screen.findByText(text('google.error'))).toBeInTheDocument();

  vi.mocked(authClient.signIn.social).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
  await waitFor(() => expect(authClient.signIn.social).toHaveBeenCalledTimes(2));
  expect(await screen.findByText(text('google.error'))).toBeInTheDocument();
});
