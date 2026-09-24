import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  KEYWORD_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  QUERY_VALUE_MAX_CHILDREN,
  SAFE_URL_MAX_LENGTH,
  SUPPORTED_LOCALES,
  assertIdempotencyKey,
  boundedPageLimit,
  boundedRegexTest,
  canonicalizeCitationId,
  createPaginationCursorCodec,
  keywordString,
  localeEnum,
  makeIdempotencyKey,
  noteString,
  paginationCursor,
  safeUrlString,
  stripQueryOperators,
} from './input-guards.js';

describe('bounded zod fragments', () => {
  it('accepts safe URL shapes and rejects over-length, invalid, credentialed, and unsafe schemes', () => {
    expect(safeUrlString.parse(' https://example.com/a ')).toBe('https://example.com/a');
    expect(() => safeUrlString.parse(`https://example.com/${'a'.repeat(SAFE_URL_MAX_LENGTH)}`)).toThrow();
    expect(() => safeUrlString.parse('not-url')).toThrow();
    expect(() => safeUrlString.parse('https://user:pass@example.com')).toThrow();
    expect(() => safeUrlString.parse('http://example.com')).toThrow();
    expect(() => safeUrlString.parse('file:///etc/passwd')).toThrow();
  });

  it('strips keyword control characters and rejects empty/over-length values', () => {
    expect(keywordString.parse('  seo\u0000 audit\n')).toBe('seo audit');
    expect(keywordString.parse('a\u007f\u009fb')).toBe('ab');
    expect(() => keywordString.parse('\u0000')).toThrow();
    expect(() => keywordString.parse('a'.repeat(KEYWORD_MAX_LENGTH + 1))).toThrow();
  });

  it('bounds notes, pages, and the exact seven-locale tuple', () => {
    expect(noteString.parse(' note ')).toBe('note');
    expect(() => noteString.parse('a'.repeat(NOTE_MAX_LENGTH + 1))).toThrow();
    expect(boundedPageLimit.parse(undefined)).toBe(25);
    expect(boundedPageLimit.parse('100')).toBe(100);
    expect(() => boundedPageLimit.parse(101)).toThrow();
    expect(SUPPORTED_LOCALES).toEqual(['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh']);
    for (const locale of SUPPORTED_LOCALES) expect(localeEnum.parse(locale)).toBe(locale);
    expect(() => localeEnum.parse('pt')).toThrow();
  });
});

describe('paginationCursor', () => {
  const codec = createPaginationCursorCodec('x'.repeat(32));

  it('round-trips an opaque bounded value', () => {
    const token = codec.encode('2026-07-14T00:00:00Z|row-1');
    expect(token).not.toContain('row-1');
    expect(codec.decode(token)).toBe('2026-07-14T00:00:00Z|row-1');
    expect(paginationCursor.decode(paginationCursor.encode('default-secret'))).toBe('default-secret');
  });

  it('rejects short secrets, overlong payloads/tokens, malformed tokens, tampering, and invalid JSON', () => {
    expect(() => createPaginationCursorCodec('short')).toThrow('32');
    expect(() => codec.encode('x'.repeat(513))).toThrow();
    expect(() => codec.decode('x'.repeat(1_025))).toThrow('invalid pagination cursor');
    expect(() => codec.decode('missing-dot')).toThrow('invalid pagination cursor');
    expect(() => codec.decode('a.b.c')).toThrow('invalid pagination cursor');
    const token = codec.encode('row-1');
    expect(() => codec.decode(`${token.slice(0, -1)}x`)).toThrow('invalid pagination cursor');
    const invalidPayload = Buffer.from('{}').toString('base64url');
    const validSignature = createHmac('sha256', 'x'.repeat(32))
      .update(invalidPayload)
      .digest('base64url');
    expect(() => codec.decode(`${invalidPayload}.${validSignature}`)).toThrow('invalid pagination cursor');
  });
});

