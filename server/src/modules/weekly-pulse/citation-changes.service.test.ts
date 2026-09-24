import { describe, expect, it } from 'vitest';
import {
  computeCitationChanges,
  isCompatiblePriorPulse,
  marketSnapshotEqual,
  serializeSupportedCells,
  type CitationRow,
  type EngineSurfaceCell,
  type PulseInputs,
} from './citation-changes.service.js';

function cell(
  engine: string,
  surface: 'mentions' | 'citations',
  overrides: Partial<EngineSurfaceCell> = {},
): EngineSurfaceCell {
  return {
    engine,
    surface,
    promptCohortId: 'cohort-1',
    promptCohortVersion: 1,
    supported: true,
    complete: true,
    ...overrides,
  };
}

function citation(
  engine: string,
  surface: 'mentions' | 'citations',
  url: string,
  overrides: Partial<CitationRow> = {},
): CitationRow {
  return {
    engine,
    surface,
    promptCohortId: 'cohort-1',
    promptCohortVersion: 1,
    canonicalUrl: url,
    host: new URL(url).host,
    citationId: `cid-${engine}-${url}`,
    ...overrides,
  };
}

function pulse(overrides: Partial<PulseInputs> = {}): PulseInputs {
  const base: PulseInputs = {
    status: 'completed',
    promptCohortId: 'cohort-1',
    promptCohortVersion: 1,
    marketSnapshot: { locale: 'en-US' },
    engineSurfaceSet: [cell('google', 'mentions'), cell('chat_gpt', 'mentions')],
    citations: [],
    siteId: 'site-1',
  };
  return { ...base, ...overrides };
}

