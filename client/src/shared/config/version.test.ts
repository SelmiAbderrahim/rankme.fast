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
