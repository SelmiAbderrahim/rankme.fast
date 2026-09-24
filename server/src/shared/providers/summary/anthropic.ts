/**
 * Anthropic (Claude) summary provider.
 *
 * Fetch-based against `POST /v1/messages` — no @anthropic-ai/sdk dependency,
 * one file, one deadline, one JSON payload. Maps HTTP responses onto our
 * taxonomy so the module surface is vendor-neutral:
 *
 *   429 → VendorQuotaError (retryAfterSeconds from Retry-After / retry-after-ms)
 *   401 / 403 → VendorAuthError
 *   408 / AbortError → VendorTimeoutError
 *   5xx / network → VendorUnavailableError
 *   stop_reason: max_tokens → truncated=true
 *   stop_reason: refusal → VendorUnavailableError('refused')
 *
 * Content sent = ONLY our own generated rule copy + user's site URL. We never
 * send raw HTML, vendor payloads, or user PII (privacy contract; enforced by
 * the module surface).
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { VendorAuthError, VendorMalformedError, VendorQuotaError, VendorTimeoutError, VendorUnavailableError, } from '../errors.js';
import type { GeneratedPrompt, GeneratePromptsInput, GeneratePromptsResult, SummaryProvider, SummarizeInput, SummarizeResult, } from './types.js';
/** Default per-request timeout (60s — matches spec). */
const DEFAULT_TIMEOUT_MS = 60000;
/** Anthropic Messages API version pinned in the header. */
const API_VERSION = '2023-06-01';
/** Default model — override via AI_SUMMARY_MODEL env in the registry. */
export const DEFAULT_SUMMARY_MODEL = 'claude-haiku-4-5';
/** Max tokens per response. Cheap summarization; ~200 words = well under 1024. */
const MAX_TOKENS = 1024;
/** Cap findings passed to the model — protects prompt size on very-broken sites. */
const MAX_FINDINGS = 25;
export interface AnthropicSummaryProviderOptions {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    timeoutMs?: number;
    logger?: Logger;
    /** Test hook — swap the global fetch. */
    fetchFn?: typeof fetch;
}
const messagesResponseSchema = z
    .object({
    content: z
        .array(z
        .object({
        type: z.string(),
        text: z.string().optional(),
    })
        .passthrough())
        .optional(),
    stop_reason: z.string().optional(),
})
    .passthrough();
