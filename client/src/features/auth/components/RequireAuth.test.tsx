import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import { useAuthSession, type AuthSessionState } from '../useAuthSession';
import { RequireAuth } from './RequireAuth';

vi.mock('../useAuthSession', () => ({ useAuthSession: vi.fn() }));

const mockSession = (state: Partial<AuthSessionState>) => {
  vi.mocked(useAuthSession).mockReturnValue({
    authenticated: false, isPending: false, emailVerified: false, user: null, ...state,
  });
};

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  vi.clearAllMocks();
});

const renderGuard = () => render(
  <I18nextProvider i18n={i18n}>
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/protected" element={<RequireAuth><p>PROTECTED</p></RequireAuth>} />
        <Route path="/login" element={<p>LOGIN PAGE</p>} />
      </Routes>
    </MemoryRouter>
  </I18nextProvider>,
);

it('offers a reconnect instead of a redirect when the session cannot be read', () => {
  mockSession({ isUnavailable: true });
  renderGuard();
  expect(screen.getByTestId('session-reconnect')).toBeInTheDocument();
  expect(screen.queryByText('LOGIN PAGE')).not.toBeInTheDocument();
});

it('keeps confirmed content next to a reconnect notice during a failed refresh', () => {
  mockSession({ authenticated: true, isUnavailable: true });
  renderGuard();
  expect(screen.getByText('PROTECTED')).toBeInTheDocument();
  expect(screen.getByTestId('session-reconnect')).toBeInTheDocument();
});

it('renders children for a healthy session and redirects anonymous visitors', () => {
  mockSession({ authenticated: true });
  const { unmount } = renderGuard();
  expect(screen.getByText('PROTECTED')).toBeInTheDocument();
  expect(screen.queryByTestId('session-reconnect')).not.toBeInTheDocument();
  unmount();
  mockSession({});
  renderGuard();
  expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument();
});
