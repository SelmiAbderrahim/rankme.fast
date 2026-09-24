import { describe, expect, it } from 'vitest';
import {
  compareActions,
  declineBand,
  declineSeverity,
  EVENT_KIND_FOR_TRANSITION,
  firstPartyImpactFromBaseline,
  isAllowedTransition,
  type OrderableAction,
} from './actions.orders.js';

function make(overrides: Partial<OrderableAction>): OrderableAction {
  return {
    id: overrides.id ?? 'a',
    severity: overrides.severity ?? 'warning',
    firstPartyImpact: overrides.firstPartyImpact ?? 'medium',
    confidence: overrides.confidence ?? 'medium',
    effort: overrides.effort ?? 'medium',
    affectedUrls: overrides.affectedUrls ?? [],
    observedAt: overrides.observedAt ?? '2026-01-01T00:00:00Z',
  };
}

describe('compareActions — tie-break tuple', () => {
  it('severity dominates', () => {
    const critical = make({ id: 'a', severity: 'critical' });
    const info = make({ id: 'b', severity: 'info' });
    expect(compareActions(critical, info)).toBeLessThan(0);
  });

  it('first-party impact within same severity', () => {
    const high = make({ id: 'a', firstPartyImpact: 'high' });
    const low = make({ id: 'b', firstPartyImpact: 'low' });
    expect(compareActions(high, low)).toBeLessThan(0);
  });

  it('confidence within same impact', () => {
    const h = make({ id: 'a', confidence: 'high' });
    const l = make({ id: 'b', confidence: 'low' });
    expect(compareActions(h, l)).toBeLessThan(0);
  });

  it('affected URL count (capped at 20) DESC', () => {
    const many = make({ id: 'a', affectedUrls: new Array(15).fill('u') });
    const few = make({ id: 'b', affectedUrls: ['u'] });
    expect(compareActions(many, few)).toBeLessThan(0);
  });

  it('caps URL contribution at 20', () => {
    const a = make({ id: 'a', affectedUrls: new Array(50).fill('u') });
    const b = make({ id: 'b', affectedUrls: new Array(20).fill('u') });
    // Same effective count → falls through to next tie break (effort equal →
    // observedAt equal → id ASC)
    expect(compareActions(a, b)).toBeLessThan(0);
  });

  it('effort ASC (low before high)', () => {
    const lo = make({ id: 'a', effort: 'low' });
    const hi = make({ id: 'b', effort: 'high' });
    expect(compareActions(lo, hi)).toBeLessThan(0);
  });

  it('observedAt DESC (newer first)', () => {
    const newer = make({ id: 'a', observedAt: '2026-02-01T00:00:00Z' });
    const older = make({ id: 'b', observedAt: '2026-01-01T00:00:00Z' });
    expect(compareActions(newer, older)).toBeLessThan(0);
  });

  it('id ASC as final tie-break', () => {
    const a = make({ id: 'a' });
    const b = make({ id: 'b' });
    expect(compareActions(a, b)).toBeLessThan(0);
    expect(compareActions(b, a)).toBeGreaterThan(0);
  });

  it('is stable/total for identical actions', () => {
    const x = make({ id: 'x' });
    expect(compareActions(x, x)).toBe(0);
  });
});

describe('declineSeverity + band', () => {
  it('elevates to critical at ≥40%', () => {
    expect(declineSeverity(40)).toBe('critical');
    expect(declineSeverity(99)).toBe('critical');
  });

  it('stays warning below 40%', () => {
    expect(declineSeverity(39.99)).toBe('warning');
    expect(declineSeverity(20)).toBe('warning');
  });

  it('bands 40/25/20', () => {
    expect(declineBand(40)).toBe('high');
    expect(declineBand(25)).toBe('medium');
    expect(declineBand(24.99)).toBe('low');
    expect(declineBand(20)).toBe('low');
  });
});

describe('firstPartyImpactFromBaseline', () => {
  it('bands 500/100/20/none', () => {
    expect(firstPartyImpactFromBaseline(500)).toBe('high');
    expect(firstPartyImpactFromBaseline(499)).toBe('medium');
    expect(firstPartyImpactFromBaseline(100)).toBe('medium');
    expect(firstPartyImpactFromBaseline(99)).toBe('low');
    expect(firstPartyImpactFromBaseline(20)).toBe('low');
    expect(firstPartyImpactFromBaseline(19)).toBe('none');
    expect(firstPartyImpactFromBaseline(0)).toBe('none');
  });
});

describe('isAllowedTransition', () => {
  it('open → planned|dismissed|completed', () => {
    expect(isAllowedTransition('open', 'planned')).toBe(true);
    expect(isAllowedTransition('open', 'dismissed')).toBe(true);
    expect(isAllowedTransition('open', 'completed')).toBe(true);
    expect(isAllowedTransition('open', 'open')).toBe(false);
  });

  it('planned → open|dismissed|completed', () => {
    expect(isAllowedTransition('planned', 'open')).toBe(true);
    expect(isAllowedTransition('planned', 'dismissed')).toBe(true);
    expect(isAllowedTransition('planned', 'completed')).toBe(true);
    expect(isAllowedTransition('planned', 'planned')).toBe(false);
  });

  it('dismissed → open|planned only', () => {
    expect(isAllowedTransition('dismissed', 'open')).toBe(true);
    expect(isAllowedTransition('dismissed', 'planned')).toBe(true);
    expect(isAllowedTransition('dismissed', 'completed')).toBe(false);
    expect(isAllowedTransition('dismissed', 'dismissed')).toBe(false);
  });

  it('completed → open only (reopen)', () => {
    expect(isAllowedTransition('completed', 'open')).toBe(true);
    expect(isAllowedTransition('completed', 'planned')).toBe(false);
    expect(isAllowedTransition('completed', 'dismissed')).toBe(false);
    expect(isAllowedTransition('completed', 'completed')).toBe(false);
  });

  it('maps every terminal state to an event kind', () => {
    expect(EVENT_KIND_FOR_TRANSITION.open).toBe('reopen');
    expect(EVENT_KIND_FOR_TRANSITION.planned).toBe('plan');
    expect(EVENT_KIND_FOR_TRANSITION.dismissed).toBe('dismiss');
    expect(EVENT_KIND_FOR_TRANSITION.completed).toBe('complete');
  });
});
