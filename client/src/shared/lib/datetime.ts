/**
 * Locale-aware relative time ("3 days ago", "in 2 hours") shared by the
 * keywords table and the site pause banner. `Intl.RelativeTimeFormat` with
 * `numeric: 'auto'` yields natural phrases ("yesterday") in all 7 locales.
 */
export function formatRelativeTime(
  iso: string,
  locale: string,
  now: number = Date.now(),
): string {
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return fmt.format(seconds, 'second');
  if (abs < 3600) return fmt.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return fmt.format(Math.round(seconds / 3600), 'hour');
  return fmt.format(Math.round(seconds / 86_400), 'day');
}
