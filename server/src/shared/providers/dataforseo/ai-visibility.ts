/**
 * DataForSEO AI Optimization adapter.
 *
 * Implements the vendor-neutral AiVisibilityProvider (types.ts) over three
 * DataForSEO v3 AI Optimization API endpoints. Vendor doc citations:
 *
 *   checkMentions      → POST /v3/ai_optimization/llm_mentions/search/live
 *                         ($0.1/request + $0.001/row — the LLM-Mentions
 *                         monthly commitment was REMOVED 2026-07-01, pure
 *                         pay-as-you-go now). Docs:
 *                         https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/search/live
 *                         One call per prompt so the fan-out cost stays
 *                         predictable. Vendor `platform` (google/chat_gpt/…)
 *                         maps onto our AiMentionRow.model surface id.
 *
 *   getAnswers         → POST /v3/ai_optimization/{engine}/llm_responses/live
 *                         (engines `chat_gpt`/`gemini`/`claude` support
 *                         Standard + Live; `perplexity` is Live-only). Docs:
 *                         https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/live
 *                         https://docs.dataforseo.com/v3/ai_optimization/gemini/llm_responses/live
 *                         https://docs.dataforseo.com/v3/ai_optimization/claude/llm_responses/live
 *                         https://docs.dataforseo.com/v3/ai_optimization/perplexity/llm_responses/live
 *                         One call per (prompt × model). The result shape
 *                         differs slightly per engine — this adapter models
 *                         the LOWEST-COMMON-DENOMINATOR shape validated
 *                         against the citation docs above: every engine
 *                         surfaces `result[].items[].message.sections[].text`
 *                         (or the older `message.content`/`message.message`
 *                         string), plus `annotations[].url` for citations.
 *                         A missing message normalizes to `answer: ''`; a
 *                         missing annotations array normalizes to `citations: []`.
 *
 *   getAiKeywordVolume → POST /v3/ai_optimization/ai_keyword_data/keywords_search_volume/live
 *                         ($0.01/task + $0.0001/item). Docs:
 *                         https://docs.dataforseo.com/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live
 *                         Result shape: `tasks[].result[].items[]` with
 *                         `keyword` + `ai_search_volume`. A keyword absent
 *                         from the response normalizes to `aiSearchVolume: null`
 *                         (same contract as KeywordProvider.getMetrics).
 *
 * Registry-facing engines (`chatgpt` | `gemini` | `claude` | `perplexity` |
 * `google-ai-mode`) are mapped to vendor path segments here; every other
 * model id is treated as an unknown/opaque surface — a caller passing a
 * surface we don't know about surfaces as a per-model VendorMalformedError,
 * never as a silent skip.
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { dataForSeoRequest, type DataForSeoConfig } from '../http.js';
import { VendorMalformedError } from '../errors.js';
import type { AiAnswerInput, AiAnswerRow, AiKeywordVolume, AiMentionCheckInput, AiMentionRow, AiVisibilityProvider, } from '../types.js';
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export interface DataForSeoAiVisibilityProviderConfig extends DataForSeoConfig {
    logger?: Logger;
    /** Injectable clock so tests get deterministic `checkedAt` values. */
    now?: () => Date;
}
/** Vendor upper-bound on prompts/keywords per llm_mentions/ai_keyword request. */
export const AI_VISIBILITY_MAX_BATCH = 1000;
const CTX_MENTIONS = { provider: 'dataforseo', operation: 'ai-mentions-search' };
const CTX_ANSWERS = { provider: 'dataforseo', operation: 'ai-llm-responses' };
const CTX_VOLUME = { provider: 'dataforseo', operation: 'ai-keyword-volume' };
/**
 * The four platforms LLM Mentions currently indexes (per vendor overview).
 * Order is stable so tests can rely on it.
 */
export const AI_MENTION_PLATFORMS = ['google', 'chat_gpt', 'perplexity', 'claude'] as const;
/**
 * Registry-facing model id → vendor URL segment (LLM Responses).
 * Registry-facing ids stay lowercase-kebab so 7-locale UI copy is easy;
 * vendor segments follow DataForSEO's snake_case URL scheme.
 */
export const LLM_RESPONSES_ENGINE_SEGMENTS: Readonly<Record<string, string>> = {
    chatgpt: 'chat_gpt',
    chat_gpt: 'chat_gpt',
    gemini: 'gemini',
    claude: 'claude',
    perplexity: 'perplexity',
};
// ---------------------------------------------------------------------------
// Vendor payload schemas — validated at the boundary
// ---------------------------------------------------------------------------
const mentionsSearchItemSchema = z
    .object({
    domain: z.string().nullable().optional(),
    keyword: z.string().nullable().optional(),
    platform: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    source_url: z.string().nullable().optional(),
    ai_search_volume: z.number().nullable().optional(),
    position: z.number().nullable().optional(),
})
    .passthrough();
