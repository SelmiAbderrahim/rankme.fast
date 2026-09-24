/**
 * Client-side CSV serializer — the browser mirror of
 * `server/src/shared/utils/csv.ts`.
 *
 * Some exports are produced in the browser from data the client already
 * holds (the Review Intelligence inventory export) rather than
 * streamed from an API route. Those rows still carry untrusted vendor text,
 * so they get the SAME formula-injection neutralization and the same
 * RFC-4180 quoting rules as a server-generated file — one behavior, two
 * runtimes, asserted by tests on both sides.
 *
 * - Quotes any field containing `"`, `,`, CR or LF; doubles embedded quotes.
 * - CRLF row endings (including a trailing CRLF).
 * - Prepends a UTF-8 BOM so Excel opens 7-locale text in the right encoding.
 * - `Date` values serialize as ISO-8601 UTC; `bigint` as a plain digit string.
 * - Formula-injection neutralization: any cell whose text starts with `\t` or
 *   `\r`, OR whose first non-whitespace character is `= + - @`, is prefixed
 *   with a single quote BEFORE quoting so Excel/Sheets treats it as text.
 *
 * `columns[].header` values are canonical English field labels — they are
 * DATA (column keys in the exported file), not user-facing UI copy, so they
 * are not routed through i18n. The localized copy lives on the export button.
 */
export interface CsvColumn {
  key: string;
  header: string;
}

const BOM = '﻿';

export function neutralizeExportCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === 'bigint') {
    text = value.toString();
  } else {
    text = String(value);
  }
  return /^[\t\r]/.test(text) || /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

function serializeCell(value: unknown): string {
  const text = neutralizeExportCell(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn[]): string {
  const headerLine = columns.map((column) => serializeCell(column.header)).join(',');
  const bodyLines = rows.map((row) =>
    columns
      .map((column) => serializeCell((row as Record<string, unknown>)[column.key]))
      .join(','),
  );
  return `${BOM}${[headerLine, ...bodyLines].join('\r\n')}\r\n`;
}
