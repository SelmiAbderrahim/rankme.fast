/** Missing evidence stays distinct from a measured zero. */
export type MetricKind = 'count' | 'position' | 'ratio' | 'decimal';
export interface MetricContext { denominator?: number | null; }

const isNumber = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

export function metricHasData(kind: MetricKind, value: number | null | undefined, context: MetricContext = {}): value is number {
  if (!isNumber(value)) return false;
  const { denominator } = context;
  if ((kind === 'position' || kind === 'ratio') && denominator !== undefined && !(isNumber(denominator) && denominator > 0)) return false;
  return kind !== 'position' || value > 0;
}

const FORMAT: Record<MetricKind, Intl.NumberFormatOptions> = {
  count: { maximumFractionDigits: 0 },
  position: { minimumFractionDigits: 0, maximumFractionDigits: 1 },
  ratio: { style: 'percent', maximumFractionDigits: 1 },
  decimal: { maximumFractionDigits: 2 },
};

export function formatMetricValue(kind: MetricKind, value: number | null | undefined, locale: string, context: MetricContext = {}): string | null {
  return metricHasData(kind, value, context) ? new Intl.NumberFormat(locale, FORMAT[kind]).format(value) : null;
}
