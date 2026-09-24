import { describe, expect, it } from 'vitest';
import { altEngineWeeklyStampMs, rankCheckReachedTerminal } from './check-status';
import type { Keyword } from './types';

const keyword = (overrides: Partial<Keyword> = {}): Keyword => ({
  id: 'keyword-1',
  siteId: 'site-1',
  phrase: 'seo audit',
  locationCode: 2840,
  languageCode: 'en',
  device: 'desktop',
  active: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  latestPosition: 3,
  previousPosition: 4,
  delta: 1,
  lastCheckedAt: null,
  aiOverviewPresent: null,
  aiCited: null,
  aiCitedUrl: null,
  lastFailedCheckAt: null,
  lastFailedReason: null,
  engine: 'google',
  engineTarget: null,
  observationMeta: null,
  ...overrides,
});

describe('rank check terminal status', () => {
  const wednesday = Date.parse('2026-07-15T12:00:00.000Z');

  it('floors alternate engines to Monday 00:00 UTC', () => {
    expect(altEngineWeeklyStampMs(wednesday)).toBe(Date.parse('2026-07-13T00:00:00.000Z'));
  });

  it('treats Sunday as the seventh day of the current UTC week', () => {
    const sunday = Date.parse('2026-07-19T23:59:59.000Z');
    expect(altEngineWeeklyStampMs(sunday)).toBe(Date.parse('2026-07-13T00:00:00.000Z'));
  });

  it('accepts the weekly floor for an alternate engine but not Google', () => {
    const weekly = '2026-07-13T00:00:00.000Z';
    expect(
      rankCheckReachedTerminal(keyword({ engine: 'amazon', lastCheckedAt: weekly }), wednesday),
    ).toBe(true);
    expect(rankCheckReachedTerminal(keyword({ lastCheckedAt: weekly }), wednesday)).toBe(false);
  });

  it('terminates on a failed attempt at or after the trigger', () => {
    expect(
      rankCheckReachedTerminal(
        keyword({ lastFailedCheckAt: '2026-07-15T12:00:01.000Z' }),
        wednesday,
      ),
    ).toBe(true);
    expect(
      rankCheckReachedTerminal(
        keyword({ lastFailedCheckAt: '2026-07-15T11:59:59.000Z' }),
        wednesday,
      ),
    ).toBe(false);
  });

  it('does not treat malformed or absent timestamps as terminal', () => {
    expect(
      rankCheckReachedTerminal(
        keyword({ lastCheckedAt: 'not-a-date', lastFailedCheckAt: 'also-bad' }),
        wednesday,
      ),
    ).toBe(false);
  });
});
