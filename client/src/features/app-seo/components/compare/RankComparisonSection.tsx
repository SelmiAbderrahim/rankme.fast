import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { formatCountryFromLocation, languageName } from '@shared/markets';
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

export function RankComparisonSection({
  comparison,
  keywordsHref,
}: {
  comparison: AppSeoComparison;
  keywordsHref: string;
}) {
  const { t, i18n } = useTranslation('appSeoCompare');
  const number = new Intl.NumberFormat(i18n.language);
  const marketLabel = (locationCode: number, languageCode: string) =>
    `${formatCountryFromLocation(locationCode, i18n.language, t('common:market.unknownCountry'))} · ${languageName(languageCode, i18n.language) ?? t('common:market.unknownLanguage')}`;
  const rank = (value: number | null) => value === null ? t('common.notObserved') : number.format(value);
  const hasTracked = comparison.ranks.shared.length
    + comparison.ranks.onlyGooglePlay.length
    + comparison.ranks.onlyAppStore.length > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>{t('ranks.title')}</CardTitle>
        <CardDescription>{t('ranks.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {!hasTracked ? (
          <NotObservedNote
            title={t('notObserved.ranksTitle')}
            description={t('notObserved.ranksDescription')}
            href={keywordsHref}
            linkLabel={t('notObserved.openKeywords')}
          />
        ) : comparison.ranks.shared.length === 0 ? (
          <NotObservedNote
            title={t('notObserved.sharedRanksTitle')}
            description={t('notObserved.sharedRanksDescription')}
            href={keywordsHref}
            linkLabel={t('notObserved.openKeywords')}
          />
        ) : (
          <Table>
            <TableCaption>{t('ranks.caption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('ranks.phrase')}</TableHead>
                <TableHead>{t('ranks.market')}</TableHead>
                <TableHead className="text-end">{t('stores.googlePlay')}</TableHead>
                <TableHead className="text-end">{t('stores.appStore')}</TableHead>
                <TableHead>{t('ranks.delta')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparison.ranks.shared.map((row) => (
                <TableRow key={`${row.phrase}-${row.locationCode}-${row.languageCode}`}>
                  <TableCell className="max-w-72 whitespace-normal">{row.phrase}</TableCell>
                  <TableCell>{marketLabel(row.locationCode, row.languageCode)}</TableCell>
                  <TableCell className="text-end tabular-nums">{rank(row.googlePlay.position)}</TableCell>
                  <TableCell className="text-end tabular-nums">{rank(row.appStore.position)}</TableCell>
                  <TableCell><ComparisonDeltaChip value={row.delta} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {([
            ['onlyGooglePlay', 'googlePlay'],
            ['onlyAppStore', 'appStore'],
          ] as const).map(([key, store]) => (
            <div key={key} className="rounded-xl border border-border p-4">
              <h3 className="font-semibold">{t(`ranks.only.${store}`)}</h3>
              {comparison.ranks[key].length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t('ranks.only.none')}</p>
              ) : (
                <Table>
                  <TableCaption>{t(`ranks.only.${store}Caption`)}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('ranks.phrase')}</TableHead>
                      <TableHead>{t('ranks.market')}</TableHead>
                      <TableHead className="text-end">{t('ranks.position')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparison.ranks[key].map((row) => (
                      <TableRow key={`${row.phrase}-${row.locationCode}-${row.languageCode}`}>
                        <TableCell className="max-w-56 whitespace-normal">{row.phrase}</TableCell>
                        <TableCell>{marketLabel(row.locationCode, row.languageCode)}</TableCell>
                        <TableCell className="text-end tabular-nums">{rank(row.position)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
