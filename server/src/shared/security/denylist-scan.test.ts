import { describe, expect, it } from 'vitest';
import { assertSecurityCleanPayload } from '../testing/security/assertions.js';
import {
  ForbiddenOutputError,
  assertNoForbidden,
  scanForForbidden,
} from './denylist-scan.js';

describe('scanForForbidden', () => {
  it.each([
    ['apiKey', 'secret-key'],
    ['apiKeys', 'secret-key'],
    ['fallbackApiKeys', 'secret-key'],
    ['FIRECRAWL_API_KEY', 'secret-key'],
    ['FIRECRAWL_FALLBACK_API_KEYS', 'secret-key'],
    ['openaiApiKey', 'secret-key'],
    ['dataForSeoPassword', 'secret-key'],
    ['firecrawlWebhookSecret', 'secret-key'],
    ['authorization', 'secret-key'],
    ['password', 'secret-key'],
  ])('detects secret-name key %s', (key, reason) => {
    expect(scanForForbidden({ [key]: 'short' })).toContainEqual({ path: `$.${key}`, reason });
  });

  it.each([
    ['Bearer abc', 'authorization-material'],
    ['Basic YWJjOmRlZg==', 'authorization-material'],
    ['rmf_public-looking-key', 'authorization-material'],
    ['0123456789abcdef0123456789abcdef', 'high-entropy-secret'],
    ['AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/', 'high-entropy-secret'],
  ])('detects forbidden value shape', (value, reason) => {
    expect(scanForForbidden({ value })).toContainEqual({ path: '$.value', reason });
  });

  it.each(['<script>alert(1)</script>', '<iframe src=x>', '<img onerror=alert(1)>', '<!doctype html>'])(
    'detects raw HTML marker %s',
    (value) => {
      expect(scanForForbidden([value])).toContainEqual({ path: '$[0]', reason: 'raw-html' });
    },
  );

  it('detects default and configurable prompt/completion fields', () => {
    expect(scanForForbidden({ prompt: 'safe words' })).toContainEqual({
      path: '$.prompt',
      reason: 'prompt-or-completion-field',
    });
    expect(scanForForbidden({ transcript: 'safe words' }, { promptFieldNames: ['transcript'] })).toContainEqual({
      path: '$.transcript',
      reason: 'prompt-or-completion-field',
    });
  });

  it.each([
    'brandQuery',
    'brand_query',
    'mentionSnippet',
    'reviewText',
    'reviewTitle',
    'keywords',
    'keywordList',
    'relatedQueries',
    'digestText',
    'digestSentenceText',
    'themeExcerpt',
  ])('detects evidence-content field %s', (key) => {
    expect(scanForForbidden({ [key]: 'hostile planted evidence' })).toContainEqual({
      path: `$.${key}`,
      reason: 'evidence-content-field',
    });
  });

  it('supports additional evidence field names', () => {
    expect(
      scanForForbidden(
        { sourceExcerpt: 'planted', checkoutReference: 'planted' },
        {
          evidenceFieldNames: ['sourceExcerpt'],
        },
      ),
    ).toEqual([
      { path: '$.sourceExcerpt', reason: 'evidence-content-field' },
    ]);
  });

  it('allows an approved evidence container while still scanning its nested values', () => {
    expect(
      scanForForbidden(
        { keywords: [{ phrase: 'safe query', authorization: 'Bearer planted' }] },
        { allowedEvidenceFieldNames: ['keywords'] },
      ),
    ).toEqual([
      { path: '$.keywords[0].authorization', reason: 'secret-key' },
      { path: '$.keywords[0].authorization', reason: 'authorization-material' },
    ]);
  });

  it('detects default, custom, and path-shaped vendor keys', () => {
    expect(scanForForbidden({ se_result: [] })).toContainEqual({
      path: '$.se_result',
      reason: 'vendor-payload-key',
    });
    expect(scanForForbidden({ firecrawlDocument: {} }, { vendorKeys: ['firecrawlDocument'] })).toContainEqual({
      path: '$.firecrawlDocument',
      reason: 'vendor-payload-key',
    });
    expect(scanForForbidden({ items: [{ raw: 1 }] }, { vendorKeys: ['$.items[0].raw'] })).toContainEqual({
      path: '$.items[0].raw',
      reason: 'vendor-payload-key',
    });
    expect(scanForForbidden({ items: [{ raw: 1 }] }, { vendorKeys: ['items[].raw'] })).toContainEqual({
      path: '$.items[0].raw',
      reason: 'vendor-payload-key',
    });
  });

  it('is bounded by string length, depth, node count, and cycles', () => {
    expect(scanForForbidden('abcd', { maxStringLength: 3 })).toContainEqual({
      path: '$',
      reason: 'string-limit',
    });
    expect(scanForForbidden({ a: { b: true } }, { maxDepth: 1 })).toContainEqual({
      path: '$.a.b',
      reason: 'depth-limit',
    });
    expect(scanForForbidden([1, 2, 3], { maxNodes: 2 })).toContainEqual({
      path: '$[1]',
      reason: 'node-limit',
    });
    expect(scanForForbidden({ a: 1, b: 2, c: 3 }, { maxNodes: 2 })).toContainEqual({
      path: '$.b',
      reason: 'node-limit',
    });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(scanForForbidden(cyclic)).toContainEqual({ path: '$.self', reason: 'cyclic-value' });
  });

  it('ignores JSON primitives and ordinary low-entropy strings', () => {
    expect(
      scanForForbidden([
        null,
        true,
        4,
        'plain text',
        'plain text '.repeat(4),
        'abcdefghijklmnopqrstuvwxyzABCDEF',
        '01234567890123456789012345678901',
        'abc123'.repeat(8),
        '123e4567-e89b-12d3-a456-426614174000',
      ]),
    ).toEqual([]);
  });

  it('does not confuse keyword collection fields with plural API-key fields', () => {
    expect(
      scanForForbidden(
        { keywords: ['one'], keywordList: ['two'] },
        { allowedEvidenceFieldNames: ['keywords', 'keywordList'] },
      ),
    ).toEqual([]);
  });

  it('accepts a clean provider-neutral DTO through the reusable assertion', () => {
    const dto = { id: 'analysis-1', status: 'ready', score: 82, sources: ['source-1'] };
    expect(() => assertSecurityCleanPayload(dto)).not.toThrow();
    expect(() => assertNoForbidden(dto)).not.toThrow();
  });

  it('assertNoForbidden prints every offending path', () => {
    expect(() => assertNoForbidden({ token: 'x', html: '<script>x</script>' })).toThrow(
      '$.token (secret-key), $.html (raw-html)',
    );
  });

  it('assertNoForbidden throws a typed error carrying the findings', () => {
    try {
      assertNoForbidden({ token: 'x' });
      expect.unreachable('expected a ForbiddenOutputError');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenOutputError);
      expect((err as ForbiddenOutputError).findings).toEqual([
        { path: '$.token', reason: 'secret-key' },
      ]);
    }
  });

  it('waives raw-HTML inside allowed first-party copy fields, subtree included', () => {
    // The exact shape that broke get_latest_audit_report: dictionary copy that
    // quotes markup, nested one level under the allowed `copy` container and
    // reached through an array.
    const report = {
      findings: [
        {
          ruleId: 'mobile-unfriendly',
          copy: { fix: 'add a <meta name="viewport"> tag inside the <head>' },
        },
      ],
    };
    expect(scanForForbidden(report, { allowedHtmlFieldNames: ['copy'] })).toEqual([]);
    // Without the allowance the same payload is rejected — the guard still works.
    expect(scanForForbidden(report)).toEqual([
      { path: '$.findings[0].copy.fix', reason: 'raw-html' },
    ]);
  });

  it('waives raw-HTML only for the named field, never its siblings', () => {
    expect(
      scanForForbidden(
        { nextStep: 'add a <title> tag', evidence: 'crawled <script>alert(1)</script>' },
        { allowedHtmlFieldNames: ['nextStep'] },
      ),
    ).toEqual([{ path: '$.evidence', reason: 'raw-html' }]);
  });

  it('never waives secrets inside an allowed copy field', () => {
    // An allowance for markup must not become an allowance for credentials.
    expect(
      scanForForbidden(
        {
          copy: {
            fix: 'Bearer sk-live-abc',
            why: 'deadbeefcafebabe0123456789abcdef0123456789abcdef',
          },
        },
        { allowedHtmlFieldNames: ['copy'] },
      ),
    ).toEqual([
      { path: '$.copy.fix', reason: 'authorization-material' },
      { path: '$.copy.why', reason: 'high-entropy-secret' },
    ]);
  });
});
