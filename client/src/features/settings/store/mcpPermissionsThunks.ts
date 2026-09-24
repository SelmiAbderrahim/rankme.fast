import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  getMcpPermissionsRequest,
  putMcpPermissionsRequest,
} from '../api';
import { settingsErrorMessage } from '../errorMessage';
import type { McpPermissionSettings } from '../types';

export const loadMcpPermissions = createAsyncThunk<
  McpPermissionSettings,
  void,
  { rejectValue: string }
>('settings/loadMcpPermissions', async (_arg, { rejectWithValue }) => {
  try {
    return await getMcpPermissionsRequest();
  } catch (error) {
    return rejectWithValue(
      settingsErrorMessage(error, 'settings:mcp.errors.loadFailed'),
    );
  }
});
export const saveMcpPermissions = createAsyncThunk<
  McpPermissionSettings,
  McpPermissionSettings,
  { rejectValue: string }
>('settings/saveMcpPermissions', async (settings, { rejectWithValue }) => {
  try {
    return await putMcpPermissionsRequest(settings);
  } catch (error) {
    return rejectWithValue(
      settingsErrorMessage(error, 'settings:mcp.errors.saveFailed'),
    );
  }
});
