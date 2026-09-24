import type { Job } from 'bullmq';
import { and, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { backlinkRowSnapshots, vendorResponses, type NewBacklinkRowSnapshot, } from '../../db/schema/index.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
import type { BacklinkProvider } from '../../shared/providers/index.js';
import { ProviderError, VendorUnavailableError, } from '../../shared/providers/index.js';
import type { BacklinkDeepJob } from '../../shared/queue/index.js';
import { createReadThrough, createSingleFlight, createVendorCacheRepo, } from '../../shared/vendor-cache/index.js';
import { canonicalizeDisavowDomain, canonicalizeDisavowUrl, } from './disavow-serializer.js';
import { BACKLINK_VENDOR_OPERATIONS, backlinkBulkSpamScoreCacheParams, } from './backlink-vendor-operations.js';
import { ToxicityReviewRun } from './toxicity-review.model.js';
import { TOXICITY_BULK_DOMAIN_CLAMP, TOXICITY_ROW_CLAMP, } from './toxicity-review.service.js';
import { classifyToxicity } from './toxicity-rubric.js';
export const TOXICITY_BULK_BASE_COST_MICROS = 20000;
export const TOXICITY_BULK_TARGET_COST_MICROS = 30;
export const TOXICITY_AI_MAX_COST_MICROS = 7000;
export const TOXICITY_BULK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TOXICITY_ARCHIVE_PAGE_BATCH = 100;
const archivedRowSchema = z
    .object({
    domainFrom: z.string().optional(),
    urlFrom: z.string().min(1).max(2048),
    urlTo: z.string().min(1).max(2048),
    anchor: z.string().nullable(),
    dofollow: z.boolean(),
    isBroken: z.boolean(),
    firstSeen: z.string().datetime({ offset: true }).nullable(),
    lastSeen: z.string().datetime({ offset: true }).nullable(),
    backlinkSpamScore: z.number().int().min(0).max(100).nullable().optional(),
    urlToSpamScore: z.number().int().min(0).max(100).nullable().optional(),
})
    .strict();
const archivedPageSchema = z
    .object({
    rows: z.array(archivedRowSchema),
    nextCursor: z.string().nullable().optional(),
})
    .strict();
const bulkScorePayloadSchema = z.array(z
    .object({
    target: z.string().min(1).max(2048),
    spamScore: z.number().int().min(0).max(100).nullable(),
})
    .strict());
interface CandidateRow {
    url: string;
    domain: string;
    dofollow: boolean;
    isBroken: boolean;
    firstSeen: Date | null;
    lastSeen: Date | null;
    sourceSpamScore: number | null;
}
interface ArchivedResponsePage {
    id: string;
    params: unknown;
    payload: unknown;
    fetchedAt: Date;
}
interface DisavowRationaleOutput {
    rationales: Array<{
        rowId: string;
        rationale: string;
        citations: string[];
    }>;
    citations: string[];
}
export interface ToxicityReviewProcessorDeps {
    db: Db;
    provider: BacklinkProvider;
    ai?: AiProfileRunner;
    aiProviderOrder?: readonly AiGenerationProviderKey[];
    now?: () => Date;
}
const toxicitySingleFlight = createSingleFlight();
function domainFromArchivedRow(row: z.infer<typeof archivedRowSchema>): string | null {
    const raw = row.domainFrom ??
        (() => {
            try {
                return new URL(row.urlFrom).hostname;
            }
            catch {
                return null;
            }
        })();
    if (!raw)
        return null;
    try {
        return canonicalizeDisavowDomain(raw);
    }
    catch {
        return null;
    }
}
function candidateFromArchivedRow(row: z.infer<typeof archivedRowSchema>): CandidateRow | null {
    const domain = domainFromArchivedRow(row);
    if (!domain)
        return null;
    let url: string;
    try {
        url = canonicalizeDisavowUrl(row.urlFrom);
    }
    catch {
        return null;
    }
    return {
        url,
        domain,
        dofollow: row.dofollow,
        isBroken: row.isBroken,
        firstSeen: row.firstSeen ? new Date(row.firstSeen) : null,
        lastSeen: row.lastSeen ? new Date(row.lastSeen) : null,
        sourceSpamScore: row.backlinkSpamScore ?? null,
    };
}
async function loadArchivedCandidates(db: Db, domain: string): Promise<CandidateRow[]> {
    const byUrl = new Map<string, CandidateRow>();
    let cursor: {
        fetchedAt: Date;
        id: string;
    } | null = null;
    while (byUrl.size < TOXICITY_ROW_CLAMP) {
        const beforeCursor: SQL | undefined = cursor
            ? or(lt(vendorResponses.fetchedAt, cursor.fetchedAt), and(eq(vendorResponses.fetchedAt, cursor.fetchedAt), lt(vendorResponses.id, cursor.id)))
            : undefined;
        const archives: ArchivedResponsePage[] = await db
            .select({
            id: vendorResponses.id,
            params: vendorResponses.params,
            payload: vendorResponses.payload,
            fetchedAt: vendorResponses.fetchedAt,
        })
            .from(vendorResponses)
            .where(and(eq(vendorResponses.capability, 'backlink'), inArray(vendorResponses.operation, ['list-first-page', 'list-page']), sql<boolean> `(${vendorResponses.params} ->> 'domain') = ${domain}`, beforeCursor))
            .orderBy(desc(vendorResponses.fetchedAt), desc(vendorResponses.id))
            .limit(TOXICITY_ARCHIVE_PAGE_BATCH);
        for (const archive of archives) {
            const params = z
                .object({ domain: z.string() })
                .passthrough()
                .safeParse(archive.params);
            if (!params.success || params.data.domain !== domain)
                continue;
            const page = archivedPageSchema.safeParse(archive.payload);
            if (!page.success)
                continue;
            for (const rawRow of page.data.rows) {
                const row = candidateFromArchivedRow(rawRow);
                if (row && !byUrl.has(row.url))
                    byUrl.set(row.url, row);
                if (byUrl.size >= TOXICITY_ROW_CLAMP)
                    return [...byUrl.values()];
            }
        }
        if (archives.length < TOXICITY_ARCHIVE_PAGE_BATCH)
            break;
        const last: ArchivedResponsePage | undefined = archives[archives.length - 1];
        if (!last)
            break;
        cursor = { fetchedAt: last.fetchedAt, id: last.id };
    }
    return [...byUrl.values()];
}
function targetDomains(rows: readonly CandidateRow[]): string[] {
    const scoreMissing = [
        ...new Set(rows
            .filter((row) => row.sourceSpamScore === null)
            .map((row) => row.domain)),
    ].sort();
    const scorePresent = [
        ...new Set(rows
            .filter((row) => row.sourceSpamScore !== null)
            .map((row) => row.domain)),
    ]
        .filter((domain) => !scoreMissing.includes(domain))
        .sort();
    return [...scoreMissing, ...scorePresent].slice(0, TOXICITY_BULK_DOMAIN_CLAMP);
}
function bulkStageEstimate(domainCount: number): number {
    return domainCount === 0
        ? 0
        : TOXICITY_BULK_BASE_COST_MICROS +
            domainCount * TOXICITY_BULK_TARGET_COST_MICROS;
}
async function persistRows(payload: BacklinkDeepJob, candidates: readonly CandidateRow[], bulkScores: ReadonlyMap<string, number>, capturedAt: Date, db: Db) {
    const values: NewBacklinkRowSnapshot[] = [];
    for (const candidate of candidates) {
        const spamScore = bulkScores.get(candidate.domain) ?? candidate.sourceSpamScore;
        if (spamScore === null)
            continue;
        const rubric = classifyToxicity({
            spamScore,
            dofollow: candidate.dofollow,
            isBroken: candidate.isBroken,
        });
        values.push({
            reviewId: payload.runId,
            accountId: payload.accountId,
            siteId: payload.siteId,
            url: candidate.url,
            domain: candidate.domain,
            spamScore,
            rubricBand: rubric.band,
            rubricVersion: rubric.rubricVersion,
            firstSeen: candidate.firstSeen,
            lastSeen: candidate.lastSeen,
            dofollow: candidate.dofollow,
            isBroken: candidate.isBroken,
            capturedAt,
        });
    }
    if (values.length > 0) {
        await db.insert(backlinkRowSnapshots).values(values).onConflictDoNothing();
    }
    return db
        .select()
        .from(backlinkRowSnapshots)
        .where(and(eq(backlinkRowSnapshots.accountId, payload.accountId), eq(backlinkRowSnapshots.reviewId, payload.runId)))
        .orderBy(backlinkRowSnapshots.id)
        .limit(TOXICITY_ROW_CLAMP);
}
async function annotateFlaggedRows(payload: BacklinkDeepJob, rows: Awaited<ReturnType<typeof persistRows>>, runLocale: string, deps: ToxicityReviewProcessorDeps): Promise<'succeeded' | 'abstained' | 'failed'> {
    const flagged = rows
        .filter((row) => row.rubricBand === 'watch' || row.rubricBand === 'toxic')
        .slice(0, 100);
    if (flagged.length === 0 || !deps.ai || !deps.aiProviderOrder)
        return 'abstained';
    await deps.db
        .update(backlinkRowSnapshots)
        .set({ rationaleStatus: 'abstained', rationale: null })
        .where(and(eq(backlinkRowSnapshots.accountId, payload.accountId), eq(backlinkRowSnapshots.reviewId, payload.runId), inArray(backlinkRowSnapshots.rubricBand, ['watch', 'toxic'])));
    try {
        const generated = await deps.ai.run<DisavowRationaleOutput>({
            profile: 'disavow_rationale',
            input: {
                rows: flagged.map((row) => ({
                    id: row.id,
                    domain: row.domain,
                    spamScore: row.spamScore,
                    band: row.rubricBand,
                    isBroken: row.isBroken,
                    dofollow: row.dofollow,
                    rubricVersion: row.rubricVersion,
                })),
            },
            locale: runLocale,
            correlationId: `toxicity-${payload.runId}`,
            usage: {
                accountId: payload.accountId,
                siteId: payload.siteId,
                jobId: payload.runId,
            },
            configuredProviderOrder: deps.aiProviderOrder,
        });
        for (const rationale of generated.object.rationales) {
            await deps.db
                .update(backlinkRowSnapshots)
                .set({
                rationale: rationale.rationale,
                rationaleStatus: 'annotated',
            })
                .where(and(eq(backlinkRowSnapshots.accountId, payload.accountId), eq(backlinkRowSnapshots.reviewId, payload.runId), eq(backlinkRowSnapshots.id, rationale.rowId)));
        }
        return generated.object.rationales.length > 0 ? 'succeeded' : 'abstained';
    }
    catch {
        await deps.db
            .update(backlinkRowSnapshots)
            .set({ rationaleStatus: 'failed', rationale: null })
            .where(and(eq(backlinkRowSnapshots.accountId, payload.accountId), eq(backlinkRowSnapshots.reviewId, payload.runId), inArray(backlinkRowSnapshots.rubricBand, ['watch', 'toxic'])));
        return 'failed';
    }
}
function missingBulkOperation(): VendorUnavailableError {
    return new VendorUnavailableError('backlink bulk spam score operation unavailable', {
        provider: 'backlink',
        operation: 'bulk_spam_score',
    });
}
export function createToxicityReviewProcessor(deps: ToxicityReviewProcessorDeps) {
    return async (job: Job<BacklinkDeepJob>): Promise<void> => {
        const payload = job.data;
        const run = await ToxicityReviewRun.findOne({
            _id: payload.runId,
            accountId: payload.accountId,
            siteId: payload.siteId,
        });
        if (!run || run.status === 'succeeded' || run.status === 'failed')
            return;
        const now = deps.now ?? (() => new Date());
        run.status = 'running';
        await run.save();
        try {
            const candidates = await loadArchivedCandidates(deps.db, run.domain);
            if (candidates.length === 0) {
                await ToxicityReviewRun.updateOne({ _id: run._id, accountId: payload.accountId }, {
                    $set: {
                        status: 'succeeded',
                        providerStatus: 'not_needed',
                        aiStatus: 'abstained',
                        retainedCount: 0,
                        bulkDomainCount: 0,
                        estimatedCostMicros: 0,
                        completedAt: now(),
                    },
                });
                return;
            }
            const targets = targetDomains(candidates);
            const bulkCost = bulkStageEstimate(targets.length);
            if (bulkCost > env.TOXICITY_COST_CEILING_MICROS) {
                await ToxicityReviewRun.updateOne({ _id: run._id, accountId: payload.accountId }, {
                    $set: {
                        status: 'failed',
                        providerStatus: 'budget_halted',
                        aiStatus: 'budget_skipped',
                        failureKind: 'ceiling_halted',
                        bulkDomainCount: targets.length,
                        estimatedCostMicros: bulkCost,
                        completedAt: now(),
                    },
                });
                return;
            }
            let providerFailure: ProviderError | null = null;
            let scored: Array<{
                target: string;
                spamScore: number | null;
            }> = [];
            try {
                if (!deps.provider.getBulkSpamScores)
                    throw missingBulkOperation();
                const readThrough = createReadThrough({
                    repo: createVendorCacheRepo(deps.db),
                    singleFlight: toxicitySingleFlight,
                    clock: now,
                });
                const response = await readThrough({
                    capability: 'backlink',
                    operation: BACKLINK_VENDOR_OPERATIONS.bulkSpamScore,
                    params: backlinkBulkSpamScoreCacheParams(targets),
                    ttlMs: TOXICITY_BULK_CACHE_TTL_MS,
                    payloadSchema: bulkScorePayloadSchema,
                    accountId: payload.accountId,
                    now: now(),
                    clock: now,
                    fetch: () => deps.provider.getBulkSpamScores!(targets),
                });
                scored = response.value;
            }
            catch (error) {
                if (!(error instanceof ProviderError))
                    throw error;
                providerFailure = error;
            }
            const scoreMap = new Map<string, number>();
            for (const row of scored) {
                if (row.spamScore !== null) {
                    scoreMap.set(row.target.toLowerCase().replace(/^www\./u, ''), row.spamScore);
                }
            }
            const rows = await persistRows(payload, candidates, scoreMap, now(), deps.db);
            if (providerFailure && rows.length === 0) {
                await ToxicityReviewRun.updateOne({ _id: run._id, accountId: payload.accountId }, {
                    $set: {
                        providerStatus: 'failed',
                        aiStatus: 'not_requested',
                        failureKind: 'provider_failed',
                        retainedCount: 0,
                        bulkDomainCount: targets.length,
                        estimatedCostMicros: bulkCost,
                    },
                });
                throw providerFailure;
            }
            if (providerFailure) {
                await ToxicityReviewRun.updateOne({ _id: run._id, accountId: payload.accountId }, {
                    $set: {
                        status: 'succeeded',
                        providerStatus: 'partial_failed',
                        aiStatus: 'failed',
                        retainedCount: rows.length,
                        bulkDomainCount: targets.length,
                        estimatedCostMicros: bulkCost,
                        completedAt: now(),
                    },
                });
                return;
            }
            const canRunAi = bulkCost + TOXICITY_AI_MAX_COST_MICROS <=
                env.TOXICITY_COST_CEILING_MICROS;
            const aiStatus = canRunAi
                ? await annotateFlaggedRows(payload, rows, run.locale, deps)
                : 'budget_skipped';
            await ToxicityReviewRun.updateOne({ _id: run._id, accountId: payload.accountId }, {
                $set: {
                    status: 'succeeded',
                    providerStatus: 'succeeded',
                    aiStatus,
                    retainedCount: rows.length,
                    bulkDomainCount: targets.length,
                    estimatedCostMicros: bulkCost +
                        (canRunAi && rows.some((row) => row.rubricBand !== 'clean')
                            ? TOXICITY_AI_MAX_COST_MICROS
                            : 0),
                    completedAt: now(),
                },
            });
        }
        catch (error) {
            const retained = await deps.db
                .select({ id: backlinkRowSnapshots.id })
                .from(backlinkRowSnapshots)
                .where(and(eq(backlinkRowSnapshots.accountId, payload.accountId), eq(backlinkRowSnapshots.reviewId, payload.runId)))
                .limit(1);
            await ToxicityReviewRun.updateOne({ _id: run._id, accountId: payload.accountId }, {
                $set: {
                    status: 'failed',
                    retainedCount: retained.length,
                    failureKind: error instanceof ProviderError ? 'provider_failed' : null,
                    completedAt: now(),
                },
            });
            throw error;
        }
    };
}
export { bulkStageEstimate, candidateFromArchivedRow, loadArchivedCandidates, targetDomains, };
