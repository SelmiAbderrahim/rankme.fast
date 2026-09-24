import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import type { Keyword, RankHistoryPoint } from '../types';

export interface RankTrendChartProps {
  keyword: Keyword;
  series: RankHistoryPoint[];
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 200;
const PADDING = 24;
const MAX_POSITION = 100;

const dateFormatter = (locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

/**
 * Minimal monochrome SVG line chart per `.claude/rules/design-system.md`:
 * near-black stroke, small dot markers, sparse gridline, position axis
 * inverted (position 1 = top). The chart is aria-hidden — the same data
 * lives in a visually-hidden `<table>` for assistive tech.
 */
export const RankTrendChart = ({ keyword, series }: RankTrendChartProps) => {
  const { t, i18n } = useTranslation('ranks');
  const fmtDate = useMemo(() => dateFormatter(i18n.language), [i18n.language]);

  const latestPosition = keyword.latestPosition;
  const delta = keyword.delta;

  const points = useMemo(
    () =>
      series
        .filter((p): p is RankHistoryPoint & { position: number } => p.position !== null)
        .map((p, index, arr) => {
          const x =
            PADDING + (index * (CHART_WIDTH - PADDING * 2)) / Math.max(1, arr.length - 1);
          const y =
            PADDING + ((p.position - 1) / (MAX_POSITION - 1)) * (CHART_HEIGHT - PADDING * 2);
          return { x, y, position: p.position, checkedAt: p.checkedAt };
        }),
    [series],
  );

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const latestPositionLabel =
    latestPosition === null ? t('notInTop100') : String(latestPosition);

  const deltaLabel = describeDelta(delta, t);

  return (
    <Card data-testid="rank-trend">
      <CardHeader>
        <CardTitle>{t('trendTitle')}</CardTitle>
        <CardDescription>
          {t('trendSubtitle', { phrase: keyword.phrase })}
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
            <p className="text-muted-foreground text-sm" data-testid="rank-trend-delta">
              {deltaLabel}
            </p>
          </div>
        </div>
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={t('trendChartLabel', {
            phrase: keyword.phrase,
            count: points.length,
          })}
          className="border-border w-full rounded-md border bg-background"
          data-testid="rank-trend-svg"
        >
          <line
            x1={PADDING}
            x2={CHART_WIDTH - PADDING}
            y1={CHART_HEIGHT / 2}
            y2={CHART_HEIGHT / 2}
            className="stroke-border"
            strokeWidth={1}
          />
          <path
            d={path}
            fill="none"
            className="stroke-primary"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((p) => (
            <circle
              key={`${p.checkedAt}-${p.position}`}
              cx={p.x}
              cy={p.y}
              r={3}
              className="fill-primary"
            />
          ))}
        </svg>
        <table className="sr-only" data-testid="rank-trend-table">
          <caption>
            {t('trendTableSummary', {
              phrase: keyword.phrase,
              count: points.length,
            })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t('trendTableDate')}</th>
              <th scope="col">{t('trendTableRank')}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={`row-${p.checkedAt}`}>
                <td>{fmtDate.format(new Date(p.checkedAt))}</td>
                <td>{p.position}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
};

function describeDelta(delta: number | null, t: ReturnType<typeof useTranslation<'ranks'>>['t']): string {
  if (delta === null) return t('deltaFlat');
  if (delta === 0) return t('deltaFlat');
  if (delta > 0) {
    return delta === 1
      ? t('deltaUpOne')
      : t('deltaUp', { count: delta });
  }
  const magnitude = Math.abs(delta);
  return magnitude === 1
    ? t('deltaDownOne')
    : t('deltaDown', { count: magnitude });
}
