import { describe, expect, it } from 'vitest';
import { readCookie } from './cookies.js';

describe('readCookie', () => {
  it('returns null when the header is empty / null / undefined', () => {
    expect(readCookie(null, 'foo')).toBeNull();
    expect(readCookie(undefined, 'foo')).toBeNull();
    expect(readCookie('', 'foo')).toBeNull();
  });

  it('finds a named cookie among several', () => {
    expect(readCookie('a=1; foo=bar; b=2', 'foo')).toBe('bar');
  });

  it('returns null when the named cookie is missing', () => {
    expect(readCookie('a=1; b=2', 'foo')).toBeNull();
  });

  it('decodes percent-encoded values', () => {
    expect(readCookie('name=hello%20world', 'name')).toBe('hello world');
  });

  it('falls back to the raw value on malformed percent-encoding', () => {
    expect(readCookie('name=%zz', 'name')).toBe('%zz');
  });

  it('keeps everything after the first `=` (a=b=c → b=c)', () => {
    expect(readCookie('token=b=c', 'token')).toBe('b=c');
  });

  it('skips `=`-less fragments and finds the later match', () => {
    expect(readCookie('flagOnly; foo=bar', 'foo')).toBe('bar');
  });

  it('trims whitespace around the cookie name', () => {
    expect(readCookie('  foo=bar  ', 'foo')).toBe('bar');
  });

  it('does not confuse two cookies sharing a prefix', () => {
    expect(readCookie('foobar=x; foo=bar', 'foo')).toBe('bar');
  });
});
