import type { generateText, LanguageModel } from 'ai';
import type { AiProviderKey } from '../ai-generation.js';
type AiSdkProviderOptions = Parameters<typeof generateText>[0]['providerOptions'];
export interface AiSdkProviderFactoryConfig {
    apiKey: string;
    model: string;
    inputCostMicrosPerMillion: number;
    outputCostMicrosPerMillion: number;
    /** Deterministic contract-test seam; never supplied by product callers. */
    fetch?: typeof fetch;
}
export interface AiSdkProviderAdapter {
    provider: AiProviderKey;
    model: string;
    languageModel: LanguageModel;
    inputCostMicrosPerMillion: number;
    outputCostMicrosPerMillion: number;
    /** Some current models only accept their provider-defined sampling value. */
    temperatureHandling?: 'provider-default';
    /** Fixed, non-secret request options imposed by a provider/model contract. */
    providerOptions?: AiSdkProviderOptions;
}
export function toAiSdkProviderAdapter(provider: AiProviderKey, config: AiSdkProviderFactoryConfig, languageModel: LanguageModel, options: Pick<AiSdkProviderAdapter, 'temperatureHandling' | 'providerOptions'> = {}): AiSdkProviderAdapter {
    return {
        provider,
        model: config.model,
        languageModel,
        inputCostMicrosPerMillion: config.inputCostMicrosPerMillion,
        outputCostMicrosPerMillion: config.outputCostMicrosPerMillion,
        ...options,
    };
}
export function resolveAiSdkTemperature(adapter: AiSdkProviderAdapter, requested: number): number | undefined {
    return adapter.temperatureHandling === 'provider-default' ? undefined : requested;
}
