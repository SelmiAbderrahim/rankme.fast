import { useTranslation } from 'react-i18next';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security';
import { Badge } from '@shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type { CannibalizationCandidate } from '../types';

interface QueryDrillDownProps {
  candidate: CannibalizationCandidate;
}

/**
 * One candidate's stored Search Console rows. Query text and page URLs are
 * rendered as React text nodes; the page link is passed through
 * `safeExternalHref` so a `javascript:` URL in a crawled row stays inert.
 */
export const QueryDrillDown = ({ candidate }: QueryDrillDownProps) => {
  const { t, i18n } = useTranslation('cannibalization');
  const percent = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(value);
  return (
    <Card data-testid="cannibalization-drilldown">
      <CardHeader>
        <CardTitle data-testid="cannibalization-drilldown-query">{candidate.query}</CardTitle>
        <CardDescription>
          {t('drilldown.provenance', {
            days: candidate.windowDays,
            date: candidate.snapshotDate,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm" data-testid="cannibalization-drilldown-recommendation">
          {t('drilldown.recommendation', { url: candidate.primaryUrl })}{' '}
          <span className="text-muted-foreground">
            {t(`drilldown.reason.${candidate.primaryReason}`)}
          </span>
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('drilldown.page')}</TableHead>
              <TableHead className="text-end">
                <TableHeaderHelp
                  label={t('drilldown.clicks')}
                  description={t('common:tableHelp.clicks')}
                />
              </TableHead>
              <TableHead className="text-end">
                <TableHeaderHelp
                  label={t('drilldown.impressions')}
                  description={t('common:tableHelp.impressions')}
                />
              </TableHead>
              <TableHead className="text-end">
                <TableHeaderHelp
                  label={t('drilldown.position')}
                  description={t('common:tableHelp.averagePosition')}
                />
              </TableHead>
              <TableHead className="text-end">
                <TableHeaderHelp
                  label={t('drilldown.clickShare')}
                  description={t('common:tableHelp.clickShare')}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidate.pages.map((page) => (
              <TableRow key={page.url} data-testid="cannibalization-drilldown-row">
                <TableCell className="flex flex-wrap items-center gap-2">
                  {/* eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL contains noopener and noreferrer. */}
                  <a href={safeExternalHref(page.url)} rel={SAFE_EXTERNAL_REL} target="_blank">
                    {page.url}
                  </a>
                  {page.isPrimary ? (
                    <Badge data-testid="cannibalization-primary-badge">
                      {t('drilldown.primary')}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-end">{page.clicks}</TableCell>
                <TableCell className="text-end">{page.impressions}</TableCell>
                <TableCell className="text-end">{page.position.toFixed(1)}</TableCell>
                <TableCell className="text-end">{percent(page.clickShare)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