describe('marketSnapshotEqual', () => {
  it('scalar equality', () => {
    expect(marketSnapshotEqual(1, 1)).toBe(true);
    expect(marketSnapshotEqual(1, 2)).toBe(false);
    expect(marketSnapshotEqual('a', 'a')).toBe(true);
    expect(marketSnapshotEqual(null, null)).toBe(true);
    expect(marketSnapshotEqual(null, {})).toBe(false);
    expect(marketSnapshotEqual({}, null)).toBe(false);
  });
  it('array equality regardless of insertion but same order', () => {
    expect(marketSnapshotEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(marketSnapshotEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(marketSnapshotEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(marketSnapshotEqual([1, 2, 3], { 0: 1, 1: 2, 2: 3 })).toBe(false);
  });
  it('object equality', () => {
    expect(marketSnapshotEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(marketSnapshotEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(marketSnapshotEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
  });
  it('mismatched primitive types', () => {
    expect(marketSnapshotEqual(1, '1')).toBe(false);
  });
});

describe('serializeSupportedCells', () => {
  it('orders stably, ignores unsupported', () => {
    expect(
      serializeSupportedCells([
        cell('chat_gpt', 'mentions'),
        cell('google', 'mentions', { supported: false }),
        cell('perplexity', 'mentions'),
      ]),
    ).toBe('chat_gpt/mentionsperplexity/mentions');
  });
});

describe('isCompatiblePriorPulse', () => {
  it('requires matching site/cohort/market/status/cells', () => {
    const cur = pulse();
    const priorGood = pulse();
    expect(isCompatiblePriorPulse(cur, priorGood)).toBe(true);
    expect(isCompatiblePriorPulse(cur, pulse({ siteId: 'other' }))).toBe(false);
    expect(isCompatiblePriorPulse(cur, pulse({ promptCohortId: 'cohort-2' }))).toBe(false);
    expect(isCompatiblePriorPulse(cur, pulse({ promptCohortVersion: 2 }))).toBe(false);
    expect(isCompatiblePriorPulse(cur, pulse({ marketSnapshot: { locale: 'fr' } }))).toBe(false);
    expect(isCompatiblePriorPulse(cur, pulse({ status: 'failed' }))).toBe(false);
    expect(isCompatiblePriorPulse(pulse({ status: 'failed' }), priorGood)).toBe(false);
    expect(
      isCompatiblePriorPulse(cur, pulse({ engineSurfaceSet: [cell('google', 'mentions')] })),
    ).toBe(false);
  });
});

describe('computeCitationChanges truth table', () => {
  it('no prior → every current citation is unknown_partial', () => {
    const now = pulse({
      citations: [
        citation('google', 'mentions', 'https://a.example/x'),
        citation('chat_gpt', 'mentions', 'https://b.example/y'),
      ],
    });
    const out = computeCitationChanges(now, null);
    expect(out).toHaveLength(2);
    expect(out.every((c) => c.change === 'unknown_partial')).toBe(true);
  });

  it('incompatible prior → unknown_partial for every current citation', () => {
    const now = pulse({
      citations: [citation('google', 'mentions', 'https://a.example/x')],
    });
    const prior = pulse({
      siteId: 'other',
      citations: [citation('google', 'mentions', 'https://a.example/x')],
    });
    const out = computeCitationChanges(now, prior);
    expect(out).toHaveLength(1);
    expect(out[0]!.change).toBe('unknown_partial');
  });

  it('present now, absent prior, complete cell → new', () => {
    const now = pulse({
      citations: [citation('google', 'mentions', 'https://a.example/x')],
    });
    const prior = pulse({ citations: [] });
    const [row] = computeCitationChanges(now, prior);
    expect(row?.change).toBe('new');
    expect(row?.citationId).toBe('cid-google-https://a.example/x');
  });

  it('present now, absent prior, PARTIAL cell → unknown_partial (never new)', () => {
    const now = pulse({
      engineSurfaceSet: [cell('google', 'mentions', { complete: false })],
      citations: [citation('google', 'mentions', 'https://a.example/x')],
    });
    const prior = pulse({
      engineSurfaceSet: [cell('google', 'mentions', { complete: true })],
      citations: [],
    });
    const [row] = computeCitationChanges(now, prior);
    expect(row?.change).toBe('unknown_partial');
  });

  it('absent now, present prior, both complete → lost (no citationId carried)', () => {
    const now = pulse({ citations: [] });
    const prior = pulse({
      citations: [citation('google', 'mentions', 'https://old.example/x')],
    });
    const [row] = computeCitationChanges(now, prior);
    expect(row?.change).toBe('lost');
    expect(row?.citationId).toBeNull();
  });

  it('absent now, present prior, current cell partial → unknown_partial (NEVER lost)', () => {
    const now = pulse({
      engineSurfaceSet: [cell('google', 'mentions', { complete: false })],
      citations: [],
    });
    const prior = pulse({
      engineSurfaceSet: [cell('google', 'mentions', { complete: true })],
      citations: [citation('google', 'mentions', 'https://old.example/x')],
    });
    const [row] = computeCitationChanges(now, prior);
    expect(row?.change).toBe('unknown_partial');
  });

  it('present in both runs → no change row', () => {
    const now = pulse({
      citations: [citation('google', 'mentions', 'https://a.example/x')],
    });
    const prior = pulse({
      citations: [citation('google', 'mentions', 'https://a.example/x')],
    });
    expect(computeCitationChanges(now, prior)).toHaveLength(0);
  });

  it('never treats an unsupported current cell as complete-enough', () => {
    // An unsupported cell is skipped when the complete-flag index is built, so
    // a citation sitting in it can only ever be `unknown_partial` — claiming
    // `new` off a cell we never actually collected would be a false positive.
    const now = pulse({
      engineSurfaceSet: [
        cell('google', 'mentions'),
        cell('chat_gpt', 'mentions', { supported: false, complete: true }),
      ],
      citations: [citation('chat_gpt', 'mentions', 'https://a.example/x')],
    });
    const prior = pulse({
      engineSurfaceSet: [
        cell('google', 'mentions'),
        cell('chat_gpt', 'mentions', { supported: false, complete: true }),
      ],
      citations: [],
    });
    const [row] = computeCitationChanges(now, prior);
    expect(row?.change).toBe('unknown_partial');
    expect(row?.engine).toBe('chat_gpt');
  });

  it('never claims `lost` out of an unsupported prior cell', () => {
    const now = pulse({
      engineSurfaceSet: [
        cell('google', 'mentions'),
        cell('chat_gpt', 'mentions', { supported: false, complete: true }),
      ],
      citations: [],
    });
    const prior = pulse({
      engineSurfaceSet: [
        cell('google', 'mentions'),
        cell('chat_gpt', 'mentions', { supported: false, complete: true }),
      ],
      citations: [citation('chat_gpt', 'mentions', 'https://gone.example/x')],
    });
    const [row] = computeCitationChanges(now, prior);
    expect(row?.change).toBe('unknown_partial');
    expect(row?.citationId).toBe('cid-chat_gpt-https://gone.example/x');
  });

  it('emits citationId=null when the source rows carry no citation id', () => {
    // Rows built straight off a collection result (before the citation INSERT
    // returns ids) have no `citationId`; every branch must normalize the
    // missing value to an explicit null rather than leaking `undefined`.
    const withoutId = (engine: string, url: string) =>
      citation(engine, 'mentions', url, { citationId: undefined });

    // (a) no compatible prior → every current row is unknown_partial.
    const noPrior = computeCitationChanges(
      pulse({ citations: [withoutId('google', 'https://a.example/x')] }),
      null,
    );
    expect(noPrior).toHaveLength(1);
    expect(noPrior[0]!.citationId).toBeNull();

    // (b) pass 1 — present now, absent prior, complete cell → `new`.
    const added = computeCitationChanges(
      pulse({ citations: [withoutId('google', 'https://a.example/x')] }),
      pulse({ citations: [] }),
    );
    expect(added).toHaveLength(1);
    expect(added[0]!.change).toBe('new');
    expect(added[0]!.citationId).toBeNull();

    // (c) pass 2 — absent now, present in a partial prior → unknown_partial.
    const dropped = computeCitationChanges(
      pulse({ engineSurfaceSet: [cell('google', 'mentions', { complete: false })] }),
      pulse({
        engineSurfaceSet: [cell('google', 'mentions', { complete: false })],
        citations: [withoutId('google', 'https://old.example/x')],
      }),
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.change).toBe('unknown_partial');
    expect(dropped[0]!.citationId).toBeNull();
  });

  it('absent now, present prior, prior partial → unknown_partial (not lost)', () => {
    // Same engine set (Google only), current cell complete, prior cell partial.
    // Compatibility holds; prior-complete-flag=false → unknown_partial.
    const now = pulse({
      engineSurfaceSet: [cell('google', 'mentions', { complete: true })],
      citations: [],
    });
    const prior = pulse({
      engineSurfaceSet: [cell('google', 'mentions', { complete: false })],
      citations: [citation('google', 'mentions', 'https://old.example/x')],
    });
    const [row] = computeCitationChanges(now, prior);
    expect(row?.change).toBe('unknown_partial');
  });
});
