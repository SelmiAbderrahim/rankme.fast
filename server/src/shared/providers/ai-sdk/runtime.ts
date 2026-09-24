import { AiBudgetRefusalError, AiGenerationError, AiInvalidInputError, AiMalformedOutputError, AiProvidersExhaustedError, AiTimeoutError, type AiAttempt, type AiGenerationProvider, type AiGenerationResult, type AiSafeWarning, type AiTokenUsage, type GenerateStructuredInput, } from '../ai-generation.js';
import { callAiSdk, type AiSdkCall } from './executor.js';
import { resolveAiSdkTemperature, type AiSdkProviderAdapter } from './types.js';
const MICROS_PER_MILLION = 1000000n;
const MAX_INPUT_BYTES = 200000;
const MAX_SYSTEM_BYTES = 20000;
const MAX_SCHEMA_BYTES = 100000;
const MAX_OUTPUT_TOKENS = 32768;
const EMPTY_TOKENS: AiTokenUsage = {
    input: null,
    output: null,
    cachedInput: null,
    reasoning: null,
};
export interface AiSpendGuard {
    windowMs: number;
    limitMicros: bigint;
    getAccountSpendMicros(accountId: string, since: Date): Promise<bigint>;
}
export interface AiAttemptBatch {
    accountId: string;
    siteId: string | null;
    jobId: string | null;
    task: string;
    correlationId: string;
    profileMetadata?: GenerateStructuredInput<object>['profileMetadata'] | null;
    attempts: readonly AiAttempt[];
    createdAt: Date;
}
export interface AiSdkRuntimeConfig {
    adapters: readonly AiSdkProviderAdapter[];
    maxAttempts: number;
    totalTimeoutMs: number;
    telemetryEnabled: boolean;
    call?: AiSdkCall;
    spendGuard?: AiSpendGuard;
    persistAttempts?: (batch: AiAttemptBatch) => Promise<void>;
    onPersistenceError?: (code: 'ai_usage_event_write_failed') => void | Promise<void>;
    now?: () => number;
}
function ceilMicros(tokens: number, rate: number): bigint {
    return ((BigInt(tokens) * BigInt(rate) + MICROS_PER_MILLION - 1n) /
        MICROS_PER_MILLION);
}
export function calculateAiCostMicros(tokens: Pick<AiTokenUsage, 'input' | 'output'>, adapter: Pick<AiSdkProviderAdapter, 'inputCostMicrosPerMillion' | 'outputCostMicrosPerMillion'>): bigint | null {
    if (tokens.input === null || tokens.output === null)
        return null;
    return (ceilMicros(tokens.input, adapter.inputCostMicrosPerMillion) +
        ceilMicros(tokens.output, adapter.outputCostMicrosPerMillion));
}
export function estimateAiAttemptCostMicros(inputTokens: number, outputTokens: number, adapter: Pick<AiSdkProviderAdapter, 'inputCostMicrosPerMillion' | 'outputCostMicrosPerMillion'>): bigint {
    return (ceilMicros(inputTokens, adapter.inputCostMicrosPerMillion) +
        ceilMicros(outputTokens, adapter.outputCostMicrosPerMillion));
}
function utf8Bytes(value: string): number {
    return Buffer.byteLength(value, 'utf8');
}
function validateInput<T extends object>(input: GenerateStructuredInput<T>): void {
    const schema = JSON.stringify(input.jsonSchema);
    const invalid = input.systemInstruction.id.length === 0 ||
        input.systemInstruction.id.length > 128 ||
        input.systemInstruction.version.length === 0 ||
        input.systemInstruction.version.length > 64 ||
        input.correlationId.length === 0 ||
        input.correlationId.length > 256 ||
        input.usage.accountId.length === 0 ||
        input.usage.accountId.length > 256 ||
        utf8Bytes(input.sanitizedInput) > MAX_INPUT_BYTES ||
        utf8Bytes(input.systemInstruction.text) > MAX_SYSTEM_BYTES ||
        utf8Bytes(schema) > MAX_SCHEMA_BYTES ||
        !Number.isInteger(input.maxOutputTokens) ||
        input.maxOutputTokens < 1 ||
        input.maxOutputTokens > MAX_OUTPUT_TOKENS ||
        input.maxCostMicros <= 0n ||
        (input.maxTotalTokens !== undefined &&
            (!Number.isInteger(input.maxTotalTokens) ||
                input.maxTotalTokens < input.maxOutputTokens ||
                input.maxTotalTokens > 131072)) ||
        (input.maxAttempts !== undefined &&
            (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 6)) ||
        (input.timeoutMs !== undefined &&
            (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 300000)) ||
        (input.permittedProviders !== undefined &&
            (input.permittedProviders.length === 0 ||
                new Set(input.permittedProviders).size !== input.permittedProviders.length)) ||
        (input.temperature.mode === 'creative' &&
            (!Number.isFinite(input.temperature.value) ||
                input.temperature.value < 0 ||
                input.temperature.value > 1));
    if (invalid)
        throw new AiInvalidInputError();
}
function estimateInputTokens<T extends object>(input: GenerateStructuredInput<T>): number {
    return Math.ceil((utf8Bytes(input.systemInstruction.text) +
        utf8Bytes(input.sanitizedInput) +
        utf8Bytes(JSON.stringify(input.jsonSchema))) / 4);
}
function temperature<T extends object>(input: GenerateStructuredInput<T>): number {
    return input.temperature.mode === 'deterministic' ? 0 : input.temperature.value;
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
export function createAiSdkGenerationProvider(config: AiSdkRuntimeConfig): AiGenerationProvider {
    const call = config.call ?? callAiSdk;
    const now = config.now ?? Date.now;
    async function persist<T extends object>(input: GenerateStructuredInput<T>, attempts: readonly AiAttempt[], createdAt: Date): Promise<void> {
        if (!config.persistAttempts)
            return;
        try {
            await config.persistAttempts({
                accountId: input.usage.accountId,
                siteId: input.usage.siteId ?? null,
                jobId: input.usage.jobId ?? null,
                task: input.task,
                correlationId: input.correlationId,
                profileMetadata: input.profileMetadata ?? null,
                attempts,
                createdAt,
            });
        }
        catch {
            await config.onPersistenceError?.('ai_usage_event_write_failed');
        }
    }
    return {
        async generateStructured<T extends object>(input: GenerateStructuredInput<T>): Promise<AiGenerationResult<T>> {
            validateInput(input);
            if (input.signal?.aborted)
                throw new AiInvalidInputError('request_cancelled');
            const createdAt = new Date(now());
            const attempts: AiAttempt[] = [];
            if (config.spendGuard) {
                const since = new Date(createdAt.getTime() - config.spendGuard.windowMs);
                const spent = await config.spendGuard.getAccountSpendMicros(input.usage.accountId, since);
                if (spent >= config.spendGuard.limitMicros) {
                    attempts.push(makeAttempt(1, null, 'budget_circuit_open', 0, 0n, 0n, 'estimated', EMPTY_TOKENS, null));
                    await persist(input, attempts, createdAt);
                    throw new AiBudgetRefusalError('account_budget_circuit_open');
                }
            }
            const inputTokenEstimate = estimateInputTokens(input);
            if (input.maxTotalTokens !== undefined &&
                inputTokenEstimate + input.maxOutputTokens > input.maxTotalTokens) {
                throw new AiInvalidInputError();
            }
            const deadlineController = new AbortController();
            const deadlineTimer = setTimeout(() => deadlineController.abort(), Math.min(config.totalTimeoutMs, input.timeoutMs ?? config.totalTimeoutMs));
            const signal = input.signal
                ? AbortSignal.any([deadlineController.signal, input.signal])
                : deadlineController.signal;
            let consumed = 0n;
            let calls = 0;
            let ordinal = 0;
            let budgetSkipped = false;
            let lastError: AiGenerationError | null = null;
            try {
                const permittedProviders = input.permittedProviders;
                const adapters = permittedProviders
                    ? config.adapters.filter((adapter) => permittedProviders.includes(adapter.provider))
                    : config.adapters;
                const maxAttempts = Math.min(config.maxAttempts, input.maxAttempts ?? config.maxAttempts);
                for (const adapter of adapters) {
                    if (calls >= maxAttempts)
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
                    try {
                        const generated = await call({
                            adapter,
                            jsonSchema: input.jsonSchema,
                            system: input.systemInstruction.text,
                            prompt: input.sanitizedInput,
                            maxOutputTokens: input.maxOutputTokens,
                            temperature: resolveAiSdkTemperature(adapter, temperature(input)),
                            signal,
                            telemetryEnabled: config.telemetryEnabled,
                            functionId: `${input.systemInstruction.id}.${input.systemInstruction.version}`,
                        });
                        if (input.signal?.aborted)
                            throw new AiInvalidInputError('request_cancelled');
                        if (deadlineController.signal.aborted) {
                            throw new AiTimeoutError('global_deadline_exceeded');
                        }
                        const validated = input.validationSchema.safeParse(generated.object);
                        if (!validated.success)
                            throw new AiMalformedOutputError();
                        const actual = calculateAiCostMicros(generated.tokens, adapter);
                        const charged = actual ?? estimate;
                        consumed += charged;
                        const warnings: AiSafeWarning[] = [...generated.warnings];
                        if (actual === null)
                            warnings.push('usage_estimated');
                        attempts.push(makeAttempt(ordinal, adapter, 'success', Math.max(0, now() - startedAt), estimate, charged, actual === null ? 'estimated' : 'actual', generated.tokens, null));
                        await persist(input, attempts, createdAt);
                        return {
                            trust: 'untrusted',
                            object: validated.data,
                            provider: adapter.provider,
                            model: adapter.model,
                            finishReason: generated.finishReason,
                            tokens: generated.tokens,
                            latencyMs: Math.max(0, now() - createdAt.getTime()),
                            attempts,
                            configuredEstimateCostMicros: attempts.reduce((sum, attempt) => sum + attempt.configuredEstimateCostMicros, 0n),
                            actualCostMicros: actual,
                            actualOrEstimatedCostMicros: consumed,
                            warnings: [...new Set(warnings)],
                        };
                    }
                    catch (error) {
                        const normalized = error instanceof AiGenerationError
                            ? error
                            : new AiInvalidInputError('invalid_generation_input', { cause: error });
                        const terminal = input.signal?.aborted
                            ? new AiInvalidInputError('request_cancelled')
                            : deadlineController.signal.aborted
                                ? new AiTimeoutError('global_deadline_exceeded')
                                : normalized;
                        consumed += estimate;
                        attempts.push(makeAttempt(ordinal, adapter, terminal.category, Math.max(0, now() - startedAt), estimate, estimate, 'estimated', EMPTY_TOKENS, terminal));
                        lastError = terminal;
                        if (!terminal.retryable) {
                            await persist(input, attempts, createdAt);
                            throw terminal;
                        }
                    }
                }
                await persist(input, attempts, createdAt);
                if (calls === 0 && budgetSkipped)
                    throw new AiBudgetRefusalError();
                throw new AiProvidersExhaustedError({ cause: lastError ?? undefined });
            }
            finally {
                clearTimeout(deadlineTimer);
            }
        },
    };
}
