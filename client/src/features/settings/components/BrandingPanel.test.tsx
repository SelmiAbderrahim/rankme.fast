/**
 * BrandingPanel (?tab=branding — workstream B): load/hydrate, client-side
 * hex validation, save flow with the shared in-button loading affordance,
 * and localized error states.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { configureStore } from '@reduxjs/toolkit';
import { ApiError } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from '../api';
import { brandingReducer } from '../store/brandingSlice';
import { loadBranding, saveBranding } from '../store/brandingThunks';
import { BrandingPanel } from './BrandingPanel';

vi.mock('../api', () => ({
  getNotificationPreferencesRequest: vi.fn(),
  patchNotificationPreferencesRequest: vi.fn(),
  listApiKeysRequest: vi.fn(),
  createApiKeyRequest: vi.fn(),
  revokeApiKeyRequest: vi.fn(),
  getBrandingRequest: vi.fn(),
  putBrandingRequest: vi.fn(),
}));

const mocked = vi.mocked(api);

const apiError = (status: number, message: string) =>
  new ApiError(`status ${status}`, status, { error: { message } });

const makeStore = () => configureStore({ reducer: { branding: brandingReducer } });
type Store = ReturnType<typeof makeStore>;

const renderPanel = (store: Store = makeStore()) => {
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <BrandingPanel />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return store;
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  mocked.getBrandingRequest.mockResolvedValue({
    branding: { companyName: 'Acme SEO', accentColor: '#3366ff', logoDataUrl: null },
  });
});

describe('BrandingPanel', () => {
  it('loads on mount and hydrates the form with stored values', async () => {
    renderPanel();
    expect(await screen.findByDisplayValue('Acme SEO')).toBeInTheDocument();
    expect(screen.getByDisplayValue('#3366ff')).toBeInTheDocument();
    expect(mocked.getBrandingRequest).toHaveBeenCalledTimes(1);
    // Valid color → the preview swatch carries the picked background.
    expect(screen.getByTestId('branding-swatch')).toHaveStyle({
      backgroundColor: '#3366ff',
    });
  });

  it('shows a skeleton while loading', () => {
    mocked.getBrandingRequest.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByTestId('branding-skeleton')).toBeInTheDocument();
  });

  it('surfaces a load error', async () => {
    mocked.getBrandingRequest.mockRejectedValue(new Error('offline'));
    renderPanel();
    expect(
      await screen.findByText("We couldn't load your branding. Please refresh."),
    ).toBeInTheDocument();
  });

  it('validates the accent color before submitting', async () => {
    renderPanel();
    // Wait for the async load to hydrate the inputs BEFORE clearing —
    // clearing first races the hydration and the loaded value reappears.
    await screen.findByDisplayValue('Acme SEO');
    const colorInput = screen.getByLabelText('Accent color');
    await userEvent.clear(colorInput);
    await userEvent.type(colorInput, '#zzz');
    await userEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(
      await screen.findByText('Enter a color like #b5321e, or leave it empty.'),
    ).toBeInTheDocument();
    expect(mocked.putBrandingRequest).not.toHaveBeenCalled();
  });

  it('saves trimmed values and confirms', async () => {
    mocked.putBrandingRequest.mockResolvedValue({
      branding: { companyName: 'New Name', accentColor: '#b5321e', logoDataUrl: null },
    });
    renderPanel();
    // Hydration must land before we clear (see note above).
    await screen.findByDisplayValue('Acme SEO');
    const nameInput = screen.getByLabelText('Company name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, '  New Name  ');
    const colorInput = screen.getByLabelText('Accent color');
    await userEvent.clear(colorInput);
    await userEvent.type(colorInput, '#b5321e');
    await userEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(await screen.findByText('Branding saved.')).toBeInTheDocument();
    expect(mocked.putBrandingRequest).toHaveBeenCalledWith({
      companyName: 'New Name',
      accentColor: '#b5321e',
      logoDataUrl: null,
    });
  });

  it('accepts clearing both fields (empty accent allowed)', async () => {
    mocked.putBrandingRequest.mockResolvedValue({
      branding: { companyName: '', accentColor: '', logoDataUrl: null },
    });
    renderPanel();
    // Hydration must land before we clear (see note above).
    await screen.findByDisplayValue('Acme SEO');
    const nameInput = screen.getByLabelText('Company name');
    await userEvent.clear(nameInput);
    const colorInput = screen.getByLabelText('Accent color');
    await userEvent.clear(colorInput);
    await userEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() =>
      expect(mocked.putBrandingRequest).toHaveBeenCalledWith({
        companyName: '',
        accentColor: '',
        logoDataUrl: null,
      }),
    );
  });

  it('shows the server-localized message for other save failures', async () => {
    mocked.putBrandingRequest.mockRejectedValue(apiError(500, 'Server exploded.'));
    renderPanel();
    await screen.findByLabelText('Company name');
    await userEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(await screen.findByText('Server exploded.')).toBeInTheDocument();
  });

  it('falls back to the client-side save error for network failures', async () => {
    mocked.putBrandingRequest.mockRejectedValue(new TypeError('offline'));
    renderPanel();
    await screen.findByLabelText('Company name');
    await userEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(
      await screen.findByText("We couldn't save your branding. Please try again."),
    ).toBeInTheDocument();
  });

  it('does not refetch when the store is already loaded', async () => {
    const store = makeStore();
    mocked.getBrandingRequest.mockResolvedValue({
      branding: { companyName: 'Seeded', accentColor: '', logoDataUrl: null },
    });
    await store.dispatch(loadBranding());
    mocked.getBrandingRequest.mockClear();
    renderPanel(store);
    expect(await screen.findByDisplayValue('Seeded')).toBeInTheDocument();
    expect(mocked.getBrandingRequest).not.toHaveBeenCalled();
  });

  it('previews a stored logo and persists explicit removal', async () => {
    mocked.getBrandingRequest.mockResolvedValue({
      branding: {
        companyName: 'Acme SEO',
        accentColor: '#3366ff',
        logoDataUrl: 'data:image/png;base64,c3RvcmVk',
      },
    });
    mocked.putBrandingRequest.mockResolvedValue({
      branding: { companyName: 'Acme SEO', accentColor: '#3366ff', logoDataUrl: null },
    });
    renderPanel();
    expect(await screen.findByAltText('Company logo preview')).toHaveAttribute(
      'src',
      'data:image/png;base64,c3RvcmVk',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove logo' }));
    expect(screen.queryByAltText('Company logo preview')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() => expect(mocked.putBrandingRequest).toHaveBeenCalledWith({
      companyName: 'Acme SEO',
      accentColor: '#3366ff',
      logoDataUrl: null,
    }));
  });

  it('loads a valid PNG into the bounded preview before saving', async () => {
    mocked.putBrandingRequest.mockImplementation(async (branding) => ({ branding }));
    renderPanel();
    await screen.findByDisplayValue('Acme SEO');
    const input = screen.getByLabelText('Company logo') as HTMLInputElement;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', {
      type: 'image/png',
    });
    await userEvent.upload(input, file);
    const preview = await screen.findByAltText('Company logo preview');
    expect(preview.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    await userEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() => expect(mocked.putBrandingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ logoDataUrl: expect.stringMatching(/^data:image\/png;base64,/) }),
    ));
  });

  it('rejects non-PNG and oversized files without previewing them', async () => {
    renderPanel();
    await screen.findByDisplayValue('Acme SEO');
    const input = screen.getByLabelText('Company logo') as HTMLInputElement;
    await userEvent.upload(input, new File(['gif'], 'logo.gif', { type: 'image/gif' }), {
      applyAccept: false,
    });
    expect(await screen.findByText('Choose a PNG image.')).toBeInTheDocument();
    expect(input.value).toBe('');

    await userEvent.upload(
      input,
      new File([new Uint8Array(256 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    );
    expect(await screen.findByText('Choose a PNG smaller than 256 KB.')).toBeInTheDocument();
    expect(screen.queryByAltText('Company logo preview')).not.toBeInTheDocument();
  });

  it('handles an empty selection, a reader error, and a non-string reader result', async () => {
    renderPanel();
    await screen.findByDisplayValue('Acme SEO');
    const input = screen.getByLabelText('Company logo') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });

    const OriginalReader = FileReader;
    class FakeReader {
      result: string | ArrayBuffer | null = null;
      private listeners: Record<string, Array<() => void>> = {};
      addEventListener(name: string, listener: () => void) {
        this.listeners[name] ??= [];
        this.listeners[name]!.push(listener);
      }
      readAsDataURL(file: File) {
        if (file.name === 'error.png') this.listeners.error?.forEach((listener) => listener());
        else {
          this.result = new ArrayBuffer(1);
          this.listeners.load?.forEach((listener) => listener());
        }
      }
    }
    vi.stubGlobal('FileReader', FakeReader);
    await userEvent.upload(input, new File(['png'], 'error.png', { type: 'image/png' }));
    expect(await screen.findByText("We couldn't read that image. Choose another PNG.")).toBeInTheDocument();
    await userEvent.upload(input, new File(['png'], 'array.png', { type: 'image/png' }));
    expect(screen.queryByAltText('Company logo preview')).not.toBeInTheDocument();
    vi.stubGlobal('FileReader', OriginalReader);
  });
});

describe('branding slice (store-level)', () => {
  it('treats payload-less rejections as plain failures', () => {
    const store = makeStore();
    store.dispatch(loadBranding.rejected(new Error('aborted'), 'req-1'));
    expect(store.getState().branding.loadError).toBe('');
    expect(store.getState().branding.loaded).toBe(true);
    store.dispatch(
      saveBranding.rejected(new Error('aborted'), 'req-2', {
        companyName: '',
        accentColor: '',
        logoDataUrl: null,
      }),
    );
    expect(store.getState().branding.saveError).toBe('');
  });
});
