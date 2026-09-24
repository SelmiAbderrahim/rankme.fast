/**
 * SERP content-brief processor.
 *
 * The Redis payload carries identifiers only. All keyword, SERP, PAA, scraped
 * content, and draft evidence is reloaded from account-scoped stores. Paid
 * stages are probed against their worst-case allocation before dispatch, and
 * each successful stage is persisted before the next boundary is entered.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Job, Processor } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { keywords } from '../../db/schema/keywords.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import type { ContentSourceProvider } from '../../shared/providers/content-source.js';
import { captureVendorCost } from '../../shared/providers/cost-capture.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
import type { RankProvider } from '../../shared/providers/types.js';
import { contentBriefJobSchema, parseConsumedPayload, type ContentBriefJob, } from '../../shared/queue/index.js';
import { assertPublicUrlSafe } from '../../shared/security/index.js';
import { readLatestForKeywords, type StoredObservation } from '../ranks/index.js';
import { Site } from '../sites/index.js';
import { buildBriefScoringEvidence, computeCorpusStats, filterBriefScoringOutput, toStoredBriefDocument, type BriefScoringOutput, type ContentBriefCorpusStats, type StoredBriefDocument, } from './content-brief.core.js';
import { ContentBrief, CONTENT_BRIEF_MAX_DOCUMENTS, type ContentBriefHaltReason, type ContentBriefHaltStage, type ContentBriefHydrated, } from './content-brief.model.js';
import { CONTENT_BRIEF_AI_MAX_COST_MICROS, isFreshBriefObservation, readBriefSecondaryTerms, type ResolvedBriefKeyword, } from './content-brief.service.js';
export const CONTENT_BRIEF_SERP_BUDGET_MICROS = 10000;
export const CONTENT_BRIEF_SCRAPE_BUDGET_MICROS = 60000;
const TERMINAL_STATUSES = new Set([
    'completed',
    'completed_empty',
    'completed_partial',
    'failed',
]);
const ABSTENTION = {
    noSerpResults: 'contentBriefs.abstentions.noSerpResults',
    noDocuments: 'contentBriefs.abstentions.noDocuments',
    outline: 'contentBriefs.abstentions.outline',
    questions: 'contentBriefs.abstentions.questions',
    malformedEvidence: 'contentBriefs.abstentions.malformedEvidence',
} as const;
export interface ContentBriefProcessorDeps {
    db: Db;
    rank: RankProvider;
    contentSource: ContentSourceProvider;
    ai: AiProfileRunner;
    aiProviderOrder: readonly AiGenerationProviderKey[];
    logger: Logger;
    now?: () => Date;
    assertSafe?: (url: string) => Promise<URL>;
    serpBudgetMicros?: number;
    scrapeBudgetMicros?: number;
    aiBudgetMicros?: number;
    maxPageCharacters?: number;
    scrapeTimeoutMs?: number;
    /** Zero-based BullMQ delivery attempt; direct invocations default to 0. */
    deliveryAttempt?: number;
}
interface StageCost {
    costMicros: number;
    source: 'captured' | 'estimated';
}
export function toSafeContentBriefMicros(value: bigint | number): number {
    if ((typeof value === 'bigint' &&
        (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))) ||
        (typeof value === 'number' &&
            (!Number.isSafeInteger(value) || value < 0))) {
        throw new Error('content-brief vendor cost is outside the safe integer range');
    }
    return Number(value);
}
function stageCost(captured: bigint | null, estimated: bigint | number, maximumEstimateMicros: number): StageCost {
    return captured === null
        ? {
            costMicros: Math.min(toSafeContentBriefMicros(estimated), toSafeContentBriefMicros(maximumEstimateMicros)),
            source: 'estimated',
        }
        : { costMicros: toSafeContentBriefMicros(captured), source: 'captured' };
}
export function canAffordContentBriefStage(spentMicros: number, maximumStageCostMicros: number, ceilingMicros: number): boolean {
    if (![spentMicros, maximumStageCostMicros, ceilingMicros].every((value) => Number.isSafeInteger(value) && value >= 0)) {
        return false;
    }
    return maximumStageCostMicros <= ceilingMicros - spentMicros;
}
function uniqueUrls(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const value of values) {
        const url = value.trim();
        if (!url || seen.has(url))
            continue;
        seen.add(url);
        urls.push(url.slice(0, 2048));
        if (urls.length === CONTENT_BRIEF_MAX_DOCUMENTS)
            break;
    }
    return urls;
}
function paaRows(observation: StoredObservation) {
    return observation.features.paa.slice(0, 10).map((row, index) => ({
        id: `paa-${index + 1}`,
        question: row.question.slice(0, 300),
        answerDomain: row.answerDomain?.slice(0, 253) ?? null,
        answerUrl: row.answerUrl?.slice(0, 2048) ?? null,
    }));
}
function resultPaaRows(result: Awaited<ReturnType<RankProvider['checkRank']>>) {
    return (result.serpFeatures?.paa ?? []).slice(0, 10).map((row, index) => ({
        id: `paa-${index + 1}`,
        question: row.question.slice(0, 300),
        answerDomain: row.answerDomain?.slice(0, 253) ?? null,
        answerUrl: row.answerUrl?.slice(0, 2048) ?? null,
    }));
}
function documentHasEvidence(document: StoredBriefDocument): boolean {
    return Boolean(document.title ||
        document.excerpt ||
        document.headings.length > 0 ||
        document.entityLabels.length > 0);
}
function modelDocuments(brief: ContentBriefHydrated): StoredBriefDocument[] {
    return brief.documents.map((document) => ({
        id: document.id,
        sourceUrl: document.sourceUrl,
        title: document.title,
        excerpt: document.excerpt,
        headings: document.headings.map((heading) => ({
            level: heading.level,
            text: heading.text,
        })),
        capturedAt: document.capturedAt,
        wordCount: document.wordCount,
        entityLabels: [...document.entityLabels],
    }));
}
function emptyStats(): ContentBriefCorpusStats {
    return computeCorpusStats([]);
}
function addAbstention(brief: ContentBriefHydrated, key: string): void {
    brief.set('abstentions', [...new Set([...brief.abstentions, key])]);
}
function addCost(brief: ContentBriefHydrated, stage: ContentBriefHaltStage, cost: StageCost): void {
    brief.totalCostMicros = toSafeContentBriefMicros(brief.totalCostMicros + cost.costMicros);
    brief.costEntries.push({ stage, ...cost });
}
function requestScrapeBudget(stageBudgetMicros: number, targetCount: number, targetIndex: number): number {
    const safeBudget = toSafeContentBriefMicros(stageBudgetMicros);
    return (Math.floor((safeBudget * (targetIndex + 1)) / targetCount) -
        Math.floor((safeBudget * targetIndex) / targetCount));
}
type PaidStageStartedField = 'serpFetchStartedAt' | 'briefAiStartedAt';
/**
 * Claim a paid stage before provider dispatch.  The processor-attempt
 * predicate prevents a superseded/stalled delivery from starting new spend.
 */
