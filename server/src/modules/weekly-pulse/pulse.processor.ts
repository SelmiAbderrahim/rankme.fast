/**
 * Weekly Pulse — BullMQ worker processor.
 *
 * State machine:
 *
 *   • No supported cell → `unsupported`, no provider call.
 *   • Supported cells, ALL success → `completed`.
 *   • Supported cells, some partial/error → `partial`.
 *   • Supported cells, ALL error → `failed`.
 *
 * The unique `collecting` row is claimed before the first provider call. A
 * replay therefore sees the durable claim and never repeats vendor work. The
 * scheduler reconciler converts abandoned collecting rows to a bounded,
 * honest failed state.
 */
import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { AiVisibilityProvider } from '../../shared/providers/index.js';
import { parseConsumedPayload, weeklyPulseConsumedJobSchema, type WeeklyPulseConsumedJob, } from '../../shared/queue/index.js';
import { sitePulseSettings, sitePulseSubscriptions, weeklyPulseCitationChanges, weeklyPulseCitations, weeklyPulseRuns, type NewWeeklyPulseCitationChangeRow, type NewWeeklyPulseCitationRow, type WeeklyPulseRunRow, type WeeklyPulseRunStatus, } from '../../db/schema/weekly-pulse.js';
import { runCollection, UnsupportedPulseError, type CollectionPorts, type CollectionResult, } from './collection.service.js';
import { computeCitationChanges, type CitationRow, type EngineSurfaceCell, type PulseInputs, } from './citation-changes.service.js';
import { computeBrandDeltas, WEEKLY_PULSE_BRAND_DELTA_WINDOW_MS, type BrandDeltaEntry, type BrandRadarScanWindow, type LoadBrandRadarScansInput, } from './brand-deltas.service.js';
import { computeSchedule, isoWeekUtc, nextRunAt } from './schedule.js';
/**
 * DataForSEO may execute up to the bounded ten-prompt cohort serially. Two
 * hours is deliberately beyond the provider client's retry/timeout envelope;
 * only a genuinely abandoned claim is recovered.
 */