const mentionsSearchResultSchema = z.array(mentionsSearchItemSchema).nullable();
const answerSectionSchema = z
    .object({
    type: z.string().nullable().optional(),
    text: z.string().nullable().optional(),
})
    .passthrough();
const answerMessageSchema = z
    .object({
    role: z.string().nullable().optional(),
    // Every engine surfaces text somewhere; we accept all three known shapes.
    content: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    sections: z.array(answerSectionSchema).nullable().optional(),
})
    .passthrough();
const answerAnnotationSchema = z
    .object({
    title: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
})
    .passthrough();
const answerItemSchema = z
    .object({
    message: answerMessageSchema.nullable().optional(),
    // Claude nests the message under `items[].message.sections[]`; older
    // Gemini/ChatGPT shapes carry a flat `response.message` string. Both are
    // in `message` above. Annotations live at the item level everywhere.
    annotations: z.array(answerAnnotationSchema).nullable().optional(),
    response: answerMessageSchema.nullable().optional(),
})
    .passthrough();
const answerResultSchema = z
    .array(z
    .object({
    // Some engines wrap in { items: [...] }, others surface a single
    // message at the top level. We accept both.
    items: z.array(answerItemSchema).nullable().optional(),
    message: answerMessageSchema.nullable().optional(),
    annotations: z.array(answerAnnotationSchema).nullable().optional(),
    response: answerMessageSchema.nullable().optional(),
})
    .passthrough())
    .nullable();
const keywordVolumeItemSchema = z
    .object({
    keyword: z.string(),
    ai_search_volume: z.number().nullable().optional(),
})
    .passthrough();
const keywordVolumeResultSchema = z
    .array(z
    .object({
    items: z.array(keywordVolumeItemSchema).nullable().optional(),
})
    .passthrough())
    .nullable();
// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
/** Strip protocol + trailing slash so the vendor sees a bare host. */
export function normalizeAiVisibilityTarget(target: string): string {
    const trimmed = target.trim();
    const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
    return withoutScheme.replace(/\/+$/, '').toLowerCase();
}
/**
 * Extract the answer body from an LLM Responses item. Every engine surfaces
 * one of the three shapes below — pick the first one that has text. Returns
 * `''` when nothing surfaced (a non-answer is normalized, never dropped).
 */
