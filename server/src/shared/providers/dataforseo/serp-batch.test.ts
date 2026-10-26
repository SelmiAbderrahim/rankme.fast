import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { providerContractTests } from '../../testing/fixtures/contract.js';
import { mockVendor, vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import { VendorMalformedError, VendorQuotaError, VendorTimeoutError, VendorUnavailableError } from '../errors.js';
import { createFakeRankProvider, FAKE_RANK_SLOW_MARKER } from '../fakes.js';
import { createDataForSeoRankProvider, SERP_TASK_POST_MAX_TASKS } from './serp.js';

const endpoint = 'https://dataforseo.mock/v3/serp/google/organic/task_post';
const input = { keyword: 'seo audit tool', domain: 'example.com', locationCode: 2840,
  languageCode: 'en', device: 'desktop' as const };
const three = ['seo audit tool', 'rank tracker', 'site audit'].map((keyword) => ({ ...input, keyword }));
const provider = createDataForSeoRankProvider({ login: 'sandbox-login', password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3', timeoutMs: 60, maxRetries: 0, backoffBaseMs: 1,
  random: () => 0, wait: async () => undefined, maxPollAttempts: 3, pollIntervalMs: 0 });

providerContractTests({
  title: 'DataForSeoRankProvider.postSerpTasks', fixtureProvider: 'dataforseo-serp',
  fixtureOperation: 'task-post-batch', makeCall: () => provider.postSerpTasks(three),
  assertSuccess: (result) => expect(result).toEqual(three.map(() => ({ ok: true, vendorTaskId: 'TASK_ID' }))),
});

providerContractTests({
  title: 'DataForSeoRankProvider.pollSerpTask', fixtureProvider: 'dataforseo-serp',
  fixtureOperation: 'task-get', makeCall: () => provider.pollSerpTask('TASK_ID'),
  assertSuccess: (poll) => {
    expect(poll.state).toBe('ready');
    if (poll.state === 'ready') expect(poll.result.items).toHaveLength(3);
  },
});

describe('batched SERP task queue', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('keeps task-level failures in input order while returning successful siblings', async () => {
    mockVendor('dataforseo-serp', 'task-post-batch', 'mixed');
    const inputs = [...three, { ...input, keyword: 'keyword research' }, { ...input, keyword: 'backlink checker' }];
    const outcomes = await provider.postSerpTasks(inputs);
    expect(outcomes).toHaveLength(5);
    expect(outcomes[0]).toEqual({ ok: true, vendorTaskId: 'TASK_ID' });
    expect(outcomes[1]?.ok).toBe(false);
    expect(outcomes[2]?.ok).toBe(false);
    expect(outcomes[3]?.ok).toBe(false);
    expect(outcomes[4]?.ok).toBe(false);
    expect(outcomes[4]?.ok ? null : outcomes[4]?.error).toBeInstanceOf(VendorQuotaError);
  });

  it('posts at most 100 tasks in one request', async () => {
    const sizes: number[] = [];
    vendorMockServer.use(http.post(endpoint, async ({ request }) => {
      const body = await request.json() as Array<{ keyword: string }>;
      sizes.push(body.length);
      return HttpResponse.json({ status_code: 20000,
        tasks: body.map(() => ({ id: 'TASK_ID', status_code: 20100, result: null })) });
    }));
    const outcomes = await provider.postSerpTasks(Array.from({ length: 201 }, (_, i) => ({ ...input, keyword: `term ${i}` })));
    expect(SERP_TASK_POST_MAX_TASKS).toBe(100);
    expect(sizes).toEqual([100, 100, 1]);
    expect(outcomes).toHaveLength(201);
  });

  it('a request-level quota rejection stops the batch', async () => {
    mockVendor('dataforseo-serp', 'task-post-batch', 'quota');
    await expect(provider.postSerpTasks(three)).rejects.toBeInstanceOf(VendorQuotaError);
  });

  it('polls a still-queued task once and leaves it pending', async () => {
    mockVendor('dataforseo-serp', 'task-get', 'in-queue');
    await expect(provider.pollSerpTask('TASK_ID')).resolves.toEqual({ state: 'pending' });
  });

  it('reports a task-level fault without throwing or retrying', async () => {
    vendorMockServer.use(http.get('*/serp/google/organic/task_get/advanced/*', () =>
      HttpResponse.json({ status_code: 20000,
        tasks: [{ id: 'TASK_ID', status_code: 50000, status_message: 'Task unavailable.', result: null }] })));
    const poll = await provider.pollSerpTask('TASK_ID');
    expect(poll.state).toBe('failed');
    if (poll.state === 'failed') expect(poll.error).toBeInstanceOf(VendorUnavailableError);
  });

  it('treats an unknown task id as pending while the vendor indexes it', async () => {
    vendorMockServer.use(http.get('*/serp/google/organic/task_get/advanced/*', () =>
      HttpResponse.json({ status_code: 20000, tasks: [] })));
    await expect(provider.pollSerpTask('TASK_ID')).resolves.toEqual({ state: 'pending' });
  });

  it('keeps the direct fetch loop on one task id until ready', async () => {
    let calls = 0;
    vendorMockServer.use(http.get('*/serp/google/organic/task_get/advanced/*', () => {
      calls++;
      return HttpResponse.json(calls < 3
        ? { status_code: 20000, tasks: [{ id: 'TASK_ID', status_code: 40602, result: null }] }
        : { status_code: 20000, tasks: [{ id: 'TASK_ID', status_code: 20000, result: [{ items: [] }] }] });
    }));
    await expect(provider.fetchSerpResult('TASK_ID')).resolves.toMatchObject({ items: [] });
    expect(calls).toBe(3);
  });

  it('fails when a task post omits an input response', async () => {
    vendorMockServer.use(http.post(endpoint, () => HttpResponse.json({ status_code: 20000,
      tasks: [{ id: 'TASK_ID', status_code: 20100, result: null }] })));
    const outcomes = await provider.postSerpTasks(three);
    expect(outcomes[1]?.ok ? null : outcomes[1]?.error).toBeInstanceOf(VendorMalformedError);
    expect(outcomes[2]?.ok ? null : outcomes[2]?.error).toBeInstanceOf(VendorMalformedError);
  });
});

