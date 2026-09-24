import { describe, expect, it } from 'vitest';
import { computeConfidence, type ConfidenceCitedSource } from './confidence.js';

const RUN_AT = new Date('2026-07-19T00:00:00Z');

function src(
  registrableDomain: string,
  sourceType: ConfidenceCitedSource['sourceType'],
  observedAt: string | null = null,
): ConfidenceCitedSource {
  return { registrableDomain, sourceType, observedAt };
}

describe('computeConfidence', () => {
  it('returns high for ≥3 domains + ≥2 types + ≥1 recent', () => {
    const result = computeConfidence({
      runCreatedAt: RUN_AT,
      citedSources: [
        src('a.com', 'forum', '2026-05-01T00:00:00Z'),
        src('b.com', 'review'),
        src('c.com', 'forum'),
      ],
    });
    expect(result.confidence).toBe('high');
    expect(result.reasonCode).toBeNull();
    expect(result.independentDomainCount).toBe(3);
    expect(result.sourceTypeCount).toBe(2);
    expect(result.mostRecentSourceObservedAt).toBe('2026-05-01T00:00:00Z');
  });

  it('drops to medium when the recent source is >12 months old', () => {
    const result = computeConfidence({
      runCreatedAt: RUN_AT,
      citedSources: [
        src('a.com', 'forum', '2024-06-01T00:00:00Z'),
        src('b.com', 'review'),
        src('c.com', 'forum'),
      ],
    });
    expect(result.confidence).toBe('medium');
  });

  it('returns medium when ≥2 domains only', () => {
    const result = computeConfidence({
      runCreatedAt: RUN_AT,
      citedSources: [src('a.com', 'forum'), src('b.com', 'forum')],
    });
    expect(result.confidence).toBe('medium');
    expect(result.reasonCode).toBeNull();
  });

  it('returns medium when ≥2 source types only', () => {
    const result = computeConfidence({
      runCreatedAt: RUN_AT,
      citedSources: [src('a.com', 'forum'), src('a.com', 'review')],
    });
    expect(result.confidence).toBe('medium');
  });

  it('returns low with anecdotal_coverage otherwise', () => {
    const result = computeConfidence({
      runCreatedAt: RUN_AT,
      citedSources: [src('a.com', 'forum')],
    });
    expect(result.confidence).toBe('low');
    expect(result.reasonCode).toBe('anecdotal_coverage');
  });

  it('handles empty cited sources', () => {
    const result = computeConfidence({
      runCreatedAt: RUN_AT,
      citedSources: [],
    });
    expect(result.confidence).toBe('low');
    expect(result.independentDomainCount).toBe(0);
    expect(result.sourceTypeCount).toBe(0);
    expect(result.mostRecentSourceObservedAt).toBeNull();
  });

  it('ignores unparseable observedAt', () => {
    const result = computeConfidence({
      runCreatedAt: RUN_AT,
      citedSources: [
        src('a.com', 'forum', 'not-a-date'),
        src('b.com', 'review'),
        src('c.com', 'forum'),
      ],
    });
    expect(result.confidence).toBe('medium');
    expect(result.mostRecentSourceObservedAt).toBeNull();
  });

  it('ignores empty registrable domain but counts type', () => {
    const result = computeConfidence({
      runCreatedAt: RUN_AT,
      citedSources: [src('', 'forum'), src('', 'review')],
    });
    expect(result.independentDomainCount).toBe(0);
    expect(result.sourceTypeCount).toBe(2);
    expect(result.confidence).toBe('medium');
  });

  it('picks the most recent observedAt across sources', () => {
    const result = computeConfidence({
      runCreatedAt: RUN_AT,
      citedSources: [
        src('a.com', 'forum', '2026-01-01T00:00:00Z'),
        src('b.com', 'review', '2026-06-01T00:00:00Z'),
        src('c.com', 'forum', '2025-11-01T00:00:00Z'),
      ],
    });
    expect(result.mostRecentSourceObservedAt).toBe('2026-06-01T00:00:00Z');
    expect(result.confidence).toBe('high');
  });
});
