import { describe, expect, it, vi } from 'vitest';

vi.mock('@features/auth', () => ({
  RequireVerified: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Import via the public API to also cover index.ts re-exports.
const featureModule = await import('./index');
const { googleRoutes } = featureModule;

describe('googleRoutes', () => {
  it('does not expose an account-global Google route', () => {
    expect(googleRoutes).toEqual([]);
  });

  it('re-exports the reducer, thunks, selectors, and components', () => {
    expect(typeof featureModule.googleReducer).toBe('function');
    expect(typeof featureModule.clearGoogleMessages).toBe('function');
    expect(typeof featureModule.loadConnection).toBe('function');
    expect(typeof featureModule.connectGoogle).toBe('function');
    expect(typeof featureModule.disconnectGoogle).toBe('function');
    expect(typeof featureModule.selectGoogleConnection).toBe('function');
    expect(typeof featureModule.selectGoogleLoading).toBe('function');
    expect(typeof featureModule.selectGoogleLoaded).toBe('function');
    expect(typeof featureModule.selectGoogleError).toBe('function');
    expect(typeof featureModule.selectGoogleConnecting).toBe('function');
    expect(typeof featureModule.selectGoogleConnectError).toBe('function');
    expect(typeof featureModule.selectGoogleDisconnecting).toBe('function');
    expect(typeof featureModule.selectGoogleDisconnectError).toBe('function');
    expect(typeof featureModule.selectGoogleMessage).toBe('function');
    expect(typeof featureModule.GoogleConnectionCard).toBe('function');
    expect(typeof featureModule.pollConnection).toBe('function');
  });
});
