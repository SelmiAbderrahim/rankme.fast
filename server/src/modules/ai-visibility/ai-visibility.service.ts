import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { logger } from '../../config/logger.js';
import type { AiAnswerRow, AiMentionRow, AiVisibilityProvider, GeneratedPrompt, GeneratePromptsResult, SummaryProvider, } from '../../shared/providers/index.js';
import { ProviderError, captureVendorCost } from '../../shared/providers/index.js';
import { createVendorArchiver, createVendorCacheRepo } from '../../shared/vendor-cache/index.js';
import type { Cooldown } from '../../shared/cooldown/index.js';
import { KEYWORD_MAX_LENGTH } from '../../shared/security/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { SupportedLocale } from '../../shared/i18n/locales.js';
import { Site } from '../sites/sites.model.js';
// Direct model imports (not the audits barrel) — same pattern as the Site
// import above; the barrel would drag routes/processor wiring into this
// module's import graph.
import { AuditRun } from '../audits/audit-run.model.js';
import { AuditedPage } from '../audits/audited-page.model.js';
import { aiCompetitorMentions, aiMentionSnapshots } from '../../db/schema/index.js';
import type { AiPromptSuggestionRow, NewAiCompetitorMentionRow, NewAiMentionSnapshotRow, } from '../../db/schema/index.js';
import { MAX_TRACKED_AI_PROMPTS, PromptCapReachedError, addTrackedPrompt, insertSuggestionRun, listGscQuerySeeds, listKeywordPhrases, listStoredCompetitorDomains, listTrackedPrompts, readLatestSuggestionRun, readAiOverviewRollup, readCompetitorDailyBuckets, readMentionDailyBuckets, readRecentCompetitorMentions, readRecentMentions, removeTrackedPrompt, type TrackedPrompt, } from './ai-visibility.repository.js';
export type AiSentiment = 'positive' | 'neutral' | 'negative';
/** Location/language every suggestion-related vendor call is priced against. */
export const SUGGESTION_LOCATION_CODE = 2840;
export const SUGGESTION_LANGUAGE_CODE = 'en';
export interface AiVisibilityDeps {
    db: Db;
    provider: AiVisibilityProvider;
    summaryProvider?: SummaryProvider | null;
    cooldown?: Cooldown;
    now?: () => Date;
}
export interface AiVisibilityOverview {
    prompts: TrackedPrompt[];
    snapshots: Array<{
        prompt: string;
        model: string;
        mentioned: boolean;
        citedUrl: string | null;
        sentiment: AiSentiment | null;
        checkedAt: string;
    }>;
    shareOfVoicePct: number | null;
    sentiment: {
        positive: number;
        neutral: number;
        negative: number;
    };
    notMentionedPrompts: string[];
    checkedAt: string | null;
}
export interface SuggestedPrompt {
    prompt: string;
    /** Where the candidate came from: free templates or the AI generator. */
    source: 'template' | 'ai';
    /**
     * Taxonomy used by the panel to group and by the honesty tests to assert
     * the generation mix. AI rows carry model-assigned values; template rows
     * carry the static taxonomy of the template that built them.
     */
    funnelStage: AiPromptSuggestionRow['funnelStage'];
    promptType: AiPromptSuggestionRow['promptType'];
    intent: AiPromptSuggestionRow['intent'];
    branded: boolean | null;
    evidenceSource: AiPromptSuggestionRow['evidenceSource'];
    evidenceRef: string | null;
}
export interface StoredSuggestions {
    /**
     * ISO timestamp of the newest generation, or `null` when the account has
     * never generated for this site. Null means "never generated"; a non-null
     * value with an empty `suggestions` array means "generated, produced
     * nothing" — the panel renders different copy for each.
     */
    generatedAt: string | null;
    outputLocale: SupportedLocale;
    suggestions: SuggestedPrompt[];
}
function isValidObjectId(id: string): boolean {
    return Types.ObjectId.isValid(id);
}
export async function loadOwnedSite(input: {
    siteId: string;
    accountId: string;
}): Promise<{
    id: string;
    domain: string;
}> {
    if (!isValidObjectId(input.siteId))
        throw HttpError.notFound({ code: 'AI_VISIBILITY_ERRORS_SITE_NOT_FOUND', messageKey: 'aiVisibility.errors.siteNotFound' });
    const site = await Site.findOne({
        _id: input.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    });
    if (!site)
        throw HttpError.notFound({ code: 'AI_VISIBILITY_ERRORS_SITE_NOT_FOUND', messageKey: 'aiVisibility.errors.siteNotFound' });
    return { id: (site._id as Types.ObjectId).toString(), domain: site.domain };
}
function wrapProviderError(err: unknown): never {
    if (err instanceof ProviderError) {
        throw new HttpError(503, { code: 'AI_VISIBILITY_ERRORS_UNAVAILABLE', messageKey: 'aiVisibility.errors.unavailable' }, undefined, { cause: err });
    }
    throw err;
}
function domainInText(value: string, domain: string): boolean {
    return value.toLowerCase().includes(domain.toLowerCase());
}
export function heuristicSentiment(answer: string, domain: string): AiSentiment {
    const lower = answer.toLowerCase();
    const positive = ['best', 'strong', 'recommended', 'trusted', 'excellent', 'solid', 'warm'];
    const negative = ['bad', 'poor', 'avoid', 'weak', 'expensive', 'unreliable', 'problem'];
    const nearBrand = domainInText(lower, domain) ? lower : '';
    const positiveScore = positive.filter((word) => nearBrand.includes(word)).length;
    const negativeScore = negative.filter((word) => nearBrand.includes(word)).length;
    if (negativeScore > positiveScore)
        return 'negative';
    if (positiveScore > negativeScore)
        return 'positive';
    return 'neutral';
}
export async function classifySentiment(input: {
    answer: string;
    domain: string;
    accountId?: string;
    siteId?: string;
    summaryProvider?: SummaryProvider | null;
}): Promise<AiSentiment> {
    if (!input.summaryProvider)
        return heuristicSentiment(input.answer, input.domain);
    try {
        const result = await input.summaryProvider.summarize({
            locale: 'en',
            siteDomain: input.domain,
            findings: [
                {
                    ruleId: 'ai-visibility-sentiment',
                    title: `Classify how this AI chat answer talks about ${input.domain}`,
                    why: input.answer.slice(0, 1000),
                    fix: 'Return one word: positive, neutral, or negative.',
                    affectedCount: 1,
                },
            ],
            usage: {
                accountId: input.accountId ?? 'summary-compatibility',
                siteId: input.siteId ?? null,
            },
        });
        const text = result.summary.toLowerCase();
        if (text.includes('negative'))
            return 'negative';
        if (text.includes('positive'))
            return 'positive';
        return 'neutral';
    }
    catch {
        return heuristicSentiment(input.answer, input.domain);
    }
}
function modelsFromMentions(rows: AiMentionRow[]): string[] {
    const supportedModels = new Set(['chatgpt', 'perplexity', 'claude', 'gemini']);
    const models = rows
        .map((row) => row.model.trim().toLowerCase())
        .map((model) => (model === 'chat_gpt' ? 'chatgpt' : model))
        .filter((model) => supportedModels.has(model));
    return models.length > 0 ? Array.from(new Set(models)) : ['chatgpt', 'perplexity', 'claude'];
}
function latestSince(now: Date): Date {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}
export function computeShareOfVoicePct(input: {
    brandMentionedCount: number;
    competitorMentionedCount: number;
}): number | null {
    const total = input.brandMentionedCount + input.competitorMentionedCount;
    if (total === 0)
        return null;
    return Math.round((input.brandMentionedCount / total) * 100);
}
function summarizeRows(prompts: TrackedPrompt[], mentionRows: Awaited<ReturnType<typeof readRecentMentions>>, competitorRows: Awaited<ReturnType<typeof readRecentCompetitorMentions>>): AiVisibilityOverview {
    const sentiment = { positive: 0, neutral: 0, negative: 0 };
    for (const row of mentionRows) {
        if (row.sentiment)
            sentiment[row.sentiment] += 1;
    }
    const mentionedPrompts = new Set(mentionRows.filter((row) => row.mentioned).map((row) => row.prompt));
    const competitorMentionedCount = competitorRows.filter((row) => row.mentioned).length;
    const shareOfVoicePct = computeShareOfVoicePct({
        brandMentionedCount: mentionRows.filter((row) => row.mentioned).length,
        competitorMentionedCount,
    });
    const checkedAt = mentionRows[0]?.checkedAt?.toISOString() ?? null;
    return {
        prompts,
        snapshots: mentionRows.map((row) => ({
            prompt: row.prompt,
            model: row.model,
            mentioned: row.mentioned,
            citedUrl: row.citedUrl,
            sentiment: row.sentiment,
            checkedAt: row.checkedAt.toISOString(),
        })),
        shareOfVoicePct,
        sentiment,
        notMentionedPrompts: prompts
            .map((row) => row.prompt)
            .filter((prompt) => !mentionedPrompts.has(prompt))
            .slice(0, 3),
        checkedAt,
    };
}
export async function getAiVisibilityOverview(input: {
    accountId: string;
    siteId: string;
}, deps: {
    db: Db;
    now?: () => Date;
}): Promise<AiVisibilityOverview> {
    const site = await loadOwnedSite(input);
    const prompts = await listTrackedPrompts(deps.db, { accountId: input.accountId, siteId: site.id });
    const since = latestSince((deps.now ?? (() => new Date()))());
    const [mentions, competitorMentions] = await Promise.all([
        readRecentMentions(deps.db, { accountId: input.accountId, siteId: site.id, since }),
        readRecentCompetitorMentions(deps.db, { accountId: input.accountId, siteId: site.id, since }),
    ]);
    return summarizeRows(prompts, mentions, competitorMentions);
}
export async function addPromptForSite(input: {
    accountId: string;
    siteId: string;
    prompt: string;
}, deps: {
    db: Db;
}): Promise<TrackedPrompt> {
    const site = await loadOwnedSite(input);
    try {
        return await addTrackedPrompt(deps.db, {
            accountId: input.accountId,
            siteId: site.id,
            prompt: input.prompt,
        });
    }
    catch (err) {
        if (err instanceof PromptCapReachedError) {
            throw new HttpError(409, { code: 'AI_VISIBILITY_ERRORS_PROMPT_CAP_REACHED', messageKey: 'aiVisibility.errors.promptCapReached' }, {
                limit: MAX_TRACKED_AI_PROMPTS,
            });
        }
        throw err;
    }
}
export async function removePromptForSite(input: {
    accountId: string;
    siteId: string;
    promptId: string;
}, deps: {
    db: Db;
}): Promise<void> {
    const site = await loadOwnedSite(input);
    const removed = await removeTrackedPrompt(deps.db, {
        accountId: input.accountId,
        siteId: site.id,
        promptId: input.promptId,
    });
    if (!removed)
        throw HttpError.notFound({ code: 'AI_VISIBILITY_ERRORS_PROMPT_NOT_FOUND', messageKey: 'aiVisibility.errors.promptNotFound' });
}
export async function checkMentions(input: {
    accountId: string;
    siteId: string;
}, deps: AiVisibilityDeps): Promise<AiVisibilityOverview> {
    const nowFn = deps.now ?? (() => new Date());
    const site = await loadOwnedSite(input);
    const paused = await Site.exists({ _id: site.id, accountId: input.accountId, paused: true });
    if (paused)
        throw HttpError.conflict({ code: 'SITES_ERRORS_PAUSED', messageKey: 'sites.errors.paused' });
    deps.cooldown?.assert(`ai-visibility:${site.id}`);
    const prompts = await listTrackedPrompts(deps.db, { accountId: input.accountId, siteId: site.id });
    if (prompts.length === 0)
        return getAiVisibilityOverview(input, deps);
    deps.cooldown?.touch(`ai-visibility:${site.id}`);
    const promptTexts = prompts.map((row) => row.prompt);
    let mentionRows: AiMentionRow[];
    let answerRows: AiAnswerRow[];
    let checkCostMicros: bigint | null;
    try {
        // One capture spans the whole mentions + answers fan-out so the archive
        // row below carries the summed actual vendor spend.
        const captured = await captureVendorCost(async () => {
            const mentions = await deps.provider.checkMentions({
                domain: site.domain,
                prompts: promptTexts,
            });
            const answers = await deps.provider.getAnswers({
                prompts: promptTexts,
                models: modelsFromMentions(mentions),
            });
            return { mentions, answers };
        });
        mentionRows = captured.value.mentions;
        answerRows = captured.value.answers;
        checkCostMicros = captured.costMicros;
    }
    catch (err) {
        wrapProviderError(err);
    }
    // Save-everything: the normalized vendor output is archived append-only
    // (per-account — AI-visibility data is never served cross-user).
    await createVendorArchiver(createVendorCacheRepo(deps.db))({
        capability: 'ai-visibility',
        operation: 'check-mentions',
        params: { domain: site.domain, promptCount: promptTexts.length },
        payload: { mentions: mentionRows, answers: answerRows },
        accountId: input.accountId,
        costMicros: checkCostMicros,
        fetchedAt: nowFn(),
    });
    const competitors = await listStoredCompetitorDomains(deps.db, {
        accountId: input.accountId,
        siteId: site.id,
    });
    const answersByKey = new Map(answerRows.map((row) => [`${row.prompt}::${row.model}`, row]));
    const mentionInserts: NewAiMentionSnapshotRow[] = [];
    const competitorInserts: NewAiCompetitorMentionRow[] = [];
    // Cost bound: provider-backed sentiment is one generation call per matched
    // mention-with-answer, at most FOUR such calls per prompt (one per
    // platform); past the budget the free heuristic classifier takes over so a
    // pathological fan-out can never run away with vendor spend.
    const sentimentBudget = 4 * promptTexts.length;
    let sentimentCalls = 0;
    const takeSentimentProvider = (): SummaryProvider | null => {
        if (sentimentCalls >= sentimentBudget)
            return null;
        const provider = deps.summaryProvider ?? null;
        if (provider)
            sentimentCalls += 1;
        return provider;
    };
    for (const mention of mentionRows) {
        const answer = answersByKey.get(`${mention.prompt}::${mention.model}`);
        const sentiment = answer && answer.answer.trim().length > 0
            ? await classifySentiment({
                answer: answer.answer,
                domain: site.domain,
                accountId: input.accountId,
                siteId: site.id,
                summaryProvider: takeSentimentProvider(),
            })
            : null;
        mentionInserts.push({
            accountId: input.accountId,
            siteId: site.id,
            prompt: mention.prompt,
            model: mention.model,
            mentioned: mention.mentioned,
            citedUrl: mention.citedUrl ?? null,
            sentiment,
            checkedAt: mention.checkedAt,
        });
        if (!answer)
            continue;
        for (const competitorDomain of competitors) {
            competitorInserts.push({
                accountId: input.accountId,
                siteId: site.id,
                prompt: answer.prompt,
                model: answer.model,
                competitorDomain,
                mentioned: domainInText(answer.answer, competitorDomain),
                cited: answer.citations.some((url) => domainInText(url, competitorDomain)),
                checkedAt: answer.checkedAt,
            });
        }
    }
    await deps.db.transaction(async (tx) => {
        if (mentionInserts.length > 0)
            await tx.insert(aiMentionSnapshots).values(mentionInserts);
        if (competitorInserts.length > 0) {
            await tx.insert(aiCompetitorMentions).values(competitorInserts);
        }
    });
    return getAiVisibilityOverview(input, { db: deps.db, now: nowFn });
}
/** Suggestions returned per fetch; free paths never exceed it, paid ranking trims to it. */
export const SUGGESTION_TARGET = 8;
const MAX_PROMPT_CANDIDATES = 20;
const MIN_SEED_LENGTH = 3;
const MAX_SEED_LENGTH = 120;
/** Taxonomy a template candidate carries — same enums as the AI rows. */
type TemplateTaxonomy = Pick<SuggestedPrompt, 'funnelStage' | 'promptType' | 'intent' | 'branded'>;
/** A template-built candidate: prompt text plus the taxonomy + evidence trail. */
export interface TemplateCandidate extends TemplateTaxonomy {
    prompt: string;
    evidenceSource: AiPromptSuggestionRow['evidenceSource'];
    evidenceRef: string;
}
const PROMPT_TEMPLATE_TAXONOMY: ReadonlyArray<TemplateTaxonomy> = [
    {
        promptType: 'categoryDiscovery',
        funnelStage: 'consideration',
        intent: 'commercial',
        branded: false,
    },
    {
        promptType: 'categoryDiscovery',
        funnelStage: 'consideration',
        intent: 'commercial',
        branded: false,
    },
    {
        promptType: 'categoryDiscovery',
        funnelStage: 'awareness',
        intent: 'informational',
        branded: false,
    },
    {
        promptType: 'objection',
        funnelStage: 'decision',
        intent: 'commercial',
        branded: false,
    },
];
interface PromptTemplateCatalog {
    casts: readonly [
        (seed: string) => string,
        (seed: string) => string,
        (seed: string) => string,
        (seed: string) => string
    ];
    comparison: (siteDomain: string, competitorDomain: string) => string;
    alternative: (competitorDomain: string) => string;
}
/** Authored product prose. Interpolated source tokens remain byte-for-byte intact. */
const PROMPT_TEMPLATE_CATALOGS: Record<SupportedLocale, PromptTemplateCatalog> = {
    en: {
        casts: [
            (seed) => `best ${seed}`,
            (seed) => `which ${seed} should I use`,
            (seed) => `how to choose ${seed}`,
            (seed) => `is ${seed} worth it`,
        ],
        comparison: (site, competitor) => `${site} vs ${competitor}`,
        alternative: (competitor) => `${competitor} alternative`,
    },
    ar: {
        casts: [
            (seed) => `أفضل ${seed}`,
            (seed) => `أي ${seed} ينبغي أن أستخدم؟`,
            (seed) => `كيف أختار ${seed}؟`,
            (seed) => `هل يستحق ${seed} ذلك؟`,
        ],
        comparison: (site, competitor) => `${site} مقابل ${competitor}`,
        alternative: (competitor) => `بديل لـ ${competitor}`,
    },
    fr: {
        casts: [
            (seed) => `meilleur ${seed}`,
            (seed) => `quel ${seed} choisir ?`,
            (seed) => `comment choisir ${seed} ?`,
            (seed) => `${seed} vaut-il le coup ?`,
        ],
        comparison: (site, competitor) => `${site} ou ${competitor}`,
        alternative: (competitor) => `alternative à ${competitor}`,
    },
    de: {
        casts: [
            (seed) => `beste ${seed}`,
            (seed) => `welches ${seed} sollte ich verwenden?`,
            (seed) => `wie wähle ich ${seed} aus?`,
            (seed) => `lohnt sich ${seed}?`,
        ],
        comparison: (site, competitor) => `${site} vs. ${competitor}`,
        alternative: (competitor) => `Alternative zu ${competitor}`,
    },
    es: {
        casts: [
            (seed) => `mejor ${seed}`,
            (seed) => `qué ${seed} debería usar`,
            (seed) => `cómo elegir ${seed}`,
            (seed) => `merece la pena ${seed}`,
        ],
        comparison: (site, competitor) => `${site} frente a ${competitor}`,
        alternative: (competitor) => `alternativa a ${competitor}`,
    },
    ru: {
        casts: [
            (seed) => `лучший ${seed}`,
            (seed) => `какой ${seed} выбрать`,
            (seed) => `как выбрать ${seed}`,
            (seed) => `стоит ли использовать ${seed}`,
        ],
        comparison: (site, competitor) => `${site} или ${competitor}`,
        alternative: (competitor) => `альтернатива ${competitor}`,
    },
    zh: {
        casts: [
            (seed) => `最佳${seed}`,
            (seed) => `应该使用哪个${seed}`,
            (seed) => `如何选择${seed}`,
            (seed) => `${seed}值得使用吗`,
        ],
        comparison: (site, competitor) => `${site}与${competitor}对比`,
        alternative: (competitor) => `${competitor}的替代方案`,
    },
};
const promptTemplatesFor = (locale: SupportedLocale): ReadonlyArray<{
    cast: (seed: string) => string;
    taxonomy: TemplateTaxonomy;
}> => PROMPT_TEMPLATE_CATALOGS[locale].casts.map((cast, index) => ({
    cast,
    taxonomy: PROMPT_TEMPLATE_TAXONOMY[index]!,
}));
/**
 * Pure candidate builder — zero vendor spend. Every seed is site-scoped by the
 * caller's reads: tracked keywords, real GSC queries, then audit titles/H1s,
 * in that signal order. Competitor match-ups lead (highest buyer intent), then
 * each seed is cast through a rotating question template so the 20-candidate
 * cap covers many seeds instead of one seed's four variants. Each candidate
 * carries the template's taxonomy and the seed it derives from, so template
 * fallback rows group in the panel the same way AI rows do.
 */
