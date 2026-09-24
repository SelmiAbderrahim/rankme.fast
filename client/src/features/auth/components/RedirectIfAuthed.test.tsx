import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RedirectIfAuthed } from './RedirectIfAuthed';
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

const renderGuard = (guarded: React.ReactNode, entry = '/login') =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/login" element={guarded} />
          <Route path="/dashboard" element={<div>DASHBOARD</div>} />
          <Route path="/verify-email" element={<div>VERIFY PAGE</div>} />
          <Route path="/custom" element={<div>CUSTOM</div>} />
          <Route path="/team/change-password" element={<div>CHANGE PASSWORD PAGE</div>} />
          <Route path="/team/invitations" element={<div>INVITATIONS PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );

describe('RedirectIfAuthed', () => {
  it('shows the pending state while the session resolves', () => {
    mockSession({ isPending: true });
    renderGuard(
      <RedirectIfAuthed>
        <div>LOGIN FORM</div>
      </RedirectIfAuthed>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/checking your session/i);
    expect(screen.queryByText('LOGIN FORM')).not.toBeInTheDocument();
  });

  it('renders children for an anonymous visitor', () => {
    mockSession({ authenticated: false });
    renderGuard(
      <RedirectIfAuthed>
        <div>LOGIN FORM</div>
      </RedirectIfAuthed>,
    );
    expect(screen.getByText('LOGIN FORM')).toBeInTheDocument();
  });

  it('redirects a verified authenticated user to /dashboard', () => {
    mockSession({ authenticated: true, emailVerified: true });
    renderGuard(
      <RedirectIfAuthed>
        <div>LOGIN FORM</div>
      </RedirectIfAuthed>,
    );
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
    expect(screen.queryByText('LOGIN FORM')).not.toBeInTheDocument();
  });

  it('redirects an unverified authenticated user to /verify-email', () => {
    mockSession({ authenticated: true, emailVerified: false });
    renderGuard(
      <RedirectIfAuthed>
        <div>LOGIN FORM</div>
      </RedirectIfAuthed>,
    );
    expect(screen.getByText('VERIFY PAGE')).toBeInTheDocument();
  });

  it('routes mandatory password replacement ahead of every other destination', () => {
    mockSession({ authenticated: true, emailVerified: true, mustChangePassword: true });
    renderGuard(
      <RedirectIfAuthed><div>LOGIN FORM</div></RedirectIfAuthed>,
    );
    expect(screen.getByText('CHANGE PASSWORD PAGE')).toBeInTheDocument();
  });

  it('keeps a provisional account in the invitation workflow', () => {
    mockSession({ authenticated: true, emailVerified: true, provisionalAccount: true });
    renderGuard(
      <RedirectIfAuthed><div>LOGIN FORM</div></RedirectIfAuthed>,
    );
    expect(screen.getByText('INVITATIONS PAGE')).toBeInTheDocument();
  });

  it('honours an explicit `to` override', () => {
    mockSession({ authenticated: true, emailVerified: true });
    renderGuard(
      <RedirectIfAuthed to="/custom">
        <div>LOGIN FORM</div>
      </RedirectIfAuthed>,
    );
    expect(screen.getByText('CUSTOM')).toBeInTheDocument();
  });
});
