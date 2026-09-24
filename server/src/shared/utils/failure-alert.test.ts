import { describe, expect, it, vi } from 'vitest';
import { sendFailureAlert } from './failure-alert.js';

describe('sendFailureAlert', () => {
  const payload = { subject: 'sub', body: { a: 1 } };

  it('skips when the url is not configured', async () => {
    const result = await sendFailureAlert(payload, { url: undefined });
    expect(result).toEqual({ delivered: false, reason: 'unconfigured' });
  });

  it('delivers on 2xx', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 202 })) as unknown as typeof fetch;
    const result = await sendFailureAlert(payload, {
      url: 'https://alerts.example/hook',
      fetch: fetchImpl,
    });
    expect(result).toEqual({ delivered: true });
    expect(fetchImpl).toHaveBeenCalled();
    // Every POST carries an AbortSignal for the 5s deadline.
    const [, init] = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('reports the status when the webhook returns non-2xx', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const result = await sendFailureAlert(payload, {
      url: 'https://alerts.example/hook',
      fetch: fetchImpl,
    });
    expect(result).toEqual({ delivered: false, reason: 'status 500' });
  });

  it('maps a TimeoutError rejection to reason:timeout', async () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    const fetchImpl = vi.fn(async () => {
      throw err;
    }) as unknown as typeof fetch;
    const result = await sendFailureAlert(payload, {
      url: 'https://alerts.example/hook',
      fetch: fetchImpl,
    });
    expect(result).toEqual({ delivered: false, reason: 'timeout' });
  });

  it('reports fetch failed on a non-timeout rejection', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('econnrefused');
    }) as unknown as typeof fetch;
    const result = await sendFailureAlert(payload, {
      url: 'https://alerts.example/hook',
      fetch: fetchImpl,
    });
    expect(result).toEqual({ delivered: false, reason: 'fetch failed' });
  });

  it('falls back to the global fetch when no seam is injected', async () => {
    const globalFetch = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', globalFetch);
    try {
      const result = await sendFailureAlert(payload, { url: 'https://alerts.example/hook' });
      expect(result).toEqual({ delivered: true });
      expect(globalFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