export function buildPromptCandidates(input: {
    domain: string;
    outputLocale: SupportedLocale;
    keywords: string[];
    gscQueries: string[];
    titleSeeds: string[];
    competitorDomains: string[];
}): TemplateCandidate[] {
    const catalog = PROMPT_TEMPLATE_CATALOGS[input.outputLocale];
    const promptTemplates = promptTemplatesFor(input.outputLocale);
    const seeds: Array<{
        seed: string;
        evidenceSource: AiPromptSuggestionRow['evidenceSource'];
    }> = [];
    const seenSeeds = new Set<string>();
    const collect = (raw: string, evidenceSource: AiPromptSuggestionRow['evidenceSource']): void => {
        const seed = raw.trim();
        const identity = seed.toLocaleLowerCase('en-US');
        if (seed.length < MIN_SEED_LENGTH ||
            seed.length > MAX_SEED_LENGTH ||
            seenSeeds.has(identity)) {
            return;
        }
        seenSeeds.add(identity);
        seeds.push({ seed, evidenceSource });
    };
    for (const raw of input.keywords)
        collect(raw, 'keyword');
    for (const raw of input.gscQueries)
        collect(raw, 'gsc');
    for (const raw of input.titleSeeds)
        collect(raw, 'title');
    const out: TemplateCandidate[] = [];
    const seen = new Set<string>();
    const push = (candidate: TemplateCandidate): void => {
        if (out.length >= MAX_PROMPT_CANDIDATES)
            return;
        const trimmed = candidate.prompt.trim();
        const key = trimmed.toLowerCase();
        if (trimmed.length < 4 || trimmed.length > 280 || seen.has(key))
            return;
        seen.add(key);
        out.push({ ...candidate, prompt: trimmed });
    };
    for (const domain of input.competitorDomains) {
        push({
            prompt: catalog.comparison(input.domain, domain),
            promptType: 'comparison',
            funnelStage: 'decision',
            intent: 'commercial',
            // Contains the site's own domain, so it IS a branded prompt.
            branded: true,
            evidenceSource: 'competitor',
            evidenceRef: domain,
        });
        push({
            prompt: catalog.alternative(domain),
            promptType: 'alternatives',
            funnelStage: 'consideration',
            intent: 'commercial',
            // Names only the competitor — unbranded discovery from our side.
            branded: false,
            evidenceSource: 'competitor',
            evidenceRef: domain,
        });
    }
    for (let round = 0; round < promptTemplates.length; round += 1) {
        seeds.forEach((entry, index) => {
            const template = promptTemplates[(round + index) % promptTemplates.length]!;
            push({
                prompt: template.cast(entry.seed),
                ...template.taxonomy,
                evidenceSource: entry.evidenceSource,
                evidenceRef: entry.seed,
            });
        });
    }
    return out;
}
const TITLE_SEPARATORS = /[|–—•·:]/;
/**
 * Topic seeds from the site's latest succeeded audit: page titles and H1s,
 * first segment before separators, length-filtered. Free — the crawl already
 * paid for this data.
 */
