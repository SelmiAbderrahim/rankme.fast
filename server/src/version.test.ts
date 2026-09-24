import { describe, expect, it } from 'vitest';
import { firstPackageVersion, packageVersionFromJson, SERVER_VERSION } from './version.js';

describe('server version metadata', () => {
  it('publishes the package version and rejects empty or non-string metadata', () => {
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+/u);
    expect(packageVersionFromJson('{"version":"2.3.4"}')).toBe('2.3.4');
    expect(packageVersionFromJson('{"version":""}')).toBeNull();
    expect(packageVersionFromJson('{"version":2}')).toBeNull();
  });

  it('walks past unreadable or malformed candidates and has an edge-deployment fallback', () => {
    const values = new Map([
      ['/empty', '{"version":""}'],
      ['/valid', '{"version":"3.2.1"}'],
    ]);
    const read = (path: string): string => {
      const value = values.get(path);
      if (value === undefined) throw new Error('missing');
      return value;
    };
    expect(firstPackageVersion(['/missing', '/empty', '/valid'], read)).toBe('3.2.1');
    expect(firstPackageVersion(['/missing', '/empty'], read)).toBe('0.0.0');
  });
});
