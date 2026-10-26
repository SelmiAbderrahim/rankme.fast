import type { Queue } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../../db/client.js';
import {
  getClientReportsDb,
  resolveClientReportsDb,
  setClientReportsDb,
} from './client-reports.db-holder.js';
import {
  getClientReportsQueue,
  setClientReportsQueue,
} from './client-reports.queue-holder.js';
import { CLIENT_REPORT_LAST_DAY_OF_MONTH } from '../../db/schema/index.js';
import {
  isValidScheduleTimeZone,
  clientReportRecipientsSchema,
  clientReportScheduleBodySchema,
  clientReportSectionsSchema,
  publicClientPortalParamsSchema,
} from './client-reports.schema.js';

afterEach(() => {
  setClientReportsDb(null);
  setClientReportsQueue(null);
});

describe('client report dependency holders', () => {
  it('resolves injected dependencies and their production fallbacks explicitly', () => {
    const injected = { source: 'injected' } as unknown as Db;
    const fallback = { source: 'fallback' } as unknown as Db;
    const queue = { name: 'client-reports' } as unknown as Queue;

    expect(getClientReportsDb()).toBeNull();
    expect(resolveClientReportsDb(fallback)).toBe(fallback);
    setClientReportsDb(injected);
    expect(getClientReportsDb()).toBe(injected);
    expect(resolveClientReportsDb(fallback)).toBe(injected);

    expect(getClientReportsQueue()).toBeNull();
    setClientReportsQueue(queue);
    expect(getClientReportsQueue()).toBe(queue);
  });
});

describe('client report boundary schemas', () => {
  it.each([
    { audit: true, ranks: false, gsc: false },
    { audit: false, ranks: true, gsc: false },
    { audit: false, ranks: false, gsc: true },
  ])('accepts each independently selected section %#', (sections) => {
    expect(clientReportSectionsSchema.parse(sections)).toEqual(sections);
  });

  it('rejects empty and non-allowlisted section objects', () => {
    expect(() => clientReportSectionsSchema.parse({
      audit: false,
      ranks: false,
      gsc: false,
    })).toThrow();
    expect(() => clientReportSectionsSchema.parse({
      audit: true,
      ranks: false,
      gsc: false,
      internalId: 'forbidden',
    })).toThrow();
  });

  describe('time zone and local hour', () => {
    const weekly = (extra: Record<string, unknown>) => ({
      name: 'Weekly',
      frequency: 'weekly',
      weekdayUtc: 1,
      locale: 'ar',
      recipients: ['client@example.test'],
      sections: { audit: true, ranks: false, gsc: false },
      ...extra,
    });

    it('stores the local hour in the chosen zone, never a converted UTC hour', () => {
      const parsed = clientReportScheduleBodySchema.parse(weekly({ timezone: 'Asia/Riyadh', localHour: 9 }));
      expect(parsed).toMatchObject({ timezone: 'Asia/Riyadh', localHour: 9 });
      expect(parsed).not.toHaveProperty('hourUtc');
    });

    it('defaults the zone to UTC', () => {
      expect(clientReportScheduleBodySchema.parse(weekly({ localHour: 6 }))).toMatchObject({
        timezone: 'UTC',
        localHour: 6,
      });
    });

    it.each([
      ['no hour at all', {}, undefined],
      ['the removed UTC-hour field', { hourUtc: 6, localHour: 9 }, undefined],
      ['an unknown zone', { timezone: 'Mars/Olympus', localHour: 9 }, 'validation.custom.scheduleTimeZoneInvalid'],
      ['a fixed offset', { timezone: '+03:00', localHour: 9 }, 'validation.custom.scheduleTimeZoneInvalid'],
      ['an out-of-range hour', { timezone: 'UTC', localHour: 24 }, undefined],
    ])('rejects %s', (_name, extra, message) => {
      const result = clientReportScheduleBodySchema.safeParse(weekly(extra));
      expect(result.success).toBe(false);
      if (message) expect(result.error!.issues.map((issue) => issue.message)).toContain(message);
    });

    it('accepts canonical zones and refuses junk', () => {
      expect(isValidScheduleTimeZone('UTC')).toBe(true);
      expect(isValidScheduleTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
      expect(isValidScheduleTimeZone('Etc/GMT+3')).toBe(true);
      expect(isValidScheduleTimeZone('Not/AZone')).toBe(false);
      expect(isValidScheduleTimeZone('../etc')).toBe(false);
    });
  });

  describe('monthly day of month', () => {
    const monthly = (monthdayUtc: unknown) => ({
      name: 'Monthly',
      frequency: 'monthly',
      monthdayUtc,
      localHour: 9,
      locale: 'en',
      recipients: ['client@example.test'],
      sections: { audit: true, ranks: false, gsc: false },
    });

    it.each([1, 14, 28, CLIENT_REPORT_LAST_DAY_OF_MONTH])('accepts %s', (value) => {
      expect(clientReportScheduleBodySchema.parse(monthly(value))).toMatchObject({
        monthdayUtc: value,
      });
    });

    it.each([0, 29, 30, 31, 45, -2, -31, 1.5, 12.0001, '12', null, undefined, Number.NaN])(
      'rejects %s instead of letting a date library roll it into another month',
      (value) => {
        expect(clientReportScheduleBodySchema.safeParse(monthly(value)).success).toBe(false);
      },
    );
  });

  it('normalizes recipients and validates both cadence shapes and public tokens', () => {
    expect(clientReportRecipientsSchema.parse([
      ' CLIENT@example.test ',
      'client@example.test',
      'other@example.test',
    ])).toEqual(['client@example.test', 'other@example.test']);
    expect(clientReportScheduleBodySchema.parse({
      name: 'Weekly',
      frequency: 'weekly',
      weekdayUtc: 1,
      localHour: 9,
      locale: 'en',
      recipients: ['client@example.test'],
      sections: { audit: true, ranks: false, gsc: false },
      enabled: true,
    })).toMatchObject({ frequency: 'weekly', weekdayUtc: 1 });
    expect(clientReportScheduleBodySchema.parse({
      name: 'Monthly',
      frequency: 'monthly',
      monthdayUtc: 12,
      localHour: 9,
      locale: 'ar',
      recipients: ['client@example.test'],
      sections: { audit: false, ranks: true, gsc: false },
    })).toMatchObject({ frequency: 'monthly', monthdayUtc: 12, enabled: true });
    expect(publicClientPortalParamsSchema.parse({
      token: 'abcdefghijklmnopqrstuvwxyzABCDEFG_123456',
    })).toBeTruthy();
    expect(() => publicClientPortalParamsSchema.parse({
      token: 'https://example.test/?token=secret',
    })).toThrow();
  });
});