export const WEEKLY_PULSE_INTERRUPTED_AFTER_MS = 2 * 60 * 60 * 1000;
const WEEKLY_PULSE_RECOVERY_BATCH_SIZE = 100;
// ---------------------------------------------------------------------------
// Deps + I/O
// ---------------------------------------------------------------------------
export interface ResolveSiteInput {
    accountId: string;
    siteId: string;
}
export interface ResolvedSite {
    siteDomain: string;
}
export interface PulseProcessorDeps {
    db: ApplicationDb;
    aiVisibility: AiVisibilityProvider;
    ports: CollectionPorts;
    /** Owner-check: returns null when the site was deleted / re-owned. */
    resolveSite(input: ResolveSiteInput): Promise<ResolvedSite | null>;
    /**
     * Stored-data-only Brand Radar reader. Provably read-only: the
     * brand-delta step calls no queue `add` and no `captureVendorCost`, and
     * never schedules a new scan.
     */
    loadBrandRadarScans(input: LoadBrandRadarScansInput): Promise<BrandRadarScanWindow>;
    /**
     * Freeze and deliver a completed/partial run. The production implementation
     * is replay-safe and reads the frozen projection on a retry.
     */
    projectAndDeliver?(runId: string): Promise<unknown>;
    logger: Logger;
    now?: () => Date;
}
// ---------------------------------------------------------------------------
// Public processor factory
// ---------------------------------------------------------------------------
export function createWeeklyPulseProcessor(deps: PulseProcessorDeps) {
    const now = deps.now ?? (() => new Date());
    return async function processWeeklyPulseJob(job: Job): Promise<void> {
        const payload = parseConsumedPayload(weeklyPulseConsumedJobSchema, job.data) as WeeklyPulseConsumedJob;
        const outcome = await runWeeklyPulse(deps, payload, now);
        if (outcome.runId !== null &&
            (outcome.status === 'completed' || outcome.status === 'partial')) {
            if (!deps.projectAndDeliver) {
                throw new Error('weekly-pulse projectAndDeliver port is not configured');
            }
            await deps.projectAndDeliver(outcome.runId);
        }
    };
}
// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
export interface RunWeeklyPulseOutcome {
    status: WeeklyPulseRunStatus;
    runId: string | null;
}
export async function runWeeklyPulse(deps: PulseProcessorDeps, payload: WeeklyPulseConsumedJob, now: () => Date): Promise<RunWeeklyPulseOutcome> {
    const clock = now();
    // Scheduler jobs derive the week at fire time. The `template` branch is a
    // backwards-compatible drain for jobs accepted by earlier releases.
    const isoWeek = 'scheduled' in payload || payload.isoWeek === 'template'
        ? isoWeekUtc(clock)
        : payload.isoWeek;
    // Step 1: ownership + eligibility.
    const site = await deps.resolveSite({
        accountId: payload.accountId,
        siteId: payload.siteId,
    });
    if (!site) {
        // Site gone; drop the scheduler entry (best-effort) and skip. No row
        // written step 2.
        return { status: 'unsupported', runId: null };
    }
    const subs = await deps.db
        .select({ id: sitePulseSubscriptions.id })
        .from(sitePulseSubscriptions)
        .where(and(eq(sitePulseSubscriptions.accountId, payload.accountId), eq(sitePulseSubscriptions.siteId, payload.siteId), isNull(sitePulseSubscriptions.disabledAt)));
    if (subs.length === 0) {
        return { status: 'unsupported', runId: null };
    }
    // Sequential BullMQ retries must converge BEFORE the provider boundary.
    // The old implementation discovered the unique-week conflict only after
    // collecting, which could call the provider again.
    // Returning the existing id also lets the processor resume a projection or
    // delivery that failed after the collection committed.
    const existingRuns = await deps.db
        .select({ id: weeklyPulseRuns.id, status: weeklyPulseRuns.status })
        .from(weeklyPulseRuns)
        .where(and(eq(weeklyPulseRuns.accountId, payload.accountId), eq(weeklyPulseRuns.siteId, payload.siteId), eq(weeklyPulseRuns.isoWeek, isoWeek)))
        .limit(1);
    const existingRun = existingRuns[0];
    if (existingRun) {
        return { status: existingRun.status, runId: existingRun.id };
    }
    // Step 2: load market / cohort / coverage BEFORE the claim.
    // We speculatively run collection to detect `unsupported` — but do NOT
    // call the AI provider before the run claim: we short-circuit on the
    // engine_surface_set check first.
    let siteMarketVal: unknown = null;
    let cohortId = '';
    let cohortVersion = 0;
    let coverageCells: EngineSurfaceCell[] = [];
    const marketSnapshot = await deps.ports.loadSiteMarket({
        accountId: payload.accountId,
        siteId: payload.siteId,
    });
    const cohortSnapshot = await deps.ports.loadPromptCohort({
        accountId: payload.accountId,
        siteId: payload.siteId,
    });
    const coverageSnapshot = await deps.ports.loadCoverage({
        accountId: payload.accountId,
        siteId: payload.siteId,
    });
    if (!marketSnapshot || !cohortSnapshot) {
        return persistTerminal(deps, {
            accountId: payload.accountId,
            siteId: payload.siteId,
            isoWeek,
            status: 'unsupported',
            // marketSnapshot column is NOT NULL — persist an empty object when the
            // upstream loader has not yet shipped.
            marketSnapshotValue: marketSnapshot?.value ?? {},
            promptCohortId: cohortSnapshot?.id ?? 'none',
            promptCohortVersion: cohortSnapshot?.version ?? 0,
            engineSurfaceSet: coverageSnapshot.cells,
            startedAt: clock,
            counts: emptyCounts(),
            errorCode: 'unsupported',
            errorDetailSafe: 'weeklyPulse.errors.missingMarketOrCohort',
        }).then((row) => ({ status: row.status, runId: row.id }));
    }
    siteMarketVal = marketSnapshot.value;
    cohortId = cohortSnapshot.id;
    cohortVersion = cohortSnapshot.version;
    coverageCells = coverageSnapshot.cells.map((c) => ({
        engine: c.engine,
        surface: c.surface,
        promptCohortId: cohortSnapshot.id,
        promptCohortVersion: cohortSnapshot.version,
        supported: c.supported,
        complete: false, // filled after collection
    }));
    const hasSupported = coverageCells.some((c) => c.supported);
    if (!hasSupported) {
        // step 5.
        return persistTerminal(deps, {
            accountId: payload.accountId,
            siteId: payload.siteId,
            isoWeek,
            status: 'unsupported',
            marketSnapshotValue: siteMarketVal,
            promptCohortId: cohortId,
            promptCohortVersion: cohortVersion,
            engineSurfaceSet: coverageSnapshot.cells,
            startedAt: clock,
            counts: emptyCounts(),
            errorCode: 'unsupported',
            errorDetailSafe: 'weeklyPulse.errors.noSupportedCell',
        }).then((row) => ({ status: row.status, runId: row.id }));
    }
    // Step 3: win the unique weekly claim. The run row goes first so a
    // concurrent collector loses at the unique boundary BEFORE it can call
    // the provider.
    const claim = await claimCollectingRun(deps, {
        accountId: payload.accountId,
        siteId: payload.siteId,
        isoWeek,
        marketSnapshotValue: siteMarketVal,
        promptCohortId: cohortId,
        promptCohortVersion: cohortVersion,
        engineSurfaceSet: coverageSnapshot.cells,
        startedAt: clock,
    });
    if (!claim.claimed) {
        return { status: claim.row.status, runId: claim.row.id };
    }
    // Step 4: run the collection now that the run is claimed.
    let collection: CollectionResult | null = null;
    let collectionError: 'unsupported' | 'failed' | null = null;
    try {
        collection = await runCollection({ aiVisibility: deps.aiVisibility, ports: deps.ports }, {
            accountId: payload.accountId,
            siteId: payload.siteId,
            siteDomain: site.siteDomain,
            windowEnd: clock,
        });
    }
    catch (err) {
        if (err instanceof UnsupportedPulseError) {
            // A supported cell existed at gate time but the collection tripped
            // over a missing market/cohort race — mirror `unsupported`.
            collectionError = 'unsupported';
        }
        else {
            collectionError = 'failed';
        }
    }
    // Terminal classification.
    if (collectionError !== null || collection === null) {
        const status: WeeklyPulseRunStatus = collectionError === 'unsupported' ? 'unsupported' : 'failed';
        const finalized = await finalizeClaimedRun(deps, {
            runId: claim.row.id,
            accountId: payload.accountId,
            siteId: payload.siteId,
            isoWeek,
            status,
            marketSnapshotValue: siteMarketVal,
            promptCohortId: cohortId,
            promptCohortVersion: cohortVersion,
            engineSurfaceSet: coverageSnapshot.cells,
            startedAt: clock,
            counts: emptyCounts(),
            errorCode: status,
            errorDetailSafe: `weeklyPulse.errors.${status}`,
            citationRows: [],
            changeRows: [],
        });
        return { status: finalized.status, runId: finalized.id };
    }
    // At least one supported cell; assess partial/failed vs completed.
    const supported = collection.cells.filter((c, i) => coverageCells[i]?.supported);
    const successfulSupported = supported.filter((c) => c.error === null);
    const anyPartial = supported.some((c) => c.error !== null || !c.complete);
    const allFailed = supported.length > 0 && successfulSupported.length === 0;
    const terminal: WeeklyPulseRunStatus = allFailed
        ? 'failed'
        : anyPartial
            ? 'partial'
            : 'completed';
    // Brand Radar deltas — stored-data reads only, alongside the collection
    // steps. Scoped to the pulse run's own site and emitted per tracked brand
    // query; see `brand-deltas.service.ts`.
    const brandDeltas = await computeBrandDeltas({ ports: { loadBrandRadarScans: deps.loadBrandRadarScans } }, {
        accountId: payload.accountId,
        siteId: payload.siteId,
        windowStart: new Date(clock.getTime() - WEEKLY_PULSE_BRAND_DELTA_WINDOW_MS),
        windowEnd: clock,
    });
    // Enrich the citation_changes-friendly cell shape with each cell's
    // complete flag from the collection.
    const enrichedCoverage: EngineSurfaceCell[] = coverageCells.map((c, i) => ({
        ...c,
        complete: collection?.cells[i]?.complete ?? false,
    }));
    const citationRowsByCellUrl = new Map<string, NewWeeklyPulseCitationRow>();
    const citationIdIndex = new Map<string, string>();
    for (const cell of collection.cells) {
        for (const c of cell.citations) {
            const cellUrlKey = `${cell.engine}|${cell.surface}|${c.canonicalUrl}`;
            if (citationRowsByCellUrl.has(cellUrlKey))
                continue;
            const citationId = randomUUID();
            citationRowsByCellUrl.set(cellUrlKey, {
                id: citationId,
                pulseRunId: claim.row.id,
                engine: cell.engine,
                surface: cell.surface,
                promptCohortId: cohortId,
                promptCohortVersion: cohortVersion,
                canonicalUrl: c.canonicalUrl,
                titleSafe: c.titleSafe,
                host: c.host,
                mentionCount: c.mentionCount,
                firstSeenAt: c.firstSeenAt,
            });
            citationIdIndex.set(cellUrlKey, citationId);
        }
    }
    const citationRowsOut = [...citationRowsByCellUrl.values()];
    // Compute + persist citation changes vs the compatible prior pulse.
    const priorPulse = await loadCompatiblePrior(deps.db, {
        accountId: payload.accountId,
        siteId: payload.siteId,
        isoWeek,
        cohortId,
        cohortVersion,
        marketSnapshotValue: siteMarketVal,
        supportedFingerprint: fingerprintSupported(enrichedCoverage),
    });
    const currentInputs: PulseInputs = {
        status: terminal,
        promptCohortId: cohortId,
        promptCohortVersion: cohortVersion,
        marketSnapshot: siteMarketVal,
        engineSurfaceSet: enrichedCoverage,
        // `citationId` is left as-is (possibly `undefined`) — `computeCitationChanges`
        // is the single place that normalizes a missing id to an explicit `null`,
        // so we do not double-normalize here.
        citations: citationRowsOut.map((c): CitationRow => ({
            engine: c.engine,
            surface: c.surface,
            promptCohortId: c.promptCohortId,
            promptCohortVersion: c.promptCohortVersion,
            canonicalUrl: c.canonicalUrl,
            host: c.host,
            citationId: citationIdIndex.get(`${c.engine}|${c.surface}|${c.canonicalUrl}`),
        })),
        siteId: payload.siteId,
    };
    const changes = computeCitationChanges(currentInputs, priorPulse);
    const changeRows: NewWeeklyPulseCitationChangeRow[] = changes.map((ch) => ({
        pulseRunId: claim.row.id,
        priorPulseRunId: priorPulse?.priorRunId ?? null,
        change: ch.change,
        engine: ch.engine,
        surface: ch.surface,
        promptCohortId: ch.promptCohortId,
        promptCohortVersion: ch.promptCohortVersion,
        canonicalUrl: ch.canonicalUrl,
        host: ch.host,
        citationId: ch.citationId,
    }));
    // The terminal transition, immutable evidence rows, and scheduler clock
    // commit together. A crash can therefore expose either
    // the original collecting claim or the complete terminal snapshot, never a
    // completed digest with only half its citations.
    const finalized = await finalizeClaimedRun(deps, {
        runId: claim.row.id,
        accountId: payload.accountId,
        siteId: payload.siteId,
        isoWeek,
        status: terminal,
        marketSnapshotValue: siteMarketVal,
        promptCohortId: cohortId,
        promptCohortVersion: cohortVersion,
        engineSurfaceSet: coverageSnapshot.cells,
        startedAt: clock,
        counts: countsFrom(collection, brandDeltas),
        errorCode: terminal === 'completed' ? null : terminal,
        errorDetailSafe: terminal === 'completed' ? null : `weeklyPulse.errors.${terminal}`,
        citationRows: citationRowsOut,
        changeRows,
    });
    return { status: finalized.status, runId: finalized.id };
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * A prior pulse plus the id of the run it came from. `loadCompatiblePrior`
 * always populates `priorRunId`, so callers read it directly rather than
 * re-deriving it from the erased `PulseInputs` shape.
 */
interface PriorPulseWithId extends PulseInputs {
    readonly priorRunId: string;
}
async function loadCompatiblePrior(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
    isoWeek: string;
    cohortId: string;
    cohortVersion: number;
    marketSnapshotValue: unknown;
    supportedFingerprint: string;
}): Promise<PriorPulseWithId | null> {
    const rows = await db
        .select()
        .from(weeklyPulseRuns)
        .where(and(eq(weeklyPulseRuns.accountId, input.accountId), eq(weeklyPulseRuns.siteId, input.siteId)))
        .orderBy(sql `${weeklyPulseRuns.createdAt} desc`);
    for (const row of rows) {
        if (row.isoWeek === input.isoWeek)
            continue;
        if (row.status !== 'completed' && row.status !== 'partial')
            continue;
        if (row.promptCohortId !== input.cohortId)
            continue;
        if (row.promptCohortVersion !== input.cohortVersion)
            continue;
        // Compatibility check is done at the citation-changes level, but we
        // pre-filter here so the truth-table gets a candidate at most.
        // Also load the row's citations so they can be diffed against `current`.
        const citations = await db
            .select()
            .from(weeklyPulseCitations)
            .where(eq(weeklyPulseCitations.pulseRunId, row.id));
        const cells = extractCells(row.engineSurfaceSet, row.promptCohortId, row.promptCohortVersion);
        return {
            status: row.status,
            promptCohortId: row.promptCohortId,
            promptCohortVersion: row.promptCohortVersion,
            marketSnapshot: row.marketSnapshot,
            engineSurfaceSet: cells,
            citations: citations.map((c) => ({
                engine: c.engine,
                surface: c.surface,
                promptCohortId: c.promptCohortId,
                promptCohortVersion: c.promptCohortVersion,
                canonicalUrl: c.canonicalUrl,
                host: c.host,
                citationId: c.id,
            })),
            siteId: row.siteId,
            priorRunId: row.id,
        };
    }
    return null;
}
function extractCells(raw: unknown, cohortId: string, cohortVersion: number): EngineSurfaceCell[] {
    if (!Array.isArray(raw))
        return [];
    const out: EngineSurfaceCell[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object')
            continue;
        const r = item as Record<string, unknown>;
        if (typeof r.engine !== 'string' || typeof r.surface !== 'string')
            continue;
        out.push({
            engine: r.engine,
            surface: r.surface === 'citations' ? 'citations' : 'mentions',
            promptCohortId: cohortId,
            promptCohortVersion: cohortVersion,
            supported: Boolean(r.supported),
            complete: Boolean(r.complete ?? r.supported),
        });
    }
    return out;
}
function fingerprintSupported(cells: readonly EngineSurfaceCell[]): string {
    return cells
        .filter((c) => c.supported)
        .map((c) => `${c.engine}/${c.surface}`)
        .sort()
        .join('');
}
interface PersistTerminalInput {
    accountId: string;
    siteId: string;
    isoWeek: string;
    status: WeeklyPulseRunStatus;
    marketSnapshotValue: unknown;
    promptCohortId: string;
    promptCohortVersion: number;
    engineSurfaceSet: readonly {
        engine: string;
        surface: string;
        supported: boolean;
        reason: string | null;
    }[];
    startedAt: Date;
    counts: Record<string, number>;
    errorCode: string | null;
    errorDetailSafe: string | null;
}
interface ClaimCollectingInput {
    accountId: string;
    siteId: string;
    isoWeek: string;
    marketSnapshotValue: unknown;
    promptCohortId: string;
    promptCohortVersion: number;
    engineSurfaceSet: PersistTerminalInput['engineSurfaceSet'];
    startedAt: Date;
}
interface CollectingClaim {
    row: WeeklyPulseRunRow;
    claimed: boolean;
}
interface FinalizeClaimedRunInput extends PersistTerminalInput {
    runId: string;
    citationRows: NewWeeklyPulseCitationRow[];
    changeRows: NewWeeklyPulseCitationChangeRow[];
}
function observationMeta(startedAt: Date): object {
    return {
        provider: 'dataforseo',
        surface: 'llm_mentions',
        window: { end: startedAt.toISOString() },
    };
}
/**
 * The unique run claim is attempted before any provider call; a loser returns
 * the winner's row without touching the provider.
 */
