import { describe, expect, it, vi } from 'vitest';
import type { Queues } from '../../shared/queue/index.js';
import {
  ACCOUNT_QUEUE_CASCADE_PAGE_SIZE,
  AccountQueueBusyError,
  AccountQueueUnavailableError,
  jobMatchesAccount,
  purgeAccountQueueData,
} from './account-queue-cascade.js';

interface FakeJob {
  data: unknown;
  remove: ReturnType<typeof vi.fn>;
}

interface FakeScheduler {
  key: string;
  template?: { data?: unknown };
}

function job(data: unknown): FakeJob {
  return { data, remove: vi.fn() };
}

function fakeQueue(input: {
  active?: FakeJob[];
  queued?: Record<string, FakeJob[]>;
  schedulers?: FakeScheduler[];
} = {}) {
  const active = input.active ?? [];
  const queued = input.queued ?? {};
  const schedulers = input.schedulers ?? [];
  for (const row of Object.values(queued).flat()) {
    row.remove.mockImplementation(async () => {
      for (const stateRows of Object.values(queued)) {
        const index = stateRows.indexOf(row);
        if (index >= 0) stateRows.splice(index, 1);
      }
    });
  }
  const getJobs = vi.fn(async (states: string[], start: number, end: number) => {
    const source = states.includes('active')
      ? active
      : states.flatMap((state) => queued[state] ?? []);
    return source.slice(start, end + 1);
  });
  const getJobSchedulers = vi.fn(async (start: number, end: number) =>
    schedulers.slice(start, end + 1),
  );
  const removeJobScheduler = vi.fn(async (key: string) => {
    const index = schedulers.findIndex((entry) => entry.key === key);
    if (index >= 0) schedulers.splice(index, 1);
    return index >= 0;
  });
  return {
    queue: { getJobs, getJobSchedulers, removeJobScheduler },
    active,
    queued,
    schedulers,
    getJobs,
    getJobSchedulers,
    removeJobScheduler,
  };
}

