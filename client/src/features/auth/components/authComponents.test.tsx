import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Login } from './Login';
import { Register } from './Register';
import { ForgotPassword } from './ForgotPassword';
import { ResetPassword } from './ResetPassword';
import { Logout } from './Logout';
import { GoogleSignIn, AuthDivider } from './SocialAuth';
import { authClient } from '../authClient';
import { i18n, initI18n, requestPresentationRefresh } from '@shared/i18n';
import { makeStore, resetAccountState } from '@app/store';

vi.mock('../authClient', () => ({
  authClient: {
    signIn: { email: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    sendVerificationEmail: vi.fn(),
    useSession: vi.fn(() => ({ data: null, isPending: false })),
  },
}));

const signInEmail = authClient.signIn.email as unknown as Mock;
const signInSocial = authClient.signIn.social as unknown as Mock;
const signUpEmail = authClient.signUp.email as unknown as Mock;
const signOut = authClient.signOut as unknown as Mock;
const requestReset = authClient.requestPasswordReset as unknown as Mock;
const resetPassword = authClient.resetPassword as unknown as Mock;

const ok = (data: unknown = {}) => ({ data, error: null });
const fail = (error: { status?: number; code?: string; message?: string }) => ({
  data: null,
  error,
});

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  vi.clearAllMocks();
});

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
};

const renderAt = (ui: React.ReactNode, path = '/', testStore = makeStore()) => ({
  ...render(
    <Provider store={testStore}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={path.split('?')[0] ?? '/'} element={ui} />
            <Route path="*" element={null} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  ),
  store: testStore,
});

