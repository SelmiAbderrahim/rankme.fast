import { describe, expect, it } from 'vitest';
import { auditAge } from './auditAge';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-05T12:00:00.000Z');
const daysBefore = (days: number, extraMs = 0) => new Date(NOW - days * DAY - extraMs).toISOString();

describe('auditAge', () => {
  it('reads a recent audit as fresh with its whole-day age', () => {
    expect(auditAge({ runAt: daysBefore(3, 5_000), running: false, freshDays: 30, now: NOW })).toEqual({
      state: 'fresh',
      days: 3,
    });
  });

  it('turns stale only once strictly older than the window, matching the server freshUntil', () => {
    expect(auditAge({ runAt: daysBefore(30), running: false, freshDays: 30, now: NOW }).state).toBe('fresh');
    expect(auditAge({ runAt: daysBefore(30, 1), running: false, freshDays: 30, now: NOW })).toEqual({
      state: 'stale',
      days: 30,
    });
  });

  it('counts calendar days like every other relative date', () => {
    // Aug 11 23:00 → Oct 6 18:00 is 55.8 elapsed days but 56 calendar days;
    // the Dashboard, Overview and Report must all say 56.
    const age = auditAge({
      runAt: '2026-08-11T23:00:00.000Z',
      running: false,
      freshDays: 30,
      now: Date.parse('2026-10-06T18:00:00.000Z'),
      timeZone: 'UTC',
    });
    expect(age).toEqual({ state: 'stale', days: 56 });
  });

  it('computes the age from the supplied clock, never a stored value', () => {
    const runAt = daysBefore(40);
    expect(auditAge({ runAt, running: false, freshDays: 30, now: NOW }).days).toBe(40);
    expect(auditAge({ runAt, running: false, freshDays: 30, now: NOW + 5 * DAY }).days).toBe(45);
    expect(auditAge({ runAt, running: false, freshDays: 30, now: Date.parse(runAt) + DAY }).state).toBe('fresh');
  });

  it('treats a missing or unreadable date as never audited', () => {
    for (const runAt of [null, undefined, '', 'not-a-date']) {
      expect(auditAge({ runAt, running: false, freshDays: 30, now: NOW })).toEqual({ state: 'never', days: null });
    }
  });

  it('reports a running audit regardless of the previous audit age', () => {
    expect(auditAge({ runAt: daysBefore(90), running: true, freshDays: 30, now: NOW })).toEqual({
      state: 'running',
      days: null,
    });
  });

  it('never invents staleness without a server threshold, and clamps a future date to zero days', () => {
    expect(auditAge({ runAt: daysBefore(400), running: false, freshDays: undefined, now: NOW }).state).toBe('fresh');
    expect(auditAge({ runAt: new Date(NOW + DAY).toISOString(), running: false, freshDays: 30, now: NOW })).toEqual({
      state: 'fresh',
      days: 0,
    });
  });
});