describe('fake SERP task queue', () => {
  it('keeps a marked task pending for two polls by default', async () => {
    const fake = createFakeRankProvider({ serpTasks: {} });
    const [posted] = await fake.postSerpTasks!([{ ...input, keyword: `seo ${FAKE_RANK_SLOW_MARKER} tool` }]);
    expect(posted?.ok).toBe(true);
    if (!posted?.ok) return;
    await expect(fake.pollSerpTask!(posted.vendorTaskId)).resolves.toEqual({ state: 'pending' });
    await expect(fake.pollSerpTask!(posted.vendorTaskId)).resolves.toEqual({ state: 'pending' });
    await expect(fake.pollSerpTask!(posted.vendorTaskId)).resolves.toMatchObject({ state: 'ready' });
  });

  it('lets an explicit pending count override the slow marker', async () => {
    const fake = createFakeRankProvider({ serpTasks: { pendingPolls: 0 } });
    const [posted] = await fake.postSerpTasks!([{ ...input, keyword: `seo ${FAKE_RANK_SLOW_MARKER} tool` }]);
    expect(posted?.ok).toBe(true);
    if (!posted?.ok) return;
    await expect(fake.pollSerpTask!(posted.vendorTaskId)).resolves.toMatchObject({ state: 'ready' });
  });

  it('holds each task for its configured poll count, then returns a normalized result', async () => {
    const fake = createFakeRankProvider({ serpTasks: { pendingPolls: (keyword) => keyword === 'slow' ? 2 : 0 } });
    const [slow, fast] = await fake.postSerpTasks!([{ ...input, keyword: 'slow' }, { ...input, keyword: 'fast' }]);
    expect(slow?.ok && fast?.ok).toBe(true);
    if (!slow?.ok || !fast?.ok) return;
    await expect(fake.pollSerpTask!(slow.vendorTaskId)).resolves.toEqual({ state: 'pending' });
    await expect(fake.pollSerpTask!(fast.vendorTaskId)).resolves.toMatchObject({ state: 'ready' });
    await expect(fake.pollSerpTask!(slow.vendorTaskId)).resolves.toEqual({ state: 'pending' });
    await expect(fake.pollSerpTask!(slow.vendorTaskId)).resolves.toMatchObject({ state: 'ready' });
  });

  it('returns a ready first poll by default and rejects an unknown id as a failed task', async () => {
    const fake = createFakeRankProvider({ serpTasks: {} });
    const [posted] = await fake.postSerpTasks!([input]);
    expect(posted?.ok).toBe(true);
    if (!posted?.ok) return;
    const ready = await fake.pollSerpTask!(posted.vendorTaskId);
    expect(ready.state).toBe('ready');
    if (ready.state === 'ready') expect(ready.result.items[2]?.url).toBe('https://example.com/pricing');
    const missing = await fake.pollSerpTask!('unknown');
    expect(missing.state).toBe('failed');
    if (missing.state === 'failed') expect(missing.error).toBeInstanceOf(VendorMalformedError);
  });

  it('keeps injected fake provider failure typed for posts and polls', async () => {
    const failure = new VendorTimeoutError('timed out', { provider: 'fake', operation: 'serp' });
    const fake = createFakeRankProvider({ serpTasks: { pendingPolls: 1 }, failure });
    await expect(fake.postSerpTasks!([input])).rejects.toBe(failure);
    await expect(fake.pollSerpTask!('unknown')).rejects.toBe(failure);
  });
});
