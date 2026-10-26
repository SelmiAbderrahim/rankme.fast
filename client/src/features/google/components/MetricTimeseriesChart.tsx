/**
 * MetricTimeseriesChart — the shared metric-agnostic SVG line chart behind
 * BOTH the GSC (clicks/impressions) and GA4 (sessions/active users) daily
 * time series. The two metrics differ by orders of magnitude, so a toggle
 * keeps the chart single-series (one `--highlight`/`--chart-1` line scaled to
 * the active metric). A visually-hidden `<table>` carries every column for
 * assistive tech. All user-facing strings arrive via props so the thin
 * wrappers (`GscTimeseriesChart`, the GA4 card) own the i18n keys.
 *
 * Reading aids (shared by every consumer): an explicit zero baseline with a
 * y-axis scale and gridlines, date ticks on the x-axis, and an exact-value
 * tooltip that follows the pointer AND keyboard focus (the points form a
 * roving-tabindex group: Tab enters, Arrow keys / Home / End move). A series
 * with no activity is drawn flat on the zero baseline and says so.
 */
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@shared/ui/button';
import { niceScale, tickIndices } from '../lib/chartScale';
import { formatDay } from '../lib/format';
import { ScreenReaderTable } from '@shared/components/ScreenReaderTable';
import { Bdi } from '@shared/components/Bdi';
import { isolateLtr } from '@shared/lib/bidi';
import { useElementWidth } from '@shared/hooks/useElementWidth';
import { tooltipPlacement } from '@shared/lib/chartTooltip';

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
  format: (locale: string, point: P) => ReactNode;
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
  /** Shown over the flat zero baseline when the active series has no activity; named for that metric. */
  noActivityLabel: (metricId: string) => string;
  /** Prefix for `data-testid`s: `<prefix>`, `-svg`, `-table`, `-empty`. */
  testIdPrefix: string;
}

/** Time and numbers always read left to right inside the plot, in every UI language. */
const SVG_TEXT_STYLE = { direction: 'ltr', unicodeBidi: 'isolate' } as const;

