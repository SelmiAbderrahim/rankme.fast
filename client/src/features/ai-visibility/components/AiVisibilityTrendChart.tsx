import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@shared/ui/empty';
import type { AiVisibilityTrendPoint } from '../types';

interface Props {
  points: AiVisibilityTrendPoint[];
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 200;
const PADDING = 24;

/**
 * Minimal monochrome SVG mentioned-rate trend (design-system rule: near-black
 * line, dot markers, sparse gridline, aria-hidden SVG mirrored by a
 * visually-hidden table). Y axis is 0–100% mentioned rate, 100% at the top —
 * unlike the rank chart, higher is better here, so the axis is NOT inverted.
 */
export const AiVisibilityTrendChart = ({ points }: Props) => {
  const { t, i18n } = useTranslation('aiVisibility');
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );

  const plotted = useMemo(
    () =>
      points
        .filter(
          (p): p is AiVisibilityTrendPoint & { mentionedRatePct: number } =>
            p.mentionedRatePct !== null,
        )
        .map((p, index, arr) => ({
          x: PADDING + (index * (CHART_WIDTH - PADDING * 2)) / Math.max(1, arr.length - 1),
          y:
            PADDING +
            ((100 - p.mentionedRatePct) / 100) * (CHART_HEIGHT - PADDING * 2),
          point: p,
        })),
    [points],
  );

  if (plotted.length < 2) {
    return (
      <Empty data-testid="ai-visibility-trend-empty">
        <EmptyHeader>
          <EmptyTitle>{t('trend.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('trend.empty')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const path = plotted.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const latest = plotted[plotted.length - 1]!.point;

  return (
    <div className="flex flex-col gap-3" data-testid="ai-visibility-trend">
      <p className="text-sm text-muted-foreground">
        {t('trend.latest', { rate: latest.mentionedRatePct })}
      </p>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t('trend.chartLabel', { count: plotted.length })}
        className="border-border w-full rounded-md border bg-background"
        data-testid="ai-visibility-trend-svg"
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
        {plotted.map((p) => (
          <circle
            key={p.point.day}
            cx={p.x}
            cy={p.y}
            r={3}
            className="fill-primary"
          />
        ))}
      </svg>
      <table className="sr-only" data-testid="ai-visibility-trend-table">
        <caption>{t('trend.tableSummary', { count: points.length })}</caption>
        <thead>
          <tr>
            <th scope="col">{t('trend.tableDate')}</th>
            <th scope="col">{t('trend.tableRate')}</th>
            <th scope="col">{t('trend.tableShare')}</th>
            <th scope="col">{t('trend.tableChecks')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={`row-${p.day}`}>
              <td>{dateFormat.format(new Date(`${p.day}T00:00:00.000Z`))}</td>
              <td>{p.mentionedRatePct === null ? t('share.noData') : `${p.mentionedRatePct}%`}</td>
              <td>{p.shareOfVoicePct === null ? t('share.noData') : `${p.shareOfVoicePct}%`}</td>
              <td>{p.checks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