describe('auth presentation-locale invalidation', () => {
  it('clears each form-local server error callback on a presentation refresh', () => {
    const forms: Array<[() => React.ReactNode, string]> = [
      [() => <Login />, '/login'],
      [() => <Register />, '/register'],
      [() => <ForgotPassword />, '/forgot-password'],
      [() => <ResetPassword />, '/reset-password?token=tok-1'],
    ];

    for (const [renderForm, path] of forms) {
      renderAt(renderForm(), path);
      act(() => {
        requestPresentationRefresh();
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      cleanup();
    }
  });
});

describe('Login', () => {
  it('shows inline localized validation and never calls the API on empty submit', async () => {
    renderAt(<Login />);
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Please enter an email')).toBeInTheDocument();
    expect(screen.getByText('Please enter a password')).toBeInTheDocument();
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it('renders a localized error when credentials are rejected (401)', async () => {
    signInEmail.mockResolvedValue(fail({ status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' }));
    renderAt(<Login />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid email or password.');
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  it('navigates to the dashboard after a verified sign-in', async () => {
    signInEmail.mockResolvedValue(ok({ user: { emailVerified: true } }));
    renderAt(<Login />, '/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/dashboard'));
    expect(signInEmail).toHaveBeenCalledWith({ email: 'a@b.co', password: 'hunter2!' });
  });

  it('routes an unverified sign-in to the verification lobby', async () => {
    signInEmail.mockResolvedValue(ok({ user: { emailVerified: false } }));
    renderAt(<Login />, '/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/verify-email'),
    );
  });

  it('routes a provisional password sign-in to the mandatory change page', async () => {
    signInEmail.mockResolvedValue(ok({ user: { mustChangePassword: true } }));
    renderAt(<Login />, '/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/team/change-password'),
    );
  });

  it('routes a provisional account with a current password to invitations', async () => {
    signInEmail.mockResolvedValue(ok({ user: { provisionalAccount: true } }));
    renderAt(<Login />, '/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/team/invitations'),
    );
  });
});

describe('GoogleSignIn', () => {
  it('invokes signIn.social with the google provider', async () => {
    signInSocial.mockResolvedValue(ok());
    renderAt(<GoogleSignIn />);
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() =>
      expect(signInSocial).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL: '/dashboard',
      }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('drops plan and redirect values from the Google sign-in callback', async () => {
    signInSocial.mockResolvedValue(ok());
    renderAt(
      <GoogleSignIn />,
      '/register?plan=agency&interval=year&lng=fr&redirect=https://evil.example',
    );
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() =>
      expect(signInSocial).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL: '/dashboard',
      }),
    );
  });

  it('surfaces a localized failure and re-enables the button', async () => {
    signInSocial.mockResolvedValue(fail({ status: 500 }));
    renderAt(<GoogleSignIn />);
    const button = screen.getByRole('button', { name: /continue with google/i });
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start google/i);
    expect(button).not.toBeDisabled();
  });
});

describe('AuthDivider', () => {
  it('renders the localized separator label', () => {
    renderAt(<AuthDivider />);
    expect(screen.getByText('OR CONTINUE WITH')).toBeInTheDocument();
  });
});

describe('Register', () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough' } });
  };

  it('shows localized required + format validation before any API call', async () => {
    renderAt(<Register />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Please enter a first name')).toBeInTheDocument();
    expect(screen.getByText('Please enter a last name')).toBeInTheDocument();
    expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it('signs up with the joined name and lands on the verification lobby', async () => {
    signUpEmail.mockResolvedValue(ok({ user: { emailVerified: false } }));
    renderAt(<Register />, '/register');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/verify-email'),
    );
    expect(signUpEmail).toHaveBeenCalledWith({
      name: 'Ada Lovelace',
      email: 'ada@b.co',
      password: 'longenough',
      callbackURL: '/dashboard',
    });
  });

  it('preserves only a validated locale through email signup and verification', async () => {
    signUpEmail.mockResolvedValue(ok({ user: { emailVerified: false } }));
    renderAt(<Register />, '/register?plan=pro&interval=year&lng=fr&redirect=https://evil.example');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/verify-email?lng=fr',
      ),
    );
    expect(signUpEmail).toHaveBeenCalledWith(expect.objectContaining({
      callbackURL: '/dashboard',
    }));
  });

  it('renders the localized duplicate-account error', async () => {
    signUpEmail.mockResolvedValue(fail({ status: 422, code: 'USER_ALREADY_EXISTS' }));
    renderAt(<Register />, '/register');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not create an account with those details.',
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/register');
  });
});

describe('ForgotPassword', () => {
  it('validates the email format inline', async () => {
    renderAt(<ForgotPassword />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText('Please enter a valid email address')).toBeInTheDocument();
    expect(requestReset).not.toHaveBeenCalled();
  });

  it('requests the reset with an origin-absolute redirect and shows the neutral sent message', async () => {
    requestReset.mockResolvedValue(ok({ status: true }));
    renderAt(<ForgotPassword />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/reset link is on its way/i);
    expect(requestReset).toHaveBeenCalledWith({
      email: 'a@b.co',
      redirectTo: `${window.location.origin}/reset-password`,
    });
  });

  it('shows the localized rate-limit message on 429', async () => {
    requestReset.mockResolvedValue(fail({ status: 429 }));
    renderAt(<ForgotPassword />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });
});

describe('ResetPassword', () => {
  it('treats a missing token as an invalid link', () => {
    renderAt(<ResetPassword />, '/reset-password');
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid or has expired/i);
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument();
  });

  it('treats a server error redirect as an invalid link even with a token', () => {
    renderAt(<ResetPassword />, '/reset-password?token=tok-1&error=INVALID_TOKEN');
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid or has expired/i);
  });

  it('rejects a too-short password inline', async () => {
    renderAt(<ResetPassword />, '/reset-password?token=tok-1');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(
      await screen.findByText('Password must be at least 8 characters.'),
    ).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('enforces password confirmation before calling the API', async () => {
    renderAt(<ResetPassword />, '/reset-password?token=tok-1');
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'longenough' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'different1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Passwords must match')).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('resets with the URL token and returns to login', async () => {
    resetPassword.mockResolvedValue(ok({ status: true }));
    renderAt(<ResetPassword />, '/reset-password?token=tok-1');
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'longenough' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'longenough' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    expect(resetPassword).toHaveBeenCalledWith({ newPassword: 'longenough', token: 'tok-1' });
  });

  it('renders a localized error when the token is rejected server-side', async () => {
    resetPassword.mockResolvedValue(fail({ status: 400 }));
    renderAt(<ResetPassword />, '/reset-password?token=tok-stale');
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'longenough' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'longenough' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  });
});

describe('Logout', () => {
  it('signs out and redirects to login', async () => {
    signOut.mockResolvedValue(ok());
    const testStore = makeStore();
    testStore.dispatch({ type: 'sites/load/rejected', payload: 'principal-a-state' });
    expect(testStore.getState().sites.error).toBe('principal-a-state');
    const dispatchSpy = vi.spyOn(testStore, 'dispatch');
    renderAt(<Logout />, '/logout', testStore);
    expect(screen.getByRole('status')).toHaveTextContent('Sorry to see you go!');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(resetAccountState());
    expect(testStore.getState().sites.error).toBe('');
  });

  it('clears principal state even when the sign-out transport rejects', async () => {
    signOut.mockRejectedValue(new Error('network unavailable'));
    const testStore = makeStore();
    testStore.dispatch({ type: 'sites/load/rejected', payload: 'principal-a-state' });
    renderAt(<Logout />, '/logout', testStore);

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    expect(testStore.getState().sites.error).toBe('');
  });
});

describe('Guest-only route guard', () => {
  it('renders the login form for an anonymous visitor', () => {
    renderAt(<Login />, '/login');
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('renders the register form for an anonymous visitor', () => {
    renderAt(<Register />, '/register');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('redirects an authenticated visitor away from the login form', async () => {
    vi.mocked(authClient.useSession).mockReturnValue({
      data: { user: { emailVerified: true } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    const { RedirectIfAuthed } = await import('./RedirectIfAuthed');
    renderAt(
      <RedirectIfAuthed>
        <Login />
      </RedirectIfAuthed>,
      '/login',
    );
    expect(screen.queryByRole('button', { name: 'Log in' })).not.toBeInTheDocument();
  });

  it('redirects an authenticated visitor away from the register form', async () => {
    vi.mocked(authClient.useSession).mockReturnValue({
      data: { user: { emailVerified: true } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    const { RedirectIfAuthed } = await import('./RedirectIfAuthed');
    renderAt(
      <RedirectIfAuthed>
        <Register />
      </RedirectIfAuthed>,
      '/register',
    );
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument();
  });
});

describe('shared button loading affordance', () => {
  const spinnerIn = (btn: HTMLElement) => btn.querySelector('[data-slot="spinner"]');

  const fillRegister = () => {
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough' } });
  };

  it('Register shows aria-busy + spinner while signing up, then unmounts on success', async () => {
    let resolve!: (value: unknown) => void;
    signUpEmail.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderAt(<Register />, '/register');
    fillRegister();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    const pending = await screen.findByRole('button', { name: 'Creating account…' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(spinnerIn(pending)).toBeInTheDocument();
    resolve(ok({ user: { emailVerified: false } }));
    // Success navigates to /verify-email → the form (and its spinner) unmount.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Creating account…' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('Register restores the button (no aria-busy / spinner) after a failed sign-up', async () => {
    signUpEmail.mockResolvedValue(fail({ status: 422, code: 'USER_ALREADY_EXISTS' }));
    renderAt(<Register />, '/register');
    fillRegister();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('alert');
    const restored = screen.getByRole('button', { name: 'Create account' });
    expect(restored).not.toHaveAttribute('aria-busy');
    expect(spinnerIn(restored)).not.toBeInTheDocument();
  });

  it('ForgotPassword shows aria-busy + spinner while sending, then restores on success', async () => {
    let resolve!: (value: unknown) => void;
    requestReset.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderAt(<ForgotPassword />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    const pending = await screen.findByRole('button', { name: 'Sending…' });
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(spinnerIn(pending)).toBeInTheDocument();
    resolve(ok({ status: true }));
    const restored = await screen.findByRole('button', { name: 'Reset password' });
    expect(restored).not.toHaveAttribute('aria-busy');
    expect(spinnerIn(restored)).not.toBeInTheDocument();
  });

  it('ForgotPassword restores the button after a failed send', async () => {
    requestReset.mockResolvedValue(fail({ status: 429 }));
    renderAt(<ForgotPassword />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    await screen.findByRole('alert');
    const restored = screen.getByRole('button', { name: 'Reset password' });
    expect(restored).not.toHaveAttribute('aria-busy');
    expect(spinnerIn(restored)).not.toBeInTheDocument();
  });

  it('ResetPassword shows aria-busy + spinner while resetting, then restores on success and error', async () => {
    // Pending → success (navigates to /login, unmounting the form).
    let resolve!: (value: unknown) => void;
    resetPassword.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderAt(<ResetPassword />, '/reset-password?token=tok-1');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'longenough' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'longenough' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    const pending = await screen.findByRole('button', { name: 'Sending…' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(spinnerIn(pending)).toBeInTheDocument();
    resolve(ok({ status: true }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Sending…' })).not.toBeInTheDocument(),
    );
    cleanup();

    // Pending → error (stays mounted, button restores).
    resetPassword.mockResolvedValue(fail({ status: 400 }));
    renderAt(<ResetPassword />, '/reset-password?token=tok-stale');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'longenough' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'longenough' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await screen.findByRole('alert');
    const restored = screen.getByRole('button', { name: 'Change password' });
    expect(restored).not.toHaveAttribute('aria-busy');
    expect(spinnerIn(restored)).not.toBeInTheDocument();
  });
});
