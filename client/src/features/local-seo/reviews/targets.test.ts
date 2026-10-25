import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeReviewTarget } from './targets';
import type { ReviewSourceName } from './types';

interface Case {
  source: ReviewSourceName;
  input: string;
  target: string | null;
}

// The SAME case table the server suite runs against its own validator, so the
// two implementations cannot drift apart silently.
const cases = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../../../../server/src/modules/local-seo/review-target-cases.json'),
    'utf8',
  ),
) as Case[];

describe('normalizeReviewTarget (shared case table, client mirror)', () => {
  it('loaded the shared table', () => {
    expect(cases.length).toBeGreaterThan(40);
  });

  it.each(cases.map((row) => [row.source, row.input.slice(0, 60), row] as const))(
    '%s %j',
    (_source, _label, row) => {
      expect(normalizeReviewTarget(row.source, row.input)).toBe(row.target);
    },
  );

  it('rejects anything over the 200-character bound', () => {
    expect(normalizeReviewTarget('google', `ChIJ${'a'.repeat(200)}`)).toBeNull();
    expect(normalizeReviewTarget('tripadvisor', '1'.repeat(201))).toBeNull();
  });

  it('rejects a short IDN whose punycode form exceeds the bound', () => {
    const idn = `${Array.from({ length: 90 }, (_, i) => String.fromCodePoint(0x4e00 + i * 101)).join('')}.com`;
    expect(idn.length).toBeLessThanOrEqual(200);
    expect(normalizeReviewTarget('trustpilot', idn)).toBeNull();
  });
});
