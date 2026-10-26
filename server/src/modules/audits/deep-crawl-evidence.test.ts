import { describe, expect, it } from 'vitest';
import { EXPORT_EVIDENCE_MAX_LINES, deepCrawlEvidenceLines } from './deep-crawl-evidence.js';
import { resolveDeepCrawlReasonKey } from './report.service.js';

describe('deepCrawlEvidenceLines', () => {
  it('renders chains, loops, groups and resources as locale-free lines', () => {
    expect(
      deepCrawlEvidenceLines({
        chains: [
          { from: 'https://example.com/a', hops: [{ url: 'https://example.com/b', status: 301 }, { url: 'https://example.com/c', status: 0 }], isLoop: false },
          { from: 'https://example.com/l', hops: [{ url: 'https://example.com/l', status: 302 }], isLoop: true },
        ],
        groups: [
          { urls: ['https://example.com/x', 'https://example.com/y'], similarity: 8 },
          { urls: ['https://example.com/p', 'https://example.com/q'], title: 'Same' },
        ],
        resources: [
          { url: 'https://example.com/a.png', statusCode: 404, sizeBytes: 0, usedOn: ['https://example.com/'] },
          { url: 'https://example.com/b.js', statusCode: null, usedOn: [] },
        ],
      }),
    ).toEqual([
      'https://example.com/a » https://example.com/b (301) » https://example.com/c (?)',
      'https://example.com/l » https://example.com/l (302)',
      '8/10: https://example.com/x · https://example.com/y',
      'https://example.com/p · https://example.com/q',
      'https://example.com/a.png · 404 · 0 B · « https://example.com/',
      'https://example.com/b.js · —',
    ]);
  });

  it('skips malformed rows and returns nothing without structured meta', () => {
    expect(deepCrawlEvidenceLines(undefined)).toEqual([]);
    expect(deepCrawlEvidenceLines({ offenders: [] })).toEqual([]);
    expect(
      deepCrawlEvidenceLines({
        chains: [null, { from: 'x' }, { from: 'https://e.com/', hops: [null, { url: 7 }] }],
        groups: [[], { urls: [] }, 'x'],
        resources: [{}, 'x'],
      }),
    ).toEqual(['https://e.com/']);
  });

  it('neutralizes formula prefixes and bounds the list', () => {
    expect(deepCrawlEvidenceLines({ groups: [{ urls: ['=HYPERLINK("x")'] }] })).toEqual(['\'=HYPERLINK("x")']);
    const many = Array.from({ length: EXPORT_EVIDENCE_MAX_LINES + 5 }, (_, i) => ({ urls: [`https://e.com/${i}`] }));
    expect(deepCrawlEvidenceLines({ groups: many })).toHaveLength(EXPORT_EVIDENCE_MAX_LINES);
    expect(deepCrawlEvidenceLines({ groups: [{ urls: ['x'.repeat(2_000)] }] })[0]).toHaveLength(1_000);
  });
});

describe('resolveDeepCrawlReasonKey', () => {
  it('names the qualifier a deep crawl finding needs, and nothing otherwise', () => {
    expect(resolveDeepCrawlReasonKey('http-error-pages', { refusalsOnly: true })).toBe(
      'auditRules.http-error-pages.reasons.refusalsOnly',
    );
    expect(resolveDeepCrawlReasonKey('http-error-pages', {})).toBeNull();
    expect(resolveDeepCrawlReasonKey('duplicate-content', { unverifiedCount: 2 })).toBe(
      'auditRules.duplicate-content.reasons.partlyVerified',
    );
    expect(resolveDeepCrawlReasonKey('slow-server-response', { unverifiedCount: 1 })).toBe(
      'auditRules.slow-server-response.reasons.partlyVerified',
    );
    expect(resolveDeepCrawlReasonKey('placeholder-text', { unverifiedCount: 1 })).toBeNull();
    expect(resolveDeepCrawlReasonKey('redirect-chains', { chainsNotRead: 'unavailable' })).toBe(
      'auditRules.redirect-chains.reasons.hopsMissing',
    );
    expect(resolveDeepCrawlReasonKey('redirect-chains', { loops: 0 })).toBeNull();
    expect(resolveDeepCrawlReasonKey('redirect-chains', undefined)).toBeNull();
  });
});
