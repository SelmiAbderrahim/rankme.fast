import { describe, expect, it } from 'vitest';
import {
  AUDIENCE_RESEARCH_STATES,
  AudienceResearchTransitionError,
  TERMINAL_STATES,
  assertTransition,
  canTransition,
  isTerminal,
  type AudienceResearchState,
} from './audience-research.state.js';

describe('audience-research state machine', () => {
  it('locks the enum shape', () => {
    expect(AUDIENCE_RESEARCH_STATES).toEqual([
      'queued',
      'discovering',
      'selecting',
      'collecting',
      'clustering',
      'completed',
      'partial',
      'failed',
    ]);
    expect(TERMINAL_STATES).toEqual(['completed', 'partial', 'failed']);
  });

  it('recognises terminal states', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('partial')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('discovering')).toBe(false);
  });

  it('allows the canonical forward path', () => {
    const path: readonly AudienceResearchState[] = [
      'queued',
      'discovering',
      'selecting',
      'collecting',
      'clustering',
      'completed',
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('allows same-stage re-entry (idempotent resume)', () => {
    expect(canTransition('discovering', 'discovering')).toBe(true);
    expect(canTransition('collecting', 'collecting')).toBe(true);
  });

  it('forbids leaving a terminal state', () => {
    for (const from of TERMINAL_STATES) {
      expect(canTransition(from, 'queued')).toBe(false);
      expect(canTransition(from, 'discovering')).toBe(false);
      expect(canTransition(from, 'completed')).toBe(false);
    }
    expect(() => assertTransition('completed', 'discovering')).toThrow(
      AudienceResearchTransitionError,
    );
  });

  it('allows any non-terminal to short-circuit to any terminal', () => {
    for (const to of TERMINAL_STATES) {
      expect(canTransition('queued', to)).toBe(true);
      expect(canTransition('collecting', to)).toBe(true);
    }
  });

  it('forbids back-stepping to an earlier non-terminal stage', () => {
    expect(canTransition('collecting', 'discovering')).toBe(false);
    expect(canTransition('clustering', 'queued')).toBe(false);
    expect(() => assertTransition('collecting', 'discovering')).toThrow(
      AudienceResearchTransitionError,
    );
  });

  it('rejects unknown source or target states', () => {
    expect(canTransition('bogus' as AudienceResearchState, 'queued')).toBe(false);
    expect(canTransition('queued', 'bogus' as AudienceResearchState)).toBe(false);
    expect(() => assertTransition('bogus' as AudienceResearchState, 'queued')).toThrow(
      AudienceResearchTransitionError,
    );
    expect(() => assertTransition('queued', 'bogus' as AudienceResearchState)).toThrow(
      AudienceResearchTransitionError,
    );
  });

  it('exposes the offending states on the error', () => {
    try {
      assertTransition('completed', 'discovering');
      expect.unreachable();
    } catch (e) {
      const err = e as AudienceResearchTransitionError;
      expect(err.from).toBe('completed');
      expect(err.to).toBe('discovering');
      expect(err.name).toBe('AudienceResearchTransitionError');
    }
  });
});
