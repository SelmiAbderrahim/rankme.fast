/**
 * Content Intelligence state-machine helper.
 *
 * The workflow is monotonic: stages advance in one direction only, and
 * a run in a terminal state (`completed`, `partial`, `failed`, `cancelled`)
 * cannot re-enter the pipeline. Downstream prompts (05 pipeline, 06 UI, 09
 * competitor pipeline, 11 superadmin) MUST call `assertContentAnalysisTransition`
 * before mutating a `ContentAnalysis.status` field so a regression cannot
 * skip stages, move backward, or re-open a terminal run.
 */
import type { ContentAnalysisStatus } from './content-analysis.model.js';
import { CONTENT_ANALYSIS_STATUSES, CONTENT_ANALYSIS_TERMINAL_STATUSES, } from './content-analysis.model.js';
/**
 * Ordered progression of the non-terminal stages. Each stage MUST be entered
 * in this exact order (or short-circuit directly to a terminal state).
 */
export const CONTENT_ANALYSIS_STAGE_ORDER = [
    'queued',
    'collecting_owned',
    'collecting_serp',
    'collecting_competitors',
    'scoring',
    'generating_brief',
    'generating_draft',
] as const satisfies readonly ContentAnalysisStatus[];
const STAGE_INDEX = new Map<ContentAnalysisStatus, number>(CONTENT_ANALYSIS_STAGE_ORDER.map((s, i) => [s, i]));
/** True when a status is one of the four terminal statuses. */
export function isTerminalStatus(status: ContentAnalysisStatus): boolean {
    return (CONTENT_ANALYSIS_TERMINAL_STATUSES as readonly string[]).includes(status);
}
export class ContentAnalysisTransitionError extends Error {
    readonly from: ContentAnalysisStatus;
    readonly to: ContentAnalysisStatus;
    constructor(from: ContentAnalysisStatus, to: ContentAnalysisStatus, message: string) {
        super(message);
        this.name = 'ContentAnalysisTransitionError';
        this.from = from;
        this.to = to;
    }
}
/**
 * Validate the requested transition. Rules:
 *   1. Both status values must be known.
 *   2. A terminal status can never be left (`completed → *`, `failed → *`,
 *      `cancelled → *`, `partial → *` all forbidden).
 *   3. Transitioning to a terminal status is ALWAYS allowed from any
 *      non-terminal status (any stage can fail / cancel / complete).
 *   4. Otherwise the target must be strictly LATER in
 *      `CONTENT_ANALYSIS_STAGE_ORDER` than the source (no back-stepping,
 *      no re-entering the current stage).
 */
export function assertContentAnalysisTransition(from: ContentAnalysisStatus, to: ContentAnalysisStatus): void {
    if (!(CONTENT_ANALYSIS_STATUSES as readonly string[]).includes(from)) {
        throw new ContentAnalysisTransitionError(from, to, `unknown source status: ${from}`);
    }
    if (!(CONTENT_ANALYSIS_STATUSES as readonly string[]).includes(to)) {
        throw new ContentAnalysisTransitionError(from, to, `unknown target status: ${to}`);
    }
    if (isTerminalStatus(from)) {
        throw new ContentAnalysisTransitionError(from, to, `content analysis in terminal state ${from} cannot transition`);
    }
    if (isTerminalStatus(to))
        return;
    // Both values were validated against CONTENT_ANALYSIS_STATUSES above and
    // terminal targets already returned, so these indexes are guaranteed.
    const fromIdx = STAGE_INDEX.get(from)!;
    const toIdx = STAGE_INDEX.get(to)!;
    if (toIdx <= fromIdx) {
        throw new ContentAnalysisTransitionError(from, to, `content analysis stage cannot move ${from} → ${to} (stages advance only)`);
    }
}
/** Convenience — returns true instead of throwing. */
export function canTransition(from: ContentAnalysisStatus, to: ContentAnalysisStatus): boolean {
    try {
        assertContentAnalysisTransition(from, to);
        return true;
    }
    catch {
        return false;
    }
}
