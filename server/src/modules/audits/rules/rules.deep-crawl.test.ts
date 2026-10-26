/**
 * Deep crawl rules — evidence shapes and the branches
 * the pass/fail meta-test in `rules.test.ts` does not reach.
 */
import { describe, expect, it } from 'vitest';
import type { AuditResource } from '../../../shared/providers/index.js';
import { MAX_EVIDENCE_ROWS, evaluatePageChecks, missingSignalMeta, pageFacts, servedIndexable } from './deep-crawl.js';
import { checksWith, makeAuditPage, makeAuditResult, makeLegacyAuditResult } from './fixtures.js';
import { RULE_CATEGORIES, RULE_CATEGORY, RULE_IDS, bucketFor, categoryOf, evaluateAllRules, isNotEvaluatedFinding, type RuleFinding, type RuleId } from './index.js';
import { DEEP_CLICK_DEPTH } from './deep-pages.js';
import { OVERSIZED_IMAGE_BYTES } from './oversized-images.js';

const finding = (ruleId: RuleId, input: Parameters<typeof makeAuditResult>[0]): RuleFinding => {
  const found = evaluateAllRules(makeAuditResult(input)).find((f) => f.ruleId === ruleId);
  if (!found) throw new Error(`no finding for ${ruleId}`);
  return found;
};

const resource = (overrides: Partial<AuditResource>): AuditResource => ({
  url: 'https://example.com/img/a.png',
  type: 'image',
  statusCode: 200,
  isBroken: false,
  usedOn: [],
  ...overrides,
});

describe('deep-crawl helpers', () => {
  it('servedIndexable keeps only indexable 2xx pages', () => {
    expect(servedIndexable(makeAuditPage())).toBe(true);
    expect(servedIndexable(makeAuditPage({ isIndexable: false }))).toBe(false);
    expect(servedIndexable(makeAuditPage({ statusCode: 301 }))).toBe(false);
  });

  it('pageFacts copies only reported facts', () => {
    expect(pageFacts(makeAuditPage({ pageSizeBytes: 10 }), ['pageSizeBytes', 'transferSizeBytes'])).toEqual({ pageSizeBytes: 10 });
  });

  it('missingSignalMeta without a signal name ignores failures of other reads', () => {
    const result = makeAuditResult({ deep: { unavailableSignals: [{ signal: 'waterfall', cause: 'budget' }] } });
    expect(missingSignalMeta(result)).toEqual({ insufficientData: true, reason: 'no-crawl-signal' });
  });

  it('evaluatePageChecks passes when nothing is in scope', () => {
    const result = makeAuditResult({ pages: [{ isIndexable: false }] });
    expect(evaluatePageChecks(result, { id: 'favicon-missing', severity: 'info', checks: ['missingFavicon'] })).toEqual({
      ruleId: 'favicon-missing',
      bucket: 'passed',
      severity: 'info',
      affectedUrls: [],
    });
  });

  it('bounds the evidence rows and records what was cut; affectedUrls stays complete', () => {
    const pages = Array.from({ length: MAX_EVIDENCE_ROWS + 3 }, (_, i) => ({
      url: `https://example.com/p${i}`,
      checks: checksWith({ missingFavicon: true }),
    }));
    const found = finding('favicon-missing', { pages });
    expect(found.affectedUrls).toHaveLength(MAX_EVIDENCE_ROWS + 3);
    expect(found.meta!.pages).toHaveLength(MAX_EVIDENCE_ROWS);
    expect(found.meta!.evidenceTruncated).toBe(MAX_EVIDENCE_ROWS + 3);
  });

  it('a fix-now policy without its own severity keeps the rule severity', () => {
    const result = makeAuditResult({ pages: [{ checks: checksWith({ missingFavicon: true }) }] });
    expect(
      evaluatePageChecks(result, {
        id: 'favicon-missing',
        severity: 'info',
        checks: ['missingFavicon'],
        fixNowWhen: () => true,
      }),
    ).toMatchObject({ bucket: 'fix-now', severity: 'info' });
  });
});