export function extractAnswerText(item: z.infer<typeof answerItemSchema>, fallback: z.infer<typeof answerMessageSchema> | null | undefined): string {
    const messages: Array<z.infer<typeof answerMessageSchema> | null | undefined> = [
        item.message,
        item.response,
        fallback,
    ];
    for (const msg of messages) {
        if (!msg)
            continue;
        const sections = msg.sections;
        if (Array.isArray(sections)) {
            const joined = sections
                .map((s) => (typeof s.text === 'string' ? s.text : ''))
                .filter((t) => t.length > 0)
                .join('\n\n');
            if (joined.length > 0)
                return joined;
        }
        if (typeof msg.content === 'string' && msg.content.length > 0)
            return msg.content;
        if (typeof msg.message === 'string' && msg.message.length > 0)
            return msg.message;
    }
    return '';
}
/** Extract citation URLs from an LLM Responses item + the outer result envelope. */
export function extractCitations(item: z.infer<typeof answerItemSchema>, outer: Array<z.infer<typeof answerAnnotationSchema>> | null | undefined): string[] {
    const sources = [item.annotations, outer];
    const urls: string[] = [];
    for (const src of sources) {
        if (!Array.isArray(src))
            continue;
        for (const a of src) {
            if (typeof a.url === 'string' && a.url.length > 0)
                urls.push(a.url);
        }
    }
    return urls;
}
// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export function createDataForSeoAiVisibilityProvider(cfg: DataForSeoAiVisibilityProviderConfig): AiVisibilityProvider {
    const nowFn = cfg.now ?? (() => new Date());
    async function checkMentionsForPrompt(prompt: string, domain: string): Promise<AiMentionRow[]> {
        const target = normalizeAiVisibilityTarget(domain);
        const rows: AiMentionRow[] = [];
        for (const platform of AI_MENTION_PLATFORMS) {
            const body = {
                language_code: 'en',
                location_code: 2840,
                platform,
                target: [{ keyword: prompt }],
                limit: 100,
            };
            const outcomes = await dataForSeoRequest(cfg, '/ai_optimization/llm_mentions/search/live', [body], mentionsSearchResultSchema, { operation: 'ai-mentions-search' });
            const outcome = outcomes[0];
            if (!outcome || outcome.status !== 'ok') {
                throw new VendorMalformedError('ai_optimization/llm_mentions/search/live returned no ok tasks', CTX_MENTIONS);
            }
            const items = outcome.result ?? [];
            // Vendor reports a row per (domain, keyword) that appears. We check
            // whether OUR domain shows up for this prompt on this platform.
            const hit = items.find((it) => typeof it.domain === 'string' &&
                it.domain.toLowerCase() === target);
            const citedUrl = hit && typeof (hit.url ?? hit.source_url) === 'string'
                ? String(hit.url ?? hit.source_url)
                : undefined;
            rows.push({
                prompt,
                model: platform,
                mentioned: Boolean(hit),
                ...(citedUrl && citedUrl.length > 0 ? { citedUrl } : {}),
                checkedAt: nowFn(),
            });
        }
        return rows;
    }
    async function checkMentions(input: AiMentionCheckInput): Promise<AiMentionRow[]> {
        const out: AiMentionRow[] = [];
        for (const prompt of input.prompts) {
            const rows = await checkMentionsForPrompt(prompt, input.domain);
            out.push(...rows);
        }
        return out;
    }
    async function callLlmResponses(engineSegment: string, prompt: string): Promise<z.infer<typeof answerResultSchema>> {
        const body = {
            user_prompt: prompt,
            message_chain: [{ role: 'user', message: prompt }],
            web_search: true,
            // Cost bound: llm_responses bills the $0.0006 Live base PLUS the
            // underlying model's token/web-search passthrough. Capping the output
            // keeps that passthrough inside the allowance budgeted per check in
            // `shared/billing/vendor-costs.ts` (vendor docs warn output can still
            // exceed the cap when web_search fires — the allowance absorbs that).
            max_output_tokens: 1024,
        };
        const outcomes = await dataForSeoRequest(cfg, `/ai_optimization/${engineSegment}/llm_responses/live`, [body], answerResultSchema, { operation: 'ai-llm-responses' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError(`ai_optimization/${engineSegment}/llm_responses/live returned no ok tasks`, CTX_ANSWERS);
        }
        return outcome.result;
    }
    async function getAnswers(input: AiAnswerInput): Promise<AiAnswerRow[]> {
        const rows: AiAnswerRow[] = [];
        for (const prompt of input.prompts) {
            for (const model of input.models) {
                const engineSegment = LLM_RESPONSES_ENGINE_SEGMENTS[model.toLowerCase()];
                if (!engineSegment) {
                    throw new VendorMalformedError(`unknown LLM Responses engine "${model}"`, CTX_ANSWERS);
                }
                const result = await callLlmResponses(engineSegment, prompt);
                const outerResult = result?.[0];
                const items = outerResult?.items ?? [];
                if (items.length === 0) {
                    // Engine returned no items — normalize to a single empty row so
                    // downstream aggregation gets one row per (prompt × model).
                    const fallbackText = extractAnswerText({ message: outerResult?.message ?? null, response: outerResult?.response ?? null }, null);
                    const fallbackCitations = extractCitations({ annotations: outerResult?.annotations ?? null }, null);
                    rows.push({
                        prompt,
                        model,
                        answer: fallbackText,
                        citations: fallbackCitations,
                        checkedAt: nowFn(),
                    });
                    continue;
                }
                for (const item of items) {
                    rows.push({
                        prompt,
                        model,
                        answer: extractAnswerText(item, outerResult?.message ?? null),
                        citations: extractCitations(item, outerResult?.annotations ?? null),
                        checkedAt: nowFn(),
                    });
                }
            }
        }
        return rows;
    }
    async function getAiKeywordVolume(keywords: string[], location: number, language: string): Promise<AiKeywordVolume[]> {
        const deduped: string[] = [];
        const seen = new Set<string>();
        for (const raw of keywords) {
            const kw = raw.trim().toLowerCase();
            if (kw.length === 0 || seen.has(kw))
                continue;
            seen.add(kw);
            deduped.push(kw);
        }
        if (deduped.length === 0)
            return [];
        const body = {
            keywords: deduped.slice(0, AI_VISIBILITY_MAX_BATCH),
            location_code: location,
            language_code: language.toLowerCase(),
        };
        const outcomes = await dataForSeoRequest(cfg, '/ai_optimization/ai_keyword_data/keywords_search_volume/live', [body], keywordVolumeResultSchema, { operation: 'ai-keyword-volume' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('ai_optimization/ai_keyword_data/keywords_search_volume/live returned no ok tasks', CTX_VOLUME);
        }
        const items = outcome.result?.[0]?.items ?? [];
        const byKeyword = new Map<string, number | null>();
        for (const item of items) {
            byKeyword.set(item.keyword.trim().toLowerCase(), typeof item.ai_search_volume === 'number' ? item.ai_search_volume : null);
        }
        return deduped.map((kw) => ({
            keyword: kw,
            aiSearchVolume: byKeyword.has(kw) ? byKeyword.get(kw) ?? null : null,
        }));
    }
    return { checkMentions, getAnswers, getAiKeywordVolume };
}
