import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { TwoFactorSettings, extractSecret } from './TwoFactorSettings';
import { authClient } from '../authClient';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';

vi.mock('../authClient', () => ({
  authClient: {
    useSession: vi.fn(() => ({ data: null, isPending: false })),
    twoFactor: {
      enable: vi.fn(),
      verifyTotp: vi.fn(),
      disable: vi.fn(),
    },
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,QR') },
}));

const useSession = authClient.useSession as unknown as Mock;
const enable = authClient.twoFactor.enable as unknown as Mock;
const verifyTotp = authClient.twoFactor.verifyTotp as unknown as Mock;
const disable = authClient.twoFactor.disable as unknown as Mock;
const toastSuccess = toast.success as unknown as Mock;

const ok = (data: unknown = {}) => ({ data, error: null });
const fail = (error: { message?: string; status?: number } = { status: 400 }) => ({
  data: null,
  error,
});

const renderWithLocale = (locale = 'en') => {
  initI18n({ initialLocale: 'en' });
  void i18n.changeLanguage(locale);
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <TwoFactorSettings />
      </MemoryRouter>
    </I18nextProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  initI18n({ initialLocale: 'en' });
  void i18n.changeLanguage('en');
  useSession.mockReturnValue({
    data: { user: { id: 'u1', twoFactorEnabled: false } },
    isPending: false,
  });
  // Silence unhandled clipboard errors in jsdom.
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(async () => undefined) },
  });
});

