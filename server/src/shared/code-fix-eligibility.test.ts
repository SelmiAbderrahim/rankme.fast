import { describe, expect, it } from 'vitest';
import {
  AUDIT_CODE_FIX_RULE_IDS,
  CONTENT_CODE_FIX_RULE_IDS,
  isAuditCodeFixEligible,
  isContentCodeFixEligible,
} from './code-fix-eligibility.js';

describe('code-fix eligibility', () => {
  it('allows exactly the configured actionable audit rules', () => {
    for (const ruleId of AUDIT_CODE_FIX_RULE_IDS) {
      expect(isAuditCodeFixEligible({ ruleId, bucket: 'fix-now' })).toBe(true);
      expect(isAuditCodeFixEligible({ ruleId, bucket: 'watch', meta: null })).toBe(true);
    }
    expect(isAuditCodeFixEligible({ ruleId: 'thin-content', bucket: 'fix-now' })).toBe(false);
    expect(isAuditCodeFixEligible({ ruleId: AUDIT_CODE_FIX_RULE_IDS[0], bucket: 'passed' })).toBe(false);
  });

  it('rejects insufficient data and rule-engine errors', () => {
    const ruleId = AUDIT_CODE_FIX_RULE_IDS[0];
    expect(isAuditCodeFixEligible({ ruleId, bucket: 'watch', meta: { insufficientData: true } })).toBe(false);
    expect(isAuditCodeFixEligible({ ruleId, bucket: 'watch', meta: { insufficientData: 'no-data' } })).toBe(false);
    expect(isAuditCodeFixEligible({ ruleId, bucket: 'watch', meta: { error: true } })).toBe(false);
    expect(isAuditCodeFixEligible({ ruleId, bucket: 'watch', meta: { insufficientData: false, error: 'warning' } })).toBe(true);
  });

  it('allows exactly the configured Content Intelligence rules', () => {
    for (const ruleId of CONTENT_CODE_FIX_RULE_IDS) {
      expect(isContentCodeFixEligible(ruleId)).toBe(true);
    }
    expect(isContentCodeFixEligible('expand-content')).toBe(false);
  });
});
