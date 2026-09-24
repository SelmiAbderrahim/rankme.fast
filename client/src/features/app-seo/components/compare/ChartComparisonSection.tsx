import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import type { AppSeoComparison } from '../../compare-types';
import { ComparisonDeltaChip } from './ComparisonDeltaChip';
import { NotObservedNote } from './NotObservedNote';

export function ChartComparisonSection({
  comparison,
  chartsHref,
}: {
  comparison: AppSeoComparison;
  chartsHref: string;
}) {
  const { t, i18n } = useTranslation('appSeoCompare');
  const number = new Intl.NumberFormat(i18n.language);
  const position = (value: number | null) => value === null
    ? t('common.notObserved')
    : number.format(value);
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>{t('charts.title')}</CardTitle>
        <CardDescription>{t('charts.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {comparison.charts.length === 0 ? (
          <NotObservedNote
            title={t('notObserved.chartsTitle')}
            description={t('notObserved.chartsDescription')}
            href={chartsHref}
            linkLabel={t('notObserved.openCharts')}
          />
        ) : (
          <Table>
            <TableCaption>{t('charts.caption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('charts.chart')}</TableHead>
                <TableHead>{t('charts.category')}</TableHead>
                <TableHead className="text-end">{t('stores.googlePlay')}</TableHead>
                <TableHead className="text-end">{t('stores.appStore')}</TableHead>
                <TableHead>{t('charts.delta')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparison.charts.map((row) => (
                <TableRow key={`${row.chartId}-${row.categoryId ?? ''}`}>
                  <TableCell>{row.chartId}</TableCell>
                  <TableCell>{row.categoryId ?? t('charts.allCategories')}</TableCell>
                  <TableCell className="text-end tabular-nums">{position(row.googlePlay.position)}</TableCell>
                  <TableCell className="text-end tabular-nums">{position(row.appStore.position)}</TableCell>
                  <TableCell><ComparisonDeltaChip value={row.delta} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
