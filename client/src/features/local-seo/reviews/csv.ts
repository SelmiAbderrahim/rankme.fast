import { toCsv, type CsvColumn } from '@shared/security/csv';
import type { ReviewRow } from './types';

/**
 * Review inventory export.
 *
 * The production button downloads the server's unpaginated `/export.csv`
 * response. This serializer intentionally mirrors the server columns for
 * hostile-content unit tests and offline callers; every cell still travels
 * through the shared `neutralizeExportCell` path inside `toCsv`.
 *
 * Headers are canonical English field labels — they are data (column keys in
 * the exported file), not UI copy, so they are not routed through i18n.
 */
export const REVIEW_CSV_COLUMNS: readonly CsvColumn[] = [
  { key: 'rating', header: 'rating' },
  { key: 'reviewedAt', header: 'reviewed_at' },
  { key: 'source', header: 'source' },
  { key: 'title', header: 'title' },
  { key: 'text', header: 'text' },
  { key: 'authorDisplayName', header: 'author' },
];

export function buildReviewCsv(rows: readonly ReviewRow[]): string {
  return toCsv(
    rows.map((row) => ({
      rating: row.rating ?? '',
      reviewedAt: row.reviewedAt ?? '',
      source: row.source,
      title: row.title ?? '',
      text: row.text,
      authorDisplayName: row.authorDisplayName ?? '',
    })),
    REVIEW_CSV_COLUMNS,
  );
}

/**
 * Trigger a browser download for an already-serialized CSV string. Guarded so
 * a runtime without `URL.createObjectURL` (jsdom, SSR) is a no-op returning
 * `false` rather than a thrown error inside a click handler.
 */
export function downloadCsv(filename: string, contents: string): boolean {
  if (typeof URL.createObjectURL !== 'function' || typeof document === 'undefined') return false;
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
