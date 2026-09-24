import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  createApiKeyRequest,
  listApiKeysRequest,
  patchApiKeyScopesRequest,
  revokeApiKeyRequest,
} from '../api';
import { settingsErrorMessage } from '../errorMessage';
import type { ApiKeySummary, CreatedApiKey, McpPermissionSpec } from '../types';

export const loadApiKeys = createAsyncThunk<ApiKeySummary[], void, { rejectValue: string }>(
  'settings/loadApiKeys',
  async (_arg, { rejectWithValue }) => {
    try {
      const res = await listApiKeysRequest();
      return res.apiKeys;
    } catch (err) {
      return rejectWithValue(settingsErrorMessage(err, 'settings:apiKeys.errors.loadFailed'));
    }
  },
);

export const createApiKey = createAsyncThunk<
  CreatedApiKey,
  { name: string; scopes?: McpPermissionSpec },
  { rejectValue: string }
>('settings/createApiKey', async (input, { rejectWithValue }) => {
  try {
    const res = await createApiKeyRequest(input);
    return res.apiKey;
  } catch (err) {
    return rejectWithValue(settingsErrorMessage(err, 'settings:apiKeys.errors.createFailed'));
  }
});

export const updateApiKeyScopes = createAsyncThunk<
  ApiKeySummary,
  { id: string; scopes: McpPermissionSpec | null },
  { rejectValue: string }
>('settings/updateApiKeyScopes', async ({ id, scopes }, { rejectWithValue }) => {
  try {
    const response = await patchApiKeyScopesRequest(id, scopes);
    return response.apiKey;
  } catch (error) {
    return rejectWithValue(settingsErrorMessage(error, 'settings:apiKeys.errors.scopesSaveFailed'));
  }
});

export const revokeApiKey = createAsyncThunk<
  { id: string; message: string },
  { id: string },
  { rejectValue: string }
>('settings/revokeApiKey', async ({ id }, { rejectWithValue }) => {
  try {
    const res = await revokeApiKeyRequest(id);
    return { id, message: res.message };
  } catch (err) {
    return rejectWithValue(settingsErrorMessage(err, 'settings:apiKeys.errors.revokeFailed'));
  }
});
