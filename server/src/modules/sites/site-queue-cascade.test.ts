import { describe, expect, it, vi } from 'vitest';
import type { Queues } from '../../shared/queue/index.js';
import { Site } from './sites.model.js';
import {
  SITE_QUEUE_CASCADE_PAGE_SIZE,
  SiteQueueBusyError,
  jobMatchesSiteResources,
  persistSiteQueueResourceIds,
  siteQueueCascadeTestables,
  purgeSiteQueueData,
  type SiteQueueResourceIds,
} from './site-queue-cascade.js';

interface FakeJob {
  data: unknown;
  remove: ReturnType<typeof vi.fn>;
}

function fakeQueues(
  active: FakeJob[],
  queued: FakeJob[] | Record<string, FakeJob[]>,
) {
  const queuedByState = Array.isArray(queued) ? { wait: queued } : queued;
  const getJobs = vi.fn(async (states: string[], start: number, end: number) => {
    const source = states.includes('active')
      ? active
      : states.flatMap((state) => queuedByState[state] ?? []);
    return source.slice(start, end + 1);
  });
  for (const job of Object.values(queuedByState).flat()) {
    job.remove.mockImplementation(async () => {
      for (const jobs of Object.values(queuedByState)) {
        const index = jobs.indexOf(job);
        if (index >= 0) jobs.splice(index, 1);
      }
    });
  }
  const queue = {
    getJobs,
    removeJobScheduler: vi.fn(async () => true),
  };
  const queues = {
    audits: queue,
    ranks: queue,
    accountPurge: queue,
    gscSync: queue,
    ga4Sync: queue,
    contentAnalysis: queue,
    contentInventory: queue,
    internalLinks: queue,
    keywordClusters: queue,
    competitorContent: queue,
    competitorLandscapes: queue,
    contentMonitor: queue,
    audienceResearch: queue,
    weeklyPulse: queue,
    clientReports: queue,
    backlinkDeep: queue,
    trafficSnapshots: queue,
    reviewSync: queue,
    brandRadar: queue,
    contentBrief: queue,
    geogrid: queue,
    alertDispatch: queue,
    deadLetter: queue,
    close: vi.fn(async () => undefined),
  } as unknown as Queues;
  return { queues, queue, getJobs };
}

function job(data: unknown): FakeJob {
  return { data, remove: vi.fn() };
}

const resources: SiteQueueResourceIds = {
  all: new Set(['site-target', 'run-target', 'schedule-target']),
  scheduleIds: ['schedule-target'],
  ruleIds: [],
};