export async function listAuditTitleSeeds(input: {
    accountId: string;
    siteId: string;
    pageLimit?: number;
    seedLimit?: number;
}): Promise<string[]> {
    const run = await AuditRun.findOne({
        siteId: input.siteId,
        accountId: input.accountId,
        status: 'succeeded',
        kind: 'site',
    }).sort({ finishedAt: -1 });
    if (!run)
        return [];
    const pages = await AuditedPage.find({ runId: run._id })
        .sort({ onPageScore: -1 })
        .limit(input.pageLimit ?? 20)
        .select('title h1');
    const seen = new Set<string>();
    const seeds: string[] = [];
    const seedLimit = input.seedLimit ?? 15;
    for (const page of pages) {
        for (const raw of [page.title ?? '', ...page.h1]) {
            // split() always yields at least one element.
            const seed = raw.split(TITLE_SEPARATORS)[0]!.trim().toLowerCase();
            if (seed.length < 8 || seed.length > 80 || seen.has(seed))
                continue;
            seen.add(seed);
            seeds.push(seed);
            if (seeds.length >= seedLimit)
                return seeds;
        }
    }
    return seeds;
}
/** AI rows first: trim, drop blanks/dupes, cap at the target. */
function collectGeneratedPrompts(prompts: GeneratedPrompt[]): SuggestedPrompt[] {
    const candidates: SuggestedPrompt[] = [];
    const seen = new Set<string>();
    for (const row of prompts) {
        if (candidates.length >= SUGGESTION_TARGET)
            break;
        const prompt = row.promptText.trim().slice(0, 280);
        const key = prompt.toLowerCase();
        if (!prompt || seen.has(key))
            continue;
        seen.add(key);
        candidates.push({
            prompt,
            source: 'ai',
            funnelStage: row.funnelStage,
            promptType: row.promptType,
            intent: row.intent,
            branded: row.branded,
            evidenceSource: row.evidenceSource,
            evidenceRef: row.evidenceRef.trim().slice(0, 280),
        });
    }
    return candidates;
}
/**
 * Free, unmetered read of the newest stored suggestion set.
 *
 * Reading never spends: a reload, a tab switch, or a second browser must not
 * cost the user a generation they already paid for. `generatedAt: null` means
 * the account has never generated for this site, which is what lets the panel
 * distinguish an untouched tab from a run that legitimately produced nothing.
 */