describe('http-error-pages', () => {
  it('lists server errors first and counts both classes', () => {
    const found = finding('http-error-pages', {
      pages: [
        { url: 'https://example.com/b', statusCode: 404 },
        { url: 'https://example.com/a', statusCode: 404 },
        { url: 'https://example.com/c', statusCode: 500 },
      ],
    });
    expect(found.affectedUrls).toEqual(['https://example.com/c', 'https://example.com/a', 'https://example.com/b']);
    expect(found.meta).toMatchObject({ serverErrors: 1, clientErrors: 2 });
    expect(found.meta).not.toHaveProperty('refusalsOnly');
  });

  it('refusals alone (bot protection) are a watch warning, not a fix-now', () => {
    const found = finding('http-error-pages', {
      pages: [{}, { url: 'https://example.com/members', statusCode: 403 }, { url: 'https://example.com/api', statusCode: 429 }],
    });
    expect(found).toMatchObject({ bucket: 'watch', severity: 'warning', meta: { refusalsOnly: true } });
  });
});

describe('redirect-chains', () => {
  const chain = { from: 'https://example.com/a', hops: [{ url: 'https://example.com/b', status: 301 }, { url: 'https://example.com/c', status: 200 }], isLoop: false };

  it('a loop is fix-now critical; a single hop that is not a loop is ignored', () => {
    const found = finding('redirect-chains', {
      deep: {
        redirectChains: [
          chain,
          { from: 'https://example.com/x', hops: [{ url: 'https://example.com/y', status: 301 }], isLoop: false },
          { from: 'https://example.com/l', hops: [{ url: 'https://example.com/l', status: 302 }], isLoop: true },
        ],
      },
    });
    expect(found).toMatchObject({ bucket: 'fix-now', severity: 'critical', affectedUrls: ['https://example.com/a', 'https://example.com/l'] });
    expect(found.meta).toMatchObject({ loops: 1 });
    expect(found.meta!.chains).toHaveLength(2);
  });

  it('adds flagged pages the chain read did not cover, and says when the read is missing', () => {
    const covered = finding('redirect-chains', {
      pages: [{ url: 'https://example.com/c', checks: checksWith({ reachedThroughRedirectChain: true }) }],
      deep: { redirectChains: [chain] },
    });
    expect(covered.affectedUrls).toEqual(['https://example.com/a']);
    expect(covered.meta).not.toHaveProperty('reachedThroughChain');

    const failedRead = finding('redirect-chains', {
      pages: [{ url: 'https://example.com/z', checks: checksWith({ reachedThroughRedirectChain: true }) }],
      deep: { redirectChains: undefined, unavailableSignals: [{ signal: 'redirect-chains', cause: 'vendor-error' }] },
    });
    expect(failedRead).toMatchObject({ bucket: 'watch', affectedUrls: ['https://example.com/z'] });
    expect(failedRead.meta).toMatchObject({ reachedThroughChain: ['https://example.com/z'], chainsNotRead: 'unavailable', chains: [] });
  });

  it('a missing read with clean page flags is a pass on the flags', () => {
    expect(finding('redirect-chains', { deep: { redirectChains: undefined } }).bucket).toBe('passed');
  });
});

describe('deep-pages', () => {
  it('lists the deepest first, with the threshold', () => {
    const found = finding('deep-pages', {
      pages: [
        { url: 'https://example.com/b', clickDepth: DEEP_CLICK_DEPTH + 1 },
        { url: 'https://example.com/a', clickDepth: DEEP_CLICK_DEPTH + 1 },
        { url: 'https://example.com/c', clickDepth: DEEP_CLICK_DEPTH + 4 },
        { url: 'https://example.com/d', clickDepth: DEEP_CLICK_DEPTH },
      ],
    });
    expect(found.affectedUrls).toEqual(['https://example.com/c', 'https://example.com/a', 'https://example.com/b']);
    expect(found.meta).toMatchObject({ threshold: DEEP_CLICK_DEPTH });
  });
});

