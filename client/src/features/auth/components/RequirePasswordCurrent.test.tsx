import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { RequirePasswordCurrent } from './RequirePasswordCurrent';

const auth = vi.hoisted(() => ({
  state: {
    authenticated: false,
    isPending: false,
    mustChangePassword: false,
    provisionalAccount: false,
  },
}));

vi.mock('../useAuthSession', () => ({
  useAuthSession: () => auth.state,
}));

vi.mock('./SessionPending', () => ({
  SessionPending: () => <div>Session pending</div>,
}));

function Location() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderGuard(path = '/dashboard?tab=overview') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/team/change-password" element={<Location />} />
        <Route path="/team/invitations" element={<Location />} />
        <Route
          path="*"
          element={(
            <>
              <RequirePasswordCurrent>
                <div>Protected application</div>
              </RequirePasswordCurrent>
              <Location />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.state = {
    authenticated: false,
    isPending: false,
    mustChangePassword: false,
    provisionalAccount: false,
  };
});

describe('RequirePasswordCurrent', () => {
  it('holds the shell while the auth session is pending', () => {
    auth.state = { ...auth.state, isPending: true };
    renderGuard();
    expect(screen.getByText('Session pending')).toBeInTheDocument();
    expect(screen.queryByText('Protected application')).not.toBeInTheDocument();
  });

  it('routes a password-expired identity to the replacement flow', () => {
    auth.state = { ...auth.state, authenticated: true, mustChangePassword: true };
    renderGuard('/dashboard?tab=private');
    expect(screen.getByTestId('location')).toHaveTextContent('/team/change-password');
    expect(screen.getByTestId('location')).not.toHaveTextContent('tab=private');
  });

  it('preserves a safe invitation return path through password replacement', () => {
    auth.state = { ...auth.state, authenticated: true, mustChangePassword: true };
    renderGuard('/team/accept/abcdefghijklmnop');
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/team/change-password?returnTo=%2Fteam%2Faccept%2Fabcdefghijklmnop',
    );
  });

  it('routes provisional identities to invitation handling', () => {
    auth.state = { ...auth.state, authenticated: true, provisionalAccount: true };
    renderGuard();
    expect(screen.getByTestId('location')).toHaveTextContent('/team/invitations');
  });

  it('renders children for current or unauthenticated sessions', () => {
    const guest = renderGuard();
    expect(screen.getByText('Protected application')).toBeInTheDocument();
    guest.unmount();

    auth.state = { ...auth.state, authenticated: true };
    renderGuard();
    expect(screen.getByText('Protected application')).toBeInTheDocument();
  });
});
