import { describe, expect, it } from 'vitest';
import {
  AFFECTED_URL_PREVIEW,
  BROKEN_LINK_EVIDENCE_PREVIEW,
  findingMeasurements,
  findingUrlsFromReport,
  toBrowserAuditReport,
} from './report-browser.js';
import type { AuditReport, BrokenLinkEvidenceRow, LocalizedFinding } from './report.service.js';

const urls = (count: number, prefix = 'https://example.com/p') =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`);

const evidence = (count: number): BrokenLinkEvidenceRow[] =>
  Array.from({ length: count }, (_, index) => ({
    source: `https://example.com/s${index}`,
    target: `https://example.com/t${index}`,
    outcome: 'confirmed',
  }) as BrokenLinkEvidenceRow);

function finding(overrides: Partial<LocalizedFinding>): LocalizedFinding {
  return {
    ruleId: 'meta-description-missing',
    bucket: 'fix-now',
    severity: 'medium',
    affectedUrls: [],
    copy: { title: 't', why: 'w', fix: 'f' },
    ...overrides,
  } as LocalizedFinding;
}

function report(findings: LocalizedFinding[], entries: AuditReport['diff']['entries'] = []): AuditReport {
  return {
    runId: 'run-1',
    counts: { fixNow: 1, watch: 0, passed: 0 },
    findings,
    diff: { entries, summary: { fixed: 0, regressed: 0, new: 0, unchanged: 0 } },
    pageSpeed: null,
    indexStatus: null,
    gscSearch: null,
    gscSitemaps: null,
  } as unknown as AuditReport;
}

describe('toBrowserAuditReport', () => {
  it('keeps a preview of each list with exact totals', () => {
    const compact = toBrowserAuditReport(
      report([
        finding({
          ruleId: 'broken-internal-links',
          affectedUrls: urls(12),
          brokenLinkTargets: urls(9, 'https://example.com/t'),
          brokenLinkEvidence: evidence(30),
          meta: { brokenLinkTargets: urls(9), keep: 1 },
        }),
      ]),
    );
    const [only] = compact.findings;
    expect(only?.affectedUrls).toHaveLength(AFFECTED_URL_PREVIEW);
    expect(only?.affectedUrlCount).toBe(12);
    expect(only?.brokenLinkTargets).toHaveLength(AFFECTED_URL_PREVIEW);
    expect(only?.brokenLinkTargetCount).toBe(9);
    expect(only?.brokenLinkEvidence).toHaveLength(BROKEN_LINK_EVIDENCE_PREVIEW);
    expect(only?.brokenLinkEvidenceTotal).toBe(30);
    expect(only?.meta).toEqual({ keep: 1 });
  });

  it('keeps short lists whole, keeps a stored evidence total and plain meta', () => {
    const compact = toBrowserAuditReport(
      report([
        finding({
          ruleId: 'broken-internal-links',
          affectedUrls: urls(2),
          brokenLinkTargets: urls(2),
          brokenLinkEvidence: evidence(3),
          brokenLinkEvidenceTotal: 11,
          meta: { insufficientData: true },
        }),
        finding({ ruleId: 'title-missing-or-weak', affectedUrls: [] }),
      ]),
    );
    const [broken, title] = compact.findings;
    expect(broken?.brokenLinkTargetCount).toBeUndefined();
    expect(broken?.brokenLinkEvidence).toHaveLength(3);
    expect(broken?.brokenLinkEvidenceTotal).toBe(11);
    expect(broken?.meta).toEqual({ insufficientData: true });
    expect(title).not.toHaveProperty('meta');
    expect(title).not.toHaveProperty('brokenLinkTargets');
    expect(title).not.toHaveProperty('brokenLinkEvidence');
    expect(title?.affectedUrlCount).toBe(0);
  });

  it('drops a short evidence list total when nothing was cut', () => {
    const compact = toBrowserAuditReport(
      report([finding({ ruleId: 'broken-internal-links', brokenLinkEvidence: evidence(2) })]),
    );
    expect(compact.findings[0]).not.toHaveProperty('brokenLinkEvidenceTotal');
  });

  it('rolls the diff up per rule and keeps entries for previewed URLs only', () => {
    const affected = urls(8);
    const compact = toBrowserAuditReport(
      report(
        [finding({ affectedUrls: affected })],
        [
          { ruleId: 'meta-description-missing', url: affected[0]!, kind: 'fixed' },
          { ruleId: 'meta-description-missing', url: affected[1]!, kind: 'new' },
          { ruleId: 'meta-description-missing', url: affected[7]!, kind: 'regressed' },
          { ruleId: 'meta-description-missing', url: affected[2]!, kind: 'unchanged' },
          { ruleId: 'title-missing-or-weak', url: '', kind: 'fixed' },
          { ruleId: 'title-missing-or-weak', url: 'https://example.com/gone', kind: 'fixed' },
        ],
      ),
    );
    expect(compact.diff.entries).toEqual([
      { ruleId: 'meta-description-missing', url: '', kind: 'regressed' },
      { ruleId: 'title-missing-or-weak', url: '', kind: 'fixed' },
      { ruleId: 'meta-description-missing', url: affected[0], kind: 'fixed' },
      { ruleId: 'meta-description-missing', url: affected[1], kind: 'new' },
    ]);
    expect(compact.diff.summary).toEqual({ fixed: 0, regressed: 0, new: 0, unchanged: 0 });
  });
});