describe('duplicate-titles', () => {
  it('drops group members that are not indexable, and groups that shrink below two', () => {
    const found = finding('duplicate-titles', {
      pages: [{}, { url: 'https://example.com/b', isIndexable: false }],
      deep: { duplicateGroups: [{ kind: 'title', urls: ['https://example.com/', 'https://example.com/b'] }, { kind: 'description', urls: ['https://example.com/', 'https://example.com/c'] }] },
    });
    expect(found.bucket).toBe('passed');
  });

  it('without the tag read, groups flagged pages by their own title', () => {
    const found = finding('duplicate-titles', {
      pages: [
        { url: 'https://example.com/a', title: ' Same ', checks: checksWith({ duplicateTitle: true }) },
        { url: 'https://example.com/b', title: 'Same', checks: checksWith({ duplicateTitle: true }) },
        { url: 'https://example.com/c', title: null, checks: checksWith({ duplicateTitle: true }) },
        { url: 'https://example.com/d', checks: undefined },
        { url: 'https://example.com/e' },
      ],
      deep: { duplicateGroups: undefined },
    });
    expect(found.meta!.groups).toEqual([
      { title: 'Same', urls: ['https://example.com/a', 'https://example.com/b'] },
      { title: null, urls: ['https://example.com/c'] },
    ]);
  });

  it('a failed tag read falls back to the page flags even when content groups exist', () => {
    const found = finding('duplicate-titles', {
      pages: [
        { url: 'https://example.com/a', title: 'Same', checks: checksWith({ duplicateTitle: true }) },
        { url: 'https://example.com/b', title: 'Same', checks: checksWith({ duplicateTitle: true }) },
      ],
      deep: {
        duplicateGroups: [{ kind: 'content', urls: ['https://example.com/a', 'https://example.com/b'], similarity: 7 }],
        unavailableSignals: [{ signal: 'duplicate-tags', cause: 'vendor-error' }],
      },
    });
    expect(found).toMatchObject({ bucket: 'watch', affectedUrls: ['https://example.com/a', 'https://example.com/b'] });
  });

  it('keeps the title of the first page in a vendor group', () => {
    const found = finding('duplicate-titles', {
      pages: [{ title: 'Widgets' }, { url: 'https://example.com/b', title: 'Widgets' }],
      deep: { duplicateGroups: [{ kind: 'title', urls: ['https://example.com/', 'https://example.com/b'] }] },
    });
    expect(found.meta!.groups).toEqual([{ title: 'Widgets', urls: ['https://example.com/', 'https://example.com/b'] }]);
  });
});

describe('duplicate-content', () => {
  it('counts flagged pages the per-page read did not reach', () => {
    const found = finding('duplicate-content', {
      pages: [{ checks: checksWith({ duplicateContent: true }) }],
      deep: { unverified: { duplicateContent: 3 } },
    });
    expect(found.meta).toEqual({ groups: [], unverifiedCount: 3 });
  });

  it('a group alone answers even when no page reports the flag', () => {
    const found = finding('duplicate-content', {
      pages: [{ checks: undefined }, { url: 'https://example.com/b', checks: undefined }],
      deep: { duplicateGroups: [{ kind: 'content', urls: ['https://example.com/', 'https://example.com/b', 'https://example.com/gone'], similarity: 9 }] },
    });
    expect(found).toMatchObject({ bucket: 'watch', affectedUrls: ['https://example.com/', 'https://example.com/b'] });
  });
});

