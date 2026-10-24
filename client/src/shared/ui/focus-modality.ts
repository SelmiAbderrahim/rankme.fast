import { useSyncExternalStore } from 'react';

let pointer = false;
const listeners = new Set<() => void>();
function update(next: boolean) {
  if (pointer === next) return;
  pointer = next;
  listeners.forEach((notify) => notify());
}
function onPointer(event: PointerEvent) {
  if (event.pointerType) update(true);
}
function onKey() {
  update(false);
}
function subscribe(notify: () => void) {
  if (!listeners.size) {
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
  }
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
    if (!listeners.size) {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      pointer = false;
    }
  };
}
/** Synthetic assistive clicks do not switch keyboard focus into pointer mode. */
export function usePointerFocus() {
  return useSyncExternalStore(
    subscribe,
    () => pointer,
    () => false,
  );
}
