/**
 * Shared research-history table (presentational).
 *
 * Consumed by BOTH the standalone `KeywordResearchHistoryPage`
 * (testIdPrefix "keyword-research-history", "Search again" navigates) and the
 * embedded "Recent research" section in `KeywordResearchPanel`
 * (testIdPrefix "keyword-research-recent", "Search again" runs the lookup in
 * place). The action differs per consumer, so it is injected via `onSearchAgain`.
 *
 * data-testid contract (parameterised by `testIdPrefix`):
 *   - <prefix>-table                results table
 *   - <prefix>-row-<id>             one per history entry
 *   - <prefix>-search-again-<id>    re-run action per row
 */
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { formatCountryFromLocation, languageName } from '@shared/markets';
import type { ResearchHistoryItem, ResearchHistoryKind } from '../types';

const KIND_TONE: Record<ResearchHistoryKind, StatusTone> = {
  metrics: 'primary',
  related: 'info',
  intent: 'warning',
  ideas: 'success',
  long_tail: 'success',
  // The server has written these kinds; labelling
  // them here fixes the latent raw-key defect in the history table.
  gap: 'info',
  overview: 'primary',
  trends: 'success',
  clusters: 'warning',
};

export function locationLabel(
  code: number,
  t: (k: string) => string,
  locale = 'en',
): string {
  return formatCountryFromLocation(code, locale, t('common:market.unknownCountry'));
}

export function languageLabel(
  code: string,
  t: (k: string) => string,
  locale = 'en',
): string {
  return languageName(code, locale) ?? t('common:market.unknownLanguage');
}

interface ResearchHistoryTableProps {
  items: ResearchHistoryItem[];
  onSearchAgain: (item: ResearchHistoryItem) => void;
  testIdPrefix: string;
}

export const ResearchHistoryTable = ({
  items,
  onSearchAgain,
  testIdPrefix,
}: ResearchHistoryTableProps) => {
  const { t, i18n } = useTranslation();

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  return (
    <Card data-testid={`${testIdPrefix}-table`}>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <TableHeaderHelp
                  label={t('keywordResearch:history.columnKind')}
                  description={t('common:tableHelp.kind')}
                />
              </TableHead>
              <TableHead>{t('keywordResearch:history.columnQuery')}</TableHead>
              <TableHead>{t('keywordResearch:history.columnLocation')}</TableHead>
              <TableHead>{t('keywordResearch:history.columnLanguage')}</TableHead>
              <TableHead className="text-end">
                <TableHeaderHelp
                  label={t('keywordResearch:history.columnResults')}
                  description={t('common:tableHelp.results')}
                />
              </TableHead>
              <TableHead>
                <TableHeaderHelp
                  label={t('keywordResearch:history.columnSource')}
                  description={t('common:tableHelp.dataSource')}
                />
              </TableHead>
              <TableHead>{t('keywordResearch:history.columnDate')}</TableHead>
              <TableHead className="text-end">
                {t('keywordResearch:history.columnActions')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} data-testid={`${testIdPrefix}-row-${item.id}`}>
                <TableCell>
                  <StatusChip tone={KIND_TONE[item.kind]}>
                    {t(`keywordResearch:history.kind.${item.kind}`)}
                  </StatusChip>
                </TableCell>
                <TableCell className="max-w-64 truncate" title={item.phrases.join(', ')}>
                  {item.phrases.join(', ')}
                </TableCell>
                <TableCell>{locationLabel(item.locationCode, t, i18n.language)}</TableCell>
                <TableCell>{languageLabel(item.languageCode, t, i18n.language)}</TableCell>
                <TableCell className="text-end tabular-nums">{item.resultCount}</TableCell>
                <TableCell>
                  <StatusChip tone={item.cached ? 'muted' : 'success'}>
                    {item.cached
                      ? t('keywordResearch:history.cached')
                      : t('keywordResearch:history.fresh')}
                  </StatusChip>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(item.createdAt)}
                </TableCell>
                <TableCell className="text-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSearchAgain(item)}
                    data-testid={`${testIdPrefix}-search-again-${item.id}`}
                  >
                    <RotateCcw className="me-1 h-3 w-3" aria-hidden="true" />
                    {t('keywordResearch:history.searchAgain')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