describe('slow-server-response', () => {
  it('carries the measured times and the unverified count', () => {
    const found = finding('slow-server-response', {
      pages: [
        { checks: checksWith({ slowLoad: true }), timing: { fetchMs: 3_200 } },
        { url: 'https://example.com/b', checks: checksWith({ slowServerResponse: true }), serverResponseMs: 1_900 },
      ],
      deep: { unverified: { slowPages: 2 } },
    });
    expect(found.meta).toEqual({
      pages: [
        { url: 'https://example.com/', problems: ['slowLoad'], fetchMs: 3_200 },
        { url: 'https://example.com/b', problems: ['slowServerResponse'], serverResponseMs: 1_900 },
      ],
      unverifiedCount: 2,
    });
  });
});

describe('mixed-content', () => {
  it('ignores HTTP pages and lists insecure resources the flagged pages load', () => {
    const found = finding('mixed-content', {
      pages: [
        { checks: checksWith({ insecureLinks: true }) },
        { url: 'http://example.com/plain', checks: checksWith({ insecureLinks: true }) },
      ],
      deep: {
        resources: [
          resource({ url: 'http://cdn.example.com/a.js', type: 'script', usedOn: ['https://example.com/'] }),
          resource({ url: 'http://cdn.example.com/b.js', type: 'script', usedOn: ['https://example.com/other'] }),
          resource({ url: 'https://cdn.example.com/c.js', type: 'script', usedOn: ['https://example.com/'] }),
        ],
      },
    });
    expect(found.affectedUrls).toEqual(['https://example.com/']);
    expect(found.meta).toMatchObject({ insecureResources: ['http://cdn.example.com/a.js'] });
  });

  it('without the resource scan the evidence is the page list alone', () => {
    const found = finding('mixed-content', {
      pages: [{ checks: checksWith({ insecureLinks: true }) }],
      deep: { resources: undefined, capabilities: { resourceScan: false } },
    });
    expect(found.meta).not.toHaveProperty('insecureResources');
  });
});

describe('large-pages', () => {
  it('a page over 3 MB escalates the finding to fix-now', () => {
    const found = finding('large-pages', {
      pages: [{ checks: checksWith({ largePage: true, veryLargePage: true }), pageSizeBytes: 3_400_000 }],
    });
    expect(found).toMatchObject({ bucket: 'fix-now', severity: 'warning' });
  });
});

describe('meta-description-missing and title-missing-or-weak gain crawler evidence only', () => {
  it('meta-description-missing lists the crawler duplicate groups among indexable pages', () => {
    const found = finding('meta-description-missing', {
      pages: [{ metaDescription: null }, { url: 'https://example.com/b' }, { url: 'https://example.com/c', isIndexable: false }],
      deep: {
        duplicateGroups: [
          { kind: 'description', urls: ['https://example.com/', 'https://example.com/b'] },
          { kind: 'description', urls: ['https://example.com/', 'https://example.com/c'] },
          { kind: 'title', urls: ['https://example.com/', 'https://example.com/b'] },
        ],
      },
    });
    expect(found.bucket).toBe('watch');
    expect(found.meta).toMatchObject({ crawlerDuplicateGroups: [['https://example.com/', 'https://example.com/b']] });
  });

  it('meta-description-missing without crawler groups keeps its old meta', () => {
    const found = finding('meta-description-missing', { pages: [{ metaDescription: null }], deep: { duplicateGroups: undefined } });
    expect(found.meta).toEqual({ missing: ['https://example.com/'], duplicateGroups: [] });
  });

  it('title-missing-or-weak counts the crawler length checks', () => {
    const found = finding('title-missing-or-weak', {
      pages: [
        { title: 'x'.repeat(70), checks: checksWith({ titleTooLong: true }) },
        { url: 'https://example.com/b', title: 'Short', checks: checksWith({ titleTooShort: true }) },
        { url: 'https://example.com/c', isIndexable: false, checks: checksWith({ titleTooShort: true }) },
      ],
    });
    expect(found.bucket).toBe('watch');
    expect(found.meta).toMatchObject({ crawlerLengthChecks: { tooLong: 1, tooShort: 1 } });
  });

  it('title-missing-or-weak without crawler checks keeps its old meta', () => {
    const found = finding('title-missing-or-weak', { pages: [{ title: null, checks: undefined }] });
    expect(found.meta).toEqual({ offenders: [{ url: 'https://example.com/', reason: 'missing' }] });
  });
});

