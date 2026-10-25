/**
 * Radix `ScrollArea.Viewport` wraps its children in an inline
 * `display: table; min-width: 100%` element. A table grows to its content's
 * min-content width, so `truncate`, percentage max-widths, and nested
 * `overflow-x-auto` wrappers never get a bounded width and the viewport clips
 * the overflow instead. Forcing that wrapper back to `display: block` bounds
 * the Assistant's message log and conversation list to the panel width.
 */
export const BOUNDED_SCROLL_AREA_CLASS = '[&_[data-slot=scroll-area-viewport]>div]:block!';
