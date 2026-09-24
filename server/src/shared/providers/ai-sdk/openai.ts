import { createOpenAI } from '@ai-sdk/openai';
import { toAiSdkProviderAdapter, type AiSdkProviderAdapter, type AiSdkProviderFactoryConfig, } from './types.js';
export function createOpenAiSdkAdapter(config: AiSdkProviderFactoryConfig): AiSdkProviderAdapter {
    const provider = createOpenAI({
        apiKey: config.apiKey,
        ...(config.fetch ? { fetch: config.fetch } : {}),
    });
    return toAiSdkProviderAdapter('openai', config, provider(config.model));
}
