export const POSITION_UNCHANGED_EPSILON = 0.05;
export type PositionDirection = 'improved' | 'declined' | 'unchanged';
export type PositionComparison = 'previous_sync' | 'previous_check';
export interface PositionChangeWindow {
    range: string | null;
    comparison: PositionComparison;
}
export interface PositionChange {
    currentPosition: number | null;
    previousPosition: number | null;
    /** Current minus previous: negative means movement closer to the top result. */
    positionDelta: number | null;
    direction: PositionDirection | null;
    window: PositionChangeWindow;
}

/** Compare observed positions, suppressing direction labels for average-position noise. */
export function describePositionChange(currentPosition: number | null, previousPosition: number | null, window: PositionChangeWindow): PositionChange {
    if (currentPosition === null || previousPosition === null)
        return { currentPosition, previousPosition, positionDelta: null, direction: null, window };
    const positionDelta = currentPosition - previousPosition;
    const direction: PositionDirection = Math.abs(positionDelta) < POSITION_UNCHANGED_EPSILON
        ? 'unchanged'
        : positionDelta < 0 ? 'improved' : 'declined';
    return { currentPosition, previousPosition, positionDelta, direction, window };
}
