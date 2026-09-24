import { logger } from '../../config/logger.js';
import { REPORT_CATALOG, REPORT_FORMATS, type ReportFormat, } from '../../shared/report-exports/index.js';
export const REPORT_EXPORT_OUTCOME_STATUSES = [
    'created',
    'rendered',
    'downloaded',
    'shared',
    'accessed',
    'revoked',
    'refused',
] as const;
export type ReportExportOutcomeStatus = (typeof REPORT_EXPORT_OUTCOME_STATUSES)[number];
export type ReportExportOutcomeKind = (typeof REPORT_CATALOG)[number]['kind'] | 'unknown';
export type ReportExportOutcomeFormat = ReportFormat | 'view' | 'unknown';
export interface ReportExportOutcome {
    kind: string;
    format: string;
    status: ReportExportOutcomeStatus;
}
const reportKinds = new Set<string>(REPORT_CATALOG.map(({ kind }) => kind));
const reportFormats = new Set<string>([...REPORT_FORMATS, 'view']);
export function reportExportOutcomeFields(outcome: ReportExportOutcome): {
    kind: ReportExportOutcomeKind;
    format: ReportExportOutcomeFormat;
    status: ReportExportOutcomeStatus;
} {
    return {
        kind: reportKinds.has(outcome.kind)
            ? (outcome.kind as ReportExportOutcomeKind)
            : 'unknown',
        format: reportFormats.has(outcome.format)
            ? (outcome.format as ReportExportOutcomeFormat)
            : 'unknown',
        status: outcome.status,
    };
}
/**
 * Low-cardinality export metric event. Keep the dimensions limited to the
 * catalog kind, supported format, and bounded outcome status.
 */
export function observeReportExportOutcome(outcome: ReportExportOutcome): void {
    logger.info({
        event: 'report_export.outcome',
        ...reportExportOutcomeFields(outcome),
    }, 'report export outcome');
}
