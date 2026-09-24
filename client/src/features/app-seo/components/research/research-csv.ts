import { toCsv, type CsvColumn } from '@shared/security';

export function buildResearchCsv<T>(rows: readonly T[], columns: readonly CsvColumn[]): string {
  // `toCsv` routes every header and data cell through neutralizeExportCell.
  return toCsv(rows, columns);
}

export function downloadResearchCsv(filename: string, contents: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}
