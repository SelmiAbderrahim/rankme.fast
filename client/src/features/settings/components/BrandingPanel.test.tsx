/**
 * BrandingPanel (?tab=branding — workstream B): load/hydrate, client-side
 * hex validation, save flow with the shared in-button loading affordance,
 * and localized error states.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    expect(screen.getByLabelText('Accent color')).toHaveValue('#3366ff');
    expect(mocked.getBrandingRequest).toHaveBeenCalledTimes(1);
    // Valid color → the swatch/picker carries the stored value.
    expect(screen.getByTestId('branding-swatch')).toHaveValue('#3366ff');
    expect(screen.getByLabelText('Pick accent color')).toHaveAttribute('type', 'color');
  });

  it('binds a real color picker to the hex field and shows the default when empty', async () => {
    mocked.putBrandingRequest.mockImplementation(async (branding) => ({ branding }));
    renderPanel();
    await screen.findByDisplayValue('Acme SEO');
    const hexInput = screen.getByLabelText('Accent color');
    const picker = screen.getByLabelText('Pick accent color');
    // No placeholder colour that differs from what the swatch shows.
    expect(hexInput).toHaveAttribute('placeholder', '#b5321e');

    await userEvent.clear(hexInput);
    expect(picker).toHaveValue('#b5321e');
    await userEvent.type(hexInput, '#12');
    expect(picker).toHaveValue('#b5321e');
    await userEvent.type(hexInput, '34AB');
    expect(picker).toHaveValue('#1234ab');

    // An invalid value's error clears once the picker supplies a valid one.
    await userEvent.clear(hexInput);
    await userEvent.type(hexInput, '#zzz');
    await userEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(
      await screen.findByText('Enter a color like #b5321e, or leave it empty.'),
    ).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: '#00aa55' } });
    expect(hexInput).toHaveValue('#00aa55');
    expect(
      screen.queryByText('Enter a color like #b5321e, or leave it empty.'),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() => expect(mocked.putBrandingRequest).toHaveBeenCalledWith({
      companyName: 'Acme SEO',
      accentColor: '#00aa55',
      logoDataUrl: null,
    }));
  });

  it('replaces the raw file input with a styled chooser and a file-name line', async () => {
    renderPanel();
    await screen.findByDisplayValue('Acme SEO');
    const input = screen.getByLabelText('Company logo') as HTMLInputElement;
    expect(input).toHaveClass('sr-only');
    expect(input).toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('branding-logo-file')).toHaveTextContent('No file chosen');

    const clickSpy = vi.spyOn(input, 'click');
    const chooser = screen.getByRole('button', { name: 'Choose image' });
    expect(chooser).toHaveAttribute('aria-describedby', 'branding-logo-help branding-logo-file');
    await userEvent.click(chooser);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    await userEvent.upload(
      input,
      new File([new Uint8Array([137, 80, 78, 71])], 'brand-mark.png', { type: 'image/png' }),
    );
    await screen.findByAltText('Company logo preview');
    expect(screen.getByTestId('branding-logo-file')).toHaveTextContent('brand-mark.png');

    await userEvent.click(screen.getByRole('button', { name: 'Remove logo' }));
    expect(screen.getByTestId('branding-logo-file')).toHaveTextContent('No file chosen');
    expect(input.value).toBe('');
  });

  it('labels a stored logo that was not picked in this session', async () => {
    mocked.getBrandingRequest.mockResolvedValue({
      branding: {
        companyName: 'Acme SEO',
        accentColor: '',
        logoDataUrl: 'data:image/png;base64,c3RvcmVk',
      },
    });
    renderPanel();
    await screen.findByAltText('Company logo preview');
    expect(screen.getByTestId('branding-logo-file')).toHaveTextContent('Saved logo in use');
    expect(screen.getByTestId('branding-swatch')).toHaveValue('#b5321e');
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

  it('accepts clearing the accent (an empty accent uses the default) but not the company name', async () => {
    mocked.putBrandingRequest.mockResolvedValue({
      branding: { companyName: 'Acme SEO', accentColor: '', logoDataUrl: null },
    });
    renderPanel();
    // Hydration must land before we clear (see note above).
    await screen.findByDisplayValue('Acme SEO');
    const colorInput = screen.getByLabelText('Accent color');
    await userEvent.clear(colorInput);
    await userEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() =>
      expect(mocked.putBrandingRequest).toHaveBeenCalledWith({
        companyName: 'Acme SEO',
        accentColor: '',
        logoDataUrl: null,
      }),
    );
  });

  it.each(['', '   '])('refuses to save a blank company name %j, with the error on the field', async (blank) => {
    renderPanel();
    await screen.findByDisplayValue('Acme SEO');
    const nameInput = screen.getByLabelText('Company name');
    await userEvent.clear(nameInput);
    if (blank) await userEvent.type(nameInput, blank);
    await userEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(await screen.findByText('Enter your company name.')).toBeInTheDocument();
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAccessibleDescription('Enter your company name.');
    expect(mocked.putBrandingRequest).not.toHaveBeenCalled();
    // The error clears as soon as there is a name.
    await userEvent.type(nameInput, 'A');
    expect(screen.queryByText('Enter your company name.')).toBeNull();
  });

  it('shows the PDF header preview from the same values, including unsaved edits', async () => {
    mocked.getBrandingRequest.mockResolvedValue({
      branding: { companyName: 'Acme SEO', accentColor: '#112233', logoDataUrl: 'data:image/png;base64,c3RvcmVk' },
    });
    renderPanel();
    await screen.findByDisplayValue('Acme SEO');
    const preview = screen.getByTestId('branding-preview');
    expect(within(preview).getByText('PDF header preview')).toBeInTheDocument();
    expect(within(preview).getByTestId('branding-preview-name')).toHaveTextContent('Acme SEO');
    expect(within(preview).getByTestId('branding-preview-logo')).toHaveAttribute('src', 'data:image/png;base64,c3RvcmVk');
    // The saved color is used as saved, never replaced by the default.
    expect(within(preview).getByTestId('branding-preview-rule')).toHaveStyle({ backgroundColor: '#112233' });
    expect(within(preview).getByTestId('branding-preview-heading')).toHaveStyle({ color: '#112233' });

    // Unsaved edits show at once: a new name and a new color.
    const nameInput = screen.getByLabelText('Company name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Beta Studio');
    const colorInput = screen.getByLabelText('Accent color');
    await userEvent.clear(colorInput);
    await userEvent.type(colorInput, '#00aa55');
    expect(within(preview).getByTestId('branding-preview-name')).toHaveTextContent('Beta Studio');
    expect(within(preview).getByTestId('branding-preview-rule')).toHaveStyle({ backgroundColor: '#00aa55' });
    expect(mocked.putBrandingRequest).not.toHaveBeenCalled();
  });

  it('previews the default accent and the product name when nothing is chosen', async () => {
    mocked.getBrandingRequest.mockResolvedValue({
      branding: { companyName: 'Acme SEO', accentColor: '', logoDataUrl: null },
    });
    renderPanel();
    await screen.findByDisplayValue('Acme SEO');
    const nameInput = screen.getByLabelText('Company name');
    await userEvent.clear(nameInput);
    const preview = screen.getByTestId('branding-preview');
    expect(within(preview).getByTestId('branding-preview-name')).toHaveTextContent('RankMeFast');
    expect(within(preview).getByTestId('branding-preview-rule')).toHaveStyle({ backgroundColor: '#b5321e' });
    expect(within(preview).queryByTestId('branding-preview-logo')).toBeNull();
    // A half-typed color falls back to the default rather than a broken swatch.
    const colorInput = screen.getByLabelText('Accent color');
    await userEvent.type(colorInput, '#zz');
    expect(within(preview).getByTestId('branding-preview-rule')).toHaveStyle({ backgroundColor: '#b5321e' });
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

  it('accepts JPEG and SVG logos alongside PNG', async () => {
    mocked.putBrandingRequest.mockImplementation(async (branding) => ({ branding }));
    renderPanel();
    await screen.findByDisplayValue('Acme SEO');
    const input = screen.getByLabelText('Company logo') as HTMLInputElement;
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/svg+xml');
    expect(screen.getByText(/PNG, JPEG or SVG, up to 256 KB/)).toBeInTheDocument();
    for (const [name, type] of [
      ['logo.jpg', 'image/jpeg'],
      ['logo.svg', 'image/svg+xml'],
    ] as const) {
      await userEvent.upload(input, new File(['x'], name, { type }));
      expect(await screen.findByTestId('branding-logo-file')).toHaveTextContent(name);
      expect(screen.getByAltText('Company logo preview').getAttribute('src')).toMatch(
        new RegExp(`^data:${type.replace('+', '\\+')};base64,`),
      );
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects other image types and oversized files without previewing them', async () => {
    renderPanel();
    await screen.findByDisplayValue('Acme SEO');
    const input = screen.getByLabelText('Company logo') as HTMLInputElement;
    await userEvent.upload(input, new File(['gif'], 'logo.gif', { type: 'image/gif' }), {
      applyAccept: false,
    });
    expect(await screen.findByText('Choose a PNG, JPEG or SVG image.')).toBeInTheDocument();
    expect(input.value).toBe('');

    await userEvent.upload(
      input,
      new File([new Uint8Array(256 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    );
    expect(await screen.findByText('Choose an image smaller than 256 KB.')).toBeInTheDocument();
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
    expect(await screen.findByText("We couldn't read that image. Choose another file.")).toBeInTheDocument();
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
