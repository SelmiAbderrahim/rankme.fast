import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { DeleteAccount } from './DeleteAccount';
import {
  cancelAccountDeletion,
  deleteAccount,
  getAccountDeletionStatus,
} from '../api';
import { useAuthSession } from '../useAuthSession';
import { ApiError } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';

vi.mock('../api', () => ({
  cancelAccountDeletion: vi.fn(),
  deleteAccount: vi.fn(),
  getAccountDeletionStatus: vi.fn(),
}));
vi.mock('../useAuthSession', () => ({ useAuthSession: vi.fn() }));

const deleteAccountMock = deleteAccount as unknown as Mock;
const cancelAccountDeletionMock = cancelAccountDeletion as unknown as Mock;
const getAccountDeletionStatusMock = getAccountDeletionStatus as unknown as Mock;
const useAuthSessionMock = useAuthSession as unknown as Mock;

const scheduled = (purgeAt = '2026-08-05T00:00:00.000Z') => ({
  scheduledAt: '2026-07-06T00:00:00.000Z',
  purgeAt,
  warningEmailQueued: true,
});

const renderWithLocale = (locale = 'en') => {
  initI18n({ initialLocale: 'en' });
  void i18n.changeLanguage(locale);
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <DeleteAccount />
      </MemoryRouter>
    </I18nextProvider>,
  );
};

const arm = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
  fireEvent.change(screen.getByLabelText('Confirm your email address'), {
    target: { value: 'me@x.co' },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  document.documentElement.classList.remove('dark');
  initI18n({ initialLocale: 'en' });
  void i18n.changeLanguage('en');
  useAuthSessionMock.mockReturnValue({
    authenticated: true,
    isPending: false,
    emailVerified: true,
    user: { id: 'u1', email: 'me@x.co', emailVerified: true },
  });
  getAccountDeletionStatusMock.mockResolvedValue({
    scheduledAt: null,
    startedAt: null,
    cancellable: false,
  });
});

describe('DeleteAccount', () => {
  it('renders the danger-zone description and a delete trigger', () => {
    renderWithLocale();
    expect(screen.getByText('Delete account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeInTheDocument();
  });

  it('keeps the destructive action disabled until the email matches', () => {
    renderWithLocale();
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    const confirmBtn = screen.getByRole('button', { name: 'Delete my account' });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Confirm your email address'), {
      target: { value: 'wrong@x.co' },
    });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Confirm your email address'), {
      target: { value: 'me@x.co' },
    });
    expect(confirmBtn).toBeEnabled();
  });

  it('schedules deletion and shows the scheduled-until date on success', async () => {
    deleteAccountMock.mockResolvedValue(scheduled());
    renderWithLocale();
    arm();
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(deleteAccountMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('status')).toHaveTextContent('scheduled for deletion on');
  });

  it('restores a persisted grace-period schedule and cancels it through the live route', async () => {
    getAccountDeletionStatusMock.mockResolvedValue({
      scheduledAt: '2026-08-05T00:00:00.000Z',
      startedAt: null,
      cancellable: true,
    });
    cancelAccountDeletionMock.mockResolvedValue({
      cancelledAt: '2026-07-06T00:00:00.000Z',
    });
    renderWithLocale();
    const cancel = await screen.findByRole('button', {
      name: 'Cancel scheduled deletion',
    });
    fireEvent.click(cancel);
    await waitFor(() => expect(cancelAccountDeletionMock).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeInTheDocument();
  });

  it('keeps the schedule and surfaces an error when the cancel call fails', async () => {
    getAccountDeletionStatusMock.mockResolvedValue({
      scheduledAt: '2026-08-05T00:00:00.000Z',
      startedAt: null,
      cancellable: true,
    });
    cancelAccountDeletionMock.mockRejectedValue(new ApiError('boom', 500, {}));
    renderWithLocale();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Cancel scheduled deletion' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not cancel deletion. Try again.',
    );
    // The schedule survives a failed cancel — the notice and the retry button
    // both stay on screen.
    expect(screen.getByRole('status')).toHaveTextContent('scheduled for deletion on');
    expect(
      screen.getByRole('button', { name: 'Cancel scheduled deletion' }),
    ).toBeInTheDocument();
  });

  it('shows the already-scheduled message on a 409', async () => {
    deleteAccountMock.mockRejectedValue(new ApiError('conflict', 409, {}));
    renderWithLocale();
    arm();
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your account is already scheduled for deletion.',
    );
  });

  it('shows a generic error on any other failure', async () => {
    deleteAccountMock.mockRejectedValue(new ApiError('boom', 500, {}));
    renderWithLocale();
    arm();
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not schedule deletion. Try again.',
    );
  });

  it('disables the button and shows progress while the request is in flight', async () => {
    let resolve!: (v: ReturnType<typeof scheduled>) => void;
    deleteAccountMock.mockReturnValue(new Promise((r) => (resolve = r)));
    renderWithLocale();
    arm();
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByRole('button', { name: 'Scheduling…' })).toBeDisabled();
    resolve(scheduled());
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('cancels back to the initial state', () => {
    renderWithLocale();
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Confirm your email address')).not.toBeInTheDocument();
  });

  it('never arms when the session has no email', () => {
    useAuthSessionMock.mockReturnValue({
      authenticated: true,
      isPending: false,
      emailVerified: true,
      user: null,
    });
    renderWithLocale();
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    fireEvent.change(screen.getByLabelText('Confirm your email address'), {
      target: { value: '' },
    });
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
  });

  it('renders in Arabic (RTL) and dark mode without crashing', async () => {
    document.documentElement.classList.add('dark');
    renderWithLocale('ar');
    expect(await screen.findByText('حذف الحساب')).toBeInTheDocument();
  });

  it('formats the scheduled date with the active locale (fr), not a bare toLocaleDateString', async () => {
    deleteAccountMock.mockResolvedValue(scheduled('2026-08-05T00:00:00.000Z'));
    renderWithLocale('fr');
    // Settle the (otherwise fire-and-forget) language switch so the component
    // formats the date with i18n.language === 'fr' at submit time.
    await changeLanguage('fr');
    const label = (k: string) => i18n.t(`security.deletion.${k}`, { ns: 'auth' });
    fireEvent.click(await screen.findByRole('button', { name: label('delete') }));
    fireEvent.change(screen.getByLabelText(label('confirmLabel')), {
      target: { value: 'me@x.co' },
    });
    fireEvent.click(screen.getByRole('button', { name: label('delete') }));
    // The component formats via Intl.DateTimeFormat(i18n.language, …) — the same
    // locale-aware formatter, so the fr-medium date must appear verbatim (a bare
    // toLocaleDateString() would render the en-US "Aug 5, 2026" instead).
    const expected = new Intl.DateTimeFormat('fr', { dateStyle: 'medium' }).format(
      new Date('2026-08-05T00:00:00.000Z'),
    );
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(expected);
  });
});
