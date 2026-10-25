import type { PageMetrics, PagesRange } from './types';
import { formatAbsoluteDate } from '@shared/lib/datetime';
import { formatMetricValue } from '@shared/lib/metricValue';

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
  return formatMetricValue('position', value, locale);
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

export function formatPagesDay(locale: string, day: string): string {
  return formatAbsoluteDate(day, locale);
}

export function pagesPathLabel(displayUrl: string): string {
  const slash = displayUrl.indexOf('/');
  return slash > 0 ? displayUrl.slice(slash) : displayUrl;
}

export function pagesRowName(row: { title: string | null; displayUrl: string }): string {
  return row.title || pagesPathLabel(row.displayUrl);
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
  if (key === 'averagePosition' || key === 'bestPosition') {
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
