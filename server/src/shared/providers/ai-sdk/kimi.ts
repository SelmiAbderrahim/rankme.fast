import { createMoonshotAI } from '@ai-sdk/moonshotai';
import { toAiSdkProviderAdapter, type AiSdkProviderAdapter, type AiSdkProviderFactoryConfig, } from './types.js';
export function createKimiAiSdkAdapter(config: AiSdkProviderFactoryConfig): AiSdkProviderAdapter {
    const provider = createMoonshotAI({
        apiKey: config.apiKey,
        ...(config.fetch ? { fetch: config.fetch } : {}),
    });
    return toAiSdkProviderAdapter('kimi', config, provider(config.model), {
        // Kimi K2.5/K2.6 reject arbitrary temperatures. Omitting the field lets
        // Moonshot apply the model's documented fixed value in either mode.
        temperatureHandling: 'provider-default',
        // Non-thinking mode is the bounded, tool/structured-output mode used by
        // this product; Moonshot then applies its documented fixed temperature.
        providerOptions: { moonshotai: { thinking: { type: 'disabled' } } },
    });
}
