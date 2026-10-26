import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionTransport, sessionTransport } from './sessionTransport';

const sessionUrl = 'http://localhost/api/auth/get-session';
const validSession = () => Response.json({ user: { id: 'user' }, session: { id: 'session' } });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('session transport', () => {
  it('retries a transient session read with bounded delays', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(validSession());
    const pending = createSessionTransport(fetcher)(sessionUrl);
    await vi.advanceTimersByTimeAsync(499);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not replay a mutation or a confirmed unauthorized read', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
    const run = createSessionTransport(fetcher);
    expect((await run(sessionUrl)).status).toBe(401);
    await run(sessionUrl.replace('/get-session', '/sign-out'), { method: 'POST' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('bounds a stalled session response, including its body', async () => {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      signals.push(init!.signal!);
      return new Response(new ReadableStream());
    });
    const pending = createSessionTransport(fetcher)(sessionUrl);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('stops retrying when its caller cancels', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    const pending = createSessionTransport(fetcher)(sessionUrl, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed successful payloads without retrying', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ user: { id: 'user' }, session: null }));
    await expect(createSessionTransport(fetcher)(sessionUrl)).rejects.toThrow('Invalid session response');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('accepts a signed-out session object and rejects a body that is not JSON', async () => {
    const out = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ user: null, session: null }));
    expect((await createSessionTransport(out)(sessionUrl)).status).toBe(200);
    const broken = vi.fn<typeof fetch>().mockResolvedValue(new Response('not json', { status: 200 }));
    await expect(createSessionTransport(broken)(sessionUrl)).rejects.toThrow('Invalid session response');
    expect(broken).toHaveBeenCalledTimes(1);
  });

  it('reads a Request input and only retries its session reads', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => validSession());
    const run = createSessionTransport(fetcher);
    expect((await run(new Request(sessionUrl))).status).toBe(200);
    await run(new Request(sessionUrl.replace('/get-session', '/sign-out'), { method: 'POST' }));
    await run(new Request(sessionUrl, { method: 'POST' }));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('stops without waiting when the caller cancels while a retry is being scheduled', async () => {
    const controller = new AbortController();
    const transient = {
      ok: false,
      status: 503,
      clone: () => ({ text: async () => '' }),
      body: { cancel: () => { controller.abort(); return Promise.resolve(); } },
    } as unknown as Response;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(transient);
    const pending = createSessionTransport(fetcher)(sessionUrl, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('abandons a read in flight when its caller cancels', async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      signals.push(init!.signal!);
      return new Promise<Response>(() => undefined);
    });
    const pending = createSessionTransport(fetcher)(sessionUrl, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await assertion;
    expect(signals[0]?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('passes other requests through to the browser fetch', async () => {
    const browserFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', browserFetch);
    try {
      expect(await (await sessionTransport('http://localhost/api/auth/sign-out', { method: 'POST' })).text()).toBe('ok');
      expect(browserFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
