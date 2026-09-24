import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import {
  changeLanguage,
  i18n,
  initI18n,
  requestPresentationRefresh,
} from '@shared/i18n';
import * as api from '../api';
import type { AccountDeletionResult, DataExport } from '../types';
import { ExportData } from './ExportData';
import { DeleteAccount } from './DeleteAccount';

vi.mock('../api', () => ({
  exportMyDataRequest: vi.fn(),
  fetchCsrfToken: vi.fn(),
  deleteAccountRequest: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockedApi = vi.mocked(api);
const { toast } = await import('sonner');
const toastSuccess = toast.success as unknown as Mock;

const renderNode = (node: React.ReactNode) =>
  render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  // jsdom has no object-URL support — stub it for the download path.
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

describe('ExportData', () => {
  it('downloads the export and toasts on success', async () => {
    mockedApi.exportMyDataRequest.mockResolvedValue({ account: { id: 'u-1' } });
    renderNode(<ExportData />);
    await userEvent.click(screen.getByRole('button', { name: 'Export my data' }));
    await waitFor(() => expect(mockedApi.exportMyDataRequest).toHaveBeenCalled());
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Your data export has downloaded.');
  });

  it('does not replay or rewrite an accepted export when the locale changes', async () => {
    const exported = {
      account: { id: 'u-1', email: 'source@example.test', note: 'نص مصدر' },
    };
    let resolve!: (value: DataExport) => void;
    mockedApi.exportMyDataRequest.mockReturnValue(new Promise((done) => {
      resolve = done;
    }));
    renderNode(<ExportData />);
    await userEvent.click(screen.getByRole('button', { name: 'Export my data' }));
    await waitFor(() => expect(mockedApi.exportMyDataRequest).toHaveBeenCalledTimes(1));

    await changeLanguage('ar');
    resolve(exported);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));

    expect(mockedApi.exportMyDataRequest).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    const contents = await new Promise<string>((done) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => done(String(reader.result)));
      reader.readAsText(blob);
    });
    expect(JSON.parse(contents)).toEqual(exported);
  });

  it('shows an error when the export fails', async () => {
    mockedApi.exportMyDataRequest.mockRejectedValue(new Error('boom'));
    renderNode(<ExportData />);
    await userEvent.click(screen.getByRole('button', { name: 'Export my data' }));
    expect(
      await screen.findByText("We couldn't export your data. Please try again."),
    ).toBeInTheDocument();
  });

  it('shows the shared loading affordance while exporting and restores it on success', async () => {
    let resolve!: (value: DataExport) => void;
    mockedApi.exportMyDataRequest.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderNode(<ExportData />);
    await userEvent.click(screen.getByRole('button', { name: 'Export my data' }));
    const pending = await screen.findByRole('button', { name: 'Preparing…' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(pending.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
    resolve({ account: { id: 'u-1' } });
    const restored = await screen.findByRole('button', { name: 'Export my data' });
    expect(restored).not.toHaveAttribute('aria-busy');
    expect(restored.querySelector('[data-slot="spinner"]')).not.toBeInTheDocument();
  });

  it('restores the export button after a failed export', async () => {
    mockedApi.exportMyDataRequest.mockRejectedValue(new Error('boom'));
    renderNode(<ExportData />);
    await userEvent.click(screen.getByRole('button', { name: 'Export my data' }));
    await screen.findByText("We couldn't export your data. Please try again.");
    const restored = screen.getByRole('button', { name: 'Export my data' });
    expect(restored).not.toHaveAttribute('aria-busy');
    expect(restored.querySelector('[data-slot="spinner"]')).not.toBeInTheDocument();
  });
});

describe('DeleteAccount', () => {
  it('clears component-local server copy on a presentation refresh', () => {
    renderNode(<DeleteAccount />);

    act(() => {
      requestPresentationRefresh();
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('fetches a CSRF token, schedules deletion, and shows the date', async () => {
    mockedApi.fetchCsrfToken.mockResolvedValue({ csrfToken: 'tok-9' });
    mockedApi.deleteAccountRequest.mockResolvedValue({
      scheduledAt: '2026-08-01T00:00:00.000Z',
      purgeAt: '2026-08-31T00:00:00.000Z',
      warningEmailQueued: false,
    });
    renderNode(<DeleteAccount />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    await waitFor(() =>
      expect(mockedApi.deleteAccountRequest).toHaveBeenCalledWith('tok-9'),
    );
    expect(mockedApi.fetchCsrfToken).toHaveBeenCalled();
    expect(await screen.findByText(/scheduled for deletion on/)).toBeInTheDocument();
  });

  it('closes the dialog on cancel without calling the API', async () => {
    renderNode(<DeleteAccount />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(screen.getByText('Delete your account?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByText('Delete your account?')).not.toBeInTheDocument(),
    );
    expect(mockedApi.deleteAccountRequest).not.toHaveBeenCalled();
  });

  it('surfaces an error when scheduling fails', async () => {
    mockedApi.fetchCsrfToken.mockResolvedValue({ csrfToken: 'tok-9' });
    mockedApi.deleteAccountRequest.mockRejectedValue(new Error('nope'));
    renderNode(<DeleteAccount />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));
    expect(
      await screen.findByText("We couldn't schedule deletion. Please try again."),
    ).toBeInTheDocument();
  });

  it('shows the shared loading affordance while scheduling and unmounts it on success', async () => {
    mockedApi.fetchCsrfToken.mockResolvedValue({ csrfToken: 'tok-9' });
    let resolve!: (value: AccountDeletionResult) => void;
    mockedApi.deleteAccountRequest.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderNode(<DeleteAccount />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));
    const pending = await screen.findByRole('button', { name: 'Scheduling…' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(pending.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
    resolve({
      scheduledAt: '2026-08-01T00:00:00.000Z',
      purgeAt: '2026-08-31T00:00:00.000Z',
      warningEmailQueued: false,
    });
    // Success closes the dialog and swaps in the scheduled banner → the button unmounts.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Scheduling…' })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText(/scheduled for deletion on/)).toBeInTheDocument();
  });

  it('restores the confirm button after a failed deletion', async () => {
    mockedApi.fetchCsrfToken.mockResolvedValue({ csrfToken: 'tok-9' });
    mockedApi.deleteAccountRequest.mockRejectedValue(new Error('nope'));
    renderNode(<DeleteAccount />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));
    await screen.findByText("We couldn't schedule deletion. Please try again.");
    const restored = screen.getByRole('button', { name: 'Yes, delete my account' });
    expect(restored).not.toHaveAttribute('aria-busy');
    expect(restored.querySelector('[data-slot="spinner"]')).not.toBeInTheDocument();
  });
});
