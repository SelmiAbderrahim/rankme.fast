import { afterEach, describe, expect, it, vi } from 'vitest';

describe('appVersion', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the generated Vite version when present', async () => {
    vi.stubEnv('VITE_APP_VERSION', '2.0.0+abc1234');
    const { appVersion } = await import('./version');
    expect(appVersion).toBe('2.0.0+abc1234');
  });

  it('falls back to dev without a generated version', async () => {
    vi.stubEnv('VITE_APP_VERSION', undefined as unknown as string);
    const { appVersion } = await import('./version');
    expect(appVersion).toBe('dev');
  });
});

describe('footer version presentation', () => {
  it('shows the release number and only exposes a real build id in a tooltip', async () => {
    const { displayVersion, buildIdentifier } = await import('./version');
    expect(displayVersion('2.0.0+dev')).toBe('2.0.0');
    expect(displayVersion('2.0.0+abc1234')).toBe('2.0.0');
    expect(buildIdentifier('2.0.0+dev')).toBeUndefined();
    expect(buildIdentifier('2.0.0+abc1234')).toBe('2.0.0+abc1234');
    expect(buildIdentifier('2.0.0+not-a-sha')).toBeUndefined();
  });
});