type MessagesResponse = z.infer<typeof messagesResponseSchema>;
function localeName(locale: string): string {
    const map: Record<string, string> = {
        en: 'English',
        ar: 'Arabic',
        fr: 'French',
        de: 'German',
        es: 'Spanish',
        ru: 'Russian',
        zh: 'Chinese (Simplified)',
    };
    return map[locale] ?? locale;
}
function buildSystemPrompt(locale: string): string {
    const language = localeName(locale);
    return [
        `You are RankMeFast's SEO summariser.`,
        `Respond ENTIRELY in ${language}.`,
        `Read the fixed list of "Fix-now" findings the user provides.`,
        `Write ≤200 words of plain, business-owner language — no jargon, no marketing.`,
        `Order the findings by impact, most valuable first.`,
        `Use one short imperative sentence per finding ("Fix broken links on your pricing page.").`,
        `Never invent findings that are not in the list.`,
        `Only reference the rule ids, titles, or affected-URL counts we give you.`,
        `Never emit URLs, keys, or code blocks.`,
        `If the list is empty, reply with one sentence saying nothing critical was found.`,
    ].join(' ');
}
function buildUserPrompt(input: SummarizeInput): string {
    const findings = input.findings.slice(0, MAX_FINDINGS);
    const lines: string[] = [
        `Site: ${input.siteDomain}`,
        `Fix-now findings (${findings.length}):`,
    ];
    findings.forEach((f, i) => {
        const affected = f.affectedCount > 0 ? ` — affects ${f.affectedCount} page(s)` : '';
        lines.push(`${i + 1}. [${f.ruleId}] ${f.title}${affected}`);
        lines.push(`   Why: ${f.why}`);
        lines.push(`   Fix: ${f.fix}`);
    });
    return lines.join('\n');
}
/** Prompt count is clamped so a caller bug can never balloon one metered call. */
const MAX_GENERATED_PROMPTS = 10;
/** Tracked-prompt schema caps prompts at 280 chars — clamp model output to match. */
const MAX_PROMPT_LENGTH = 280;
/** Seed lists are truncated to keep the request prompt bounded. */
const MAX_SEEDS_PER_GROUP = 15;
function buildGenerateSystemPrompt(locale: string): string {
    const language = localeName(locale);
    return [
        `You suggest realistic questions people type into AI assistants (ChatGPT, Perplexity, Claude) while researching tools and services.`,
        `Write every question ENTIRELY in ${language}.`,
        `Stay strictly on the topics in the seed lists the user provides — never invent unrelated products.`,
        `Weight "Search Console queries" highest — those are real queries this audience already typed. Treat keywords, page topics, and competitors as weaker seeds.`,
        `Never mention the site domain itself inside a question; buyers ask about the problem, not the brand.`,
        `Write each question the way a person talks: one sentence, under 120 characters, first person where natural, no numbering.`,
        `State the buyer's problem or constraint rather than asking for a ranked list. At most a third may ask which option is best; at least a quarter must lead with a problem or symptom. At least two thirds must name no brand.`,
        `Respond with ONLY a JSON array of objects — no markdown fences, no commentary.`,
        `Each object has exactly: promptText (string), funnelStage (awareness|consideration|decision|postPurchase), promptType (categoryDiscovery|comparison|alternatives|problemFirst|useCase|pricingCommercial|brandAccuracy|objection), intent (informational|commercial|transactional|navigational), branded (boolean), evidenceSource (gsc|keyword|title|competitor|llmSynthesis), evidenceRef (string).`,
        `evidenceRef MUST repeat one supplied seed verbatim and evidenceSource MUST name the list it came from.`,
    ].join(' ');
}
function buildGenerateUserPrompt(input: GeneratePromptsInput): string {
    const take = (values: string[]): string => values.slice(0, MAX_SEEDS_PER_GROUP).join('; ') || '(none)';
    return [
        `Site: ${input.siteDomain}`,
        `Search Console queries: ${take(input.seeds.gscQueries)}`,
        `Seed keywords: ${take(input.seeds.keywords)}`,
        `Page topics: ${take(input.seeds.titles)}`,
        `Competitors: ${take(input.seeds.competitors)}`,
        `Return exactly ${Math.min(Math.max(input.count, 1), MAX_GENERATED_PROMPTS)} questions as a JSON array of objects.`,
    ].join('\n');
}
const generatedPromptSchema = z
    .object({
    promptText: z.string(),
    funnelStage: z.enum(['awareness', 'consideration', 'decision', 'postPurchase']),
    promptType: z.enum([
        'categoryDiscovery',
        'comparison',
        'alternatives',
        'problemFirst',
        'useCase',
        'pricingCommercial',
        'brandAccuracy',
        'objection',
    ]),
    intent: z.enum(['informational', 'commercial', 'transactional', 'navigational']),
    branded: z.boolean(),
    evidenceSource: z.enum(['gsc', 'keyword', 'title', 'competitor', 'llmSynthesis']),
    evidenceRef: z.string().max(MAX_PROMPT_LENGTH),
})
    .strict();
/**
 * Strict best-effort parse of the model's "JSON array of objects" reply.
 * Anything else — prose, bare strings, missing taxonomy fields — yields `[]`
 * so suggestion callers degrade gracefully instead of surfacing a vendor error
 * for a malformed-but-delivered answer.
 *
 * This legacy adapter does NOT enforce the generation-mix ceilings the profile
 * runner applies (≤35% categoryDiscovery, ≤35% branded, seed-grounded
 * evidenceRef). It is retained only for the deprecated single-Anthropic
 * `PROVIDER_SUMMARY=anthropic` path; the shipped `ai-sdk` path routes through
 * `shared/ai-profiles/runner.ts`, where those invariants live.
 */
