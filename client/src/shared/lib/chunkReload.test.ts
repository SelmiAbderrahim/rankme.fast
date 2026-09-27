import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_RELOAD_GUARD_MS, isChunkLoadError, reloadOnceForStaleChunk } from './chunkReload';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('isChunkLoadError (issue #6)', () => {
  it.each([
    new TypeError('Failed to fetch dynamically imported module: https://app.test/assets/ReportPage-DLBrsKUc.js'),
    new TypeError('error loading dynamically imported module'),
    new TypeError('Importing a module script failed.'),
    new Error('Unable to preload CSS for /assets/index.css'),
    new Error('Loading chunk 42 failed.'),
    Object.assign(new Error('x'), { name: 'ChunkLoadError' }),
  ])('recognises %s', (error) => {
    expect(isChunkLoadError(error)).toBe(true);
  });

  it.each([null, undefined, 'Failed to fetch dynamically imported module', new Error('boom'), { message: 42 }])(
    'ignores %s',
    (error) => {
      expect(isChunkLoadError(error)).toBe(false);
    },
  );
});

describe('reloadOnceForStaleChunk (issue #6)', () => {
  it('reloads once, then refuses inside the guard window, then allows again', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    let now = 1_000_000;
    const env = { storage, reload, now: () => now };
    expect(reloadOnceForStaleChunk(env)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    now += CHUNK_RELOAD_GUARD_MS - 1;
    expect(reloadOnceForStaleChunk(env)).toBe(false);
    now += 2;
    expect(reloadOnceForStaleChunk(env)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does nothing without storage or when storage throws', () => {
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk({ storage: undefined, reload })).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    };
    expect(reloadOnceForStaleChunk({ storage: throwing, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('defaults to sessionStorage and location.reload', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...globalThis.location, reload });
    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(sessionStorage.getItem('rmf.chunkReloadAt')).not.toBeNull();
    expect(reloadOnceForStaleChunk()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('treats an unreadable sessionStorage accessor as unavailable', () => {
    const reload = vi.fn();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(reloadOnceForStaleChunk({ reload })).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'sessionStorage', descriptor!);
    }
    expect(reload).not.toHaveBeenCalled();
  });
});
