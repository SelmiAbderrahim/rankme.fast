import { describe, expect, it } from 'vitest';
import { buildBrokenLinkEvidenceCsv, buildFindingUrlsCsv } from './urlsCsv';

describe('buildFindingUrlsCsv', () => {
  it('lists broken targets, then the pages linking to them', () => {
    const csv = buildFindingUrlsCsv({
      ruleId: 'broken-internal-links',
      affectedUrls: ['https://example.com/a'],
      brokenLinkTargets: ['https://example.com/en/privacy'],
    });
    expect(csv.replace(/^\uFEFF/, '').split('\r\n')).toEqual([
      'rule_id,url_role,url',
      'broken-internal-links,broken_target,https://example.com/en/privacy',
      'broken-internal-links,links_to_broken_target,https://example.com/a',
      '',
    ]);
  });

  it('labels plain affected pages and neutralizes formula-like cells', () => {
    const csv = buildFindingUrlsCsv({
      ruleId: 'thin-content',
      affectedUrls: ['https://example.com/x', '=HYPERLINK("evil")'],
    });
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[1]).toBe('thin-content,affected_page,https://example.com/x');
    expect(lines[2]).toBe('thin-content,affected_page,"\'=HYPERLINK(""evil"")"');
  });
});

describe('buildBrokenLinkEvidenceCsv', () => {
  it('writes every source → target pair, dismissed rows included, with status, failure, and final address', () => {
    const csv = buildBrokenLinkEvidenceCsv({
      ruleId: 'broken-internal-links',
      brokenLinkEvidence: [
        { source: 'https://example.com/a', target: 'https://example.com/gone', outcome: 'confirmed', status: 404, failure: 'http_error' },
        { source: 'https://example.com/a', target: 'https://example.com/loop', outcome: 'confirmed', status: null, failure: 'redirect_loop' },
        { source: 'https://example.com/b', target: 'https://example.com/pricing', outcome: 'cleared', status: 200, finalUrl: 'https://example.com/en/pricing' },
        { source: 'https://example.com/b', target: 'https://example.com/old', outcome: 'reported', status: null },
      ],
    });
    expect(csv.replace(/^\uFEFF/, '').split('\r\n')).toEqual([
      'rule_id,source_url,target_url,recheck_result,http_status,failure,final_url',
      'broken-internal-links,https://example.com/a,https://example.com/gone,confirmed,404,http_error,',
      'broken-internal-links,https://example.com/a,https://example.com/loop,confirmed,,redirect_loop,',
      'broken-internal-links,https://example.com/b,https://example.com/pricing,cleared,200,,https://example.com/en/pricing',
      'broken-internal-links,https://example.com/b,https://example.com/old,reported,,,',
      '',
    ]);
  });

  it('neutralizes formula-like cells and writes only a header without evidence', () => {
    const lines = buildBrokenLinkEvidenceCsv({
      ruleId: 'broken-internal-links',
      brokenLinkEvidence: [{ source: '=cmd()', target: '@x', outcome: 'confirmed', status: 500 }],
    })
      .replace(/^\uFEFF/, '')
      .split('\r\n');
    expect(lines[1]).toBe("broken-internal-links,'=cmd(),'@x,confirmed,500,,");
    expect(buildBrokenLinkEvidenceCsv({ ruleId: 'x' }).replace(/^\uFEFF/, '')).toBe(
      'rule_id,source_url,target_url,recheck_result,http_status,failure,final_url\r\n',
    );
  });
});
