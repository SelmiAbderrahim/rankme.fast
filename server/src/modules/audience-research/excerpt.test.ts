import { describe, expect, it } from 'vitest';
import { EXCERPT_MAX_LENGTH, buildEvidenceExcerpt } from './excerpt.js';

describe('buildEvidenceExcerpt', () => {
  it('truncates to 500 grapheme code points', () => {
    const raw = 'x'.repeat(1200);
    const out = buildEvidenceExcerpt(raw);
    expect([...out].length).toBeLessThanOrEqual(EXCERPT_MAX_LENGTH);
  });

  it('strips HTML tags and entities', () => {
    const raw = '<p>Hello <b>world</b>&amp;more<script>alert(1)</script></p>';
    const out = buildEvidenceExcerpt(raw);
    expect(out).not.toMatch(/<[a-z!]/i);
    expect(out).not.toContain('&amp;');
    expect(out).toContain('Hello');
    expect(out).toContain('world');
  });

  it('neutralizes leading formula-injection triggers', () => {
    for (const bad of ['=CMD', '+CMD', '-1', '@SUM']) {
      const out = buildEvidenceExcerpt(bad);
      expect(out.startsWith("'")).toBe(true);
    }
  });

  it('collapses control characters and whitespace runs', () => {
    const raw = 'ab   c\t\td';
    const out = buildEvidenceExcerpt(raw);
    expect(out).toBe('ab c d');
  });

  it('handles multi-byte Unicode without truncation surprises', () => {
    const raw = '❤'.repeat(600);
    const out = buildEvidenceExcerpt(raw);
    expect([...out].length).toBeLessThanOrEqual(EXCERPT_MAX_LENGTH);
  });

  it('returns empty string for empty input', () => {
    expect(buildEvidenceExcerpt('')).toBe('');
    expect(buildEvidenceExcerpt('   ')).toBe('');
  });

  it('lets ordinary safe text through unchanged', () => {
    expect(buildEvidenceExcerpt('Users complain about billing errors.')).toBe(
      'Users complain about billing errors.',
    );
  });
});
