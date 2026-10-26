import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LineChart } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import type { Keyword, RankHistoryMissedCheck, RankHistoryPoint } from '../types';
import { formatAbsoluteDate } from '@shared/lib/datetime';
import { ScreenReaderTable } from '@shared/components/ScreenReaderTable';
import { PositionDelta } from '@shared/components/PositionDelta';
import { isolateLtr, isolateText } from '@shared/lib/bidi';
import { useElementWidth } from '@shared/hooks/useElementWidth';
import { tooltipPlacement } from '@shared/lib/chartTooltip';

export interface RankTrendChartProps {
  keyword: Keyword;
  series: RankHistoryPoint[];
  /** Scheduled checks that recorded no rank; drawn as gaps, never as a rank. */
  missedChecks?: RankHistoryMissedCheck[];
}

/** Drawn width until the plot is measured (server render, tests). */
/** Time and numbers always read left to right inside the plot, in every UI language. */
const SVG_TEXT_STYLE = { direction: 'ltr', unicodeBidi: 'isolate' } as const;

const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 240;
const CHART_HEIGHT = 220;
const PAD_LEFT = 44;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 44;
/** Where checks that found no rank sit: a lane under the plot, not a fake position. */
const LANE_OFFSET = 12;
const MAX_POSITION = 100;
/** The position axis never spans fewer than this many positions. */
const MIN_SPAN = 4;

const dateFormatter = (locale: string) => ({
  format: (value: Date | string) => formatAbsoluteDate(value, locale),
});

/** Whole-number tick spacings a rank axis may use. */
const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100];

/** The smallest spacing that keeps the axis to five labelled steps. */
function pickTickStep(top: number, bottom: number): number {
  // The widest step (100) always fits inside 1-100, so a step is always found.
  return TICK_STEPS.find((step) => Math.floor(bottom / step) - Math.floor(top / step) <= 5)!;
}

/**
 * The position range the chart shows: the checked positions with a
 * little room, never fewer than `MIN_SPAN` positions, inside 1–100, widened to
 * the next round tick so the labelled positions are meaningful numbers (1, 10,
 * 20, ...) rather than arbitrary ones. `top` is the best (smallest) position,
 * drawn at the top of the chart.
 */
export function positionDomain(positions: number[]): { top: number; bottom: number } {
  let top = Math.max(1, Math.min(...positions) - 1);
  let bottom = Math.min(MAX_POSITION, Math.max(...positions) + 1);
  if (bottom - top < MIN_SPAN) {
    bottom = Math.min(MAX_POSITION, top + MIN_SPAN);
    top = Math.max(1, bottom - MIN_SPAN);
  }
  const step = pickTickStep(top, bottom);
  return {
    top: Math.max(1, Math.floor(top / step) * step),
    bottom: Math.min(MAX_POSITION, Math.ceil(bottom / step) * step),
  };
}

/** Round whole-number ticks across the domain, always including both ends. */
export function positionTicks({ top, bottom }: { top: number; bottom: number }): number[] {
  const step = pickTickStep(top, bottom);
  const ticks = new Set<number>([top, bottom]);
  for (let value = Math.ceil(top / step) * step; value < bottom; value += step) ticks.add(value);
  return [...ticks].sort((a, b) => a - b);
}

/**
 * Rank history as a single-series line on the shared chart tokens
 * (`design-system.md` §2): position axis inverted (1 at the top) with labelled
 * ticks, first and last check dates on the time axis, small dot markers and
 * a sparse grid. Pointer or keyboard (arrow keys, Home, End) reveals each
 * check in a tooltip that is also announced; the same data stays in a
 * visually hidden table. Fewer than two checks show an empty state instead
 * of a line that cannot describe a trend.
 */
type ChartEvent =
  | { kind: 'ranked'; at: string; time: number; position: number; x: number; y: number }
  | { kind: 'unranked'; at: string; time: number; x: number; y: number }
  | { kind: 'failed' | 'skipped'; at: string; time: number; x: number; y: number };

