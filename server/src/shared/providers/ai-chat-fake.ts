/**
 * Deterministic fake AiChatProvider.
 *
 * Default script: a canned reply split into ~5 text deltas. When the LAST
 * user message contains a `[tool:name {json-args}]` directive AND the tool
 * survives permission filtering (i.e. it is present in `input.tools`), the
 * fake yields `tool_call`, ACTUALLY invokes the injected executor — so
 * permission gating + metering run under `PROVIDER_AI=fake`, including in
 * e2e — then yields `tool_result` before the deltas.
 *
 * `outcomes` sequences terminal behaviors per call for branch coverage.
 */
import { AiAvailabilityError, AiInvalidInputError, } from './ai-generation.js';
import type { AiChatProvider, AiChatStreamEvent, AiChatStreamInput, } from './ai-chat.js';
import { assertAiChatResponseLocale } from './ai-chat.js';
import type { SupportedLocale } from '../i18n/locales.js';
export type FakeAiChatOutcome = 'ok' | 'error_before_first_token' | 'error_mid_stream' | 'abort';
export interface FakeAiChatProviderOptions {
    /** Canned reply; split into ~5 deltas. */
    reply?: string;
    /** Per-call outcome sequence; past the end every call is 'ok'. */
    outcomes?: readonly FakeAiChatOutcome[];
    /** Fixed usage reported on finish. */
    usage?: {
        input: number;
        output: number;
    };
    /** Fixed cost reported on finish. */
    costMicros?: bigint;
}
export const FAKE_CHAT_TOOL_DIRECTIVE = /\[tool:([a-z_]+)(?:\s+(\{.*\}))?\]/;
export const FAKE_CHAT_REPLIES: Readonly<Record<SupportedLocale, string>> = {
    en: 'Here is what I found in your RankMeFast data. Rankings look stable this week and the latest audit has a short fix-now list worth clearing first.',
    ar: 'إليك ما وجدته في بيانات RankMeFast الخاصة بك. تبدو الترتيبات مستقرة هذا الأسبوع، ويحتوي أحدث تدقيق على قائمة قصيرة من الإصلاحات العاجلة التي يجدر البدء بها.',
    fr: 'Voici ce que j’ai trouvé dans vos données RankMeFast. Les positions semblent stables cette semaine, et le dernier audit contient une courte liste de corrections prioritaires à traiter en premier.',
    de: 'Das habe ich in Ihren RankMeFast-Daten gefunden. Die Rankings wirken diese Woche stabil, und der aktuelle Audit enthält eine kurze Liste dringender Korrekturen, die Sie zuerst angehen sollten.',
    es: 'Esto es lo que encontré en tus datos de RankMeFast. Las posiciones parecen estables esta semana y la auditoría más reciente incluye una breve lista de correcciones prioritarias que conviene abordar primero.',
    ru: 'Вот что удалось найти в ваших данных RankMeFast. Позиции на этой неделе выглядят стабильными, а в последнем аудите есть короткий список приоритетных исправлений, с которых стоит начать.',
    zh: '这是我在您的 RankMeFast 数据中发现的情况。本周排名看起来比较稳定，最新审计中有一份简短的优先修复清单，建议先处理这些问题。',
};
const FAKE_CHAT_PARTIAL_REPLIES: Readonly<Record<SupportedLocale, string>> = {
    en: 'Partial ',
    ar: 'رد جزئي. ',
    fr: 'Réponse partielle. ',
    de: 'Teilantwort. ',
    es: 'Respuesta parcial. ',
    ru: 'Частичный ответ. ',
    zh: '部分回复。',
};
// Keep the fake genuinely streaming across the HTTP boundary. A short,
// deterministic event-loop gap prevents Node/proxies from coalescing every
// delta into one paint while keeping unit and composed-stack runs fast.
const FAKE_CHAT_DELTA_INTERVAL_MS = 10;
const waitForNextDelta = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, FAKE_CHAT_DELTA_INTERVAL_MS));
function splitIntoDeltas(text: string, parts = 5): string[] {
    const size = Math.max(1, Math.ceil(text.length / parts));
    const deltas: string[] = [];
    for (let i = 0; i < text.length; i += size) {
        deltas.push(text.slice(i, i + size));
    }
    return deltas;
}
function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw new AiInvalidInputError('request_cancelled');
    }
}
export function createFakeAiChatProvider(options: FakeAiChatProviderOptions = {}): AiChatProvider {
    const usage = options.usage ?? { input: 100, output: 50 };
    const costMicros = options.costMicros ?? 1000n;
    let callOrdinal = 0;
    return {
        async *streamChat(input: AiChatStreamInput): AsyncIterable<AiChatStreamEvent> {
            assertAiChatResponseLocale(input.responseLocale);
            const reply = options.reply ?? FAKE_CHAT_REPLIES[input.responseLocale];
            const outcome = options.outcomes?.[callOrdinal] ?? 'ok';
            callOrdinal += 1;
            throwIfAborted(input.signal);
            if (outcome === 'error_before_first_token') {
                throw new AiAvailabilityError('provider_unavailable');
            }
            if (outcome === 'error_mid_stream' || outcome === 'abort') {
                yield {
                    type: 'text_delta',
                    text: FAKE_CHAT_PARTIAL_REPLIES[input.responseLocale],
                };
                if (outcome === 'error_mid_stream') {
                    throw new AiAvailabilityError('provider_transport');
                }
                throw new AiInvalidInputError('request_cancelled');
            }
            const lastUser = [...input.messages]
                .reverse()
                .find((message) => message.role === 'user');
            const directive = lastUser
                ? FAKE_CHAT_TOOL_DIRECTIVE.exec(lastUser.text)
                : null;
            const toolName = directive?.[1];
            const tool = toolName ? input.tools[toolName] : undefined;
            if (toolName && tool) {
                let args: unknown = {};
                if (directive?.[2]) {
                    try {
                        args = JSON.parse(directive[2]);
                    }
                    catch {
                        args = {};
                    }
                }
                const toolCallId = `fake-call-${callOrdinal}`;
                yield { type: 'tool_call', toolCallId, toolName, args };
                throwIfAborted(input.signal);
                const outcomeResult = await tool
                    .execute(args)
                    .catch(() => ({
                    ok: false,
                    structuredContent: { error: { code: 'tool_failed' } },
                }));
                yield {
                    type: 'tool_result',
                    toolCallId,
                    toolName,
                    ok: outcomeResult.ok,
                    structuredContent: outcomeResult.structuredContent,
                };
            }
            for (const delta of splitIntoDeltas(reply)) {
                throwIfAborted(input.signal);
                yield { type: 'text_delta', text: delta };
                await waitForNextDelta();
            }
            yield {
                type: 'finish',
                provider: 'fake',
                model: 'fake-chat-1',
                finishReason: 'stop',
                tokens: { input: usage.input, output: usage.output },
                actualOrEstimatedCostMicros: costMicros,
            };
        },
    };
}
