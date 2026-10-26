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
import { INVENTORY_PAGE_FILTER } from '../audits/page-inventory.service.js';
import { MAX_TRACKED_AI_PROMPTS, PromptAlreadyTrackedError, PromptCapReachedError, trackedPromptKey, addTrackedPrompt, insertSuggestionRun, listAllSiteKeywordPhrases, listGscQuerySeeds, listKeywordPhrases, listStoredCompetitorDomains, listTrackedPrompts, readLatestSuggestionRun, readAiOverviewRollup, readCompetitorDailyBuckets, readMentionDailyBuckets, readRecentCompetitorMentions, readRecentMentions, removeTrackedPrompt, type TrackedPrompt, } from './ai-visibility.repository.js';
import { brandLabelOf, extractTitleTopic, pathLanguageOf, seedFitsLocale, } from './prompt-seed-quality.js';
import { buildPromptCandidates } from './prompt-candidates.js';
import { comparisonKey, guardSuggestionRows } from './prompt-output-guard.js';
import { resolveSuggestionLanguages } from './suggestion-languages.js';
import { buildSiteProfile, isNavigationalSeed, type EvidenceLevel, type EvidencePage, } from './site-profile.js';
export { MAX_PROMPT_CANDIDATES, TEMPLATES_PER_TOPIC, buildPromptCandidates } from './prompt-candidates.js';
export type { TemplateCandidate } from './prompt-candidates.js';
export type AiSentiment = 'positive' | 'neutral' | 'negative';
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
    /** Checked in the window and never mentioned (never-checked prompts are excluded). */
    notMentionedPrompts: string[];
    /** Tracked prompts with no completed check in the window. */
    notCheckedPrompts: string[];
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
    /** Language the prompt is written in; absent on rows stored before mixed-language runs. */
    language?: SupportedLocale;
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
    /**
     * How much stored evidence (crawled copy, keywords, search queries) the set
     * was built from. `limited` and `none` mean the panel must say so; `null`
     * means "unknown" (a run stored before the profile existed, or no run yet).
     */
    evidence: EvidenceLevel | null;
    /**
     * The newest stored run could not be shown because it was not built from
     * this site's own evidence (a run from before site scoping). Its prompts
     * are withheld; the panel offers "Regenerate suggestions".
     */
    stale: boolean;
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
    marketLanguage: string | null;
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
    return {
        id: (site._id as Types.ObjectId).toString(),
        domain: site.domain,
        marketLanguage: site.defaultMarket?.languageCode ?? null,
    };
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
    const checkedPrompts = new Set(mentionRows.map((row) => row.prompt));
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
        // A prompt with no completed check has no measured outcome, so it is
        // "not checked", never "not mentioned".
        notMentionedPrompts: prompts
            .map((row) => row.prompt)
            .filter((prompt) => checkedPrompts.has(prompt) && !mentionedPrompts.has(prompt))
            .slice(0, 3),
        notCheckedPrompts: prompts.map((row) => row.prompt).filter((prompt) => !checkedPrompts.has(prompt)),
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
        if (err instanceof PromptAlreadyTrackedError) {
            throw HttpError.conflict({ code: 'AI_VISIBILITY_ERRORS_PROMPT_ALREADY_TRACKED', messageKey: 'aiVisibility.errors.promptAlreadyTracked' });
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
/** At most this many of the eight go to a site's second language. */
export const SECONDARY_LANGUAGE_SHARE = 3;

/**
 * Topic seeds from the site's latest succeeded audit: page titles and H1s,
 * reduced to short topic phrases by `extractTitleTopic` (sentence fragments,
 * generic page labels and the site's own brand are rejected). Free — the crawl
 * already paid for this data. The same cleaned seeds ground the AI generator.
 */
export async function listAuditTitleSeeds(input: {
  accountId: string;
  siteId: string;
  /** Site domain; its brand label is never a topic ("how episodebrief works"). */
  domain?: string;
  /**
   * Output language. Pages under another language's path prefix (`/fr/…`
   * when generating English) are skipped so their titles never seed a
   * question in the wrong language.
   */
  outputLocale?: SupportedLocale;
  pageLimit?: number;
  seedLimit?: number;
}): Promise<string[]> {
  const run = await AuditRun.findOne({
    siteId: input.siteId,
    accountId: input.accountId,
    status: 'succeeded',
    kind: 'site',
  }).sort({ finishedAt: -1 });
  if (!run) return [];
  const pages = await AuditedPage.find({ runId: run._id })
    .sort({ onPageScore: -1 })
    .limit(input.pageLimit ?? 20)
    .select('url title h1');
  const seen = new Set<string>();
  const seeds: string[] = [];
  const seedLimit = input.seedLimit ?? 15;
  const brand = input.domain ? brandLabelOf(input.domain) : null;
  for (const page of pages) {
    const pageLanguage = pathLanguageOf(page.url);
    if (input.outputLocale && pageLanguage && pageLanguage !== input.outputLocale) continue;
    for (const raw of [page.title ?? '', ...page.h1]) {
      const seed = extractTitleTopic(raw, brand);
      if (!seed || seen.has(seed)) continue;
      seen.add(seed);
      seeds.push(seed);
      if (seeds.length >= seedLimit) return seeds;
    }
  }
  return seeds;
}

/**
 * Crawled page copy for the site profile: title, H1s and meta description of
 * the latest succeeded audit. Only pages that answered 2xx, are indexable and
 * had no fetch failure contribute, and the final (post-redirect) URL is used
 * so language-prefixed paths are judged where the content actually lives.
 * Free — the crawl already paid for this data.
 */
export async function listAuditPageEvidence(input: {
  accountId: string;
  siteId: string;
  pageLimit?: number;
}): Promise<EvidencePage[]> {
  const run = await AuditRun.findOne({
    siteId: input.siteId,
    accountId: input.accountId,
    status: 'succeeded',
    kind: 'site',
  }).sort({ finishedAt: -1 });
  if (!run) return [];
  const pages = await AuditedPage.find({ runId: run._id, ...INVENTORY_PAGE_FILTER })
    .sort({ onPageScore: -1 })
    .limit(input.pageLimit ?? 40)
    .select('url finalUrl title metaDescription h1');
  return pages.map((page) => ({
    url: page.finalUrl ?? page.url,
    title: page.title,
    metaDescription: page.metaDescription,
    h1: page.h1,
  }));
}

/** AI rows first: trim, drop blanks/dupes, cap at the target. */
function collectGeneratedPrompts(prompts: GeneratedPrompt[]): SuggestedPrompt[] {
  const candidates: SuggestedPrompt[] = [];
  const seen = new Set<string>();
  for (const row of prompts) {
    if (candidates.length >= SUGGESTION_TARGET) break;
    const prompt = row.promptText.trim().slice(0, 280);
    const key = prompt.toLowerCase();
    if (!prompt || seen.has(key)) continue;
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
 * Free read of the newest stored suggestion set.
 *
 * Reading never calls a vendor: a reload, a tab switch, or a second browser
 * must not cost a generation already made. `generatedAt: null` means
 * the account has never generated for this site, which is what lets the panel
 * distinguish an untouched tab from a run that legitimately produced nothing.
 */
export async function readStoredSuggestions(
  input: { accountId: string; siteId: string; outputLocale: SupportedLocale },
  deps: Pick<AiVisibilityDeps, 'db'>,
): Promise<StoredSuggestions> {
  const site = await loadOwnedSite(input);
  const keywords = await listKeywordPhrases(deps.db, { accountId: input.accountId, siteId: site.id });
  // Suggestions follow the site's market language, not the viewer's UI.
  const { primary } = resolveSuggestionLanguages({
    marketLanguage: site.marketLanguage,
    uiLocale: input.outputLocale,
    keywords,
  });
  const run = await readLatestSuggestionRun(deps.db, {
    accountId: input.accountId,
    siteId: site.id,
    outputLocale: primary,
  });
  if (!run) {
    return { generatedAt: null, outputLocale: primary, suggestions: [], evidence: null, stale: false };
  }
  const base = {
    generatedAt: run.generatedAt.toISOString(),
    outputLocale: run.outputLocale,
    evidence: run.evidenceLevel,
  };
  // A run stored before every seed read was site-scoped may carry another
  // site's research phrases. Unless its seed keywords are all this site's
  // own, it is withheld and the owner is offered a fresh generation.
  if (
    run.seeds.provenance !== 'site' &&
    !(await seedKeywordsBelongToSite(deps.db, {
      accountId: input.accountId,
      siteId: site.id,
      seedKeywords: run.seeds.keywords,
    }))
  ) {
    return { ...base, suggestions: [], stale: true };
  }
  const rows: SuggestedPrompt[] = run.prompts
    // A template row stored before the seed-language fix can carry a
    // seed in another language ("What is the best finalisez un épisode…?").
    // It is hidden on read, free of charge, instead of waiting for the user
    // to pay for a new generation.
    .filter(
      (row) =>
        row.source !== 'template' ||
        row.evidenceSource === 'competitor' ||
        row.evidenceRef === null ||
        seedFitsLocale(row.evidenceRef, row.language ?? run.outputLocale),
    )
    .map((row) => ({
      prompt: row.prompt,
      source: row.source,
      funnelStage: row.funnelStage,
      promptType: row.promptType,
      intent: row.intent,
      branded: row.branded,
      evidenceSource: row.evidenceSource,
      evidenceRef: row.evidenceRef,
      ...(row.language ? { language: row.language } : {}),
    }));
  const seeds = [...run.seeds.keywords, ...run.seeds.titles, ...run.seeds.gscQueries, ...run.seeds.competitors];
  const tracked = await trackedPromptKeys(deps.db, { accountId: input.accountId, siteId: site.id });
  return {
    ...base,
    suggestions: guardByLanguage(rows, { pageTitles: [], seeds, domain: site.domain }, run.outputLocale)
      .filter((row) => !tracked.has(trackedPromptKey(row.prompt))),
    stale: false,
  };
}

/** keys of the prompts this site already tracks. */
async function trackedPromptKeys(
  db: Db,
  input: { accountId: string; siteId: string },
): Promise<Set<string>> {
  return new Set((await listTrackedPrompts(db, input)).map((row) => trackedPromptKey(row.prompt)));
}

/**
 * the site's own description of what it offers: the meta
 * description of its home page in the latest audit (a stored, free read).
 * Language homes such as `/ar/` count as home pages. It joins the title seeds
 * so generated questions match the product, not only its keywords.
 */
export function siteDescriptionSeed(pages: readonly EvidencePage[]): string | null {
  const isHome = (url: string): boolean => {
    try {
      return /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/?)?$/i.test(new URL(url).pathname);
    } catch {
      return false;
    }
  };
  const home = pages.find((page) => isHome(page.url) && page.metaDescription?.trim());
  return home?.metaDescription?.trim().slice(0, 500) ?? null;
}

/** True when every seed keyword of a stored run is one this site has tracked. */
async function seedKeywordsBelongToSite(
  db: Db,
  input: { accountId: string; siteId: string; seedKeywords: readonly string[] },
): Promise<boolean> {
  if (input.seedKeywords.length === 0) return true;
  const own = new Set(
    (await listAllSiteKeywordPhrases(db, { accountId: input.accountId, siteId: input.siteId })).map(comparisonKey),
  );
  return input.seedKeywords.every((phrase) => own.has(comparisonKey(phrase)));
}

/**
 * Apply the output guard per language (near-duplicate tokens are
 * language-specific) while keeping the rows' original order.
 */
function guardByLanguage(
  rows: readonly SuggestedPrompt[],
  context: { pageTitles: readonly string[]; seeds: readonly string[]; domain: string },
  fallbackLocale: SupportedLocale,
): SuggestedPrompt[] {
  const indexed = rows.map((row, order) => ({ ...row, order }));
  const languageOf = (row: SuggestedPrompt): SupportedLocale => row.language ?? fallbackLocale;
  const locales = [...new Set(indexed.map(languageOf))];
  return locales
    .flatMap((locale) =>
      guardSuggestionRows(
        indexed.filter((row) => languageOf(row) === locale),
        { ...context, locale },
      ),
    )
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...row }) => row);
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
 * The run fails (502) iff the provider threw AND nothing evidence-backed was
 * retained. A run that fell back to templates succeeds, because the user
 * received usable output.
 */
