import { describe, expect, it } from 'vitest';
import type { AuditPage } from '../../../shared/providers/index.js';
import { evaluateAllRules } from './index.js';
import { makeAuditResult } from './fixtures.js';

const find = (pages: Partial<AuditPage>[]) =>
  evaluateAllRules(makeAuditResult({ pages })).find((f) => f.ruleId === 'broken-internal-links')!;

describe('broken-internal-links with re-checked targets', () => {
  it('counts each target once by how its re-check went', () => {
    const finding = find([
      {
        url: 'https://example.com/a',
        brokenLinks: ['https://example.com/gone', 'https://example.com/guarded', 'https://example.com/legacy'],
        brokenLinkEvidence: [
          { target: 'https://example.com/pricing', outcome: 'cleared', status: 200, finalUrl: 'https://example.com/en/pricing' },
          { target: 'https://example.com/gone', outcome: 'confirmed', status: 404, failure: 'http_error' },
          { target: 'https://example.com/guarded', outcome: 'unverified', status: 403, failure: 'http_error' },
        ],
      },
      {
        url: 'https://example.com/b',
        brokenLinks: ['https://example.com/gone'],
        brokenLinkEvidence: [{ target: 'https://example.com/gone', outcome: 'confirmed', status: 404, failure: 'http_error' }],
      },
    ]);
    expect(finding.bucket).toBe('fix-now');
    expect(finding.affectedUrls).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(finding.meta).toEqual({
      totalBroken: 4,
      brokenLinkTargets: ['https://example.com/gone', 'https://example.com/guarded', 'https://example.com/legacy'],
      confirmedTargets: 1,
      unverifiedTargets: 1,
      reportedTargets: 1,
      clearedTargets: 1,
    });
  });

  it('passes when every reported target resolved, and says how many were dismissed', () => {
    const finding = find([
      {
        url: 'https://example.com/a',
        brokenLinks: [],
        brokenLinkEvidence: [
          { target: 'https://example.com/pricing', outcome: 'cleared', status: 200 },
          { target: 'https://example.com/features', outcome: 'cleared', status: 200 },
        ],
      },
      {
        url: 'https://example.com/b',
        brokenLinks: [],
        brokenLinkEvidence: [{ target: 'https://example.com/pricing', outcome: 'cleared', status: 200 }],
      },
    ]);
    expect(finding.bucket).toBe('passed');
    expect(finding.affectedUrls).toEqual([]);
    expect(finding.meta).toEqual({ clearedTargets: 2 });
  });

  it('passes with no meta when nothing was ever reported', () => {
    const finding = find([{ url: 'https://example.com/a', brokenLinks: [] }]);
    expect(finding.bucket).toBe('passed');
    expect(finding.meta).toBeUndefined();
  });

  it('treats a target missing from a page evidence list as the crawler verdict', () => {
    const finding = find([
      {
        url: 'https://example.com/a',
        brokenLinks: ['https://example.com/x'],
        brokenLinkEvidence: [{ target: 'https://example.com/other', outcome: 'confirmed', status: 404 }],
      },
    ]);
    expect(finding.meta).toMatchObject({ reportedTargets: 1, confirmedTargets: 0 });
  });

  it('drops to watch when every remaining target was only an inconclusive re-check', () => {
    const finding = find([
      {
        url: 'https://example.com/a',
        brokenLinks: ['https://example.com/guarded', 'https://example.com/slow'],
        brokenLinkEvidence: [
          { target: 'https://example.com/guarded', outcome: 'unverified', status: 403, failure: 'http_error' },
          { target: 'https://example.com/slow', outcome: 'unverified', status: null, failure: 'timeout' },
        ],
      },
    ]);
    expect(finding.bucket).toBe('watch');
    expect(finding.severity).toBe('warning');
    expect(finding.affectedUrls).toEqual(['https://example.com/a']);
    expect(finding.meta).toMatchObject({ unverifiedTargets: 2, confirmedTargets: 0 });
  });

  it('keeps fix-now for a page with an unverified target the check never reached', () => {
    const finding = find([
      {
        url: 'https://example.com/a',
        brokenLinks: ['https://example.com/unreached'],
        brokenLinkEvidence: [{ target: 'https://example.com/unreached', outcome: 'unverified', status: null }],
      },
      {
        url: 'https://example.com/b',
        brokenLinks: ['https://example.com/guarded'],
        brokenLinkEvidence: [{ target: 'https://example.com/guarded', outcome: 'unverified', status: 403, failure: 'http_error' }],
      },
    ]);
    expect(finding.bucket).toBe('fix-now');
    expect(finding.affectedUrls).toEqual(['https://example.com/a']);
  });
});
