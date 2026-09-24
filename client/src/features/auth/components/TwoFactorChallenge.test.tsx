import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TwoFactorChallenge } from './TwoFactorChallenge';
import { authClient } from '../authClient';
import { i18n, initI18n } from '@shared/i18n';

vi.mock('../authClient', () => ({
  authClient: {
    useSession: vi.fn(() => ({ data: null, isPending: false })),
    twoFactor: {
      verifyTotp: vi.fn(),
      verifyBackupCode: vi.fn(),
    },
  },
}));

const verifyTotp = authClient.twoFactor.verifyTotp as unknown as Mock;
const verifyBackup = authClient.twoFactor.verifyBackupCode as unknown as Mock;

const ok = () => ({ data: {}, error: null });
const fail = () => ({ data: null, error: { status: 401 } });

const renderScreen = (locale = 'en') => {
  initI18n({ initialLocale: 'en' });
  void i18n.changeLanguage(locale);
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/two-factor']}>
        <Routes>
          <Route path="/two-factor" element={<TwoFactorChallenge />} />
          <Route path="/dashboard" element={<div data-testid="dash">dash</div>} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  initI18n({ initialLocale: 'en' });
  void i18n.changeLanguage('en');
});

describe('TwoFactorChallenge', () => {
  it('verifies the TOTP code and navigates to /dashboard', async () => {
    verifyTotp.mockResolvedValue(ok());
    renderScreen();
    fireEvent.change(screen.getByLabelText('Six-digit code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(verifyTotp).toHaveBeenCalledWith({ code: '123456', trustDevice: false }),
    );
    await waitFor(() => expect(screen.getByTestId('dash')).toBeInTheDocument());
  });

  it('rejects an empty code inline', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(verifyTotp).not.toHaveBeenCalled();
  });

  it('renders inline error and clears the code on failure', async () => {
    verifyTotp.mockResolvedValue(fail());
    renderScreen();
    fireEvent.change(screen.getByLabelText('Six-digit code'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByLabelText('Six-digit code')).toHaveValue('');
  });

  it('toggles to the backup-code flow and back', async () => {
    verifyBackup.mockResolvedValue(ok());
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Use a backup code' }));
    expect(screen.getByLabelText('Backup code')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Backup code'), {
      target: { value: 'aaa-111' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(verifyBackup).toHaveBeenCalledWith({ code: 'aaa-111', trustDevice: false }),
    );
    await waitFor(() => expect(screen.getByTestId('dash')).toBeInTheDocument());
  });

  it('trust-device checkbox passes trustDevice: true through', async () => {
    verifyTotp.mockResolvedValue(ok());
    renderScreen();
    fireEvent.change(screen.getByLabelText('Six-digit code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByLabelText('Remember this device for 30 days'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(verifyTotp).toHaveBeenCalledWith({ code: '123456', trustDevice: true }),
    );
  });

  it('toggle back to TOTP re-labels the input', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Use a backup code' }));
    expect(screen.getByLabelText('Backup code')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Six-digit code' }));
    expect(screen.getByLabelText('Six-digit code')).toBeInTheDocument();
  });

  it('localized: French labels', async () => {
    renderScreen('fr');
    expect(await screen.findByRole('button', { name: 'Vérifier' })).toBeInTheDocument();
  });
});