describe('paid resource scan rules', () => {
  it('does not report successful assets as broken even in older stored results (issue #54)', () => {
    const found = finding('broken-resources', {
      deep: { resources: [
        resource({ type: 'script', statusCode: 200, isBroken: true }),
        resource({ url: 'https://example.com/app.css', type: 'stylesheet', statusCode: 200, isBroken: true }),
      ] },
    });
    expect(found.bucket).toBe('passed');
    expect(found.affectedUrls).toEqual([]);
  });

  it('broken-resources keeps the evidence fields it has and the vendor total', () => {
    const found = finding('broken-resources', {
      deep: {
        resources: [
          resource({ statusCode: 404, isBroken: true, sizeBytes: 0, usedOn: ['https://example.com/'], usedOnCount: 1 }),
          resource({ url: 'https://example.com/x.css', type: 'stylesheet', statusCode: null, isBroken: true }),
        ],
        resourceTotal: 900,
      },
    });
    expect(found.meta).toEqual({
      resources: [
        { url: 'https://example.com/img/a.png', type: 'image', statusCode: 404, sizeBytes: 0, usedOn: ['https://example.com/'], usedOnCount: 1 },
        { url: 'https://example.com/x.css', type: 'stylesheet', statusCode: null, usedOn: [] },
      ],
      resourceTotal: 900,
    });
  });

  it('oversized-images: images only, largest first, unsized and broken ones skipped', () => {
    const found = finding('oversized-images', {
      deep: {
        resources: [
          resource({ url: 'https://example.com/a.jpg', sizeBytes: OVERSIZED_IMAGE_BYTES + 1 }),
          resource({ url: 'https://example.com/b.jpg', sizeBytes: OVERSIZED_IMAGE_BYTES * 3 }),
          resource({ url: 'https://example.com/c.jpg' }),
          resource({ url: 'https://example.com/d.jpg', sizeBytes: OVERSIZED_IMAGE_BYTES * 9, isBroken: true }),
          resource({ url: 'https://example.com/e.js', type: 'script', sizeBytes: OVERSIZED_IMAGE_BYTES * 9 }),
        ],
      },
    });
    expect(found.affectedUrls).toEqual(['https://example.com/b.jpg', 'https://example.com/a.jpg']);
    expect(found.meta).toMatchObject({ threshold: OVERSIZED_IMAGE_BYTES });
  });

  it('uncached-static-resources ignores unknown cache answers, other types and broken rows', () => {
    const found = finding('uncached-static-resources', {
      deep: {
        resources: [
          resource({ url: 'https://example.com/a.js', type: 'script', cacheable: false }),
          resource({ url: 'https://example.com/b.js', type: 'script' }),
          resource({ url: 'https://example.com/font.woff', type: 'other', cacheable: false }),
          resource({ url: 'https://example.com/c.png', cacheable: false, isBroken: true }),
        ],
      },
    });
    expect(found.affectedUrls).toEqual(['https://example.com/a.js']);
  });

  it('a clean scan passes all three', () => {
    for (const id of ['broken-resources', 'oversized-images', 'uncached-static-resources'] as const) {
      expect(finding(id, { deep: { resources: [resource({ cacheable: true })] } }).bucket, id).toBe('passed');
    }
  });
});

describe('report categories', () => {
  it('every rule id has exactly one known category', () => {
    expect(Object.keys(RULE_CATEGORY).sort()).toEqual([...RULE_IDS].sort());
    for (const id of RULE_IDS) expect(RULE_CATEGORIES).toContain(RULE_CATEGORY[id]);
  });

  it('every category holds at least one rule', () => {
    for (const category of RULE_CATEGORIES) expect(Object.values(RULE_CATEGORY)).toContain(category);
  });

  it('categoryOf tolerates stored ids this release does not know', () => {
    expect(categoryOf('placeholder-text')).toBe('content');
    expect(categoryOf('retired-rule')).toBeNull();
    expect(categoryOf('toString')).toBeNull();
  });
});

