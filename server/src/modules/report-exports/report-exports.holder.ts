import { createReportExportAdapterRegistry, type ReportExportAdapterRegistry, } from './report-exports.registry.js';
import type { ApplicationDb } from '../../shared/types/application-db.js';
let registry: ReportExportAdapterRegistry | null = null;
let reportExportsDb: ApplicationDb | null = null;
export function getReportExportAdapterRegistry(): ReportExportAdapterRegistry {
    registry ??= createReportExportAdapterRegistry();
    return registry;
}
export function setReportExportAdapterRegistry(next: ReportExportAdapterRegistry | null): void {
    registry = next;
}
export function getReportExportsDb(): ApplicationDb {
    if (!reportExportsDb) {
        throw new Error('report exports db not configured');
    }
    return reportExportsDb;
}
export function setReportExportsDb(next: ApplicationDb | null): void {
    reportExportsDb = next;
}
