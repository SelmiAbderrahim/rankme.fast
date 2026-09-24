import { useTranslation } from 'react-i18next';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type { CannibalizationCandidate } from '../types';

interface CandidateTableProps {
  candidates: CannibalizationCandidate[];
  activeCandidateId: string | null;
  onOpen: (candidateId: string) => void;
}

/**
 * Candidate rows. The word rendered per row is always the localized
 * "candidate" plus a confidence grade — never a confirmed-loss claim.
 */
export const CandidateTable = ({ candidates, activeCandidateId, onOpen }: CandidateTableProps) => {
  const { t } = useTranslation('cannibalization');
  return (
    <Table data-testid="cannibalization-candidates">
      <TableHeader>
        <TableRow>
          <TableHead>{t('candidates.query')}</TableHead>
          <TableHead className="text-end">{t('candidates.pages')}</TableHead>
          <TableHead>{t('candidates.confidence')}</TableHead>
          <TableHead>{t('candidates.primary')}</TableHead>
          <TableHead className="text-end">
            <TableHeaderHelp
              label={t('candidates.clicks')}
              description={t('common:tableHelp.clicks')}
            />
          </TableHead>
          <TableHead className="text-end">{t('candidates.inspect')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {candidates.map((candidate) => (
          <TableRow
            key={candidate.id}
            data-testid={`cannibalization-candidate-${candidate.id}`}
            data-active={candidate.id === activeCandidateId ? 'true' : 'false'}
          >
            <TableCell>
              <span className="font-medium">{candidate.query}</span>
              <span className="text-muted-foreground block text-xs">{t('candidates.label')}</span>
            </TableCell>
            <TableCell className="text-end">{candidate.pages.length}</TableCell>
            <TableCell>
              <Badge variant="outline" data-testid={`cannibalization-confidence-${candidate.id}`}>
                {t(`candidates.confidenceValue.${candidate.confidence}`)}
              </Badge>
            </TableCell>
            <TableCell data-testid={`cannibalization-primary-${candidate.id}`}>
              {candidate.primaryUrl}
            </TableCell>
            <TableCell className="text-end">{candidate.totalClicks}</TableCell>
            <TableCell className="text-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpen(candidate.id)}
                data-testid={`cannibalization-inspect-${candidate.id}`}
              >
                {t('candidates.inspect')}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