describe('site queue cascade', () => {
  it('collects SQL and Mongo identifiers into one immutable resource manifest', () => {
    const collected = siteQueueCascadeTestables.buildSiteQueueResourceIds(
      'site-target',
      [{ id: 'schedule-a' }, { id: 'schedule-b' }],
      [{ id: 'rule-a' }],
      {
        idsByModel: new Map([
          ['Site', new Set(['site-target'])],
          ['Analysis', new Set(['analysis-a', 'analysis-b'])],
        ]),
        documents: 2,
      },
    );
    expect(collected.scheduleIds).toEqual(['schedule-a', 'schedule-b']);
    expect(collected.ruleIds).toEqual(['rule-a']);
    expect(collected.all).toEqual(new Set([
      'site-target',
      'schedule-a',
      'schedule-b',
      'rule-a',
      'analysis-a',
      'analysis-b',
    ]));
  });

  it('fails if a deleting site disappears before its queue manifest is frozen', async () => {
    const update = vi.spyOn(Site, 'findOneAndUpdate').mockResolvedValueOnce(null);
    await expect(
      persistSiteQueueResourceIds('account', 'site', resources),
    ).rejects.toThrow('deleting site disappeared while freezing queue resources');
    update.mockRestore();
  });

  it('matches nested payloads but not unrelated values', () => {
    expect(jobMatchesSiteResources({ data: null } as never, resources.all)).toBe(false);
    expect(jobMatchesSiteResources({ data: 42 } as never, resources.all)).toBe(false);
    expect(
      jobMatchesSiteResources(
        { data: { deadLetter: { payload: [{ runId: 'run-target' }] } } } as never,
        resources.all,
      ),
    ).toBe(true);
    expect(
      jobMatchesSiteResources(
        { data: { accountId: 'other', siteId: 'site-other' } } as never,
        resources.all,
      ),
    ).toBe(false);
  });

  it('does nothing when Redis is intentionally unavailable', async () => {
    await expect(
      purgeSiteQueueData(null, 'site-target', resources),
    ).resolves.toBeUndefined();
  });

  it('finds an active site job beyond the first fixed-size page', async () => {
    const active = Array.from({ length: SITE_QUEUE_CASCADE_PAGE_SIZE + 20 }, (_, index) =>
      job({ siteId: `other-${index}` }),
    );
    active.push(job({ nested: { siteId: 'site-target' } }));
    const { queues, getJobs } = fakeQueues(active, []);

    await expect(
      purgeSiteQueueData(queues, 'site-target', resources),
    ).rejects.toBeInstanceOf(SiteQueueBusyError);
    expect(getJobs).toHaveBeenCalledWith(
      ['active'],
      SITE_QUEUE_CASCADE_PAGE_SIZE,
      SITE_QUEUE_CASCADE_PAGE_SIZE * 2 - 1,
      true,
    );
  });

  it('removes every matching queued job across shifting pages and keeps other accounts', async () => {
    const targets = Array.from({ length: 130 }, (_, index) =>
      job({ accountId: 'owner', nested: { runId: index % 2 ? 'run-target' : 'site-target' } }),
    );
    const others = Array.from({ length: 140 }, (_, index) =>
      job({ accountId: 'other', siteId: `site-other-${index}` }),
    );
    const queued = [...targets, ...others].sort((left, right) =>
      JSON.stringify(left.data).localeCompare(JSON.stringify(right.data)),
    );
    const { queues, queue, getJobs } = fakeQueues([], queued);

    await purgeSiteQueueData(queues, 'site-target', resources);

    expect(targets.every((entry) => entry.remove.mock.calls.length === 1)).toBe(true);
    expect(others.every((entry) => entry.remove.mock.calls.length === 0)).toBe(true);
    expect(new Set(queued)).toEqual(new Set(others));
    expect(queue.removeJobScheduler).toHaveBeenCalledWith('rank-schedule:site-target');
    expect(queue.removeJobScheduler).toHaveBeenCalledWith('weekly-pulse:site-target');
    expect(queue.removeJobScheduler).toHaveBeenCalledWith('client-report-schedule-target');
    expect(
      getJobs.mock.calls.every(([, , end]) => Number(end) >= 0),
    ).toBe(true);
  });

  it('paginates each BullMQ state independently without skipping state-local jobs', async () => {
    const states = ['wait', 'delayed', 'completed'] as const;
    const queuedByState = Object.fromEntries(
      states.map((state) => {
        const rows = Array.from({ length: SITE_QUEUE_CASCADE_PAGE_SIZE + 35 }, (_, index) =>
          job({ siteId: `other-${state}-${index}` }),
        );
        rows[SITE_QUEUE_CASCADE_PAGE_SIZE + 20] = job({ siteId: 'site-target' });
        return [state, rows];
      }),
    );
    const targets = states.map(
      (state) => queuedByState[state]![SITE_QUEUE_CASCADE_PAGE_SIZE + 20]!,
    );
    const { queues, getJobs } = fakeQueues([], queuedByState);

    await purgeSiteQueueData(queues, 'site-target', resources);

    expect(targets.every((entry) => entry.remove.mock.calls.length === 1)).toBe(true);
    for (const state of states) {
      expect(getJobs).toHaveBeenCalledWith(
        [state],
        SITE_QUEUE_CASCADE_PAGE_SIZE,
        SITE_QUEUE_CASCADE_PAGE_SIZE * 2 - 1,
        true,
      );
    }
  });
});
