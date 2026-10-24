import { describe, expect, it } from 'vitest';
import { addDays, addMonths, clampDateOnly, firstDayOfWeek, isSameMonth, parseDateOnly, startOfMonth, todayDateOnly, toDateOnly } from './dateOnly';
const at = (day: string) => Date.parse(`${day}T00:00:00Z`);
describe('calendar day arithmetic', () => {
  it('validates leap days and rejects invalid calendar dates and unpadded values', () => {
    for (const day of [undefined, null, '', '2026-02-29', '2026-2-01', 'bad', '2026-04-31'])
      expect(parseDateOnly(day)).toBeNull();
    expect(parseDateOnly('2024-02-29')).toBe(at('2024-02-29'));
    expect(toDateOnly(addDays(at('2024-02-29'), 1))).toBe('2024-03-01');
  });
  it('clamps month ends, moves across years and compares calendar months', () => {
    expect(toDateOnly(addMonths(at('2026-01-31'), 1))).toBe('2026-02-28');
    expect(toDateOnly(addMonths(at('2024-03-31'), -1))).toBe('2024-02-29');
    expect(toDateOnly(startOfMonth(at('2026-10-24')))).toBe('2026-10-01');
    expect(isSameMonth(at('2026-10-01'), at('2026-10-31'))).toBe(true);
    expect(isSameMonth(at('2026-10-01'), at('2025-10-01'))).toBe(false);
    expect(isSameMonth(at('2026-10-01'), at('2026-11-01'))).toBe(false);
    expect(clampDateOnly(1, 2, 4)).toBe(2);
    expect(clampDateOnly(5, 2, 4)).toBe(4);
    expect(clampDateOnly(3, 2, 4)).toBe(3);
    expect(clampDateOnly(3, null, null)).toBe(3);
  });
  it('resolves today on both sides of UTC midnight without DST shifts', () => {
    const now = Date.parse('2026-10-25T00:30:00Z');
    expect(toDateOnly(todayDateOnly(now, 'America/Los_Angeles'))).toBe('2026-10-24');
    expect(toDateOnly(todayDateOnly(now, 'Asia/Tokyo'))).toBe('2026-10-25');
    expect(Number.isFinite(todayDateOnly())).toBe(true);
    expect(firstDayOfWeek('en-US')).toBe(0);
    expect(firstDayOfWeek('de')).toBe(1);
    expect(firstDayOfWeek('ar')).toBe(6);
    expect(firstDayOfWeek('invalid tag')).toBe(1);
    const original = Intl.Locale;
    Object.defineProperty(Intl, 'Locale', {
      configurable: true,
      value: class {
        getWeekInfo() {
          return { firstDay: 7 };
        }
      },
    });
    expect(firstDayOfWeek('en')).toBe(0);
    Object.defineProperty(Intl, 'Locale', { configurable: true, value: class {} });
    expect(firstDayOfWeek('en')).toBe(1);
    Object.defineProperty(Intl, 'Locale', { configurable: true, value: original });
  });
});
