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
import type { CannibalizationReportSummary } from '../types';

interface ReportListTableProps {
  reports: CannibalizationReportSummary[];
  activeReportId: string | null;
  onOpen: (reportId: string) => void;
}

export const ReportListTable = ({
  reports,
  activeReportId,
  onOpen,
}: ReportListTableProps) => {
  const { t, i18n } = useTranslation('cannibalization');
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
      new Date(iso),
    );
  return (
    <Table data-testid="cannibalization-report-list">
      <TableHeader>
        <TableRow>
          <TableHead>{t('list.generatedAt')}</TableHead>
          <TableHead>{t('list.window')}</TableHead>
          <TableHead>{t('list.lastSync')}</TableHead>
          <TableHead className="text-end">{t('list.candidates')}</TableHead>
          <TableHead className="text-end">{t('list.open')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reports.map((report) => (
          <TableRow
            key={report.id}
            data-testid={`cannibalization-report-row-${report.id}`}
            data-active={report.id === activeReportId ? 'true' : 'false'}
          >
            <TableCell>{formatDate(report.generatedAt)}</TableCell>
            <TableCell>{t('list.windowValue', { days: report.windowDays })}</TableCell>
            <TableCell>{report.snapshotDate}</TableCell>
            <TableCell className="text-end">{report.candidateCount}</TableCell>
            <TableCell className="text-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpen(report.id)}
                data-testid={`cannibalization-open-${report.id}`}
              >
                {t('list.open')}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
