import { describe, expect, it, vi } from 'vitest';
import { safeInternalHref } from './internalHref';

describe('safeInternalHref', () => {
  it.each([
    ['/sites/site-1?tab=actions#item', '/sites/site-1?tab=actions#item'],
    ['/fr/docs/getting-started', '/fr/docs/getting-started'],
    ['/', '/'],
  ])('accepts an origin-relative route %s', (input, expected) => {
    expect(safeInternalHref(input)).toBe(expected);
  });

  it.each([
    'https://evil.example/path',
    '//evil.example/path',
    '/%2f%2fevil.example/path',
    '/\\evil.example/path',
    '/%5cevil.example/path',
    '/%0aevil.example/path',
    '/%1fevil.example/path',
    '\\evil.example/path',
    'javascript:alert(1)',
    ' /dashboard',
    '/dashboard\nnext',
    '/dashboard\u007fnext',
    '/dashboard\u0085next',
  ])('rejects an external or ambiguous route %s', (input) => {
    expect(safeInternalHref(input)).toBeNull();
  });

  it('fails closed if the runtime URL parser rejects an otherwise internal path', () => {
    vi.stubGlobal(
      'URL',
      class {
        constructor() {
          throw new TypeError('URL parser unavailable');
        }
      },
    );
    try {
      expect(safeInternalHref('/sites/site-1')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails closed if the runtime URL parser resolves an unexpected origin', () => {
    vi.stubGlobal(
      'URL',
      class {
        readonly origin = 'https://evil.example';
        readonly pathname = '/sites/site-1';
        readonly search = '';
        readonly hash = '';
      },
    );
    try {
      expect(safeInternalHref('/sites/site-1')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