describe('deep crawl signals: absent, scan turned off, failed', () => {
  const CHECK_RULES = [
    'links-to-redirects', 'meta-refresh-redirect', 'canonical-chain-or-conflict', 'orphan-pages', 'deep-pages',
    'duplicate-content', 'placeholder-text', 'mixed-content', 'images-missing-alt', 'slow-server-response',
    'large-pages', 'uncompressed-pages', 'render-blocking-resources', 'html-basics-missing', 'deprecated-html',
    'url-structure', 'social-tags-missing', 'favicon-missing',
  ] as const;
  const READ_RULES = ['redirect-chains', 'duplicate-titles'] as const;
  const SCAN_RULES = ['broken-resources', 'oversized-images', 'uncached-static-resources'] as const;
  const findingsOf = (result: ReturnType<typeof makeAuditResult>) =>
    new Map(evaluateAllRules(result).map((entry) => [entry.ruleId, entry]));

  it('a legacy result (no checks, no reads, no capabilities) is not evaluated with legacy-run', () => {
    const findings = findingsOf(makeLegacyAuditResult());
    for (const id of [...CHECK_RULES, ...READ_RULES, ...SCAN_RULES]) {
      expect(findings.get(id)!.meta, id).toMatchObject({ insufficientData: true, reason: 'legacy-run' });
      expect(isNotEvaluatedFinding(findings.get(id)!), id).toBe(true);
    }
    // Status codes are always known, so this one still answers.
    expect(findings.get('http-error-pages')!.bucket).toBe('passed');
  });

  it('a crawl that reported no checks is not evaluated with no-crawl-signal', () => {
    const findings = findingsOf(makeAuditResult({
      pages: [{ checks: undefined, clickDepth: undefined, socialTags: undefined }],
      deep: { duplicateGroups: undefined, redirectChains: undefined },
    }));
    for (const id of [...CHECK_RULES, ...READ_RULES]) {
      expect(findings.get(id)!.meta, id).toMatchObject({ reason: 'no-crawl-signal' });
    }
  });

  it('with the resource scan turned off the resource checks are not evaluated, never passed', () => {
    const findings = findingsOf(makeAuditResult({ deep: { capabilities: { resourceScan: false }, resources: undefined } }));
    for (const id of SCAN_RULES) {
      expect(findings.get(id)!.meta).toEqual({ insufficientData: true, reason: 'scan-off' });
    }
  });

  it('a failed read is unavailable with its cause', () => {
    const findings = findingsOf(makeAuditResult({
      pages: [{ checks: undefined }],
      deep: {
        redirectChains: undefined,
        duplicateGroups: undefined,
        resources: undefined,
        unavailableSignals: [
          { signal: 'redirect-chains', cause: 'vendor-error' },
          { signal: 'duplicate-tags', cause: 'budget' },
          { signal: 'resources', cause: 'vendor-error' },
        ],
      },
    }));
    expect(findings.get('redirect-chains')!.meta).toEqual({ insufficientData: true, reason: 'unavailable', cause: 'vendor-error' });
    expect(findings.get('duplicate-titles')!.meta).toEqual({ insufficientData: true, reason: 'unavailable', cause: 'budget' });
    expect(findings.get('broken-resources')!.meta).toEqual({ insufficientData: true, reason: 'unavailable', cause: 'vendor-error' });
  });

  it('bucketFor sends a warning to fix-now only when the rule asks for it', () => {
    expect(bucketFor('warning', false)).toBe('watch');
    expect(bucketFor('warning', false, { fixNow: true })).toBe('fix-now');
    expect(bucketFor('warning', true, { fixNow: true })).toBe('passed');
  });
});
