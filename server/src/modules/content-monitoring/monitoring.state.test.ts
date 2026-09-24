/**
 * Content-monitor status-machine unit tests. Every pair of known statuses is a
 * legal edge (active ⇄ paused, → error, recovery); unknown statuses throw.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT_MONITOR_STATUSES } from './monitor.model.js';
import {
  ContentMonitorTransitionError,
  assertContentMonitorTransition,
  canContentMonitorTransition,
} from './monitoring.state.js';

describe('assertContentMonitorTransition', () => {
  it('allows every edge between known statuses, including a same-status no-op', () => {
    expect([...CONTENT_MONITOR_STATUSES].sort()).toEqual(['active', 'error', 'paused']);
    for (const from of CONTENT_MONITOR_STATUSES) {
      for (const to of CONTENT_MONITOR_STATUSES) {
        expect(() => assertContentMonitorTransition(from, to)).not.toThrow();
      }
    }
  });

  it('rejects unknown source / target statuses', () => {
    expect(() =>
      assertContentMonitorTransition('bogus' as never, 'active'),
    ).toThrow(/unknown source/);
    expect(() =>
      assertContentMonitorTransition('active', 'nope' as never),
    ).toThrow(/unknown target/);
    expect(() =>
      assertContentMonitorTransition('cap_paused' as never, 'active'),
    ).toThrow(ContentMonitorTransitionError);
  });

  it('exposes from/to on the error', () => {
    try {
      assertContentMonitorTransition('bogus' as never, 'active');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ContentMonitorTransitionError);
      expect((err as ContentMonitorTransitionError).from).toBe('bogus');
      expect((err as ContentMonitorTransitionError).to).toBe('active');
    }
  });
});

describe('canContentMonitorTransition', () => {
  it('returns booleans instead of throwing', () => {
    expect(canContentMonitorTransition('active', 'paused')).toBe(true);
    expect(canContentMonitorTransition('active', 'bogus' as never)).toBe(false);
  });
});
