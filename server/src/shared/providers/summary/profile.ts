import { randomUUID } from 'node:crypto';
import type { AiProfileRunner, RecordAiProfileRun } from '../../ai-profiles/index.js';
import { createAiProfileRunner } from '../../ai-profiles/index.js';
import { AiAuthError, AiBudgetRefusalError, AiGenerationError, AiInvalidInputError, AiMalformedOutputError, AiQuotaError, AiSafetyError, AiTimeoutError, type AiGenerationProvider, type AiGenerationProviderKey, type AiProviderKey, } from '../ai-generation.js';
import { createFakeAiGenerationProvider } from '../ai-generation-fake.js';
import { createAnthropicAiSdkAdapter } from '../ai-sdk/anthropic.js';
import type { AiSdkCall } from '../ai-sdk/executor.js';
import { createAiSdkGenerationProvider } from '../ai-sdk/runtime.js';
import { VendorAuthError, VendorMalformedError, VendorQuotaError, VendorTimeoutError, VendorUnavailableError, } from '../errors.js';
import { buildFakeGeneratedPrompts, FAKE_SUMMARY_RESULT } from './fakes.js';
import type { GeneratedPrompt, GeneratePromptsInput, GeneratePromptsResult, SummaryProvider, SummarizeInput, SummarizeResult, } from './types.js';
interface ProfileSummaryOutput {
    summary: string;
    citations: string[];
    truncated: boolean;
}
/** Backwards-compatible legacy default; operators can override it through env. */
export const DEFAULT_SUMMARY_MODEL = 'claude-haiku-4-5';
interface ProfileSentimentOutput {
    sentiment: 'positive' | 'neutral' | 'negative';
    citations: string[];
}
interface ProfilePromptsOutput {
    prompts: GeneratedPrompt[];
    citations: string[];
}
export interface ProfileSummaryProviderOptions {
    runner: AiProfileRunner;
    providerOrder: readonly AiGenerationProviderKey[];
    fakeCompatibility?: boolean;
}
function correlationId(prefix: string, configured?: string): string {
    return configured ?? `${prefix}-${randomUUID()}`;
}
function usage(input: SummarizeInput | GeneratePromptsInput) {
    return input.usage ?? { accountId: 'summary-compatibility' };
}
function summarizeProfileInput(input: SummarizeInput, providerOrder: readonly AiGenerationProviderKey[]) {
    const sentiment = input.findings.length === 1 &&
        input.findings[0]?.ruleId === 'ai-visibility-sentiment';
    return {
        profile: sentiment ? 'ai_visibility_sentiment' as const : 'audit_summary' as const,
        input: sentiment
            ? { domain: input.siteDomain, answer: input.findings[0]!.why }
            : { siteDomain: input.siteDomain, findings: input.findings },
        locale: input.locale,
        correlationId: correlationId(sentiment ? 'ai-visibility-sentiment' : 'audit-summary', input.correlationId),
        usage: usage(input),
        configuredProviderOrder: providerOrder,
    };
}
function promptsProfileInput(input: GeneratePromptsInput, providerOrder: readonly AiGenerationProviderKey[]) {
    return {
        profile: 'ai_visibility_prompt_suggestions' as const,
        input: {
            siteDomain: input.siteDomain,
            count: Math.min(Math.max(input.count, 1), 10),
            keywords: input.seeds.keywords,
            titles: input.seeds.titles,
            competitors: input.seeds.competitors,
            gscQueries: input.seeds.gscQueries,
        },
        locale: input.locale,
        correlationId: correlationId('ai-visibility-prompts', input.correlationId),
        usage: usage(input),
        configuredProviderOrder: providerOrder,
    };
}
function mapProfileError(error: unknown, operation: string): never {
    const context = { provider: 'ai-generation', operation, cause: error };
    if (error instanceof AiTimeoutError)
        throw new VendorTimeoutError('AI generation timed out', context);
    if (error instanceof AiQuotaError || error instanceof AiBudgetRefusalError) {
        throw new VendorQuotaError('AI generation budget or quota unavailable', context);
    }
    if (error instanceof AiAuthError)
        throw new VendorAuthError('AI generation authentication failed', context);
    if (error instanceof AiMalformedOutputError || error instanceof AiInvalidInputError) {
        throw new VendorMalformedError('AI generation validation failed', context);
    }
    if (error instanceof AiSafetyError || error instanceof AiGenerationError) {
        throw new VendorUnavailableError('AI generation unavailable', context);
    }
    throw error;
}
export function createProfileSummaryProvider(options: ProfileSummaryProviderOptions): SummaryProvider {
    return {
        preflightSummarize(input): void {
            options.runner.preflight(summarizeProfileInput(input, options.providerOrder));
        },
        preflightGeneratePrompts(input): void {
            options.runner.preflight(promptsProfileInput(input, options.providerOrder));
        },
        async summarize(input: SummarizeInput): Promise<SummarizeResult> {
            try {
                if (input.findings.length === 1 && input.findings[0]?.ruleId === 'ai-visibility-sentiment') {
                    const generated = await options.runner.run<ProfileSentimentOutput>({
                        ...summarizeProfileInput(input, options.providerOrder),
                        profile: 'ai_visibility_sentiment',
                    });
                    return {
                        summary: generated.object.sentiment,
                        truncated: false,
                        model: generated.provenance.model,
                    };
                }
                const generated = await options.runner.run<ProfileSummaryOutput>({
                    ...summarizeProfileInput(input, options.providerOrder),
                    profile: 'audit_summary',
                });
                return {
                    summary: generated.object.summary,
                    truncated: generated.object.truncated || generated.provenance.finishReason === 'length',
                    model: options.fakeCompatibility
                        ? FAKE_SUMMARY_RESULT.model
                        : generated.provenance.model,
                };
            }
            catch (error) {
                mapProfileError(error, 'summarize');
            }
        },
        async generatePrompts(input: GeneratePromptsInput): Promise<GeneratePromptsResult> {
            try {
                const generated = await options.runner.run<ProfilePromptsOutput>({
                    ...promptsProfileInput(input, options.providerOrder),
                });
                return {
                    prompts: options.fakeCompatibility
                        ? buildFakeGeneratedPrompts(input)
                        : generated.object.prompts,
                    model: options.fakeCompatibility
                        ? FAKE_SUMMARY_RESULT.model
                        : generated.provenance.model,
                };
            }
            catch (error) {
                mapProfileError(error, 'generate-prompts');
            }
        },
    };
}
export function createFakeProfileSummaryProvider(recordRun?: RecordAiProfileRun): SummaryProvider {
    const provider = createFakeAiGenerationProvider({
        objects: {
            audit_summary: {
                summary: FAKE_SUMMARY_RESULT.summary,
                citations: [],
                truncated: FAKE_SUMMARY_RESULT.truncated,
            },
            ai_visibility_sentiment: { sentiment: 'neutral', citations: [] },
            ai_visibility_prompt_suggestions: { prompts: [], citations: [] },
        },
    });
    return createProfileSummaryProvider({
        runner: createAiProfileRunner({ provider, ...(recordRun ? { recordRun } : {}) }),
        providerOrder: ['fake'],
        fakeCompatibility: true,
    });
}
export interface AnthropicProfileGenerationOptions {
    apiKey: string;
    model: string;
    inputCostMicrosPerMillion: number;
    outputCostMicrosPerMillion: number;
    totalTimeoutMs: number;
    telemetryEnabled: boolean;
    call?: AiSdkCall;
}
/** Legacy selection implemented through the same AI SDK seam, with one adapter. */
export function createAnthropicProfileGenerationProvider(options: AnthropicProfileGenerationOptions): AiGenerationProvider {
    const adapter = createAnthropicAiSdkAdapter({
        apiKey: options.apiKey,
        model: options.model,
        inputCostMicrosPerMillion: options.inputCostMicrosPerMillion,
        outputCostMicrosPerMillion: options.outputCostMicrosPerMillion,
    });
    return createAiSdkGenerationProvider({
        adapters: [adapter],
        maxAttempts: 1,
        totalTimeoutMs: options.totalTimeoutMs,
        telemetryEnabled: options.telemetryEnabled,
        ...(options.call ? { call: options.call } : {}),
    });
}
export function createOrderedProfileSummaryProvider(options: {
    provider: AiGenerationProvider;
    providerOrder: readonly AiProviderKey[];
    recordRun?: RecordAiProfileRun;
}): SummaryProvider {
    return createProfileSummaryProvider({
        runner: createAiProfileRunner({
            provider: options.provider,
            ...(options.recordRun ? { recordRun: options.recordRun } : {}),
        }),
        providerOrder: options.providerOrder,
    });
}
