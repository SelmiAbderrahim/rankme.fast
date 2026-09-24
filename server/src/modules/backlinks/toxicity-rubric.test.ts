import { describe, expect, it } from 'vitest';
import { classifyToxicity, TOXICITY_RUBRIC_VERSION } from './toxicity-rubric.js';

const ORDER = { clean: 0, watch: 1, toxic: 2 } as const;

describe('classifyToxicity', () => {
  it.each([
    [29, true, false, 'clean'],
    [30, true, false, 'watch'],
    [60, true, false, 'toxic'],
    [29, true, true, 'watch'],
    [30, true, true, 'toxic'],
    [60, false, false, 'watch'],
    [60, false, true, 'toxic'],
  ] as const)(
    'pins score=%i dofollow=%s broken=%s to %s',
    (spamScore, dofollow, isBroken, expected) => {
      expect(classifyToxicity({ spamScore, dofollow, isBroken })).toMatchObject({
        band: expected,
        rubricVersion: TOXICITY_RUBRIC_VERSION,
        sourceKind: 'provider_observation',
      });
    },
  );

  it('is deterministic and monotonic for every bounded input combination', () => {
    for (const dofollow of [false, true]) {
      for (const isBroken of [false, true]) {
        let previous = -1;
        for (let spamScore = 0; spamScore <= 100; spamScore += 1) {
          const input = { spamScore, dofollow, isBroken };
          const first = classifyToxicity(input);
          const second = classifyToxicity(input);
          expect(first).toEqual(second);
          expect(ORDER[first.band]).toBeGreaterThanOrEqual(previous);
          previous = ORDER[first.band];
        }
      }
    }
  });

  it('broken never lowers and nofollow never raises a band', () => {
    for (let spamScore = 0; spamScore <= 100; spamScore += 1) {
      for (const dofollow of [false, true]) {
        const unbroken = classifyToxicity({ spamScore, dofollow, isBroken: false });
        const broken = classifyToxicity({ spamScore, dofollow, isBroken: true });
        expect(ORDER[broken.band]).toBeGreaterThanOrEqual(ORDER[unbroken.band]);
      }
      for (const isBroken of [false, true]) {
        const followed = classifyToxicity({ spamScore, dofollow: true, isBroken });
        const nofollow = classifyToxicity({ spamScore, dofollow: false, isBroken });
        expect(ORDER[nofollow.band]).toBeLessThanOrEqual(ORDER[followed.band]);
      }
    }
  });

  it.each([-1, 101, 1.5, Number.NaN])('rejects an out-of-range score %s', (spamScore) => {
    expect(() => classifyToxicity({ spamScore, dofollow: true, isBroken: false })).toThrow(
      RangeError,
    );
  });
});
