/**
 * RFC-4180 CSV serializer for server-generated exports (superadmin).
 *
 * - Quotes any field containing `"`, `,`, CR or LF; doubles embedded quotes.
 * - CRLF row endings (including a trailing CRLF).
 * - Prepends a UTF-8 BOM so Excel opens 7-locale text in the right encoding.
 * - `Date` values serialize as ISO-8601 UTC; `bigint` as a plain digit string.
 * - Formula-injection neutralization: any cell whose text starts with
 *   `\t` or `\r`, OR whose first non-whitespace character is `= + - @`, is
 *   prefixed with a single-quote (`'`) BEFORE RFC-4180 quoting so Excel/Sheets
 *   treats the cell as text, not a formula. The leading-whitespace check
 *   defeats the ` =SUM(...)` variant that older neutralizers missed. This is
 *   the OWASP-recommended tradeoff — a negative number like `-5` renders as
 *   `'-5` in the exported cell (visually intact after re-import as a string).
 *
 * `columns[].header` values are canonical English field labels — they are DATA
 * (column keys in the exported file), NOT user-facing UI copy, so they are not
 * routed through i18n. The localized strings live around the export button in
 * the client (superadmin.json).
 */
export interface CsvColumn {
    key: string;
    header: string;
}
const BOM = '﻿';
export function neutralizeExportCell(value: unknown): string {
    if (value === null || value === undefined)
        return '';
    let text: string;
    if (value instanceof Date) {
        text = value.toISOString();
    }
    else if (typeof value === 'bigint') {
        text = value.toString();
    }
    else {
        text = String(value);
    }
    // Formula-injection neutralization (OWASP): CSV cells starting with
    // \t or \r, or whose first non-whitespace character is = + - @, execute
    // as formulas in Excel/Sheets. Prefix with `'` to force text
    // interpretation. Applied BEFORE quoting so a cell like `=a,b` still
    // round-trips as `"'=a,b"`. The leading-whitespace check defeats the
    // ` =SUM(A1)` variant that a strict-start-of-string check misses.
    return /^[\t\r]/.test(text) || /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}
function serializeCell(value: unknown): string {
    const text = neutralizeExportCell(value);
    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}
export function toCsv<T>(rows: readonly T[], columns: CsvColumn[]): string {
    const headerLine = columns.map((column) => serializeCell(column.header)).join(',');
    const bodyLines = rows.map((row) => columns
        .map((column) => serializeCell((row as Record<string, unknown>)[column.key]))
        .join(','));
    return `${BOM}${[headerLine, ...bodyLines].join('\r\n')}\r\n`;
}
