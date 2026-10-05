import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
    expect(within(card).getByText('Domain').nextSibling).toHaveTextContent('example.com');
    // Confirm / Cancel live in the card footer, not detached beneath it.
    expect(within(card).getByRole('button', { name: 'Confirm snapshot' })).toBeVisible();
    expect(within(card).getByRole('button', { name: 'Cancel' })).toBeVisible();

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
      "This request uses the configured traffic-data provider.",
    );
  });

  it('says the allowance is not metered when the server sends no numbers', () => {
    renderCard({}, false);
    const card = screen.getByTestId('traffic-preview');
    expect(within(card).getByText('Allowance impact')).toBeVisible();
    expect(within(card).getByTestId('traffic-preview-impact')).toHaveTextContent(
      'Not metered on this server',
    );
    expect(within(card).getByText('Market')).toBeVisible();
    expect(within(card).queryByText('Base allowance remaining')).not.toBeInTheDocument();
    expect(within(card).queryByText('Domain')).not.toBeInTheDocument();
  });

  it('shows units, remaining allowance, market and domain when the server meters usage', () => {
    renderCard(
      preview({ productUnits: 2, remainingBaseUnits: 1234, remainingPackUnits: 0 }),
      false,
    );
    const card = screen.getByTestId('traffic-preview');
    expect(within(card).getByTestId('traffic-preview-impact')).toHaveTextContent(
      '2 traffic snapshot units',
    );
    expect(within(card).getByText('Base allowance remaining').nextSibling).toHaveTextContent('1,234');
    expect(within(card).getByText('Pack allowance remaining').nextSibling).toHaveTextContent('0');
    expect(within(card).getByText('United States · English')).toBeVisible();
    expect(within(card).queryByText('Not metered on this server')).not.toBeInTheDocument();
  });

  it('falls back to the breakdown length, then one unit, for the metered unit count', () => {
    const first = renderCard(preview({ remainingBaseUnits: 5 }), false);
    expect(screen.getByTestId('traffic-preview-impact')).toHaveTextContent('1 traffic snapshot unit');
    first.unmount();
    renderCard({ remainingPackUnits: 5 }, false);
    expect(screen.getByTestId('traffic-preview-impact')).toHaveTextContent('1 traffic snapshot unit');
  });

  it('renders the domain and puts actions in the card footer', () => {
    renderCard(preview(), false);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    cleanup();
    render(
      <I18nextProvider i18n={i18n}>
        <SpendPreviewCard
          preview={preview()}
          loading={false}
          domain="example.com"
          actions={<button type="button">Go</button>}
        />
      </I18nextProvider>,
    );
    const card = screen.getByTestId('traffic-preview');
    expect(within(card).getByText('Domain').nextSibling).toHaveTextContent('example.com');
    const footer = card.querySelector('[data-slot="card-footer"]') as HTMLElement;
    expect(within(footer).getByRole('button', { name: 'Go' })).toBeVisible();
  });
});
