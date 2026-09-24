import { describe, expect, it } from 'vitest';
import {
  ACTION_ALLOWED_TRANSITIONS,
  ACTION_STATES,
  isActionConfidence,
  isActionEffort,
  isActionSeverity,
  isActionSourceType,
  isActionState,
  isAllowedActionTransition,
} from './types';

describe('actions types', () => {
  it('guards return true for valid values and false otherwise', () => {
    expect(isActionState('open')).toBe(true);
    expect(isActionState('completed')).toBe(true);
    expect(isActionState('unknown')).toBe(false);
    expect(isActionState(null)).toBe(false);
    expect(isActionState(42)).toBe(false);

    expect(isActionSourceType('audit_finding')).toBe(true);
    expect(isActionSourceType('mystery_source')).toBe(false);

    expect(isActionSeverity('critical')).toBe(true);
    expect(isActionSeverity('boom')).toBe(false);

    expect(isActionConfidence('high')).toBe(true);
    expect(isActionConfidence('none')).toBe(false);

    expect(isActionEffort('low')).toBe(true);
    expect(isActionEffort('huge')).toBe(false);
  });

  it('allowed transitions match the server matrix and reject others', () => {
    // Every state has at least one allowed transition.
    for (const s of ACTION_STATES) {
      expect(ACTION_ALLOWED_TRANSITIONS[s].length).toBeGreaterThan(0);
    }
    expect(isAllowedActionTransition('open', 'planned')).toBe(true);
    expect(isAllowedActionTransition('open', 'dismissed')).toBe(true);
    expect(isAllowedActionTransition('open', 'completed')).toBe(true);
    expect(isAllowedActionTransition('planned', 'open')).toBe(true);
    expect(isAllowedActionTransition('planned', 'completed')).toBe(true);
    expect(isAllowedActionTransition('dismissed', 'open')).toBe(true);
    expect(isAllowedActionTransition('dismissed', 'planned')).toBe(true);
    expect(isAllowedActionTransition('completed', 'open')).toBe(true);
    // Illegal: dismissed → completed, completed → dismissed, same-state.
    expect(isAllowedActionTransition('dismissed', 'completed')).toBe(false);
    expect(isAllowedActionTransition('completed', 'dismissed')).toBe(false);
    expect(isAllowedActionTransition('completed', 'planned')).toBe(false);
    for (const s of ACTION_STATES) {
      // Same-state is not in the transition matrix; caller handles idempotency.
      expect(ACTION_ALLOWED_TRANSITIONS[s]).not.toContain(s);
    }
  });
});
