import { useEffect, useRef } from 'react';

const PORTAL_LAYER = '[data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"]';
const OPEN_PORTAL =
  '[data-radix-popper-content-wrapper] :is([role="dialog"], [role="menu"], [role="listbox"])';
export type OverlayDismissReason = 'escape' | 'outside';

/** Close overlays without stealing interaction from their portalled menus/dialogs. */
export function useOverlayDismiss(
  active: boolean,
  getContainer: () => HTMLElement | null,
  onDismiss: (reason: OverlayDismissReason) => void,
  getAdditionalContainers?: () => readonly (HTMLElement | null)[],
): void {
  const latest = useRef({ getContainer, onDismiss, getAdditionalContainers });
  latest.current = { getContainer, onDismiss, getAdditionalContainers };
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector(OPEN_PORTAL))
        return;
      latest.current.onDismiss('escape');
    };
    const pointerdown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (latest.current.getContainer()?.contains(target) || target.closest(PORTAL_LAYER)) return;
      if (latest.current.getAdditionalContainers?.().some((node) => node?.contains(target))) return;
      latest.current.onDismiss('outside');
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', pointerdown, true);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('pointerdown', pointerdown, true);
    };
  }, [active]);
}

export function returnFocusTo(getTarget: () => HTMLElement | null | undefined): void {
  window.requestAnimationFrame(() => getTarget()?.focus());
}
