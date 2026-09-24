import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBeta, releaseStage } from './release';

describe('releaseStage', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['unset', undefined as unknown as string, 'beta'],
    ['blank', '   ', 'beta'],
    ['invalid', 'preview', 'beta'],
    ['ga', ' GA ', 'ga'],
  ] as const)('resolves %s configuration to %s', (_label, configured, expected) => {
    vi.stubEnv('VITE_RELEASE_STAGE', configured);
    expect(releaseStage()).toBe(expected);
    expect(isBeta()).toBe(expected === 'beta');
  });
});
