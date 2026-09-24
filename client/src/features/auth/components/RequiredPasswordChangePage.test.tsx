import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import { RequiredPasswordChangePage } from './RequiredPasswordChangePage';

vi.mock('./ChangePassword', () => ({
  ChangePassword: ({ onSuccess }: { onSuccess?: () => void }) => (
    <button type="button" onClick={onSuccess}>Complete password change</button>
  ),
}));

const PasswordChangeRoute = () => {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() => navigate('/team/change-password', { replace: true })}
      >
        Scrub return query
      </button>
      <RequiredPasswordChangePage />
    </>
  );
};

const renderPage = (entry: string) => render(
  <I18nextProvider i18n={i18n}>
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/team/change-password" element={<PasswordChangeRoute />} />
        <Route path="/team/invitations" element={<div>Invitation index</div>} />
        <Route path="/team/accept/:token" element={<div>Invitation acceptance</div>} />
      </Routes>
    </MemoryRouter>
  </I18nextProvider>,
);

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  vi.clearAllMocks();
});

describe('RequiredPasswordChangePage', () => {
  it('falls back to the invitation index after a required password change', () => {
    renderPage('/team/change-password?returnTo=https://evil.example');
    expect(screen.getByText(/replace the temporary password/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Complete password change' }));
    expect(screen.getByText('Invitation index')).toBeInTheDocument();
  });

  it('returns to a validated invitation action without retaining browser history', () => {
    renderPage('/team/change-password?returnTo=%2Fteam%2Faccept%2F1234567890abcdef');
    fireEvent.click(screen.getByRole('button', { name: 'Complete password change' }));
    expect(screen.getByText('Invitation acceptance')).toBeInTheDocument();
  });

  it('retains the validated invitation action when an auth refresh scrubs the query first', () => {
    renderPage('/team/change-password?returnTo=%2Fteam%2Faccept%2F1234567890abcdef');
    fireEvent.click(screen.getByRole('button', { name: 'Scrub return query' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete password change' }));
    expect(screen.getByText('Invitation acceptance')).toBeInTheDocument();
  });
});
