import { createHash } from 'node:crypto';
import { translate } from '../i18n/index.js';
import type { ReportBlockV1, ReportLocale, ReportScalarValue, ReportSourceDate, } from './contracts.js';
import { stableReportJson } from './stable-json.js';
export interface ReportTableColumnInput {
    key: string;
    label: string;
    valueType: 'string' | 'number' | 'date' | 'url' | 'boolean';
    unit?: string;
}
export type ReportTableCellInput = string | number | boolean | Date | null | {
    unavailable: string;
};
export interface ReportTableRowInput {
    id?: string;
    values: readonly ReportTableCellInput[];
    sourceDateId?: string;
    /**
     * Optional per-cell provenance for mixed observation/estimate rows. When a
     * cell id is omitted, the row-level sourceDateId remains the fallback.
     */
    sourceDateIds?: readonly (string | undefined)[];
}
export function reportCopy(locale: ReportLocale, key: string, vars?: Record<string, string | number>): string {
    return translate(locale, `reportExports.core.${key}`, vars);
}
export function reportCatalogCopy(locale: ReportLocale, stem: string, field: 'title' | 'description' | 'bound'): string {
    return translate(locale, `reportExports.catalog.${stem}.${field}`);
}
export function reportIsoDateTime(value: string | Date): string {
    if (value instanceof Date)
        return value.toISOString();
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
        return `${value}T00:00:00.000Z`;
    }
    return new Date(value).toISOString();
}
export function reportWindow(asOf: string, days: number): {
    from: string;
    to: string;
} {
    const to = new Date(reportIsoDateTime(asOf));
    const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
}
export function reportSourceVersion(kind: string, value: unknown): string {
    const digest = createHash('sha256').update(stableReportJson(value)).digest('hex');
    return `${kind}:${digest}`;
}
export function reportSourceDate(input: {
    id: string;
    label: string;
    kind: ReportSourceDate['kind'];
    observedAt?: string | Date;
    from?: string | Date;
    to?: string | Date;
    sourceNoteKey: string;
    lagDays?: number;
    freshness?: ReportSourceDate['freshness'];
    cachedAt?: string | Date;
}): ReportSourceDate {
    return {
        id: input.id,
        label: input.label,
        kind: input.kind,
        ...(input.observedAt
            ? { observedAt: reportIsoDateTime(input.observedAt) }
            : {
                from: reportIsoDateTime(input.from as string | Date),
                to: reportIsoDateTime(input.to as string | Date),
            }),
        sourceNoteKey: input.sourceNoteKey,
        ...(input.lagDays === undefined ? {} : { lagDays: input.lagDays }),
        ...(input.freshness ? { freshness: input.freshness } : {}),
        ...(input.cachedAt ? { cachedAt: reportIsoDateTime(input.cachedAt) } : {}),
    };
}
export function reportScalar(value: ReportTableCellInput, valueType: ReportTableColumnInput['valueType']): ReportScalarValue {
    if (value === null)
        return { type: 'null', value: null };
    if (typeof value === 'object' && 'unavailable' in value) {
        return { type: 'unavailable', value: null, reason: value.unavailable };
    }
    if (value instanceof Date)
        return { type: 'date', value: value.toISOString() };
    if (valueType === 'date')
        return { type: 'date', value: reportIsoDateTime(String(value)) };
    if (valueType === 'url')
        return { type: 'url', value: String(value) };
    if (typeof value === 'number')
        return { type: 'number', value };
    if (typeof value === 'boolean')
        return { type: 'boolean', value };
    return { type: 'string', value: String(value) };
}
export function reportTable(input: {
    id: string;
    columns: readonly ReportTableColumnInput[];
    rows: readonly ReportTableRowInput[];
}): Extract<ReportBlockV1, {
    type: 'table';
}> {
    return {
        type: 'table',
        id: input.id,
        columns: input.columns.map((column) => ({ ...column })),
        rows: input.rows.map((row) => ({
            ...(row.id ? { id: row.id } : {}),
            cells: input.columns.map((column, index) => {
                const sourceDateId = row.sourceDateIds?.[index] ?? row.sourceDateId;
                return {
                    columnKey: column.key,
                    value: reportScalar(row.values[index] ?? null, column.valueType),
                    ...(sourceDateId ? { sourceDateId } : {}),
                };
            }),
        })),
    };
}
export function reportSourceNote(input: {
    id: string;
    sourceDateId: string;
    methodology: string;
    coverageWarning?: string;
}): Extract<ReportBlockV1, {
    type: 'source_note';
}> {
    return {
        type: 'source_note',
        id: input.id,
        sourceDateId: input.sourceDateId,
        methodology: input.methodology,
        ...(input.coverageWarning ? { coverageWarning: input.coverageWarning } : {}),
    };
}
export function stableSortText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
