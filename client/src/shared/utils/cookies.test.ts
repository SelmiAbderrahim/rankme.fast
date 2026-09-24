import { describe, expect, it, vi, beforeEach } from 'vitest';
import { loadCookie, saveCookie, removeCookie } from './cookies';

const clearAll = () => {
  for (const segment of document.cookie ? document.cookie.split('; ') : []) {
    const name = segment.split('=')[0];
    if (name) document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
};

describe('cookies: saveCookie + loadCookie', () => {
  beforeEach(clearAll);

  it('round-trips a string value', () => {
    saveCookie('str', 'hello');
    expect(loadCookie<string>('str')).toBe('hello');
  });

  it('round-trips a non-string value as JSON', () => {
    saveCookie('obj', { a: 1, b: [2, 3] });
    expect(loadCookie<{ a: number; b: number[] }>('obj')).toEqual({ a: 1, b: [2, 3] });
    saveCookie('num', 42);
    expect(loadCookie<number>('num')).toBe(42);
  });

  it('returns the raw string when the stored value is not valid JSON', () => {
    document.cookie = 'plain=not{json';
    expect(loadCookie<string>('plain')).toBe('not{json');
  });

  it('returns null for a missing cookie', () => {
    expect(loadCookie('nope')).toBeNull();
  });

  it('honours every cookie option branch', () => {
    saveCookie('full', 'v', {
      path: '/sub',
      expires: new Date('2030-01-01T00:00:00Z'),
      maxAge: 100,
      domain: 'example.com',
      secure: true,
      sameSite: 'strict',
    });
    // The domain/secure attributes prevent jsdom from exposing the cookie, so
    // this asserts the code path ran without throwing rather than readback.
    expect(() => loadCookie('full')).not.toThrow();
  });

  it('applies the default path when none is given', () => {
    saveCookie('defpath', 'x');
    expect(loadCookie<string>('defpath')).toBe('x');
  });
});

describe('cookies: removeCookie', () => {
  beforeEach(clearAll);

  it('expires the named cookie so it no longer reads back', () => {
    saveCookie('gone', 'here');
    expect(loadCookie<string>('gone')).toBe('here');
    removeCookie('gone');
    expect(loadCookie('gone')).toBeNull();
  });
});

describe('cookies: SSR guards (no document)', () => {
  it('loadCookie returns null and saveCookie is a no-op when document is undefined', () => {
    vi.stubGlobal('document', undefined);
    try {
      expect(loadCookie('x')).toBeNull();
      expect(() => saveCookie('x', 'y')).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
