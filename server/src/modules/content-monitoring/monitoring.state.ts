/**
 * Public-page change monitoring — status machine.
 *
 * A monitor is a long-lived resource (not a one-shot run), so the machine is a
 * small cyclic graph rather than a monotonic pipeline:
 *
 *   active ⇄ paused        (user pause / resume)
 *   any → error            (provider failure surfaced by reconciliation)
 *   error → active | paused   (recovery)
 *
 * Every pair of statuses is connected, and deleting a monitor removes the
 * document, so there is no terminal state. Every `ContentMonitor.status`
 * mutation MUST still go through `assertContentMonitorTransition` so a
 * regression cannot land an undefined status.
 */
import { CONTENT_MONITOR_STATUSES, type ContentMonitorStatus, } from './monitor.model.js';
export class ContentMonitorTransitionError extends Error {
    readonly from: ContentMonitorStatus;
    readonly to: ContentMonitorStatus;
    constructor(from: ContentMonitorStatus, to: ContentMonitorStatus, message: string) {
        super(message);
        this.name = 'ContentMonitorTransitionError';
        this.from = from;
        this.to = to;
    }
}
function isKnownStatus(status: ContentMonitorStatus): boolean {
    return (CONTENT_MONITOR_STATUSES as readonly string[]).includes(status);
}
/**
 * Validate the requested transition. Any edge between two known statuses —
 * including a same-status re-apply — is legal; an unknown source/target throws.
 */
export function assertContentMonitorTransition(from: ContentMonitorStatus, to: ContentMonitorStatus): void {
    if (!isKnownStatus(from)) {
        throw new ContentMonitorTransitionError(from, to, `unknown source status: ${from}`);
    }
    if (!isKnownStatus(to)) {
        throw new ContentMonitorTransitionError(from, to, `unknown target status: ${to}`);
    }
}
/** Convenience — returns true instead of throwing. */
export function canContentMonitorTransition(from: ContentMonitorStatus, to: ContentMonitorStatus): boolean {
    try {
        assertContentMonitorTransition(from, to);
        return true;
    }
    catch {
        return false;
    }
}
