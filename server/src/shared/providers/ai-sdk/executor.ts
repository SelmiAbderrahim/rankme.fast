import { APICallError, InvalidPromptError, LoadAPIKeyError, NoObjectGeneratedError, Output, generateText, jsonSchema, type JSONSchema7, } from 'ai';
import { AiAuthError, AiAvailabilityError, AiGenerationError, AiInvalidInputError, AiMalformedOutputError, AiQuotaError, AiSafetyError, AiTimeoutError, type AiFinishReason, type AiJsonSchema, type AiSafeWarning, type AiTokenUsage, } from '../ai-generation.js';
import type { AiSdkProviderAdapter } from './types.js';
export interface AiSdkCallInput {
    adapter: AiSdkProviderAdapter;
    jsonSchema: AiJsonSchema;
    system: string;
    prompt: string;
    maxOutputTokens: number;
    temperature: number | undefined;
    signal: AbortSignal;
    telemetryEnabled: boolean;
    functionId: string;
}
export interface AiSdkCallResult {
    object: unknown;
    finishReason: AiFinishReason;
    tokens: AiTokenUsage;
    warnings: readonly AiSafeWarning[];
}
export type AiSdkCall = (input: AiSdkCallInput) => Promise<AiSdkCallResult>;
interface AiSdkRawResult {
    output: unknown;
    finishReason: string;
    totalUsage: {
        inputTokens: number | undefined;
        outputTokens: number | undefined;
        inputTokenDetails: {
            cacheReadTokens: number | undefined;
        };
        outputTokenDetails: {
            reasoningTokens: number | undefined;
        };
    };
    warnings: readonly unknown[] | undefined;
}
export type AiSdkGenerate = (options: ReturnType<typeof buildAiSdkGenerateOptions>) => Promise<AiSdkRawResult>;
export function normalizeFinishReason(reason: string): AiFinishReason {
    switch (reason) {
        case 'stop':
        case 'length':
        case 'error':
        case 'other':
            return reason;
        case 'content-filter':
            return 'content_filter';
        case 'tool-calls':
            return 'tool_calls';
        default:
            return 'unknown';
    }
}
function tokenCount(value: number | undefined): number | null {
    return value === undefined ? null : value;
}
export function normalizeAiSdkError(error: unknown, signal: AbortSignal): AiGenerationError {
    if (signal.aborted)
        return new AiTimeoutError('provider_timeout', { cause: error });
    if (NoObjectGeneratedError.isInstance(error)) {
        return error.finishReason === 'content-filter'
            ? new AiSafetyError({ cause: error })
            : new AiMalformedOutputError({ cause: error });
    }
    if (LoadAPIKeyError.isInstance(error))
        return new AiAuthError({ cause: error });
    if (InvalidPromptError.isInstance(error))
        return new AiInvalidInputError('invalid_generation_input', { cause: error });
    if (APICallError.isInstance(error)) {
        const status = error.statusCode;
        if (status === 401 || status === 403)
            return new AiAuthError({ cause: error });
        if (status === 408)
            return new AiTimeoutError('provider_timeout', { cause: error });
        if (status === 429)
            return new AiQuotaError({ cause: error });
        if (status !== undefined && status >= 400 && status < 500) {
            return new AiInvalidInputError('invalid_generation_input', { cause: error });
        }
        return new AiAvailabilityError(status === undefined ? 'provider_transport' : 'provider_unavailable', { cause: error });
    }
    const name = error instanceof Error ? error.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
        return new AiTimeoutError('provider_timeout', { cause: error });
    }
    return new AiAvailabilityError('provider_transport', { cause: error });
}
export function buildAiSdkGenerateOptions(input: AiSdkCallInput) {
    return {
        model: input.adapter.languageModel,
        system: input.system,
        prompt: input.prompt,
        maxOutputTokens: input.maxOutputTokens,
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        ...(input.adapter.providerOptions
            ? { providerOptions: input.adapter.providerOptions }
            : {}),
        maxRetries: 0,
        abortSignal: input.signal,
        output: Output.object({
            schema: jsonSchema(input.jsonSchema as JSONSchema7),
        }),
        experimental_telemetry: {
            isEnabled: input.telemetryEnabled,
            recordInputs: false,
            recordOutputs: false,
            functionId: input.functionId,
        },
    };
}
export function createAiSdkCall(generate: AiSdkGenerate): AiSdkCall {
    return async (input) => {
        try {
            const result = await generate(buildAiSdkGenerateOptions(input));
            const finishReason = normalizeFinishReason(result.finishReason);
            if (finishReason === 'content_filter')
                throw new AiSafetyError();
            const warnings: AiSafeWarning[] = [];
            if (result.warnings && result.warnings.length > 0) {
                warnings.push('provider_warning_suppressed');
            }
            if (finishReason === 'unknown')
                warnings.push('finish_reason_normalized');
            return {
                object: result.output,
                finishReason,
                tokens: {
                    input: tokenCount(result.totalUsage.inputTokens),
                    output: tokenCount(result.totalUsage.outputTokens),
                    cachedInput: tokenCount(result.totalUsage.inputTokenDetails.cacheReadTokens),
                    reasoning: tokenCount(result.totalUsage.outputTokenDetails.reasoningTokens),
                },
                warnings,
            };
        }
        catch (error) {
            if (error instanceof AiGenerationError)
                throw error;
            throw normalizeAiSdkError(error, input.signal);
        }
    };
}
export const callAiSdk: AiSdkCall = createAiSdkCall(async (options) => generateText(options));
