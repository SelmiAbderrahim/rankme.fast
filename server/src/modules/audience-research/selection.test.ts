import { describe, expect, it } from 'vitest';
import {
  MAX_CANDIDATES,
  MAX_PER_REGISTRABLE_DOMAIN,
  dedupeByCanonical,
  dedupeByContentHash,
  selectCandidates,
} from './selection.js';
import type {
  PublicPageDiscoveryRow,
  PublicPageSourceHint,
} from '../../shared/providers/types.js';
import { buildObservationMeta } from '../../shared/observations/observations.js';

const META = buildObservationMeta({
  sourceKind: 'provider_observation',
  sourceLabel: 'dataforseo',
  observedAt: new Date('2026-07-19T00:00:00Z'),
});

function row(
  overrides: Partial<PublicPageDiscoveryRow>,
): PublicPageDiscoveryRow {
  return {
    queryId: 'q-001',
    canonicalUrl: 'https://reddit.com/r/x/comments/1',
    title: 'seo pricing tips',
    organicPosition: 1,
    observedAt: null,
    sourceTypeHint: null as PublicPageSourceHint | null,
    observationMeta: META,
    ...overrides,
  };
}

describe('dedupeByCanonical', () => {
  it('folds duplicate canonical URLs and collects queryIds', () => {
    const out = dedupeByCanonical([
      row({ queryId: 'q-001', canonicalUrl: 'https://a.com/x' }),
      row({ queryId: 'q-002', canonicalUrl: 'https://a.com/x', organicPosition: 5 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.discoveryQueryIds).toEqual(['q-001', 'q-002']);
    expect(out[0]!.organicPosition).toBe(1);
  });

  it('keeps lower organic position when duplicates arrive out of order', () => {
    const out = dedupeByCanonical([
      row({ queryId: 'q-001', canonicalUrl: 'https://a.com/x', organicPosition: 7 }),
      row({ queryId: 'q-002', canonicalUrl: 'https://a.com/x', organicPosition: 2 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.organicPosition).toBe(2);
  });

  it('preserves distinct canonical URLs', () => {
    const out = dedupeByCanonical([
      row({ canonicalUrl: 'https://a.com/x' }),
      row({ canonicalUrl: 'https://b.com/y' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('does not double queryId within the fold', () => {
    const out = dedupeByCanonical([
      row({ queryId: 'q-1', canonicalUrl: 'https://a.com/x' }),
      row({ queryId: 'q-1', canonicalUrl: 'https://a.com/x', organicPosition: 3 }),
    ]);
    expect(out[0]!.discoveryQueryIds).toEqual(['q-1']);
  });
});

describe('dedupeByContentHash', () => {
  it('collapses same-hash sources to one entry', () => {
    const sources = [
      { contentHash: 'h1', canonicalUrl: 'https://a.com/x' },
      { contentHash: 'h1', canonicalUrl: 'https://b.com/y' },
      { contentHash: 'h2', canonicalUrl: 'https://c.com/z' },
    ];
    const out = dedupeByContentHash(sources);
    expect(out).toHaveLength(2);
    expect(out[0]!.canonicalUrl).toBe('https://a.com/x');
  });
});

describe('selectCandidates lexicographic tuple', () => {
  it('relevance dominates position', () => {
    const rows = [
      row({
        queryId: 'q-001',
        canonicalUrl: 'https://a.com/other',
        title: 'unrelated',
        organicPosition: 1,
      }),
      row({
        queryId: 'q-001',
        canonicalUrl: 'https://b.com/seo-pricing-tips',
        title: 'seo pricing tips',
        organicPosition: 8,
      }),
    ];
    const out = selectCandidates({
      rows,
      queries: [{ id: 'q-001', text: 'seo pricing' }],
    });
    expect(out[0]!.canonicalUrl).toBe('https://b.com/seo-pricing-tips');
  });

  it('picks the more-recent observedAt when both dates are known', () => {
    // Explicitly seed the input in both orders so tupleCompare's a>b and a<b
    // branches both fire regardless of Array.prototype.sort call order.
    const rows = [
      row({
        canonicalUrl: 'https://a.com/newer',
        title: 'seo',
        organicPosition: 3,
        observedAt: '2026-06-01T00:00:00Z',
      }),
      row({
        canonicalUrl: 'https://a.com/older',
        title: 'seo',
        organicPosition: 3,
        observedAt: '2026-01-01T00:00:00Z',
      }),
      row({
        canonicalUrl: 'https://a.com/mid',
        title: 'seo',
        organicPosition: 3,
        observedAt: '2026-03-01T00:00:00Z',
      }),
    ];
    const out = selectCandidates({
      rows,
      queries: [{ id: 'q-001', text: 'seo' }],
      maxPerRegistrableDomain: 5,
    });
    expect(out[0]!.canonicalUrl).toBe('https://a.com/newer');
  });

  it('skips a source type in round-robin when it was already taken', () => {
    // The very first pick is a forum (highest relevance + best position). Pass
    // A must then see `takenTypes.has('forum')` and continue to review.
    const rows = [
      row({ canonicalUrl: 'https://reddit.com/r/x/1', title: 'seo', organicPosition: 1 }),
      row({ canonicalUrl: 'https://reddit.com/r/y/2', title: 'seo', organicPosition: 2 }),
      row({ canonicalUrl: 'https://g2.com/products/a/reviews', title: 'seo', organicPosition: 3 }),
    ];
    const out = selectCandidates({
      rows,
      queries: [{ id: 'q-001', text: 'seo' }],
      maxCandidates: 2,
    });
    const types = new Set(out.map((c) => c.sourceType));
    expect(types.has('forum')).toBe(true);
    expect(types.has('review')).toBe(true);
  });

  it('breaks relevance ties on position, then recency, then URL', () => {
    const rows = [
      row({
        canonicalUrl: 'https://a.com/x',
        title: 'seo',
        organicPosition: 3,
        observedAt: '2026-05-01T00:00:00Z',
      }),
      row({
        canonicalUrl: 'https://a.com/y',
        title: 'seo',
        organicPosition: 3,
        observedAt: null,
      }),
      row({
        canonicalUrl: 'https://a.com/z',
        title: 'seo',
        organicPosition: 3,
        observedAt: '2026-05-01T00:00:00Z',
      }),
    ];
    const out = selectCandidates({
      rows,
      queries: [{ id: 'q-001', text: 'seo' }],
      maxPerRegistrableDomain: 5,
    });
    // Known-recency first (nulls sorted after), then canonical URL asc.
    expect(out.map((c) => c.canonicalUrl)).toEqual([
      'https://a.com/x',
      'https://a.com/z',
      'https://a.com/y',
    ]);
  });

  it('enforces ≤ MAX_PER_REGISTRABLE_DOMAIN', () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      row({
        canonicalUrl: `https://reddit.com/r/x/comments/${i}`,
        title: `seo ${i}`,
        organicPosition: i + 1,
      }),
    );
    const out = selectCandidates({
      rows,
      queries: [{ id: 'q-001', text: 'seo' }],
    });
    expect(out.length).toBe(MAX_PER_REGISTRABLE_DOMAIN);
  });

  it('respects the hard MAX_CANDIDATES cap', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row({
        canonicalUrl: `https://d${i}.com/p`,
        title: `seo ${i}`,
        organicPosition: 1,
      }),
    );
    const out = selectCandidates({
      rows,
      queries: [{ id: 'q-001', text: 'seo' }],
    });
    expect(out.length).toBeLessThanOrEqual(MAX_CANDIDATES);
  });

  it('forces at least one of each source type when available (round-robin)', () => {
    const rows = [
      row({ canonicalUrl: 'https://reddit.com/r/x/1', title: 'seo', organicPosition: 1 }),
      row({ canonicalUrl: 'https://reddit.com/r/x/2', title: 'seo', organicPosition: 2 }),
      row({ canonicalUrl: 'https://g2.com/products/a/reviews', title: 'seo', organicPosition: 3 }),
      row({ canonicalUrl: 'https://quora.com/a-b-c', title: 'seo', organicPosition: 4 }),
      row({ canonicalUrl: 'https://one.com/one-vs-two', title: 'seo', organicPosition: 5 }),
    ];
    const out = selectCandidates({
      rows,
      queries: [{ id: 'q-001', text: 'seo' }],
      maxCandidates: 4,
    });
    const types = new Set(out.map((c) => c.sourceType));
    expect(types.has('forum')).toBe(true);
    expect(types.has('review')).toBe(true);
    expect(types.has('question')).toBe(true);
    expect(types.has('comparison')).toBe(true);
  });

  it('falls through gracefully when relevance is zero across the board', () => {
    const rows = [row({ canonicalUrl: 'https://n.com/a' })];
    const out = selectCandidates({
      rows,
      queries: [{ id: 'q-9', text: 'unmapped' }],
    });
    expect(out).toHaveLength(1);
  });

  it('handles a malformed canonical URL without throwing', () => {
    const rows = [row({ canonicalUrl: 'not-a-url' })];
    const out = selectCandidates({
      rows,
      queries: [{ id: 'q-001', text: 'seo' }],
    });
    expect(out).toHaveLength(1);
  });

  it('handles empty queries map', () => {
    const out = selectCandidates({
      rows: [row({})],
      queries: [],
    });
    expect(out).toHaveLength(1);
  });
});
