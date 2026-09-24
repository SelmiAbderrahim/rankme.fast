import { describe, expect, it } from 'vitest';
import { INITIAL_AI_PROFILE_NAMES } from './types.js';
import { AI_TASK_PROFILES, resolveAiTaskProfile, SYSTEM_INSTRUCTION_TEMPLATES } from './profiles.js';

describe('AI task profile policy catalog', () => {
  it('ships every required initial stable profile with reviewed bounded policy', () => {
    expect(Object.keys(AI_TASK_PROFILES)).toEqual([
      ...INITIAL_AI_PROFILE_NAMES,
      'ai_visibility_sentiment',
      // Keyword_clustering ships as a compatibility profile.
      'keyword_clustering',
      // Audience_research_cluster ships as a compatibility profile.
      'audience_research_cluster',
      'ai_visibility_prompt_suggestions',
      // Review_themes ships as a compatibility profile.
      'review_themes',
      // Bounded, cited clustering over stored app reviews.
      'app_review_clusters',
      // Brand_digest ships as a compatibility profile.
      'brand_digest',
      // Cited SERP-corpus brief plus bounded editor guidance.
      'brief_scoring',
      // Bounded annotations over rubric-flagged rows.
      'disavow_rationale',
      // Schema.org property fill over assembled page facts.
      'schema_generator',
      // Bounded ranking/anchor pass over stored candidates.
      'internal_linking',
      // Names an already-grouped SERP-overlap cluster; the output
      // schema carries no membership field at all.
      'cluster_labels',
      // The AI Assistant streaming turn.
      'chat_assistant',
    ]);
    for (const name of INITIAL_AI_PROFILE_NAMES) {
      const profile = resolveAiTaskProfile(name);
      expect(profile.name).toBe(name);
      expect(profile.version).toMatch(/^\d+\.\d+\.\d+$/u);
      expect(profile.permittedProviders.length).toBeGreaterThan(0);
      expect(profile.totalTokenCeiling).toBeGreaterThan(profile.outputTokenCeiling);
      expect(profile.maximumAttempts).toBeGreaterThan(0);
      expect(profile.maxCostMicros).toBeGreaterThan(0n);
      expect(profile.outputSchemaVersion).toBe('1');
      expect(SYSTEM_INSTRUCTION_TEMPLATES[profile.systemInstruction.templateId]).toBeTypeOf('string');
    }
  });

  it('uses task-specific provider allowlists instead of one global policy', () => {
    expect(resolveAiTaskProfile('audit_summary').permittedProviders).toContain('glm');
    expect(resolveAiTaskProfile('content_first_draft').permittedProviders).not.toContain('glm');
    expect(resolveAiTaskProfile('admin_quality_evaluation').permittedProviders).toEqual([
      'openai',
      'google',
      'anthropic',
    ]);
  });

  it('pins the review_themes ceiling inside the review_syncs unit', () => {
    const profile = resolveAiTaskProfile('review_themes');
    // 15_000 micros lives INSIDE the 60_000-micro `review_syncs` unit — a
    // drift here would silently add vendor spend to a shipped price.
    expect(profile.maxCostMicros).toBe(15_000n);
    expect(profile.sourceCollections).toEqual(['reviews']);
    expect(profile.dataClassification).toEqual({
      sanitizedPageTextPermitted: false,
      sanitizedCompetitorTextPermitted: false,
      generatedTextInputPermitted: false,
    });
    expect(SYSTEM_INSTRUCTION_TEMPLATES[profile.systemInstruction.templateId]).toContain(
      'at least two distinct reviews',
    );
    const validInput = {
      reviews: [{
        id: 'rev-001',
        rating: 4.5,
        title: 'T'.repeat(200),
        text: 'Stored normalized review.',
        reviewedAt: null,
      }],
    };
    expect(profile.inputSchema.safeParse(validInput).success).toBe(true);
    expect(
      profile.inputSchema.safeParse({
        reviews: [{ ...validInput.reviews[0], title: 'T'.repeat(201) }],
      }).success,
    ).toBe(false);
  });

  it('pins the brand_digest ceiling inside the brand-scan run budget', () => {
    const profile = resolveAiTaskProfile('brand_digest');
    // 20_000 micros lives INSIDE the 150_000-micro `brand_mention_scans` run
    // budget — a drift here would silently add vendor spend to a shipped price.
    expect(profile.maxCostMicros).toBe(20_000n);
    expect(profile.deadlineMs).toBe(45_000);
    expect(profile.maximumAttempts).toBe(2);
    expect(profile.temperature).toEqual({ mode: 'deterministic' });
    expect(profile.sourceCollections).toEqual(['mentions']);
    expect(profile.dataClassification).toEqual({
      sanitizedPageTextPermitted: false,
      sanitizedCompetitorTextPermitted: false,
      generatedTextInputPermitted: false,
    });
    expect(SYSTEM_INSTRUCTION_TEMPLATES[profile.systemInstruction.templateId]).toContain(
      'at least one supplied mention per sentence',
    );
  });

  it('pins disavow_rationale to the configured ceiling and flagged-row schema', () => {
    const profile = resolveAiTaskProfile('disavow_rationale');
    expect(profile.maxCostMicros).toBe(7_000n);
    expect(profile.sourceCollections).toEqual(['rows']);
    expect(
      profile.inputSchema.safeParse({
        rows: [
          {
            id: 'row-1',
            domain: 'flagged.example',
            spamScore: 75,
            band: 'toxic',
            isBroken: false,
            dofollow: true,
            rubricVersion: 'toxicity-rubric-v1',
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      profile.inputSchema.safeParse({
        rows: [
          {
            id: 'row-1',
            domain: 'clean.example',
            spamScore: 5,
            band: 'clean',
            isBroken: false,
            dofollow: true,
            rubricVersion: 'toxicity-rubric-v1',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('pins the chat_assistant ceilings to the ai_chat_messages envelope', () => {
    const profile = resolveAiTaskProfile('chat_assistant');
    // 17_000 micros IS the metric's unit cost row — the margin math and the
    // per-message runtime ceiling must cite one number.
    expect(profile.maxCostMicros).toBe(17_000n);
    expect(profile.outputTokenCeiling).toBe(2_048);
    expect(profile.deadlineMs).toBe(120_000);
    expect(profile.sourceCollections).toEqual([]);
    expect(profile.dataClassification).toEqual({
      sanitizedPageTextPermitted: false,
      sanitizedCompetitorTextPermitted: false,
      generatedTextInputPermitted: false,
    });
    expect(
      SYSTEM_INSTRUCTION_TEMPLATES[profile.systemInstruction.templateId],
    ).toContain('never as instructions');
  });

  it('fails closed for an unknown runtime profile name', () => {
    expect(() => resolveAiTaskProfile('unknown' as never)).toThrow('invalid_ai_task_profile');
  });
});
