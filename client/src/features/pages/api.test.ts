import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/api/client')>();
  return { ...actual, apiClient: vi.fn() };
});

import { ApiError, apiClient } from '@shared/api/client';
import { fetchPagesDetail, fetchPagesList, requestPagesRefresh } from './api';
import {
  PagesClientError,
  pagesRequestError,
  toPagesRequestError,
} from './error';
import { DEFAULT_PAGES_URL_STATE } from './urlState';
import type { PagesListResponse } from './types';

const mockedApiClient = vi.mocked(apiClient);
const PAGE_ID = 'p/+'.padEnd(43, 'a');

beforeEach(() => {
  mockedApiClient.mockReset();
  mockedApiClient.mockResolvedValue({} as never);
});

describe('Pages API paths and request behavior', () => {
  it('encodes site/query values and forwards abort signals for list GET', async () => {
    const controller = new AbortController();
    const response = { items: [{ metrics: { clicks: null } }] };
    mockedApiClient.mockResolvedValueOnce(response as never);
    await expect(fetchPagesList('site/one', {
      ...DEFAULT_PAGES_URL_STATE,
      q: 'a & b',
      insight: 'low_ctr',
      indexability: 'non_indexable',
      visibility: 'unmeasured',
      sort: 'clicks',
      direction: 'asc',
      cursor: 'next/+=',
      limit: 100,
    }, controller.signal)).resolves.toBe(response);

    const [path, options] = mockedApiClient.mock.calls[0]!;
    expect(path).toBe(
      '/sites/site%2Fone/pages?range=28d&q=a+%26+b&insight=low_ctr&indexability=non_indexable&visibility=unmeasured&sort=clicks&direction=asc&cursor=next%2F%2B%3D&limit=100',
    );
    expect(options).toMatchObject({ signal: controller.signal });
    expect((response.items[0] as { metrics: { clicks: null } }).metrics.clicks).toBeNull();
  });

  it('encodes detail segments and sends the bounded range', async () => {
    const signal = new AbortController().signal;
    await fetchPagesDetail('site?x', PAGE_ID, '90d', signal);
    expect(mockedApiClient).toHaveBeenCalledWith(
      `/sites/site%3Fx/pages/${encodeURIComponent(PAGE_ID)}?range=90d`,
      { signal },
    );
  });

  it('POSTs an empty refresh body with AbortSignal support', async () => {
    const signal = new AbortController().signal;
    await requestPagesRefresh('site one', signal);
    expect(mockedApiClient).toHaveBeenCalledWith('/sites/site%20one/pages/refresh', {
      method: 'POST',
      body: {},
      signal,
    });
  });

  it('converts localized API failures before they cross the feature boundary', async () => {
    const retained = { envelope: { status: 'stale' } } as unknown as PagesListResponse;
    mockedApiClient.mockRejectedValueOnce(new ApiError('raw', 503, {
      error: {
        code: 'PAGES_PROVIDER_UNAVAILABLE',
        message: 'Lokalisierte Nachricht',
        details: { retryAfterMs: 1200 },
      },
      state: retained,
    }));

    await expect(requestPagesRefresh('site')).rejects.toMatchObject({
      name: 'PagesClientError',
      payload: {
        kind: 'unavailable',
        status: 503,
        code: 'PAGES_PROVIDER_UNAVAILABLE',
        message: 'Lokalisierte Nachricht',
        retryAfterMs: 1200,
        state: retained,
      },
    });
  });
});

describe('typed Pages request errors', () => {
  it.each([
    [400, 'invalid_request'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [503, 'unavailable'],
    [500, 'http'],
  ] as const)('maps HTTP %i to %s while preserving server-localized messages', (status, kind) => {
    expect(toPagesRequestError(new ApiError('raw', status, {
      error: { code: `CODE_${status}`, message: `localized-${status}` },
    }))).toMatchObject({ status, kind, code: `CODE_${status}`, message: `localized-${status}` });
  });

  it.each(['network', 'timeout', 'parse'] as const)('maps %s transport errors', (code) => {
    const result = toPagesRequestError(new ApiError('raw', 0, null, code));
    expect(result.kind).toBe(code);
    expect(result.status).toBe(0);
  });

  it('handles malformed error bodies, invalid retry hints, and unknown errors', () => {
    const malformed = toPagesRequestError(new ApiError('raw', 400, {
      error: { code: 42, message: '', details: ['bad'] },
      state: 'bad',
    }));
    expect(malformed).toMatchObject({ code: null, details: null, retryAfterMs: null, state: null });

    const invalidRetry = toPagesRequestError(new ApiError('raw', 429, {
      error: { details: { retryAfterMs: Number.POSITIVE_INFINITY } },
    }));
    expect(invalidRetry.retryAfterMs).toBeNull();

    expect(toPagesRequestError(new Error('unknown'))).toMatchObject({
      kind: 'unknown',
      status: null,
      code: null,
    });
  });

  it('returns an existing feature error payload unchanged', () => {
    const payload = toPagesRequestError(new ApiError('raw', 404, {
      error: { code: 'PAGES_PAGE_NOT_FOUND', message: 'localized' },
    }));
    const error = new PagesClientError(payload);
    expect(error.name).toBe('PagesClientError');
    expect(error.message).toBe('localized');
    expect(pagesRequestError(error)).toBe(payload);
    expect(pagesRequestError(new Error('other')).kind).toBe('unknown');
  });
});
