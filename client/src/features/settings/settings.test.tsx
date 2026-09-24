import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { configureStore } from '@reduxjs/toolkit';
import { toast } from 'sonner';
import { ApiError } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from './api';
import { settingsReducer } from './store/slice';
import { NotificationPreferences } from './components/NotificationPreferences';
import type { NotificationPreferences as PrefsShape, NotificationState } from './types';
import {
  loadNotificationPreferences,
  toggleNotificationPreference,
} from './store/thunks';
import {
  selectNotificationPreferences,
  selectNotificationsLoadError,
  selectNotificationsLoaded,
  selectNotificationsLoading,
  selectNotificationSaving,
  selectNotificationsSaveError,
} from './store/selectors';
import { settingsErrorMessage } from './errorMessage';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('./api', () => ({
  getNotificationPreferencesRequest: vi.fn(),
  patchNotificationPreferencesRequest: vi.fn(),
}));

const mocked = vi.mocked(api);

const defaultPrefs = (over: Partial<PrefsShape> = {}): PrefsShape => ({
  emailAuditComplete: true,
  emailRankDrop: true,
  emailAlerts: true,
  emailMarketing: true,
  ...over,
});

const baseState = (): NotificationState => settingsReducer(undefined, { type: '@@init' });

const makeStore = (preloaded?: Partial<NotificationState>) =>
  configureStore({
    reducer: { settings: settingsReducer },
    preloadedState: { settings: { ...baseState(), ...(preloaded ?? {}) } },
  });

type Store = ReturnType<typeof makeStore>;

const renderWith = (store: Store = makeStore()) => {
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <NotificationPreferences />
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
  mocked.getNotificationPreferencesRequest.mockResolvedValue({ preferences: defaultPrefs() });
});

describe('NotificationPreferences', () => {
  it('loads on mount and renders every switch', async () => {
    renderWith();
    await waitFor(() =>
      expect(mocked.getNotificationPreferencesRequest).toHaveBeenCalled(),
    );
    expect(
      await screen.findByRole('heading', { name: 'Notification preferences' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Audit complete' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Rank drops' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Alert rules' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Product updates' })).toBeChecked();
  });

  it('does not re-fetch when the store is already loaded', async () => {
    renderWith(
      makeStore({ loaded: true, preferences: defaultPrefs({ emailMarketing: false }) }),
    );
    expect(mocked.getNotificationPreferencesRequest).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: 'Product updates' })).not.toBeChecked();
  });

  it('surfaces the load error alert', async () => {
    renderWith(makeStore({ loaded: true, loadError: 'load boom' }));
    expect(screen.getByRole('alert')).toHaveTextContent('load boom');
  });

  it('records a load rejection via the server error message', async () => {
    mocked.getNotificationPreferencesRequest.mockRejectedValueOnce(
      new ApiError('bad', 500, { error: { message: 'load failed on server' } }),
    );
    const store = makeStore();
    renderWith(store);
    await waitFor(() =>
      expect(store.getState().settings.loadError).toBe('load failed on server'),
    );
  });

  it('shows the loading skeleton until preferences arrive', async () => {
    renderWith(makeStore({ loading: true }));
    expect(
      screen.getByTestId('notification-preferences-skeleton'),
    ).toBeInTheDocument();
  });

  it('toggling a switch PATCHes the intended channel and reflects the fulfilled payload', async () => {
    mocked.patchNotificationPreferencesRequest.mockResolvedValue({
      preferences: defaultPrefs({ emailMarketing: false }),
    });
    const store = makeStore({ loaded: true, preferences: defaultPrefs() });
    renderWith(store);
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Product updates' }));
    await waitFor(() =>
      expect(mocked.patchNotificationPreferencesRequest).toHaveBeenCalledWith({
        emailMarketing: false,
      }),
    );
    await waitFor(() =>
      expect(store.getState().settings.preferences?.emailMarketing).toBe(false),
    );
  });

  it('rolls the switch back and raises a toast when PATCH rejects', async () => {
    mocked.patchNotificationPreferencesRequest.mockRejectedValue(
      new ApiError('bad', 500, { error: { message: 'server said no' } }),
    );
    const store = makeStore({ loaded: true, preferences: defaultPrefs() });
    renderWith(store);
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Audit complete' }));
    await waitFor(() =>
      expect(mocked.patchNotificationPreferencesRequest).toHaveBeenCalled(),
    );
    await waitFor(() =>
      expect(store.getState().settings.preferences?.emailAuditComplete).toBe(true),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('server said no'));
  });

  it('falls back to the localized save-failed message when the error has no message field', async () => {
    mocked.patchNotificationPreferencesRequest.mockRejectedValue(new Error('network'));
    const store = makeStore({ loaded: true, preferences: defaultPrefs() });
    renderWith(store);
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Rank drops' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "We couldn't save that change. Please try again.",
      ),
    );
  });
});

