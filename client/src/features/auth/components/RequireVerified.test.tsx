import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireAuth } from './RequireAuth';
import { RequireVerified } from './RequireVerified';
import { useAuthSession, type AuthSessionState } from '../useAuthSession';
import { i18n, initI18n } from '@shared/i18n';

vi.mock('../useAuthSession', () => ({ useAuthSession: vi.fn() }));

const mockSession = (state: Partial<AuthSessionState>) => {
  vi.mocked(useAuthSession).mockReturnValue({
    authenticated: false,
    isPending: false,
    emailVerified: false,
    user: null,
    ...state,
  });
};

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  vi.clearAllMocks();
});

const renderGuard = (guarded: React.ReactNode) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/protected" element={guarded} />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
          <Route path="/verify-email" element={<div>VERIFY PAGE</div>} />
          <Route path="/team/change-password" element={<div>CHANGE PASSWORD PAGE</div>} />
          <Route path="/team/invitations" element={<div>INVITATIONS PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );

describe('RequireAuth', () => {
  it('offers retry rather than redirecting when the session read fails', () => {
    mockSession({ isUnavailable: true });
    renderGuard(<RequireAuth><div>SECRET</div></RequireAuth>);
    expect(screen.getByText(/could not check your session/i)).toBeInTheDocument();
    expect(screen.queryByText('LOGIN PAGE')).not.toBeInTheDocument();
  });
  it('shows the pending state while the session resolves', () => {
    mockSession({ isPending: true });
    renderGuard(
      <RequireAuth>
        <div>SECRET</div>
      </RequireAuth>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/checking your session/i);
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument();
  });

  it('redirects an anonymous visitor to /login', () => {
    mockSession({ authenticated: false });
    renderGuard(
      <RequireAuth>
        <div>SECRET</div>
      </RequireAuth>,
    );
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument();
  });

  it('renders children for an authenticated session', () => {
    mockSession({ authenticated: true });
    renderGuard(
      <RequireAuth>
        <div>SECRET</div>
      </RequireAuth>,
    );
    expect(screen.getByText('SECRET')).toBeInTheDocument();
  });
});

describe('RequireVerified', () => {
  it('does not treat an unavailable session as an anonymous user', () => {
    mockSession({ isUnavailable: true });
    renderGuard(<RequireVerified><div>PRODUCT</div></RequireVerified>);
    expect(screen.getByText(/could not check your session/i)).toBeInTheDocument();
    expect(screen.queryByText('LOGIN PAGE')).not.toBeInTheDocument();
  });
  it('shows the pending state while the session resolves', () => {
    mockSession({ isPending: true });
    renderGuard(
      <RequireVerified>
        <div>PRODUCT</div>
      </RequireVerified>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/checking your session/i);
  });

  it('redirects an anonymous visitor to /login', () => {
    mockSession({ authenticated: false });
    renderGuard(
      <RequireVerified>
        <div>PRODUCT</div>
      </RequireVerified>,
    );
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument();
  });

  it('bounces an unverified account to /verify-email', () => {
    mockSession({ authenticated: true, emailVerified: false });
    renderGuard(
      <RequireVerified>
        <div>PRODUCT</div>
      </RequireVerified>,
    );
    expect(screen.getByText('VERIFY PAGE')).toBeInTheDocument();
  });

  it('requires a password change before verification state can grant access', () => {
    mockSession({ authenticated: true, emailVerified: true, mustChangePassword: true });
    renderGuard(
      <RequireVerified>
        <div>PRODUCT</div>
      </RequireVerified>,
    );
    expect(screen.getByText('CHANGE PASSWORD PAGE')).toBeInTheDocument();
  });

  it('keeps a provisional account in the invitation workflow', () => {
    mockSession({ authenticated: true, emailVerified: true, provisionalAccount: true });
    renderGuard(
      <RequireVerified>
        <div>PRODUCT</div>
      </RequireVerified>,
    );
    expect(screen.getByText('INVITATIONS PAGE')).toBeInTheDocument();
  });

  it('renders children for a verified session', () => {
    mockSession({ authenticated: true, emailVerified: true });
    renderGuard(
      <RequireVerified>
        <div>PRODUCT</div>
      </RequireVerified>,
    );
    expect(screen.getByText('PRODUCT')).toBeInTheDocument();
  });

  it('keeps confirmed content visible with a reconnect notice during a failed refresh', () => {
    mockSession({ authenticated: true, emailVerified: true, isUnavailable: true });
    renderGuard(<RequireVerified><div>PRODUCT</div></RequireVerified>);
    expect(screen.getByText('PRODUCT')).toBeInTheDocument();
    expect(screen.getByText(/could not check your session/i)).toBeInTheDocument();
  });
});
