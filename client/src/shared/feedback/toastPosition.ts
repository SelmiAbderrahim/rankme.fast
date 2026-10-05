import type { TextDirection } from '@shared/i18n/useDirection';

/**
 * Toasts stack in the bottom inline-end corner. The top-right corner is the
 * app topbar's control cluster (theme toggle, notifications, account menu) and
 * the beta banner's dismiss button, so a toast there covers controls the
 * person may need while it is on screen. Sonner has no logical positions, so
 * the physical corner follows the text direction.
 */
export const toastPositionFor = (dir: TextDirection) =>
  dir === 'rtl' ? ('bottom-left' as const) : ('bottom-right' as const);
