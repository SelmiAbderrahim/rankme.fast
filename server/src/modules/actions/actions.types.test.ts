/**
 * Runtime confidence mapper on the actions type module.
 *
 * `confidenceFromFreshness` is the ONLY runtime export of `actions.types.ts`.
 * It is deterministic (no AI) and every `Freshness` member must map, so the
 * whole closed union is asserted here rather than only the happy path.
 */
import { describe, expect, it } from 'vitest';
import type { Freshness } from '../../shared/observations/types.js';
import { confidenceFromFreshness } from './actions.types.js';

describe('confidenceFromFreshness', () => {
  it('maps a fresh observation to high confidence', () => {
    expect(confidenceFromFreshness('fresh')).toBe('high');
  });

  it('maps a stale observation to medium confidence', () => {
    expect(confidenceFromFreshness('stale')).toBe('medium');
  });

  it.each<Freshness>(['partial', 'blocked', 'failed', 'unknown'])(
    'maps the degraded freshness %s to low confidence',
    (freshness) => {
      expect(confidenceFromFreshness(freshness)).toBe('low');
    },
  );

  it('covers every member of the Freshness union', () => {
    const all: Freshness[] = [
      'fresh',
      'stale',
      'partial',
      'blocked',
      'failed',
      'unknown',
    ];
    expect(all.map((f) => confidenceFromFreshness(f))).toEqual([
      'high',
      'medium',
      'low',
      'low',
      'low',
      'low',
    ]);
  });
});
