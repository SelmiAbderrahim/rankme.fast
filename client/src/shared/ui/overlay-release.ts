import { useCallback, useRef, type RefCallback } from 'react';

const OPEN_LAYER =
  '[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"],[role="listbox"][data-state="open"],[role="menu"][data-state="open"]';
/** Release immediately on close, without unlocking another active modal. */
export function releaseBodyPointerLock(doc: Document = document): void {
  if (doc.querySelector(OPEN_LAYER)) return;
  if (doc.body.style.pointerEvents === 'none') doc.body.style.pointerEvents = '';
}
let pointerPresses = 0;
let pointerPressesAtClose = 0;
const trackedDocuments = new WeakSet<Document>();
function trackPointer(doc: Document) {
  if (trackedDocuments.has(doc)) return;
  trackedDocuments.add(doc);
  doc.addEventListener(
    'pointerdown',
    () => {
      pointerPresses += 1;
    },
    true,
  );
}
/** Exit animations must not leave the underlying page unresponsive. */
export function useReleaseBodyPointerLockOnClose(): RefCallback<HTMLElement> {
  const observer = useRef<MutationObserver | null>(null);
  return useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    trackPointer(node.ownerDocument);
    const release = () => {
      if (node.getAttribute('data-state') !== 'closed') return;
      pointerPressesAtClose = pointerPresses;
      releaseBodyPointerLock(node.ownerDocument);
    };
    release();
    observer.current = new MutationObserver(release);
    observer.current.observe(node, { attributes: true, attributeFilter: ['data-state'] });
  }, []);
}
export const CLOSING_LAYER_PASS_THROUGH = 'data-[state=closed]:pointer-events-none!';
/** Preserve deliberate pointer focus moves during a closing layer's animation. */
export function preserveMovedFocus<E extends Event>(
  handler?: (event: E) => void,
): (event: E) => void {
  return (event) => {
    handler?.(event);
    if (event.defaultPrevented) return;
    const active = document.activeElement;
    if (
      pointerPresses > pointerPressesAtClose &&
      active instanceof HTMLElement &&
      active !== document.body
    )
      event.preventDefault();
  };
}
