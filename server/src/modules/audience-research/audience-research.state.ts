/**
 * Audience Research state-machine helper.
 *
 * Locked machine:
 *   queued -> discovering -> selecting -> collecting -> clustering
 *     -> completed | partial | failed
 *
 * Rules:
 *   1. Terminal states (completed, partial, failed) are immutable — no exit.
 *   2. Any non-terminal state may short-circuit to any terminal state.
 *   3. Non-terminal → non-terminal advances strictly along the stage order.
 *   4. Same-stage re-entry is allowed so a re-delivered BullMQ job may
 *      idempotently resume the current stage without moving state.
 */
export const AUDIENCE_RESEARCH_STATES = [
    'queued',
    'discovering',
    'selecting',
    'collecting',
    'clustering',
    'completed',
    'partial',
    'failed',
] as const;
export type AudienceResearchState = (typeof AUDIENCE_RESEARCH_STATES)[number];
export const TERMINAL_STATES = [
    'completed',
    'partial',
    'failed',
] as const satisfies readonly AudienceResearchState[];
const STAGE_ORDER = [
    'queued',
    'discovering',
    'selecting',
    'collecting',
    'clustering',
] as const satisfies readonly AudienceResearchState[];
const STAGE_INDEX = new Map<AudienceResearchState, number>(STAGE_ORDER.map((s, i) => [s, i]));
export function isTerminal(state: AudienceResearchState): boolean {
    return (TERMINAL_STATES as readonly string[]).includes(state);
}
export class AudienceResearchTransitionError extends Error {
    readonly from: AudienceResearchState;
    readonly to: AudienceResearchState;
    constructor(from: AudienceResearchState, to: AudienceResearchState, message: string) {
        super(message);
        this.name = 'AudienceResearchTransitionError';
        this.from = from;
        this.to = to;
    }
}
export function assertTransition(from: AudienceResearchState, to: AudienceResearchState): void {
    if (!(AUDIENCE_RESEARCH_STATES as readonly string[]).includes(from)) {
        throw new AudienceResearchTransitionError(from, to, `unknown source state: ${from}`);
    }
    if (!(AUDIENCE_RESEARCH_STATES as readonly string[]).includes(to)) {
        throw new AudienceResearchTransitionError(from, to, `unknown target state: ${to}`);
    }
    if (isTerminal(from)) {
        throw new AudienceResearchTransitionError(from, to, `audience research in terminal state ${from} cannot transition`);
    }
    if (isTerminal(to))
        return;
    if (from === to)
        return;
    // Both values are validated against AUDIENCE_RESEARCH_STATES above and
    // terminal targets already returned; every remaining state is in STAGE_INDEX.
    const fromIdx = STAGE_INDEX.get(from)!;
    const toIdx = STAGE_INDEX.get(to)!;
    if (toIdx < fromIdx) {
        throw new AudienceResearchTransitionError(from, to, `audience research stage cannot move ${from} -> ${to} (stages advance only)`);
    }
}
export function canTransition(from: AudienceResearchState, to: AudienceResearchState): boolean {
    try {
        assertTransition(from, to);
        return true;
    }
    catch {
        return false;
    }
}