/** Drawn width until the chart is measured (server render, tests). */
const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 280;
const CHART_HEIGHT = 200;
const PAD_LEFT = 48;
const PAD_RIGHT = 20;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;
const PLOT_HEIGHT = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
const BASELINE = PAD_TOP + PLOT_HEIGHT;
const MAX_X_TICKS = 6;

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
  noActivityLabel,
  testIdPrefix,
}: MetricTimeseriesChartProps<P>) => {
  // The viewer's own choice, once made. Until then a series with no activity is
  // not the default when the other has some: zero clicks over real impressions
  // opens on impressions instead of an empty-looking chart.
  const [chosenIndex, setMetricIndex] = useState<0 | 1 | null>(null);
  const metricIndex: 0 | 1 =
    chosenIndex ??
    (points.every((p) => toggles[0].value(p) === 0) && points.some((p) => toggles[1].value(p) > 0) ? 1 : 0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const active = metricIndex === 1 ? toggles[1] : toggles[0];
  // Drawn at the real pixel width so labels keep the stylesheet's size.
  const [chartRef, measured] = useElementWidth<HTMLDivElement>(DEFAULT_WIDTH);
  const chartWidth = Math.max(MIN_WIDTH, measured);
  const plotWidth = chartWidth - PAD_LEFT - PAD_RIGHT;

  const fmtTick = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    [locale],
  );
  const fmtCompact = useMemo(
    () => new Intl.NumberFormat(locale, { notation: 'compact' }),
    [locale],
  );
  const fmtExact = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const { coords, scale, allZero } = useMemo(() => {
    const max = Math.max(0, ...points.map((p) => active.value(p)));
    const niceTop = niceScale(max);
    const span = Math.max(1, points.length - 1);
    return {
      scale: niceTop,
      allZero: max === 0,
      coords: points.map((p, index) => ({
        x: PAD_LEFT + (index * plotWidth) / span,
        y: BASELINE - (active.value(p) / niceTop.top) * PLOT_HEIGHT,
        date: p.date,
        values: toggles.map((toggle) => ({
          id: toggle.id,
          label: toggle.label,
          value: toggle.value(p),
        })),
      })),
    };
  }, [points, active, toggles, plotWidth]);

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
  // Endpoint x-coordinates are deterministic (index 0 → PAD_LEFT, index n-1 →
  // the far edge) so the flat area fill closes without indexing `coords`.
  const lastIndex = points.length - 1;
  const lastX = PAD_LEFT + (lastIndex * plotWidth) / Math.max(1, lastIndex);
  const areaPath = `${linePath} L ${lastX} ${BASELINE} L ${PAD_LEFT} ${BASELINE} Z`;
  const step = plotWidth / Math.max(1, lastIndex);
  const tipIndex = hoverIndex ?? focusIndex;
  const tabbableIndex = focusIndex ?? lastIndex;
  const xTicks = new Set(tickIndices(points.length, MAX_X_TICKS));

  const onPointKeyDown = (event: KeyboardEvent<SVGCircleElement>, index: number) => {
    const target =
      event.key === 'ArrowRight'
        ? Math.min(index + 1, lastIndex)
        : event.key === 'ArrowLeft'
          ? Math.max(index - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? lastIndex
              : null;
    if (target === null) return;
    event.preventDefault();
    // The target index is always inside the series, so the lookup resolves.
    (
      (event.currentTarget.parentElement as Element).querySelector(
        `[data-point-index="${target}"]`,
      ) as SVGCircleElement
    ).focus();
  };

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
            <Bdi>{toggle.label}</Bdi>
          </Button>
        ))}
      </div>
      <div dir="ltr">
        <div ref={chartRef} className="relative">
          <svg
            viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
            width={chartWidth}
            height={CHART_HEIGHT}
            role="group"
            aria-label={chartLabel(active.label)}
            className="ring-border bg-background block max-w-full rounded-md ring-1 ring-inset"
            data-testid={`${testIdPrefix}-svg`}
            onPointerLeave={() => setHoverIndex(null)}
          >
            {scale.ticks.map((tick) => {
              const y = BASELINE - (tick / scale.top) * PLOT_HEIGHT;
              return (
                <g key={tick} data-testid={`${testIdPrefix}-ytick`}>
                  <line
                    x1={PAD_LEFT}
                    x2={chartWidth - PAD_RIGHT}
                    y1={y}
                    y2={y}
                    className={tick === 0 ? 'stroke-input' : 'stroke-border'}
                    strokeWidth={1}
                  />
                  <text
                    style={SVG_TEXT_STYLE}
                    x={PAD_LEFT - 8}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-muted-foreground text-xs"
                  >
                    {fmtCompact.format(tick)}
                  </text>
                </g>
              );
            })}
            {coords.map((c, index) =>
              xTicks.has(index) ? (
                <text
                  style={SVG_TEXT_STYLE}
                  key={c.date}
                  x={c.x}
                  y={CHART_HEIGHT - 8}
                  textAnchor={index === 0 ? 'start' : index === lastIndex ? 'end' : 'middle'}
                  className="fill-muted-foreground text-xs"
                  data-testid={`${testIdPrefix}-xtick`}
                >
                  {isolateLtr(fmtTick.format(new Date(`${c.date}T00:00:00.000Z`)))}
                </text>
              ) : null,
            )}
            <path d={areaPath} className="fill-chart-1/10" stroke="none" />
            <path
              d={linePath}
              fill="none"
              className="stroke-highlight"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {allZero ? (
              <text
                style={SVG_TEXT_STYLE}
                x={PAD_LEFT + plotWidth / 2}
                y={PAD_TOP + PLOT_HEIGHT / 2}
                textAnchor="middle"
                className="fill-muted-foreground text-xs"
                data-testid={`${testIdPrefix}-no-activity`}
              >
                {noActivityLabel(active.id)}
              </text>
            ) : null}
            <g>
              {coords.map((c, index) => (
                <circle
                  key={c.date}
                  cx={c.x}
                  cy={c.y}
                  r={tipIndex === index ? 5 : 3}
                  className="fill-highlight focus-visible:outline-none"
                  stroke={tipIndex === index ? 'currentColor' : 'none'}
                  strokeWidth={2}
                  role="img"
                  tabIndex={tabbableIndex === index ? 0 : -1}
                  aria-label={`${formatDay(locale, c.date)}: ${c.values
                    .map((v) => `${v.label} ${fmtExact.format(v.value)}`)
                    .join(', ')}`}
                  data-point-index={index}
                  data-testid={`${testIdPrefix}-point`}
                  onFocus={() => setFocusIndex(index)}
                  onBlur={() => setFocusIndex(null)}
                  onKeyDown={(event) => onPointKeyDown(event, index)}
                />
              ))}
            </g>
            <g aria-hidden="true">
              {coords.map((c, index) => (
                <rect
                  key={c.date}
                  x={c.x - step / 2}
                  y={PAD_TOP}
                  width={step}
                  height={PLOT_HEIGHT}
                  fill="transparent"
                  data-testid={`${testIdPrefix}-hit`}
                  onPointerEnter={() => setHoverIndex(index)}
                />
              ))}
            </g>
          </svg>
          {coords.map((c, index) => {
            if (tipIndex !== index) return null;
            const placement = tooltipPlacement(c.x, c.y, chartWidth);
            return (
              <div
                key={c.date}
                role="status"
                dir="auto"
                className="bg-popover text-popover-foreground border-border pointer-events-none absolute z-10 w-max max-w-[min(20rem,100%)] rounded-md border px-2 py-1 text-xs shadow-sm"
                style={{ left: `${c.x}px`, top: `${c.y}px`, transform: placement.transform }}
                data-placement={`${placement.vertical}-${placement.horizontal}`}
                data-testid={`${testIdPrefix}-tooltip`}
              >
                <p className="font-medium">{formatDay(locale, c.date)}</p>
                {c.values.map((v) => (
                  <p
                    key={v.id}
                    className={v.id === active.id ? 'font-semibold' : 'text-muted-foreground'}
                  >
                    {`${v.label}: ${fmtExact.format(v.value)}`}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <ScreenReaderTable data-testid={`${testIdPrefix}-table`}>
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
              <td>{formatDay(locale, p.date)}</td>
              {columns.map((column) => (
                <td key={column.id} dir="ltr">
                  {column.format(locale, p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </ScreenReaderTable>
    </div>
  );
};
