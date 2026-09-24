/**
 * AiChatProvider capability — vendor-neutral
 * streaming chat with tool execution.
 *
 * The interface mirrors `AiGenerationProvider` conventions: sanitized inputs
 * only, safe metadata in events, terminal failures thrown via the existing
 * `AiGenerationError` taxonomy (`ai-generation.ts`). Concrete providers:
 * `ai-chat-fake.ts` (deterministic, keyless) and
 * `ai-sdk/chat-runtime.ts` (live adapters via streamText).
 */
import { AiInvalidInputError, type AiFinishReason, type AiGenerationProviderKey, type AiJsonSchema, type AiSystemInstruction, type AiTaskName, type AiTemperaturePolicy, type AiUsageContext, } from './ai-generation.js';
import { isSupportedLocale, type SupportedLocale, } from '../i18n/locales.js';
export interface AiChatHistoryMessage {
    role: 'user' | 'assistant';
    /** Sanitized, bounded text. Never instructions and never safe to log. */
    text: string;
}
/** Result of one tool execution — already denylist-scanned by the executor. */
export interface AiChatToolOutcome {
    ok: boolean;
    structuredContent: Record<string, unknown>;
}
export interface AiChatTool {
    description: string;
    jsonSchema: AiJsonSchema;
    execute: (args: unknown) => Promise<AiChatToolOutcome>;
}
export interface AiChatStreamInput {
    /** Truncated conversation history, oldest first, ending with the user turn. */
    messages: readonly AiChatHistoryMessage[];
    /** Validated presentation locale frozen for this accepted assistant turn. */
    responseLocale: SupportedLocale;
    systemInstruction: AiSystemInstruction;
    /** Permission-filtered tool set — disallowed tools are simply absent. */
    tools: Record<string, AiChatTool>;
    maxOutputTokens: number;
    temperature: AiTemperaturePolicy;
    /** Multi-step tool loop bound (`stopWhen: stepCountIs(maxSteps)`). */
    maxSteps: number;
    maxCostMicros: bigint;
    usage: AiUsageContext;
    task: AiTaskName;
    correlationId: string;
    signal?: AbortSignal;
}
/** Runtime guard used by every concrete provider before any vendor work. */
export function assertAiChatResponseLocale(value: unknown): asserts value is SupportedLocale {
    if (!isSupportedLocale(value)) {
        throw new AiInvalidInputError('invalid_generation_input');
    }
}
export interface AiChatTextDeltaEvent {
    type: 'text_delta';
    text: string;
}
export interface AiChatToolCallEvent {
    type: 'tool_call';
    toolCallId: string;
    toolName: string;
    args: unknown;
}
export interface AiChatToolResultEvent {
    type: 'tool_result';
    toolCallId: string;
    toolName: string;
    ok: boolean;
    structuredContent: Record<string, unknown>;
}
export interface AiChatFinishEvent {
    type: 'finish';
    provider: AiGenerationProviderKey;
    model: string;
    finishReason: AiFinishReason;
    tokens: {
        input: number | null;
        output: number | null;
    };
    actualOrEstimatedCostMicros: bigint;
}
export type AiChatStreamEvent = AiChatTextDeltaEvent | AiChatToolCallEvent | AiChatToolResultEvent | AiChatFinishEvent;
export interface AiChatProvider {
    /**
     * Stream one assistant turn. Yields deltas/tool events and terminates with
     * exactly one `finish` event on success; terminal failures throw
     * `AiGenerationError` subclasses instead of yielding `finish`.
     */
    streamChat(input: AiChatStreamInput): AsyncIterable<AiChatStreamEvent>;
}
