/**
 * ai-sdk streaming chat runtime.
 *
 * Mirrors `runtime.ts` (`createAiSdkGenerationProvider`) — same spend guard,
 * same adapter failover order, same cost math, same attempt persistence into
 * `ai_usage_events` — but over `streamText().fullStream` instead of one
 * structured `generateText` call.
 *
 * Failover contract: an adapter failure BEFORE any text-delta / tool-call
 * part reached the consumer falls through to the next adapter; after first
 * emitted content an error terminates the iterable with the normalized error
 * (the consumer already rendered partial output — switching providers would
 * splice two models into one reply).
 *
 * The attempt batch is persisted BEFORE the `finish` event is yielded; an
 * abandoned generator (client disconnect / Stop button) persists an
 * estimated-cost attempt from its `finally` block.
 */
import { jsonSchema, stepCountIs, streamText, tool, type JSONSchema7, type ModelMessage, type Tool, } from 'ai';
import { AiBudgetRefusalError, AiGenerationError, AiInvalidInputError, AiProvidersExhaustedError, AiTimeoutError, type AiAttempt, type AiTokenUsage, } from '../ai-generation.js';
import type { AiChatProvider, AiChatStreamEvent, AiChatStreamInput, AiChatTool, AiChatToolOutcome, } from '../ai-chat.js';
import { assertAiChatResponseLocale } from '../ai-chat.js';
import { normalizeAiSdkError, normalizeFinishReason } from './executor.js';
import { calculateAiCostMicros, estimateAiAttemptCostMicros, type AiAttemptBatch, type AiSpendGuard, } from './runtime.js';
import { resolveAiSdkTemperature, type AiSdkProviderAdapter } from './types.js';
const EMPTY_TOKENS: AiTokenUsage = {
    input: null,
    output: null,
    cachedInput: null,
    reasoning: null,
};
export interface AiChatSdkCallInput {
    adapter: AiSdkProviderAdapter;
    system: string;
    messages: AiChatStreamInput['messages'];
    tools: Record<string, AiChatTool>;
    maxOutputTokens: number;
    temperature: number | undefined;
    maxSteps: number;
    signal: AbortSignal;
    telemetryEnabled: boolean;
    functionId: string;
}
/** Minimal normalized view of the ai-sdk fullStream parts we consume. */
export interface RawChatStreamPart {
    type: string;
    text?: string;
    toolCallId?: string;
    toolName?: string;
    input?: unknown;
    output?: unknown;
    error?: unknown;
    finishReason?: string;
    totalUsage?: {
        inputTokens?: number;
        outputTokens?: number;
    };
}
export type AiChatSdkCall = (input: AiChatSdkCallInput) => AsyncIterable<RawChatStreamPart>;
/** Convert the permission-filtered chat tool set into ai-sdk `tool()` entries. */
export function buildChatSdkTools(tools: Record<string, AiChatTool>): Record<string, Tool> {
    return Object.fromEntries(Object.entries(tools).map(([name, definition]) => [
        name,
        tool({
            description: definition.description,
            inputSchema: jsonSchema(definition.jsonSchema as JSONSchema7),
            execute: async (args: unknown) => definition.execute(args),
        }),
    ]));
}
/** Live seam — wraps `streamText().fullStream`. Tests inject a fake instead. */
export const callChatAiSdk: AiChatSdkCall = (input) => streamText({
    model: input.adapter.languageModel,
    system: input.system,
    messages: input.messages.map((message): ModelMessage => ({ role: message.role, content: message.text })),
    maxOutputTokens: input.maxOutputTokens,
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    ...(input.adapter.providerOptions
        ? { providerOptions: input.adapter.providerOptions }
        : {}),
    maxRetries: 0,
    abortSignal: input.signal,
    stopWhen: stepCountIs(input.maxSteps),
    tools: buildChatSdkTools(input.tools),
    experimental_telemetry: {
        isEnabled: input.telemetryEnabled,
        recordInputs: false,
        recordOutputs: false,
        functionId: input.functionId,
    },
}).fullStream as AsyncIterable<RawChatStreamPart>;
export interface AiSdkChatRuntimeConfig {
    adapters: readonly AiSdkProviderAdapter[];
    maxAttempts: number;
    totalTimeoutMs: number;
    telemetryEnabled: boolean;
    call?: AiChatSdkCall;
    spendGuard?: AiSpendGuard;
    persistAttempts?: (batch: AiAttemptBatch) => Promise<void>;
    onPersistenceError?: (code: 'ai_usage_event_write_failed') => void | Promise<void>;
    now?: () => number;
}
function utf8Bytes(value: string): number {
    return Buffer.byteLength(value, 'utf8');
}
function estimateChatInputTokens(input: AiChatStreamInput): number {
    let bytes = utf8Bytes(input.systemInstruction.text);
    for (const message of input.messages)
        bytes += utf8Bytes(message.text);
    for (const [name, definition] of Object.entries(input.tools)) {
        bytes +=
            utf8Bytes(name) +
                utf8Bytes(definition.description) +
                utf8Bytes(JSON.stringify(definition.jsonSchema));
    }
    return Math.ceil(bytes / 4);
}
function toToolOutcome(output: unknown): AiChatToolOutcome {
    if (typeof output === 'object' &&
        output !== null &&
        'ok' in output &&
        'structuredContent' in output &&
        typeof (output as {
            ok: unknown;
        }).ok === 'boolean') {
        return output as AiChatToolOutcome;
    }
    // Defensive: a foreign tool result shape is wrapped, never trusted as-is.
    return { ok: true, structuredContent: { value: output ?? null } };
}
function makeAttempt(ordinal: number, adapter: AiSdkProviderAdapter | null, status: AiAttempt['status'], latencyMs: number, estimate: bigint, cost: bigint, costSource: AiAttempt['costSource'], tokens: AiTokenUsage, error: AiGenerationError | null): AiAttempt {
    return {
        ordinal,
        provider: adapter?.provider ?? null,
        model: adapter?.model ?? null,
        status,
        latencyMs,
        tokens,
        configuredEstimateCostMicros: estimate,
        actualOrEstimatedCostMicros: cost,
        costSource,
        errorCategory: error?.category ?? null,
        errorCode: error?.code ?? null,
    };
}
export function createAiSdkChatProvider(config: AiSdkChatRuntimeConfig): AiChatProvider {
    const call = config.call ?? callChatAiSdk;
    const now = config.now ?? Date.now;
    async function persist(input: AiChatStreamInput, attempts: readonly AiAttempt[], createdAt: Date): Promise<void> {
        if (!config.persistAttempts)
            return;
        try {
            await config.persistAttempts({
                accountId: input.usage.accountId,
                siteId: input.usage.siteId ?? null,
                jobId: input.usage.jobId ?? null,
                task: input.task,
                correlationId: input.correlationId,
                profileMetadata: null,
                attempts,
                createdAt,
            });
        }
        catch {
            await config.onPersistenceError?.('ai_usage_event_write_failed');
        }
    }
    return {
        async *streamChat(input: AiChatStreamInput): AsyncIterable<AiChatStreamEvent> {
            assertAiChatResponseLocale(input.responseLocale);
            if (input.signal?.aborted)
                throw new AiInvalidInputError('request_cancelled');
            const createdAt = new Date(now());
            const attempts: AiAttempt[] = [];
            let persisted = false;
            if (config.spendGuard) {
                const since = new Date(createdAt.getTime() - config.spendGuard.windowMs);
                const spent = await config.spendGuard.getAccountSpendMicros(input.usage.accountId, since);
                if (spent >= config.spendGuard.limitMicros) {
                    attempts.push(makeAttempt(1, null, 'budget_circuit_open', 0, 0n, 0n, 'estimated', EMPTY_TOKENS, null));
                    persisted = true;
                    await persist(input, attempts, createdAt);
                    throw new AiBudgetRefusalError('account_budget_circuit_open');
                }
            }
            const inputTokenEstimate = estimateChatInputTokens(input);
            const deadlineController = new AbortController();
            const deadlineTimer = setTimeout(() => deadlineController.abort(), config.totalTimeoutMs);
            const signal = input.signal
                ? AbortSignal.any([deadlineController.signal, input.signal])
                : deadlineController.signal;
            let consumed = 0n;
            let calls = 0;
            let ordinal = 0;
            let budgetSkipped = false;
            let lastError: AiGenerationError | null = null;
            // Set while an adapter attempt is streaming; consumed by the abandoned-
            // generator `finally` path to persist an estimated-cost attempt.
            let inFlight: {
                adapter: AiSdkProviderAdapter;
                estimate: bigint;
                startedAt: number;
            } | null = null;
            try {
                for (const adapter of config.adapters) {
                    if (calls >= config.maxAttempts)
                        break;
                    ordinal += 1;
                    const estimate = estimateAiAttemptCostMicros(inputTokenEstimate, input.maxOutputTokens, adapter);
                    if (estimate > input.maxCostMicros - consumed) {
                        budgetSkipped = true;
                        attempts.push(makeAttempt(ordinal, adapter, 'budget_skipped', 0, estimate, 0n, 'estimated', EMPTY_TOKENS, null));
                        continue;
                    }
                    calls += 1;
                    const startedAt = now();
                    let emittedContent = false;
                    inFlight = { adapter, estimate, startedAt };
                    try {
                        for await (const part of call({
                            adapter,
                            system: input.systemInstruction.text,
                            messages: input.messages,
                            tools: input.tools,
                            maxOutputTokens: input.maxOutputTokens,
                            temperature: resolveAiSdkTemperature(adapter, input.temperature.mode === 'deterministic' ? 0 : input.temperature.value),
                            maxSteps: input.maxSteps,
                            signal,
                            telemetryEnabled: config.telemetryEnabled,
                            functionId: `${input.systemInstruction.id}.${input.systemInstruction.version}`,
                        })) {
                            if (part.type === 'text-delta') {
                                emittedContent = true;
                                yield { type: 'text_delta', text: part.text ?? '' };
                            }
                            else if (part.type === 'tool-call') {
                                emittedContent = true;
                                yield {
                                    type: 'tool_call',
                                    toolCallId: part.toolCallId ?? '',
                                    toolName: part.toolName ?? '',
                                    args: part.input,
                                };
                            }
                            else if (part.type === 'tool-result') {
                                const outcome = toToolOutcome(part.output);
                                yield {
                                    type: 'tool_result',
                                    toolCallId: part.toolCallId ?? '',
                                    toolName: part.toolName ?? '',
                                    ok: outcome.ok,
                                    structuredContent: outcome.structuredContent,
                                };
                            }
                            else if (part.type === 'tool-error') {
                                yield {
                                    type: 'tool_result',
                                    toolCallId: part.toolCallId ?? '',
                                    toolName: part.toolName ?? '',
                                    ok: false,
                                    structuredContent: { error: { code: 'tool_failed' } },
                                };
                            }
                            else if (part.type === 'error') {
                                throw part.error;
                            }
                            else if (part.type === 'finish') {
                                const tokens: AiTokenUsage = {
                                    input: part.totalUsage?.inputTokens ?? null,
                                    output: part.totalUsage?.outputTokens ?? null,
                                    cachedInput: null,
                                    reasoning: null,
                                };
                                const actual = calculateAiCostMicros(tokens, adapter);
                                const charged = actual ?? estimate;
                                consumed += charged;
                                attempts.push(makeAttempt(ordinal, adapter, 'success', Math.max(0, now() - startedAt), estimate, charged, actual === null ? 'estimated' : 'actual', tokens, null));
                                inFlight = null;
                                // Persist BEFORE the finish event reaches the consumer so an
                                // abandoned iterator can never lose the success attempt row.
                                persisted = true;
                                await persist(input, attempts, createdAt);
                                yield {
                                    type: 'finish',
                                    provider: adapter.provider,
                                    model: adapter.model,
                                    finishReason: normalizeFinishReason(part.finishReason ?? 'unknown'),
                                    tokens: { input: tokens.input, output: tokens.output },
                                    actualOrEstimatedCostMicros: charged,
                                };
                                return;
                            }
                            // Any other part type (step markers, reasoning, sources) is
                            // metadata we deliberately do not surface.
                        }
                        // The stream ended without a finish part — a transport fault.
                        throw new AiGenerationError('availability', 'provider_transport', true);
                    }
                    catch (error) {
                        const normalized = error instanceof AiGenerationError
                            ? error
                            : normalizeAiSdkError(error, signal);
                        const terminal = input.signal?.aborted
                            ? new AiInvalidInputError('request_cancelled')
                            : deadlineController.signal.aborted
                                ? new AiTimeoutError('global_deadline_exceeded')
                                : normalized;
                        consumed += estimate;
                        attempts.push(makeAttempt(ordinal, adapter, terminal.category, Math.max(0, now() - startedAt), estimate, estimate, 'estimated', EMPTY_TOKENS, terminal));
                        inFlight = null;
                        lastError = terminal;
                        // No failover once the consumer saw content; no retry on
                        // non-retryable failures either way.
                        if (emittedContent || !terminal.retryable) {
                            persisted = true;
                            await persist(input, attempts, createdAt);
                            throw terminal;
                        }
                    }
                }
                persisted = true;
                await persist(input, attempts, createdAt);
                if (calls === 0 && budgetSkipped)
                    throw new AiBudgetRefusalError();
                throw new AiProvidersExhaustedError({ cause: lastError ?? undefined });
            }
            finally {
                clearTimeout(deadlineTimer);
                // Abandoned generator (client disconnect / Stop button): every yield
                // sits inside an attempt, so an un-persisted exit always carries an
                // in-flight adapter. Record it at its configured estimate so
                // `ai_usage_events` still carries the spend.
                if (!persisted && inFlight) {
                    attempts.push(makeAttempt(ordinal, inFlight.adapter, 'invalid_input', Math.max(0, now() - inFlight.startedAt), inFlight.estimate, inFlight.estimate, 'estimated', EMPTY_TOKENS, new AiInvalidInputError('request_cancelled')));
                    await persist(input, attempts, createdAt);
                }
            }
        },
    };
}
