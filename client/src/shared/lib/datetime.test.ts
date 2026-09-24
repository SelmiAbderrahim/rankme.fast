import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatRelativeTime } from './datetime';

/** Fixed reference instant so every branch assertion is deterministic. */
const NOW = Date.parse('2026-08-01T12:00:00.000Z');

const isoAt = (offsetSeconds: number): string =>
  new Date(NOW + offsetSeconds * 1000).toISOString();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatRelativeTime', () => {
  it('formats sub-minute differences in seconds', () => {
    expect(formatRelativeTime(isoAt(-30), 'en', NOW)).toBe('30 seconds ago');
  });

  it('numeric:auto yields a natural phrase for a zero difference', () => {
    expect(formatRelativeTime(isoAt(0), 'en', NOW)).toBe('now');
  });

  it('formats sub-hour differences in minutes (boundary at 60s)', () => {
    expect(formatRelativeTime(isoAt(-60), 'en', NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(isoAt(5 * 60), 'en', NOW)).toBe('in 5 minutes');
  });

  it('formats sub-day differences in hours (boundary at 3600s)', () => {
    expect(formatRelativeTime(isoAt(-3600), 'en', NOW)).toBe('1 hour ago');
    expect(formatRelativeTime(isoAt(-3 * 3600), 'en', NOW)).toBe('3 hours ago');
  });

  it('formats everything else in days (boundary at 86400s)', () => {
    expect(formatRelativeTime(isoAt(-86_400), 'en', NOW)).toBe('yesterday');
    expect(formatRelativeTime(isoAt(-2 * 86_400), 'en', NOW)).toBe('2 days ago');
    expect(formatRelativeTime(isoAt(2 * 86_400), 'en', NOW)).toBe('in 2 days');
  });

  it('localizes through Intl for non-English locales', () => {
    expect(formatRelativeTime(isoAt(-2 * 86_400), 'fr', NOW)).toBe('avant-hier');
  });

  it('defaults `now` to Date.now() when omitted', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(formatRelativeTime(isoAt(-30), 'en')).toBe('30 seconds ago');
  });
});
