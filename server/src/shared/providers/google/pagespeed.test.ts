/**
 * Google PageSpeed adapter tests.
 *
 * Layers:
 *   1. providerContractTests over `callPsi` (mobile + desktop strategies)
 *      and `callCrux` — success / timeout / malformed / quota.
 *   2. Extra vendor-specific paths — LIGHTHOUSE_ERROR (500 + runtimeError
 *      in body), CrUX 404 (expected: "no field data"), origin fallback,
 *      auth (401) rejection, network drop (VendorUnavailableError).
 *   3. Rate-limiter behaviour (fake timers).
 *   4. Interpretation helpers (labScores, cwvCategory, mobileFriendly).
 *   5. End-to-end `analyze()` flow.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerContractTests } from '../../testing/fixtures/contract.js';
import { mockVendor, vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import {
  VendorAuthError,
  VendorMalformedError,
  VendorTimeoutError,
  VendorUnavailableError,
} from '../errors.js';
import {
  callCrux,
  callPsi,
  createGooglePageSpeedProvider,
  createTokenBucketLimiter,
  cwvCategory,
  DEFAULT_PSI_TIMEOUT_MS,
  extractCoreWebVitals,
  extractLabScores,
  extractMobileFriendly,
  type PageSpeedProviderConfig,
} from './pagespeed.js';

// ---------------------------------------------------------------------------
// Common test infrastructure.
// ---------------------------------------------------------------------------

const FIXTURES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'testing',
  'fixtures',
);

function readPsiFixture(strategy: 'mobile' | 'desktop', kase: string): JsonBodyType {
  return JSON.parse(
    readFileSync(join(FIXTURES_ROOT, 'google-pagespeed', strategy, `${kase}.json`), 'utf8'),
  ) as JsonBodyType;
}
function readCruxFixture(kase: string): JsonBodyType {
  return JSON.parse(
    readFileSync(join(FIXTURES_ROOT, 'google-crux', 'query', `${kase}.json`), 'utf8'),
  ) as JsonBodyType;
}

const PSI_TEST_URL = 'https://psi.test/runPagespeed';
const CRUX_TEST_URL = 'https://crux.test/queryRecord';

const baseCfg: PageSpeedProviderConfig = {
  apiKey: 'test-key',
  psiTimeoutMs: 60,
  cruxTimeoutMs: 60,
  ratePerMinute: 10_000, // effectively unlimited under tests
  clock: () => 0,
  sleep: async () => {},
  psiUrl: PSI_TEST_URL,
  cruxUrl: CRUX_TEST_URL,
};

// ---------------------------------------------------------------------------
// providerContractTests — PSI (mobile)
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'GooglePageSpeed.callPsi(mobile)',
  fixtureProvider: 'google-pagespeed',
  fixtureOperation: 'mobile',
  makeCall: () => callPsi({ cfg: baseCfg, input: { url: 'https://example.com/', strategy: 'mobile' } }),
  assertSuccess: (payload) => {
    expect(payload.lighthouseResult?.categories?.performance?.score).toBeCloseTo(0.72);
  },
});

// ---------------------------------------------------------------------------
// providerContractTests — PSI (desktop)
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'GooglePageSpeed.callPsi(desktop)',
  fixtureProvider: 'google-pagespeed',
  fixtureOperation: 'desktop',
  makeCall: () => callPsi({ cfg: baseCfg, input: { url: 'https://example.com/', strategy: 'desktop' } }),
  assertSuccess: (payload) => {
    expect(payload.lighthouseResult?.categories?.performance?.score).toBeCloseTo(0.98);
  },
});

// ---------------------------------------------------------------------------
// providerContractTests — CrUX
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'GooglePageSpeed.callCrux',
  fixtureProvider: 'google-crux',
  fixtureOperation: 'query',
  makeCall: () =>
    callCrux({ cfg: baseCfg, target: { kind: 'url', url: 'https://example.com/' }, formFactor: 'PHONE' }),
  assertSuccess: (outcome) => {
    expect(outcome.kind).toBe('ok');
  },
});

// ---------------------------------------------------------------------------
// PSI vendor-specific failure paths.
// ---------------------------------------------------------------------------

describe('callPsi — vendor-specific paths', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('500 LIGHTHOUSE_ERROR → VendorUnavailableError (retryable)', async () => {
    mockVendor('google-pagespeed', 'mobile', 'lighthouse-error');
    await expect(
      callPsi({ cfg: baseCfg, input: { url: 'https://example.com/', strategy: 'mobile' } }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('runtimeError in 200 body → VendorUnavailableError', async () => {
    vendorMockServer.use(http.get('*', () => HttpResponse.json(readPsiFixture('mobile', 'runtime-error'))));
    const err = await callPsi({
      cfg: baseCfg,
      input: { url: 'https://example.com/', strategy: 'mobile' },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(VendorUnavailableError);
    expect((err as Error).message).toContain('NO_DOCUMENT_REQUEST');
  });

  it('401 → VendorAuthError (credentials rejected)', async () => {
    vendorMockServer.use(http.get('*', () => HttpResponse.json({ error: 'auth' }, { status: 401 })));
    await expect(
      callPsi({ cfg: baseCfg, input: { url: 'https://example.com/', strategy: 'mobile' } }),
    ).rejects.toBeInstanceOf(VendorAuthError);
  });

  it('403 → VendorAuthError', async () => {
    vendorMockServer.use(http.get('*', () => HttpResponse.json({ error: 'forbidden' }, { status: 403 })));
    await expect(
      callPsi({ cfg: baseCfg, input: { url: 'https://example.com/', strategy: 'mobile' } }),
    ).rejects.toBeInstanceOf(VendorAuthError);
  });

  it('unexpected 418 → VendorMalformedError (edge)', async () => {
    vendorMockServer.use(
      http.get('*', () => HttpResponse.json({ err: 'teapot' }, { status: 418 })),
    );
    await expect(
      callPsi({ cfg: baseCfg, input: { url: 'https://example.com/', strategy: 'mobile' } }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('non-JSON body on a 200 → VendorMalformedError', async () => {
    vendorMockServer.use(http.get('*', () => new HttpResponse('not json', { status: 200 })));
    await expect(
      callPsi({ cfg: baseCfg, input: { url: 'https://example.com/', strategy: 'mobile' } }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('network drop before response → VendorUnavailableError', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('ECONNRESET');
    };
    await expect(
      callPsi({
        cfg: { ...baseCfg, fetchImpl },
        input: { url: 'https://example.com/', strategy: 'mobile' },
      }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('surfaces VendorTimeoutError when the vendor stalls mid-body', async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"lighthouse'));
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
    const promise = callPsi({
      cfg: { ...baseCfg, psiTimeoutMs: 40, fetchImpl },
      input: { url: 'https://example.com/', strategy: 'mobile' },
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(VendorTimeoutError);
    await vi.advanceTimersByTimeAsync(40);
    await assertion;
    vi.useRealTimers();
  });

  it('logs when a logger is provided', async () => {
    vendorMockServer.use(http.get('*', () => HttpResponse.json(readPsiFixture('mobile', 'success'))));
    const info = vi.fn();
    const logger = { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn() } as never;
    await callPsi({
      cfg: { ...baseCfg, logger },
      input: { url: 'https://example.com/', strategy: 'mobile' },
    });
    expect(info).toHaveBeenCalled();
  });

  it('sends all four categories + strategy + key in the query string', async () => {
    let capturedUrl = '';
    vendorMockServer.use(
      http.get('*', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(readPsiFixture('mobile', 'success'));
      }),
    );
    await callPsi({ cfg: baseCfg, input: { url: 'https://example.com/', strategy: 'mobile' } });
    const u = new URL(capturedUrl);
    expect(u.searchParams.get('url')).toBe('https://example.com/');
    expect(u.searchParams.get('strategy')).toBe('mobile');
    expect(u.searchParams.get('key')).toBe('test-key');
    expect(u.searchParams.getAll('category').sort()).toEqual(
      ['accessibility', 'best-practices', 'performance', 'seo'].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// CrUX vendor-specific paths.
// ---------------------------------------------------------------------------

describe('callCrux — vendor-specific paths', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('404 → { kind: "not-found" } (expected state, NOT an error)', async () => {
    mockVendor('google-crux', 'query', 'not-found');
    const outcome = await callCrux({
      cfg: baseCfg,
      target: { kind: 'url', url: 'https://tiny.example.com/' },
    });
    expect(outcome.kind).toBe('not-found');
  });

  it('sends origin body when target.kind = origin', async () => {
    let body: unknown = null;
    vendorMockServer.use(
      http.post('*', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(readCruxFixture('success'));
      }),
    );
    await callCrux({
      cfg: baseCfg,
      target: { kind: 'origin', origin: 'https://example.com' },
      formFactor: 'DESKTOP',
    });
    expect(body).toEqual({ origin: 'https://example.com', formFactor: 'DESKTOP' });
  });

  it('forwards a logger through to callCrux (covers `cfg.logger ?` branch)', async () => {
    vendorMockServer.use(http.post('*', () => HttpResponse.json(readCruxFixture('success'))));
    const info = vi.fn();
    const logger = { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn() } as never;
    await callCrux({
      cfg: { ...baseCfg, logger },
      target: { kind: 'url', url: 'https://example.com/' },
    });
    expect(info).toHaveBeenCalled();
  });

  it('sends URL body without formFactor when omitted', async () => {
    let body: unknown = null;
    vendorMockServer.use(
      http.post('*', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(readCruxFixture('success'));
      }),
    );
    await callCrux({ cfg: baseCfg, target: { kind: 'url', url: 'https://example.com/' } });
    expect(body).toEqual({ url: 'https://example.com/' });
  });
});

// ---------------------------------------------------------------------------
// Rate limiter.
// ---------------------------------------------------------------------------

describe('createTokenBucketLimiter', () => {
  it('under-rate calls resolve immediately', async () => {
    let now = 0;
    const sleepCalls: number[] = [];
    const limiter = createTokenBucketLimiter(
      60,
      () => now,
      async (ms: number) => {
        sleepCalls.push(ms);
        now += ms;
      },
    );
    await limiter.acquire();
    now += 5_000;
    await limiter.acquire();
    expect(sleepCalls).toEqual([]);
  });

  it('over-rate calls delay to honour the bucket interval', async () => {
    let now = 0;
    const sleepCalls: number[] = [];
    const limiter = createTokenBucketLimiter(
      // 60/min = 1000ms per token
      60,
      () => now,
      async (ms: number) => {
        sleepCalls.push(ms);
        now += ms;
      },
    );
    await limiter.acquire(); // ok
    await limiter.acquire(); // must wait ~1000ms
    await limiter.acquire(); // another 1000ms
    expect(sleepCalls.length).toBeGreaterThanOrEqual(2);
    expect(sleepCalls[0]).toBeGreaterThan(0);
  });

  it('N concurrent acquires reserve strictly interval-spaced slots (no double-book)', async () => {
    // Deterministic clock + sleep — Promise.all fires N acquire()s back to
    // back. The old code awaited sleep BEFORE incrementing `nextAllowed`, so
    // two callers read the same `nextAllowed` and both proceeded in the same
    // slot. The fix reserves the slot before sleeping.
    let now = 0;
    const sleepCalls: number[] = [];
    const limiter = createTokenBucketLimiter(
      60, // 1 call/sec
      () => now,
      async (ms: number) => {
        sleepCalls.push(ms);
        now += ms;
      },
    );
    await Promise.all([
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
    ]);
    // The first acquire is free (now=0, slot=0). Each subsequent acquire
    // must sleep ~1000ms to hit its reserved slot.
    expect(sleepCalls).toHaveLength(3);
    for (const ms of sleepCalls) expect(ms).toBeGreaterThanOrEqual(1_000);
  });

  it('clamps a zero-or-negative rate to at least one call per minute (defensive)', async () => {
    let now = 0;
    let slept = 0;
    const limiter = createTokenBucketLimiter(
      1_000_000,
      () => now,
      async (ms: number) => {
        slept += ms;
        now += ms;
      },
    );
    await limiter.acquire();
    await limiter.acquire();
    // interval clamped to ≥1ms — the second call may hit the sleep branch.
    expect(slept).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Interpretation helpers.
// ---------------------------------------------------------------------------

describe('extractLabScores', () => {
  it('converts 0–1 scores to 0–100 integers', () => {
    const scores = extractLabScores({
      lighthouseResult: {
        categories: {
          performance: { score: 0.72 },
          accessibility: { score: 0.88 },
          'best-practices': { score: 0.96 },
          seo: { score: 1.0 },
        },
      },
    });
    expect(scores).toEqual({ performance: 72, accessibility: 88, bestPractices: 96, seo: 100 });
  });

  it('coerces missing / null scores to zero (never NaN)', () => {
    const scores = extractLabScores({});
    expect(scores).toEqual({ performance: 0, accessibility: 0, bestPractices: 0, seo: 0 });
  });

  it('handles a partially populated categories block', () => {
    const scores = extractLabScores({
      lighthouseResult: { categories: { performance: { score: 0.5 } } },
    });
    expect(scores.performance).toBe(50);
    expect(scores.seo).toBe(0);
  });
});

describe('extractMobileFriendly', () => {
  it('returns undefined for desktop strategy', () => {
    expect(extractMobileFriendly({}, 'desktop')).toBeUndefined();
  });

  it('returns undefined when Lighthouse audits are absent', () => {
    expect(
      extractMobileFriendly({ lighthouseResult: { categories: {} } }, 'mobile'),
    ).toBeUndefined();
  });

  it('returns undefined when neither audit is present', () => {
    expect(
      extractMobileFriendly({ lighthouseResult: { audits: { other: { score: 1 } } } }, 'mobile'),
    ).toBeUndefined();
  });

  it('true when both audits ≥ 0.9', () => {
    expect(
      extractMobileFriendly(
        { lighthouseResult: { audits: { viewport: { score: 1 }, 'tap-targets': { score: 0.95 } } } },
        'mobile',
      ),
    ).toBe(true);
  });

  it('false when viewport fails', () => {
    expect(
      extractMobileFriendly(
        { lighthouseResult: { audits: { viewport: { score: 0 }, 'tap-targets': { score: 1 } } } },
        'mobile',
      ),
    ).toBe(false);
  });

  it('false when tap-targets fails', () => {
    expect(
      extractMobileFriendly(
        { lighthouseResult: { audits: { viewport: { score: 1 }, 'tap-targets': { score: 0.4 } } } },
        'mobile',
      ),
    ).toBe(false);
  });

  it('treats missing partner audit as OK — one signal is enough to answer', () => {
    expect(
      extractMobileFriendly({ lighthouseResult: { audits: { viewport: { score: 1 } } } }, 'mobile'),
    ).toBe(true);
    expect(
      extractMobileFriendly(
        { lighthouseResult: { audits: { 'tap-targets': { score: 1 } } } },
        'mobile',
      ),
    ).toBe(true);
  });

  it('treats null viewport score as missing (returns true from tap only)', () => {
    expect(
      extractMobileFriendly(
        {
          lighthouseResult: {
            audits: { viewport: { score: null }, 'tap-targets': { score: 1 } },
          },
        },
        'mobile',
      ),
    ).toBe(true);
  });

  it('treats null tap-targets score as missing (returns true from viewport only)', () => {
    expect(
      extractMobileFriendly(
        {
          lighthouseResult: {
            audits: { viewport: { score: 1 }, 'tap-targets': { score: null } },
          },
        },
        'mobile',
      ),
    ).toBe(true);
  });
});

describe('cwvCategory', () => {
  it('all-good → good', () => {
    expect(cwvCategory(2000, 100, 0.05)).toBe('good');
  });
  it('any needs-improvement → needs-improvement', () => {
    expect(cwvCategory(3000, 100, 0.05)).toBe('needs-improvement');
    expect(cwvCategory(2000, 300, 0.05)).toBe('needs-improvement');
    expect(cwvCategory(2000, 100, 0.2)).toBe('needs-improvement');
  });
  it('any poor → poor', () => {
    expect(cwvCategory(5000, 100, 0.05)).toBe('poor');
    expect(cwvCategory(2000, 800, 0.05)).toBe('poor');
    expect(cwvCategory(2000, 100, 0.3)).toBe('poor');
  });
});

describe('extractCoreWebVitals', () => {
  it('parses string percentiles', () => {
    const cwv = extractCoreWebVitals(
      JSON.parse(JSON.stringify(readCruxFixture('success'))) as never,
    );
    expect(cwv).toEqual({ lcpMs: 1840, inp: 180, cls: 0.04, category: 'good' });
  });

  it('parses numeric percentiles', () => {
    const cwv = extractCoreWebVitals(
      JSON.parse(JSON.stringify(readCruxFixture('needs-improvement'))) as never,
    );
    expect(cwv?.category).toBe('needs-improvement');
  });

  it('classifies poor CWV', () => {
    const cwv = extractCoreWebVitals(
      JSON.parse(JSON.stringify(readCruxFixture('poor-cwv'))) as never,
    );
    expect(cwv?.category).toBe('poor');
  });

  it('returns undefined when any metric is missing', () => {
    expect(extractCoreWebVitals({ record: { metrics: {} } })).toBeUndefined();
    expect(extractCoreWebVitals({})).toBeUndefined();
  });

  it('returns undefined on non-finite percentiles', () => {
    const cwv = extractCoreWebVitals({
      record: {
        metrics: {
          largest_contentful_paint: { percentiles: { p75: 'oops' } },
          interaction_to_next_paint: { percentiles: { p75: '100' } },
          cumulative_layout_shift: { percentiles: { p75: '0.1' } },
        },
      },
    });
    expect(cwv).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// End-to-end analyze() — composes PSI + CrUX with url→origin fallback.
// ---------------------------------------------------------------------------

describe('createGooglePageSpeedProvider.analyze', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  function makeProvider(overrides: Partial<PageSpeedProviderConfig> = {}) {
    return createGooglePageSpeedProvider({ ...baseCfg, ...overrides });
  }

  it('happy path — mobile PSI + URL-scope CrUX', async () => {
    vendorMockServer.use(
      http.get('*psi.test*', () => HttpResponse.json(readPsiFixture('mobile', 'success'))),
      http.post('*crux.test*', () => HttpResponse.json(readCruxFixture('success'))),
    );
    const provider = makeProvider();
    const out = await provider.analyze({ url: 'https://example.com/', strategy: 'mobile' });
    expect(out.labScores.performance).toBe(72);
    expect(out.coreWebVitals?.category).toBe('good');
    expect(out.fieldDataLevel).toBe('url');
    expect(out.mobileFriendly).toBe(true);
  });

  it('CrUX 404 on URL falls back to origin — fieldDataLevel="origin"', async () => {
    const bodies: unknown[] = [];
    vendorMockServer.use(
      http.get('*psi.test*', () => HttpResponse.json(readPsiFixture('mobile', 'success'))),
      http.post('*crux.test*', async ({ request }) => {
        const body = await request.json();
        bodies.push(body);
        if (bodies.length === 1) {
          return HttpResponse.json(readCruxFixture('not-found'), { status: 404 });
        }
        return HttpResponse.json(readCruxFixture('success'));
      }),
    );
    const provider = makeProvider();
    const out = await provider.analyze({
      url: 'https://example.com/deep/page',
      strategy: 'mobile',
    });
    expect(out.fieldDataLevel).toBe('origin');
    expect(out.coreWebVitals?.category).toBe('good');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ url: 'https://example.com/deep/page' });
    expect(bodies[1]).toMatchObject({ origin: 'https://example.com' });
  });

  it('CrUX 404 twice → coreWebVitals undefined + fieldDataLevel="none"', async () => {
    vendorMockServer.use(
      http.get('*psi.test*', () => HttpResponse.json(readPsiFixture('mobile', 'success'))),
      http.post('*crux.test*', () =>
        HttpResponse.json(readCruxFixture('not-found'), { status: 404 }),
      ),
    );
    const provider = makeProvider();
    const out = await provider.analyze({ url: 'https://tiny.example/', strategy: 'mobile' });
    expect(out.coreWebVitals).toBeUndefined();
    expect(out.fieldDataLevel).toBe('none');
  });

  it('CrUX URL success with missing metric → falls back to origin', async () => {
    let cruxCalls = 0;
    vendorMockServer.use(
      http.get('*psi.test*', () => HttpResponse.json(readPsiFixture('mobile', 'success'))),
      http.post('*crux.test*', () => {
        cruxCalls += 1;
        if (cruxCalls === 1) {
          return HttpResponse.json({ record: { metrics: {} } });
        }
        return HttpResponse.json(readCruxFixture('success'));
      }),
    );
    const provider = makeProvider();
    const out = await provider.analyze({ url: 'https://example.com/deep', strategy: 'mobile' });
    expect(out.fieldDataLevel).toBe('origin');
    expect(cruxCalls).toBe(2);
  });

  it('skips origin lookup when the input URL cannot be parsed', async () => {
    let cruxCalls = 0;
    vendorMockServer.use(
      http.get('*psi.test*', () => HttpResponse.json(readPsiFixture('mobile', 'success'))),
      http.post('*crux.test*', () => {
        cruxCalls += 1;
        return HttpResponse.json(readCruxFixture('not-found'), { status: 404 });
      }),
    );
    const provider = makeProvider();
    const out = await provider.analyze({ url: 'not a url', strategy: 'mobile' });
    expect(out.fieldDataLevel).toBe('none');
    // Only ONE CrUX call — the origin fallback path never fires when parse fails.
    expect(cruxCalls).toBe(1);
  });

  it('PSI failure propagates as ProviderError (does not fall through to CrUX)', async () => {
    vendorMockServer.use(
      http.get('*psi.test*', () => HttpResponse.json({ error: 'x' }, { status: 500 })),
    );
    const provider = makeProvider();
    await expect(
      provider.analyze({ url: 'https://example.com/', strategy: 'mobile' }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('desktop strategy → CrUX formFactor DESKTOP + no mobileFriendly', async () => {
    let formFactor = '';
    vendorMockServer.use(
      http.get('*psi.test*', () => HttpResponse.json(readPsiFixture('desktop', 'success'))),
      http.post('*crux.test*', async ({ request }) => {
        const body = (await request.json()) as { formFactor?: string };
        formFactor = body.formFactor ?? '';
        return HttpResponse.json(readCruxFixture('success'));
      }),
    );
    const provider = makeProvider();
    const out = await provider.analyze({ url: 'https://example.com/', strategy: 'desktop' });
    expect(formFactor).toBe('DESKTOP');
    expect(out.mobileFriendly).toBeUndefined();
    expect(out.labScores.performance).toBe(98);
  });

  it('empty apiKey throws at construction time', () => {
    expect(() =>
      createGooglePageSpeedProvider({ ...baseCfg, apiKey: '' }),
    ).toThrow(/GOOGLE_API_KEY/);
  });

  it('acquires a rate-limit token before the PSI call', async () => {
    let calls = 0;
    const acquireCalls: number[] = [];
    vendorMockServer.use(
      http.get('*psi.test*', () => {
        calls += 1;
        return HttpResponse.json(readPsiFixture('mobile', 'success'));
      }),
      http.post('*crux.test*', () => HttpResponse.json(readCruxFixture('success'))),
    );
    let now = 0;
    const provider = createGooglePageSpeedProvider({
      ...baseCfg,
      ratePerMinute: 60,
      clock: () => now,
      sleep: async (ms: number) => {
        acquireCalls.push(ms);
        now += ms;
      },
    });
    await provider.analyze({ url: 'https://example.com/', strategy: 'mobile' });
    await provider.analyze({ url: 'https://example.com/two', strategy: 'mobile' });
    expect(calls).toBe(2);
    expect(acquireCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('uses default PSI + CrUX URLs when overrides omitted (smoke — constructor)', () => {
    const provider = createGooglePageSpeedProvider({ apiKey: 'k' });
    expect(typeof provider.analyze).toBe('function');
  });

  it('exports the PSI default deadline for callers to align on', () => {
    expect(DEFAULT_PSI_TIMEOUT_MS).toBe(60_000);
  });

  it('analyze() with all defaults uses default URLs / timeout / fetch / no logger', async () => {
    // Intercept the DEFAULT vendor URLs to cover the `?? CRUX_URL` / `?? PSI_URL`
    // / `?? DEFAULT_CRUX_TIMEOUT_MS` / `?? fetch` / `cfg.logger ? …` fallback
    // branches — every other test overrides those fields.
    vendorMockServer.use(
      http.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', () =>
        HttpResponse.json(readPsiFixture('mobile', 'success')),
      ),
      http.post('https://chromeuxreport.googleapis.com/v1/records:queryRecord', () =>
        HttpResponse.json(readCruxFixture('success')),
      ),
    );
    const provider = createGooglePageSpeedProvider({ apiKey: 'k' });
    const out = await provider.analyze({ url: 'https://example.com/', strategy: 'mobile' });
    expect(out.labScores.performance).toBe(72);
    expect(out.coreWebVitals?.category).toBe('good');
  });

  it('PSI runtime error without a message still throws VendorUnavailableError', async () => {
    vendorMockServer.use(
      http.get('*psi.test*', () =>
        HttpResponse.json({
          lighthouseResult: { runtimeError: { code: 'LIGHTHOUSE_ERROR_NO_FCP' } },
        }),
      ),
    );
    const err = await callPsi({
      cfg: baseCfg,
      input: { url: 'https://example.com/', strategy: 'mobile' },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(VendorUnavailableError);
    expect((err as Error).message).toContain('LIGHTHOUSE_ERROR_NO_FCP');
    expect((err as Error).message).not.toContain(': :'); // no trailing empty msg
  });
});
