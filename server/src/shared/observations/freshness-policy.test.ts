import { describe, expect, it } from 'vitest';
import { freshDaysFor, freshnessStateFor, freshUntilFor } from './freshness-policy.js';

const asOf = new Date('2026-01-01T12:00:00Z');
describe('observation freshness by source', () => {
  it('allows expected reporting lag and follows the configured rank cadence', () => {
    expect(freshDaysFor('audit')).toBe(30);
    expect(freshDaysFor('search_console')).toBe(5);
    expect(freshDaysFor('rank_checks')).toBe(9);
    expect(freshDaysFor('rank_checks', { cadence: 'daily' })).toBe(3);
    expect(freshDaysFor('backlinks')).toBeNull();
  });
  it('is still fresh exactly at the boundary and stale after it', () => {
    expect(freshUntilFor('audit', asOf)).toEqual(new Date('2026-01-31T12:00:00Z'));
    expect(freshnessStateFor('audit', asOf, new Date('2026-01-31T12:00:00Z'))).toBe('value');
    expect(freshnessStateFor('audit', asOf, new Date('2026-01-31T12:00:00.001Z'))).toBe('stale');
    expect(freshnessStateFor('rank_checks', asOf, new Date('2026-01-05T12:00:00Z'), { cadence: 'daily' })).toBe('stale');
    expect(freshnessStateFor('rank_checks', asOf, new Date('2026-01-05T12:00:00Z'))).toBe('value');
  });
  it('does not mark manually retained backlink data stale just by age', () => {
    expect(freshUntilFor('backlinks', asOf)).toBeNull();
    expect(freshnessStateFor('backlinks', asOf, new Date('2030-01-01'))).toBe('value');
  });
});
