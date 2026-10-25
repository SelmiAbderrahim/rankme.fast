import { describe, expect, it } from 'vitest';
import { ga4SummaryFreshness, zeroFillDailySeries } from './google-analytics.service.js';

describe('GA4 daily series', () => {
    it('preserves reported metrics and fills quiet days within the inclusive window', () => {
        expect(zeroFillDailySeries([
            { key: '2026-10-20', sessions: 3, activeUsers: 2, engagedSessions: 1, keyEvents: 4 },
            { key: '2026-10-22', sessions: 5, activeUsers: 4, engagedSessions: 2, keyEvents: 1 },
        ], '2026-10-20', '2026-10-22')).toEqual([
            { key: '2026-10-20', sessions: 3, activeUsers: 2, engagedSessions: 1, keyEvents: 4 },
            { key: '2026-10-21', sessions: 0, activeUsers: 0, engagedSessions: 0, keyEvents: 0 },
            { key: '2026-10-22', sessions: 5, activeUsers: 4, engagedSessions: 2, keyEvents: 1 },
        ]);
    });

    it('advances an entirely quiet window and accepts an empty range', () => {
        expect(zeroFillDailySeries([], '2026-10-20', '2026-10-21').map((row) => row.key))
            .toEqual(['2026-10-20', '2026-10-21']);
        expect(zeroFillDailySeries([], '2026-10-22', '2026-10-21')).toEqual([]);
    });
});

describe('GA4 summary freshness', () => {
    const now = new Date('2026-10-25T12:00:00.000Z');

    it('warns when an old snapshot has no recent successful sync', () => {
        expect(ga4SummaryFreshness('2026-10-18', now, 1)).toMatchObject({
            expectedAsOf: '2026-10-24', stale: true, noRecentSessions: false, lastSyncedAt: null,
        });
    });

    it('describes a quiet property after a recent successful sync without a reconnect warning', () => {
        expect(ga4SummaryFreshness('2026-10-18', now, 1, new Date('2026-10-25T08:00:00.000Z')))
            .toMatchObject({ stale: false, noRecentSessions: true, lastSyncedAt: '2026-10-25T08:00:00.000Z' });
        expect(ga4SummaryFreshness('2026-10-24', now, 1)).toMatchObject({ stale: false, noRecentSessions: false });
    });
});
