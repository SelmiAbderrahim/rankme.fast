import { describe, expect, it } from 'vitest';
import { escapeRegex } from './escape-regex.js';

describe('escapeRegex', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegex('a+b@x.com')).toBe('a\\+b@x\\.com');
    expect(escapeRegex('(a|b)*')).toBe('\\(a\\|b\\)\\*');
  });

  it('leaves plain text untouched', () => {
    expect(escapeRegex('hello world')).toBe('hello world');
  });
});