async function claimCollectingRun(deps: PulseProcessorDeps, input: ClaimCollectingInput): Promise<CollectingClaim> {
    return deps.db.transaction(async (tx) => {
        const inserted = await tx
            .insert(weeklyPulseRuns)
            .values({
            accountId: input.accountId,
            siteId: input.siteId,
            isoWeek: input.isoWeek,
            status: 'collecting',
            marketSnapshot: input.marketSnapshotValue as object,
            promptCohortId: input.promptCohortId,
            promptCohortVersion: input.promptCohortVersion,
            engineSurfaceSet: input.engineSurfaceSet as unknown as object,
            observationMeta: observationMeta(input.startedAt),
            usageReference: {},
            counts: emptyCounts(),
            errorCode: null,
            errorDetailSafe: null,
            startedAt: input.startedAt,
            finishedAt: null,
            updatedAt: input.startedAt,
        })
            .onConflictDoNothing({
            target: [
                weeklyPulseRuns.accountId,
                weeklyPulseRuns.siteId,
                weeklyPulseRuns.isoWeek,
            ],
        })
            .returning();
        const row = inserted[0];
        if (!row) {
            const existing = await tx
                .select()
                .from(weeklyPulseRuns)
                .where(and(eq(weeklyPulseRuns.accountId, input.accountId), eq(weeklyPulseRuns.siteId, input.siteId), eq(weeklyPulseRuns.isoWeek, input.isoWeek)))
                .limit(1);
            if (!existing[0]) {
                throw new Error('weekly pulse claim conflict did not resolve to a run');
            }
            return { row: existing[0], claimed: false };
        }
        return { row, claimed: true };
    });
}
/** Commit a complete terminal snapshot or leave the collecting row intact. */
async function finalizeClaimedRun(deps: PulseProcessorDeps, input: FinalizeClaimedRunInput): Promise<WeeklyPulseRunRow> {
    return deps.db.transaction(async (tx) => {
        const finishedAt = new Date();
        const updated = await tx
            .update(weeklyPulseRuns)
            .set({
            status: input.status,
            marketSnapshot: input.marketSnapshotValue as object,
            promptCohortId: input.promptCohortId,
            promptCohortVersion: input.promptCohortVersion,
            engineSurfaceSet: input.engineSurfaceSet as unknown as object,
            observationMeta: observationMeta(input.startedAt),
            counts: input.counts as unknown as object,
            errorCode: input.errorCode,
            errorDetailSafe: input.errorDetailSafe,
            finishedAt,
            updatedAt: finishedAt,
        })
            .where(and(eq(weeklyPulseRuns.id, input.runId), eq(weeklyPulseRuns.status, 'collecting')))
            .returning();
        const row = updated[0];
        if (!row) {
            const existing = await tx
                .select()
                .from(weeklyPulseRuns)
                .where(eq(weeklyPulseRuns.id, input.runId))
                .limit(1);
            if (!existing[0])
                throw new Error('weekly pulse claim disappeared');
            return existing[0];
        }
        if (input.citationRows.length > 0) {
            await tx.insert(weeklyPulseCitations).values(input.citationRows);
        }
        if (input.changeRows.length > 0) {
            await tx.insert(weeklyPulseCitationChanges).values(input.changeRows);
        }
        await refreshSchedule(tx, {
            accountId: input.accountId,
            siteId: input.siteId,
            finishedAt,
            lastStatus: input.status,
        });
        return row;
    });
}
async function persistTerminal(deps: PulseProcessorDeps, input: PersistTerminalInput): Promise<WeeklyPulseRunRow> {
    const inserted = await deps.db
        .insert(weeklyPulseRuns)
        .values({
        accountId: input.accountId,
        siteId: input.siteId,
        isoWeek: input.isoWeek,
        status: input.status,
        marketSnapshot: input.marketSnapshotValue as object,
        promptCohortId: input.promptCohortId,
        promptCohortVersion: input.promptCohortVersion,
        engineSurfaceSet: input.engineSurfaceSet as unknown as object,
        observationMeta: observationMeta(input.startedAt),
        usageReference: {},
        counts: input.counts as unknown as object,
        errorCode: input.errorCode,
        errorDetailSafe: input.errorDetailSafe,
        startedAt: input.startedAt,
        finishedAt: new Date(),
    })
        .onConflictDoNothing({
        target: [
            weeklyPulseRuns.accountId,
            weeklyPulseRuns.siteId,
            weeklyPulseRuns.isoWeek,
        ],
    })
        .returning();
    const insertedRow = inserted[0];
    if (insertedRow)
        return insertedRow;
    // Another collector won the unique (account, site, week) insert. Return
    // that immutable row so every caller can resume projection/delivery from
    // the same durable run id instead of surfacing an ambiguous null id.
    const existing = await deps.db
        .select()
        .from(weeklyPulseRuns)
        .where(and(eq(weeklyPulseRuns.accountId, input.accountId), eq(weeklyPulseRuns.siteId, input.siteId), eq(weeklyPulseRuns.isoWeek, input.isoWeek)))
        .limit(1);
    return existing[0]!;
}
/**
 * Fail closed on claims whose worker disappeared after the claim committed.
 * Re-running the provider would make the remote side effect ambiguous, so
 * reconciliation records an operator-safe interrupted state. The conditional
 * update and schedule write are one transaction, making this replay-safe too.
 */