async function claimPaidStage(brief: ContentBriefHydrated, processorAttempt: number, field: PaidStageStartedField, now: Date): Promise<boolean> {
    const claimed = await ContentBrief.updateOne({
        _id: brief._id,
        accountId: brief.accountId,
        siteId: brief.siteId,
        status: 'running',
        processorAttempt,
        [field]: null,
    }, { $set: { [field]: now } });
    if (claimed.modifiedCount !== 1)
        return false;
    brief.set(field, now);
    return true;
}
/** Claim one deterministic scrape target before SSRF settlement or dispatch. */
async function claimScrapeAttempt(brief: ContentBriefHydrated, processorAttempt: number, index: number, unsafe: boolean): Promise<boolean> {
    const claimed = await ContentBrief.updateOne({
        _id: brief._id,
        accountId: brief.accountId,
        siteId: brief.siteId,
        status: 'running',
        processorAttempt,
        scrapeAttempts: index,
    }, {
        $inc: {
            scrapeAttempts: 1,
            ...(unsafe ? { unsafeUrlCount: 1 } : {}),
        },
    });
    if (claimed.modifiedCount !== 1)
        return false;
    brief.scrapeAttempts += 1;
    if (unsafe)
        brief.unsafeUrlCount += 1;
    return true;
}
async function ownsContentBriefRun(brief: ContentBriefHydrated, processorAttempt: number): Promise<boolean> {
    return Boolean(await ContentBrief.exists({
        _id: brief._id,
        accountId: brief.accountId,
        siteId: brief.siteId,
        status: 'running',
        processorAttempt,
    }));
}
function activeProcessingStage(brief: ContentBriefHydrated): ContentBriefHaltStage {
    if (brief.serpSource === 'pending')
        return 'serp_fetch';
    if (brief.briefAiStartedAt)
        return 'brief_ai';
    return 'scrape';
}
async function halt(brief: ContentBriefHydrated, stage: ContentBriefHaltStage, reason: ContentBriefHaltReason, now: Date): Promise<void> {
    brief.status = 'completed_partial';
    brief.halt = { stage, reason };
    brief.terminalAt = now;
    await brief.save();
}
async function loadKeyword(deps: ContentBriefProcessorDeps, brief: ContentBriefHydrated): Promise<ResolvedBriefKeyword | null> {
    const rows = await deps.db
        .select({
        id: keywords.id,
        phrase: keywords.phrase,
        locationCode: keywords.locationCode,
        languageCode: keywords.languageCode,
        device: keywords.device,
    })
        .from(keywords)
        .where(and(eq(keywords.id, brief.keywordId), eq(keywords.accountId, String(brief.accountId)), eq(keywords.siteId, String(brief.siteId)), eq(keywords.engine, 'google'), eq(keywords.active, true)))
        .limit(1);
    return rows[0] ?? null;
}
async function finishNoDocuments(brief: ContentBriefHydrated, now: Date): Promise<void> {
    brief.set('corpusStats', emptyStats());
    addAbstention(brief, ABSTENTION.noDocuments);
    if (brief.indeterminateScrapeAttempts > 0) {
        brief.status = 'failed';
        brief.halt = { stage: 'scrape', reason: 'processing_failure' };
        brief.terminalAt = now;
        await brief.save();
        return;
    }
    if (brief.successfulScrapeAttempts === 0 && brief.providerFailureCount > 0) {
        brief.status = 'failed';
        brief.halt = { stage: 'scrape', reason: 'provider_error' };
        brief.terminalAt = now;
        await brief.save();
        return;
    }
    brief.status = 'completed_empty';
    if (brief.providerFailureCount > 0) {
        brief.halt = { stage: 'scrape', reason: 'provider_error' };
    }
    else if (brief.unsafeUrlCount > 0) {
        brief.halt = { stage: 'scrape', reason: 'unsafe_url' };
    }
    brief.terminalAt = now;
    await brief.save();
}
async function resolveSerp(brief: ContentBriefHydrated, keyword: ResolvedBriefKeyword, domain: string, deps: ContentBriefProcessorDeps, now: Date, processorAttempt: number): Promise<'ready' | 'terminal'> {
    if (brief.serpSource !== 'pending')
        return 'ready';
    const observations = await readLatestForKeywords(deps.db, String(brief.siteId), [keyword.id]);
    const observation = observations.get(keyword.id) ?? null;
    if (isFreshBriefObservation(observation, now)) {
        brief.serpSource = 'stored';
        brief.serpCheckedAt = observation.checkedAt;
        brief.fetchedInsideUnit = false;
        brief.serpTopUrls = uniqueUrls([...observation.topResults]
            .sort((left, right) => left.rankAbsolute - right.rankAbsolute)
            .map((row) => row.url));
        brief.set('paaRows', paaRows(observation));
        await brief.save();
        return 'ready';
    }
    const budget = deps.serpBudgetMicros ?? CONTENT_BRIEF_SERP_BUDGET_MICROS;
    if (!canAffordContentBriefStage(brief.totalCostMicros, budget, brief.runCeilingMicros)) {
        await halt(brief, 'serp_fetch', 'cost_ceiling', now);
        return 'terminal';
    }
    if (brief.serpFetchStartedAt) {
        if (!brief.costEntries.some((entry) => entry.stage === 'serp_fetch')) {
            addCost(brief, 'serp_fetch', { costMicros: budget, source: 'estimated' });
        }
        brief.status = 'failed';
        brief.halt = { stage: 'serp_fetch', reason: 'processing_failure' };
        brief.terminalAt = now;
        await brief.save();
        return 'terminal';
    }
    if (!(await claimPaidStage(brief, processorAttempt, 'serpFetchStartedAt', now))) {
        return 'terminal';
    }
    const dispatchSerp = () => captureVendorCost(() => deps.rank.checkRank({
        keyword: keyword.phrase,
        domain,
        locationCode: keyword.locationCode,
        languageCode: keyword.languageCode,
        device: keyword.device,
    }));
    let captured: Awaited<ReturnType<typeof dispatchSerp>>;
    try {
        captured = await dispatchSerp();
    }
    catch {
        if (!(await ownsContentBriefRun(brief, processorAttempt)))
            return 'terminal';
        addCost(brief, 'serp_fetch', { costMicros: budget, source: 'estimated' });
        brief.providerFailureCount += 1;
        brief.status = 'failed';
        brief.halt = { stage: 'serp_fetch', reason: 'provider_error' };
        brief.terminalAt = now;
        await brief.save();
        return 'terminal';
    }
    if (!(await ownsContentBriefRun(brief, processorAttempt)))
        return 'terminal';
    brief.serpSource = 'fetched';
    brief.serpCheckedAt = captured.value.checkedAt;
    brief.fetchedInsideUnit = true;
    brief.serpTopUrls = uniqueUrls(captured.value.serpTopUrls ?? []);
    brief.set('paaRows', resultPaaRows(captured.value));
    addCost(brief, 'serp_fetch', stageCost(captured.costMicros, budget, budget));
    await brief.save();
    return 'ready';
}
async function scrapeSerpDocuments(brief: ContentBriefHydrated, deps: ContentBriefProcessorDeps, now: Date, processorAttempt: number): Promise<'ready' | 'terminal'> {
    const urls = uniqueUrls(brief.serpTopUrls);
    if (urls.length === 0) {
        brief.set('corpusStats', emptyStats());
        addAbstention(brief, ABSTENTION.noSerpResults);
        brief.status = 'completed_empty';
        brief.terminalAt = now;
        await brief.save();
        return 'terminal';
    }
    const stageBudget = deps.scrapeBudgetMicros ?? CONTENT_BRIEF_SCRAPE_BUDGET_MICROS;
    const settledAttempts = brief.successfulScrapeAttempts +
        brief.providerFailureCount +
        brief.unsafeUrlCount +
        brief.indeterminateScrapeAttempts;
    const uncertainAttempts = Math.max(0, brief.scrapeAttempts - settledAttempts);
    if (uncertainAttempts > 0) {
        for (let offset = 0; offset < uncertainAttempts; offset += 1) {
            const targetIndex = settledAttempts + offset;
            addCost(brief, 'scrape', {
                costMicros: requestScrapeBudget(stageBudget, urls.length, targetIndex),
                source: 'estimated',
            });
        }
        brief.indeterminateScrapeAttempts += uncertainAttempts;
        await brief.save();
    }
    const assertSafe = deps.assertSafe ?? ((url: string) => assertPublicUrlSafe(url));
    for (let index = brief.scrapeAttempts; index < urls.length; index += 1) {
        const perRequestBudget = requestScrapeBudget(stageBudget, urls.length, index);
        if (!canAffordContentBriefStage(brief.totalCostMicros, perRequestBudget, brief.runCeilingMicros)) {
            if (brief.documents.length === 0)
                addAbstention(brief, ABSTENTION.noDocuments);
            await halt(brief, 'scrape', 'cost_ceiling', now);
            return 'terminal';
        }
        const url = urls[index]!;
        let safe: URL;
        try {
            safe = await assertSafe(url);
        }
        catch {
            if (!(await claimScrapeAttempt(brief, processorAttempt, index, true))) {
                return 'terminal';
            }
            continue;
        }
        // Claim this target before the paid dispatch. If the process dies after
        // the provider accepted the call, a replay skips it instead of spending
        // twice. The terminal result may be partial, but the ceiling stays true.
        if (!(await claimScrapeAttempt(brief, processorAttempt, index, false))) {
            return 'terminal';
        }
        const dispatchScrape = () => captureVendorCost(() => deps.contentSource.scrapePage({
            url: safe.toString(),
            formats: ['markdown', 'metadata'],
            timeoutMs: deps.scrapeTimeoutMs ?? env.FIRECRAWL_TIMEOUT_MS,
            maxCharacters: deps.maxPageCharacters ?? env.FIRECRAWL_MAX_PAGE_CHARS,
            freshnessKey: createHash('sha256')
                .update(`${String(brief._id)}|${index}|${safe.toString()}`)
                .digest('hex'),
        }));
        let captured: Awaited<ReturnType<typeof dispatchScrape>>;
        try {
            captured = await dispatchScrape();
        }
        catch {
            if (!(await ownsContentBriefRun(brief, processorAttempt)))
                return 'terminal';
            addCost(brief, 'scrape', {
                costMicros: perRequestBudget,
                source: 'estimated',
            });
            brief.providerFailureCount += 1;
            await brief.save();
            continue;
        }
        if (!(await ownsContentBriefRun(brief, processorAttempt)))
            return 'terminal';
        const cost = stageCost(captured.costMicros, captured.value.usage.estimatedCostMicros, perRequestBudget);
        const document = toStoredBriefDocument(captured.value.document, index);
        brief.successfulScrapeAttempts += 1;
        addCost(brief, 'scrape', cost);
        if (documentHasEvidence(document))
            brief.documents.push(document);
        await brief.save();
    }
    if (brief.documents.length === 0) {
        await finishNoDocuments(brief, now);
        return 'terminal';
    }
    brief.set('corpusStats', computeCorpusStats(modelDocuments(brief)));
    if (brief.indeterminateScrapeAttempts > 0) {
        brief.halt = { stage: 'scrape', reason: 'processing_failure' };
    }
    else if (brief.providerFailureCount > 0) {
        brief.halt = { stage: 'scrape', reason: 'provider_error' };
    }
    else if (brief.unsafeUrlCount > 0) {
        brief.halt = { stage: 'scrape', reason: 'unsafe_url' };
    }
    await brief.save();
    return 'ready';
}
async function generateBrief(brief: ContentBriefHydrated, deps: ContentBriefProcessorDeps, now: Date, processorAttempt: number): Promise<void> {
    if (brief.briefAiCompleted)
        return;
    const budget = deps.aiBudgetMicros ?? CONTENT_BRIEF_AI_MAX_COST_MICROS;
    if (!canAffordContentBriefStage(brief.totalCostMicros, budget, brief.runCeilingMicros)) {
        addAbstention(brief, ABSTENTION.outline);
        if (brief.paaRows.length > 0)
            addAbstention(brief, ABSTENTION.questions);
        await halt(brief, 'brief_ai', 'cost_ceiling', now);
        return;
    }
    if (brief.briefAiStartedAt) {
        if (!brief.costEntries.some((entry) => entry.stage === 'brief_ai')) {
            addCost(brief, 'brief_ai', { costMicros: budget, source: 'estimated' });
        }
        addAbstention(brief, ABSTENTION.outline);
        if (brief.paaRows.length > 0)
            addAbstention(brief, ABSTENTION.questions);
        await halt(brief, 'brief_ai', 'processing_failure', now);
        return;
    }
    const documents = modelDocuments(brief);
    const stats = computeCorpusStats(documents);
    const evidence = buildBriefScoringEvidence({
        mode: 'brief',
        keyword: brief.keyword,
        documents,
        stats,
        paaRows: brief.paaRows.map((row) => ({
            id: row.id,
            question: row.question,
            answerDomain: row.answerDomain ?? null,
            answerUrl: row.answerUrl ?? null,
        })),
        secondaryTerms: brief.secondaryTerms.map((term) => ({ id: term.id, term: term.term })),
    });
    if (!(await claimPaidStage(brief, processorAttempt, 'briefAiStartedAt', now))) {
        return;
    }
    const dispatchAi = () => captureVendorCost(() => deps.ai.run<BriefScoringOutput>({
        profile: 'brief_scoring',
        input: evidence,
        locale: brief.locale,
        correlationId: `content-brief-${String(brief._id)}-${randomUUID()}`,
        usage: {
            accountId: String(brief.accountId),
            siteId: String(brief.siteId),
            jobId: String(brief._id),
        },
        configuredProviderOrder: deps.aiProviderOrder,
    }));
    let captured: Awaited<ReturnType<typeof dispatchAi>>;
    try {
        captured = await dispatchAi();
    }
    catch {
        if (!(await ownsContentBriefRun(brief, processorAttempt)))
            return;
        addCost(brief, 'brief_ai', { costMicros: budget, source: 'estimated' });
        brief.briefAiCompleted = true;
        addAbstention(brief, ABSTENTION.outline);
        if (brief.paaRows.length > 0)
            addAbstention(brief, ABSTENTION.questions);
        brief.status = 'completed_partial';
        brief.halt = { stage: 'brief_ai', reason: 'provider_error' };
        brief.terminalAt = now;
        await brief.save();
        return;
    }
    if (!(await ownsContentBriefRun(brief, processorAttempt)))
        return;
    const filtered = filterBriefScoringOutput(captured.value.object, evidence);
    const cost = stageCost(captured.costMicros, captured.value.provenance.actualOrEstimatedCostMicros, budget);
    addCost(brief, 'brief_ai', cost);
    brief.set('outline', filtered.output.outline);
    brief.set('questions', filtered.output.questions);
    brief.briefAiCompleted = true;
    if (brief.outline.length === 0)
        addAbstention(brief, ABSTENTION.outline);
    if (brief.paaRows.length > 0 && brief.questions.length === 0) {
        addAbstention(brief, ABSTENTION.questions);
    }
    if (filtered.rejected || captured.value.status === 'partial') {
        addAbstention(brief, ABSTENTION.malformedEvidence);
        brief.halt = { stage: 'brief_ai', reason: 'malformed_output' };
    }
    const degraded = brief.providerFailureCount > 0 ||
        brief.indeterminateScrapeAttempts > 0 ||
        brief.unsafeUrlCount > 0 ||
        brief.outline.length === 0 ||
        (brief.paaRows.length > 0 && brief.questions.length === 0) ||
        filtered.rejected ||
        captured.value.status === 'partial';
    brief.status = degraded ? 'completed_partial' : 'completed';
    brief.terminalAt = now;
    await brief.save();
}
export async function runContentBriefPipeline(input: ContentBriefJob, deps: ContentBriefProcessorDeps): Promise<void> {
    const now = (deps.now ?? (() => new Date()))();
    const processorAttempt = deps.deliveryAttempt ?? 0;
    if (!Number.isSafeInteger(processorAttempt) || processorAttempt < 0) {
        throw new Error('content-brief delivery attempt must be a non-negative safe integer');
    }
    const brief = await ContentBrief.findOneAndUpdate({
        _id: input.briefId,
        accountId: input.accountId,
        siteId: input.siteId,
        status: { $in: ['queued', 'running'] },
        $or: [
            { processorAttempt: { $exists: false } },
            { processorAttempt: { $lt: processorAttempt } },
        ],
    }, {
        $set: {
            status: 'running',
            processorStartedAt: now,
            processorAttempt,
        },
    }, { new: true });
    if (!brief) {
        const existing = await ContentBrief.findOne({
            _id: input.briefId,
            accountId: input.accountId,
            siteId: input.siteId,
        }).select({ status: 1, processorAttempt: 1 });
        if (!existing) {
            deps.logger.warn({ briefId: input.briefId, accountId: input.accountId, siteId: input.siteId }, 'content-brief processor: account-scoped brief not found; dropping job');
            return;
        }
        deps.logger.info({
            briefId: input.briefId,
            status: existing.status,
            processorAttempt: existing.processorAttempt,
        }, TERMINAL_STATUSES.has(existing.status)
            ? 'content-brief processor: terminal replay; no-op'
            : 'content-brief processor: delivery attempt already claimed; no-op');
        return;
    }
    try {
        const [site, keyword] = await Promise.all([
            Site.findOne({
                _id: input.siteId,
                accountId: input.accountId,
                deletionStartedAt: null,
            }).select({ domain: 1 }),
            loadKeyword(deps, brief),
        ]);
        if (!site || !keyword) {
            brief.status = 'failed';
            brief.halt = { stage: 'serp_fetch', reason: 'processing_failure' };
            brief.terminalAt = now;
            await brief.save();
            return;
        }
        const serp = await resolveSerp(brief, keyword, site.domain, deps, now, processorAttempt);
        if (serp === 'terminal')
            return;
        if (brief.secondaryTerms.length === 0) {
            brief.set('secondaryTerms', await readBriefSecondaryTerms(input.accountId, input.siteId, keyword));
            await brief.save();
        }
        const scraped = await scrapeSerpDocuments(brief, deps, now, processorAttempt);
        if (scraped === 'terminal')
            return;
        await generateBrief(brief, deps, now, processorAttempt);
    }
    catch (error) {
        if (!(await ownsContentBriefRun(brief, processorAttempt)))
            return;
        brief.status = brief.documents.length > 0 ? 'completed_partial' : 'failed';
        brief.halt = { stage: activeProcessingStage(brief), reason: 'processing_failure' };
        brief.terminalAt = now;
        await brief.save();
        throw error;
    }
}
export function createContentBriefProcessor(deps: ContentBriefProcessorDeps): Processor<ContentBriefJob, void> {
    return async (job: Job<ContentBriefJob>) => {
        const payload = parseConsumedPayload(contentBriefJobSchema, job.data);
        await runContentBriefPipeline(payload, {
            ...deps,
            deliveryAttempt: job.attemptsMade ?? 0,
        });
    };
}
/** Called by the shared dead-letter hook after the final BullMQ attempt. */
export async function onContentBriefJobExhausted(job: Job): Promise<void> {
    const parsed = contentBriefJobSchema.safeParse(job.data);
    if (!parsed.success)
        return;
    const brief = await ContentBrief.findOne({
        _id: parsed.data.briefId,
        accountId: parsed.data.accountId,
        siteId: parsed.data.siteId,
    });
    if (!brief || TERMINAL_STATUSES.has(brief.status))
        return;
    brief.status = brief.documents.length > 0 ? 'completed_partial' : 'failed';
    brief.halt = {
        stage: activeProcessingStage(brief),
        reason: 'processing_failure',
    };
    brief.terminalAt = new Date();
    await brief.save();
}
