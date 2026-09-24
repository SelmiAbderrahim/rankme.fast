import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@shared/i18n';

vi.mock('../api', () => ({
  getWeeklyPulseState: vi.fn(),
  previewWeeklyPulse: vi.fn(),
  setWeeklyPulseSubscription: vi.fn(),
  listWeeklyPulseHistory: vi.fn(),
  getWeeklyPulseHistoryDetail: vi.fn(),
  getGenerativeAppearance: vi.fn(),
}));

vi.mock('@features/report-export', () => ({
  ReportExportControl: ({ kind }: { kind: string }) => (
    <div data-testid="weekly-pulse-export">{kind}</div>
  ),
}));

import * as api from '../api';
import { WeeklyPulseCard } from './WeeklyPulseCard';
import { weeklyPulseReducer } from '../store/slice';

async function withProviders(children: React.ReactElement) {
  const store = configureStore({ reducer: { weeklyPulse: weeklyPulseReducer } });
  const i18n = initI18n({ initialLocale: 'en' });
  return {
    store,
    ui: (
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </Provider>
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WeeklyPulseCard', () => {
  it('shows the loading placeholder before the state resolves', async () => {
    (api.getWeeklyPulseState as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}),
    );
    const { ui } = await withProviders(<WeeklyPulseCard siteId="s1" />);
    render(ui);
    expect(screen.getByText(/Weekly pulse/i)).toBeInTheDocument();
  });

  it('renders empty state with an enabled disabled by default', async () => {
    (api.getWeeklyPulseState as ReturnType<typeof vi.fn>).mockResolvedValue({
      siteId: 's1',
      subscription: null,
      setting: null,
      lastRun: null,
      coverage: [],
      gscAppearance: { status: 'unavailable', window: null, rows: [], observationMeta: null },
    });
    const { ui } = await withProviders(<WeeklyPulseCard siteId="s1" />);
    render(ui);
    await waitFor(() =>
      expect(screen.getByTestId('weekly-pulse-enable-cta')).toBeDisabled(),
    );
  });

  it('after previewing, enable button becomes clickable and opens the ack dialog', async () => {
    (api.getWeeklyPulseState as ReturnType<typeof vi.fn>).mockResolvedValue({
      siteId: 's1',
      subscription: null,
      setting: null,
      lastRun: null,
      coverage: [],
      gscAppearance: { status: 'unavailable', window: null, rows: [], observationMeta: null },
    });
    (api.previewWeeklyPulse as ReturnType<typeof vi.fn>).mockResolvedValue({
      productUnits: 1,
      estimatedAt: 'iso',
    });
    (api.setWeeklyPulseSubscription as ReturnType<typeof vi.fn>).mockResolvedValue({
      siteId: 's1',
      subscription: { enabled: true, locale: 'en', enabledAt: 'iso', disabledAt: null },
      setting: {
        enabled: true,
        nextRunAt: '2026-01-06T09:00:00Z',
        lastRunAt: null,
        lastStatus: null,
      },
      lastRun: null,
      coverage: [],
      gscAppearance: { status: 'unavailable', window: null, rows: [], observationMeta: null },
    });
    const user = userEvent.setup();
    const { ui } = await withProviders(<WeeklyPulseCard siteId="s1" />);
    render(ui);
    await user.click(await screen.findByTestId('weekly-pulse-preview-cta'));
    await waitFor(() => expect(screen.getByTestId('weekly-pulse-preview')).toBeInTheDocument());
    await user.click(screen.getByTestId('weekly-pulse-enable-cta'));
    const ack = screen.getByTestId('weekly-pulse-ack-checkbox');
    await user.click(ack);
    await user.click(screen.getByTestId('weekly-pulse-confirm-enable'));
    await waitFor(() => expect(api.setWeeklyPulseSubscription).toHaveBeenCalled());
  });

  it('shows enabled state and can disable via confirmation dialog', async () => {
    (api.getWeeklyPulseState as ReturnType<typeof vi.fn>).mockResolvedValue({
      siteId: 's1',
      subscription: { enabled: true, locale: 'en', enabledAt: 'iso', disabledAt: null },
      setting: {
        enabled: true,
        nextRunAt: '2026-01-06T09:00:00Z',
        lastRunAt: '2025-12-30T09:00:00Z',
        lastStatus: 'completed',
      },
      lastRun: null,
      coverage: [],
      gscAppearance: { status: 'unavailable', window: null, rows: [], observationMeta: null },
    });
    (api.setWeeklyPulseSubscription as ReturnType<typeof vi.fn>).mockResolvedValue({
      siteId: 's1',
      subscription: { enabled: false, locale: 'en', enabledAt: 'iso', disabledAt: 'iso' },
      setting: {
        enabled: false,
        nextRunAt: '2026-01-06T09:00:00Z',
        lastRunAt: '2025-12-30T09:00:00Z',
        lastStatus: 'completed',
      },
      lastRun: null,
      coverage: [],
      gscAppearance: { status: 'unavailable', window: null, rows: [], observationMeta: null },
    });
    const user = userEvent.setup();
    const { ui } = await withProviders(<WeeklyPulseCard siteId="s1" />);
    render(ui);
    await user.click(await screen.findByTestId('weekly-pulse-disable-cta'));
    await user.click(screen.getByTestId('weekly-pulse-confirm-disable'));
    await waitFor(() => expect(api.setWeeklyPulseSubscription).toHaveBeenCalled());
  });

  it('offers export when a stored last run exists', async () => {
    (api.getWeeklyPulseState as ReturnType<typeof vi.fn>).mockResolvedValue({
      siteId: 's1',
      subscription: { enabled: true, locale: 'en', enabledAt: 'iso', disabledAt: null },
      setting: {
        enabled: true,
        nextRunAt: '2026-01-06T09:00:00Z',
        lastRunAt: '2025-12-30T09:00:00Z',
        lastStatus: 'completed',
      },
      lastRun: {
        runId: 'run-1',
        isoWeek: '2026-W01',
        status: 'completed',
        startedAt: '2025-12-30T09:00:00Z',
        finishedAt: '2025-12-30T09:01:00Z',
        createdAt: '2025-12-30T09:00:00Z',
      },
      coverage: [],
      gscAppearance: { status: 'unavailable', window: null, rows: [], observationMeta: null },
    });
    const { ui } = await withProviders(<WeeklyPulseCard siteId="s1" />);
    render(ui);
    expect(await screen.findByTestId('weekly-pulse-export')).toHaveTextContent(
      'weekly_pulse.run',
    );
  });

  it('shows the state-error banner on load failure', async () => {
    (api.getWeeklyPulseState as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('boom'),
    );
    const { ui } = await withProviders(<WeeklyPulseCard siteId="s1" />);
    render(ui);
    await waitFor(() =>
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0),
    );
  });

  it('surfaces a generic save error when saving fails', async () => {
    (api.getWeeklyPulseState as ReturnType<typeof vi.fn>).mockResolvedValue({
      siteId: 's1',
      subscription: { enabled: true, locale: 'en', enabledAt: 'iso', disabledAt: null },
      setting: {
        enabled: true,
        nextRunAt: '2026-01-06T09:00:00Z',
        lastRunAt: null,
        lastStatus: null,
      },
      lastRun: null,
      coverage: [],
      gscAppearance: { status: 'unavailable', window: null, rows: [], observationMeta: null },
    });
    (api.setWeeklyPulseSubscription as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network down'),
    );
    const user = userEvent.setup();
    const { ui } = await withProviders(<WeeklyPulseCard siteId="s1" />);
    render(ui);
    await user.click(await screen.findByTestId('weekly-pulse-disable-cta'));
    await user.click(screen.getByTestId('weekly-pulse-confirm-disable'));
    await waitFor(() =>
      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument(),
    );
  });

  it('cancel button clears the enable dialog', async () => {
    (api.getWeeklyPulseState as ReturnType<typeof vi.fn>).mockResolvedValue({
      siteId: 's1',
      subscription: null,
      setting: null,
      lastRun: null,
      coverage: [],
      gscAppearance: { status: 'unavailable', window: null, rows: [], observationMeta: null },
    });
    (api.previewWeeklyPulse as ReturnType<typeof vi.fn>).mockResolvedValue({
      productUnits: 1,
      estimatedAt: 'iso',
    });
    const user = userEvent.setup();
    const { ui } = await withProviders(<WeeklyPulseCard siteId="s1" />);
    render(ui);
    await user.click(await screen.findByTestId('weekly-pulse-preview-cta'));
    await waitFor(() => expect(screen.getByTestId('weekly-pulse-preview')).toBeInTheDocument());
    await user.click(screen.getByTestId('weekly-pulse-enable-cta'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Cancel button (no test id — use accessible text)
    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('cancel button clears the disable dialog', async () => {
    (api.getWeeklyPulseState as ReturnType<typeof vi.fn>).mockResolvedValue({
      siteId: 's1',
      subscription: { enabled: true, locale: 'en', enabledAt: 'iso', disabledAt: null },
      setting: {
        enabled: true,
        nextRunAt: '2026-01-06T09:00:00Z',
        lastRunAt: '2025-12-30T09:00:00Z',
        lastStatus: 'completed',
      },
      lastRun: null,
      coverage: [],
      gscAppearance: { status: 'unavailable', window: null, rows: [], observationMeta: null },
    });
    const user = userEvent.setup();
    const { ui } = await withProviders(<WeeklyPulseCard siteId="s1" />);
    render(ui);
    await user.click(await screen.findByTestId('weekly-pulse-disable-cta'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

});

// Ensure fireEvent and act stay referenced (linting)
void fireEvent;
void act;