export async function readStoredSuggestions(input: {
    accountId: string;
    siteId: string;
    outputLocale: SupportedLocale;
}, deps: Pick<AiVisibilityDeps, 'db'>): Promise<StoredSuggestions> {
    const site = await loadOwnedSite(input);
    const run = await readLatestSuggestionRun(deps.db, {
        accountId: input.accountId,
        siteId: site.id,
        outputLocale: input.outputLocale,
    });
    if (!run) {
        return { generatedAt: null, outputLocale: input.outputLocale, suggestions: [] };
    }
    return {
        generatedAt: run.generatedAt.toISOString(),
        outputLocale: run.outputLocale,
        suggestions: run.prompts.map((row) => ({
            prompt: row.prompt,
            source: row.source,
            funnelStage: row.funnelStage,
            promptType: row.promptType,
            intent: row.intent,
            branded: row.branded,
            evidenceSource: row.evidenceSource,
            evidenceRef: row.evidenceRef,
        })),
    };
}
/**
 * Prompt-suggestion generation — one click of "Generate suggestions".
 *
 * Ordering: parse → own → paused → debounce → assemble free seeds →
 * non-spending preflight → arm cooldown → AI call → persist.
 *
 * Every seed is already-paid-for first-party data — tracked keywords, crawled
 * page titles/H1s, stored competitor domains, and stored GSC queries — so the
 * AI call is the only vendor spend in the path. There is no SERP, keyword-ideas
 * or AI-keyword-volume call: a single volume-ranking call cost 550_000 micros
 * against a 15_000 envelope, and the number it returned was Google
 * / People-Also-Ask data mislabelled as AI demand.
 *
 * The run fails (502) iff the provider threw AND nothing was retained. A run
 * that fell back to templates succeeds, because the user received usable
 * output.
 */
