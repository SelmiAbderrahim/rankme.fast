/**
 * Shared research-history table (presentational).
 *
 * Consumed by BOTH the standalone `KeywordResearchHistoryPage`
 * (testIdPrefix "keyword-research-history", "Search again" navigates) and the
 * embedded "Recent research" section in `KeywordResearchPanel`
 * (testIdPrefix "keyword-research-recent", "Search again" runs the lookup in
 * place). The actions differ per consumer, so they are injected.
 *
 * One row per LOOKUP, not per server record: a Research press logs a metrics
 * record and an intent record, and `groupResearchHistory` folds them (shared
 * `lookupId`, or the documented legacy rule) so the row carries both kind
 * badges. The row id is the group's primary record id.
 *
 * Two actions per row:
 *   - "View results" opens the saved results without calling the data
 *     provider (only for kinds whose results are stored: metrics / intent /
 *     related / ideas / long-tail);
 *   - "Search again" runs the lookup again with the data provider.
 *
 * data-testid contract (parameterised by `testIdPrefix`):
 *   - <prefix>-table                results table
 *   - <prefix>-row-<id>             one per lookup (id = group primary record)
 *   - <prefix>-view-<id>            saved-results action per row
 *   - <prefix>-search-again-<id>    re-run action per row
 *   - <prefix>-card-<id>            phone card per lookup, with
 *                                   <prefix>-card-view-<id> / -card-search-again-<id>
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, RotateCcw } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { RecordCard, RecordCardList } from '@shared/components/RecordCard';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { Bdi } from '@shared/components/Bdi';
import { isolateText } from '@shared/lib/bidi';
import { formatCountryFromLocation, languageName } from '@shared/markets';
import { canViewStoredResult, groupResearchHistory, type ResearchHistoryGroup } from '../historyGroups';
import type { ResearchHistoryItem, ResearchHistoryKind } from '../types';

// A kind is a category, not a health status: none of these may use the
// warning/destructive/success tones, which would read as "something is wrong"
// (or "all good") next to the real status chips.
const KIND_TONE: Record<ResearchHistoryKind, StatusTone> = {
  metrics: 'primary',
  related: 'info',
  intent: 'info',
  ideas: 'muted',
  long_tail: 'muted',
  // The server has written these kinds; labelling
  // them here fixes the latent raw-key defect in the history table.
  gap: 'info',
  overview: 'primary',
  trends: 'muted',
  clusters: 'info',
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
  /** Re-run; receives the group's primary record. */
  onSearchAgain: (item: ResearchHistoryItem) => void;
  /** Saved-results view; receives the group's primary record. */
  onViewResults: (item: ResearchHistoryItem) => void;
  testIdPrefix: string;
}

