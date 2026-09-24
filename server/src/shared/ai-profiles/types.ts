import type { z } from 'zod';
import type { AiGenerationProviderKey, AiJsonSchema, AiProviderKey, AiTemperaturePolicy, } from '../providers/ai-generation.js';
export const INITIAL_AI_PROFILE_NAMES = [
    'audit_summary',
    'content_scorecard_explanation',
    'content_brief',
    'content_first_draft',
    'opportunity_explanation',
    'competitor_comparison',
    'admin_quality_evaluation',
] as const;
export const COMPATIBILITY_AI_PROFILE_NAMES = [
    'ai_visibility_sentiment',
    'ai_visibility_prompt_suggestions',
    // Cited AI clustering pass over stored keyword rows. Bounded to
    // ONE structured generation per run under the shared `ai_summaries` cost
    // envelope. Not enrolled in the INITIAL evals corpus because the run has no
    // free-form prose output — every field is machine-checked (integer counts,
    // enums, cluster labels bounded by input phrases).
    'keyword_clustering',
    // Cited AI clustering pass over bounded retained audience
    // research evidence (≤20 sources per run). Exactly ONE structured
    // generation per run under the shared 140_000-micro AI sub-budget.
    // Not enrolled in the INITIAL evals corpus because every field is
    // machine-checked and cited to a supplied `sourceId`.
    'audience_research_cluster',
    // Cited theme extraction over the stored, normalized review
    // rows of ONE sync run. Exactly ONE structured generation per run inside the
    // 60_000-micro `review_syncs` unit (15_000-micro profile ceiling, per the
    // authoritative numeric contract). Not enrolled in the INITIAL evals
    // corpus because every surviving theme is machine-checked: a theme must cite
    // at least two review ids that are still persisted at read time or it is
    // dropped — never replaced.
    'review_themes',
    // Cited brand digest over the stored, normalized mention rows
    // of ONE Brand Radar scan. Exactly ONE structured generation per scan, as
    // stage 3 inside the 150_000-micro run budget (20_000-micro profile ceiling,
    // per the authoritative numeric contract). Not enrolled in the INITIAL
    // evals corpus because every surviving sentence is machine-checked: a
    // sentence must cite at least one retained mention row id and may cite no id
    // outside that set, or it is dropped — never replaced.
    'brand_digest',
    // One cited outline or one editor re-score
    // over stored brief evidence. Both modes share the run's 50,000-micro AI
    // stage ceiling; the feature module enforces cumulative editor residue.
    'brief_scoring',
    // Optional annotations over rubric-flagged backlink rows. The
    // output is keyed only by supplied row ids; it cannot supply domains/bands.
    'disavow_rationale',
    // Schema.org property fill over assembled
    // page facts. Exactly ONE structured generation per `schema_generations`
    // unit (6_000-micro profile ceiling == the metric's unit cost). Not enrolled
    // in the INITIAL evals corpus because the pass produces no prose at all:
    // every assignment is machine-checked against a supplied fact id AND against
    // an exact copy of that fact's value, so a paraphrase, an invented rating,
    // price, date, review, or author is dropped rather than scored.
    'schema_generator',
    // Ranking + anchor drafting over bounded,
    // deterministic stored-inventory candidates. The model can only return a
    // subset of supplied candidate ids; the feature module rechecks URL identity,
    // noindex status, duplicates, and the 120-code-point anchor bound.
    'internal_linking',
    // Naming ONLY. The deterministic pivot
    // grouping is already complete when this profile runs; the output schema
    // carries no member, URL, size, or ordering field, so a hostile response has
    // no structural surface to attack. Not enrolled in the INITIAL evals corpus
    // because the post-check is exact: an unknown or duplicated cluster id
    // rejects the whole response and the run completes unlabeled.
    'cluster_labels',
    // The AI Assistant streaming turn. Unlike every
    // sibling this profile drives `streamChat`, not a structured generation:
    // the output schema below exists only to satisfy the profile shape (the
    // stream is free text rendered as inert text nodes). The profile is the
    // versioned authority for the system instruction, the sanitizer-conformant
    // input shape, and the per-message cost ceiling that mirrors
    // `VENDOR_UNIT_COST_MICROS.ai_chat_messages`. Not enrolled in the INITIAL
    // evals corpus — conversational output has no machine-checkable rubric.
    'chat_assistant',
    // One cited clustering pass over the bounded,
    // already-persisted reviews of one explicit run. The feature worker rejects
    // every unknown id, under-cited cluster, and non-verbatim quote before save.
    'app_review_clusters',
] as const;
export const AI_PROFILE_NAMES = [
    ...INITIAL_AI_PROFILE_NAMES,
    ...COMPATIBILITY_AI_PROFILE_NAMES,
] as const;
export type InitialAiProfileName = (typeof INITIAL_AI_PROFILE_NAMES)[number];
export type AiProfileName = (typeof AI_PROFILE_NAMES)[number];
export interface AiProfileDataClassification {
    sanitizedPageTextPermitted: boolean;
    sanitizedCompetitorTextPermitted: boolean;
    generatedTextInputPermitted: boolean;
}
export interface AiTaskProfile {
    name: AiProfileName;
    version: string;
    permittedProviders: readonly AiProviderKey[];
    systemInstruction: {
        templateId: string;
        version: string;
    };
    inputSchema: z.ZodType<object>;
    /** Per-property ceiling. Array item properties use their property name. */
    maximumCharacters: Readonly<Record<string, number>>;
    outputJsonSchema: AiJsonSchema;
    outputSchema: z.ZodType<object>;
    outputSchemaVersion: string;
    totalTokenCeiling: number;
    outputTokenCeiling: number;
    temperature: AiTemperaturePolicy;
    deadlineMs: number;
    maximumAttempts: number;
    maxCostMicros: bigint;
    dataClassification: AiProfileDataClassification;
    /** Top-level arrays whose `id` values are application-issued citation IDs. */
    sourceCollections: readonly string[];
}
export type AiProfileSafetyWarning = 'input_truncated' | 'control_characters_removed' | 'active_content_removed' | 'remote_link_removed' | 'instruction_phrase_removed' | 'repeated_text_removed' | 'citation_rejected' | 'task_invariant_rejected';
export type AiProfileQualityFlag = AiProfileSafetyWarning | 'complete' | 'partial' | 'provider_fallback' | 'validation_failed';
export interface AiProfileProvenance {
    task: AiProfileName;
    profileVersion: string;
    outputSchemaVersion: string;
    promptTemplateId: string;
    promptTemplateVersion: string;
    provider: AiGenerationProviderKey;
    model: string;
    finishReason: string;
    attempts: number;
    fallbackUsed: boolean;
    latencyMs: number;
    actualOrEstimatedCostMicros: bigint;
}
export interface AiProfileRunResult<T extends object = object> {
    /** SEC-OUT: every generated field remains inert, untrusted content. */
    trust: 'untrusted';
    status: 'complete' | 'partial';
    object: Readonly<T>;
    warnings: readonly AiProfileSafetyWarning[];
    qualityFlags: readonly AiProfileQualityFlag[];
    provenance: AiProfileProvenance;
    classification: {
        generatedFields: 'untrusted';
        renderAs: 'text_only';
    };
}
export interface AiProfileRunUsage {
    accountId: string;
    siteId?: string | null;
    jobId?: string | null;
}
export interface RunAiProfileInput {
    profile: AiProfileName;
    input: unknown;
    locale: unknown;
    correlationId: string;
    usage: AiProfileRunUsage;
    configuredProviderOrder: readonly AiGenerationProviderKey[];
    signal?: AbortSignal;
}
export type PreflightAiProfileInput = Omit<RunAiProfileInput, 'signal'>;
export interface AiProfileRunEvent {
    accountId: string;
    siteId: string | null;
    jobId: string | null;
    correlationId: string;
    task: AiProfileName;
    profileVersion: string;
    outputSchemaVersion: string;
    promptTemplateId: string;
    promptTemplateVersion: string;
    status: 'success' | 'partial' | 'validation_failed' | 'generation_failed';
    provider: AiGenerationProviderKey | null;
    model: string | null;
    attempts: number;
    fallbackUsed: boolean;
    latencyMs: number;
    costMicros: bigint;
    qualityFlags: readonly AiProfileQualityFlag[];
    createdAt: Date;
}
export type RecordAiProfileRun = (event: AiProfileRunEvent) => Promise<void>;
