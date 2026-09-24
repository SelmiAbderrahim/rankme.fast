import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ProviderError,
  VendorAuthError,
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
  VendorUnavailableError,
} from '../errors.js';
import type { VendorHttpClient } from '../http.js';
import {
  createFirecrawlCredentialPool,
  FIRECRAWL_MAX_FALLBACK_API_KEYS,
  type FirecrawlCredentialPoolConfig,
} from './credential-pool.js';

const responseSchema = z.object({ ok: z.literal(true) });
const BASE_URL = 'https://api.firecrawl.dev';

function createPool(overrides: Partial<FirecrawlCredentialPoolConfig> = {}) {
  return createFirecrawlCredentialPool({
    apiKey: 'primary-secret-value',
    fallbackApiKeys: ['fallback-secret-value'],
    baseUrl: BASE_URL,
    timeoutMs: 1_000,
    maxRetries: 0,
    ...overrides,
  });
}

function okResponse(): Response {
  return Response.json({ ok: true });
}

function requestWith(client: VendorHttpClient) {
  return client.request({
    operation: 'test-request',
    path: '/v2/test',
    schema: responseSchema,
  });
}

describe('createFirecrawlCredentialPool', () => {
  it('rejects invalid primary and fallback configurations without exposing a key', () => {
    expect(() => createPool({ apiKey: '   ' })).toThrow('FIRECRAWL_API_KEY must not be empty');
    expect(() => createPool({ fallbackApiKeys: ['ok', '   '] })).toThrow(
      'must not contain empty keys',
    );
    expect(() => createPool({ fallbackApiKeys: ['duplicate', 'duplicate'] })).toThrow(
      'must be unique',
    );
    expect(() => createPool({ fallbackApiKeys: ['primary-secret-value'] })).toThrow(
      'must be unique',
    );
    expect(() =>
      createPool({
        fallbackApiKeys: Array.from(
          { length: FIRECRAWL_MAX_FALLBACK_API_KEYS + 1 },
          (_, index) => `fallback-${index}`,
        ),
      }),
    ).toThrow(`at most ${FIRECRAWL_MAX_FALLBACK_API_KEYS}`);
  });

  it('trims direct-construction keys and creates stable, opaque, order-independent references', async () => {
    const first = createPool({
      apiKey: ' primary-secret-value ',
      fallbackApiKeys: [' fallback-secret-value '],
    });
    const reordered = createPool({
      apiKey: 'fallback-secret-value',
      fallbackApiKeys: ['primary-secret-value'],
    });
    const primary = first.resolvePinned(undefined, 'crawl-status');
    const otherKey = reordered.resolvePinned(undefined, 'crawl-status');
    let attempts = 0;
    const selectedPrimary = await reordered.executeWithFailover(
      'crawl-start',
      async (credential) => {
        attempts += 1;
        if (attempts === 1) {
          throw new VendorAuthError('rejected', {
            provider: 'firecrawl',
            operation: 'crawl-start',
            httpStatus: 401,
          });
        }
        return credential.credentialRef;
      },
    );

    expect(primary.credentialRef).toMatch(/^fc-cred-v1:[a-f0-9]{64}$/);
    expect(primary.credentialRef).not.toContain('primary-secret-value');
    expect(otherKey.credentialRef).not.toBe(primary.credentialRef);
    expect(selectedPrimary.value).toBe(primary.credentialRef);
    expect(selectedPrimary.credential.credentialRef).toBe(primary.credentialRef);
  });

  it.each([401, 402, 429])('advances in order after HTTP %i', async (httpStatus) => {
    const pool = createPool({ fallbackApiKeys: ['fallback-one', 'fallback-two'] });
    const visited: string[] = [];
    const result = await pool.executeWithFailover('scrape', async (credential) => {
      visited.push(credential.credentialRef);
      if (visited.length === 1) {
        if (httpStatus === 401) {
          throw new VendorAuthError('rejected', {
            provider: 'firecrawl',
            operation: 'scrape',
            httpStatus,
          });
        }
        throw new VendorQuotaError('quota', {
          provider: 'firecrawl',
          operation: 'scrape',
          httpStatus,
        });
      }
      return 'ok';
    });

    expect(result.value).toBe('ok');
    expect(result.credential.credentialRef).toBe(visited[1]);
    expect(visited).toHaveLength(2);
  });

  it('returns a primary success without touching a fallback credential', async () => {
    const pool = createPool({ fallbackApiKeys: ['fallback-one', 'fallback-two'] });
    const execute = vi.fn(async () => 'primary-result');
    const primary = pool.resolvePinned(undefined, 'scrape');

    await expect(pool.executeWithFailover('scrape', execute)).resolves.toEqual({
      value: 'primary-result',
      credential: primary,
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(primary);
  });

  it('returns the exact last typed error after bounded exhaustion', async () => {
    const pool = createPool({ fallbackApiKeys: ['fallback-one', 'fallback-two'] });
    const errors = [
      new VendorAuthError('primary rejected', {
        provider: 'firecrawl',
        operation: 'scrape',
        httpStatus: 401,
      }),
      new VendorQuotaError('fallback one empty', {
        provider: 'firecrawl',
        operation: 'scrape',
        httpStatus: 402,
      }),
      new VendorQuotaError('fallback two limited', {
        provider: 'firecrawl',
        operation: 'scrape',
        httpStatus: 429,
      }),
    ];
    let calls = 0;
    const error = await pool
      .executeWithFailover('scrape', async () => {
        const next = errors[calls];
        calls += 1;
        throw next;
      })
      .catch((cause: unknown) => cause);

    expect(calls).toBe(3);
    expect(error).toBe(errors[2]);
  });

  it.each([
    new VendorAuthError('zdr rejected', {
      provider: 'firecrawl',
      operation: 'scrape',
      httpStatus: 403,
    }),
    new VendorTimeoutError('timeout', {
      provider: 'firecrawl',
      operation: 'scrape',
    }),
    new VendorUnavailableError('unavailable', {
      provider: 'firecrawl',
      operation: 'scrape',
    }),
    new VendorUnavailableError('http unavailable', {
      provider: 'firecrawl',
      operation: 'scrape',
      httpStatus: 503,
    }),
    new VendorMalformedError('malformed', {
      provider: 'firecrawl',
      operation: 'scrape',
      httpStatus: 200,
    }),
    new ProviderError('cancelled', false, {
      provider: 'firecrawl',
      operation: 'scrape',
    }),
    new Error('unexpected callback failure'),
  ])('does not advance after $name ($message)', async (expectedError) => {
    const pool = createPool();
    const execute = vi.fn(async () => {
      throw expectedError;
    });
    await expect(pool.executeWithFailover('scrape', execute)).rejects.toBe(expectedError);
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each([402, 429])(
    'does not retry HTTP %i on the same failover client before advancing',
    async (status) => {
      const callsByAuthorization = new Map<string, number>();
      const fetchImpl: typeof fetch = async (_input, init) => {
        const authorization = new Headers(init?.headers).get('authorization') ?? '';
        callsByAuthorization.set(
          authorization,
          (callsByAuthorization.get(authorization) ?? 0) + 1,
        );
        return authorization === 'Bearer primary-secret-value'
          ? new Response(null, { status })
          : okResponse();
      };
      const pool = createPool({ fetchImpl, maxRetries: 2 });
      const result = await pool.executeWithFailover('scrape', (credential) =>
        requestWith(credential.failoverClient),
      );

      expect(result.value).toEqual({ ok: true });
      expect(callsByAuthorization).toEqual(
        new Map([
          ['Bearer primary-secret-value', 1],
          ['Bearer fallback-secret-value', 1],
        ]),
      );
    },
  );

  it('keeps ordinary transient retries on both pinned and failover clients', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchImpl: typeof fetch = async () => {
        calls += 1;
        return calls % 2 === 1 ? new Response(null, { status: 503 }) : okResponse();
      };
      const pool = createPool({ fetchImpl, maxRetries: 1 });
      const pinned = requestWith(pool.resolvePinned(undefined, 'crawl-status').pinnedClient);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(pinned).resolves.toEqual({ ok: true });

      const failover = pool.executeWithFailover('scrape', (credential) =>
        requestWith(credential.failoverClient),
      );
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(failover).resolves.toMatchObject({ value: { ok: true } });
      expect(calls).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves undefined to primary and rejects an unknown or removed reference without probing', async () => {
    const withFallback = createPool();
    const fallback = await withFallback.executeWithFailover('monitor-create', async (credential) => {
      if (credential === withFallback.resolvePinned(undefined, 'monitor-create')) {
        throw new VendorAuthError('primary rejected', {
          provider: 'firecrawl',
          operation: 'monitor-create',
          httpStatus: 401,
        });
      }
      return undefined;
    });
    const withoutFallback = createPool({ fallbackApiKeys: [] });

    expect(withFallback.resolvePinned(undefined, 'monitor-status')).toBe(
      withFallback.resolvePinned(undefined, 'monitor-delete'),
    );
    const error = (() => {
      try {
        withoutFallback.resolvePinned(fallback.credential.credentialRef, 'monitor-status');
      } catch (cause) {
        return cause;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(VendorAuthError);
    expect(error).toMatchObject({
      provider: 'firecrawl',
      operation: 'monitor-status',
      retryable: false,
      httpStatus: undefined,
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain(fallback.credential.credentialRef);
    expect(serialized).not.toContain('primary-secret-value');
    expect(serialized).not.toContain('fallback-secret-value');
  });

  it('never exposes raw keys through handles', () => {
    const pool = createPool();
    const primary = pool.resolvePinned(undefined, 'scrape');

    expect(Object.keys(primary).sort()).toEqual([
      'credentialRef',
      'failoverClient',
      'pinnedClient',
    ]);
    const serialized = JSON.stringify(primary);
    expect(serialized).not.toContain('primary-secret-value');
    expect(serialized).not.toContain('fallback-secret-value');
  });

  it('rejects an empty logical operation before invoking a callback', async () => {
    const execute = vi.fn(async () => 'ok');
    await expect(createPool().executeWithFailover('  ', execute)).rejects.toThrow(
      'operation must not be empty',
    );
    expect(execute).not.toHaveBeenCalled();
    expect(() => createPool().resolvePinned(undefined, '')).toThrow('operation must not be empty');
  });
});