export async function recoverInterruptedWeeklyPulseRuns(db: ApplicationDb, input: {
    now?: Date;
    interruptedAfterMs?: number;
} = {}): Promise<number> {
    const now = input.now ?? new Date();
    const interruptedAfterMs = input.interruptedAfterMs ?? WEEKLY_PULSE_INTERRUPTED_AFTER_MS;
    const cutoff = new Date(now.getTime() - interruptedAfterMs);
    const candidates = await db
        .select({
        id: weeklyPulseRuns.id,
        accountId: weeklyPulseRuns.accountId,
        siteId: weeklyPulseRuns.siteId,
    })
        .from(weeklyPulseRuns)
        .where(and(eq(weeklyPulseRuns.status, 'collecting'), lte(weeklyPulseRuns.createdAt, cutoff)))
        .limit(WEEKLY_PULSE_RECOVERY_BATCH_SIZE);
    let recovered = 0;
    for (const candidate of candidates) {
        const didRecover = await db.transaction(async (tx) => {
            const rows = await tx
                .update(weeklyPulseRuns)
                .set({
                status: 'failed',
                errorCode: 'interrupted',
                errorDetailSafe: 'weeklyPulse.errors.interrupted',
                finishedAt: now,
                updatedAt: now,
            })
                .where(and(eq(weeklyPulseRuns.id, candidate.id), eq(weeklyPulseRuns.status, 'collecting'), lte(weeklyPulseRuns.createdAt, cutoff)))
                .returning({ id: weeklyPulseRuns.id });
            if (rows.length === 0)
                return false;
            await refreshSchedule(tx, {
                accountId: candidate.accountId,
                siteId: candidate.siteId,
                finishedAt: now,
                lastStatus: 'failed',
            });
            return true;
        });
        if (didRecover)
            recovered += 1;
    }
    return recovered;
}
function emptyCounts(): Record<string, number> {
    return {
        citations_now: 0,
        citations_new: 0,
        citations_lost: 0,
        citations_unknown_partial: 0,
        confirmed_rank_drops: 0,
        actions_completed: 0,
        actions_regressed: 0,
        next_actions_total: 0,
        audience_decisions_accepted: 0,
        brand_delta_queries: 0,
        brand_delta_new_scans: 0,
    };
}
function countsFrom(result: CollectionResult, brandDeltas: readonly BrandDeltaEntry[]): Record<string, number> {
    const citations = result.cells.reduce((sum, c) => sum + c.citations.length, 0);
    const completed = result.actionTransitions.filter((a) => a.state === 'completed').length;
    const regressed = result.actionTransitions.filter((a) => a.state === 'regressed').length;
    return {
        citations_now: citations,
        citations_new: 0,
        citations_lost: 0,
        citations_unknown_partial: 0,
        confirmed_rank_drops: result.confirmedRankDrops.length,
        actions_completed: completed,
        actions_regressed: regressed,
        next_actions_total: result.topOpenActions.length,
        audience_decisions_accepted: result.audienceDecisions.length,
        brand_delta_queries: brandDeltas.length,
        brand_delta_new_scans: brandDeltas.filter((d) => d.hasNewScan).length,
    };
}
async function refreshSchedule(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
    finishedAt: Date;
    lastStatus: WeeklyPulseRunStatus;
}): Promise<void> {
    const schedule = computeSchedule(input.siteId);
    const next = nextRunAt(schedule, input.finishedAt);
    await db
        .update(sitePulseSettings)
        .set({
        lastRunAt: input.finishedAt,
        lastStatus: input.lastStatus,
        nextRunAt: next,
        updatedAt: input.finishedAt,
    })
        .where(and(eq(sitePulseSettings.accountId, input.accountId), eq(sitePulseSettings.siteId, input.siteId)));
}
export const weeklyPulseProcessorTestables = {
    claimCollectingRun,
    finalizeClaimedRun,
    persistTerminal,
};
