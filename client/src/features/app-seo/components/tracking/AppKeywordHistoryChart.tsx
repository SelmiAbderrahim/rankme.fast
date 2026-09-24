import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import type { AppKeyword, AppKeywordHistoryPoint } from '../../tracking-types';

export function AppKeywordHistoryChart({
  keyword,
  points,
}: {
  keyword: AppKeyword;
  points: AppKeywordHistoryPoint[];
}) {
  const { t, i18n } = useTranslation('appSeoTracking');
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );
  const width = 680;
  const height = 220;
  const padding = 28;
  const found = points.filter(
    (point): point is AppKeywordHistoryPoint & { position: number } => point.position !== null,
  );
  const maxPosition = Math.max(2, ...found.map((point) => point.position));
  const coordinates = found.map((point) => {
    const originalIndex = points.indexOf(point);
    const x = points.length <= 1
      ? width / 2
      : padding + (originalIndex / (points.length - 1)) * (width - padding * 2);
    // Position axes are inverted by definition: first place is at the top.
    const y = padding + ((point.position - 1) / (maxPosition - 1)) * (height - padding * 2);
    return { point, x, y };
  });
  const line = coordinates
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ');
  const first = coordinates[0];
  const last = coordinates.at(-1);
  const baseline = height - padding;
  const area = first && last && coordinates.length > 1
    ? `${line} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`
    : '';

  if (points.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('history.empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="app-keyword-history">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('history.chartLabel', { phrase: keyword.phrase })}
        className="border-border bg-background w-full rounded-md border"
      >
        {area ? <path d={area} className="fill-chart-1/10" stroke="none" /> : null}
        {line ? (
          <path
            d={line}
            fill="none"
            className="stroke-highlight"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {coordinates.map(({ point, x, y }) => (
          <circle
            key={point.checkedAt}
            cx={x}
            cy={y}
            r="3"
            className="fill-highlight"
          />
        ))}
      </svg>
      <Table>
        <TableCaption className="sr-only">
          {t('history.tableCaption', { phrase: keyword.phrase })}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{t('history.date')}</TableHead>
            <TableHead>{t('history.position')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {points.map((point) => (
            <TableRow key={point.checkedAt}>
              <TableCell>{date.format(new Date(point.checkedAt))}</TableCell>
              <TableCell>
                {point.position === null ? t('history.notInDepth') : point.position}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
