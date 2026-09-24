import { logger } from '../../config/logger.js';
import { cleanupReportExports } from './report-exports.service.js';
export const REPORT_EXPORT_RETENTION_QUEUE = 'report-export-retention';
export const REPORT_EXPORT_RETENTION_JOB = 'sweep';
export const REPORT_EXPORT_RETENTION_SCHEDULER_KEY = 'report-export-retention-sweep';
export const REPORT_EXPORT_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Daily processor for expired, denied, and manually deleted export records. */
export function createReportExportRetentionProcessor() {
    return async (): Promise<{
        purgedSnapshots: number;
    }> => {
        const purgedSnapshots = await cleanupReportExports();
        logger.info({ event: 'report_export.retention', purgedSnapshots }, 'report export retention sweep completed');
        return { purgedSnapshots };
    };
}
