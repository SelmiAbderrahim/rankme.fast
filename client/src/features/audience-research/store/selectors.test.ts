import { describe, expect, it } from 'vitest';
import type { SignalDecisionResult } from '../types';
import { initialState, type AudienceResearchState } from './slice';
import {
  selectSignalDecisionConflict,
  selectSignalDecisionError,
  selectSignalDecisionInFlight,
  selectSignalDecisionPending,
  selectSignalTerminalDecision,
} from './selectors';

/**
 * Per-signal decision selectors. These are separately unit-tested because
 * the container tests never exercise the null-signalId branch (components
 * always pass a real signalId), and the terminal/pending/error/conflict
 * fallbacks are only hit when a signal has no recorded row yet.
 */

const decision: SignalDecisionResult = {
  signalId: 'sig-1',
  terminalDecision: 'accepted',
  destination: 'product',
  downstreamId: 'product:xyz',
  deepLinkPath: '/sites/s1?tab=actions&action=product:xyz',
  decidedAt: '2026-06-02T00:00:00.000Z',
  decidedBy: { userId: 'u1' },
  duplicate: false,
};

function stateWith(overrides: Partial<AudienceResearchState['decisions']> = {}) {
  return {
    audienceResearch: {
      ...initialState,
      decisions: {
        terminal: {},
        pending: {},
        inFlight: {},
        error: {},
        conflict: {},
        ...overrides,
      },
    },
  };
}

describe('selectSignalTerminalDecision', () => {
  it('returns undefined when signalId is null', () => {
    expect(selectSignalTerminalDecision(null)(stateWith())).toBeUndefined();
  });

  it('returns undefined when signalId is undefined', () => {
    expect(selectSignalTerminalDecision(undefined)(stateWith())).toBeUndefined();
  });

  it('returns undefined when no terminal row exists for the signal', () => {
    expect(selectSignalTerminalDecision('sig-1')(stateWith())).toBeUndefined();
  });

  it('returns the terminal row when one exists', () => {
    expect(
      selectSignalTerminalDecision('sig-1')(
        stateWith({ terminal: { 'sig-1': decision } }),
      ),
    ).toEqual(decision);
  });
});

describe('selectSignalDecisionPending', () => {
  it('returns undefined when signalId is null', () => {
    expect(selectSignalDecisionPending(null)(stateWith())).toBeUndefined();
  });

  it('returns undefined when no pending row exists', () => {
    expect(selectSignalDecisionPending('sig-1')(stateWith())).toBeUndefined();
  });

  it('returns the pending entry when one exists', () => {
    expect(
      selectSignalDecisionPending('sig-1')(
        stateWith({ pending: { 'sig-1': { idempotencyKey: 'ik' } } }),
      ),
    ).toEqual({ idempotencyKey: 'ik' });
  });
});

describe('selectSignalDecisionError', () => {
  it('returns an empty string when signalId is null', () => {
    expect(selectSignalDecisionError(null)(stateWith())).toBe('');
  });

  it('returns an empty string when the signal has no recorded error', () => {
    expect(selectSignalDecisionError('sig-1')(stateWith())).toBe('');
  });

  it('returns the recorded error string when one exists', () => {
    expect(
      selectSignalDecisionError('sig-1')(
        stateWith({ error: { 'sig-1': 'boom' } }),
      ),
    ).toBe('boom');
  });
});

describe('selectSignalDecisionInFlight', () => {
  it('returns false when signalId is null', () => {
    expect(selectSignalDecisionInFlight(null)(stateWith())).toBe(false);
  });

  it('returns false when nothing is on the wire for the signal', () => {
    expect(selectSignalDecisionInFlight('sig-1')(stateWith())).toBe(false);
  });

  it('returns true only while a request is in flight', () => {
    expect(
      selectSignalDecisionInFlight('sig-1')(
        stateWith({ inFlight: { 'sig-1': true } }),
      ),
    ).toBe(true);
  });

  it('reads a pre-inFlight state snapshot as not submitting (optional map)', () => {
    // Snapshots seeded before the `inFlight` map existed (older fixtures)
    // must not crash and must read as "not submitting".
    const state = stateWith();
    delete (
      state.audienceResearch.decisions as { inFlight?: Record<string, true> }
    ).inFlight;
    expect(selectSignalDecisionInFlight('sig-1')(state)).toBe(false);
  });
});

describe('selectSignalDecisionConflict', () => {
  it('returns false when signalId is null', () => {
    expect(selectSignalDecisionConflict(null)(stateWith())).toBe(false);
  });

  it('returns false when no conflict flag is set', () => {
    expect(selectSignalDecisionConflict('sig-1')(stateWith())).toBe(false);
  });

  it('returns true when a conflict flag is set for the signal', () => {
    expect(
      selectSignalDecisionConflict('sig-1')(
        stateWith({ conflict: { 'sig-1': true } }),
      ),
    ).toBe(true);
  });
});

describe('lazy-slice fallback on the signal selectors', () => {
  it('returns undefined/false/empty when the audienceResearch slice has not been injected yet', () => {
    const bare = {} as never;
    expect(selectSignalTerminalDecision('sig-1')(bare)).toBeUndefined();
    expect(selectSignalDecisionPending('sig-1')(bare)).toBeUndefined();
    expect(selectSignalDecisionError('sig-1')(bare)).toBe('');
    expect(selectSignalDecisionConflict('sig-1')(bare)).toBe(false);
  });
});