describe('stripQueryOperators', () => {
  it('removes Mongo operators and dotted keys recursively', () => {
    expect(stripQueryOperators({ $ne: null })).toEqual({});
    expect(stripQueryOperators({ 'a.b': 1 })).toEqual({});
    expect(stripQueryOperators({ safe: { $gt: 1, value: 'x' }, list: [{ 'x.y': 1, ok: true }] })).toEqual({
      safe: { value: 'x' },
      list: [{ ok: true }],
    });
  });

  it('coerces supported primitives and rejects hostile shapes', () => {
    expect(stripQueryOperators([undefined, null, 'x', true, 2, 4n, new Date('2026-01-01T00:00:00Z')])).toEqual([
      null,
      null,
      'x',
      true,
      2,
      '4',
      '2026-01-01T00:00:00.000Z',
    ]);
    expect(() => stripQueryOperators(Number.NaN)).toThrow('finite');
    expect(() => stripQueryOperators(new Map())).toThrow('JSON-like');
    expect(() => stripQueryOperators(Symbol('x'))).toThrow('JSON-like');
    expect(() => stripQueryOperators(new Array(QUERY_VALUE_MAX_CHILDREN + 1).fill('x'))).toThrow(
      'child ceiling',
    );
    expect(() =>
      stripQueryOperators(
        Object.fromEntries(
          Array.from({ length: QUERY_VALUE_MAX_CHILDREN + 1 }, (_, index) => [`key${index}`, index]),
        ),
      ),
    ).toThrow('child ceiling');
    expect(() =>
      stripQueryOperators(
        Array.from({ length: QUERY_VALUE_MAX_CHILDREN }, () => new Array(10).fill('x')),
      ),
    ).toThrow('node ceiling');
    let deep: unknown = true;
    for (let index = 0; index < 12; index += 1) deep = { next: deep };
    expect(() => stripQueryOperators(deep)).toThrow('depth ceiling');
  });
});

describe('boundedRegexTest', () => {
  it('caps input before a fixed regex and resets stateful expressions', () => {
    const pattern = /needle/g;
    expect(boundedRegexTest(pattern, `${'x'.repeat(10)}needle`, 10)).toBe(false);
    pattern.lastIndex = 99;
    expect(boundedRegexTest(pattern, 'needle', 10)).toBe(true);
    expect(() => boundedRegexTest(pattern, 'x', 0)).toThrow('ceiling');
  });
});

describe('account-scoped idempotency keys', () => {
  it('isolates equal client keys across accounts and scopes', () => {
    const a = makeIdempotencyKey('account-a', 'analysis', 'client-1');
    const b = makeIdempotencyKey('account-b', 'analysis', 'client-1');
    const otherScope = makeIdempotencyKey('account-a', 'inventory', 'client-1');
    expect(a).not.toBe(b);
    expect(a).not.toBe(otherScope);
    expect(() => assertIdempotencyKey(a, 'account-a', 'analysis', 'client-1')).not.toThrow();
    expect(() => assertIdempotencyKey(a, 'account-b', 'analysis', 'client-1')).toThrow('namespace');
  });

  it.each([
    ['', 'analysis', 'client', 'account'],
    ['account', '$scope', 'client', 'scope'],
    ['account', 'analysis', 'bad key', 'client key'],
  ])('rejects invalid key parts', (account, scope, clientKey, message) => {
    expect(() => makeIdempotencyKey(account, scope, clientKey)).toThrow(message);
  });

  it('rejects malformed asserted keys', () => {
    expect(() => assertIdempotencyKey('not-an-idem-key', 'account', 'scope', 'client')).toThrow(
      'invalid idempotency key',
    );
  });
});

describe('canonicalizeCitationId', () => {
  it('accepts application-issued ASCII IDs and rejects homographs/look-alikes', () => {
    expect(canonicalizeCitationId('source-1')).toBe('source-1');
    expect(() => canonicalizeCitationId('sourcе-1')).toThrow('invalid citation');
    expect(() => canonicalizeCitationId('ｓource-1')).toThrow('invalid citation');
    expect(() => canonicalizeCitationId('Source-1')).toThrow('invalid citation');
    expect(() => canonicalizeCitationId('a'.repeat(129))).toThrow('invalid citation');
  });
});
