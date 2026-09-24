import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { stableReportJson } from '../../shared/report-exports/index.js';
import { assertSiteResourceTarget, createStoredReportAdapter, storedRecord, type LoadedStoredReport, type ReportExportAccessContext, } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { getGeogridScan } from './geogrid.service.js';
const selectionSchema = z.object({
    state: z.array(z.enum(['observed', 'not_in_pack', 'failed'])).max(3).optional(),
}).strict();
type Selection = z.infer<typeof selectionSchema>;
type GeogridExportContext = Pick<ReportExportAccessContext, 'accountId' | 'target'>;
async function base(db: Db, context: GeogridExportContext) {
    assertSiteResourceTarget(context.target);
    return getGeogridScan(context.accountId, context.target.siteId, context.target.resourceId, { db });
}
export function createGeogridReportExportAdapter(db: Db) {
    return createStoredReportAdapter<Selection>({
        kind: 'local.geogrid_scan', localizationStem: 'localGeogridScan', formats: ['pdf', 'csv', 'json'], selectionSchema,
        access: (context) => base(db, context),
        async load(context): Promise<LoadedStoredReport> {
            const scan = await base(db, context);
            assertSiteResourceTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const cells = scan.cells.filter((cell) => !context.selection.state || context.selection.state.includes(cell.state));
            const observedAt = cells.flatMap((cell) => 'capturedAt' in cell ? [cell.capturedAt] : []).sort().at(-1) ?? scan.finishedAt ?? scan.createdAt;
            return {
                siteLabel: site.displayName || site.domain, observedAt, sourceVersionValue: scan,
                records: cells.map((cell) => storedRecord('grid-cell', String(cell.pointIndex), stableReportJson({
                    ...cell,
                    positionMeaning: cell.state === 'not_in_pack' ? 'observed-not-ranked-in-pack' : cell.state === 'failed' ? 'observation-failed' : 'observed-rank',
                    grid: { centerLat: scan.centerLat, centerLng: scan.centerLng, spacingMeters: scan.spacingMeters, gridSize: scan.gridSize, zoom: scan.zoom },
                    keywordId: scan.keywordId,
                }), 'observation', {
                    label: `${cell.lat},${cell.lng}`, value: 'position' in cell ? cell.position : null,
                    state: cell.state, observedAt: 'capturedAt' in cell ? cell.capturedAt : scan.finishedAt,
                })),
            };
        },
    });
}
