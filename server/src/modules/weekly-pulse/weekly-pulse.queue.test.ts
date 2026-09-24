import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  WEEKLY_PULSE_JOB_NAME,
  WEEKLY_PULSE_QUEUE,
  weeklyPulseJobId,
  weeklyPulseJobSchema,
} from '../../shared/queue/index.js';
import { getPulseQueue, setPulseQueue } from './pulse.queue-holder.js';

const hex = (n: number) => n.toString(16).padStart(24, '0');

describe('weekly-pulse queue registration', () => {
  it('stores and clears the injectable API queue singleton', () => {
    const queue = { name: WEEKLY_PULSE_QUEUE } as never;
    setPulseQueue(queue);
    expect(getPulseQueue()).toBe(queue);
    setPulseQueue(null);
    expect(getPulseQueue()).toBeNull();
  });

  it('uses the stable queue + job names required by parity with audits/ranks', () => {
    expect(WEEKLY_PULSE_QUEUE).toBe('weekly-pulse');
    expect(WEEKLY_PULSE_JOB_NAME).toBe('weekly-pulse');
  });

  it('validates payload — accepts the canonical shape', () => {
    const parsed = weeklyPulseJobSchema.parse({
      accountId: hex(1),
      siteId: hex(2),
      isoWeek: '2026-W29',
    });
    expect(parsed).toEqual({
      accountId: hex(1),
      siteId: hex(2),
      isoWeek: '2026-W29',
    });
  });

  it('rejects non-hex ids', () => {
    expect(() =>
      weeklyPulseJobSchema.parse({
        accountId: 'not-a-hex',
        siteId: hex(2),
        isoWeek: '2026-W29',
      }),
    ).toThrow(ZodError);
  });

  it('rejects malformed iso-week strings', () => {
    for (const iw of ['2026-Q29', '26-W29', '2026W29', '2026-W7', '2026-W101']) {
      expect(() =>
        weeklyPulseJobSchema.parse({
          accountId: hex(1),
          siteId: hex(2),
          isoWeek: iw,
        }),
      ).toThrow(ZodError);
    }
  });

  it('deterministic jobId matches (site, iso_week) tuple', () => {
    expect(weeklyPulseJobId(hex(2), '2026-W29')).toBe(
      `weekly-pulse-${hex(2)}-2026-W29`,
    );
  });
});
