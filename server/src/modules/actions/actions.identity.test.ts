import { describe, expect, it } from 'vitest';
import {
  buildSourceLink,
  hashActionId,
  hashSourceIdRef,
  legacyAuditActionId,
} from './actions.identity.js';

describe('hashActionId', () => {
  it('produces 64-char hex', () => {
    const id = hashActionId({
      accountId: 'acc1',
      siteId: 'site1',
      sourceType: 'audit_finding',
      sourceId: 'run1:missing-h1',
    });
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs across accounts, sites, sources', () => {
    const base = {
      accountId: 'a',
      siteId: 's',
      sourceType: 'audit_finding' as const,
      sourceId: 'r:x',
    };
    const original = hashActionId(base);
    expect(hashActionId({ ...base, accountId: 'b' })).not.toBe(original);
    expect(hashActionId({ ...base, siteId: 't' })).not.toBe(original);
    expect(
      hashActionId({ ...base, sourceType: 'confirmed_rank_drop' }),
    ).not.toBe(original);
    expect(hashActionId({ ...base, sourceId: 'r:y' })).not.toBe(original);
  });

  it('is deterministic across calls', () => {
    const input = {
      accountId: 'acc',
      siteId: 'site',
      sourceType: 'gsc_decline' as const,
      sourceId: 'x:2026-01-01:2025-12-05:clicks',
    };
    expect(hashActionId(input)).toBe(hashActionId(input));
  });
});

describe('hashSourceIdRef', () => {
  it('is account-scoped', () => {
    const a = hashSourceIdRef({
      accountId: 'a',
      sourceType: 'audit_finding',
      sourceId: 'r:x',
    });
    const b = hashSourceIdRef({
      accountId: 'b',
      sourceType: 'audit_finding',
      sourceId: 'r:x',
    });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('buildSourceLink', () => {
  it('routes audit findings to the exact rule on the site report', () => {
    expect(buildSourceLink('audit_finding', 'site1', 'missing-h1')).toBe(
      '/sites/site1/report?finding=missing-h1',
    );
  });

  it('routes confirmed rank drops', () => {
    expect(buildSourceLink('confirmed_rank_drop', 'site1', 'drop1')).toBe(
      '/sites/site1/ranks/drops/drop1',
    );
  });

  it('routes GSC declines', () => {
    expect(
      buildSourceLink('gsc_decline', 'site1', 'dim:2026-01-01:2025-12-05:clicks'),
    ).toContain('/sites/site1/gsc/declines/');
  });

  it('routes GA4 declines', () => {
    expect(buildSourceLink('ga4_decline', 'site1', 'x')).toBe(
      '/sites/site1/ga4/declines/x',
    );
  });

  it('routes content recommendations to the analysis + recommendation path', () => {
    expect(
      buildSourceLink('content_recommendation', 'site1', 'analysis1:rec1'),
    ).toBe('/sites/site1/content-intelligence/analysis1/recommendations/rec1');
  });

  it('routes citation gaps', () => {
    expect(buildSourceLink('citation_gap', 'site1', 'gap1')).toBe(
      '/sites/site1/content-intelligence/citation-gaps/gap1',
    );
  });

  it('routes audience research signals', () => {
    expect(buildSourceLink('audience_research', 'site1', 'sig1')).toBe(
      '/sites/site1/audience-research/sig1',
    );
  });

  it('percent-encodes unsafe segments', () => {
    expect(
      buildSourceLink('confirmed_rank_drop', 'site 1', 'drop/one'),
    ).toBe('/sites/site%201/ranks/drops/drop%2Fone');
  });
});

describe('buildSourceLink on malformed composite source ids', () => {
  it('keeps malformed audit rule ids contained in the query value', () => {
    expect(buildSourceLink('audit_finding', 'site1', '')).toBe(
      '/sites/site1/report?finding=',
    );
    expect(buildSourceLink('audit_finding', 'site1', 'rule1:extra')).toBe(
      '/sites/site1/report?finding=rule1%3Aextra',
    );
  });

  it('renders an empty recommendation segment when the content id carries no colon', () => {
    expect(
      buildSourceLink('content_recommendation', 'site1', 'analysis1'),
    ).toBe('/sites/site1/content-intelligence/analysis1/recommendations/');
  });

  it('renders an empty analysis segment for an empty content source id', () => {
    expect(buildSourceLink('content_recommendation', 'site1', '')).toBe(
      '/sites/site1/content-intelligence//recommendations/',
    );
  });

  it('keeps only the first two segments of an over-long content source id', () => {
    expect(
      buildSourceLink('content_recommendation', 'site1', 'a1:rec1:extra'),
    ).toBe('/sites/site1/content-intelligence/a1/recommendations/rec1');
  });
});

describe('legacyAuditActionId', () => {
  const base = {
    accountId: 'account',
    siteId: 'site',
    sourceType: 'audit_finding' as const,
    sourceId: 'missing-h1',
  };

  it('reconstructs the former run-scoped audit id from its evidence ref', () => {
    const sourceRef = '507f191e810c19729de860ea:missing-h1';
    expect(legacyAuditActionId({ ...base, sourceRef })).toBe(
      hashActionId({ ...base, sourceId: sourceRef }),
    );
  });

  it('rejects non-audit and malformed evidence refs', () => {
    expect(legacyAuditActionId(base)).toBeNull();
    expect(
      legacyAuditActionId({
        ...base,
        sourceRef: '507f191e810c19729de860ea:another-rule',
      }),
    ).toBeNull();
    expect(
      legacyAuditActionId({ ...base, sourceRef: 'bad:missing-h1' }),
    ).toBeNull();
    expect(
      legacyAuditActionId({
        ...base,
        sourceType: 'confirmed_rank_drop',
        sourceRef: '507f191e810c19729de860ea:missing-h1',
      }),
    ).toBeNull();
  });
});