export const RankTrendChart = ({ keyword, series, missedChecks = [] }: RankTrendChartProps) => {
  const { t, i18n } = useTranslation('ranks');
  const fmtDate = useMemo(() => dateFormatter(i18n.language), [i18n.language]);
  const [active, setActive] = useState<number | null>(null);
  // The chart is drawn at its real pixel width, so labels keep the size the
  // stylesheet gives them instead of scaling with the container.
  const [plotRef, measured] = useElementWidth<HTMLDivElement>(DEFAULT_WIDTH);
  const chartWidth = Math.max(MIN_WIDTH, measured);

  const latestPosition = keyword.latestPosition;

  const { events, observations, ticks, yOf, segments, gapNote } = useMemo(() => {
    const ranked = series.filter(
      (p): p is RankHistoryPoint & { position: number } => p.position !== null,
    );
    const domain = positionDomain(ranked.length > 0 ? ranked.map((p) => p.position) : [1]);
    const plotHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
    const plotBottom = PAD_TOP + plotHeight;
    const y = (position: number) =>
      PAD_TOP + ((position - domain.top) / (domain.bottom - domain.top)) * plotHeight;
    const plotWidth = chartWidth - PAD_LEFT - PAD_RIGHT;
    // Every stored observation and every missed check, in time order. The time
    // axis is real time: a week with no rank shows as a gap, not as neighbours.
    const raw = [
      ...series.map((p) => ({
        kind: p.position === null ? ('unranked' as const) : ('ranked' as const),
        at: p.checkedAt,
        position: p.position,
      })),
      ...missedChecks.map((m) => ({ kind: m.status, at: m.attemptedAt, position: null })),
    ]
      .map((e) => ({ ...e, time: new Date(e.at).getTime() }))
      .sort((a, b) => a.time - b.time);
    const first = raw[0]?.time ?? 0;
    const last = raw[raw.length - 1]?.time ?? 0;
    const xOf = (time: number) =>
      last === first ? PAD_LEFT + plotWidth / 2 : PAD_LEFT + ((time - first) / (last - first)) * plotWidth;
    const list: ChartEvent[] = raw.map((e) => {
      const x = xOf(e.time);
      if (e.kind === 'ranked') {
        return { kind: 'ranked', at: e.at, time: e.time, position: e.position!, x, y: y(e.position!) };
      }
      const laneY = plotBottom + LANE_OFFSET;
      return { kind: e.kind, at: e.at, time: e.time, x, y: laneY };
    });
    const obs = list.filter((e) => e.kind === 'ranked' || e.kind === 'unranked');
    const missed = list.filter((e) => e.kind === 'failed' || e.kind === 'skipped');
    // A line between two observations is solid only when nothing went missing
    // between them and both ends have a position.
    const segs = obs.slice(1).map((to, index) => {
      const from = obs[index]!;
      const bridges =
        from.kind !== 'ranked' ||
        to.kind !== 'ranked' ||
        missed.some((m) => m.time > from.time && m.time < to.time);
      return { from, to, bridges };
    });
    return {
      events: list,
      observations: obs,
      ticks: positionTicks(domain),
      yOf: y,
      segments: segs,
      gapNote: segs.some((seg) => seg.bridges) || missed.length > 0,
    };
  }, [series, missedChecks, chartWidth]);

  const latestPositionLabel =
    latestPosition === null ? t('notInTop100') : String(latestPosition);

  const tooltipFor = (event: ChartEvent) => {
    const date = fmtDate.format(new Date(event.at));
    if (event.kind === 'ranked') return t('trendTooltip', { date, position: event.position });
    if (event.kind === 'unranked') return t('trendTooltipUnranked', { date });
    return t(event.kind === 'failed' ? 'trendTooltipFailed' : 'trendTooltipSkipped', { date });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = events.length - 1;
    const current = active ?? last;
    const next =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? Math.max(0, current - 1)
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? Math.min(last, current + 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : event.key === 'Escape'
                ? null
                : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };

  /** The event nearest the pointer, by its place along the time axis. */
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * chartWidth;
    let nearest = 0;
    events.forEach((p, index) => {
      if (Math.abs(p.x - x) < Math.abs(events[nearest]!.x - x)) nearest = index;
    });
    setActive(nearest);
  };

  const activePoint = active === null ? null : events[active]!;
  const placement = activePoint ? tooltipPlacement(activePoint.x, activePoint.y, chartWidth) : null;
  const plotBottom = CHART_HEIGHT - PAD_BOTTOM;

  return (
    <Card data-testid="rank-trend">
      <CardHeader>
        <CardTitle>{t('trendTitle')}</CardTitle>
        <CardDescription>
          {t('trendSubtitle', { phrase: isolateText(keyword.phrase) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              {t('trendLatestLabel')}
            </p>
            <p className="text-2xl font-semibold tabular-nums" data-testid="rank-trend-latest">
              {latestPositionLabel}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              {t('trendDeltaLabel')}
            </p>
            <p className="text-sm" data-testid="rank-trend-delta">
              <PositionDelta
                variant="full"
                change={keyword.positionChange}
                movement={keyword.movement}
                fallbackDelta={keyword.delta}
              />
            </p>
          </div>
        </div>
        {observations.length < 2 ? (
          <Empty className="border border-dashed" data-testid="rank-trend-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LineChart aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{t('trendNeedsTwoTitle')}</EmptyTitle>
              <EmptyDescription>{t('trendNeedsTwoBody')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <p
              className="text-muted-foreground -mb-2 text-xs"
              data-testid="rank-trend-axis-title"
            >
              {t('trendAxisPosition')}
            </p>
            <div
              ref={plotRef}
              className="relative rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              tabIndex={0}
              role="group"
              aria-label={t('trendChartHint')}
              aria-describedby={activePoint ? 'rank-trend-tooltip' : undefined}
              onKeyDown={onKeyDown}
              onFocus={() => setActive((current) => current ?? events.length - 1)}
              onBlur={() => setActive(null)}
              onPointerMove={onPointerMove}
              onPointerLeave={() => setActive(null)}
              data-testid="rank-trend-plot"
            >
              <svg
                viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
                width={chartWidth}
                height={CHART_HEIGHT}
                role="img"
                aria-label={t('trendChartLabel', {
                  phrase: keyword.phrase,
                  count: observations.length,
                })}
                // Time runs left to right in every locale.
                direction="ltr"
                className="ring-border block max-w-full rounded-md bg-background ring-1 ring-inset"
                data-testid="rank-trend-svg"
              >
                {ticks.map((tick) => (
                  <g key={tick} data-testid="rank-trend-tick">
                    <line
                      x1={PAD_LEFT}
                      x2={chartWidth - PAD_RIGHT}
                      y1={yOf(tick)}
                      y2={yOf(tick)}
                      className="stroke-border"
                      strokeWidth={1}
                    />
                    <text
 style={SVG_TEXT_STYLE}
                      x={PAD_LEFT - 8}
                      y={yOf(tick)}
                      textAnchor="end"
                      dominantBaseline="middle"
                      className="fill-muted-foreground text-xs tabular-nums"
                    >
                      {tick}
                    </text>
                  </g>
                ))}
                <text
 style={SVG_TEXT_STYLE}
                  x={PAD_LEFT}
                  y={CHART_HEIGHT - 8}
                  className="fill-muted-foreground text-xs"
                  data-testid="rank-trend-first-date"
                >
                  {isolateLtr(fmtDate.format(new Date(events[0]!.at)))}
                </text>
                <text
 style={SVG_TEXT_STYLE}
                  x={chartWidth - PAD_RIGHT}
                  y={CHART_HEIGHT - 8}
                  textAnchor="end"
                  className="fill-muted-foreground text-xs"
                  data-testid="rank-trend-last-date"
                >
                  {isolateLtr(fmtDate.format(new Date(events[events.length - 1]!.at)))}
                </text>
                {segments.map((seg) => (
                  <line
                    key={`${seg.from.at}-${seg.to.at}`}
                    x1={seg.from.x}
                    y1={seg.from.y}
                    x2={seg.to.x}
                    y2={seg.to.y}
                    className={seg.bridges ? 'stroke-muted-foreground' : 'stroke-chart-1'}
                    strokeWidth={seg.bridges ? 1.5 : 2}
                    strokeDasharray={seg.bridges ? '4 4' : undefined}
                    strokeLinecap="round"
                    data-testid={seg.bridges ? 'rank-trend-gap' : 'rank-trend-segment'}
                  />
                ))}
                {events.map((p, index) =>
                  p.kind === 'ranked' ? (
                    <circle
                      key={`${p.at}-ranked`}
                      cx={p.x}
                      cy={p.y}
                      r={index === active ? 5 : 3}
                      className="fill-chart-1"
                      data-testid="rank-trend-point"
                    />
                  ) : p.kind === 'unranked' ? (
                    <circle
                      key={`${p.at}-unranked`}
                      cx={p.x}
                      cy={p.y}
                      r={index === active ? 5 : 3.5}
                      className="fill-background stroke-chart-1"
                      strokeWidth={1.5}
                      data-testid="rank-trend-unranked"
                    />
                  ) : (
                    <g key={`${p.at}-${p.kind}`} data-testid="rank-trend-missed" data-status={p.kind}>
                      <line
                        x1={p.x}
                        x2={p.x}
                        y1={PAD_TOP}
                        y2={plotBottom}
                        className="stroke-destructive"
                        strokeWidth={1}
                        strokeDasharray="2 3"
                      />
                      <path
                        d={`M ${p.x - 4} ${p.y - 4} L ${p.x + 4} ${p.y + 4} M ${p.x + 4} ${p.y - 4} L ${p.x - 4} ${p.y + 4}`}
                        className="stroke-destructive"
                        strokeWidth={index === active ? 3 : 2}
                        strokeLinecap="round"
                        fill="none"
                      />
                    </g>
                  ),
                )}
              </svg>
              {activePoint ? (
                <div
                  id="rank-trend-tooltip"
                  role="tooltip"
                  aria-live="polite"
                  className="bg-popover text-popover-foreground pointer-events-none absolute w-max max-w-[min(20rem,100%)] rounded-md border px-2 py-1 text-xs shadow-sm"
                  style={{
                    left: `${activePoint.x}px`,
                    top: `${activePoint.y}px`,
                    transform: placement!.transform,
                  }}
                  data-placement={`${placement!.vertical}-${placement!.horizontal}`}
                  data-testid="rank-trend-tooltip"
                >
                  {tooltipFor(activePoint)}
                </div>
              ) : null}
            </div>
            {gapNote ? (
              <p className="text-muted-foreground text-xs" data-testid="rank-trend-gap-note">
                {t('trendGapNote')}
              </p>
            ) : null}
            <ScreenReaderTable data-testid="rank-trend-table">
              <caption>
                {t('trendTableSummary', {
                  phrase: isolateText(keyword.phrase),
                  count: events.length,
                })}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t('trendTableDate')}</th>
                  <th scope="col">{t('trendTableRank')}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((p) => (
                  <tr key={`row-${p.at}-${p.kind}`}>
                    <td>{fmtDate.format(new Date(p.at))}</td>
                    <td>
                      {p.kind === 'ranked'
                        ? p.position
                        : p.kind === 'unranked'
                          ? t('notInTop100')
                          : t(p.kind === 'failed' ? 'trendTableFailed' : 'trendTableSkipped')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ScreenReaderTable>
          </>
        )}
      </CardContent>
    </Card>
  );
};
