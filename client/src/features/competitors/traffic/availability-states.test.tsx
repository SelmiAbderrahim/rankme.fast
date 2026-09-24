import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { KillSwitchBanner } from './components/KillSwitchBanner';
import { SnapshotList } from './components/SnapshotList';
import { SnapshotRequestForm } from './components/SnapshotRequestForm';
import { trafficSnapshotsReducer } from './store/slice';
import type { TrafficSnapshotRequestResult, TrafficSpendPreview } from './types';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

const spendPreview: TrafficSpendPreview = {
  breakdown: [
    {
      operationKey: 'traffic:example.com',
      metric: 'traffic_snapshots',
      productUnits: 1,
      cachedStatus: 'fresh_required',
    },
  ],
};

const renderState = (node: React.ReactNode) => {
  const store = configureStore({ reducer: { trafficSnapshots: trafficSnapshotsReducer } });
  return render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{node}</MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mockedApiClient.mockReset();
});

describe('Traffic Insights availability states', () => {
  it('shows the kill-switch banner and disables the form with a reason', () => {
    renderState(
      <>
        <KillSwitchBanner />
        <SnapshotRequestForm
          disabled
          disabledReason="Traffic Insights is paused by the operator."
        />
      </>,
    );
    expect(screen.getByTestId('traffic-kill-switch')).toHaveTextContent(
      'Stored snapshots remain available',
    );
    const input = screen.getByRole('textbox', { name: 'Domain' });
    expect(input).toBeDisabled();
    expect(input).toHaveAccessibleDescription('Traffic Insights is paused by the operator.');
    expect(screen.getByRole('button', { name: 'Preview snapshot' })).toBeDisabled();
  });

  it('uses a server-provided kill-switch explanation when available', () => {
    renderState(<KillSwitchBanner description="Operator maintenance window." />);
    expect(screen.getByTestId('traffic-kill-switch')).toHaveTextContent(
      'Operator maintenance window.',
    );
  });

  it('retries a timeout behind the shared loading Button', async () => {
    let resolveRetry!: (value: TrafficSpendPreview) => void;
    mockedApiClient
      .mockRejectedValueOnce(new ApiError('timeout', 0, null, 'timeout'))
      .mockReturnValueOnce(
        new Promise<TrafficSpendPreview>((resolve) => {
          resolveRetry = resolve;
        }),
      );
    renderState(<SnapshotRequestForm />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    const retry = await screen.findByRole('button', { name: 'Try again' });
    await user.click(retry);
    expect(screen.getByRole('button', { name: 'Trying again…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    resolveRetry(spendPreview);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Trying again…' })).not.toBeInTheDocument(),
    );
  });

  it('retries a preview timeout with the workspace site id', async () => {
    mockedApiClient
      .mockRejectedValueOnce(new ApiError('timeout', 0, null, 'timeout'))
      .mockResolvedValueOnce(spendPreview);
    renderState(<SnapshotRequestForm siteId="site-1" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(mockedApiClient).toHaveBeenLastCalledWith(
        '/competitors/traffic-snapshots/preview',
        expect.objectContaining({
          body: expect.objectContaining({ domains: ['example.com'] }),
        }),
      ),
    );
    expect(await screen.findByTestId('traffic-preview')).toBeVisible();
  });

  it('retries a request-time timeout with the confirmed snapshot input', async () => {
    let resolveRetry!: (value: TrafficSnapshotRequestResult) => void;
    mockedApiClient
      .mockResolvedValueOnce(spendPreview)
      .mockRejectedValueOnce(new ApiError('timeout', 0, null, 'timeout'))
      .mockReturnValueOnce(
        new Promise<TrafficSnapshotRequestResult>((resolve) => {
          resolveRetry = resolve;
        }),
      );
    renderState(<SnapshotRequestForm siteId="site-1" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm snapshot' }));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('button', { name: 'Trying again…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(mockedApiClient).toHaveBeenLastCalledWith(
      '/competitors/traffic-snapshots',
      expect.objectContaining({
        body: expect.objectContaining({ targetDomain: 'example.com', siteId: 'site-1' }),
      }),
    );
    resolveRetry({
      runId: '111111111111111111111111',
      status: 'queued',
      targetDomain: 'example.com',
      reservedUnits: 1,
      cached: false,
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Trying again…' })).not.toBeInTheDocument(),
    );
  });

  it('renders the empty state', () => {
    renderState(
      <SnapshotList
        data={{ snapshots: [], nextCursor: null }}
        status="succeeded"
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByTestId('traffic-list-empty')).toHaveTextContent('No traffic snapshots yet');
  });
});
