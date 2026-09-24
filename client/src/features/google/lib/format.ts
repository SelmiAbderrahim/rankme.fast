/**
 * Locale-aware number/date formatters shared by the Google search summary
 * card and the drill-in detail panel. All values render `tabular-nums` and
 * `dir="ltr"` at the call sites so RTL locales keep numerics pinned.
 */

export const formatInt = (locale: string, n: number): string =>
  new Intl.NumberFormat(locale).format(n);

export const formatPercent = (locale: string, n: number): string =>
  new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(n);

export const formatPosition = (locale: string, n: number): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);

export const formatDate = (locale: string, iso: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

const DEVICE_KEYS = ['desktop', 'mobile', 'tablet'];

/** Map a raw GSC device code to its locale key, falling back to `unknown`. */
export const deviceLabelKey = (device: string): string => {
  const key = device.toLowerCase();
  return DEVICE_KEYS.includes(key) ? key : 'unknown';
};
