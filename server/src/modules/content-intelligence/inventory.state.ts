/**
 * Content inventory state-machine helper.
 *
 * The workflow is monotonic: `queued → crawling → analyzing → completed`
 * (or short-circuit to a terminal state from any stage). A run in a terminal
 * state (`completed`, `partial`, `failed`, `cancelled`) can never re-enter the
 * pipeline. Every `ContentInventoryRun.status` mutation MUST go through
 * `assertContentInventoryTransition` so a regression cannot skip stages, move
 * backward, or re-open a terminal run.
 */
import type { ContentInventoryStatus } from './inventory.model.js';
import { CONTENT_INVENTORY_STATUSES, CONTENT_INVENTORY_TERMINAL_STATUSES, } from './inventory.model.js';
/** Ordered progression of the non-terminal stages. */
export const CONTENT_INVENTORY_STAGE_ORDER = [
    'queued',
    'crawling',
    'analyzing',
] as const satisfies readonly ContentInventoryStatus[];
const STAGE_INDEX = new Map<ContentInventoryStatus, number>(CONTENT_INVENTORY_STAGE_ORDER.map((s, i) => [s, i]));
/** True when a status is one of the four terminal statuses. */
export function isInventoryTerminalStatus(status: ContentInventoryStatus): boolean {
    return (CONTENT_INVENTORY_TERMINAL_STATUSES as readonly string[]).includes(status);
}
/** True when the run is in a state that ACCEPTS a user cancel. */
export function isContentInventoryCancellable(status: ContentInventoryStatus): boolean {
    return !isInventoryTerminalStatus(status);
}
export class ContentInventoryTransitionError extends Error {
    readonly from: ContentInventoryStatus;
    readonly to: ContentInventoryStatus;
    constructor(from: ContentInventoryStatus, to: ContentInventoryStatus, message: string) {
        super(message);
        this.name = 'ContentInventoryTransitionError';
        this.from = from;
        this.to = to;
    }
}
/**
 * Validate the requested transition. Rules mirror the content-analysis state
 * machine:
 *   1. Both status values must be known.
 *   2. A terminal status can never be left.
 *   3. Transitioning to a terminal status is always allowed from any
 *      non-terminal status.
 *   4. Otherwise the target must be strictly LATER in the stage order.
 */
export function assertContentInventoryTransition(from: ContentInventoryStatus, to: ContentInventoryStatus): void {
    if (!(CONTENT_INVENTORY_STATUSES as readonly string[]).includes(from)) {
        throw new ContentInventoryTransitionError(from, to, `unknown source status: ${from}`);
    }
    if (!(CONTENT_INVENTORY_STATUSES as readonly string[]).includes(to)) {
        throw new ContentInventoryTransitionError(from, to, `unknown target status: ${to}`);
    }
    if (isInventoryTerminalStatus(from)) {
        throw new ContentInventoryTransitionError(from, to, `content inventory in terminal state ${from} cannot transition`);
    }
    if (isInventoryTerminalStatus(to))
        return;
    const fromIdx = STAGE_INDEX.get(from)!;
    const toIdx = STAGE_INDEX.get(to)!;
    if (toIdx <= fromIdx) {
        throw new ContentInventoryTransitionError(from, to, `content inventory stage cannot move ${from} → ${to} (stages advance only)`);
    }
}
/** Convenience — returns true instead of throwing. */
export function canInventoryTransition(from: ContentInventoryStatus, to: ContentInventoryStatus): boolean {
    try {
        assertContentInventoryTransition(from, to);
        return true;
    }
    catch {
        return false;
    }
}
