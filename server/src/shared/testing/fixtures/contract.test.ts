import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  VendorMalformedError,
  VendorUnavailableError,
} from '../../providers/errors.js';
import { dataForSeoRequest, type DataForSeoConfig } from '../../providers/http.js';
import { providerContractTests } from './contract.js';
import { mockVendor, vendorMockServer } from './mock-vendor.js';

// Reference instantiation of the contract template: a thin SERP task_get
// call built on dataForSeoRequest, exactly how the DataForSEO adapters
// (prompts 06+) will consume it. Proves template + mockVendor + fixtures +
// helper end-to-end.

// Mirrors the real adapter: url/domain optional because the advanced
// endpoint mixes organic entries with ai_overview / people_also_ask items
// that carry neither.
const serpResultSchema = z.array(
  z.object({
    keyword: z.string(),
    items: z.array(
      z
        .object({
          type: z.string(),
          url: z.string().nullable().optional(),
          domain: z.string().nullable().optional(),
          rank_absolute: z.number().nullable().optional(),
        })
        .passthrough(),
    ),
  }),
);

// Short deadline + no retries, as the contract-template JSDoc requires: the
// timeout case is served by an endpoint that never answers (real timers).
const cfg: DataForSeoConfig = {
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
};

function serpTaskGet() {
  return dataForSeoRequest(
    cfg,
    '/serp/google/organic/task_get/advanced/TASK_ID',
    [],
    serpResultSchema,
    { operation: 'serp-task-get' },
  );
}

providerContractTests({
  title: 'dataForSeoRequest serp task_get (reference)',
  fixtureProvider: 'dataforseo-serp',
  fixtureOperation: 'task-get',
  makeCall: serpTaskGet,
  assertSuccess: (outcomes) => {
    expect(outcomes).toHaveLength(1);
    const outcome = outcomes[0]!;
    if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.status}`);
    expect(outcome.taskId).toBe('TASK_ID');
    expect(outcome.costUsd).toBe(0.0006);
    expect(outcome.result[0]!.items).toHaveLength(5);
    expect(outcome.result[0]!.items[4]).toMatchObject({
      domain: 'example.com',
      rank_absolute: 5,
    });
    expect(outcome.result[0]!.items[0]).toMatchObject({ type: 'ai_overview' });
  },
});

describe('operation-specific fixture extras', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('in-queue: surfaces the keep-polling outcome', async () => {
    mockVendor('dataforseo-serp', 'task-get', 'in-queue');
    await expect(serpTaskGet()).resolves.toEqual([{ status: 'in_queue', taskId: null }]);
  });

  it('unavailable: an HTTP 503 fixture maps to VendorUnavailableError', async () => {
    mockVendor('dataforseo-serp', 'task-get', 'unavailable');
    await expect(serpTaskGet()).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('malformed-result: a valid envelope with contract-drifted result maps to VendorMalformedError', async () => {
    mockVendor('dataforseo-serp', 'task-get', 'malformed-result');
    await expect(serpTaskGet()).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('task_post success: 20100 acknowledges creation with the vendor task id', async () => {
    mockVendor('dataforseo-serp', 'task-post', 'success');
    const outcomes = await dataForSeoRequest(
      cfg,
      '/serp/google/organic/task_post',
      [{ keyword: 'seo audit tool', language_code: 'en', location_code: 2840 }],
      serpResultSchema,
      { operation: 'serp-task-post' },
    );
    expect(outcomes).toEqual([{ status: 'created', taskId: 'TASK_ID', costUsd: 0.0006 }]);
  });
});
