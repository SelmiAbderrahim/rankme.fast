import { describe, expect, it } from 'vitest';
import { PROMPT_INJECTION_PAYLOADS } from '../testing/security/adversarial-corpus.js';
import { resolveAiTaskProfile } from './profiles.js';
import { sanitizeProfileInput } from './sanitizer.js';

describe('AI profile input sanitizer', () => {
  it('bounds before fixed regex processing and flags deterministic truncation', () => {
    const sanitized = sanitizeProfileInput(
      { derivedFacts: 'x'.repeat(12_500), sources: [] },
      resolveAiTaskProfile('content_scorecard_explanation'),
    );
    expect((sanitized.value as { derivedFacts: string }).derivedFacts).toHaveLength(12_000);
    expect(sanitized.warnings).toContain('input_truncated');
  });

  it('removes controls, active remnants, remote links, injection phrases, and repeated text', () => {
    const repeated = 'A deliberately repeated synthetic evidence line for deduplication.';
    const sanitized = sanitizeProfileInput(
      {
        derivedFacts: [
          `safe\u0000 ${PROMPT_INJECTION_PAYLOADS[0]}`,
          '<script>secret-system-prompt</script><form><input></form>',
          '[citation](https://remote.example/path) https://unused.example/',
          repeated,
          repeated,
        ].join('\n'),
        sources: [],
      },
      resolveAiTaskProfile('content_scorecard_explanation'),
    );
    const value = (sanitized.value as { derivedFacts: string }).derivedFacts;
    expect(value).not.toContain('\u0000');
    expect(value).not.toContain('<script');
    expect(value).not.toContain('https://');
    expect(value.toLowerCase()).not.toContain('ignore previous instructions');
    expect(value.match(/deliberately repeated/gu)).toHaveLength(1);
    expect(sanitized.warnings).toEqual(expect.arrayContaining([
      'control_characters_removed',
      'active_content_removed',
      'remote_link_removed',
      'instruction_phrase_removed',
      'repeated_text_removed',
    ]));
  });

  it('bounds unknown fields before strict-schema rejection', () => {
    expect(() => sanitizeProfileInput(
      { derivedFacts: 'safe', sources: [], unexpected: 'x'.repeat(100_000) },
      resolveAiTaskProfile('opportunity_explanation'),
    )).toThrow('invalid_ai_profile_input');
  });

  it('rejects overly deep and non-object inputs without processing unbounded content', () => {
    let nested: Record<string, unknown> = {};
    for (let index = 0; index < 14; index += 1) nested = { child: nested };
    expect(() => sanitizeProfileInput(nested, resolveAiTaskProfile('audit_summary')))
      .toThrow('ai_profile_input_too_complex');
    expect(() => sanitizeProfileInput('not-an-object', resolveAiTaskProfile('audit_summary')))
      .toThrow('invalid_ai_profile_input');
  });
});
