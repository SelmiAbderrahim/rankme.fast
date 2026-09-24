import { toCsv, type CsvColumn } from '@shared/security';
import type { BrandRadarMentionRow, BrandRadarScanDetail } from './types';

/**
 * Brand Radar mention export.
 *
 * A FREE stored-data read: the rows are already in the browser because the
 * mention inventory (`GET /scans/:id/mentions`) served them, so the
 * export spends no unit, calls no vendor, and hits no server route. Every
 * string cell goes through `neutralizeExportCell` inside `toCsv` before it
 * reaches the file, so a vendor-supplied `=SUM(...)`, a CRLF payload, a
 * `<script>` payload, and an RTL-override payload all land as inert text.
 *
 * Headers are canonical English field labels — they are DATA (column keys in
 * the exported file), not UI copy, so they are not routed through i18n. The
 * localized copy lives on the export button and its free-of-charge note.
 */
export const BRAND_RADAR_MENTION_CSV_COLUMNS: readonly CsvColumn[] = [
  { key: 'scanId', header: 'scan_id' },
  { key: 'capturedAt', header: 'captured_at' },
  { key: 'brandQuery', header: 'brand_query' },
  { key: 'mentionUrl', header: 'mention_url' },
  { key: 'domain', header: 'domain' },
  { key: 'title', header: 'title' },
  { key: 'snippet', header: 'snippet' },
  { key: 'sentiment', header: 'sentiment' },
  { key: 'observedAt', header: 'observed_at' },
];

/** Scan fields the export stamps onto every row. */
export type BrandRadarCsvScan = Pick<
  BrandRadarScanDetail,
  'id' | 'brandQuery' | 'createdAt' | 'terminalAt'
>;

/** `terminalAt ?? createdAt`, normalized to ISO-8601 UTC. */
export function brandRadarCapturedAt(scan: BrandRadarCsvScan): string {
  return new Date(scan.terminalAt ?? scan.createdAt).toISOString();
}

export function buildBrandRadarMentionCsv(
  scan: BrandRadarCsvScan,
  rows: readonly BrandRadarMentionRow[],
): string {
  const capturedAt = brandRadarCapturedAt(scan);
  return toCsv(
    rows.map((row) => ({
      scanId: scan.id,
      capturedAt,
      brandQuery: scan.brandQuery,
      // A row the server refused to serve as http(s) exports as an empty cell
      // rather than as a string a spreadsheet could turn back into a link.
      mentionUrl: row.url ?? '',
      domain: row.domain,
      title: row.title,
      snippet: row.snippet,
      sentiment: row.polarity,
      observedAt: row.observedAt ?? '',
    })),
    BRAND_RADAR_MENTION_CSV_COLUMNS,
  );
}

export function brandRadarCsvFilename(scan: BrandRadarCsvScan): string {
  return `brand-radar-mentions-${scan.id}.csv`;
}

/**
 * Trigger a browser download for an already-serialized CSV string. Guarded so
 * a runtime without `URL.createObjectURL` (jsdom, SSR) is a no-op returning
 * `false` rather than a thrown error inside a click handler.
 */
export function downloadBrandRadarCsv(filename: string, contents: string): boolean {
  if (typeof URL.createObjectURL !== 'function' || typeof document === 'undefined') {
    return false;
  }
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
