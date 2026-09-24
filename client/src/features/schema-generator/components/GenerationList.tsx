import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import { StatusChip } from '@shared/ui/status-chip';
import type { GenerationSummary } from '../types';

interface GenerationListProps {
  generations: GenerationSummary[];
  onOpen: (generationId: string) => void;
}

/** Stored generations. Re-opening one is free — it reads what you already paid for. */
export const GenerationList = ({ generations, onOpen }: GenerationListProps) => {
  const { t } = useTranslation('schemaGenerator');
  return (
    <div className="flex flex-col gap-2" data-testid="schema-generation-list">
      <p className="text-muted-foreground text-sm">{t('list.free')}</p>
      <div className="overflow-x-auto">
        <Table>
          <caption className="sr-only">{t('list.caption')}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('list.page')}</TableHead>
              <TableHead>{t('list.type')}</TableHead>
              <TableHead>{t('list.status')}</TableHead>
              <TableHead>{t('list.generatedAt')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {generations.map((row) => (
              <TableRow key={row.id} data-testid={`schema-generation-${row.id}`}>
                <TableCell className="font-mono text-xs break-all" dir="ltr">{row.pageUrl}</TableCell>
                <TableCell dir="ltr">{row.schemaType}</TableCell>
                <TableCell>
                  {row.status === 'failed' ? (
                    <StatusChip tone="destructive">{t('list.statusFailed')}</StatusChip>
                  ) : row.conformanceStatus === 'conforms' ? (
                    <StatusChip tone="success">{t('list.statusConforms')}</StatusChip>
                  ) : (
                    <StatusChip tone="warning">{t('list.statusGaps')}</StatusChip>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs" dir="ltr">
                  {row.generatedAt.slice(0, 10)}
                </TableCell>
                <TableCell className="text-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpen(row.id)}
                    data-testid={`schema-open-${row.id}`}
                  >
                    {t('list.reopen')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
