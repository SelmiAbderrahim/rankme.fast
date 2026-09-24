import { describe, expect, it } from 'vitest';
import type { RootState } from '@app/store';
import { initialState as notificationsInitialState } from './slice';
import { initialState as apiKeysInitialState } from './apiKeysSlice';
import { initialState as brandingInitialState } from './brandingSlice';
import { initialState as mcpPermissionsInitialState } from './mcpPermissionsSlice';
import { selectNotificationPreferences } from './selectors';
import { selectApiKeys } from './apiKeysSelectors';
import { selectBranding } from './brandingSelectors';
import { selectMcpPermissions } from './mcpPermissionsSelectors';

// Regression: notifications / apiKeys / branding / mcpPermissions are lazy-injected and are
// undefined on the route's very first render (RTK materializes them only on the
// next dispatch). Their selectors must fall back to their slice initialState
// instead of throwing the route-level "Page not found" / "Something went wrong"
// error boundary.
describe('settings selectors — first-render lazy-slice guards', () => {
  const bare = {} as unknown as RootState;

  it('notifications selector falls back to initialState', () => {
    expect(selectNotificationPreferences(bare)).toBe(
      notificationsInitialState.preferences,
    );
  });

  it('apiKeys selector falls back to initialState', () => {
    expect(selectApiKeys(bare)).toBe(apiKeysInitialState.keys);
  });

  it('branding selector falls back to initialState', () => {
    expect(selectBranding(bare)).toBe(brandingInitialState.branding);
  });

  it('MCP permissions selector falls back to initialState', () => {
    expect(selectMcpPermissions(bare)).toBe(mcpPermissionsInitialState.settings);
  });
});
