import { describe, expect, it } from 'vitest';
import { sourceReadiness } from './readiness';
import { reviewRun, reviewSource } from './__fixtures__/reviews';

const saved = reviewSource({
  target: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  updatedAt: '2026-07-10T00:00:00.000Z',
});
const run = (createdAt: string, outcome: 'ok' | 'failed' | 'zeroNew', source = 'google' as const) =>
  reviewRun({
    createdAt,
    perSourceOutcomes: [{ source, outcome, retained: 0, errorCode: null }],
  });

describe('sourceReadiness', () => {
  it('flags a saved value that no longer passes the format rules', () => {
    expect(
      sourceReadiness(reviewSource({ target: 'abc' }), [run('2026-07-20T00:00:00.000Z', 'ok')]),
    ).toBe('invalid');
  });

  it('is only "saved" until a sync has tried the source', () => {
    expect(sourceReadiness(saved, [])).toBe('saved');
    // Runs for other sources, or from before the target was saved, prove nothing.
    expect(
      sourceReadiness(saved, [run('2026-07-20T00:00:00.000Z', 'ok', 'trustpilot' as never)]),
    ).toBe('saved');
    expect(sourceReadiness(saved, [run('2026-07-01T00:00:00.000Z', 'ok')])).toBe('saved');
  });

  it('is verified after a later sync returned reviews or only already-stored ones', () => {
    expect(sourceReadiness(saved, [run('2026-07-20T00:00:00.000Z', 'ok')])).toBe('verified');
    expect(sourceReadiness(saved, [run('2026-07-20T00:00:00.000Z', 'zeroNew')])).toBe('verified');
  });

  it('follows the newest eligible sync, whatever order runs arrive in', () => {
    const older = run('2026-07-12T00:00:00.000Z', 'ok');
    const newer = run('2026-07-15T00:00:00.000Z', 'failed');
    expect(sourceReadiness(saved, [newer, older])).toBe('failed');
    expect(sourceReadiness(saved, [older, newer])).toBe('failed');
    expect(sourceReadiness(saved, [run('2026-07-18T00:00:00.000Z', 'ok'), newer, older])).toBe(
      'verified',
    );
  });
});
