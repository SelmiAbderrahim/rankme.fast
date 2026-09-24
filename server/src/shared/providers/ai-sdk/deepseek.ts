import { createDeepSeek } from '@ai-sdk/deepseek';
import { toAiSdkProviderAdapter, type AiSdkProviderAdapter, type AiSdkProviderFactoryConfig, } from './types.js';
export function createDeepSeekAiSdkAdapter(config: AiSdkProviderFactoryConfig): AiSdkProviderAdapter {
    const provider = createDeepSeek({
        apiKey: config.apiKey,
        ...(config.fetch ? { fetch: config.fetch } : {}),
    });
    return toAiSdkProviderAdapter('deepseek', config, provider(config.model));
}