describe('slice + thunks', () => {
  it('initial state has no preferences and no errors', () => {
    const s = baseState();
    expect(s.preferences).toBeNull();
    expect(s.loaded).toBe(false);
    expect(s.loadError).toBe('');
  });

  it('load fulfilled populates the preferences', () => {
    const s = settingsReducer(
      baseState(),
      loadNotificationPreferences.fulfilled(defaultPrefs(), 'r'),
    );
    expect(s.loaded).toBe(true);
    expect(s.preferences).toEqual(defaultPrefs());
  });

  it('load rejected records the message and marks loaded', () => {
    const rejected = loadNotificationPreferences.rejected(new Error(), 'r', undefined, 'oops');
    const s = settingsReducer(baseState(), rejected);
    expect(s.loaded).toBe(true);
    expect(s.loadError).toBe('oops');
  });

  it('load rejected falls back to empty string when payload is missing', () => {
    const rejected = loadNotificationPreferences.rejected(new Error(), 'r');
    const s = settingsReducer(baseState(), rejected);
    expect(s.loadError).toBe('');
  });

  it('toggle pending flips the switch optimistically', () => {
    const s = settingsReducer(
      { ...baseState(), preferences: defaultPrefs(), loaded: true },
      toggleNotificationPreference.pending('r', { channel: 'emailMarketing', value: false }),
    );
    expect(s.preferences?.emailMarketing).toBe(false);
    expect(s.saving.emailMarketing).toBe(true);
  });

  it('toggle pending is a no-op on preferences when the store has none yet', () => {
    const s = settingsReducer(
      baseState(),
      toggleNotificationPreference.pending('r', { channel: 'emailMarketing', value: false }),
    );
    expect(s.preferences).toBeNull();
    expect(s.saving.emailMarketing).toBe(true);
  });

  it('toggle fulfilled writes the server preferences and clears saving', () => {
    const state = {
      ...baseState(),
      preferences: defaultPrefs(),
      loaded: true,
      saving: { emailMarketing: true },
    };
    const action = toggleNotificationPreference.fulfilled(
      { preferences: defaultPrefs({ emailMarketing: false }), channel: 'emailMarketing' },
      'r',
      { channel: 'emailMarketing', value: false },
    );
    const s = settingsReducer(state, action);
    expect(s.preferences?.emailMarketing).toBe(false);
    expect(s.saving.emailMarketing).toBeUndefined();
  });

  it('toggle rejected rolls back the optimistic change and records the message', () => {
    const state = {
      ...baseState(),
      preferences: defaultPrefs({ emailRankDrop: false }),
      loaded: true,
      saving: { emailRankDrop: true },
    };
    const action = toggleNotificationPreference.rejected(
      new Error(),
      'r',
      { channel: 'emailRankDrop', value: false },
      { channel: 'emailRankDrop', message: 'nope' },
    );
    const s = settingsReducer(state, action);
    expect(s.preferences?.emailRankDrop).toBe(true);
    expect(s.saveError).toBe('nope');
    expect(s.saving.emailRankDrop).toBeUndefined();
  });

  it('toggle rejected without a payload records an empty error and rolls back', () => {
    const state = {
      ...baseState(),
      preferences: defaultPrefs({ emailRankDrop: false }),
      loaded: true,
      saving: { emailRankDrop: true },
    };
    const action = toggleNotificationPreference.rejected(
      new Error(),
      'r',
      { channel: 'emailRankDrop', value: false },
    );
    const s = settingsReducer(state, action);
    expect(s.preferences?.emailRankDrop).toBe(true);
    expect(s.saveError).toBe('');
  });

  it('toggle rejected leaves preferences null when the store had none', () => {
    const action = toggleNotificationPreference.rejected(
      new Error(),
      'r',
      { channel: 'emailRankDrop', value: false },
      { channel: 'emailRankDrop', message: 'nope' },
    );
    const s = settingsReducer(baseState(), action);
    expect(s.preferences).toBeNull();
  });

  it('clearSettingsMessages resets both error strings', async () => {
    const { clearSettingsMessages } = await import('./store/slice');
    const state = { ...baseState(), loadError: 'x', saveError: 'y' };
    const cleared = settingsReducer(state, clearSettingsMessages());
    expect(cleared.loadError).toBe('');
    expect(cleared.saveError).toBe('');
  });
});

