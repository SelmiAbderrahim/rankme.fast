import { describe, expect, it } from 'vitest';
import { utcCalendarDaysBetween } from './calendar-days.js';

describe('UTC calendar days', () => {
  it.each([
    ['2026-03-01T23:59:00Z', '2026-03-02T00:01:00Z', 1],
    ['2026-03-02T00:01:00Z', '2026-03-02T23:59:00Z', 0],
    ['2026-03-02T00:01:00Z', '2026-03-01T23:59:00Z', -1],
    ['2024-02-28T12:00:00Z', '2024-03-01T12:00:00Z', 2],
  ])('counts date boundaries from %s to %s', (from, to, days) => {
    expect(utcCalendarDaysBetween(new Date(from), new Date(to))).toBe(days);
  });
});
