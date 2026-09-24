import type { SpendPreview } from '../../shared/safety/operation-preview.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { keywords } from '../../db/schema/keywords.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { captureVendorCost } from '../../shared/providers/cost-capture.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
import { enqueueContentBriefJob } from '../../shared/queue/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { findLatestCompletedKeywordCluster } from '../keyword-clusters/index.js';
import type { StoredObservation } from '../ranks/index.js';
import { Site } from '../sites/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { buildBriefScoringEvidence, compareDraftToCorpus, filterBriefScoringOutput, type BriefScoringOutput, type ContentBriefCorpusStats, type StoredBriefDocument, } from './content-brief.core.js';
import { ContentBrief, CONTENT_BRIEF_MAX_DRAFT_VERSIONS, type ContentBriefHydrated, } from './content-brief.model.js';
import type { ContentBriefCreateBody, ContentBriefDraftBody, ContentBriefListQuery, ContentBriefPreviewBody, } from './content-brief.schemas.js';
export const CONTENT_BRIEF_AI_MAX_COST_MICROS = 50000;
export const CONTENT_BRIEF_SERP_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;
export const CONTENT_BRIEF_NOT_FOUND_KEY = 'contentBriefs.errors.notFound';
export const CONTENT_BRIEF_UNAVAILABLE_KEY = 'contentBriefs.errors.unavailable';
export const CONTENT_BRIEF_KEYWORD_NOT_TRACKED_KEY = 'contentBriefs.errors.keywordNotTracked';
export const CONTENT_BRIEF_DRAFT_LIMIT_KEY = 'contentBriefs.errors.draftLimit';
export const CONTENT_BRIEF_NOT_READY_KEY = 'contentBriefs.errors.notReady';
export const CONTENT_BRIEF_CONFLICT_KEY = 'contentBriefs.errors.editorConflict';
export interface ResolvedBriefKeyword {
    id: string;
    phrase: string;
    locationCode: number;
    languageCode: string;
    device: 'desktop' | 'mobile';
}
export function assertContentBriefsEnabled(): void {
    if (!env.CONTENT_BRIEFS_ENABLED) {
        throw new HttpError(503, { code: 'CONTENT_BRIEF_UNAVAILABLE', messageKey: CONTENT_BRIEF_UNAVAILABLE_KEY });
    }
}
async function loadOwnedSite(accountId: string, siteId: string) {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'CONTENT_BRIEF_NOT_FOUND', messageKey: CONTENT_BRIEF_NOT_FOUND_KEY });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'CONTENT_BRIEF_NOT_FOUND', messageKey: CONTENT_BRIEF_NOT_FOUND_KEY });
    return site;
}
export async function resolveBriefKeyword(db: Db, input: {
    accountId: string;
    siteId: string;
    keyword: string;
}): Promise<ResolvedBriefKeyword> {
    const rows = await db
        .select({
        id: keywords.id,
        phrase: keywords.phrase,
        locationCode: keywords.locationCode,
        languageCode: keywords.languageCode,
        device: keywords.device,
    })
        .from(keywords)
        .where(and(eq(keywords.accountId, input.accountId), eq(keywords.siteId, input.siteId), eq(keywords.active, true), eq(keywords.engine, 'google'), sql `lower(${keywords.phrase}) = ${input.keyword}`))
        .orderBy(desc(keywords.createdAt))
        .limit(1);
    const row = rows[0];
    if (!row)
        throw new HttpError(422, { code: 'CONTENT_BRIEF_KEYWORD_NOT_TRACKED', messageKey: CONTENT_BRIEF_KEYWORD_NOT_TRACKED_KEY });
    return row;
}
export function isFreshBriefObservation(observation: StoredObservation | null, now: Date): observation is StoredObservation {
    return Boolean(observation &&
        observation.engine === 'google' &&
        observation.checkedAt.getTime() >= now.getTime() - CONTENT_BRIEF_SERP_FRESHNESS_MS);
}
/** Read-only spend disclosure — never enqueues, never calls a vendor. */
export async function previewContentBrief(accountId: string, siteId: string, input: ContentBriefPreviewBody, deps: {
    db: Db;
}): Promise<SpendPreview> {
    await loadOwnedSite(accountId, siteId);
    await resolveBriefKeyword(deps.db, {
        accountId,
        siteId,
        keyword: input.keyword,
    });
    assertContentBriefsEnabled();
    return { deploymentMode: 'community', capacityEnforced: false };
}
function idempotencyKey(input: {
    accountId: string;
    siteId: string;
    keywordId: string;
    locale: string;
    clientKey: string;
}): string {
    return createHash('sha256')
        .update([input.accountId, input.siteId, input.keywordId, input.locale, input.clientKey].join('|'))
        .digest('hex');
}
export interface CreateContentBriefDeps {
    db: Db;
    queue: Queue | null;
    now?: () => Date;
}
export async function createContentBrief(accountId: string, siteId: string, input: ContentBriefCreateBody, deps: CreateContentBriefDeps) {
    const site = await loadOwnedSite(accountId, siteId);
    assertSiteNotPaused(site);
    const keyword = await resolveBriefKeyword(deps.db, {
        accountId,
        siteId,
        keyword: input.keyword,
    });
    assertContentBriefsEnabled();
    if (!deps.queue)
        throw new HttpError(503, { code: 'CONTENT_BRIEF_UNAVAILABLE', messageKey: CONTENT_BRIEF_UNAVAILABLE_KEY });
    const key = idempotencyKey({
        accountId,
        siteId,
        keywordId: keyword.id,
        locale: input.locale,
        clientKey: input.clientKey ?? randomUUID(),
    });
    const existing = await ContentBrief.findOne({ accountId, siteId, reservationKey: key });
    if (existing) {
        return { briefId: String(existing._id), status: existing.status, duplicate: true };
    }
    const now = (deps.now ?? (() => new Date()))();
    let brief: ContentBriefHydrated;
    try {
        brief = await ContentBrief.create({
            accountId,
            siteId,
            keywordId: keyword.id,
            keyword: input.keyword,
            locale: input.locale,
            reservationKey: key,
            status: 'queued',
            runCeilingMicros: env.CONTENT_BRIEF_COST_CEILING_MICROS,
        });
    }
    catch (error) {
        if ((error as {
            code?: number;
        }).code === 11000) {
            const duplicate = await ContentBrief.findOne({ accountId, siteId, reservationKey: key });
            if (duplicate) {
                return {
                    briefId: String(duplicate._id),
                    status: duplicate.status,
                    duplicate: true,
                };
            }
        }
        throw error;
    }
    try {
        await enqueueContentBriefJob(deps.queue, {
            accountId,
            siteId,
            briefId: String(brief._id),
        });
    }
    catch (error) {
        await ContentBrief.updateOne({ _id: brief._id, accountId }, {
            $set: {
                status: 'failed',
                halt: { stage: 'serp_fetch', reason: 'processing_failure' },
                terminalAt: now,
            },
        });
        throw new HttpError(503, { code: 'CONTENT_BRIEF_UNAVAILABLE', messageKey: CONTENT_BRIEF_UNAVAILABLE_KEY }, undefined, { cause: error });
    }
    return {
        briefId: String(brief._id),
        status: 'queued' as const,
        duplicate: false,
    };
}
interface BriefCursor {
    createdAt: string;
    id: string;
}
export function encodeContentBriefCursor(cursor: BriefCursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
export function decodeContentBriefCursor(value: string): BriefCursor {
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    }
    catch {
        throw HttpError.badRequest({ code: 'CONTENT_BRIEFS_ERRORS_INVALID_CURSOR', messageKey: 'contentBriefs.errors.invalidCursor' });
    }
    const cursor = parsed as Partial<BriefCursor> | null;
    if (!cursor ||
        typeof cursor.createdAt !== 'string' ||
        Number.isNaN(Date.parse(cursor.createdAt)) ||
        typeof cursor.id !== 'string' ||
        !Types.ObjectId.isValid(cursor.id)) {
        throw HttpError.badRequest({ code: 'CONTENT_BRIEFS_ERRORS_INVALID_CURSOR', messageKey: 'contentBriefs.errors.invalidCursor' });
    }
    return { createdAt: cursor.createdAt, id: cursor.id };
}
function serializeHalt(brief: ContentBriefHydrated) {
    return brief.halt ? { stage: brief.halt.stage, reason: brief.halt.reason } : null;
}
export function serializeContentBriefListItem(brief: ContentBriefHydrated) {
    return {
        id: String(brief._id),
        siteId: String(brief.siteId),
        keyword: brief.keyword,
        status: brief.status,
        serpSource: brief.serpSource,
        retainedDocumentCount: brief.documents.length,
        halt: serializeHalt(brief),
        requestedAt: brief.createdAt.toISOString(),
        terminalAt: brief.terminalAt?.toISOString() ?? null,
        latestDraftVersion: brief.draftVersionCount,
    };
}
export async function listContentBriefs(accountId: string, siteId: string, query: ContentBriefListQuery) {
    await loadOwnedSite(accountId, siteId);
    const filter: Record<string, unknown> = { accountId, siteId };
    if (query.status !== 'all')
        filter.status = query.status;
    if (query.cursor) {
        const cursor = decodeContentBriefCursor(query.cursor);
        const createdAt = new Date(cursor.createdAt);
        filter.$or = [
            { createdAt: { $lt: createdAt } },
            { createdAt, _id: { $lt: new Types.ObjectId(cursor.id) } },
        ];
    }
    const docs = await ContentBrief.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(query.limit + 1);
    const hasMore = docs.length > query.limit;
    const page = hasMore ? docs.slice(0, query.limit) : docs;
    const last = page.at(-1);
    return {
        creationEnabled: env.CONTENT_BRIEFS_ENABLED,
        items: page.map(serializeContentBriefListItem),
        nextCursor: hasMore && last
            ? encodeContentBriefCursor({
                createdAt: last.createdAt.toISOString(),
                id: String(last._id),
            })
            : null,
    };
}
function httpUrlOrNull(value: string | null | undefined): string | null {
    if (!value)
        return null;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : null;
    }
    catch {
        return null;
    }
}
function serializeCorpusStats(brief: ContentBriefHydrated) {
    const stats = brief.corpusStats;
    if (!stats)
        return null;
    return {
        wordCount: {
            min: stats.wordCount.min ?? null,
            max: stats.wordCount.max ?? null,
            average: stats.wordCount.average ?? null,
            documentCount: stats.wordCount.documentCount,
        },
        headingHistogram: {
            h1: stats.headingHistogram.h1,
            h2: stats.headingHistogram.h2,
            h3: stats.headingHistogram.h3,
            h4: stats.headingHistogram.h4,
            h5: stats.headingHistogram.h5,
            h6: stats.headingHistogram.h6,
        },
        entities: stats.entities.map((entity) => ({
            label: entity.label,
            documentCount: entity.documentCount,
        })),
        scrapeDates: stats.scrapeDates.map((date) => new Date(date as unknown as Date).toISOString()),
    };
}
export function serializeContentBriefDetail(brief: ContentBriefHydrated) {
    const residueMicros = Math.max(0, brief.runCeilingMicros -
        brief.totalCostMicros -
        brief.editorAiCostMicros -
        brief.editorAiReservedMicros);
    return {
        ...serializeContentBriefListItem(brief),
        creationEnabled: env.CONTENT_BRIEFS_ENABLED,
        locale: brief.locale,
        serp: {
            source: brief.serpSource,
            checkedAt: brief.serpCheckedAt?.toISOString() ?? null,
            fetchedInsideUnit: brief.fetchedInsideUnit,
            paaRows: brief.paaRows.map((row) => ({
                id: row.id,
                question: row.question,
                answerDomain: row.answerDomain ?? null,
                answerUrl: httpUrlOrNull(row.answerUrl),
                trust: 'untrusted' as const,
            })),
        },
        documents: brief.documents.map((document) => ({
            id: document.id,
            sourceUrl: httpUrlOrNull(document.sourceUrl),
            title: document.title,
            headings: document.headings.map((heading) => ({
                level: heading.level,
                text: heading.text,
            })),
            capturedAt: document.capturedAt.toISOString(),
            wordCount: document.wordCount,
            entityLabels: [...document.entityLabels],
            trust: 'untrusted' as const,
        })),
        corpusStats: serializeCorpusStats(brief),
        outline: brief.outline.map((node) => ({
            id: node.id,
            heading: node.heading,
            purpose: node.purpose,
            citations: [...node.citations],
            trust: 'untrusted' as const,
        })),
        questions: brief.questions.map((question) => ({
            question: question.question,
            citations: [...question.citations],
            trust: 'untrusted' as const,
        })),
        secondaryTerms: brief.secondaryTerms.map((term) => ({ id: term.id, term: term.term })),
        abstentions: [...brief.abstentions],
        cost: {
            ceilingMicros: brief.runCeilingMicros,
            initialMicros: brief.totalCostMicros,
            editorAiMicros: brief.editorAiCostMicros,
            residueMicros,
            stages: brief.costEntries.map((entry) => ({
                stage: entry.stage,
                costMicros: entry.costMicros,
                source: entry.source,
            })),
        },
        scoreHistory: brief.draftVersions.map((version) => ({
            version: version.version,
            draft: version.draft,
            comparison: version.comparison,
            aiScore: version.aiScore ?? null,
            aiRationale: version.aiRationale ?? null,
            aiCitations: [...version.aiCitations],
            aiCostMicros: version.aiCostMicros,
            aiDisclosure: version.aiDisclosure,
            createdAt: version.createdAt.toISOString(),
            trust: 'untrusted' as const,
        })),
    };
}
export async function getContentBrief(accountId: string, siteId: string, briefId: string) {
    if (!Types.ObjectId.isValid(siteId) || !Types.ObjectId.isValid(briefId)) {
        throw HttpError.notFound({ code: 'CONTENT_BRIEF_NOT_FOUND', messageKey: CONTENT_BRIEF_NOT_FOUND_KEY });
    }
    const brief = await ContentBrief.findOne({ _id: briefId, accountId, siteId });
    if (!brief)
        throw HttpError.notFound({ code: 'CONTENT_BRIEF_NOT_FOUND', messageKey: CONTENT_BRIEF_NOT_FOUND_KEY });
    return serializeContentBriefDetail(brief);
}
function documentForEvidence(document: ContentBriefHydrated['documents'][number]): StoredBriefDocument {
    return {
        id: document.id,
        sourceUrl: document.sourceUrl,
        title: document.title,
        excerpt: document.excerpt,
        headings: document.headings.map((heading) => ({ level: heading.level, text: heading.text })),
        capturedAt: document.capturedAt,
        wordCount: document.wordCount,
        entityLabels: [...document.entityLabels],
    };
}
function statsForEvidence(brief: ContentBriefHydrated): ContentBriefCorpusStats {
    const stats = brief.corpusStats;
    if (!stats) {
        return {
            wordCount: { min: null, max: null, average: null, documentCount: 0 },
            headingHistogram: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
            entities: [],
            scrapeDates: [],
        };
    }
    return {
        wordCount: {
            min: stats.wordCount.min ?? null,
            max: stats.wordCount.max ?? null,
            average: stats.wordCount.average ?? null,
            documentCount: stats.wordCount.documentCount,
        },
        headingHistogram: {
            h1: stats.headingHistogram.h1,
            h2: stats.headingHistogram.h2,
            h3: stats.headingHistogram.h3,
            h4: stats.headingHistogram.h4,
            h5: stats.headingHistogram.h5,
            h6: stats.headingHistogram.h6,
        },
        entities: stats.entities.map((entry) => ({
            label: entry.label,
            documentCount: entry.documentCount,
        })),
        scrapeDates: stats.scrapeDates.map((date) => new Date(date as unknown as Date)),
    };
}
export interface RescoreContentBriefDeps {
    db: Db;
    ai: AiProfileRunner | null;
    aiProviderOrder: readonly AiGenerationProviderKey[];
    now?: () => Date;
}
async function settleEditorAiReservation(accountId: string, siteId: string, briefId: string, costMicros: number, source: 'captured' | 'estimated'): Promise<void> {
    await ContentBrief.updateOne({
        _id: briefId,
        accountId,
        siteId,
        editorAiReservedMicros: { $gte: CONTENT_BRIEF_AI_MAX_COST_MICROS },
    }, {
        $push: {
            costEntries: { stage: 'editor_ai', costMicros, source },
        },
        $inc: {
            editorAiReservedMicros: -CONTENT_BRIEF_AI_MAX_COST_MICROS,
            editorAiCostMicros: costMicros,
        },
    });
}
function toSafeEditorAiMicros(value: bigint): number {
    if (value < 0n ||
        value > BigInt(CONTENT_BRIEF_AI_MAX_COST_MICROS) ||
        value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('content-brief editor AI cost is outside its reserved range');
    }
    return Number(value);
}
export async function rescoreContentBriefDraft(accountId: string, siteId: string, briefId: string, input: ContentBriefDraftBody, deps: RescoreContentBriefDeps) {
    if (!Types.ObjectId.isValid(siteId) || !Types.ObjectId.isValid(briefId)) {
        throw HttpError.notFound({ code: 'CONTENT_BRIEF_NOT_FOUND', messageKey: CONTENT_BRIEF_NOT_FOUND_KEY });
    }
    const brief = await ContentBrief.findOne({ _id: briefId, accountId, siteId });
    if (!brief)
        throw HttpError.notFound({ code: 'CONTENT_BRIEF_NOT_FOUND', messageKey: CONTENT_BRIEF_NOT_FOUND_KEY });
    assertContentBriefsEnabled();
    if (brief.status === 'queued' || brief.status === 'running') {
        throw new HttpError(409, { code: 'CONTENT_BRIEF_NOT_READY', messageKey: CONTENT_BRIEF_NOT_READY_KEY });
    }
    if (brief.draftVersionCount >= CONTENT_BRIEF_MAX_DRAFT_VERSIONS) {
        throw new HttpError(409, { code: 'CONTENT_BRIEF_DRAFT_LIMIT', messageKey: CONTENT_BRIEF_DRAFT_LIMIT_KEY });
    }
    const stats = statsForEvidence(brief);
    const comparison = compareDraftToCorpus(input.draft, stats);
    const evidence = buildBriefScoringEvidence({
        mode: 'rescore',
        keyword: brief.keyword,
        documents: brief.documents.map(documentForEvidence),
        stats,
        paaRows: brief.paaRows.map((row) => ({
            id: row.id,
            question: row.question,
            answerDomain: row.answerDomain ?? null,
            answerUrl: row.answerUrl ?? null,
        })),
        secondaryTerms: brief.secondaryTerms.map((term) => ({ id: term.id, term: term.term })),
        draft: input.draft,
    });
    const residue = Math.max(0, brief.runCeilingMicros -
        brief.totalCostMicros -
        brief.editorAiCostMicros -
        brief.editorAiReservedMicros);
    let aiScore: number | null = null;
    let aiRationale: string | null = null;
    let aiCitations: string[] = [];
    let aiCostMicros = 0;
    let aiCostSource: 'captured' | 'estimated' = 'captured';
    let aiDisclosure: 'scored' | 'cost_ceiling' | 'provider_error' | 'malformed_output' = residue < CONTENT_BRIEF_AI_MAX_COST_MICROS ? 'cost_ceiling' : 'provider_error';
    const aiClaim = residue >= CONTENT_BRIEF_AI_MAX_COST_MICROS && deps.ai
        ? await ContentBrief.findOneAndUpdate({
            _id: briefId,
            accountId,
            siteId,
            $expr: {
                $gte: [
                    {
                        $subtract: [
                            '$runCeilingMicros',
                            {
                                $add: [
                                    '$totalCostMicros',
                                    '$editorAiCostMicros',
                                    '$editorAiReservedMicros',
                                ],
                            },
                        ],
                    },
                    CONTENT_BRIEF_AI_MAX_COST_MICROS,
                ],
            },
        }, { $inc: { editorAiReservedMicros: CONTENT_BRIEF_AI_MAX_COST_MICROS } }, { new: true })
        : null;
    let aiReservationHeld = Boolean(aiClaim);
    if (aiClaim && deps.ai) {
        try {
            const { value: generated, costMicros: captured } = await captureVendorCost(() => deps.ai!.run<BriefScoringOutput>({
                profile: 'brief_scoring',
                input: evidence,
                locale: input.locale,
                correlationId: `content-brief-editor-${briefId}-${randomUUID()}`,
                usage: { accountId, siteId, jobId: briefId },
                configuredProviderOrder: deps.aiProviderOrder,
            }));
            const filtered = filterBriefScoringOutput(generated.object, evidence);
            aiCostMicros = toSafeEditorAiMicros(captured === null ? generated.provenance.actualOrEstimatedCostMicros : captured);
            aiCostSource = captured === null ? 'estimated' : 'captured';
            if (!filtered.rejected &&
                typeof filtered.output.score === 'number' &&
                filtered.output.rationale !== null) {
                aiScore = filtered.output.score;
                aiRationale = filtered.output.rationale;
                aiCitations = filtered.output.citations;
                aiDisclosure = 'scored';
            }
            else {
                aiDisclosure = 'malformed_output';
            }
        }
        catch {
            // A thrown provider call has no returned provenance. Charge the bounded
            // reservation conservatively so a retry cannot exceed the original
            // run ceiling after an indeterminate vendor outcome.
            aiCostMicros = CONTENT_BRIEF_AI_MAX_COST_MICROS;
            aiCostSource = 'estimated';
            aiDisclosure = 'provider_error';
        }
    }
    else if (deps.ai && residue >= CONTENT_BRIEF_AI_MAX_COST_MICROS) {
        aiDisclosure = 'cost_ceiling';
    }
    const createdAt = (deps.now ?? (() => new Date()))();
    let expectedCount = brief.draftVersionCount;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (expectedCount >= CONTENT_BRIEF_MAX_DRAFT_VERSIONS) {
            if (aiReservationHeld) {
                await settleEditorAiReservation(accountId, siteId, briefId, aiCostMicros, aiCostSource);
                aiReservationHeld = false;
            }
            throw new HttpError(409, { code: 'CONTENT_BRIEF_DRAFT_LIMIT', messageKey: CONTENT_BRIEF_DRAFT_LIMIT_KEY });
        }
        const version = expectedCount + 1;
        const entry = {
            version,
            draft: input.draft,
            comparison,
            aiScore,
            aiRationale,
            aiCitations,
            aiCostMicros,
            aiDisclosure,
            createdAt,
        };
        const update: Record<string, unknown> = {
            $push: {
                draftVersions: entry,
                ...(aiCostMicros > 0
                    ? {
                        costEntries: {
                            stage: 'editor_ai',
                            costMicros: aiCostMicros,
                            source: aiCostSource,
                        },
                    }
                    : {}),
            },
            $inc: {
                draftVersionCount: 1,
                editorAiCostMicros: aiCostMicros,
                ...(aiReservationHeld
                    ? { editorAiReservedMicros: -CONTENT_BRIEF_AI_MAX_COST_MICROS }
                    : {}),
            },
        };
        const updated = await ContentBrief.findOneAndUpdate({
            _id: briefId,
            accountId,
            siteId,
            draftVersionCount: expectedCount,
            ...(aiReservationHeld
                ? { editorAiReservedMicros: { $gte: CONTENT_BRIEF_AI_MAX_COST_MICROS } }
                : {}),
        }, update, { new: true });
        if (updated) {
            aiReservationHeld = false;
            return serializeContentBriefDetail(updated);
        }
        const current = await ContentBrief.findOne({ _id: briefId, accountId, siteId }).select({
            draftVersionCount: 1,
        });
        if (!current)
            throw HttpError.notFound({ code: 'CONTENT_BRIEF_NOT_FOUND', messageKey: CONTENT_BRIEF_NOT_FOUND_KEY });
        expectedCount = current.draftVersionCount;
    }
    if (aiReservationHeld) {
        await settleEditorAiReservation(accountId, siteId, briefId, aiCostMicros, aiCostSource);
    }
    throw new HttpError(409, { code: 'CONTENT_BRIEF_CONFLICT', messageKey: CONTENT_BRIEF_CONFLICT_KEY });
}
/** Read-only secondary-term seam; exported for processor and contract tests. */
export async function readBriefSecondaryTerms(accountId: string, siteId: string, keyword: ResolvedBriefKeyword): Promise<Array<{
    id: string;
    term: string;
}>> {
    const cluster = await findLatestCompletedKeywordCluster({
        accountId,
        siteId,
        keywordId: keyword.id,
        phrase: keyword.phrase,
    });
    if (!cluster)
        return [];
    const targetPhrase = keyword.phrase.trim().toLocaleLowerCase('en');
    return cluster.members
        .filter((member) => member.keywordId !== keyword.id &&
        member.phrase.trim().toLocaleLowerCase('en') !== targetPhrase)
        .slice(0, 20)
        .map((member, index) => ({
        id: `term-${index + 1}`,
        term: member.phrase.slice(0, 200),
    }));
}
