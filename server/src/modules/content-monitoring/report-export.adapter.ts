import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { assertSiteResourceTarget, createStoredReportAdapter, storedRecord, type LoadedStoredReport, type ReportExportAccessContext, } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { getMonitor } from './monitoring.service.js';
const selectionSchema = z.object({
    from: z.string().date().optional(), to: z.string().date().optional(),
    eventKind: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
}).strict().superRefine((value, context) => {
    if (Boolean(value.from) !== Boolean(value.to)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'reportExports.errors.invalidWindow' });
        return;
    }
    if (!value.from || !value.to)
        return;
    const days = (new Date(`${value.to}T00:00:00.000Z`).getTime() - new Date(`${value.from}T00:00:00.000Z`).getTime()) / 86400000 + 1;
    if (days < 1 || days > 365)
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'reportExports.errors.invalidWindow' });
});
type Selection = z.infer<typeof selectionSchema>;
type ContentMonitorExportContext = Pick<ReportExportAccessContext, 'accountId' | 'target'>;
async function base(db: Db, context: ContentMonitorExportContext) {
    assertSiteResourceTarget(context.target);
    const feed = [];
    let cursor: string | undefined;
    let monitor: Awaited<ReturnType<typeof getMonitor>>['monitor'] | null = null;
    do {
        const page = await getMonitor({ db, accountId: context.accountId, siteId: context.target.siteId, monitorId: context.target.resourceId, limit: 50, ...(cursor ? { cursor } : {}) });
        monitor = page.monitor;
        feed.push(...page.feed);
        cursor = page.nextCursor ?? undefined;
    } while (cursor && feed.length <= 1000);
    if (!monitor)
        throw new Error('monitor read returned no monitor');
    return { monitor, feed };
}
export function createContentMonitorReportExportAdapter(db: Db) {
    return createStoredReportAdapter<Selection>({
        kind: 'content.monitor_feed', localizationStem: 'contentMonitorFeed', formats: ['csv', 'json'], selectionSchema,
        access: (context) => base(db, context),
        async load(context): Promise<LoadedStoredReport> {
            const loaded = await base(db, context);
            assertSiteResourceTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const from = context.selection.from ? new Date(`${context.selection.from}T00:00:00.000Z`) : null;
            const to = context.selection.to ? new Date(`${context.selection.to}T23:59:59.999Z`) : null;
            const feed = loaded.feed.filter((row) => !context.selection.eventKind || context.selection.eventKind.includes(row.kind))
                .filter((row) => !from || new Date(row.recordedAt) >= from)
                .filter((row) => !to || new Date(row.recordedAt) <= to);
            const observedAt = feed.map((row) => row.recordedAt).sort().at(-1) ?? loaded.monitor.updatedAt;
            return {
                siteLabel: site.displayName || site.domain, observedAt, sourceVersionValue: loaded,
                records: feed.map((row) => storedRecord('change-event', row.eventKey, {
                    kind: row.kind, checkId: row.checkId, isoWeek: row.isoWeek,
                    diffText: row.diffText, diffEvidenceState: row.diffText === null ? 'expired-or-unavailable' : 'retained',
                    targetUrl: loaded.monitor.targetUrl, targetKind: loaded.monitor.targetKind,
                }, 'derived', { state: row.kind, observedAt: row.recordedAt })),
            };
        },
    });
}