describe('per-URL measurements', () => {
  it('keeps measurements of the previewed URLs only and skips malformed entries', () => {
    const affected = urls(7);
    const measurements = affected.map((url, index) => ({ url, value: 10 + index, unit: 'characters' as const }));
    const compact = toBrowserAuditReport(
      report([
        finding({
          ruleId: 'thin-content',
          affectedUrls: affected,
          meta: { measurements: [...measurements, { url: 'x', value: '1', unit: 'words' }, null, { url: 'y', value: 1, unit: 'lines' }] },
        }),
      ]),
    );
    expect(compact.findings[0]?.meta).toEqual({ measurements: measurements.slice(0, AFFECTED_URL_PREVIEW) });
  });

  it('reads no measurements from a meta block without a list', () => {
    expect(findingMeasurements(undefined)).toEqual([]);
    expect(findingMeasurements({ measurements: 'nope' })).toEqual([]);
  });
});

describe('deep crawl evidence', () => {
  const affected = urls(7);
  const meta = {
    pages: [...affected.map((url) => ({ url, clickDepth: 6 })), null, { url: 9 }],
    resources: [{ url: affected[0], type: 'image' }, { url: affected[6], type: 'image' }],
    chains: affected.map((url) => ({ from: url, hops: [], isLoop: false })),
    groups: [{ urls: [affected[0], affected[1]] }],
    insecureResources: affected,
    reachedThroughChain: affected,
    evidenceTruncated: 260,
    resourceTotal: 'not-a-list',
  };

  it('leaves the message keys out of the first-screen copy and keeps the text', () => {
    const full = {
      title: 't', why: 'w', fix: 'f', passedLabel: 'p', reason: 'r',
      titleKey: 'k1', whyKey: 'k2', fixKey: 'k3', passedLabelKey: 'k4', reasonKey: 'k5',
    };
    const compact = toBrowserAuditReport(report([finding({ ruleId: 'deep-pages', affectedUrls: affected, copy: full })]));
    expect(compact.findings[0]!.copy).toEqual({ title: 't', why: 'w', fix: 'f', passedLabel: 'p', reason: 'r' });
  });

  it('keeps per-URL rows of the previewed URLs and the first rows of each block', () => {
    const compact = toBrowserAuditReport(report([finding({ ruleId: 'deep-pages', affectedUrls: affected, meta })]));
    const previewed = affected.slice(0, AFFECTED_URL_PREVIEW);
    expect(compact.findings[0]?.meta).toEqual({
      pages: previewed.map((url) => ({ url, clickDepth: 6 })),
      resources: [{ url: affected[0], type: 'image' }],
      chains: meta.chains.slice(0, AFFECTED_URL_PREVIEW),
      groups: meta.groups,
      insecureResources: previewed,
      reachedThroughChain: previewed,
      evidenceTruncated: 260,
      resourceTotal: 'not-a-list',
    });
  });

  it('serves every evidence list in full on the finding-URLs route', () => {
    const payload = findingUrlsFromReport(report([finding({ ruleId: 'deep-pages', affectedUrls: affected, meta })]), 'deep-pages');
    expect(payload?.evidence).toEqual({
      pages: meta.pages,
      resources: meta.resources,
      chains: meta.chains,
      groups: meta.groups,
      insecureResources: meta.insecureResources,
      reachedThroughChain: meta.reachedThroughChain,
    });
  });
});

describe('findingUrlsFromReport', () => {
  it('returns the full lists and the per-URL diff of one rule', () => {
    const affected = urls(7);
    const payload = findingUrlsFromReport(
      report(
        [finding({ affectedUrls: affected, brokenLinkTargets: ['x'], brokenLinkEvidence: evidence(1) })],
        [
          { ruleId: 'meta-description-missing', url: affected[3]!, kind: 'new' },
          { ruleId: 'meta-description-missing', url: affected[4]!, kind: 'unchanged' },
          { ruleId: 'meta-description-missing', url: '', kind: 'fixed' },
          { ruleId: 'other', url: affected[5]!, kind: 'fixed' },
        ],
      ),
      'meta-description-missing',
    );
    expect(payload).toEqual({
      ruleId: 'meta-description-missing',
      affectedUrls: affected,
      brokenLinkTargets: ['x'],
      brokenLinkEvidence: evidence(1),
      measurements: [],
      diff: [{ url: affected[3], kind: 'new' }],
      evidence: {},
    });
  });

  it('returns every measured length of a thin-content finding', () => {
    const affected = urls(7);
    const measurements = affected.map((url, index) => ({ url, value: index, unit: 'words' as const }));
    const payload = findingUrlsFromReport(
      report([finding({ ruleId: 'thin-content', affectedUrls: affected, meta: { measurements } })]),
      'thin-content',
    );
    expect(payload?.measurements).toEqual(measurements);
  });

  it('returns null for a rule the run did not report', () => {
    expect(findingUrlsFromReport(report([finding({})]), 'nope')).toBeNull();
  });
});
