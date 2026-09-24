import { describe, expect, it } from 'vitest';
import {
  DisavowSerializationError,
  canonicalizeDisavowDomain,
  canonicalizeDisavowUrl,
  serializeDisavow,
} from './disavow-serializer.js';

const DAY = new Date('2026-08-01T22:30:00.000Z');

describe('serializeDisavow', () => {
  it('emits fixed comments, domain then URL lines, stable ordering, and one trailing LF', () => {
    expect(
      serializeDisavow({
        rubricVersion: 'toxicity-rubric-v1',
        generatedOn: DAY,
        entries: [
          { kind: 'url', value: 'https://b.example/path#fragment' },
          { kind: 'domain', value: 'B.example' },
          { kind: 'domain', value: 'a.example' },
          { kind: 'domain', value: 'a.example' },
          { kind: 'url', value: 'http://a.example/' },
        ],
      }),
    ).toBe(
      '# RankMeFast link review export\n' +
        '# rubric: toxicity-rubric-v1\n' +
        '# generated: 2026-08-01\n' +
        'domain:a.example\n' +
        'domain:b.example\n' +
        'http://a.example/\n' +
        'https://b.example/path\n',
    );
  });

  it('is deterministic for every permutation of the same entry set', () => {
    const entries = [
      { kind: 'domain', value: 'z.example' },
      { kind: 'url', value: 'https://a.example/x' },
      { kind: 'domain', value: 'a.example' },
    ] as const;
    const outputs = [entries, [...entries].reverse(), [entries[1], entries[2], entries[0]]].map(
      (permutation) =>
        serializeDisavow({
          rubricVersion: 'toxicity-rubric-v1',
          generatedOn: DAY,
          entries: permutation,
        }),
    );
    expect(new Set(outputs).size).toBe(1);
  });

  it.each([
    '=cmd.example',
    '+cmd.example',
    '-cmd.example',
    '@cmd.example',
    ' evil.example',
    'evil.example\r\ndomain:smuggled.example',
    'evil.example\u202Etxt',
    'javascript:alert.example',
    'localhost',
    'bad_label.example',
  ])('rejects hostile domain input %j', (value) => {
    expect(() => canonicalizeDisavowDomain(value)).toThrow(
      DisavowSerializationError,
    );
  });

  it('rejects domain text the URL parser cannot interpret', () => {
    expect(() => canonicalizeDisavowDomain('[')).toThrow(
      DisavowSerializationError,
    );
  });

  it.each([
    '=https://evil.example/',
    ' https://evil.example/',
    'https://evil.example/\r\ndomain:smuggled.example',
    'https://evil.example/\u2028smuggled',
    'javascript:alert(1)',
    'ftp://evil.example/file',
    'https://user:pass@evil.example/',
    'https://evil.example:99999/',
    'not a url',
  ])('rejects hostile URL input %j', (value) => {
    expect(() => canonicalizeDisavowUrl(value)).toThrow(
      DisavowSerializationError,
    );
  });

  it('rejects invalid metadata and oversized URLs without emitting partial text', () => {
    expect(() =>
      serializeDisavow({
        rubricVersion: 'bad\n# injected',
        generatedOn: DAY,
        entries: [],
      }),
    ).toThrow(DisavowSerializationError);
    expect(() =>
      serializeDisavow({
        rubricVersion: 'toxicity-rubric-v1',
        generatedOn: new Date(Number.NaN),
        entries: [],
      }),
    ).toThrow(DisavowSerializationError);
    expect(() =>
      canonicalizeDisavowUrl(`https://example.com/${'a'.repeat(2048)}`),
    ).toThrow(DisavowSerializationError);
    expect(() =>
      canonicalizeDisavowUrl(`https://example.com/${'💣'.repeat(700)}`),
    ).toThrow(DisavowSerializationError);
  });

  it('enforces the documented total-line and UTF-8 byte ceilings', () => {
    expect(() =>
      serializeDisavow({
        rubricVersion: 'toxicity-rubric-v1',
        generatedOn: DAY,
        entries: Array.from({ length: 99_998 }, (_, index) => ({
          kind: 'domain' as const,
          value: `d${index}.example`,
        })),
      }),
    ).toThrow(DisavowSerializationError);

    expect(() =>
      serializeDisavow({
        rubricVersion: 'toxicity-rubric-v1',
        generatedOn: DAY,
        entries: Array.from({ length: 1_100 }, (_, index) => ({
          kind: 'url' as const,
          value: `https://large.example/${index}-${'a'.repeat(1_950)}`,
        })),
      }),
    ).toThrow(DisavowSerializationError);
  });

  it('has no BOM, CR, blank lines, formula boundary, or smuggled directive', () => {
    const output = serializeDisavow({
      rubricVersion: 'toxicity-rubric-v1',
      generatedOn: DAY,
      entries: [{ kind: 'domain', value: 'safe.example' }],
    });
    expect(output.charCodeAt(0)).not.toBe(0xfeff);
    expect(output).not.toContain('\r');
    expect(output).not.toContain('\n\n');
    expect(output.split('\n').filter(Boolean).every((line) => /^[#]|^domain:|^https?:\/\//u.test(line))).toBe(true);
  });
});
