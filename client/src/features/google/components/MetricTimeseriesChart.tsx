/**
 * MetricTimeseriesChart — the shared metric-agnostic SVG line chart behind
 * BOTH the GSC (clicks/impressions) and GA4 (sessions/active users) daily
 * time series. The two metrics differ by orders of magnitude, so a toggle
 * keeps the chart single-series (one `--highlight`/`--chart-1` line scaled to
 * the active metric). A visually-hidden `<table>` carries every column for
 * assistive tech. All user-facing strings arrive via props so the thin
 * wrappers (`GscTimeseriesChart`, the GA4 card) own the i18n keys.
 */
import { useMemo, useState } from 'react';
import { Button } from '@shared/ui/button';

/** One of the two chartable metrics offered by the toggle. */
export interface MetricTimeseriesToggle<P> {
  id: string;
  label: string;
  value: (point: P) => number;
}

/** One numeric column of the sr-only data table. */
export interface MetricTimeseriesColumn<P> {
  id: string;
  header: string;
  format: (locale: string, point: P) => string;
}

export interface MetricTimeseriesChartProps<P extends { date: string }> {
  /** Daily points, ascending by date. */
  points: P[];
  locale: string;
  /** The two chartable metrics (left = default). */
  toggles: readonly [MetricTimeseriesToggle<P>, MetricTimeseriesToggle<P>];
  /** Every numeric column of the sr-only table (a superset of the toggles). */
  columns: readonly MetricTimeseriesColumn<P>[];
  /** aria-label factory for the svg, given the active metric's label. */
  chartLabel: (metricLabel: string) => string;
  metricGroupLabel: string;
  tableCaption: string;
  dateHeader: string;
  emptyLabel: string;
  /** Prefix for `data-testid`s: `<prefix>`, `-svg`, `-table`, `-empty`. */
  testIdPrefix: string;
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 160;
const PADDING = 24;

export const MetricTimeseriesChart = <P extends { date: string }>({
  points,
  locale,
  toggles,
  columns,
  chartLabel,
  metricGroupLabel,
  tableCaption,
  dateHeader,
  emptyLabel,
  testIdPrefix,
}: MetricTimeseriesChartProps<P>) => {
  const [metricIndex, setMetricIndex] = useState<0 | 1>(0);
  const active = metricIndex === 1 ? toggles[1] : toggles[0];

  const fmtDate = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );

  const coords = useMemo(() => {
    const max = Math.max(1, ...points.map((p) => active.value(p)));
    const span = Math.max(1, points.length - 1);
    return points.map((p, index) => {
      const x = PADDING + (index * (CHART_WIDTH - PADDING * 2)) / span;
      const y =
        CHART_HEIGHT -
        PADDING -
        (active.value(p) / max) * (CHART_HEIGHT - PADDING * 2);
      return { x, y, date: p.date };
    });
  }, [points, active]);

  if (points.length === 0) {
    return (
      <p
        className="text-muted-foreground mt-2 text-sm"
        data-testid={`${testIdPrefix}-empty`}
      >
        {emptyLabel}
      </p>
    );
  }

  const linePath = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`)
    .join(' ');
  const baseline = CHART_HEIGHT - PADDING;
  // Endpoint x-coordinates are deterministic (index 0 → PADDING, index n-1 →
  // the far edge) so the flat area fill closes without indexing `coords`.
  const lastIndex = points.length - 1;
  const lastX =
    PADDING + (lastIndex * (CHART_WIDTH - PADDING * 2)) / Math.max(1, lastIndex);
  const areaPath = `${linePath} L ${lastX} ${baseline} L ${PADDING} ${baseline} Z`;

  return (
    <div className="mt-2" data-testid={testIdPrefix}>
      <div
        role="group"
        aria-label={metricGroupLabel}
        className="mb-2 inline-flex gap-1"
      >
        {toggles.map((toggle, index) => (
          <Button
            key={toggle.id}
            type="button"
            size="sm"
            variant={metricIndex === index ? 'outline' : 'ghost'}
            aria-pressed={metricIndex === index}
            onClick={() => setMetricIndex(index === 1 ? 1 : 0)}
          >
            {toggle.label}
          </Button>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={chartLabel(active.label)}
        className="border-border bg-background w-full rounded-md border"
        data-testid={`${testIdPrefix}-svg`}
      >
        <line
          x1={PADDING}
          x2={CHART_WIDTH - PADDING}
          y1={baseline}
          y2={baseline}
          className="stroke-border"
          strokeWidth={1}
        />
        <path d={areaPath} className="fill-chart-1/10" stroke="none" />
        <path
          d={linePath}
          fill="none"
          className="stroke-highlight"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coords.map((c) => (
          <circle key={c.date} cx={c.x} cy={c.y} r={3} className="fill-highlight" />
        ))}
      </svg>
      <table className="sr-only" data-testid={`${testIdPrefix}-table`}>
        <caption>{tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{dateHeader}</th>
            {columns.map((column) => (
              <th key={column.id} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <td>{fmtDate.format(new Date(p.date))}</td>
              {columns.map((column) => (
                <td key={column.id} dir="ltr">
                  {column.format(locale, p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
