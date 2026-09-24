import { createSlice } from '@reduxjs/toolkit';
import type { ApiKeysState } from '../types';
import {
  createApiKey,
  loadApiKeys,
  revokeApiKey,
  updateApiKeyScopes,
} from './apiKeysThunks';

export const initialState: ApiKeysState = {
  keys: [],
  loading: false,
  loaded: false,
  loadError: '',
  creating: false,
  createError: '',
  createdKey: null,
  revokingId: null,
  revokeError: '',
  scopesSavingId: null,
  scopesError: '',
  message: '',
};

const apiKeysSlice = createSlice({
  name: 'apiKeys',
  initialState,
  reducers: {
    // Show-once contract: closing the reveal dialog discards the full key —
    // it lives nowhere in the store afterwards.
    clearCreatedApiKey: (state) => {
      state.createdKey = null;
    },
    clearApiKeysMessages: (state) => {
      state.loadError = '';
      state.createError = '';
      state.revokeError = '';
      state.scopesError = '';
      state.message = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadApiKeys.pending, (state) => {
        state.loading = true;
        state.loadError = '';
      })
      .addCase(loadApiKeys.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.keys = action.payload;
      })
      .addCase(loadApiKeys.rejected, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.loadError = action.payload ?? '';
      })
      .addCase(createApiKey.pending, (state) => {
        state.creating = true;
        state.createError = '';
        state.message = '';
      })
      .addCase(createApiKey.fulfilled, (state, action) => {
        state.creating = false;
        state.createdKey = action.payload;
        // Mirror the new key into the list without a refetch.
        state.keys = [
          {
            id: action.payload.id,
            name: action.payload.name,
            prefix: action.payload.prefix,
            createdAt: action.payload.createdAt,
            lastUsedAt: null,
            revokedAt: null,
            scopes: action.payload.scopes,
          },
          ...state.keys,
        ];
      })
      .addCase(createApiKey.rejected, (state, action) => {
        state.creating = false;
        state.createError = action.payload ?? '';
      })
      .addCase(revokeApiKey.pending, (state, action) => {
        state.revokingId = action.meta.arg.id;
        state.revokeError = '';
        state.message = '';
      })
      .addCase(revokeApiKey.fulfilled, (state, action) => {
        state.revokingId = null;
        state.message = action.payload.message;
        state.keys = state.keys.map((key) =>
          key.id === action.payload.id
            ? { ...key, revokedAt: new Date().toISOString() }
            : key,
        );
      })
      .addCase(revokeApiKey.rejected, (state, action) => {
        state.revokingId = null;
        state.revokeError = action.payload ?? '';
      })
      .addCase(updateApiKeyScopes.pending, (state, action) => {
        state.scopesSavingId = action.meta.arg.id;
        state.scopesError = '';
      })
      .addCase(updateApiKeyScopes.fulfilled, (state, action) => {
        state.scopesSavingId = null;
        state.keys = state.keys.map((key) =>
          key.id === action.payload.id ? action.payload : key,
        );
      })
      .addCase(updateApiKeyScopes.rejected, (state, action) => {
        state.scopesSavingId = null;
        state.scopesError = action.payload ?? '';
      });
  },
});

export const { clearApiKeysMessages, clearCreatedApiKey } = apiKeysSlice.actions;
export const apiKeysReducer = apiKeysSlice.reducer;
