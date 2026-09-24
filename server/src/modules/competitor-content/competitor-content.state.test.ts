/**
 * Competitor content state-machine unit tests. Monotonic stage
 * advance; terminal states never re-open; unknown statuses throw.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPETITOR_CONTENT_STAGE_ORDER,
  CompetitorContentTransitionError,
  assertCompetitorContentTransition,
  canCompetitorContentTransition,
  isCompetitorContentCancellable,
  isCompetitorContentTerminalStatus,
} from './competitor-content.state.js';

describe('stage order + terminal helpers', () => {
  it('exposes the ordered non-terminal stages', () => {
    expect(COMPETITOR_CONTENT_STAGE_ORDER).toEqual(['queued', 'collecting', 'comparing']);
  });

  it('classifies terminal + cancellable statuses', () => {
    expect(isCompetitorContentTerminalStatus('completed')).toBe(true);
    expect(isCompetitorContentTerminalStatus('collecting')).toBe(false);
    expect(isCompetitorContentCancellable('queued')).toBe(true);
    expect(isCompetitorContentCancellable('failed')).toBe(false);
  });
});

describe('assertCompetitorContentTransition', () => {
  it('allows a forward stage advance', () => {
    expect(() => assertCompetitorContentTransition('queued', 'collecting')).not.toThrow();
    expect(() => assertCompetitorContentTransition('collecting', 'comparing')).not.toThrow();
  });

  it('allows any non-terminal → terminal transition', () => {
    expect(() => assertCompetitorContentTransition('collecting', 'partial')).not.toThrow();
    expect(() => assertCompetitorContentTransition('queued', 'cancelled')).not.toThrow();
  });

  it('rejects leaving a terminal state', () => {
    expect(() => assertCompetitorContentTransition('completed', 'comparing')).toThrow(
      CompetitorContentTransitionError,
    );
  });

  it('rejects a backward or same-stage move', () => {
    expect(() => assertCompetitorContentTransition('comparing', 'collecting')).toThrow(
      /advance only/,
    );
    expect(() => assertCompetitorContentTransition('collecting', 'collecting')).toThrow();
  });

  it('rejects unknown source / target statuses', () => {
    expect(() => assertCompetitorContentTransition('bogus' as never, 'collecting')).toThrow(
      /unknown source/,
    );
    expect(() => assertCompetitorContentTransition('queued', 'bogus' as never)).toThrow(
      /unknown target/,
    );
  });

  it('exposes from/to on the error', () => {
    try {
      assertCompetitorContentTransition('completed', 'queued');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CompetitorContentTransitionError);
      expect((err as CompetitorContentTransitionError).from).toBe('completed');
      expect((err as CompetitorContentTransitionError).to).toBe('queued');
    }
  });
});

describe('canCompetitorContentTransition', () => {
  it('returns booleans instead of throwing', () => {
    expect(canCompetitorContentTransition('queued', 'comparing')).toBe(true);
    expect(canCompetitorContentTransition('completed', 'queued')).toBe(false);
  });
});
