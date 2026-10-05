import { describe, expect, it } from 'vitest';
import { isSameHost, normalizeHost } from './host.js';

describe('normalizeHost', () => {
  it('lowercases, drops the trailing dot and a leading www.', () => {
    expect(normalizeHost('WWW.Example.COM.')).toBe('example.com');
    expect(normalizeHost('example.com')).toBe('example.com');
    expect(normalizeHost('  www.example.com ')).toBe('example.com');
  });

  it('reads the host out of absolute URLs, ignoring scheme, port and path', () => {
    expect(normalizeHost('https://www.Example.com:8443/a?b#c')).toBe('example.com');
    expect(normalizeHost('http://example.com/')).toBe('example.com');
  });

  it('keeps other subdomains', () => {
    expect(normalizeHost('blog.example.com')).toBe('blog.example.com');
  });

  it('returns an empty string when the URL cannot be parsed', () => {
    expect(normalizeHost('http://')).toBe('');
    expect(normalizeHost('')).toBe('');
  });
});

describe('isSameHost', () => {
  it('matches www, non-www and scheme variants', () => {
    expect(isSameHost('www.example.com', 'https://example.com/')).toBe(true);
    expect(isSameHost('http://www.example.com', 'https://example.com')).toBe(true);
  });

  it('does not match different hosts or empty input', () => {
    expect(isSameHost('example.com', 'example.org')).toBe(false);
    expect(isSameHost('blog.example.com', 'example.com')).toBe(false);
    expect(isSameHost('', '')).toBe(false);
  });
});
