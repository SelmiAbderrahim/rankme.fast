import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  scheduledReportDeliveries,
  scheduledReportRuns,
  scheduledReports,
} from './schema/client-reports.js';

describe('client-reports schema', () => {
  it('cascades run and delivery rows from their scheduled report', () => {
    for (const table of [scheduledReportRuns, scheduledReportDeliveries]) {
      const [foreignKey] = getTableConfig(table).foreignKeys;
      expect(foreignKey).toBeDefined();
      const reference = foreignKey!.reference();
      expect(reference.columns.map((column) => column.name)).toEqual([
        'schedule_id',
      ]);
      expect(getTableConfig(reference.foreignTable).name).toBe(
        'scheduled_reports',
      );
      expect(reference.foreignColumns).toEqual([scheduledReports.id]);
      expect(foreignKey!.onDelete).toBe('cascade');
    }
  });
});
