/** Resource measurements use decimal byte units and localized short timings. */
export function formatBytes(bytes: number, locale: string): string {
  const [value, unit, digits] = bytes >= 1_000_000 ? [bytes / 1_000_000, 'megabyte', 1] : bytes >= 1_000 ? [bytes / 1_000, 'kilobyte', 0] : [bytes, 'byte', 0];
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: digits }).format(value);
}

export function formatDuration(ms: number, locale: string): string {
  const seconds = ms >= 1_000;
  return new Intl.NumberFormat(locale, { style: 'unit', unit: seconds ? 'second' : 'millisecond', unitDisplay: 'short', maximumFractionDigits: seconds ? 1 : 0 }).format(seconds ? ms / 1_000 : ms);
}