describe('TwoFactorSettings', () => {
  it('shows the off-state prompt when 2FA is not enabled', () => {
    renderWithLocale();
    expect(screen.getByTestId('two-factor-status')).toHaveTextContent(
      'Two-factor authentication is off.',
    );
    expect(screen.getByRole('button', { name: 'Enable two-factor' })).toBeInTheDocument();
  });

  it('requires the current password before starting enrolment', async () => {
    renderWithLocale();
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter your current password to continue.',
    );
    expect(enable).not.toHaveBeenCalled();
  });

  it('renders the QR + secret + backup codes after a successful enrol call', async () => {
    enable.mockResolvedValue(
      ok({
        totpURI:
          'otpauth://totp/RankMeFast:alice?secret=JBSWY3DPEHPK3PXP&issuer=RankMeFast',
        backupCodes: ['aaa-111', 'bbb-222', 'ccc-333'],
      }),
    );
    renderWithLocale();
    fireEvent.change(screen.getByLabelText('Confirm your password'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));

    await screen.findByAltText('');
    expect(screen.getByLabelText('Manual entry code')).toHaveValue('JBSWY3DPEHPK3PXP');
    expect(screen.getByText('aaa-111')).toBeInTheDocument();
    expect(screen.getByText('bbb-222')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy secret' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download codes' })).toBeInTheDocument();
  });

  it('surfaces an error inline when enable fails', async () => {
    enable.mockResolvedValue(fail({ status: 401 }));
    renderWithLocale();
    fireEvent.change(screen.getByLabelText('Confirm your password'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code was not accepted. Try again.',
    );
  });

  it('verifies the enrol code, toasts success, and resets state', async () => {
    enable.mockResolvedValue(
      ok({
        totpURI: 'otpauth://totp/RankMeFast:alice?secret=SEC&issuer=RankMeFast',
        backupCodes: ['aaa-111'],
      }),
    );
    verifyTotp.mockResolvedValue(ok({}));
    renderWithLocale();
    fireEvent.change(screen.getByLabelText('Confirm your password'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await screen.findByLabelText('Six-digit code');
    fireEvent.change(screen.getByLabelText('Six-digit code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and turn on' }));
    await waitFor(() => expect(verifyTotp).toHaveBeenCalledWith({ code: '123456' }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Two-factor authentication is now on.'),
    );
  });

  it('surfaces an error inline when verify-totp fails and does NOT toast', async () => {
    enable.mockResolvedValue(
      ok({
        totpURI: 'otpauth://totp/RankMeFast:alice?secret=SEC&issuer=RankMeFast',
        backupCodes: ['aaa-111'],
      }),
    );
    verifyTotp.mockResolvedValue(fail({ status: 400 }));
    renderWithLocale();
    fireEvent.change(screen.getByLabelText('Confirm your password'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await screen.findByLabelText('Six-digit code');
    fireEvent.change(screen.getByLabelText('Six-digit code'), {
      target: { value: '999999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and turn on' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('That code was not accepted.'),
    );
    expect(toastSuccess).not.toHaveBeenCalledWith('Two-factor authentication is now on.');
  });

  it('rejects verify with an empty code inline', async () => {
    enable.mockResolvedValue(
      ok({
        totpURI: 'otpauth://totp/RankMeFast:alice?secret=SEC&issuer=RankMeFast',
        backupCodes: ['aaa-111'],
      }),
    );
    renderWithLocale();
    fireEvent.change(screen.getByLabelText('Confirm your password'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await screen.findByLabelText('Six-digit code');
    fireEvent.click(screen.getByRole('button', { name: 'Verify and turn on' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(verifyTotp).not.toHaveBeenCalled();
  });

  it('cancel button resets the enrol flow', async () => {
    enable.mockResolvedValue(
      ok({
        totpURI: 'otpauth://totp/RankMeFast:alice?secret=SEC&issuer=RankMeFast',
        backupCodes: ['aaa-111'],
      }),
    );
    renderWithLocale();
    fireEvent.change(screen.getByLabelText('Confirm your password'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await screen.findByLabelText('Six-digit code');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Enable two-factor' })).toBeInTheDocument();
  });

  it('shows an enabled state and a disable flow when 2FA is on', async () => {
    useSession.mockReturnValue({
      data: { user: { id: 'u1', twoFactorEnabled: true } },
      isPending: false,
    });
    disable.mockResolvedValue(ok({}));
    renderWithLocale();
    expect(screen.getByTestId('two-factor-status')).toHaveTextContent(
      'Two-factor authentication is on.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disable two-factor' }));
    fireEvent.change(screen.getByLabelText('Confirm your password'), {
      target: { value: 'password' },
    });
    // The button label re-uses the disable text since it's the actual submit.
    const disableSubmit = screen.getAllByRole('button', { name: 'Disable two-factor' })[0]!;
    fireEvent.click(disableSubmit);
    await waitFor(() => expect(disable).toHaveBeenCalled());
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Two-factor authentication is now off.'),
    );
  });

  it('disable rejects an empty code inline', async () => {
    useSession.mockReturnValue({
      data: { user: { id: 'u1', twoFactorEnabled: true } },
      isPending: false,
    });
    renderWithLocale();
    fireEvent.click(screen.getByRole('button', { name: 'Disable two-factor' }));
    const disableSubmit = screen.getAllByRole('button', { name: 'Disable two-factor' })[0]!;
    fireEvent.click(disableSubmit);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(disable).not.toHaveBeenCalled();
  });

  it('disable failure surfaces inline', async () => {
    useSession.mockReturnValue({
      data: { user: { id: 'u1', twoFactorEnabled: true } },
      isPending: false,
    });
    disable.mockResolvedValue(fail({ status: 400 }));
    renderWithLocale();
    fireEvent.click(screen.getByRole('button', { name: 'Disable two-factor' }));
    fireEvent.change(screen.getByLabelText('Confirm your password'), {
      target: { value: 'bad' },
    });
    const disableSubmit = screen.getAllByRole('button', { name: 'Disable two-factor' })[0]!;
    fireEvent.click(disableSubmit);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('disable Cancel closes the disable panel', async () => {
    useSession.mockReturnValue({
      data: { user: { id: 'u1', twoFactorEnabled: true } },
      isPending: false,
    });
    renderWithLocale();
    fireEvent.click(screen.getByRole('button', { name: 'Disable two-factor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // Back to the summary layout — only one disable button (the summary trigger).
    expect(screen.getAllByRole('button', { name: 'Disable two-factor' })).toHaveLength(1);
  });

  it('Copy secret writes to the clipboard and toasts', async () => {
    enable.mockResolvedValue(
      ok({
        totpURI: 'otpauth://totp/RankMeFast:alice?secret=SEC&issuer=RankMeFast',
        backupCodes: ['aaa-111'],
      }),
    );
    renderWithLocale();
    fireEvent.change(screen.getByLabelText('Confirm your password'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await screen.findByRole('button', { name: 'Copy secret' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy secret' }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('SEC'),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Secret copied.'));
  });

  it('Copy codes writes to the clipboard and toasts', async () => {
    enable.mockResolvedValue(
      ok({
        totpURI: 'otpauth://totp/RankMeFast:alice?secret=SEC&issuer=RankMeFast',
        backupCodes: ['aaa-111', 'bbb-222'],
      }),
    );
    renderWithLocale();
    fireEvent.change(screen.getByLabelText('Confirm your password'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await screen.findByRole('button', { name: 'Copy codes' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy codes' }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('aaa-111\nbbb-222'),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Backup codes copied.'));
  });

  it('Copy secret swallows a clipboard denial without crashing', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('denied');
        }),
      },
    });
    enable.mockResolvedValue(
      ok({
        totpURI: 'otpauth://totp/RankMeFast:alice?secret=SEC&issuer=RankMeFast',
        backupCodes: ['aaa-111'],
      }),
    );
    renderWithLocale();
    fireEvent.change(screen.getByLabelText('Confirm your password'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await screen.findByRole('button', { name: 'Copy secret' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy secret' }));
    // No throw; toast not called because writeText rejected.
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalled(),
    );
  });

  it('Download codes creates and clicks a blob anchor', async () => {
    enable.mockResolvedValue(
      ok({
        totpURI: 'otpauth://totp/RankMeFast:alice?secret=SEC&issuer=RankMeFast',
        backupCodes: ['aaa-111', 'bbb-222'],
      }),
    );
    // jsdom does not implement URL.createObjectURL — stub it in.
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = vi.fn(() => 'blob:x');
    (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = vi.fn();
    const createSpy = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
    const revokeSpy = URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderWithLocale();
    fireEvent.change(screen.getByLabelText('Confirm your password'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await screen.findByRole('button', { name: 'Download codes' });
    fireEvent.click(screen.getByRole('button', { name: 'Download codes' }));
    expect(createSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('preserves recovery-code order and never regenerates codes on a locale switch', async () => {
    enable.mockResolvedValue(
      ok({
        totpURI: 'otpauth://totp/RankMeFast:alice?secret=SEC&issuer=RankMeFast',
        backupCodes: ['aaa-111', 'bbb-222'],
      }),
    );
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = vi.fn(() => 'blob:x');
    (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderWithLocale();
    fireEvent.change(screen.getByLabelText('Confirm your password'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await screen.findByText('aaa-111');

    await act(async () => {
      await changeLanguage('ar');
    });
    expect(await screen.findByText('aaa-111')).toBeInTheDocument();
    expect(screen.getByText('bbb-222')).toBeInTheDocument();
    expect(enable).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', {
      name: i18n.t('twoFactor.downloadCodes', { ns: 'auth' }),
    }));
    const createObjectUrl = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
    const blob = createObjectUrl.mock.calls[0]?.[0] as Blob;
    const contents = await new Promise<string>((done) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => done(String(reader.result)));
      reader.readAsText(blob);
    });
    expect(contents).toBe('aaa-111\nbbb-222');
    expect(enable).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('QR generation failure still renders the manual secret', async () => {
    const qrcode = (await import('qrcode')).default;
    (qrcode.toDataURL as unknown as Mock).mockRejectedValueOnce(new Error('nope'));
    enable.mockResolvedValue(
      ok({
        totpURI: 'otpauth://totp/RankMeFast:alice?secret=OK&issuer=RankMeFast',
        backupCodes: ['a'],
      }),
    );
    renderWithLocale();
    fireEvent.change(screen.getByLabelText('Confirm your password'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await screen.findByLabelText('Manual entry code');
    expect(screen.queryByAltText('')).toBeNull();
  });

  it('null session falls through as not-enrolled', () => {
    useSession.mockReturnValue({ data: null, isPending: false });
    renderWithLocale();
    expect(screen.getByTestId('two-factor-status')).toHaveTextContent(
      'Two-factor authentication is off.',
    );
  });

  it('extractSecret picks the secret param', () => {
    expect(extractSecret('otpauth://totp/x?secret=ABC&issuer=y')).toBe('ABC');
    expect(extractSecret('otpauth://totp/x?issuer=y')).toBe('');
  });

  it('localized: French labels', async () => {
    // changeLanguage loads locale JSON via dynamic import — await it before
    // rendering so the first paint is already French (renderWithLocale's own
    // fire-and-forget call would otherwise race the beforeEach 'en' reset).
    await i18n.changeLanguage('fr');
    renderWithLocale('fr');
    expect(await screen.findByRole('button', { name: 'Activer' })).toBeInTheDocument();
  });
});