export function parseGeneratedPrompts(text: string, count: number): GeneratedPrompt[] {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start)
        return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    }
    catch {
        return [];
    }
    const arr = z.array(generatedPromptSchema).safeParse(parsed);
    if (!arr.success)
        return [];
    const seen = new Set<string>();
    const prompts: GeneratedPrompt[] = [];
    for (const raw of arr.data) {
        const promptText = raw.promptText.trim().slice(0, MAX_PROMPT_LENGTH);
        const key = promptText.toLowerCase();
        if (!promptText || seen.has(key))
            continue;
        seen.add(key);
        prompts.push({ ...raw, promptText });
        if (prompts.length >= Math.min(Math.max(count, 1), MAX_GENERATED_PROMPTS))
            break;
    }
    return prompts;
}
function parseRetryAfterSeconds(headers: Headers): number | undefined {
    const ms = headers.get('retry-after-ms');
    if (ms) {
        const n = Number(ms);
        if (Number.isFinite(n) && n >= 0)
            return Math.ceil(n / 1000);
    }
    const s = headers.get('retry-after');
    if (s) {
        const n = Number(s);
        if (Number.isFinite(n) && n >= 0)
            return Math.ceil(n);
    }
    return undefined;
}
function ctx(operation: string): {
    provider: 'anthropic';
    operation: string;
} {
    return { provider: 'anthropic', operation };
}
function extractText(body: MessagesResponse): string {
    const blocks = body.content ?? [];
    return blocks
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('')
        .trim();
}
export function createAnthropicSummaryProvider(opts: AnthropicSummaryProviderOptions): SummaryProvider {
    const model = opts.model && opts.model.trim() ? opts.model : DEFAULT_SUMMARY_MODEL;
    const baseUrl = opts.baseUrl ?? 'https://api.anthropic.com';
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchFn = opts.fetchFn ?? fetch;
    // One HTTP path for every Messages-API operation so the error taxonomy
    // (429→quota, 401/403→auth, 408/abort→timeout, 5xx→unavailable, other
    // 4xx→malformed, refusal/empty→unavailable) can never drift per-operation.
    async function requestMessages(prompt: {
        system: string;
        user: string;
    }): Promise<{
        text: string;
        stopReason: string | undefined;
    }> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            let response: Response;
            try {
                response = await fetchFn(`${baseUrl}/v1/messages`, {
                    method: 'POST',
                    signal: controller.signal,
                    headers: {
                        'content-type': 'application/json',
                        'x-api-key': opts.apiKey,
                        'anthropic-version': API_VERSION,
                    },
                    body: JSON.stringify({
                        model,
                        max_tokens: MAX_TOKENS,
                        system: prompt.system,
                        messages: [
                            {
                                role: 'user',
                                content: prompt.user,
                            },
                        ],
                    }),
                });
            }
            catch (err) {
                const name = (err as {
                    name?: string;
                })?.name;
                if (name === 'AbortError') {
                    throw new VendorTimeoutError('anthropic messages timed out', {
                        ...ctx('messages'),
                        cause: err,
                    });
                }
                throw new VendorUnavailableError('anthropic network error', {
                    ...ctx('messages'),
                    cause: err,
                });
            }
            if (response.status === 429) {
                throw new VendorQuotaError('anthropic rate limit', {
                    ...ctx('messages'),
                    retryAfterSeconds: parseRetryAfterSeconds(response.headers),
                });
            }
            if (response.status === 401 || response.status === 403) {
                throw new VendorAuthError(`anthropic auth failed: ${response.status}`, ctx('messages'));
            }
            if (response.status === 408) {
                throw new VendorTimeoutError('anthropic 408 request timeout', ctx('messages'));
            }
            if (response.status >= 500) {
                throw new VendorUnavailableError(`anthropic ${response.status}`, ctx('messages'));
            }
            if (!response.ok) {
                // 4xx other than 401/403/408/429 = contract drift on our side —
                // non-retryable malformed, not "vendor unavailable".
                throw new VendorMalformedError(`anthropic ${response.status}`, ctx('messages'));
            }
            let rawBody: unknown;
            try {
                rawBody = await response.json();
            }
            catch (err) {
                if (controller.signal.aborted) {
                    throw new VendorTimeoutError(`anthropic no complete body within ${timeoutMs}ms`, {
                        ...ctx('messages'),
                        cause: err,
                    });
                }
                throw new VendorMalformedError('anthropic malformed json', {
                    ...ctx('messages'),
                    cause: err,
                });
            }
            const parsed = messagesResponseSchema.safeParse(rawBody);
            if (!parsed.success) {
                throw new VendorMalformedError('response failed schema validation', {
                    ...ctx('messages'),
                    cause: parsed.error,
                });
            }
            const body: MessagesResponse = parsed.data;
            const stopReason = body.stop_reason;
            if (stopReason === 'refusal') {
                throw new VendorUnavailableError('anthropic refused', ctx('messages'));
            }
            const text = extractText(body);
            if (!text) {
                throw new VendorUnavailableError('anthropic empty response', ctx('messages'));
            }
            return { text, stopReason };
        }
        finally {
            clearTimeout(timer);
        }
    }
    return {
        async summarize(input: SummarizeInput): Promise<SummarizeResult> {
            const { text, stopReason } = await requestMessages({
                system: buildSystemPrompt(input.locale),
                user: buildUserPrompt(input),
            });
            return {
                summary: text,
                truncated: stopReason === 'max_tokens',
                model,
            };
        },
        async generatePrompts(input: GeneratePromptsInput): Promise<GeneratePromptsResult> {
            const { text } = await requestMessages({
                system: buildGenerateSystemPrompt(input.locale),
                user: buildGenerateUserPrompt(input),
            });
            return {
                prompts: parseGeneratedPrompts(text, input.count),
                model,
            };
        },
    };
}
