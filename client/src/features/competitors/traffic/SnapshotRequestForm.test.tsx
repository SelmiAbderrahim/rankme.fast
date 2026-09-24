import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { SnapshotRequestForm, SpendPreviewCard } from './components/SnapshotRequestForm';
import { trafficSnapshotsReducer } from './store/slice';
import type { TrafficSpendPreview } from './types';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

const preview = (overrides: Partial<TrafficSpendPreview> = {}): TrafficSpendPreview => ({
  breakdown: [
    {
      operationKey: 'traffic:example.com',
      metric: 'traffic_snapshots',
      productUnits: 1,
      cachedStatus: 'cached',
    },
  ],
  ...overrides,
});

const renderForm = (siteId: string | null = '0123456789abcdef01234567') => {
  const store = configureStore({ reducer: { trafficSnapshots: trafficSnapshotsReducer } });
  return {
    store,
    ...render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <SnapshotRequestForm siteId={siteId ?? undefined} />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    ),
  };
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mockedApiClient.mockReset();
});

describe('SnapshotRequestForm', () => {
  it('mirrors domain zod validation, previews, shows cache status, then confirms', async () => {
    mockedApiClient.mockImplementation(async (path) => {
      if (String(path).endsWith('/preview')) return preview();
      return {
        runId: '0123456789abcdef01234567',
        status: 'queued',
        targetDomain: 'example.com',
        reservedUnits: 1,
        cached: true,
      };
    });
    renderForm();
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'Domain' });

    await user.type(input, 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    expect(await screen.findByText('Enter a valid public domain without a scheme or path.')).toBeVisible();

    await user.clear(input);
    await user.type(input, 'WWW.Example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    const card = await screen.findByTestId('traffic-preview');
    expect(within(card).getByText('example.com: Cached')).toBeVisible();
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm snapshot' }));
    await waitFor(() =>
      expect(mockedApiClient).toHaveBeenLastCalledWith(
        '/competitors/traffic-snapshots',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            targetDomain: 'example.com',
            siteId: '0123456789abcdef01234567',
          }),
        }),
      ),
    );
  });

  it('cancels a preview locally without starting a paid snapshot', async () => {
    mockedApiClient.mockResolvedValueOnce(preview());
    const { store } = renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('traffic-preview')).not.toBeInTheDocument();
    expect(store.getState().trafficSnapshots.preview).toBeNull();
    expect(mockedApiClient).toHaveBeenCalledTimes(1);
  });

  it('renders the localized kill-switch locked preview failure', async () => {
    mockedApiClient.mockRejectedValueOnce(
      new ApiError('locked', 503, { error: { message: 'Traffic Insights is paused.' } }),
    );
    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    expect(await screen.findByText('Traffic Insights is paused.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Domain' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm snapshot' })).toBeDisabled();
  });

  it('surfaces request-time and unknown preview failures', async () => {
    mockedApiClient
      .mockResolvedValueOnce(preview())
      .mockRejectedValueOnce(
        new ApiError('bad request', 400, { error: { message: 'Request rejected.' } }),
      );
    const first = renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm snapshot' }));
    expect(await screen.findByText('Request rejected.')).toBeVisible();
    first.unmount();

    mockedApiClient.mockRejectedValueOnce(new Error('offline'));
    renderForm();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    expect(await screen.findByText('Could not prepare the spend preview.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm snapshot' })).toBeDisabled();
  });

  it('uses the shared button loading state while preview and request are pending', async () => {
    let resolvePreview!: (value: TrafficSpendPreview) => void;
    mockedApiClient.mockReturnValueOnce(
      new Promise<TrafficSpendPreview>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    expect(screen.getByRole('button', { name: 'Preparing preview…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    resolvePreview(preview());
    expect(await screen.findByRole('button', { name: 'Confirm snapshot' })).toBeEnabled();
  });

  it('adopts a late site-domain default but never overwrites user input', async () => {
    mockedApiClient.mockResolvedValue(preview());
    const store = configureStore({ reducer: { trafficSnapshots: trafficSnapshotsReducer } });
    const ui = (initialDomain?: string) => (
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <SnapshotRequestForm initialDomain={initialDomain} />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>
    );
    const view = render(ui());
    const input = screen.getByRole('textbox', { name: 'Domain' });
    expect(input).toHaveValue('');

    // The sites slice resolved after mount — adopt its domain as the default.
    view.rerender(ui('pulsy.org'));
    expect(input).toHaveValue('pulsy.org');

    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, 'other.example');
    view.rerender(ui('changed.example'));
    expect(input).toHaveValue('other.example');
  });

  it('submits without a site id from a siteless mount', async () => {
    mockedApiClient
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce({
        runId: '0123456789abcdef01234567',
        status: 'queued',
        targetDomain: 'example.com',
        reservedUnits: 1,
        cached: false,
      });
    renderForm(null);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm snapshot' }));
    await waitFor(() => {
      const body = mockedApiClient.mock.calls[1]?.[1]?.body as Record<string, unknown>;
      expect(body).not.toHaveProperty('siteId');
    });
  });
});

describe('SpendPreviewCard', () => {
  const renderCard = (value: TrafficSpendPreview | null, loading: boolean) =>
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <SpendPreviewCard preview={value} loading={loading} />
        </MemoryRouter>
      </I18nextProvider>,
    );

  it('covers loading, empty, fresh badge, and no-breakdown states', () => {
    const loading = renderCard(null, true);
    expect(screen.getByTestId('traffic-preview-loading')).toBeVisible();
    loading.unmount();
    expect(renderCard(null, false).container).toBeEmptyDOMElement();

    const fresh = renderCard(
      preview({
        breakdown: [
          {
            operationKey: 'traffic:fresh.example',
            metric: 'traffic_snapshots',
            productUnits: 1,
            cachedStatus: 'fresh_required',
          },
        ],
      }),
      false,
    );
    expect(screen.getByText('fresh.example: Fresh lookup')).toBeVisible();
    fresh.unmount();

    renderCard({}, false);
    expect(screen.getByTestId('traffic-preview')).toHaveTextContent(
      "This request uses the operator's configured traffic-data provider.",
    );
  });
});