export const ResearchHistoryTable = ({
  items,
  onSearchAgain,
  onViewResults,
  testIdPrefix,
}: ResearchHistoryTableProps) => {
  const { t, i18n } = useTranslation();
  const groups = useMemo(() => groupResearchHistory(items), [items]);

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  const kindChips = (group: ResearchHistoryGroup) =>
    group.kinds.map((kind) => (
      <StatusChip key={kind} tone={KIND_TONE[kind]}>
        {t(`keywordResearch:history.kind.${kind}`)}
      </StatusChip>
    ));

  const sourceChip = (group: ResearchHistoryGroup) => (
    <StatusChip tone={group.cached ? 'muted' : 'success'}>
      {group.cached ? t('keywordResearch:history.cached') : t('keywordResearch:history.fresh')}
    </StatusChip>
  );

  /** The two row actions; the phone-card copies use their own test ids. */
  const actions = (group: ResearchHistoryGroup, query: string, prefix: string) => (
    <>
      {canViewStoredResult(group) ? (
        <Button
          size="sm"
          variant="outline"
          className="h-auto min-h-8 whitespace-normal py-1 text-start"
          onClick={() => onViewResults(group.primary)}
          aria-label={t('keywordResearch:history.viewResultsFor', { query: isolateText(query) })}
          aria-describedby={`${testIdPrefix}-hint-view`}
          data-testid={`${prefix}-view-${group.id}`}
        >
          <Eye className="me-1 h-3 w-3 shrink-0" aria-hidden="true" />
          {t('keywordResearch:history.viewResults')}
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="h-auto min-h-8 whitespace-normal py-1 text-start"
        onClick={() => onSearchAgain(group.primary)}
        aria-label={t('keywordResearch:history.searchAgainFor', { query: isolateText(query) })}
        aria-describedby={`${testIdPrefix}-search-again-hint`}
        data-testid={`${prefix}-search-again-${group.id}`}
      >
        <RotateCcw className="me-1 h-3 w-3 shrink-0" aria-hidden="true" />
        {t('keywordResearch:history.searchAgain')}
      </Button>
    </>
  );

  return (
    <Card className="@container" data-testid={`${testIdPrefix}-table`}>
      <CardContent className="p-0">
        <div className="text-muted-foreground flex flex-col gap-0.5 border-b px-4 py-2 text-xs">
          <p id={`${testIdPrefix}-hint-view`} data-testid={`${testIdPrefix}-hint-view`}>
            {t('keywordResearch:history.viewResultsHint')}
          </p>
          <p
            id={`${testIdPrefix}-search-again-hint`}
            data-testid={`${testIdPrefix}-search-again-hint`}
          >
            {t('keywordResearch:history.searchAgainHint')}
          </p>
        </div>
        {/* One card per lookup until the card is wide enough for the table. */}
        <div className="hidden @4xl:block">
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
              {groups.map((group) => {
                const query = group.phrases.join(', ');
                return (
                  <TableRow key={group.id} data-testid={`${testIdPrefix}-row-${group.id}`}>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">{kindChips(group)}</span>
                    </TableCell>
                    {/* Cells wrap instead of forcing one long line, so the Date
                        and Actions columns stay inside the card at laptop widths. */}
                    <TableCell className="whitespace-normal" title={isolateText(query)}>
                      <span
                        className="line-clamp-2 min-w-28 max-w-64 break-words"
                        data-testid={`${testIdPrefix}-query-${group.id}`}
                      >
                        <Bdi className="block text-balance">{query}</Bdi>
                      </span>
                    </TableCell>
                    <TableCell className="min-w-32 whitespace-normal">
                      {locationLabel(group.locationCode, t, i18n.language)}
                    </TableCell>
                    <TableCell className="min-w-24 whitespace-normal">
                      {languageLabel(group.languageCode, t, i18n.language)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{group.resultCount}</TableCell>
                    <TableCell>{sourceChip(group)}</TableCell>
                    <TableCell
                      className="text-muted-foreground min-w-44 whitespace-normal text-sm"
                      data-testid={`${testIdPrefix}-date-${group.id}`}
                    >
                      {formatDate(group.createdAt)}
                    </TableCell>
                    <TableCell className="text-end">
                      <span className="flex flex-wrap justify-end gap-2">
                        {actions(group, query, testIdPrefix)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <RecordCardList hideAt="4xl" className="p-3" aria-label={t('keywordResearch:history.title')}>
          {groups.map((group) => {
            const query = group.phrases.join(', ');
            return (
              <RecordCard
                key={group.id}
                data-testid={`${testIdPrefix}-card-${group.id}`}
                title={query}
                badges={
                  <>
                    {kindChips(group)}
                    {sourceChip(group)}
                  </>
                }
                fields={[
                  {
                    label: t('keywordResearch:history.columnLocation'),
                    value: locationLabel(group.locationCode, t, i18n.language),
                  },
                  {
                    label: t('keywordResearch:history.columnLanguage'),
                    value: languageLabel(group.languageCode, t, i18n.language),
                  },
                  {
                    label: t('keywordResearch:history.columnResults'),
                    value: <span className="tabular-nums">{group.resultCount}</span>,
                  },
                  {
                    label: t('keywordResearch:history.columnDate'),
                    value: formatDate(group.createdAt),
                  },
                ]}
              >
                <div className="flex flex-wrap gap-2">
                  {actions(group, query, `${testIdPrefix}-card`)}
                </div>
              </RecordCard>
            );
          })}
        </RecordCardList>
      </CardContent>
    </Card>
  );
};
