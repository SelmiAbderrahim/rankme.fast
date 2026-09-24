import type { SpendPreview } from '../../shared/safety/operation-preview.js';
/**
 * Audience Research — HTTP-side service.
 *
 * Load-bearing invariants for `startAudienceResearchRun` (start-order):
 *   1. zod parse (controller layer via `audienceResearchInputSchema`)
 *   2. Site.findOne({ _id, accountId }) — 404 not 403 (existence leak rule)
 *   3. compute `deterministicInputHash`
 *   4. atomic idempotent `AudienceResearchRun.create` — unique index catches
 *      a duplicate run
 *   5. enqueue with the deterministic `audience-research-<runId>` job id
 *   6. respond 202
 *
 * Compensation: on unique-index conflict return the existing run with
 * `duplicate: true`. On enqueue failure delete the doc so no run is left
 * that never started. Read endpoints (get/list/result) never enqueue and
 * never call vendors.
 */
import type { Queue } from 'bullmq';
import { Types } from 'mongoose';
import { createPaginationCursorCodec, type PaginationCursorCodec, } from '../../shared/security/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { isSupportedLocale, type SupportedLocale, } from '../../shared/i18n/locales.js';
import { Site } from '../sites/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { AUDIENCE_RESEARCH_JOB_NAME, enqueueAudienceResearchJob, } from '../../shared/queue/index.js';
import { AudienceResearchRun, type AudienceResearchRunDocument, type AudienceResearchRunHydrated, } from './audience-research.model.js';
import type { AudienceResearchState } from './audience-research.state.js';
import { audienceResearchInputSchema, type AudienceResearchInput, } from './audience-research.schemas.js';
import { QUERY_TEMPLATE_VERSION, } from './query-templates.js';
import { computeDeterministicInputHash, computeDeterministicInputHashV2, } from './deterministic-input-hash.js';
import { env } from '../../config/env.js';
export interface PreviewRunInput {
    accountId: string;
    siteId: string;
    input: AudienceResearchInput;
}
export interface StartRunInput {
    accountId: string;
    siteId: string;
    input: AudienceResearchInput;
    outputLocale: SupportedLocale;
}
export interface StartRunDeps {
    queue: Queue | null;
}
export interface StartedRun {
    runId: string;
    status: AudienceResearchState;
    duplicate: boolean;
    outputLocale: SupportedLocale;
}
export interface RunStatusView {
    runId: string;
    siteId: string;
    outputLocale: SupportedLocale | null;
    state: AudienceResearchState;
    stage: 'queued' | 'discovering' | 'selecting' | 'collecting' | 'clustering' | 'terminal';
    counts: {
        candidates: number;
        sources: number;
        signals: number;
    };
    progress: {
        percent: number;
    };
    coverageNoteKey: string | null;
    costMicros: {
        total: number;
        byStage: Record<string, number>;
    };
    terminal: {
        state: 'completed' | 'partial' | 'failed' | null;
        reasonCode: string | null;
        completedAt: string | null;
    };
    requestedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    updatedAt: string;
}
export interface RunResultView extends RunStatusView {
    input: {
        siteMarket: unknown;
        competitorDomains: readonly string[];
        seedTopics: readonly string[];
        queryTemplateVersion: number;
        outputLocale: SupportedLocale | null;
    };
    sources: Array<{
        sourceId: string;
        canonicalUrl: string;
        title: string;
        sourceType: string;
        registrableDomain: string;
        observedAt: string | null;
        contentHash: string;
        excerpt: string;
        observationMeta: unknown;
    }>;
    signals: Array<{
        signalId: string;
        type: string;
        title: string;
        summary: string;
        suggestedRoute: string;
        citedSourceIds: readonly string[];
        independentDomainCount: number;
        sourceTypeCount: number;
        mostRecentSourceObservedAt: string | null;
        confidence: string;
    }>;
    ledgerSummary: {
        total: number;
        ai: number;
        byStage: Record<string, number>;
    };
}
export interface ListRunsInput {
    accountId: string;
    siteId: string;
    limit: number;
    cursor?: string;
}
export interface ListRunsResult {
    items: RunStatusView[];
    nextCursor: string | null;
}
function isDuplicateKeyError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null)
        return false;
    const anyErr = err as {
        code?: number;
        name?: string;
    };
    return anyErr.code === 11000 || anyErr.name === 'MongoServerError';
}
async function loadOwnedSite(accountId: string, siteId: string) {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    return site;
}
function stageFromState(state: AudienceResearchState): RunStatusView['stage'] {
    if (state === 'queued')
        return 'queued';
    if (state === 'discovering')
        return 'discovering';
    if (state === 'selecting')
        return 'selecting';
    if (state === 'collecting')
        return 'collecting';
    if (state === 'clustering')
        return 'clustering';
    return 'terminal';
}
function percentFromState(state: AudienceResearchState): number {
    switch (state) {
        case 'queued':
            return 0;
        case 'discovering':
            return 15;
        case 'selecting':
            return 40;
        case 'collecting':
            return 65;
        case 'clustering':
            return 90;
        case 'completed':
        case 'partial':
        case 'failed':
            return 100;
        default:
            return 0;
    }
}
function isoOrNull(value: Date | null | undefined): string | null {
    if (!value)
        return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function computeCostByStage(ledger: readonly {
    stage: string;
    actualCostMicros: number;
}[]): {
    total: number;
    byStage: Record<string, number>;
} {
    const byStage: Record<string, number> = {};
    let total = 0;
    for (const entry of ledger) {
        const cost = Number(entry.actualCostMicros ?? 0);
        total += cost;
        byStage[entry.stage] = (byStage[entry.stage] ?? 0) + cost;
    }
    return { total, byStage };
}
/** Pre-change clustered signal prose was generated in hardcoded English. */
export function resolveAudienceResearchOutputLocale(doc: {
    input?: {
        outputLocale?: unknown;
    } | null;
    state: string;
    signals?: readonly unknown[] | null;
}): SupportedLocale | null {
    if (isSupportedLocale(doc.input?.outputLocale))
        return doc.input.outputLocale;
    if ((doc.state === 'completed' || doc.state === 'partial') &&
        (doc.signals?.length ?? 0) > 0) {
        return 'en';
    }
    return null;
}
function toStatusView(doc: AudienceResearchRunDocument & {
    _id: unknown;
    updatedAt: Date;
}): RunStatusView {
    const state = doc.state as AudienceResearchState;
    const cost = computeCostByStage(doc.costLedger ?? []);
    const coverageNoteKey = doc.discovery?.coverage?.coverageNoteKey ?? null;
    const terminalState = doc.terminal?.state ?? null;
    return {
        runId: String(doc._id),
        siteId: String(doc.siteId),
        outputLocale: resolveAudienceResearchOutputLocale(doc),
        state,
        stage: stageFromState(state),
        counts: {
            candidates: (doc.candidates ?? []).length,
            sources: (doc.sources ?? []).length,
            signals: (doc.signals ?? []).length,
        },
        progress: { percent: percentFromState(state) },
        coverageNoteKey,
        costMicros: cost,
        terminal: {
            state: terminalState as 'completed' | 'partial' | 'failed' | null,
            reasonCode: doc.terminal?.reasonCode ?? null,
            completedAt: isoOrNull(doc.terminal?.completedAt ?? null),
        },
        requestedAt: isoOrNull(doc.requestedAt ?? null),
        startedAt: isoOrNull(doc.startedAt ?? null),
        completedAt: isoOrNull(doc.completedAt ?? null),
        updatedAt: (doc.updatedAt as Date).toISOString(),
    };
}
function toResultView(doc: AudienceResearchRunDocument & {
    _id: unknown;
    updatedAt: Date;
}): RunResultView {
    const base = toStatusView(doc);
    const cost = computeCostByStage(doc.costLedger ?? []);
    // AI stage cost = the `cluster` stage aggregate.
    const aiCost = cost.byStage.cluster ?? 0;
    return {
        ...base,
        input: {
            siteMarket: doc.input?.siteMarket ?? null,
            competitorDomains: (doc.input?.competitorDomains ?? []) as readonly string[],
            seedTopics: (doc.input?.seedTopics ?? []) as readonly string[],
            queryTemplateVersion: Number(doc.input?.queryTemplateVersion ?? QUERY_TEMPLATE_VERSION),
            outputLocale: resolveAudienceResearchOutputLocale(doc),
        },
        sources: (doc.sources ?? []).map((source) => ({
            sourceId: source.sourceId,
            canonicalUrl: source.canonicalUrl,
            title: source.title,
            sourceType: source.sourceType,
            registrableDomain: source.registrableDomain,
            observedAt: source.observedAt ?? null,
            contentHash: source.contentHash,
            excerpt: source.excerpt,
            observationMeta: source.observationMeta ?? null,
        })),
        signals: (doc.signals ?? []).map((signal) => ({
            signalId: signal.signalId,
            type: signal.type,
            title: signal.title,
            summary: signal.summary,
            suggestedRoute: signal.suggestedRoute,
            citedSourceIds: (signal.citedSourceIds ?? []) as readonly string[],
            independentDomainCount: Number(signal.independentDomainCount ?? 0),
            sourceTypeCount: Number(signal.sourceTypeCount ?? 0),
            mostRecentSourceObservedAt: signal.mostRecentSourceObservedAt ?? null,
            confidence: signal.confidence,
        })),
        ledgerSummary: {
            total: cost.total,
            ai: aiCost,
            byStage: cost.byStage,
        },
    };
}
/**
 * Preview — parse + ownership. Never spends, never enqueues, never calls a
 * vendor.
 */
export async function previewAudienceResearchRun(input: PreviewRunInput): Promise<SpendPreview> {
    await loadOwnedSite(input.accountId, input.siteId);
    return { deploymentMode: 'community', capacityEnforced: false };
}
/** START — the load-bearing ordering above. */
export async function startAudienceResearchRun(input: StartRunInput, deps: StartRunDeps): Promise<StartedRun> {
    const queue = deps.queue;
    if (!queue) {
        throw new HttpError(503, { code: 'AUDIENCE_RESEARCH_ERRORS_PROCESSING_FAILURE', messageKey: 'audienceResearch.errors.processingFailure' });
    }
    // (2) Ownership.
    const site = await loadOwnedSite(input.accountId, input.siteId);
    assertSiteNotPaused(site);
    // (3) Deterministic identity — client retries resolve to the same runId.
    const legacyInputHash = computeDeterministicInputHash({
        accountId: input.accountId,
        siteId: input.siteId,
        siteMarket: input.input.siteMarket,
        competitorDomains: input.input.competitorDomains,
        seedTopics: input.input.seedTopics,
        queryTemplateVersion: QUERY_TEMPLATE_VERSION,
    });
    const deterministicInputHash = computeDeterministicInputHashV2({
        accountId: input.accountId,
        siteId: input.siteId,
        siteMarket: input.input.siteMarket,
        competitorDomains: input.input.competitorDomains,
        seedTopics: input.input.seedTopics,
        queryTemplateVersion: QUERY_TEMPLATE_VERSION,
        outputLocale: input.outputLocale,
    });
    // Idempotent short-circuit — a duplicate `deterministicInputHash` returns
    // the existing run BEFORE any additional side-effect fires. The unique
    // index on `(accountId, deterministicInputHash)` is authoritative; this
    // pre-read is a fast path.
    const existing = await AudienceResearchRun.findOne({
        accountId: input.accountId,
        deterministicInputHash: {
            $in: input.outputLocale === 'en'
                ? [deterministicInputHash, legacyInputHash]
                : [deterministicInputHash],
        },
    });
    if (existing) {
        return {
            runId: String(existing._id),
            status: existing.state as AudienceResearchState,
            duplicate: true,
            outputLocale: input.outputLocale,
        };
    }
    // (4) Create the domain record.
    let doc: AudienceResearchRunHydrated;
    try {
        doc = (await AudienceResearchRun.create({
            accountId: input.accountId,
            siteId: input.siteId,
            state: 'queued',
            input: {
                siteMarket: input.input.siteMarket,
                competitorDomains: [...input.input.competitorDomains],
                seedTopics: [...input.input.seedTopics],
                queryTemplateVersion: QUERY_TEMPLATE_VERSION,
                outputLocale: input.outputLocale,
            },
            deterministicInputHash,
            requestedAt: new Date(),
        })) as AudienceResearchRunHydrated;
    }
    catch (err) {
        if (isDuplicateKeyError(err)) {
            // A parallel writer beat us to it; return its run when visible.
            const race = await AudienceResearchRun.findOne({
                accountId: input.accountId,
                deterministicInputHash,
            });
            if (race) {
                return {
                    runId: String(race._id),
                    status: race.state as AudienceResearchState,
                    duplicate: true,
                    outputLocale: input.outputLocale,
                };
            }
        }
        throw err;
    }
    // (5) Enqueue with the deterministic job id.
    try {
        await enqueueAudienceResearchJob(queue, {
            accountId: input.accountId,
            siteId: input.siteId,
            runId: String(doc._id),
            outputLocale: input.outputLocale,
        });
    }
    catch (err) {
        // Enqueue failure BEFORE any processor takes ownership — delete the
        // run and re-raise as 503.
        await AudienceResearchRun.deleteOne({ _id: doc._id });
        throw new HttpError(503, { code: 'AUDIENCE_RESEARCH_ERRORS_PROCESSING_FAILURE', messageKey: 'audienceResearch.errors.processingFailure' }, undefined, {
            cause: err,
        });
    }
    // Reference the shared job-name symbol so it stays imported and any
    // future rename lands here as a typecheck error, not a silent skew.
    void AUDIENCE_RESEARCH_JOB_NAME;
    return {
        runId: String(doc._id),
        status: doc.state as AudienceResearchState,
        duplicate: false,
        outputLocale: input.outputLocale,
    };
}
export async function getAudienceResearchRun(input: {
    accountId: string;
    siteId: string;
    runId: string;
}): Promise<RunStatusView> {
    if (!Types.ObjectId.isValid(input.runId)) {
        throw HttpError.notFound({ code: 'AUDIENCE_RESEARCH_ERRORS_RUN_NOT_FOUND', messageKey: 'audienceResearch.errors.runNotFound' });
    }
    await loadOwnedSite(input.accountId, input.siteId);
    const doc = await AudienceResearchRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
        siteId: input.siteId,
    });
    if (!doc)
        throw HttpError.notFound({ code: 'AUDIENCE_RESEARCH_ERRORS_NO_USABLE_EVIDENCE', messageKey: 'audienceResearch.errors.noUsableEvidence' });
    return toStatusView(doc.toObject() as AudienceResearchRunDocument & {
        _id: unknown;
        updatedAt: Date;
    });
}
export async function getAudienceResearchRunResult(input: {
    accountId: string;
    siteId: string;
    runId: string;
}): Promise<RunResultView> {
    if (!Types.ObjectId.isValid(input.runId)) {
        throw HttpError.notFound({ code: 'AUDIENCE_RESEARCH_ERRORS_RUN_NOT_FOUND', messageKey: 'audienceResearch.errors.runNotFound' });
    }
    await loadOwnedSite(input.accountId, input.siteId);
    const doc = await AudienceResearchRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
        siteId: input.siteId,
    });
    if (!doc)
        throw HttpError.notFound({ code: 'AUDIENCE_RESEARCH_ERRORS_NO_USABLE_EVIDENCE', messageKey: 'audienceResearch.errors.noUsableEvidence' });
    return toResultView(doc.toObject() as AudienceResearchRunDocument & {
        _id: unknown;
        updatedAt: Date;
    });
}
interface CursorPayload {
    ts: number;
    id: string;
}
let cursorCodec: PaginationCursorCodec | null = null;
function getCursorCodec(): PaginationCursorCodec {
    if (cursorCodec)
        return cursorCodec;
    cursorCodec = createPaginationCursorCodec(env.BETTER_AUTH_SECRET);
    return cursorCodec;
}
export async function listAudienceResearchRuns(input: ListRunsInput): Promise<ListRunsResult> {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const query: Record<string, unknown> = {
        accountId: input.accountId,
        siteId: String(site._id),
    };
    if (input.cursor) {
        let decoded: CursorPayload;
        try {
            const raw = getCursorCodec().decode(input.cursor);
            decoded = JSON.parse(raw) as CursorPayload;
        }
        catch {
            throw HttpError.badRequest({ code: 'AUDIENCE_RESEARCH_ERRORS_PROCESSING_FAILURE', messageKey: 'audienceResearch.errors.processingFailure' });
        }
        query.createdAt = { $lt: new Date(decoded.ts) };
    }
    const rows = await AudienceResearchRun.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const items = page.map((row) => toStatusView(row.toObject() as AudienceResearchRunDocument & {
        _id: unknown;
        updatedAt: Date;
    }));
    let nextCursor: string | null = null;
    if (hasMore) {
        const last = page[page.length - 1]!;
        const lastObj = last.toObject() as AudienceResearchRunDocument & {
            _id: unknown;
            createdAt: Date;
        };
        const ts = (lastObj.createdAt as Date).getTime();
        nextCursor = getCursorCodec().encode(JSON.stringify({ ts, id: String(lastObj._id) } satisfies CursorPayload));
    }
    return { items, nextCursor };
}
// Re-export for controller convenience.
export { audienceResearchInputSchema };
export type { AudienceResearchInput };
