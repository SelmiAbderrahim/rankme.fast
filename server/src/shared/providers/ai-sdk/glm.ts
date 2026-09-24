import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { toAiSdkProviderAdapter, type AiSdkProviderAdapter, type AiSdkProviderFactoryConfig, } from './types.js';
export interface GlmAiSdkFactoryConfig extends AiSdkProviderFactoryConfig {
    /** Operator-only, prevalidated by SEC-URL at startup. */
    baseUrl: string;
}
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
/** Z.ai supports JSON mode, with the schema supplied in the system message. */
export function transformGlmRequestBody(args: Record<string, unknown>): Record<string, unknown> {
    const responseFormat = isRecord(args.response_format) ? args.response_format : null;
    const jsonSchema = isRecord(responseFormat?.json_schema)
        ? responseFormat.json_schema
        : null;
    if (responseFormat?.type !== 'json_schema' || !jsonSchema || !('schema' in jsonSchema)) {
        return args;
    }
    const instruction = `Return only JSON matching this schema exactly:\n${JSON.stringify(jsonSchema.schema)}`;
    const messages = Array.isArray(args.messages) ? [...args.messages] : [];
    const systemIndex = messages.findIndex((message) => isRecord(message) && message.role === 'system');
    if (systemIndex === -1) {
        messages.unshift({ role: 'system', content: instruction });
    }
    else {
        const system = messages[systemIndex] as Record<string, unknown>;
        messages[systemIndex] = {
            ...system,
            content: `${typeof system.content === 'string' ? system.content : ''}\n${instruction}`,
        };
    }
    return { ...args, messages, response_format: { type: 'json_object' } };
}
export function createGlmAiSdkAdapter(config: GlmAiSdkFactoryConfig): AiSdkProviderAdapter {
    const provider = createOpenAICompatible({
        name: 'glm',
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        supportsStructuredOutputs: true,
        transformRequestBody: transformGlmRequestBody,
        ...(config.fetch ? { fetch: config.fetch } : {}),
    });
    return toAiSdkProviderAdapter('glm', config, provider(config.model));
}
