/**
 * AiChatProvider registry.
 *
 * `PROVIDER_AI=fake` → the deterministic fake chat provider; `ai-sdk` → the
 * streaming chat runtime over the SAME adapter set the structured-generation
 * registry builds (`buildAiSdkAdaptersFromEnv`), with the same spend guard
 * and `ai_usage_events` persistence.
 */
import type { Env } from '../../config/env.js';
import { createAiSpendGuard, createAiUsageStore, } from '../../db/ai-usage-events.js';
import type { Db } from '../../db/client.js';
import { createFakeAiChatProvider } from './ai-chat-fake.js';
import type { AiChatProvider } from './ai-chat.js';
import { buildAiSdkAdaptersFromEnv, reportAiUsagePersistenceError, } from './ai-generation-registry.js';
import { createAiSdkChatProvider } from './ai-sdk/chat-runtime.js';
import type { AiChatSdkCall } from './ai-sdk/chat-runtime.js';
export interface AiChatRegistryDependencies {
    db?: Db | null;
    call?: AiChatSdkCall;
    onPersistenceError?: (code: 'ai_usage_event_write_failed') => void | Promise<void>;
}
export function createAiChatProviderFromEnv(value: Env, dependencies: AiChatRegistryDependencies = {}): AiChatProvider {
    if (value.PROVIDER_AI === 'fake')
        return createFakeAiChatProvider();
    const adapters = buildAiSdkAdaptersFromEnv(value);
    const usageStore = dependencies.db ? createAiUsageStore(dependencies.db) : null;
    return createAiSdkChatProvider({
        adapters,
        maxAttempts: value.AI_MAX_ATTEMPTS,
        totalTimeoutMs: value.AI_CHAT_TOTAL_TIMEOUT_MS,
        telemetryEnabled: value.AI_TELEMETRY_ENABLED,
        ...(dependencies.call ? { call: dependencies.call } : {}),
        ...(usageStore
            ? {
                persistAttempts: usageStore.persistAttempts,
                spendGuard: createAiSpendGuard(usageStore, value.AI_ACCOUNT_SPEND_WINDOW_MS, BigInt(value.AI_ACCOUNT_SPEND_LIMIT_MICROS)),
            }
            : {}),
        onPersistenceError: dependencies.onPersistenceError ?? reportAiUsagePersistenceError,
    });
}
