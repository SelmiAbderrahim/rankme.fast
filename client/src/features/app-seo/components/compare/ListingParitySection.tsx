import { useTranslation } from 'react-i18next';
import { Badge } from '@shared/ui/badge';
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
import type { AppSeoCompareRawValue, AppSeoComparison } from '../../compare-types';
import { NotObservedNote } from './NotObservedNote';

const badgeClass = (status: 'finding' | 'passed' | 'notEvaluated') => status === 'passed'
  ? 'bg-success/10 text-success'
  : status === 'finding'
    ? 'bg-warning/15 text-warning'
    : 'bg-muted text-muted-foreground';

export function ListingParitySection({
  comparison,
  listingHref,
}: {
  comparison: AppSeoComparison;
  listingHref: string;
}) {
  const { t } = useTranslation('appSeoCompare');
  const value = (raw: AppSeoCompareRawValue) => raw === null
    ? t('common.notObserved')
    : Array.isArray(raw)
      ? raw.join(', ')
      : String(raw);
  const listingsMissing = !comparison.listings.google_play || !comparison.listings.app_store;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle role="heading" aria-level={3}>{t('parity.title')}</CardTitle>
            <CardDescription>{t('parity.description')}</CardDescription>
          </div>
          <Badge variant="outline">{t('common.userPaired')}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {listingsMissing ? (
          <NotObservedNote
            title={t('notObserved.listingsTitle')}
            description={t('notObserved.listingsDescription')}
            href={listingHref}
            linkLabel={t('notObserved.openListing')}
          />
        ) : null}
        {comparison.listingParity.findings.length > 0 ? (
          <div>
            <h3 className="mb-3 font-semibold">{t('parity.findings')}</h3>
            <ul className="grid gap-3">
              {comparison.listingParity.findings.map((finding) => (
                <li key={finding.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border p-4">
                  <div>
                    <p className="font-medium">{finding.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t('common.userPaired')}</p>
                  </div>
                  <Badge className={badgeClass(finding.status)}>
                    {t(`parity.status.${finding.status}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Table>
          <TableCaption>{t('parity.rawCaption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('parity.field')}</TableHead>
              <TableHead>{t('stores.googlePlay')}</TableHead>
              <TableHead>{t('stores.appStore')}</TableHead>
              <TableHead>{t('parity.match')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison.listingParity.rawFields.map((row) => (
              <TableRow key={row.field}>
                <TableCell className="font-medium">{t(`parity.fields.${row.field}`)}</TableCell>
                <TableCell className="max-w-80 whitespace-normal break-words">{value(row.googlePlay)}</TableCell>
                <TableCell className="max-w-80 whitespace-normal break-words">{value(row.appStore)}</TableCell>
                <TableCell>
                  <Badge className={badgeClass(row.matches === null ? 'notEvaluated' : row.matches ? 'passed' : 'finding')}>
                    {row.matches === null
                      ? t('parity.notCompared')
                      : row.matches
                        ? t('parity.matches')
                        : t('parity.differs')}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
