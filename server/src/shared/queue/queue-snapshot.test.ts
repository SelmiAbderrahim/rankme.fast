import { describe, expect, it } from 'vitest';
import type { Queue } from 'bullmq';
import { collectQueueSnapshot } from './queue-snapshot.js';

interface FakeCounts {
  waiting?: number;
  active?: number;
  failed?: number;
  delayed?: number;
  completed?: number;
}

function makeQueue(
  counts: FakeCounts = {},
  jobs: Array<{ state: string; timestamp: number }> = [],
): Queue {
  return {
    async getJobCounts(...states: string[]): Promise<Record<string, number>> {
      const out: Record<string, number> = {};
      for (const s of states) {
        const key = s as keyof FakeCounts;
        out[s] = counts[key] ?? 0;
      }
      return out;
    },
    async getJobs(
      states: string[],
      _start: number,
      _end: number,
      _asc: boolean,
    ): Promise<Array<{ timestamp: number }>> {
      return jobs
        .filter((j) => states.includes(j.state))
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, 1)
        .map((j) => ({ timestamp: j.timestamp }));
    },
  } as unknown as Queue;
}

describe('collectQueueSnapshot', () => {
  it('reads audits + ranks depths (waiting/active/failed) and DLQ size + oldest', async () => {
    const snap = await collectQueueSnapshot({
      audits: makeQueue({ waiting: 4, active: 1, failed: 2 }),
      ranks: makeQueue({ waiting: 1 }),
      deadLetter: makeQueue(
        { waiting: 2, completed: 1 },
        [
          { state: 'waiting', timestamp: 1000 },
          { state: 'completed', timestamp: 500 },
        ],
      ),
    });
    expect(snap.audits).toEqual({ waiting: 4, active: 1, failed: 2, oldestPendingAt: null });
    expect(snap.ranks).toEqual({ waiting: 1, active: 0, failed: 0, oldestPendingAt: null });
    // Omitted queues report zero depths (older admin-overview caller shape).
    expect(snap.audienceResearch).toEqual({ waiting: 0, active: 0, failed: 0, oldestPendingAt: null });
    expect(snap.weeklyPulse).toEqual({ waiting: 0, active: 0, failed: 0, oldestPendingAt: null });
    expect(snap.dlq.size).toBe(3);
    expect(snap.dlq.oldest).toBe(new Date(500).toISOString());
  });

  it('reads audience-research + weekly-pulse depths when wired', async () => {
    const snap = await collectQueueSnapshot({
      audits: makeQueue(),
      ranks: makeQueue(),
      audienceResearch: makeQueue({ waiting: 7, active: 2, failed: 1 }),
      weeklyPulse: makeQueue({ waiting: 3, failed: 4 }),
      deadLetter: null,
    });
    expect(snap.audienceResearch).toEqual({ waiting: 7, active: 2, failed: 1, oldestPendingAt: null });
    expect(snap.weeklyPulse).toEqual({ waiting: 3, active: 0, failed: 4, oldestPendingAt: null });
  });

  it('sorts finite pending timestamps and includes the competitor landscape queue', async () => {
    const pending = {
      async getJobCounts() {
        return { waiting: 2, active: 0, failed: 0 };
      },
      async getJobs() {
        return [
          { timestamp: 3_000 },
          { timestamp: undefined },
          { timestamp: Number.NaN },
          { timestamp: 1_000 },
        ];
      },
    } as unknown as Queue;
    const snap = await collectQueueSnapshot({
      audits: pending,
      ranks: makeQueue(),
      competitorLandscapes: pending,
      deadLetter: null,
    });

    expect(snap.audits.oldestPendingAt).toBe(new Date(1_000).toISOString());
    expect(snap.competitorLandscapes).toEqual({
      waiting: 2,
      active: 0,
      failed: 0,
      oldestPendingAt: new Date(1_000).toISOString(),
    });
  });

  it('includes all four market queue depths when any market queue is wired', async () => {
    const snap = await collectQueueSnapshot({
      audits: makeQueue(),
      ranks: makeQueue(),
      backlinkDeep: makeQueue({ waiting: 2 }),
      trafficSnapshots: makeQueue({ active: 1 }),
      reviewSync: makeQueue({ failed: 3 }),
      brandRadar: makeQueue({ waiting: 4, active: 2, failed: 1 }),
      deadLetter: null,
    });
    expect(snap.market).toEqual({
      'backlink-deep': { waiting: 2, active: 0, failed: 0, oldestPendingAt: null },
      'traffic-snapshots': { waiting: 0, active: 1, failed: 0, oldestPendingAt: null },
      'review-sync': { waiting: 0, active: 0, failed: 3, oldestPendingAt: null },
      'brand-radar': { waiting: 4, active: 2, failed: 1, oldestPendingAt: null },
    });
  });

  it('returns zeros + oldest:null when the queues are unset', async () => {
    const snap = await collectQueueSnapshot({
      audits: null,
      ranks: null,
      audienceResearch: null,
      weeklyPulse: null,
      deadLetter: null,
    });
    expect(snap.audits).toEqual({ waiting: 0, active: 0, failed: 0, oldestPendingAt: null });
    expect(snap.audienceResearch).toEqual({ waiting: 0, active: 0, failed: 0, oldestPendingAt: null });
    expect(snap.weeklyPulse).toEqual({ waiting: 0, active: 0, failed: 0, oldestPendingAt: null });
    expect(snap.dlq).toEqual({ size: 0, oldest: null });
  });

  it('empty DLQ returns oldest:null and skips the getJobs pass', async () => {
    let called = false;
    const dlq = {
      async getJobCounts() {
        return { waiting: 0, completed: 0, delayed: 0 };
      },
      async getJobs() {
        called = true;
        return [];
      },
    } as unknown as Queue;
    const snap = await collectQueueSnapshot({
      audits: makeQueue(),
      ranks: makeQueue(),
      deadLetter: dlq,
    });
    expect(snap.dlq).toEqual({ size: 0, oldest: null });
    expect(called).toBe(false);
  });

  it('non-empty DLQ with no timestamps returns oldest:null (defensive)', async () => {
    const dlq = {
      async getJobCounts() {
        return { waiting: 1, completed: 0, delayed: 0 };
      },
      async getJobs() {
        // No timestamp property — collectQueueSnapshot must not crash.
        return [{}];
      },
    } as unknown as Queue;
    const snap = await collectQueueSnapshot({
      audits: makeQueue(),
      ranks: makeQueue(),
      deadLetter: dlq,
    });
    expect(snap.dlq.size).toBe(1);
    expect(snap.dlq.oldest).toBeNull();
  });

  it('coerces string-shaped counts + missing keys via ?? 0', async () => {
    const audits = {
      async getJobCounts() {
        return { waiting: '3', active: undefined, failed: '2' };
      },
      async getJobs() {
        return [];
      },
    } as unknown as Queue;
    const snap = await collectQueueSnapshot({
      audits,
      ranks: makeQueue(),
      deadLetter: null,
    });
    expect(snap.audits).toEqual({ waiting: 3, active: 0, failed: 2, oldestPendingAt: null });
  });

  it('every ?? 0 branch fires when getJobCounts returns an empty object', async () => {
    const empty = {
      async getJobCounts() {
        return {};
      },
      async getJobs() {
        return [];
      },
    } as unknown as Queue;
    const snap = await collectQueueSnapshot({
      audits: empty,
      ranks: empty,
      deadLetter: empty,
    });
    expect(snap.audits).toEqual({ waiting: 0, active: 0, failed: 0, oldestPendingAt: null });
    expect(snap.ranks).toEqual({ waiting: 0, active: 0, failed: 0, oldestPendingAt: null });
    expect(snap.dlq).toEqual({ size: 0, oldest: null });
  });
});