describe('selectors', () => {
  // The tested selectors read only `state.settings`; the RootState type has
  // every feature slice, but we only need the settings shape here.
  const rootState = (settings: NotificationState) =>
    ({ settings }) as unknown as Parameters<typeof selectNotificationPreferences>[0];

  it('return values wired to the slice fields', () => {
    const state = {
      ...baseState(),
      preferences: defaultPrefs({ emailMarketing: false }),
      loading: true,
      loaded: true,
      loadError: 'l',
      saveError: 's',
      saving: { emailMarketing: true },
    };
    expect(selectNotificationPreferences(rootState(state))).toEqual(state.preferences);
    expect(selectNotificationsLoading(rootState(state))).toBe(true);
    expect(selectNotificationsLoaded(rootState(state))).toBe(true);
    expect(selectNotificationsLoadError(rootState(state))).toBe('l');
    expect(selectNotificationsSaveError(rootState(state))).toBe('s');
    expect(selectNotificationSaving('emailMarketing')(rootState(state))).toBe(true);
    expect(selectNotificationSaving('emailRankDrop')(rootState(state))).toBe(false);
  });
});

describe('settingsErrorMessage', () => {
  it('returns the server error message when present', () => {
    const err = new ApiError('x', 400, { error: { message: 'server said no' } });
    expect(settingsErrorMessage(err, 'settings:notifications.errors.loadFailed')).toBe(
      'server said no',
    );
  });

  it('falls back to i18n when the error is not shaped', () => {
    expect(settingsErrorMessage(new Error('n'), 'settings:notifications.errors.loadFailed')).toBe(
      "We couldn't load your notification preferences. Please refresh.",
    );
  });

  it('falls back when the payload lacks an error.message', () => {
    const err = new ApiError('x', 400, { error: {} });
    expect(settingsErrorMessage(err, 'settings:notifications.errors.saveFailed')).toBe(
      "We couldn't save that change. Please try again.",
    );
  });

  it('falls back when the payload lacks an error field entirely', () => {
    const err = new ApiError('x', 400, {});
    expect(settingsErrorMessage(err, 'settings:notifications.errors.loadFailed')).toBe(
      "We couldn't load your notification preferences. Please refresh.",
    );
  });

  it('falls back when the payload data is not an object', () => {
    const err = new ApiError('x', 400, 'plain text');
    expect(settingsErrorMessage(err, 'settings:notifications.errors.saveFailed')).toBe(
      "We couldn't save that change. Please try again.",
    );
  });

  it('falls back when the api error message is a non-string', () => {
    const err = new ApiError('x', 400, { error: { message: 42 } });
    expect(settingsErrorMessage(err, 'settings:notifications.errors.loadFailed')).toBe(
      "We couldn't load your notification preferences. Please refresh.",
    );
  });
});
