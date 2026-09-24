import type { z } from 'zod';
import type { SupportedLocale } from '../i18n/index.js';
export const AI_PROVIDER_KEYS = [
    'glm',
    'deepseek',
    'kimi',
    'openai',
    'google',
    'anthropic',
] as const;
export type AiProviderKey = (typeof AI_PROVIDER_KEYS)[number];
export type AiGenerationProviderKey = AiProviderKey | 'fake';
/**
 * Deliberately declaration-mergeable: a feature module can add a named task
 * profile, while call sites can never pass an arbitrary `string`.
 */
export interface AiTaskNameRegistry {
    'runtime.contract': true;
    'audit.summary': true;
    'content.brief': true;
    'content.draft': true;
    audit_summary: true;
    content_scorecard_explanation: true;
    content_brief: true;
    content_first_draft: true;
    opportunity_explanation: true;
    competitor_comparison: true;
    admin_quality_evaluation: true;
    ai_visibility_sentiment: true;
    ai_visibility_prompt_suggestions: true;
    keyword_clustering: true;
    /** Community request 02 — names an already-grouped SERP-overlap cluster. */
    cluster_labels: true;
    audience_research_cluster: true;
    review_themes: true;
    app_review_clusters: true;
    brand_digest: true;
    disavow_rationale: true;
    schema_generator: true;
    internal_linking: true;
    brief_scoring: true;
    chat_assistant: true;
}
export type AiTaskName = Extract<keyof AiTaskNameRegistry, string>;
export type AiJsonSchema = Readonly<Record<string, unknown>>;
export interface AiSystemInstruction {
    id: string;
    version: string;
    /** Sensitive instruction text: usable for generation, never safe metadata. */
    text: string;
}
export type AiTemperaturePolicy = {
    mode: 'deterministic';
} | {
    mode: 'creative';
    value: number;
};
export interface AiUsageContext {
    accountId: string;
    siteId?: string | null;
    jobId?: string | null;
}
export interface GenerateStructuredInput<T extends object> {
    task: AiTaskName;
    jsonSchema: AiJsonSchema;
    /** Second validation boundary after AI SDK JSON-Schema validation. */
    validationSchema: z.ZodType<T>;
    systemInstruction: AiSystemInstruction;
    /** Pre-sanitized and bounded data. It is never instructions or safe to log. */
    sanitizedInput: string;
    locale: SupportedLocale;
    maxOutputTokens: number;
    /** Profile-owned total token ceiling, including instructions, input, schema, and output. */
    maxTotalTokens?: number;
    temperature: AiTemperaturePolicy;
    correlationId: string;
    maxCostMicros: bigint;
    /** Profile allowlist after filtering the configured global provider order. */
    permittedProviders?: readonly AiProviderKey[];
    /** Profile-specific ceilings; the runtime also applies stricter global ceilings. */
    maxAttempts?: number;
    timeoutMs?: number;
    /** Safe policy identifiers only. Prompt bodies and generated content are forbidden. */
    profileMetadata?: {
        name: string;
        version: string;
        outputSchemaVersion: string;
        promptTemplateId: string;
        promptTemplateVersion: string;
        qualityFlags: readonly string[];
    };
    usage: AiUsageContext;
    signal?: AbortSignal;
}
export const AI_ERROR_CATEGORIES = [
    'availability',
    'quota',
    'timeout',
    'malformed_output',
    'auth',
    'safety',
    'invalid_input',
    'budget_refusal',
] as const;
export type AiErrorCategory = (typeof AI_ERROR_CATEGORIES)[number];
export const AI_SAFE_ERROR_CODES = [
    'provider_unavailable',
    'provider_transport',
    'provider_quota',
    'provider_timeout',
    'provider_malformed_output',
    'provider_auth',
    'provider_safety',
    'invalid_generation_input',
    'request_budget_exhausted',
    'account_budget_circuit_open',
    'global_deadline_exceeded',
    'request_cancelled',
    'all_providers_exhausted',
] as const;
export type AiSafeErrorCode = (typeof AI_SAFE_ERROR_CODES)[number];
export class AiGenerationError extends Error {
    readonly category: AiErrorCategory;
    readonly code: AiSafeErrorCode;
    readonly retryable: boolean;
    constructor(category: AiErrorCategory, code: AiSafeErrorCode, retryable: boolean, options?: ErrorOptions) {
        super(code, options);
        this.name = this.constructor.name;
        this.category = category;
        this.code = code;
        this.retryable = retryable;
    }
}
export class AiAvailabilityError extends AiGenerationError {
    constructor(code: 'provider_unavailable' | 'provider_transport' = 'provider_unavailable', options?: ErrorOptions) {
        super('availability', code, true, options);
    }
}
export class AiProvidersExhaustedError extends AiGenerationError {
    constructor(options?: ErrorOptions) {
        super('availability', 'all_providers_exhausted', false, options);
    }
}
export class AiQuotaError extends AiGenerationError {
    constructor(options?: ErrorOptions) {
        super('quota', 'provider_quota', true, options);
    }
}
export class AiTimeoutError extends AiGenerationError {
    constructor(code: 'provider_timeout' | 'global_deadline_exceeded' = 'provider_timeout', options?: ErrorOptions) {
        super('timeout', code, code === 'provider_timeout', options);
    }
}
export class AiMalformedOutputError extends AiGenerationError {
    constructor(options?: ErrorOptions) {
        super('malformed_output', 'provider_malformed_output', true, options);
    }
}
export class AiAuthError extends AiGenerationError {
    constructor(options?: ErrorOptions) {
        super('auth', 'provider_auth', false, options);
    }
}
export class AiSafetyError extends AiGenerationError {
    constructor(options?: ErrorOptions) {
        super('safety', 'provider_safety', false, options);
    }
}
export class AiInvalidInputError extends AiGenerationError {
    constructor(code: 'invalid_generation_input' | 'request_cancelled' = 'invalid_generation_input', options?: ErrorOptions) {
        super('invalid_input', code, false, options);
    }
}
export class AiBudgetRefusalError extends AiGenerationError {
    constructor(code: 'request_budget_exhausted' | 'account_budget_circuit_open' = 'request_budget_exhausted', options?: ErrorOptions) {
        super('budget_refusal', code, false, options);
    }
}
export type AiAttemptStatus = 'success' | 'budget_skipped' | 'budget_circuit_open' | AiErrorCategory;
export interface AiTokenUsage {
    input: number | null;
    output: number | null;
    cachedInput: number | null;
    reasoning: number | null;
}
/** Safe metadata only. Content, vendor prose, headers, and stacks are forbidden. */
export interface AiAttempt {
    ordinal: number;
    provider: AiGenerationProviderKey | null;
    model: string | null;
    status: AiAttemptStatus;
    latencyMs: number;
    tokens: AiTokenUsage;
    configuredEstimateCostMicros: bigint;
    actualOrEstimatedCostMicros: bigint;
    costSource: 'actual' | 'estimated';
    errorCategory: AiErrorCategory | null;
    errorCode: AiSafeErrorCode | null;
}
export type AiFinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'error' | 'other' | 'unknown';
export type AiSafeWarning = 'usage_estimated' | 'provider_warning_suppressed' | 'finish_reason_normalized';
export interface AiGenerationResult<T extends object> {
    /** SEC-OUT: validated but still untrusted downstream content. */
    trust: 'untrusted';
    object: Readonly<T>;
    provider: AiGenerationProviderKey;
    model: string;
    finishReason: AiFinishReason;
    tokens: AiTokenUsage;
    latencyMs: number;
    attempts: readonly AiAttempt[];
    configuredEstimateCostMicros: bigint;
    actualCostMicros: bigint | null;
    actualOrEstimatedCostMicros: bigint;
    warnings: readonly AiSafeWarning[];
}
export interface AiGenerationProvider {
    generateStructured<T extends object>(input: GenerateStructuredInput<T>): Promise<AiGenerationResult<T>>;
}
