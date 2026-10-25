import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeReviewTarget } from './review-sync.targets.js';
import type { ReviewSourceName } from './review-sync.model.js';

interface Case {
    source: ReviewSourceName;
    input: string;
    target: string | null;
}

// Shared with the client mirror (`client/.../reviews/targets.test.ts`): both
// sides must give the same answer for every row.
const cases = JSON.parse(
    readFileSync(new URL('./review-target-cases.json', import.meta.url), 'utf8'),
) as Case[];

describe('normalizeReviewTarget (shared case table)', () => {
    it('has coverage for valid and invalid inputs of every source', () => {
        for (const source of ['google', 'trustpilot', 'tripadvisor'] as const) {
            const rows = cases.filter((row) => row.source === source);
            expect(rows.some((row) => row.target !== null), source).toBe(true);
            expect(rows.some((row) => row.target === null), source).toBe(true);
        }
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
        expect(normalizeReviewTarget('trustpilot', `${'a'.repeat(200)}.com`)).toBeNull();
    });

    it('rejects a short IDN whose punycode form exceeds the bound', () => {
        const idn = `${Array.from({ length: 90 }, (_, i) => String.fromCodePoint(0x4e00 + i * 101)).join('')}.com`;
        expect(idn.length).toBeLessThanOrEqual(200);
        expect(normalizeReviewTarget('trustpilot', idn)).toBeNull();
    });

    it('accepts the fake-provider scenario sentinel only when the seam is enabled', () => {
        for (const source of ['google', 'trustpilot', 'tripadvisor'] as const) {
            expect(normalizeReviewTarget(source, '__scenario-hostile')).toBeNull();
            expect(
                normalizeReviewTarget(source, ' __scenario-mixed-language ', { allowFakeScenarios: true }),
            ).toBe('__scenario-mixed-language');
            expect(normalizeReviewTarget(source, '__scenario-', { allowFakeScenarios: true })).toBeNull();
            expect(normalizeReviewTarget(source, '__scenario-X!', { allowFakeScenarios: true })).toBeNull();
        }
        expect(normalizeReviewTarget('google', 'abc', { allowFakeScenarios: true })).toBeNull();
        expect(normalizeReviewTarget('google', 'abc', { allowFakeScenarios: false })).toBeNull();
    });
});
