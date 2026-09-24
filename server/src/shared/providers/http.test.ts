import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { Logger } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ProviderError,
  VendorAuthError,
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
  VendorUnavailableError,
} from './errors.js';
import {
  clearDataForSeoClientCache,
  createVendorHttpClient,
  dataForSeoClientCacheSize,
  dataForSeoRequest,
  extractVendorCost,
  type DataForSeoConfig,
  type VendorHttpClientConfig,
} from './http.js';
import { captureVendorCost } from './cost-capture.js';

const BASE = 'https://vendor.test/v3';
const URL_THING = `${BASE}/thing`;

const okSchema = z.object({ ok: z.literal(true), cost: z.number().optional() });

const server = setupServer();

function makeLoggerSpy() {
  const info = vi.fn();
  const warn = vi.fn();
  return { spy: { info, warn }, logger: { info, warn } as unknown as Logger };
}

function makeClient(overrides: Partial<VendorHttpClientConfig> = {}) {
  return createVendorHttpClient({
    provider: 'testvendor',
    baseUrl: BASE,
    maxRetries: 0,
    backoffBaseMs: 1,
    random: () => 0,
    ...overrides,
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());

describe('createVendorHttpClient', () => {
  it('POSTs JSON, validates the response, and logs structured cost (default config path)', async () => {
    let received: { body: unknown; contentType: string | null } | undefined;
    server.use(
      http.post(URL_THING, async ({ request }) => {
        received = {
          body: await request.json(),
          contentType: request.headers.get('content-type'),
        };
        return HttpResponse.json({ ok: true, cost: 0.05 });
      }),
    );
    const { spy, logger } = makeLoggerSpy();
    // Raw config (no makeClient) — covers the maxRetries/backoff/random/fetch defaults.
    const client = createVendorHttpClient({ provider: 'testvendor', baseUrl: BASE, logger });
    const result = await client.request({
      operation: 'thing-post',
      path: '/thing',
      body: { hello: 'vendor' },
      schema: okSchema,
    });
    expect(result).toEqual({ ok: true, cost: 0.05 });
    expect(received).toEqual({ body: { hello: 'vendor' }, contentType: 'application/json' });
    expect(spy.info).toHaveBeenCalledWith(
      { provider: 'testvendor', operation: 'thing-post', status: 200, attempt: 0, costUsd: 0.05 },
      'vendor request ok',
    );
  });

  it('supports GET without a body and works without a logger', async () => {
    server.use(http.get(URL_THING, () => HttpResponse.json({ ok: true })));
    const result = await makeClient().request({
      operation: 'thing-get',
      path: '/thing',
      method: 'GET',
      schema: okSchema,
    });
    expect(result).toEqual({ ok: true });
  });

  it('uses an injected fetchImpl when provided', async () => {
    const fetchImpl = vi.fn(async () => HttpResponse.json({ ok: true }));
    const result = await makeClient({ fetchImpl: fetchImpl as unknown as typeof fetch }).request({
      operation: 'thing-post',
      path: '/thing',
      schema: okSchema,
    });
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(URL_THING, expect.objectContaining({ method: 'POST' }));
  });

  it('times out after the default 30s deadline (fake timers)', async () => {
    server.use(http.post(URL_THING, () => delay('infinite') as unknown as Promise<Response>));
    vi.useFakeTimers();
    const promise = makeClient().request({
      operation: 'thing-post',
      path: '/thing',
      schema: okSchema,
    });
    const assertion = expect(promise).rejects.toThrow(
      new VendorTimeoutError('no response within 30000ms', {
        provider: 'testvendor',
        operation: 'thing-post',
      }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('honours a per-call timeout override (fake timers)', async () => {
    server.use(http.post(URL_THING, () => delay('infinite') as unknown as Promise<Response>));
    vi.useFakeTimers();
    const promise = makeClient({ timeoutMs: 90_000 }).request({
      operation: 'thing-post',
      path: '/thing',
      schema: okSchema,
      timeoutMs: 50,
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(VendorTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it('honours a client-level timeout config (fake timers)', async () => {
    server.use(http.post(URL_THING, () => delay('infinite') as unknown as Promise<Response>));
    vi.useFakeTimers();
    const promise = makeClient({ timeoutMs: 75 }).request({
      operation: 'thing-post',
      path: '/thing',
      schema: okSchema,
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(VendorTimeoutError);
    await vi.advanceTimersByTimeAsync(75);
    await assertion;
  });

  it('surfaces VendorTimeoutError when the vendor stalls mid-body', async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":'));
          if (signal) {
            const onAbort = () => controller.error(new DOMException('aborted', 'AbortError'));
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort);
          }
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    vi.useFakeTimers();
    const promise = makeClient({ fetchImpl, timeoutMs: 50 }).request({
      operation: 'thing-post',
      path: '/thing',
      schema: okSchema,
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(VendorTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it('distinguishes caller cancellation before a response from a vendor timeout', async () => {
    const controller = new AbortController();
    controller.abort(new Error('caller stopped'));
    const fetchImpl: typeof fetch = async (_input, init) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return HttpResponse.json({ ok: true });
    };

    const error = await makeClient({ fetchImpl }).request({
      operation: 'thing-post',
      path: '/thing',
      schema: okSchema,
      signal: controller.signal,
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ message: 'request cancelled', retryable: false });
  });

  it('distinguishes caller cancellation during body streaming from a vendor timeout', async () => {
    const controller = new AbortController();
    const fetchImpl: typeof fetch = async (_input, init) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode('{"ok":'));
          signal?.addEventListener(
            'abort',
            () => streamController.error(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const pending = makeClient({ fetchImpl }).request({
      operation: 'thing-post',
      path: '/thing',
      schema: okSchema,
      signal: controller.signal,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort(new Error('caller stopped'));

    const error = await pending.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ message: 'request cancelled', retryable: false });
  });

  it('non-abort body-read failure surfaces VendorMalformedError', async () => {
    const fetchImpl: typeof fetch = async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new TypeError('body stream failure'));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await expect(
      makeClient({ fetchImpl }).request({
        operation: 'thing-post',
        path: '/thing',
        schema: okSchema,
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('retries a retryable failure then succeeds, logging the retry', async () => {
    let calls = 0;
    server.use(
      http.post(URL_THING, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json({ ok: true });
      }),
    );
    const { spy, logger } = makeLoggerSpy();
    const result = await makeClient({ maxRetries: 2, logger }).request({
      operation: 'thing-post',
      path: '/thing',
      schema: okSchema,
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(spy.warn).toHaveBeenCalledTimes(1);
    expect(spy.warn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'testvendor', operation: 'thing-post', attempt: 0 }),
      'vendor request retrying',
    );
  });

  it('lets a client-specific policy suppress an otherwise retryable error', async () => {
    let calls = 0;
    const shouldRetryError = vi.fn(() => false);
    server.use(
      http.post(URL_THING, () => {
        calls += 1;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    const error = await makeClient({ maxRetries: 2, shouldRetryError })
      .request({ operation: 'thing-post', path: '/thing', schema: okSchema })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(VendorUnavailableError);
    expect(error).toMatchObject({ httpStatus: 503, retryable: true });
    expect(shouldRetryError).toHaveBeenCalledOnce();
    expect(shouldRetryError).toHaveBeenCalledWith(error);
    expect(calls).toBe(1);
  });

  it('exhausts in-client retries and surfaces the last error (no logger)', async () => {
    let calls = 0;
    server.use(
      http.post(URL_THING, () => {
        calls += 1;
        return new HttpResponse(null, { status: 502 });
      }),
    );
    await expect(
      makeClient({ maxRetries: 1 }).request({
        operation: 'thing-post',
        path: '/thing',
        schema: okSchema,
      }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
    expect(calls).toBe(2);
  });

  it('does not retry non-retryable errors even with retries configured', async () => {
    let calls = 0;
    server.use(
      http.post(URL_THING, () => {
        calls += 1;
        return new HttpResponse(null, { status: 401 });
      }),
    );
    const error = await makeClient({ maxRetries: 2 })
      .request({
        operation: 'thing-post',
        path: '/thing',
        schema: okSchema,
      })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(VendorAuthError);
    expect(error).toMatchObject({ httpStatus: 401 });
    expect(calls).toBe(1);
  });

  it('maps 403 to VendorAuthError', async () => {
    server.use(http.post(URL_THING, () => new HttpResponse(null, { status: 403 })));
    const error = await makeClient()
      .request({ operation: 'thing-post', path: '/thing', schema: okSchema })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(VendorAuthError);
    expect(error).toMatchObject({ httpStatus: 403 });
  });

  it('maps vendor-specific HTTP 402 to a quota error with its response status', async () => {
    server.use(http.post(URL_THING, () => new HttpResponse(null, { status: 402 })));
    const error = await makeClient({ quotaStatuses: [402, 429] })
      .request({ operation: 'thing-post', path: '/thing', schema: okSchema })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(VendorQuotaError);
    expect(error).toMatchObject({ httpStatus: 402 });
  });

  it('maps 429 to VendorQuotaError carrying Retry-After', async () => {
    server.use(
      http.post(
        URL_THING,
        () => new HttpResponse(null, { status: 429, headers: { 'retry-after': '17' } }),
      ),
    );
    const err = await makeClient()
      .request({ operation: 'thing-post', path: '/thing', schema: okSchema })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VendorQuotaError);
    expect((err as VendorQuotaError).retryAfterSeconds).toBe(17);
    expect((err as VendorQuotaError).httpStatus).toBe(429);
  });

  it('maps 429 without (or with an unparsable) Retry-After to an unknown wait', async () => {
    server.use(http.post(URL_THING, () => new HttpResponse(null, { status: 429 })));
    const bare = await makeClient()
      .request({ operation: 'thing-post', path: '/thing', schema: okSchema })
      .catch((e: unknown) => e);
    expect((bare as VendorQuotaError).retryAfterSeconds).toBeUndefined();

    server.use(
      http.post(
        URL_THING,
        () => new HttpResponse(null, { status: 429, headers: { 'retry-after': 'Wed, 21 Oct' } }),
      ),
    );
    const dated = await makeClient()
      .request({ operation: 'thing-post', path: '/thing', schema: okSchema })
      .catch((e: unknown) => e);
    expect((dated as VendorQuotaError).retryAfterSeconds).toBeUndefined();
  });

  it('maps other non-2xx statuses to VendorMalformedError', async () => {
    server.use(http.post(URL_THING, () => new HttpResponse(null, { status: 404 })));
    const error = await makeClient()
      .request({ operation: 'thing-post', path: '/thing', schema: okSchema })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(VendorMalformedError);
    expect(error).toMatchObject({ message: 'unexpected HTTP 404', httpStatus: 404 });
  });

  it('maps vendor timeout status responses to VendorTimeoutError', async () => {
    for (const status of [408, 504]) {
      server.use(http.post(URL_THING, () => new HttpResponse(null, { status })));
      const error = await makeClient()
        .request({ operation: 'thing-post', path: '/thing', schema: okSchema })
        .catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(VendorTimeoutError);
      expect(error).toMatchObject({ httpStatus: status });
      server.resetHandlers();
    }
  });

  it('maps a non-JSON body to VendorMalformedError', async () => {
    server.use(http.post(URL_THING, () => HttpResponse.text('<html>not json</html>')));
    await expect(
      makeClient().request({ operation: 'thing-post', path: '/thing', schema: okSchema }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('maps an empty successful response body to VendorMalformedError', async () => {
    const fetchImpl: typeof fetch = async () => new Response(null, { status: 200 });
    await expect(
      makeClient({ fetchImpl }).request({
        operation: 'thing-post',
        path: '/thing',
        schema: okSchema,
      }),
    ).rejects.toThrow(/body is empty/);
  });

  it('enforces client and per-call response byte ceilings', async () => {
    server.use(http.post(URL_THING, () => HttpResponse.json({ ok: true, padding: '1234567890' })));
    await expect(
      makeClient({ maxResponseBytes: 8 }).request({
        operation: 'thing-post',
        path: '/thing',
        schema: okSchema,
      }),
    ).rejects.toThrow(/byte ceiling/);

    await expect(
      makeClient({ maxResponseBytes: 1_000 }).request({
        operation: 'thing-post',
        path: '/thing',
        schema: okSchema,
        maxResponseBytes: 8,
      }),
    ).rejects.toThrow(/byte ceiling/);
  });

  it('rejects invalid response ceilings before a vendor call', async () => {
    expect(() => makeClient({ maxResponseBytes: 0 })).toThrow(/positive integer/);
    await expect(
      makeClient().request({
        operation: 'thing-post',
        path: '/thing',
        schema: okSchema,
        maxResponseBytes: 0,
      }),
    ).rejects.toThrow(/positive integer/);
  });

  it('maps valid-JSON-but-wrong-shape to VendorMalformedError (schema mismatch)', async () => {
    server.use(http.post(URL_THING, () => HttpResponse.json({ ok: 'yes' })));
    await expect(
      makeClient().request({ operation: 'thing-post', path: '/thing', schema: okSchema }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('maps a network failure to VendorUnavailableError', async () => {
    server.use(http.post(URL_THING, () => HttpResponse.error()));
    await expect(
      makeClient().request({ operation: 'thing-post', path: '/thing', schema: okSchema }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('propagates unexpected non-taxonomy errors without retrying', async () => {
    let calls = 0;
    server.use(
      http.post(URL_THING, () => {
        calls += 1;
        return HttpResponse.json({ ok: true });
      }),
    );
    const boom = new Error('schema exploded');
    const poisoned = {
      safeParse: () => {
        throw boom;
      },
    } as unknown as z.ZodType<{ ok: true }>;
    await expect(
      makeClient({ maxRetries: 2 }).request({
        operation: 'thing-post',
        path: '/thing',
        schema: poisoned,
      }),
    ).rejects.toBe(boom);
    expect(calls).toBe(1);
  });

  it('never logs Authorization material', async () => {
    server.use(http.post(URL_THING, () => HttpResponse.json({ ok: true })));
    const { spy, logger } = makeLoggerSpy();
    await makeClient({
      headers: { authorization: 'Basic dG9wc2VjcmV0OnBhc3M=' },
      logger,
    }).request({ operation: 'thing-post', path: '/thing', schema: okSchema });
    const logged = JSON.stringify([...spy.info.mock.calls, ...spy.warn.mock.calls]);
    expect(logged).not.toMatch(/authorization/i);
    expect(logged).not.toContain('dG9wc2VjcmV0OnBhc3M=');
  });
});

describe('extractVendorCost', () => {
  it('extracts a numeric cost and rejects everything else', () => {
    expect(extractVendorCost({ cost: 0.12 })).toBe(0.12);
    expect(extractVendorCost({ cost: '0.12' })).toBeUndefined();
    expect(extractVendorCost({ other: 1 })).toBeUndefined();
    expect(extractVendorCost(null)).toBeUndefined();
    expect(extractVendorCost('cost')).toBeUndefined();
    expect(extractVendorCost([{ cost: 1 }])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DataForSEO helper
// ---------------------------------------------------------------------------

const DFS_PATH = '/serp/google/organic/task_get/advanced/TASK_ID';
const DFS_URL = `${BASE}${DFS_PATH}`;

const dfsResultSchema = z.array(z.object({ keyword: z.string() }));

const dfsConfig: DataForSeoConfig = {
  login: 'dfs-login',
  password: 'dfs-password',
  baseUrl: BASE,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
};

function dfsEnvelope(overrides: Record<string, unknown>) {
  return { version: '0.1.20260101', status_message: 'Ok.', ...overrides };
}

describe('dataForSeoRequest', () => {
  it('sends Basic auth from config and parses an ok task (both levels 20000)', async () => {
    let auth: string | null = null;
    let body: unknown;
    server.use(
      http.post(DFS_URL, async ({ request }) => {
        auth = request.headers.get('authorization');
        body = await request.json();
        return HttpResponse.json(
          dfsEnvelope({
            status_code: 20000,
            cost: 0.0006,
            tasks: [
              {
                id: 'TASK_ID',
                status_code: 20000,
                cost: 0.0006,
                result: [{ keyword: 'seo audit tool' }],
              },
            ],
          }),
        );
      }),
    );
    const outcomes = await dataForSeoRequest(
      dfsConfig,
      DFS_PATH,
      [{ keyword: 'seo audit tool' }],
      dfsResultSchema,
      { operation: 'serp-task-get' },
    );
    expect(outcomes).toEqual([
      {
        status: 'ok',
        taskId: 'TASK_ID',
        costUsd: 0.0006,
        result: [{ keyword: 'seo audit tool' }],
      },
    ]);
    expect(auth).toBe(`Basic ${Buffer.from('dfs-login:dfs-password').toString('base64')}`);
    expect(body).toEqual([{ keyword: 'seo audit tool' }]);
  });

  it('records the envelope cost into an active capture scope, summed across requests', async () => {
    server.use(
      http.post(DFS_URL, () =>
        HttpResponse.json(
          dfsEnvelope({
            status_code: 20000,
            cost: 0.0006,
            tasks: [{ id: 'TASK_ID', status_code: 20000, cost: 0.0006, result: [] }],
          }),
        ),
      ),
    );
    const { costMicros } = await captureVendorCost(async () => {
      await dataForSeoRequest(dfsConfig, DFS_PATH, [], dfsResultSchema);
      await dataForSeoRequest(dfsConfig, DFS_PATH, [], dfsResultSchema);
    });
    expect(costMicros).toBe(1_200n);
  });

  it('records nothing when the envelope carries no cost', async () => {
    server.use(
      http.post(DFS_URL, () =>
        HttpResponse.json(
          dfsEnvelope({
            status_code: 20000,
            cost: null,
            tasks: [{ id: 'TASK_ID', status_code: 20000, result: [] }],
          }),
        ),
      ),
    );
    const { costMicros } = await captureVendorCost(() =>
      dataForSeoRequest(dfsConfig, DFS_PATH, [], dfsResultSchema),
    );
    expect(costMicros).toBeNull();
  });

  it('classifies 20100 as created (cost absent → null) and defaults operation to the path', async () => {
    server.use(
      http.post(DFS_URL, () =>
        HttpResponse.json(
          dfsEnvelope({
            status_code: 20000,
            tasks: [{ id: 'TASK_ID', status_code: 20100 }],
          }),
        ),
      ),
    );
    const outcomes = await dataForSeoRequest(dfsConfig, DFS_PATH, [], dfsResultSchema);
    expect(outcomes).toEqual([{ status: 'created', taskId: 'TASK_ID', costUsd: null }]);
  });

  it.each([40601, 40602])('classifies %i as in_queue (keep polling)', async (statusCode) => {
    server.use(
      http.post(DFS_URL, () =>
        HttpResponse.json(
          dfsEnvelope({ status_code: 20000, tasks: [{ status_code: statusCode }] }),
        ),
      ),
    );
    const outcomes = await dataForSeoRequest(dfsConfig, DFS_PATH, [], dfsResultSchema);
    expect(outcomes).toEqual([{ status: 'in_queue', taskId: null }]);
  });

  it('throws on a top-level error even when the task level is ok', async () => {
    server.use(
      http.post(DFS_URL, () =>
        HttpResponse.json(
          dfsEnvelope({
            status_code: 40200,
            status_message: 'Payment Required.',
            tasks: [{ id: 'TASK_ID', status_code: 20000, result: [] }],
          }),
        ),
      ),
    );
    await expect(dataForSeoRequest(dfsConfig, DFS_PATH, [], dfsResultSchema)).rejects.toThrow(
      new VendorQuotaError('vendor status 40200: Payment Required.', {
        provider: 'dataforseo',
        operation: DFS_PATH,
      }),
    );
  });

  it('maps 401xx to VendorAuthError and 5xxxx to VendorUnavailableError', async () => {
    server.use(
      http.post(DFS_URL, () => HttpResponse.json(dfsEnvelope({ status_code: 40101 }))),
    );
    await expect(
      dataForSeoRequest(dfsConfig, DFS_PATH, [], dfsResultSchema),
    ).rejects.toBeInstanceOf(VendorAuthError);

    server.use(
      http.post(DFS_URL, () => HttpResponse.json(dfsEnvelope({ status_code: 50000 }))),
    );
    await expect(
      dataForSeoRequest(dfsConfig, DFS_PATH, [], dfsResultSchema),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('maps an unrecognized vendor status to VendorMalformedError (message absent)', async () => {
    server.use(
      http.post(DFS_URL, () =>
        HttpResponse.json({ status_code: 30000, tasks: [] }),
      ),
    );
    await expect(dataForSeoRequest(dfsConfig, DFS_PATH, [], dfsResultSchema)).rejects.toThrow(
      new VendorMalformedError('unrecognized vendor status 30000', {
        provider: 'dataforseo',
        operation: DFS_PATH,
      }),
    );
  });

  it('maps a task-level quota status to VendorQuotaError', async () => {
    server.use(
      http.post(DFS_URL, () =>
        HttpResponse.json(
          dfsEnvelope({
            status_code: 20000,
            tasks: [{ id: 'TASK_ID', status_code: 40202, status_message: 'Limit exceeded.' }],
          }),
        ),
      ),
    );
    await expect(
      dataForSeoRequest(dfsConfig, DFS_PATH, [], dfsResultSchema),
    ).rejects.toBeInstanceOf(VendorQuotaError);
  });

  it('rejects with VendorMalformedError when a task result fails the caller schema', async () => {
    server.use(
      http.post(DFS_URL, () =>
        HttpResponse.json(
          dfsEnvelope({
            status_code: 20000,
            tasks: [{ id: 'TASK_ID', status_code: 20000, cost: null, result: { nope: 1 } }],
          }),
        ),
      ),
    );
    await expect(
      dataForSeoRequest(dfsConfig, DFS_PATH, [], dfsResultSchema),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('returns an empty outcome list when the envelope has no tasks array', async () => {
    server.use(
      http.post(DFS_URL, () => HttpResponse.json(dfsEnvelope({ status_code: 20000 }))),
    );
    await expect(dataForSeoRequest(dfsConfig, DFS_PATH, [], dfsResultSchema)).resolves.toEqual(
      [],
    );
  });

  it('returns an empty outcome list when the envelope has tasks: null (vendor error state)', async () => {
    server.use(
      http.post(DFS_URL, () =>
        HttpResponse.json(dfsEnvelope({ status_code: 20000, tasks: null })),
      ),
    );
    await expect(dataForSeoRequest(dfsConfig, DFS_PATH, [], dfsResultSchema)).resolves.toEqual(
      [],
    );
  });

  it('honours the per-call timeout passthrough (fake timers)', async () => {
    server.use(http.post(DFS_URL, () => delay('infinite') as unknown as Promise<Response>));
    vi.useFakeTimers();
    const promise = dataForSeoRequest(dfsConfig, DFS_PATH, [], dfsResultSchema, {
      operation: 'serp-task-get',
      timeoutMs: 60,
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(VendorTimeoutError);
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });

  // The DataForSEO client is memoized per identity-
  // relevant config; repeat requests with the same (login, password, baseUrl,
  // timeoutMs, maxRetries, backoffBaseMs) share the same VendorHttpClient.
  describe('client memoization', () => {
    it('reuses the same client for repeat prod-style requests (cache size = 1)', async () => {
      clearDataForSeoClientCache();
      server.use(
        http.post(DFS_URL, () =>
          HttpResponse.json(dfsEnvelope({ status_code: 20000, tasks: [] })),
        ),
      );
      const prodConfig: DataForSeoConfig = {
        login: 'prod-login',
        password: 'prod-pw',
        baseUrl: BASE,
      };
      await dataForSeoRequest(prodConfig, DFS_PATH, [], dfsResultSchema, {
        operation: 'op-a',
      });
      await dataForSeoRequest(prodConfig, DFS_PATH, [], dfsResultSchema, {
        operation: 'op-b',
      });
      // Two calls, same identity-relevant config → ONE cached client.
      expect(dataForSeoClientCacheSize()).toBe(1);
    });

    it('config with a prod-shaped logger stays memoized (bypass only on fetchImpl/random)', async () => {
      clearDataForSeoClientCache();
      server.use(
        http.post(DFS_URL, () =>
          HttpResponse.json(dfsEnvelope({ status_code: 20000, tasks: [] })),
        ),
      );
      const { logger } = makeLoggerSpy();
      await dataForSeoRequest(
        { login: 'log-cfg', password: 'log-cfg', baseUrl: BASE, logger },
        DFS_PATH,
        [],
        dfsResultSchema,
      );
      await dataForSeoRequest(
        { login: 'log-cfg', password: 'log-cfg', baseUrl: BASE, logger },
        DFS_PATH,
        [],
        dfsResultSchema,
      );
      // Same identity fields → single cached client.
      expect(dataForSeoClientCacheSize()).toBe(1);
    });

    it('distinct configs get distinct cache entries', async () => {
      clearDataForSeoClientCache();
      server.use(
        http.post(DFS_URL, () =>
          HttpResponse.json(dfsEnvelope({ status_code: 20000, tasks: [] })),
        ),
      );
      await dataForSeoRequest(
        { login: 'a', password: 'a', baseUrl: BASE },
        DFS_PATH,
        [],
        dfsResultSchema,
      );
      await dataForSeoRequest(
        { login: 'b', password: 'b', baseUrl: BASE },
        DFS_PATH,
        [],
        dfsResultSchema,
      );
      expect(dataForSeoClientCacheSize()).toBe(2);
    });

    it('test seams (fetchImpl / logger / random) bypass the memo — nothing cached', async () => {
      clearDataForSeoClientCache();
      let calls = 0;
      const fetchImpl: typeof fetch = async () => {
        calls += 1;
        return HttpResponse.json(
          dfsEnvelope({ status_code: 20000, tasks: [] }),
        ) as unknown as Response;
      };
      const cfg: DataForSeoConfig = {
        login: 'seam',
        password: 'seam',
        baseUrl: BASE,
        fetchImpl,
      };
      await dataForSeoRequest(cfg, DFS_PATH, [], dfsResultSchema);
      await dataForSeoRequest(cfg, DFS_PATH, [], dfsResultSchema);
      expect(calls).toBe(2);
      expect(dataForSeoClientCacheSize()).toBe(0);
    });

    it('clearDataForSeoClientCache empties the memo', async () => {
      clearDataForSeoClientCache();
      server.use(
        http.post(DFS_URL, () =>
          HttpResponse.json(dfsEnvelope({ status_code: 20000, tasks: [] })),
        ),
      );
      await dataForSeoRequest(
        { login: 'c', password: 'c', baseUrl: BASE },
        DFS_PATH,
        [],
        dfsResultSchema,
      );
      expect(dataForSeoClientCacheSize()).toBe(1);
      clearDataForSeoClientCache();
      expect(dataForSeoClientCacheSize()).toBe(0);
    });
  });
});
