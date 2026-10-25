import { describe, expect, it } from 'vitest';
import {
  hostnameOf,
  isSameRegistrableDomain,
  registrableDomainKey,
} from './registrableDomain';

/**
 * Fixture table shared (verbatim) with
 * `server/src/shared/utils/registrable-domain.test.ts`. Change both together.
 */
const KEY_FIXTURES: Array<[string, string]> = [
  ['example.com', 'example.com'],
  ['WWW.Example.com', 'example.com'],
  ['blog.shop.example.com', 'example.com'],
  ['example.com.', 'example.com'],
  ['  example.com  ', 'example.com'],
  ['example.co.uk', 'example.co.uk'],
  ['www.Example.co.uk', 'example.co.uk'],
  ['a.b.example.org.uk', 'example.org.uk'],
  ['shop.example.com.au', 'example.com.au'],
  ['alice.github.io', 'alice.github.io'],
  ['docs.alice.github.io', 'alice.github.io'],
  ['localhost', 'localhost'],
  ['', ''],
];

const OWN_FIXTURES: Array<[string, boolean]> = [
  ['https://example.com/', true],
  ['https://www.example.com', true],
  ['https://blog.example.com/post?x=1', true],
  ['HTTPS://WWW.EXAMPLE.COM:443/Pricing', true],
  ['https://example.com./', true],
  ['example.com', true],
  ['www.example.com/pricing', true],
  ['https://user:pw@example.com/', true],
  ['https://notexample.com', false],
  ['https://myexample.com', false],
  ['https://example.com.evil.net', false],
  ['https://example.co', false],
  ['https://example.org', false],
  ['https://evil.com/?u=example.com', false],
  ['https://evil.com/example.com', false],
  ['https://evil.com@example.net/', false],
  ['', false],
  ['http://', false],
];

describe('registrableDomainKey', () => {
  it.each(KEY_FIXTURES)('reduces %s to %s', (host, expected) => {
    expect(registrableDomainKey(host)).toBe(expected);
  });
});

describe('hostnameOf', () => {
  it('reads hosts from bare names, origins and URLs', () => {
    expect(hostnameOf('Example.com')).toBe('example.com');
    expect(hostnameOf('https://www.Example.com/a?b')).toBe('www.example.com');
    expect(hostnameOf('   ')).toBe('');
    expect(hostnameOf('http://')).toBe('');
  });
});

describe('isSameRegistrableDomain', () => {
  it.each(OWN_FIXTURES)('%s against example.com is %s', (candidate, expected) => {
    expect(isSameRegistrableDomain(candidate, 'example.com')).toBe(expected);
  });

  it('accepts an origin or a bare host as the owned side', () => {
    expect(isSameRegistrableDomain('https://shop.example.com', 'https://example.com')).toBe(true);
    expect(isSameRegistrableDomain('https://shop.example.com', 'www.example.com')).toBe(true);
  });

  it('never treats two empty inputs as the same domain', () => {
    expect(isSameRegistrableDomain('', '')).toBe(false);
    expect(isSameRegistrableDomain('example.com', '')).toBe(false);
  });

  it('keeps sibling sites on a shared platform suffix apart', () => {
    expect(isSameRegistrableDomain('https://bob.github.io', 'alice.github.io')).toBe(false);
    expect(isSameRegistrableDomain('https://docs.alice.github.io', 'alice.github.io')).toBe(true);
  });
});
