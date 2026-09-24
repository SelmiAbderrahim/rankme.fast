import { describe, expect, it } from 'vitest';
import {
  CONTENT_ANALYSIS_STAGE_ORDER,
  ContentAnalysisTransitionError,
  assertContentAnalysisTransition,
  canTransition,
  isTerminalStatus,
} from './content-analysis.state.js';
import {
  CONTENT_ANALYSIS_STATUSES,
  CONTENT_ANALYSIS_TERMINAL_STATUSES,
} from './content-analysis.model.js';

describe('content-analysis state machine', () => {
  it('exposes every status in the stage order (non-terminal only) plus every terminal status', () => {
    const stageSet = new Set<string>(CONTENT_ANALYSIS_STAGE_ORDER);
    const terminalSet = new Set<string>(CONTENT_ANALYSIS_TERMINAL_STATUSES);
    for (const status of CONTENT_ANALYSIS_STATUSES) {
      expect(stageSet.has(status) || terminalSet.has(status)).toBe(true);
    }
    for (const status of CONTENT_ANALYSIS_TERMINAL_STATUSES) {
      expect(isTerminalStatus(status)).toBe(true);
    }
    for (const stage of CONTENT_ANALYSIS_STAGE_ORDER) {
      expect(isTerminalStatus(stage)).toBe(false);
    }
  });

  it('advances forward through consecutive stages', () => {
    for (let i = 0; i < CONTENT_ANALYSIS_STAGE_ORDER.length - 1; i++) {
      const from = CONTENT_ANALYSIS_STAGE_ORDER[i]!;
      const to = CONTENT_ANALYSIS_STAGE_ORDER[i + 1]!;
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('allows skipping stages forward (multi-stage jump)', () => {
    expect(canTransition('queued', 'scoring')).toBe(true);
  });

  it('rejects a backward transition', () => {
    expect(() => assertContentAnalysisTransition('scoring', 'collecting_owned')).toThrow(
      ContentAnalysisTransitionError,
    );
  });

  it('rejects re-entering the current stage (no self-transition)', () => {
    expect(() => assertContentAnalysisTransition('collecting_owned', 'collecting_owned')).toThrow(
      /cannot move/,
    );
  });

  it('rejects any transition out of a terminal state', () => {
    for (const terminal of CONTENT_ANALYSIS_TERMINAL_STATUSES) {
      for (const target of CONTENT_ANALYSIS_STATUSES) {
        expect(() =>
          assertContentAnalysisTransition(terminal, target),
        ).toThrow(/terminal state/);
      }
    }
  });

  it('allows any non-terminal stage to move to any terminal status', () => {
    for (const stage of CONTENT_ANALYSIS_STAGE_ORDER) {
      for (const terminal of CONTENT_ANALYSIS_TERMINAL_STATUSES) {
        expect(canTransition(stage, terminal)).toBe(true);
      }
    }
  });

  it('rejects an unknown source or target status', () => {
    expect(() =>
      assertContentAnalysisTransition(
        'not_a_status' as never,
        'collecting_owned',
      ),
    ).toThrow(/unknown source/);
    expect(() =>
      assertContentAnalysisTransition('queued', 'nope' as never),
    ).toThrow(/unknown target/);
  });

  it('captures from/to on the thrown error for downstream reporting', () => {
    let err: ContentAnalysisTransitionError | null = null;
    try {
      assertContentAnalysisTransition('scoring', 'queued');
    } catch (e) {
      err = e as ContentAnalysisTransitionError;
    }
    expect(err).not.toBeNull();
    expect(err!.from).toBe('scoring');
    expect(err!.to).toBe('queued');
    expect(err!.name).toBe('ContentAnalysisTransitionError');
  });

  it('canTransition returns false on rejection', () => {
    expect(canTransition('completed', 'queued')).toBe(false);
    expect(canTransition('queued', 'scoring')).toBe(true);
  });
});
