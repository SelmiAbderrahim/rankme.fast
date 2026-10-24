import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration } from './units';

describe('resource sizes and timings', () => {
  it('uses decimal byte units with locale formatting', () => {
    expect(formatBytes(900, 'en')).toBe('900 byte');
    expect(formatBytes(1500, 'en')).toBe('2 kB');
    expect(formatBytes(1_500_000, 'en')).toBe('1.5 MB');
    expect(formatBytes(1_500_000, 'de')).toBe('1,5 MB');
  });
  it('keeps milliseconds below one second and tenths of seconds above it', () => {
    expect(formatDuration(999, 'en')).toBe('999 ms');
    expect(formatDuration(1250, 'en')).toBe('1.3 sec');
  });
});
