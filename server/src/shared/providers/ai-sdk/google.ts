import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { toAiSdkProviderAdapter, type AiSdkProviderAdapter, type AiSdkProviderFactoryConfig, } from './types.js';
export function createGoogleAiSdkAdapter(config: AiSdkProviderFactoryConfig): AiSdkProviderAdapter {
    const provider = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        ...(config.fetch ? { fetch: config.fetch } : {}),
    });
    return toAiSdkProviderAdapter('google', config, provider(config.model));
}