export async function generatePromptSuggestions(
  input: { accountId: string; siteId: string; outputLocale: SupportedLocale },
  deps: AiVisibilityDeps,
): Promise<StoredSuggestions> {
  const nowFn = deps.now ?? (() => new Date());
  const site = await loadOwnedSite(input);
  const paused = await Site.exists({ _id: site.id, accountId: input.accountId, paused: true });
  if (paused) throw HttpError.conflict({ code: 'SITES_ERRORS_PAUSED', messageKey: 'sites.errors.paused' });
  deps.cooldown?.assert(`ai-visibility:suggest:${site.id}`);

  // Free seed assembly — five reads, zero vendor spend. Every read filters on
  // BOTH accountId and siteId: an account-global source (the old
  // keyword-research history read) once leaked another site's phrases into
  // this site's suggestions, so site scoping here is load-bearing.
  const keywords = await listKeywordPhrases(deps.db, { accountId: input.accountId, siteId: site.id });
  // Write in the site's market language, plus at most one
  // more language its own tracked keywords show it serves. One AI call in the
  // primary language (unchanged count and cost); the second language comes
  // from the zero-cost templates.
  const languages = resolveSuggestionLanguages({
    marketLanguage: site.marketLanguage,
    uiLocale: input.outputLocale,
    keywords,
  });
  const outputLocale = languages.primary;
  const [competitorDomains, titleSeeds, gscQueries, pages] = await Promise.all([
    listStoredCompetitorDomains(deps.db, {
      accountId: input.accountId,
      siteId: site.id,
      limit: 5,
    }),
    listAuditTitleSeeds({
      accountId: input.accountId,
      siteId: site.id,
      domain: site.domain,
      outputLocale,
    }),
    listGscQuerySeeds(deps.db, { accountId: input.accountId, siteId: site.id, limit: 15 }),
    listAuditPageEvidence({ accountId: input.accountId, siteId: site.id }),
  ]);

  // What the site offers, read from its own crawled copy and queries. Drives
  // the deterministic fallback AND grounds the AI generator: the category
  // phrases join the title seeds (they derive from crawled titles, H1s, meta
  // descriptions and keywords), and page/brand queries ("episode pricing")
  // are withheld so the model is not handed a page label as a topic.
  const profile = buildSiteProfile({
    domain: site.domain,
    outputLocale,
    pages,
    keywords,
    gscQueries,
  });
  const askable = (seed: string): boolean =>
    !isNavigationalSeed(seed, outputLocale, site.domain);
  const description = siteDescriptionSeed(pages);
  const seeds = {
    keywords: keywords.filter(askable).slice(0, 15).map((keyword) => keyword.slice(0, KEYWORD_MAX_LENGTH)),
    // The site's own product description leads the title seeds.
    titles: Array.from(
      new Set([
        ...(description ? [description] : []),
        ...titleSeeds,
        ...profile.categories.map((category) => category.phrase),
      ]),
    ).slice(0, 15),
    competitors: competitorDomains.slice(0, 15),
    gscQueries: gscQueries.filter(askable),
  };

  const generationInput = {
    siteDomain: site.domain,
    locale: outputLocale,
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
  const templatesFor = (
    locale: SupportedLocale,
    localeTitleSeeds: string[],
    localeProfile: typeof profile,
  ): SuggestedPrompt[] =>
    buildPromptCandidates({
      domain: site.domain,
      outputLocale: locale,
      keywords,
      gscQueries,
      titleSeeds: localeTitleSeeds,
      competitorDomains,
      pages,
      profile: localeProfile,
    }).map((candidate) => ({ ...candidate, source: 'template' as const, language: locale }));
  const templates = templatesFor(outputLocale, titleSeeds, profile);

  let generated: GeneratePromptsResult | null = null;
  let providerFailed = false;
  if (deps.summaryProvider) {
    try {
      generated = await deps.summaryProvider.generatePrompts(generationInput);
    } catch (err) {
      // Never silent: an all-template response downstream means this fired (or
      // the runner's invariants zeroed the set) — ops needs the reason.
      logger.warn(
        { err, accountId: input.accountId, siteId: site.id },
        'ai-visibility prompt suggestion provider failed; falling back to templates',
      );
      providerFailed = true;
    }
  }

  // Raw crawled titles: a phrase that merely repeats one is never a prompt.
  const pageTitles = pages.flatMap((page) => [page.title ?? '', ...page.h1]);
  const guardContext = {
    pageTitles,
    seeds: [...seeds.keywords, ...seeds.titles, ...seeds.gscQueries, ...seeds.competitors],
    domain: site.domain,
  };
  // AI rows lead; templates backfill whatever the model did not produce, so a
  // thin seed set still gets something usable. Near-identical phrasings are
  // collapsed across both sources, first one wins.
  const primaryRows = guardByLanguage(
    [
      ...(generated
        ? collectGeneratedPrompts(generated.prompts).map((row) => ({ ...row, language: outputLocale }))
        : []),
      ...templates,
    ],
    guardContext,
    outputLocale,
  );
  let secondaryRows: SuggestedPrompt[] = [];
  if (languages.secondary) {
    const secondary = languages.secondary;
    const secondaryTitles = await listAuditTitleSeeds({
      accountId: input.accountId,
      siteId: site.id,
      domain: site.domain,
      outputLocale: secondary,
    });
    const secondaryProfile = buildSiteProfile({
      domain: site.domain,
      outputLocale: secondary,
      pages,
      keywords,
      gscQueries,
    });
    secondaryRows = guardByLanguage(
      templatesFor(secondary, secondaryTitles, secondaryProfile),
      { ...guardContext, seeds: [...guardContext.seeds, ...secondaryTitles] },
      secondary,
    ).slice(0, SECONDARY_LANGUAGE_SHARE);
  }
  // a prompt the site already tracks is never suggested again.
  const tracked = await trackedPromptKeys(deps.db, { accountId: input.accountId, siteId: site.id });
  const untracked = (row: SuggestedPrompt): boolean => !tracked.has(trackedPromptKey(row.prompt));
  secondaryRows = secondaryRows.filter(untracked);
  const retained: SuggestedPrompt[] = [
    ...primaryRows.filter(untracked).slice(0, SUGGESTION_TARGET - secondaryRows.length),
    ...secondaryRows,
  ];

  if (providerFailed && retained.every((row) => row.evidenceSource === null)) {
    // Nothing evidence-backed was retained and the call produced nothing useful.
    throw new HttpError(502, { code: 'AI_VISIBILITY_ERRORS_SUGGESTION_FAILED', messageKey: 'aiVisibility.errors.suggestionFailed' });
  }

  const usedAi = retained.some((row) => row.source === 'ai');
  const generatedAt = nowFn();
  await insertSuggestionRun(deps.db, {
    id: runId,
    accountId: input.accountId,
    siteId: site.id,
    outputLocale,
    prompts: retained.map((row) => ({
      prompt: row.prompt,
      source: row.source,
      funnelStage: row.funnelStage,
      promptType: row.promptType,
      intent: row.intent,
      branded: row.branded,
      evidenceSource: row.evidenceSource,
      evidenceRef: row.evidenceRef,
      // Every retained row (template or AI) carries the language it was built in.
      language: row.language,
    })),
    seeds: { ...seeds, evidenceLevel: profile.evidenceLevel, provenance: 'site' },
    generator: usedAi ? 'ai' : 'template',
    model: usedAi && generated ? generated.model : null,
    generatedAt,
  });

  return {
    generatedAt: generatedAt.toISOString(),
    outputLocale,
    suggestions: retained,
    evidence: profile.evidenceLevel,
    stale: false,
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
            // Only checked prompts can be "not mentioned".
            .filter((prompt) => mentions.some((row) => row.prompt === prompt) &&
            !mentions.some((row) => row.prompt === prompt && row.mentioned))
            .slice(0, 3),
    };
}
export async function clearAiVisibilityRowsForTests(db: Db, siteId: string): Promise<void> {
    await db.delete(aiCompetitorMentions).where(eq(aiCompetitorMentions.siteId, siteId));
    await db.delete(aiMentionSnapshots).where(eq(aiMentionSnapshots.siteId, siteId));
}
