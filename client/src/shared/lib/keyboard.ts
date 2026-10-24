/** Single-key navigation shortcuts must not interrupt text input. */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};

/** A bare key press, including Shift for keyboard-layout punctuation. */
export const isPlainKey = (event: KeyboardEvent): boolean =>
  !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing;
