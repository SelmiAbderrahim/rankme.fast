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
import {
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
      hourUtc: 9,
      locale: 'en',
      recipients: ['client@example.test'],
      sections: { audit: true, ranks: false, gsc: false },
      enabled: true,
    })).toMatchObject({ frequency: 'weekly', weekdayUtc: 1 });
    expect(clientReportScheduleBodySchema.parse({
      name: 'Monthly',
      frequency: 'monthly',
      monthdayUtc: 12,
      hourUtc: 9,
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
