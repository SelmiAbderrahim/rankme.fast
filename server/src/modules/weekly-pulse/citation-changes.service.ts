/**
 * Weekly Pulse — citation-changes truth table.
 *
 * Given a `current` pulse (its status + engine_surface_set + citations) and a
 * candidate `prior` pulse, decide:
 *
 *   • compatible? → same site + same market_snapshot (deep equal) + same
 *                    prompt cohort id/version + same set of supported cells
 *                    + BOTH statuses in {completed, partial}.
 *
 *   • per (engine, surface, cohort_id, cohort_version, canonical_url):
 *       - present now,  absent prior, COMPLETE cell → 'new'
 *       - absent  now,  present prior, COMPLETE prior + current cell   → 'lost'
 *       - otherwise                                                     → 'unknown_partial'
 *
 * "Complete-enough" per cell: the cell's provider echo had NO
 * truncation / rate-partial flag AND (returned rows > 0 OR provider said
 * "empty complete"). Absence in a `partial` or `unsupported` cell CANNOT
 * produce a `lost`.
 *
 * This module is PURE — no IO, no clock, no vendor calls. The processor
 * fetches the persisted rows and pipes them in.
 */
import type { WeeklyPulseChangeKind, WeeklyPulseCitationSurface, WeeklyPulseRunStatus, } from '../../db/schema/weekly-pulse.js';
export interface CellKey {
    readonly engine: string;
    readonly surface: WeeklyPulseCitationSurface;
    readonly promptCohortId: string;
    readonly promptCohortVersion: number;
}
export interface EngineSurfaceCell extends CellKey {
    readonly supported: boolean;
    /** True when the cell's provider echo carried NO truncation / rate-partial
     * flag AND the returned row count is >0 OR provider said empty-complete. */
    readonly complete: boolean;
}
export interface CitationRow extends CellKey {
    readonly canonicalUrl: string;
    readonly host: string;
    /** Reference into `weekly_pulse_citations.id` — passed through when we
     * produce a `new` change row so it can be persisted. Not used for `lost`
     * or `unknown_partial`. */
    readonly citationId?: string | null;
}
export interface PulseInputs {
    readonly status: WeeklyPulseRunStatus;
    readonly promptCohortId: string;
    readonly promptCohortVersion: number;
    readonly marketSnapshot: unknown;
    readonly engineSurfaceSet: readonly EngineSurfaceCell[];
    readonly citations: readonly CitationRow[];
    readonly siteId: string;
}
export interface CitationChangeOut {
    readonly change: WeeklyPulseChangeKind;
    readonly engine: string;
    readonly surface: WeeklyPulseCitationSurface;
    readonly promptCohortId: string;
    readonly promptCohortVersion: number;
    readonly canonicalUrl: string;
    readonly host: string;
    readonly citationId: string | null;
}
/**
 * Stable ordered string used to test compatibility of the engine_surface_set.
 * A cell whose `supported=false` is included by (engine, surface) so
 * incompatibility from a dropped engine still surfaces. Order-independent.
 */
export function serializeSupportedCells(cells: readonly EngineSurfaceCell[]): string {
    return cells
        .filter((c) => c.supported)
        .map((c) => `${c.engine}/${c.surface}`)
        .sort()
        .join('');
}
const COMPARABLE_STATUSES: readonly WeeklyPulseRunStatus[] = ['completed', 'partial'] as const;
/**
 * Deterministic deep-equal for JSON-serializable market snapshots. Recurses
 * plain objects + arrays; scalars use `Object.is`. Deliberately narrow —
 * states `market_snapshot` is JSON via jsonb, so this is safe.
 */
export function marketSnapshotEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b))
        return true;
    if (a === null || b === null)
        return false;
    if (typeof a !== typeof b)
        return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i += 1) {
            if (!marketSnapshotEqual(a[i], b[i]))
                return false;
        }
        return true;
    }
    if (Array.isArray(a) || Array.isArray(b))
        return false;
    if (typeof a === 'object' && typeof b === 'object') {
        const ao = a as Record<string, unknown>;
        const bo = b as Record<string, unknown>;
        const aKeys = Object.keys(ao).sort();
        const bKeys = Object.keys(bo).sort();
        if (aKeys.length !== bKeys.length)
            return false;
        for (let i = 0; i < aKeys.length; i += 1) {
            if (aKeys[i] !== bKeys[i])
                return false;
        }
        for (const k of aKeys) {
            if (!marketSnapshotEqual(ao[k], bo[k]))
                return false;
        }
        return true;
    }
    return false;
}
/**
 * Determines whether `prior` is a compatible comparison partner for
 * `current`. Both must share the site/market/cohort tuple, both must be in
 * a completed/partial state, and the supported-cell fingerprints must match.
 */
