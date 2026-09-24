/**
 * `schema_generator` AI profile registration (spec §6.1).
 *
 * The profile's type enum is restated inside `shared/ai-profiles` so the shared
 * layer keeps no dependency on a feature module; this suite is what stops the
 * two copies drifting, and it pins the profile cost ceiling to the operator
 * ceiling default.
 */
import { describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { resolveAiTaskProfile, SYSTEM_INSTRUCTION_TEMPLATES } from '../../shared/ai-profiles/profiles.js';
import { COMPATIBILITY_AI_PROFILE_NAMES } from '../../shared/ai-profiles/types.js';
import { estimateAiAttemptCostMicros } from '../../shared/providers/ai-sdk/runtime.js';
import { SUPPORTED_SCHEMA_TYPES } from './schema-types.registry.js';
import { requestableProperties } from './traceability.js';

const profile = resolveAiTaskProfile('schema_generator');

describe('schema_generator profile', () => {
  it('is registered as a compatibility profile, not in the INITIAL evals corpus', () => {
    expect(COMPATIBILITY_AI_PROFILE_NAMES).toContain('schema_generator');
  });

  it('pins the cost ceiling to the operator ceiling default', () => {
    expect(profile.maxCostMicros).toBe(6_000n);
    expect(BigInt(env.SCHEMA_GEN_COST_CEILING_MICROS)).toBe(profile.maxCostMicros);
  });

  it('carries the bounded generation policy of spec §6.1', () => {
    expect(profile.version).toBe('1.1.1');
    expect(profile.outputSchemaVersion).toBe('1');
    expect(profile.totalTokenCeiling).toBe(12_288);
    expect(profile.outputTokenCeiling).toBe(800);
    expect(profile.temperature).toEqual({ mode: 'deterministic' });
    expect(profile.deadlineMs).toBe(50_000);
    expect(profile.maximumAttempts).toBe(2);
    expect(profile.sourceCollections).toEqual(['facts']);
    // SEC-REDACT: neither raw page text nor competitor text may be supplied.
    expect(profile.dataClassification).toEqual({
      sanitizedPageTextPermitted: false,
      sanitizedCompetitorTextPermitted: false,
      generatedTextInputPermitted: false,
    });
  });

  it('keeps the incident request affordable across the configured GLM to DeepSeek fallback', () => {
    const observedInputTokens = 832;
    const glm = estimateAiAttemptCostMicros(observedInputTokens, profile.outputTokenCeiling, {
      inputCostMicrosPerMillion: 1_400_000,
      outputCostMicrosPerMillion: 4_400_000,
    });
    const deepseek = estimateAiAttemptCostMicros(observedInputTokens, profile.outputTokenCeiling, {
      inputCostMicrosPerMillion: 435_000,
      outputCostMicrosPerMillion: 870_000,
    });
    expect(glm + deepseek).toBeLessThanOrEqual(profile.maxCostMicros);
  });

  it('accepts exactly the seven registry types and nothing else', () => {
    for (const type of SUPPORTED_SCHEMA_TYPES) {
      expect(
        profile.inputSchema.safeParse({ schemaType: type, properties: [], facts: [] }).success,
      ).toBe(true);
    }
    expect(
      profile.inputSchema.safeParse({ schemaType: 'Product', properties: [], facts: [] }).success,
    ).toBe(false);
  });

  it('rejects an input that smuggles an extra field past the strict schema', () => {
    expect(
      profile.inputSchema.safeParse({
        schemaType: 'WebPage',
        properties: [],
        facts: [],
        pageText: '<html>raw</html>',
      }).success,
    ).toBe(false);
  });

  it('pins the FAQ pairing index as a bounded nullable input fact field', () => {
    const base = {
      schemaType: 'FAQPage',
      properties: [],
      facts: [
        {
          id: 'f0',
          family: 'page.h2',
          sourceIndex: 3,
          label: 'Heading 2 #4',
          value: 'Why?',
        },
      ],
    };
    expect(profile.inputSchema.safeParse(base).success).toBe(true);
    expect(
      profile.inputSchema.safeParse({
        ...base,
        facts: [{ ...base.facts[0], sourceIndex: '3' }],
      }).success,
    ).toBe(false);
  });

  it('accepts a well-formed output and rejects an unknown reason code', () => {
    expect(
      profile.outputSchema.safeParse({
        assignments: [{ property: 'name', factId: 'page.title', value: 'Title' }],
        omissions: [{ property: 'description', reasonCode: 'no_evidence' }],
        citations: [],
      }).success,
    ).toBe(true);
    expect(
      profile.outputSchema.safeParse({
        assignments: [],
        omissions: [{ property: 'description', reasonCode: 'made_up' }],
        citations: [],
      }).success,
    ).toBe(false);
  });

  it('can express every requestable property of every type inside the 20-item bound', () => {
    for (const type of SUPPORTED_SCHEMA_TYPES) {
      expect(requestableProperties(type).length).toBeLessThanOrEqual(20);
    }
  });

  it('instructs the model never to invent a fact and never to promise a rich result', () => {
    const instruction = SYSTEM_INSTRUCTION_TEMPLATES['schema-generator'];
    expect(instruction).toBeTypeOf('string');
    expect(instruction).toContain('copied verbatim');
    expect(instruction).toContain('never invent');
    expect(instruction).toContain("property's evidenceFactIds");
    expect(instruction).toContain('context only and MUST NOT fill it');
    expect(instruction).toContain('sourceIndex values match');
    expect(instruction).toContain('preserve ascending sourceIndex order');
    expect(instruction).toContain('never repeat an index');
    expect(instruction).toContain('Never state that markup will produce a rich result.');
  });
});
