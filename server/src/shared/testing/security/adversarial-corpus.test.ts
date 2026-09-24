import { describe, expect, it } from 'vitest';
import { lintFixtureText } from '../fixtures/fixture-lint.js';
import { canonicalizeCitationId } from '../../security/input-guards.js';
import {
  ADVERSARIAL_CORPUS,
  DEEPLY_NESTED_BODY,
  EXTERNAL_BATCH_PAYLOADS,
  OVERSIZED_BODY,
  PROMPT_INJECTION_PAYLOADS,
  SPREADSHEET_FORMULA_PAYLOADS,
  SSRF_PAYLOADS,
  UNICODE_CITATION_IDS,
  XSS_PAYLOADS,
} from './adversarial-corpus.js';

describe('shared adversarial fixture corpus', () => {
  it('contains every locked synthetic attack family', () => {
    expect(PROMPT_INJECTION_PAYLOADS).toHaveLength(3);
    expect(SSRF_PAYLOADS.hosts).toContain('169.254.169.254');
    expect(SSRF_PAYLOADS.rebinding.connectAddress).toBe('10.0.0.1');
    expect(XSS_PAYLOADS).toContain('</script><script>alert(1)</script>');
    expect(SPREADSHEET_FORMULA_PAYLOADS.map((value) => value[0])).toEqual([
      '=',
      '+',
      '-',
      '@',
      '\t',
      '\r',
    ]);
    expect(OVERSIZED_BODY.text.length).toBeGreaterThan(100_000);
    expect(JSON.stringify(DEEPLY_NESTED_BODY).split('child').length).toBe(33);
    expect(EXTERNAL_BATCH_PAYLOADS.jsonRpc).toHaveLength(2);
    expect(EXTERNAL_BATCH_PAYLOADS.webhook).toHaveLength(2);
  });

  it('is synthetic and passes the recorded-fixture secret lint', () => {
    expect(lintFixtureText(JSON.stringify(ADVERSARIAL_CORPUS))).toEqual([]);
  });

  it('carries canonical and homograph citation IDs for boundary suites', () => {
    expect(canonicalizeCitationId(UNICODE_CITATION_IDS.canonical)).toBe('source-1');
    expect(() => canonicalizeCitationId(UNICODE_CITATION_IDS.cyrillicHomograph)).toThrow();
    expect(() => canonicalizeCitationId(UNICODE_CITATION_IDS.fullWidthHomograph)).toThrow();
  });
});
