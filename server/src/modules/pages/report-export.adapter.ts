import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { env } from '../../config/env.js';
import { stableReportJson } from '../../shared/report-exports/index.js';
import { assertSiteTarget, createStoredReportAdapter, storedRecord, type LoadedStoredReport, type ReportExportAccessContext, } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { PAGES_INSIGHTS, PAGES_RANGES } from './pages.schema.js';
import { createPagesService } from './pages.service.js';
const selectionSchema = z.object({
    range: z.enum(PAGES_RANGES).default('28d'),
    pageIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{43}$/u)).max(1000).optional(),
    insight: z.array(z.enum(PAGES_INSIGHTS)).max(PAGES_INSIGHTS.length).optional(),
    indexability: z.enum(['indexable', 'non_indexable']).optional(),
    visibility: z.enum(['measured', 'unmeasured']).optional(),
}).strict();
type Selection = z.infer<typeof selectionSchema>;
type PagesExportContext = Pick<ReportExportAccessContext, 'accountId' | 'target'>;
function service(db: Db) {
    return createPagesService({
        db,
        cursorSecret: env.MASTER_ENCRYPTION_KEY,
        providerSelection: env.PROVIDER_KEYWORD,
        fallbackRefresh: { refresh: async () => { throw new Error('report export cannot refresh page data'); } },
    });
}
async function readRange(db: Db, context: PagesExportContext, range: (typeof PAGES_RANGES)[number]) {
    const target = context.target;
    assertSiteTarget(target);
    const api = service(db);
    const items = [];
    let cursor: string | undefined;
    let envelope: Awaited<ReturnType<typeof api.list>>['envelope'] | null = null;
    let summary: Awaited<ReturnType<typeof api.list>>['summary'] | null = null;
    do {
        const page = await api.list(context.accountId, target.siteId, {
            range, sort: 'url', direction: 'asc', limit: 100, ...(cursor ? { cursor } : {}),
        });
        envelope = page.envelope;
        summary = page.summary;
        items.push(...page.items);
        cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor && items.length <= 1000);
    if (!envelope || !summary)
        throw new Error('pages read returned no envelope');
    return { range, envelope, summary, items };
}
async function base(db: Db, context: PagesExportContext) {
    assertSiteTarget(context.target);
    const ranges = await Promise.all(PAGES_RANGES.map((range) => readRange(db, context, range)));
    return { ranges };
}
export function createPagesReportExportAdapter(db: Db) {
    return createStoredReportAdapter<Selection>({
        kind: 'pages.performance', localizationStem: 'pagesPerformance', formats: ['pdf', 'csv', 'json'], selectionSchema,
        access: (context) => base(db, context),
        async load(context): Promise<LoadedStoredReport> {
            const loaded = await base(db, context);
            const target = context.target;
            assertSiteTarget(target);
            const siteId = target.siteId;
            const selectedRange = loaded.ranges.find((item) => item.range === context.selection.range)!;
            const site = await getSite(context.accountId, siteId);
            const ids = new Set(context.selection.pageIds ?? []);
            const rows = selectedRange.items.filter((row) => ids.size === 0 || ids.has(row.pageId))
                .filter((row) => !context.selection.insight || row.insights.some((value) => context.selection.insight!.includes(value)))
                .filter((row) => !context.selection.indexability || (context.selection.indexability === 'indexable' ? row.isIndexable === true : row.isIndexable === false))
                .filter((row) => !context.selection.visibility || (context.selection.visibility === 'measured' ? row.performanceSource !== null : row.performanceSource === null));
            const api = service(db);
            const details = ids.size > 0 ? new Map(await Promise.all(rows.map(async (row) => [
                row.pageId,
                await api.detail(context.accountId, siteId, row.pageId, context.selection.range),
            ] as const))) : new Map();
            const observedAt = selectedRange.envelope.observedAt ?? new Date(0).toISOString();
            return {
                siteLabel: site.displayName || site.domain, observedAt, sourceVersionValue: loaded,
                records: rows.map((row) => storedRecord('page-performance', row.pageId, stableReportJson({
                    envelope: selectedRange.envelope, summary: selectedRange.summary, page: row,
                    detail: details.get(row.pageId) ?? null,
                }), row.performanceSource === null ? 'derived' : 'observation', {
                    label: row.title ?? row.displayUrl,
                    value: row.metrics.averagePosition ?? row.metrics.bestPosition,
                    state: row.performanceSource ?? 'unmeasured', observedAt,
                })),
            };
        },
    });
}
