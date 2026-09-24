import type { Env } from '../../config/env.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { createAiSpendGuard, createAiUsageStore, } from '../../db/ai-usage-events.js';
import { db, type Db } from '../../db/client.js';
import { sendFailureAlert } from '../utils/failure-alert.js';
import { createFakeAiGenerationProvider } from './ai-generation-fake.js';
import type { AiGenerationProvider, AiProviderKey } from './ai-generation.js';
import { createAnthropicAiSdkAdapter } from './ai-sdk/anthropic.js';
import { createDeepSeekAiSdkAdapter } from './ai-sdk/deepseek.js';
import type { AiSdkCall } from './ai-sdk/executor.js';
import { createGlmAiSdkAdapter } from './ai-sdk/glm.js';
import { createGoogleAiSdkAdapter } from './ai-sdk/google.js';
import { createKimiAiSdkAdapter } from './ai-sdk/kimi.js';
import { createOpenAiSdkAdapter } from './ai-sdk/openai.js';
import { createAiSdkGenerationProvider } from './ai-sdk/runtime.js';
import type { AiSdkProviderAdapter, AiSdkProviderFactoryConfig, } from './ai-sdk/types.js';
export interface AiGenerationRegistryDependencies {
    db?: Db | null;
    call?: AiSdkCall;
    onPersistenceError?: (code: 'ai_usage_event_write_failed') => void | Promise<void>;
}
type AiUsageAlert = typeof sendFailureAlert;
/** Fixed-code operational path; never accepts or emits generation content. */
export async function reportAiUsagePersistenceError(code: 'ai_usage_event_write_failed', alert: AiUsageAlert = sendFailureAlert): Promise<void> {
    logger.error({ code }, 'AI usage event persistence failed');
    await alert({
        subject: 'AI usage event persistence failed',
        body: { code },
    });
}
function required<T>(value: T | undefined, field: string): T {
    if (value === undefined || value === '') {
        throw new Error(`${field} is required for the selected AI provider`);
    }
    return value;
}
function base(apiKey: string | undefined, model: string | undefined, inputRate: number | undefined, outputRate: number | undefined, prefix: string): AiSdkProviderFactoryConfig {
    return {
        apiKey: required(apiKey, `${prefix}_API_KEY`),
        model: required(model, `${prefix}_MODEL`),
        inputCostMicrosPerMillion: required(inputRate, `${prefix}_INPUT_COST_MICROS_PER_MILLION`),
        outputCostMicrosPerMillion: required(outputRate, `${prefix}_OUTPUT_COST_MICROS_PER_MILLION`),
    };
}
function buildAdapter(value: Env, provider: AiProviderKey): AiSdkProviderAdapter | null {
    switch (provider) {
        case 'glm':
            return value.GLM_ENABLED
                ? createGlmAiSdkAdapter({
                    ...base(value.GLM_API_KEY, value.GLM_MODEL, value.GLM_INPUT_COST_MICROS_PER_MILLION, value.GLM_OUTPUT_COST_MICROS_PER_MILLION, 'GLM'),
                    baseUrl: required(value.GLM_BASE_URL, 'GLM_BASE_URL'),
                })
                : null;
        case 'deepseek':
            return value.DEEPSEEK_ENABLED
                ? createDeepSeekAiSdkAdapter(base(value.DEEPSEEK_API_KEY, value.DEEPSEEK_MODEL, value.DEEPSEEK_INPUT_COST_MICROS_PER_MILLION, value.DEEPSEEK_OUTPUT_COST_MICROS_PER_MILLION, 'DEEPSEEK'))
                : null;
        case 'kimi':
            return value.KIMI_ENABLED
                ? createKimiAiSdkAdapter(base(value.KIMI_API_KEY, value.KIMI_MODEL, value.KIMI_INPUT_COST_MICROS_PER_MILLION, value.KIMI_OUTPUT_COST_MICROS_PER_MILLION, 'KIMI'))
                : null;
        case 'openai':
            return value.OPENAI_ENABLED
                ? createOpenAiSdkAdapter(base(value.OPENAI_API_KEY, value.OPENAI_MODEL, value.OPENAI_INPUT_COST_MICROS_PER_MILLION, value.OPENAI_OUTPUT_COST_MICROS_PER_MILLION, 'OPENAI'))
                : null;
        case 'google':
            return value.GOOGLE_ENABLED
                ? createGoogleAiSdkAdapter(base(value.GOOGLE_GENERATIVE_AI_API_KEY, value.GOOGLE_MODEL, value.GOOGLE_INPUT_COST_MICROS_PER_MILLION, value.GOOGLE_OUTPUT_COST_MICROS_PER_MILLION, 'GOOGLE'))
                : null;
        case 'anthropic':
            return value.ANTHROPIC_ENABLED
                ? createAnthropicAiSdkAdapter(base(value.ANTHROPIC_API_KEY, value.ANTHROPIC_MODEL, value.ANTHROPIC_INPUT_COST_MICROS_PER_MILLION, value.ANTHROPIC_OUTPUT_COST_MICROS_PER_MILLION, 'ANTHROPIC'))
                : null;
    }
}
/**
 * Shared adapter construction — the single env→adapter mapping consumed by
 * BOTH the structured-generation registry and the chat registry
 * (`ai-chat-registry.ts`), so the two capabilities can never drift on which
 * providers are enabled or how their rates are read.
 */
export function buildAiSdkAdaptersFromEnv(value: Env): AiSdkProviderAdapter[] {
    const adapters = value.AI_PROVIDER_ORDER
        .map((provider) => buildAdapter(value, provider))
        .filter((adapter): adapter is AiSdkProviderAdapter => adapter !== null);
    if (adapters.length === 0) {
        throw new Error('PROVIDER_AI=ai-sdk requires at least one enabled ordered provider');
    }
    return adapters;
}
/** Build one capability without exposing its secret-bearing factory config. */
export function createAiGenerationProviderFromEnv(value: Env, dependencies: AiGenerationRegistryDependencies = {}): AiGenerationProvider {
    if (value.PROVIDER_AI === 'fake')
        return createFakeAiGenerationProvider();
    const adapters = buildAiSdkAdaptersFromEnv(value);
    const usageStore = dependencies.db ? createAiUsageStore(dependencies.db) : null;
    return createAiSdkGenerationProvider({
        adapters,
        maxAttempts: value.AI_MAX_ATTEMPTS,
        totalTimeoutMs: value.AI_TOTAL_TIMEOUT_MS,
        telemetryEnabled: value.AI_TELEMETRY_ENABLED,
        ...(dependencies.call ? { call: dependencies.call } : {}),
        ...(usageStore
            ? {
                persistAttempts: usageStore.persistAttempts,
                spendGuard: createAiSpendGuard(usageStore, value.AI_ACCOUNT_SPEND_WINDOW_MS, BigInt(value.AI_ACCOUNT_SPEND_LIMIT_MICROS)),
            }
            : {}),
        onPersistenceError: dependencies.onPersistenceError ??
            reportAiUsagePersistenceError,
    });
}
let currentAiGenerationProvider: AiGenerationProvider | null = null;
/** Process singleton used by API/worker composition roots and feature-module consumers. */
export function getAiGenerationProvider(): AiGenerationProvider {
    currentAiGenerationProvider ??= createAiGenerationProviderFromEnv(env, { db });
    return currentAiGenerationProvider;
}
