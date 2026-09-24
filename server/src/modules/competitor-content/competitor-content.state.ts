/**
 * Competitor content intelligence state-machine helper.
 *
 * The workflow is monotonic: `queued → collecting → comparing → completed`
 * (or short-circuit to a terminal state from any stage). A run in a terminal
 * state (`completed`, `partial`, `failed`, `cancelled`) can never re-enter the
 * pipeline. Every `CompetitorContentRun.status` mutation MUST go through
 * `assertCompetitorContentTransition` so a regression cannot skip stages, move
 * backward, or re-open a terminal run.
 */
import type { CompetitorContentStatus } from './competitor-content.model.js';
import { COMPETITOR_CONTENT_STATUSES, COMPETITOR_CONTENT_TERMINAL_STATUSES, } from './competitor-content.model.js';
/** Ordered progression of the non-terminal stages. */
export const COMPETITOR_CONTENT_STAGE_ORDER = [
    'queued',
    'collecting',
    'comparing',
] as const satisfies readonly CompetitorContentStatus[];
const STAGE_INDEX = new Map<CompetitorContentStatus, number>(COMPETITOR_CONTENT_STAGE_ORDER.map((s, i) => [s, i]));
/** True when a status is one of the four terminal statuses. */
export function isCompetitorContentTerminalStatus(status: CompetitorContentStatus): boolean {
    return (COMPETITOR_CONTENT_TERMINAL_STATUSES as readonly string[]).includes(status);
}
/** True when the run is in a state that ACCEPTS a user cancel. */
export function isCompetitorContentCancellable(status: CompetitorContentStatus): boolean {
    return !isCompetitorContentTerminalStatus(status);
}
export class CompetitorContentTransitionError extends Error {
    readonly from: CompetitorContentStatus;
    readonly to: CompetitorContentStatus;
    constructor(from: CompetitorContentStatus, to: CompetitorContentStatus, message: string) {
        super(message);
        this.name = 'CompetitorContentTransitionError';
        this.from = from;
        this.to = to;
    }
}
/**
 * Validate the requested transition. Rules mirror the content-inventory state
 * machine:
 *   1. Both status values must be known.
 *   2. A terminal status can never be left.
 *   3. Transitioning to a terminal status is always allowed from any
 *      non-terminal status.
 *   4. Otherwise the target must be strictly LATER in the stage order.
 */
export function assertCompetitorContentTransition(from: CompetitorContentStatus, to: CompetitorContentStatus): void {
    if (!(COMPETITOR_CONTENT_STATUSES as readonly string[]).includes(from)) {
        throw new CompetitorContentTransitionError(from, to, `unknown source status: ${from}`);
    }
    if (!(COMPETITOR_CONTENT_STATUSES as readonly string[]).includes(to)) {
        throw new CompetitorContentTransitionError(from, to, `unknown target status: ${to}`);
    }
    if (isCompetitorContentTerminalStatus(from)) {
        throw new CompetitorContentTransitionError(from, to, `competitor content run in terminal state ${from} cannot transition`);
    }
    if (isCompetitorContentTerminalStatus(to))
        return;
    const fromIdx = STAGE_INDEX.get(from)!;
    const toIdx = STAGE_INDEX.get(to)!;
    if (toIdx <= fromIdx) {
        throw new CompetitorContentTransitionError(from, to, `competitor content stage cannot move ${from} → ${to} (stages advance only)`);
    }
}
/** Convenience — returns true instead of throwing. */
export function canCompetitorContentTransition(from: CompetitorContentStatus, to: CompetitorContentStatus): boolean {
    try {
        assertCompetitorContentTransition(from, to);
        return true;
    }
    catch {
        return false;
    }
}
