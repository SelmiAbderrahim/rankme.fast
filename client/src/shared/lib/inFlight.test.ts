import { describe, expect, it, vi } from 'vitest';
import { dropInFlight, shareInFlight, withInFlightInvalidation } from './inFlight';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('shareInFlight', () => {
  it('collapses concurrent identical requests into one call', async () => {
    const gate = deferred<string>();
    const start = vi.fn(() => gate.promise);
    const results = [
      shareInFlight('k', start),
      shareInFlight('k', start),
      shareInFlight('k', start),
    ];
    gate.resolve('ok');
    await expect(Promise.all(results)).resolves.toEqual(['ok', 'ok', 'ok']);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('keeps different keys independent and never caches a settled request', async () => {
    const start = vi.fn(async () => 'v');
    await shareInFlight('a', start);
    await shareInFlight('b', start);
    await shareInFlight('a', start);
    expect(start).toHaveBeenCalledTimes(3);
  });

  it('shares a failure with every waiting caller, then retries cleanly', async () => {
    const gate = deferred<string>();
    const start = vi.fn(() => gate.promise);
    const first = shareInFlight('f', start);
    const second = shareInFlight('f', start);
    gate.reject(new Error('boom'));
    await expect(first).rejects.toThrow('boom');
    await expect(second).rejects.toThrow('boom');
    await expect(shareInFlight('f', async () => 'again')).resolves.toBe('again');
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('lets a request started after dropInFlight run on its own', async () => {
    const gate = deferred<string>();
    const stale = vi.fn(() => gate.promise);
    const fresh = vi.fn(async () => 'fresh');
    const old = shareInFlight('keywords:s1', stale);
    dropInFlight('keywords:');
    await expect(shareInFlight('keywords:s1', fresh)).resolves.toBe('fresh');
    gate.resolve('stale');
    await expect(old).resolves.toBe('stale');
    expect(fresh).toHaveBeenCalledTimes(1);
  });
});

describe('withInFlightInvalidation', () => {
  it('prevents reads that straddle a mutation from being shared', async () => {
    const gate = deferred<string>();
    const before = vi.fn(() => gate.promise);
    const after = vi.fn(async () => 'after-mutation');
    const stale = shareInFlight('actions:s1', before);
    const mutation = withInFlightInvalidation('actions:', async () => 'done');
    await expect(mutation).resolves.toBe('done');
    await expect(shareInFlight('actions:s1', after)).resolves.toBe('after-mutation');
    gate.resolve('before-mutation');
    await stale;
  });

  it('clears the in-flight set even when the mutation throws', async () => {
    const gate = deferred<string>();
    const racing = shareInFlight('actions:s2', () => gate.promise);
    await expect(
      withInFlightInvalidation('actions:', async () => {
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    const fresh = vi.fn(async () => 'fresh');
    await expect(shareInFlight('actions:s2', fresh)).resolves.toBe('fresh');
    gate.resolve('x');
    await racing;
  });
});