function fakeQueues(work: ReturnType<typeof fakeQueue>, purge = fakeQueue()): Queues {
  const queue = work.queue;
  return {
    audits: queue,
    ranks: queue,
    accountPurge: purge.queue,
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
}

const accountId = 'aaaaaaaaaaaaaaaaaaaaaaaa';

describe('account queue cascade', () => {
  it('matches only structured ownership fields, including dead-letter originals', () => {
    expect(jobMatchesAccount({ data: { accountId } } as never, accountId)).toBe(true);
    expect(jobMatchesAccount({ data: { userId: accountId } } as never, accountId)).toBe(true);
    expect(
      jobMatchesAccount(
        { data: { original: { userId: accountId }, queue: 'account-purge' } } as never,
        accountId,
      ),
    ).toBe(true);
    expect(
      jobMatchesAccount({ data: { nested: { accountId } } } as never, accountId),
    ).toBe(true);
    expect(
      jobMatchesAccount({ data: [{ accountId: 'other' }, { accountId }] } as never, accountId),
    ).toBe(true);
    expect(
      jobMatchesAccount({ data: { nested: { userId: accountId } } } as never, accountId),
    ).toBe(false);
    expect(
      jobMatchesAccount({ data: { prompt: `mention ${accountId}`, accountId: 'other' } } as never, accountId),
    ).toBe(false);
  });

  it('fails closed when the Redis inventory is unavailable', async () => {
    await expect(purgeAccountQueueData(null, accountId)).rejects.toBeInstanceOf(
      AccountQueueUnavailableError,
    );
  });

  it('blocks on active account work beyond the first page but ignores the current purge queue', async () => {
    const active = Array.from({ length: ACCOUNT_QUEUE_CASCADE_PAGE_SIZE + 25 }, (_, index) =>
      job({ accountId: `other-${index}` }),
    );
    active.push(job({ accountId }));
    const work = fakeQueue({ active });
    const currentPurge = fakeQueue({ active: [job({ userId: accountId })] });

    await expect(
      purgeAccountQueueData(fakeQueues(work, currentPurge), accountId),
    ).rejects.toBeInstanceOf(AccountQueueBusyError);
    expect(work.getJobs).toHaveBeenCalledWith(
      ['active'],
      ACCOUNT_QUEUE_CASCADE_PAGE_SIZE,
      ACCOUNT_QUEUE_CASCADE_PAGE_SIZE * 2 - 1,
      true,
    );
    expect(currentPurge.getJobs).not.toHaveBeenCalledWith(
      ['active'],
      expect.any(Number),
      expect.any(Number),
      true,
    );
  });

  it('paginates every state independently and removes duplicate purge jobs only for the target', async () => {
    const states = ['wait', 'delayed', 'failed'] as const;
    const queued = Object.fromEntries(
      states.map((state) => {
        const rows = Array.from({ length: ACCOUNT_QUEUE_CASCADE_PAGE_SIZE + 35 }, (_, index) =>
          job({ accountId: `other-${state}-${index}` }),
        );
        rows[ACCOUNT_QUEUE_CASCADE_PAGE_SIZE + 20] = job({ accountId });
        return [state, rows];
      }),
    );
    const targets = states.map(
      (state) => queued[state]![ACCOUNT_QUEUE_CASCADE_PAGE_SIZE + 20]!,
    );
    const work = fakeQueue({ queued });
    const purgeTarget = job({ userId: accountId });
    const purgeControl = job({ userId: 'bbbbbbbbbbbbbbbbbbbbbbbb' });
    const purge = fakeQueue({ queued: { delayed: [purgeTarget, purgeControl] } });

    await purgeAccountQueueData(fakeQueues(work, purge), accountId);

    expect(targets.every((entry) => entry.remove.mock.calls.length === 1)).toBe(true);
    expect(purgeTarget.remove).toHaveBeenCalledOnce();
    expect(purgeControl.remove).not.toHaveBeenCalled();
    for (const state of states) {
      expect(work.getJobs).toHaveBeenCalledWith(
        [state],
        ACCOUNT_QUEUE_CASCADE_PAGE_SIZE,
        ACCOUNT_QUEUE_CASCADE_PAGE_SIZE * 2 - 1,
        true,
      );
    }
  });

  it('removes account schedulers across shifting pages and preserves controls', async () => {
    const schedulers: FakeScheduler[] = Array.from(
      { length: ACCOUNT_QUEUE_CASCADE_PAGE_SIZE + 30 },
      (_, index) => ({
        key: `control-${index}`,
        template: { data: { accountId: `other-${index}` } },
      }),
    );
    const firstTarget = { key: 'target-first', template: { data: { accountId } } };
    const secondTarget = {
      key: 'target-late',
      template: { data: { nested: { accountId } } },
    };
    schedulers.splice(10, 0, firstTarget);
    schedulers.splice(ACCOUNT_QUEUE_CASCADE_PAGE_SIZE + 15, 0, secondTarget);
    const work = fakeQueue({ schedulers });

    await purgeAccountQueueData(fakeQueues(work), accountId);

    expect(work.removeJobScheduler).toHaveBeenCalledWith('target-first');
    expect(work.removeJobScheduler).toHaveBeenCalledWith('target-late');
    expect(schedulers).not.toContain(firstTarget);
    expect(schedulers).not.toContain(secondTarget);
    expect(schedulers).toHaveLength(ACCOUNT_QUEUE_CASCADE_PAGE_SIZE + 30);
    expect(work.getJobSchedulers).toHaveBeenCalledWith(
      ACCOUNT_QUEUE_CASCADE_PAGE_SIZE - 1,
      ACCOUNT_QUEUE_CASCADE_PAGE_SIZE * 2 - 2,
      true,
    );
  });
});
