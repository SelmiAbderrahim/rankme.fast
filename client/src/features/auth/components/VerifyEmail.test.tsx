import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { VerifyEmail } from './VerifyEmail';
import { authClient } from '../authClient';
import { useAuthSession, type AuthSessionState } from '../useAuthSession';
import type { AuthSessionUser } from '../types';
import { i18n, initI18n, requestPresentationRefresh } from '@shared/i18n';

vi.mock('../authClient', () => ({
  authClient: { sendVerificationEmail: vi.fn() },
}));
vi.mock('../useAuthSession', () => ({ useAuthSession: vi.fn() }));

const sendVerificationEmail = authClient.sendVerificationEmail as unknown as Mock;

const mockSession = (email: string | null) => {
  vi.mocked(useAuthSession).mockReturnValue({
    authenticated: Boolean(email),
    isPending: false,
    emailVerified: false,
    user: email ? ({ id: 'u-1', email } as AuthSessionUser) : null,
  } satisfies AuthSessionState);
};

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  vi.clearAllMocks();
});

const renderPage = (search = '') =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/verify-email${search}`]}>
        <VerifyEmail />
      </MemoryRouter>
    </I18nextProvider>,
  );

describe('VerifyEmail', () => {
  it('shows instructions and hides the email input when a session email exists', () => {
    mockSession('me@example.com');
    renderPage();
    expect(screen.getByText(/we sent a verification link/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('resends to the session email and confirms', async () => {
    mockSession('me@example.com');
    sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/verification email sent/i);
    expect(sendVerificationEmail).toHaveBeenCalledWith({
      email: 'me@example.com',
      callbackURL: '/dashboard',
    });
  });

  it('collects an email when anonymous and resends to it', async () => {
    mockSession(null);
    sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null });
    renderPage();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@y.zz' } });
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));
    await waitFor(() =>
      expect(sendVerificationEmail).toHaveBeenCalledWith({
        email: 'x@y.zz',
        callbackURL: '/dashboard',
      }),
    );
  });

  it('drops plan and redirect values from a resent verification callback', async () => {
    mockSession('me@example.com');
    sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null });
    renderPage('?plan=starter&interval=month&lng=de&redirect=https://evil.example');
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));
    await waitFor(() => expect(sendVerificationEmail).toHaveBeenCalledWith({
      email: 'me@example.com',
      callbackURL: '/dashboard',
    }));
  });

  it('does nothing without any email to send to', () => {
    mockSession(null);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('renders a localized error when the resend fails', async () => {
    mockSession('me@example.com');
    sendVerificationEmail.mockResolvedValue({ data: null, error: { status: 429 } });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('shows the failed state when the server redirects back with ?error=', () => {
    mockSession('me@example.com');
    renderPage('?error=invalid_token');
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid or has expired/i);
  });

  it('clears transient resend status and error copy on a presentation refresh', async () => {
    mockSession('me@example.com');
    sendVerificationEmail.mockResolvedValue({ data: null, error: { status: 429 } });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    act(() => {
      requestPresentationRefresh();
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
