import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '@app/store';
import { initialState } from './apiKeysSlice';

// The lazy-loaded 'apiKeys' reducer is injected right before this page's
// component renders, but RTK only materializes the slice into state on the
// NEXT dispatched action — the very first render still sees `state.apiKeys`
// as undefined, so this base selector must fall back to the slice's own
// initial state rather than assume the key exists (an unguarded read here
// surfaces as the route-level "Page not found" error boundary).
const selectApiKeysState = (state: RootState) => state.apiKeys ?? initialState;

export const selectApiKeys = createSelector(selectApiKeysState, (s) => s.keys);
export const selectApiKeysLoading = createSelector(selectApiKeysState, (s) => s.loading);
export const selectApiKeysLoaded = createSelector(selectApiKeysState, (s) => s.loaded);
export const selectApiKeysLoadError = createSelector(selectApiKeysState, (s) => s.loadError);
export const selectApiKeyCreating = createSelector(selectApiKeysState, (s) => s.creating);
export const selectApiKeyCreateError = createSelector(
  selectApiKeysState,
  (s) => s.createError,
);
export const selectCreatedApiKey = createSelector(selectApiKeysState, (s) => s.createdKey);
export const selectApiKeyRevokingId = createSelector(
  selectApiKeysState,
  (s) => s.revokingId,
);
export const selectApiKeyRevokeError = createSelector(
  selectApiKeysState,
  (s) => s.revokeError,
);
export const selectApiKeysMessage = createSelector(selectApiKeysState, (s) => s.message);
export const selectApiKeyScopesSavingId = createSelector(
  selectApiKeysState,
  (s) => s.scopesSavingId,
);
export const selectApiKeyScopesError = createSelector(
  selectApiKeysState,
  (s) => s.scopesError,
);