export async function generatePromptSuggestions(input: {
    accountId: string;
    siteId: string;
    outputLocale: SupportedLocale;
}, deps: AiVisibilityDeps): Promise<StoredSuggestions> {
    const nowFn = deps.now ?? (() => new Date());
    const site = await loadOwnedSite(input);
    const paused = await Site.exists({ _id: site.id, accountId: input.accountId, paused: true });
    if (paused)
        throw HttpError.conflict({ code: 'SITES_ERRORS_PAUSED', messageKey: 'sites.errors.paused' });
    deps.cooldown?.assert(`ai-visibility:suggest:${site.id}`);
    // Free seed assembly — four reads, zero vendor spend. Every read filters on
    // BOTH accountId and siteId: an account-global source (the old
    // keyword-research history read) once leaked another site's phrases into
    // this site's suggestions, so site scoping here is load-bearing.
    const [keywords, competitorDomains, titleSeeds, gscQueries] = await Promise.all([
        listKeywordPhrases(deps.db, { accountId: input.accountId, siteId: site.id }),
        listStoredCompetitorDomains(deps.db, {
            accountId: input.accountId,
            siteId: site.id,
            limit: 5,
        }),
        listAuditTitleSeeds({ accountId: input.accountId, siteId: site.id }),
        listGscQuerySeeds(deps.db, { accountId: input.accountId, siteId: site.id, limit: 15 }),
    ]);
    const seeds = {
        keywords: keywords.slice(0, 15).map((keyword) => keyword.slice(0, KEYWORD_MAX_LENGTH)),
        titles: titleSeeds.slice(0, 15),
        competitors: competitorDomains.slice(0, 15),
        gscQueries,
    };
    const generationInput = {
        siteDomain: site.domain,
        locale: input.outputLocale,
        count: SUGGESTION_TARGET,
        seeds,
        usage: { accountId: input.accountId, siteId: site.id },
    };
    // Non-spending profile validation BEFORE the AI call: a defect in our
    // assembled input is not a provider failure and must surface as such.
    if (deps.summaryProvider) {
        deps.summaryProvider.preflightGeneratePrompts?.(generationInput);
    }
    deps.cooldown?.touch(`ai-visibility:suggest:${site.id}`);
    const runId = randomUUID();
    const templates: SuggestedPrompt[] = buildPromptCandidates({
        domain: site.domain,
        outputLocale: input.outputLocale,
        keywords,
        gscQueries,
        titleSeeds,
        competitorDomains,
    }).map((candidate) => ({
        ...candidate,
        source: 'template' as const,
    }));
    let generated: GeneratePromptsResult | null = null;
    let providerFailed = false;
    if (deps.summaryProvider) {
        try {
            generated = await deps.summaryProvider.generatePrompts(generationInput);
        }
        catch (err) {
            // Never silent: an all-template response downstream means this fired (or
            // the runner's invariants zeroed the set) — ops needs the reason.
            logger.warn({ err, accountId: input.accountId, siteId: site.id }, 'ai-visibility prompt suggestion provider failed; falling back to templates');
            providerFailed = true;
        }
    }
    const retained: SuggestedPrompt[] = generated ? collectGeneratedPrompts(generated.prompts) : [];
    // Templates backfill whatever the model did not produce, so a site with no
    // GSC connection and a thin seed set still gets something usable.
    for (const row of templates) {
        if (retained.length >= SUGGESTION_TARGET)
            break;
        if (retained.some((kept) => kept.prompt.toLowerCase() === row.prompt.toLowerCase()))
            continue;
        retained.push(row);
    }
    if (providerFailed && retained.length === 0) {
        // Nothing was retained and the spend never produced anything.
        throw new HttpError(502, { code: 'AI_VISIBILITY_ERRORS_SUGGESTION_FAILED', messageKey: 'aiVisibility.errors.suggestionFailed' });
    }
    const usedAi = retained.some((row) => row.source === 'ai');
    const generatedAt = nowFn();
    await insertSuggestionRun(deps.db, {
        id: runId,
        accountId: input.accountId,
        siteId: site.id,
        outputLocale: input.outputLocale,
        prompts: retained.map((row) => ({
            prompt: row.prompt,
            source: row.source,
            funnelStage: row.funnelStage,
            promptType: row.promptType,
            intent: row.intent,
            branded: row.branded,
            evidenceSource: row.evidenceSource,
            evidenceRef: row.evidenceRef,
        })),
        seeds,
        generator: usedAi ? 'ai' : 'template',
        model: usedAi && generated ? generated.model : null,
        generatedAt,
    });
    return {
        generatedAt: generatedAt.toISOString(),
        outputLocale: input.outputLocale,
        suggestions: retained,
    };
}
export interface AiVisibilityTrendPoint {
    day: string;
    /** Share of that day's snapshot rows with `mentioned=true`; null on competitor-only days. */
    mentionedRatePct: number | null;
    shareOfVoicePct: number | null;
    checks: number;
}
export async function getAiVisibilityTrend(input: {
    accountId: string;
    siteId: string;
    days?: number;
}, deps: {
    db: Db;
    now?: () => Date;
}): Promise<{
    points: AiVisibilityTrendPoint[];
}> {
    const site = await loadOwnedSite(input);
    const nowFn = deps.now ?? (() => new Date());
    const days = input.days ?? 90;
    const since = new Date(nowFn().getTime() - days * 24 * 60 * 60 * 1000);
    const [brandBuckets, competitorBuckets] = await Promise.all([
        readMentionDailyBuckets(deps.db, { accountId: input.accountId, siteId: site.id, since }),
        readCompetitorDailyBuckets(deps.db, { accountId: input.accountId, siteId: site.id, since }),
    ]);
    const brandByDay = new Map(brandBuckets.map((bucket) => [bucket.day, bucket]));
    const competitorByDay = new Map(competitorBuckets.map((bucket) => [bucket.day, bucket.mentioned]));
    const dayKeys = Array.from(new Set([...brandByDay.keys(), ...competitorByDay.keys()])).sort();
    return {
        points: dayKeys.map((day) => {
            const brand = brandByDay.get(day);
            return {
                day,
                mentionedRatePct: brand ? Math.round((brand.mentioned / brand.total) * 100) : null,
                shareOfVoicePct: computeShareOfVoicePct({
                    brandMentionedCount: brand?.mentioned ?? 0,
                    competitorMentionedCount: competitorByDay.get(day) ?? 0,
                }),
                checks: brand?.total ?? 0,
            };
        }),
    };
}
export async function buildAiVisibilityEvaluationInput(db: Db, input: {
    siteId: string;
    accountId: string;
    now?: Date;
}) {
    const prompts = await listTrackedPrompts(db, input);
    if (prompts.length === 0) {
        return {
            status: 'no-prompts-tracked' as const,
            aiOverviewCitedCount: 0,
            aiOverviewTotalChecked: 0,
            llmMentionedCount: 0,
            llmTotalChecked: 0,
            shareOfVoicePct: null,
            negativeSentimentCount: 0,
            competitorsPresent: false,
        };
    }
    const since = latestSince(input.now ?? new Date());
    const [mentions, competitorMentions] = await Promise.all([
        readRecentMentions(db, { accountId: input.accountId, siteId: input.siteId, since }),
        readRecentCompetitorMentions(db, { accountId: input.accountId, siteId: input.siteId, since }),
    ]);
    const aiOverview = await readAiOverviewRollup(db, {
        accountId: input.accountId,
        siteId: input.siteId,
        since,
    });
    const brand = mentions.filter((row) => row.mentioned).length;
    const competitorMentioned = competitorMentions.filter((row) => row.mentioned).length;
    return {
        status: 'ok' as const,
        aiOverviewCitedCount: aiOverview.citedCount,
        aiOverviewTotalChecked: aiOverview.totalChecked,
        llmMentionedCount: brand,
        llmTotalChecked: mentions.length,
        shareOfVoicePct: computeShareOfVoicePct({
            brandMentionedCount: brand,
            competitorMentionedCount: competitorMentioned,
        }),
        negativeSentimentCount: mentions.filter((row) => row.sentiment === 'negative').length,
        competitorsPresent: competitorMentions.length > 0,
        sentiment: {
            positive: mentions.filter((row) => row.sentiment === 'positive').length,
            neutral: mentions.filter((row) => row.sentiment === 'neutral').length,
            negative: mentions.filter((row) => row.sentiment === 'negative').length,
        },
        notMentionedPrompts: prompts
            .map((row) => row.prompt)
            .filter((prompt) => !mentions.some((row) => row.prompt === prompt && row.mentioned))
            .slice(0, 3),
    };
}
export async function clearAiVisibilityRowsForTests(db: Db, siteId: string): Promise<void> {
    await db.delete(aiCompetitorMentions).where(eq(aiCompetitorMentions.siteId, siteId));
    await db.delete(aiMentionSnapshots).where(eq(aiMentionSnapshots.siteId, siteId));
}
