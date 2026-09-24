/**
 * Deterministic fake `SummaryProvider`.
 *
 * Used by feature tests and any environment where `PROVIDER_SUMMARY=fake`.
 * Failure injection mirrors the other fakes — pass a taxonomy error and
 * every call rejects with it.
 */
import type { ProviderError } from '../errors.js';
import type { SupportedLocale } from '../../i18n/locales.js';
import type { GeneratedPrompt, GeneratePromptsInput, GeneratePromptsResult, SummaryProvider, SummarizeInput, SummarizeResult, } from './types.js';
export interface FakeSummaryProviderOptions {
    result?: SummarizeResult;
    generated?: GeneratePromptsResult;
    failure?: ProviderError;
}
export const FAKE_SUMMARY_RESULT: SummarizeResult = {
    summary: 'Your audit found a few things worth fixing this week. Start with your page titles and broken links — both are quick wins that affect real visitors and search engines the moment you ship.',
    truncated: false,
    model: 'fake-summary-model',
};
interface FakePromptCopy {
    gsc: (token: string) => string;
    keyword: (token: string) => string;
    title: (token: string) => string;
    competitor: (token: string) => string;
    fallback: string;
}
/** Authored keyless-provider prose; source tokens are interpolated unchanged. */
const FAKE_PROMPT_COPY: Record<SupportedLocale, FakePromptCopy> = {
    en: {
        gsc: (token) => `I need help with ${token} — where should I start`,
        keyword: (token) => `what is the best ${token}`,
        title: (token) => `is ${token} worth paying for`,
        competitor: (token) => `what should I use instead of ${token}`,
        fallback: 'what is the best tool for my team',
    },
    ar: {
        gsc: (token) => `أحتاج إلى مساعدة بشأن ${token} — من أين أبدأ؟`,
        keyword: (token) => `ما أفضل ${token}؟`,
        title: (token) => `هل يستحق ${token} الدفع مقابله؟`,
        competitor: (token) => `ما الذي ينبغي أن أستخدمه بدلاً من ${token}؟`,
        fallback: 'ما أفضل أداة لفريقي؟',
    },
    fr: {
        gsc: (token) => `J’ai besoin d’aide pour ${token} — par où commencer ?`,
        keyword: (token) => `quel est le meilleur ${token} ?`,
        title: (token) => `${token} vaut-il son prix ?`,
        competitor: (token) => `que choisir à la place de ${token} ?`,
        fallback: 'quel est le meilleur outil pour mon équipe ?',
    },
    de: {
        gsc: (token) => `Ich brauche Hilfe bei ${token} — wo soll ich anfangen?`,
        keyword: (token) => `was ist das beste ${token}?`,
        title: (token) => `lohnt es sich, für ${token} zu bezahlen?`,
        competitor: (token) => `was sollte ich statt ${token} verwenden?`,
        fallback: 'welches Tool eignet sich am besten für mein Team?',
    },
    es: {
        gsc: (token) => `Necesito ayuda con ${token} — ¿por dónde empiezo?`,
        keyword: (token) => `cuál es el mejor ${token}`,
        title: (token) => `merece la pena pagar por ${token}`,
        competitor: (token) => `qué debería usar en lugar de ${token}`,
        fallback: 'cuál es la mejor herramienta para mi equipo',
    },
    ru: {
        gsc: (token) => `Мне нужна помощь с ${token} — с чего начать?`,
        keyword: (token) => `какой ${token} лучше всего`,
        title: (token) => `стоит ли платить за ${token}`,
        competitor: (token) => `что использовать вместо ${token}`,
        fallback: 'какой инструмент лучше всего подойдёт моей команде',
    },
    zh: {
        gsc: (token) => `我需要解决${token}，应该从哪里开始？`,
        keyword: (token) => `最好的${token}是什么？`,
        title: (token) => `${token}值得付费吗？`,
        competitor: (token) => `应该用什么替代${token}？`,
        fallback: '最适合我团队的工具是什么？',
    },
};
/**
 * Deterministic prompt generation: one buyer-style question per seed, in
 * evidence-quality order (gscQueries → keywords → titles → competitors),
 * capped at `input.count`. Seedless inputs fall back to a single generic
 * question so callers always see the append path exercised.
 *
 * Every row is built to SURVIVE the real task invariants in
 * `shared/ai-profiles/runner.ts`, so the fake and the live path retain the
 * same shape: `evidenceRef` echoes its seed verbatim, no prompt names the site
 * domain, and the mix stays inside the ≤35% `categoryDiscovery` / ≤35%
 * `branded` ceilings. Only the competitor rows are branded, and only the
 * keyword rows are `categoryDiscovery`, so a realistic seed spread lands well
 * under both ceilings.
 */
export function buildFakeGeneratedPrompts(input: GeneratePromptsInput): GeneratedPrompt[] {
    const copy = FAKE_PROMPT_COPY[input.locale];
    const rows: GeneratedPrompt[] = [
        ...input.seeds.gscQueries.map((query) => ({
            promptText: copy.gsc(query),
            funnelStage: 'awareness' as const,
            promptType: 'problemFirst' as const,
            intent: 'informational' as const,
            branded: false,
            evidenceSource: 'gsc' as const,
            evidenceRef: query,
        })),
        ...input.seeds.keywords.map((keyword) => ({
            promptText: copy.keyword(keyword),
            funnelStage: 'consideration' as const,
            promptType: 'categoryDiscovery' as const,
            intent: 'commercial' as const,
            branded: false,
            evidenceSource: 'keyword' as const,
            evidenceRef: keyword,
        })),
        ...input.seeds.titles.map((title) => ({
            promptText: copy.title(title),
            funnelStage: 'decision' as const,
            promptType: 'pricingCommercial' as const,
            intent: 'commercial' as const,
            branded: false,
            evidenceSource: 'title' as const,
            evidenceRef: title,
        })),
        ...input.seeds.competitors.map((competitor) => ({
            promptText: copy.competitor(competitor),
            funnelStage: 'consideration' as const,
            promptType: 'alternatives' as const,
            intent: 'commercial' as const,
            branded: true,
            evidenceSource: 'competitor' as const,
            evidenceRef: competitor,
        })),
    ];
    if (rows.length === 0) {
        rows.push({
            promptText: copy.fallback,
            funnelStage: 'awareness',
            promptType: 'categoryDiscovery',
            intent: 'informational',
            branded: false,
            evidenceSource: 'llmSynthesis',
            evidenceRef: input.siteDomain,
        });
    }
    const seen = new Set<string>();
    return rows
        .filter((row) => {
        const key = row.promptText.toLowerCase();
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    })
        .slice(0, Math.max(1, input.count));
}
export function createFakeSummaryProvider(opts: FakeSummaryProviderOptions = {}): SummaryProvider {
    const result = opts.result ?? FAKE_SUMMARY_RESULT;
    return {
        async summarize(_input: SummarizeInput): Promise<SummarizeResult> {
            if (opts.failure)
                throw opts.failure;
            return result;
        },
        async generatePrompts(input: GeneratePromptsInput): Promise<GeneratePromptsResult> {
            if (opts.failure)
                throw opts.failure;
            return (opts.generated ?? {
                prompts: buildFakeGeneratedPrompts(input),
                model: 'fake-summary-model',
            });
        },
    };
}
