import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '@app/store';
import type { NotificationChannel } from '../types';
import { initialState } from './slice';

// The lazy-loaded 'settings' reducer is injected right before this page's
// component renders, but RTK only materializes the slice into state on the
// NEXT dispatched action — the very first render still sees `state.settings`
// as undefined, so this base selector must fall back to the slice's own
// initial state rather than assume the key exists (an unguarded read here
// surfaces as the route-level "Page not found" error boundary).
const selectSettingsState = (state: RootState) => state.settings ?? initialState;

export const selectNotificationPreferences = createSelector(
  selectSettingsState,
  (s) => s.preferences,
);

export const selectNotificationsLoading = createSelector(
  selectSettingsState,
  (s) => s.loading,
);

export const selectNotificationsLoaded = createSelector(
  selectSettingsState,
  (s) => s.loaded,
);

export const selectNotificationsLoadError = createSelector(
  selectSettingsState,
  (s) => s.loadError,
);

export const selectNotificationsSaveError = createSelector(
  selectSettingsState,
  (s) => s.saveError,
);

export const selectNotificationSaving = (channel: NotificationChannel) =>
  createSelector(selectSettingsState, (s) => Boolean(s.saving[channel]));
