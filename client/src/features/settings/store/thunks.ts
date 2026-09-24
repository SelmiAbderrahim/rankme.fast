import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  getNotificationPreferencesRequest,
  patchNotificationPreferencesRequest,
} from '../api';
import { settingsErrorMessage } from '../errorMessage';
import type {
  NotificationChannel,
  NotificationPreferences,
} from '../types';

export const loadNotificationPreferences = createAsyncThunk<
  NotificationPreferences,
  void,
  { rejectValue: string }
>('settings/loadNotifications', async (_arg, { rejectWithValue }) => {
  try {
    const res = await getNotificationPreferencesRequest();
    return res.preferences;
  } catch (err) {
    return rejectWithValue(settingsErrorMessage(err, 'settings:notifications.errors.loadFailed'));
  }
});

export interface ToggleNotificationInput {
  channel: NotificationChannel;
  value: boolean;
}

export const toggleNotificationPreference = createAsyncThunk<
  { preferences: NotificationPreferences; channel: NotificationChannel },
  ToggleNotificationInput,
  { rejectValue: { channel: NotificationChannel; message: string } }
>('settings/toggleNotification', async ({ channel, value }, { rejectWithValue }) => {
  try {
    const res = await patchNotificationPreferencesRequest({ [channel]: value });
    return { preferences: res.preferences, channel };
  } catch (err) {
    return rejectWithValue({
      channel,
      message: settingsErrorMessage(err, 'settings:notifications.errors.saveFailed'),
    });
  }
});
