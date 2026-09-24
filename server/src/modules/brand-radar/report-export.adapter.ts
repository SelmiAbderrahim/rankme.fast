import { z } from 'zod';
import { assertSiteResourceTarget, createStoredReportAdapter, storedRecord, type LoadedStoredReport, type ReportExportAccessContext, } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { BRAND_RADAR_POLARITIES, readMentionRows } from './brand-radar.rows.model.js';
import { getScan, serializeMentionRow } from './brand-radar.service.js';
const selectionSchema = z.object({
    sentiment: z.array(z.enum(BRAND_RADAR_POLARITIES)).max(3).optional(),
    from: z.string().date().optional(), to: z.string().date().optional(),
    domain: z.array(z.string().trim().min(1).max(253)).max(50).optional(),
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, { message: 'reportExports.errors.invalidWindow' });
type Selection = z.infer<typeof selectionSchema>;
type BrandRadarExportContext = Pick<ReportExportAccessContext, 'accountId' | 'target'>;
async function base(context: BrandRadarExportContext) {
    assertSiteResourceTarget(context.target);
    const scan = await getScan(context.accountId, context.target.resourceId);
    if (scan.siteId !== context.target.siteId)
        throw new Error('brand radar site mismatch');
    const rows = (await readMentionRows({ accountId: context.accountId, scanId: context.target.resourceId, limit: 1000 })).map(serializeMentionRow);
    return { scan, rows };
}
export function createBrandRadarReportExportAdapter() {
    return createStoredReportAdapter<Selection>({
        kind: 'brand.radar_scan', localizationStem: 'brandRadarScan', formats: ['pdf', 'csv', 'json'], selectionSchema,
        access: base,
        async load(context): Promise<LoadedStoredReport> {
            const loaded = await base(context);
            assertSiteResourceTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const from = context.selection.from ? new Date(`${context.selection.from}T00:00:00.000Z`) : null;
            const to = context.selection.to ? new Date(`${context.selection.to}T23:59:59.999Z`) : null;
            const rows = loaded.rows.filter((row) => !context.selection.sentiment || context.selection.sentiment.includes(row.polarity))
                .filter((row) => !context.selection.domain || context.selection.domain.includes(row.domain))
                .filter((row) => !from || (row.observedAt !== null && new Date(row.observedAt) >= from))
                .filter((row) => !to || (row.observedAt !== null && new Date(row.observedAt) <= to));
            const observedAt = rows.map((row) => row.observedAt).filter((value): value is string => value !== null).sort().at(-1)
                ?? loaded.scan.terminalAt ?? loaded.scan.updatedAt;
            return {
                siteLabel: site.displayName || site.domain, observedAt, sourceVersionValue: loaded,
                selectedItems: rows.length,
                records: [
                    storedRecord('scan-summary', loaded.scan.id, {
                        brandQuery: loaded.scan.brandQuery, language: loaded.scan.language,
                        outputLocale: loaded.scan.outputLocale,
                        countryCode: loaded.scan.countryCode,
                        locationCode: loaded.scan.locationCode, status: loaded.scan.status,
                        digestState: loaded.scan.digestState, mentionCount: loaded.scan.mentionCount,
                        sentimentDistribution: loaded.scan.sentimentDistribution, topDomains: loaded.scan.topDomains,
                        trend: loaded.scan.trend, priorScanId: loaded.scan.priorScanId, halt: loaded.scan.halt,
                        createdAt: loaded.scan.createdAt, terminalAt: loaded.scan.terminalAt,
                    }, 'derived', { state: loaded.scan.status, observedAt }),
                    ...rows.map((row) => storedRecord('mention', row.id, {
                        url: row.url, domain: row.domain, title: row.title, snippet: row.snippet,
                        polarity: row.polarity, confidence: row.confidence, language: row.language,
                    }, 'observation', { label: row.title || row.domain, value: row.confidence, state: row.polarity, observedAt: row.observedAt })),
                    ...loaded.scan.digestSentences.map((sentence, index) => storedRecord('digest-sentence', String(index + 1), {
                        text: sentence.text, citedRowIds: [...sentence.citedRowIds],
                        outputLocale: loaded.scan.outputLocale,
                    }, 'generated', { value: sentence.text, observedAt })),
                ],
            };
        },
    });
}
