import type { PageMetrics, PagesRange } from './types';

export type PagesMetricKey = Exclude<keyof PageMetrics, 'associatedQueryCount'>;

export function formatPagesNumber(
  locale: string,
  value: number,
  options?: Intl.NumberFormatOptions,
): string;
export function formatPagesNumber(
  locale: string,
  value: number | null,
  options?: Intl.NumberFormatOptions,
): string | null;
export function formatPagesNumber(
  locale: string,
  value: number | null,
  options: Intl.NumberFormatOptions = {},
): string | null {
  if (value === null) return null;
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatPagesPercent(locale: string, value: number | null): string | null {
  return formatPagesNumber(locale, value, {
    style: 'percent',
    maximumFractionDigits: 1,
  });
}

export function formatPagesPosition(locale: string, value: number | null): string | null {
  return formatPagesNumber(locale, value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

export function formatPagesDate(locale: string, value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function rangeDays(range: PagesRange): number {
  if (range === '7d') return 7;
  if (range === '90d') return 90;
  return 28;
}

export function formatPagesMetric(
  locale: string,
  key: PagesMetricKey,
  value: number | null,
): string | null {
  if (key === 'ctr') return formatPagesPercent(locale, value);
  if (key === 'averagePosition' || key === 'bestPosition' || key === 'difficulty') {
    return formatPagesPosition(locale, value);
  }
  return formatPagesNumber(locale, value, { maximumFractionDigits: 1 });
}

export function formatSignedPagesValue(
  locale: string,
  value: number | null,
  percent = false,
): string | null {
  if (value === null) return null;
  const formatted = formatPagesNumber(locale, Math.abs(value), percent
    ? { style: 'percent', maximumFractionDigits: 1 }
    : { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  if (value === 0) return formatted;
  return `${value > 0 ? '+' : '−'}${formatted}`;
}
