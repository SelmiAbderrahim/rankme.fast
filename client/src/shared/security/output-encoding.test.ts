import { describe, expect, it } from 'vitest';
import {
  SAFE_EXTERNAL_REL,
  UNSAFE_HREF_PLACEHOLDER,
  safeExternalHref,
  serializeJsonLd,
} from './output-encoding';

describe('serializeJsonLd', () => {
  it('keeps script breakouts, HTML snippets, ampersands, and JS separators inert', () => {
    const value = {
      name: '</script><script>alert(1)</script>',
      snippet: '<img onerror=alert(1)> & text',
      separators: '  ',
    };
    const serialized = serializeJsonLd(value);
    expect(serialized).not.toContain('<');
    expect(serialized).not.toContain('>');
    expect(serialized).not.toContain('&');
    expect(serialized).not.toContain(' ');
    expect(serialized).not.toContain(' ');
    expect(JSON.parse(serialized)).toEqual(value);
  });
});

describe('safeExternalHref', () => {
  it.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['https://example.com/é', 'https://example.com/%C3%A9'],
    ['http://example.com/a', 'http://example.com/a'],
    ['mailto:user@example.com', 'mailto:user@example.com'],
  ])('allows %s', (input, expected) => {
    expect(safeExternalHref(input)).toBe(expected);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'vbscript:msgbox(1)', '/relative', 'not a url', 'java\nscript:alert(1)'])(
    'rejects %s',
    (input) => {
      expect(safeExternalHref(input)).toBe(UNSAFE_HREF_PLACEHOLDER);
    },
  );

  it('exports the mandatory outbound-link relationship', () => {
    expect(SAFE_EXTERNAL_REL).toBe('nofollow ugc noopener noreferrer');
  });
});