export function isCompatiblePriorPulse(current: PulseInputs, prior: PulseInputs): boolean {
    if (current.siteId !== prior.siteId)
        return false;
    if (current.promptCohortId !== prior.promptCohortId)
        return false;
    if (current.promptCohortVersion !== prior.promptCohortVersion)
        return false;
    if (!COMPARABLE_STATUSES.includes(current.status))
        return false;
    if (!COMPARABLE_STATUSES.includes(prior.status))
        return false;
    if (!marketSnapshotEqual(current.marketSnapshot, prior.marketSnapshot))
        return false;
    if (serializeSupportedCells(current.engineSurfaceSet) !==
        serializeSupportedCells(prior.engineSurfaceSet)) {
        return false;
    }
    return true;
}
function cellFingerprint(k: CellKey): string {
    return [k.engine, k.surface, k.promptCohortId, String(k.promptCohortVersion)].join('|');
}
function citationFingerprint(row: CitationRow): string {
    return `${cellFingerprint(row)}|${row.canonicalUrl}`;
}
/**
 * Truth-table implementation. Callers pass the current pulse's
 * inputs and, when a compatible prior exists, the prior's inputs. When no
 * compatible prior exists, `computeCitationChanges` returns a set of
 * `unknown_partial` rows for every current citation — the digest surfaces
 * "unknown" instead of falsely claiming "new" against a null baseline.
 */
export function computeCitationChanges(current: PulseInputs, prior: PulseInputs | null): CitationChangeOut[] {
    // Build lookup of cell → complete-flag once so per-URL checks stay O(1).
    const currentCellComplete = new Map<string, boolean>();
    for (const cell of current.engineSurfaceSet) {
        if (cell.supported) {
            currentCellComplete.set(cellFingerprint(cell), cell.complete);
        }
    }
    // No compatible prior → every current citation is `unknown_partial`
    // (last paragraph: partial/unsupported cells cannot produce lost).
    if (prior === null || !isCompatiblePriorPulse(current, prior)) {
        const out: CitationChangeOut[] = [];
        for (const row of current.citations) {
            out.push({
                change: 'unknown_partial',
                engine: row.engine,
                surface: row.surface,
                promptCohortId: row.promptCohortId,
                promptCohortVersion: row.promptCohortVersion,
                canonicalUrl: row.canonicalUrl,
                host: row.host,
                citationId: row.citationId ?? null,
            });
        }
        return out;
    }
    const priorCellComplete = new Map<string, boolean>();
    for (const cell of prior.engineSurfaceSet) {
        if (cell.supported) {
            priorCellComplete.set(cellFingerprint(cell), cell.complete);
        }
    }
    const currentIdx = new Map<string, CitationRow>();
    for (const row of current.citations)
        currentIdx.set(citationFingerprint(row), row);
    const priorIdx = new Map<string, CitationRow>();
    for (const row of prior.citations)
        priorIdx.set(citationFingerprint(row), row);
    const out: CitationChangeOut[] = [];
    // Pass 1: everything present now.
    for (const [fp, row] of currentIdx) {
        const cellFp = cellFingerprint(row);
        const nowComplete = currentCellComplete.get(cellFp) === true;
        const priorHad = priorIdx.has(fp);
        if (priorHad) {
            // Present both times: not a change; skip.
            continue;
        }
        // Absent from prior: new IFF current cell is complete-enough.
        const change: WeeklyPulseChangeKind = nowComplete ? 'new' : 'unknown_partial';
        out.push({
            change,
            engine: row.engine,
            surface: row.surface,
            promptCohortId: row.promptCohortId,
            promptCohortVersion: row.promptCohortVersion,
            canonicalUrl: row.canonicalUrl,
            host: row.host,
            citationId: row.citationId ?? null,
        });
    }
    // Pass 2: present prior, absent now.
    for (const [fp, row] of priorIdx) {
        if (currentIdx.has(fp))
            continue;
        const cellFp = cellFingerprint(row);
        const priorComplete = priorCellComplete.get(cellFp) === true;
        const nowComplete = currentCellComplete.get(cellFp) === true;
        // "Lost" requires BOTH the prior cell AND the current cell to be
        // complete-enough. Partial/unsupported current cells cannot claim lost.
        const change: WeeklyPulseChangeKind = priorComplete && nowComplete ? 'lost' : 'unknown_partial';
        out.push({
            change,
            engine: row.engine,
            surface: row.surface,
            promptCohortId: row.promptCohortId,
            promptCohortVersion: row.promptCohortVersion,
            canonicalUrl: row.canonicalUrl,
            host: row.host,
            // `lost` never carries a citation_id into the current run — the row
            // lives on the prior pulse only. Preserve for `unknown_partial` so
            // the digest can link back to whichever run has the fresher record.
            citationId: change === 'lost' ? null : row.citationId ?? null,
        });
    }
    return out;
}
