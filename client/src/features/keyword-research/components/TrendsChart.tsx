/**
 * Flat single-series monthly-volume line (design-system: `--chart-1` /
 * highlight series color, flat ≤10% area tint, no gradient, no animation —
 * trivially reduced-motion safe). The SVG is `aria-hidden`; the accessible
 * data-table fallback is rendered by `TrendsView` beside every chart.
 */
import { useTranslation } from 'react-i18next';
import type { KeywordMonthlySearch } from '../types';

export function sortMonthlySeries(
  series: readonly KeywordMonthlySearch[],
): KeywordMonthlySearch[] {
  return [...series].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  );
}

export const TrendsChart = ({ series }: { series: KeywordMonthlySearch[] }) => {
  const { t } = useTranslation();
  const ordered = sortMonthlySeries(series);

  if (ordered.length < 2) {
    return (
      <p
        className="text-muted-foreground text-sm"
        data-testid="kw-trends-chart-empty"
      >
        {t('keywordResearch:trends.emptySeries')}
      </p>
    );
  }

  const width = 320;
  const height = 80;
  const max = Math.max(...ordered.map((p) => p.searchVolume), 1);
  const step = width / (ordered.length - 1);
  const points = ordered.map((p, i) => {
    const x = i * step;
    const y = height - (p.searchVolume / max) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `0,${height} ${points.join(' ')} ${width},${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-20 w-full max-w-full"
      aria-hidden="true"
      focusable="false"
      data-testid="kw-trends-chart"
    >
      <polygon points={area} className="fill-highlight/10" />
      <polyline
        points={points.join(' ')}
        fill="none"
        className="stroke-highlight"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};
