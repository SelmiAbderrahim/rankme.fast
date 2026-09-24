import { createAnthropic } from '@ai-sdk/anthropic';
import { toAiSdkProviderAdapter, type AiSdkProviderAdapter, type AiSdkProviderFactoryConfig, } from './types.js';
export function createAnthropicAiSdkAdapter(config: AiSdkProviderFactoryConfig): AiSdkProviderAdapter {
    const provider = createAnthropic({
        apiKey: config.apiKey,
        ...(config.fetch ? { fetch: config.fetch } : {}),
    });
    return toAiSdkProviderAdapter('anthropic', config, provider(config.model));
}
