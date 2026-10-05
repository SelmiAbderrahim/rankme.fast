import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from '../api';
import type { DataExport } from '../types';
import { ExportData } from './ExportData';

vi.mock('../api', () => ({
  exportMyDataRequest: vi.fn(),
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
