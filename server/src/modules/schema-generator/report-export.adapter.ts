import { z } from 'zod';
import { stableReportJson } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { assertSiteResourceTarget, createStoredReportAdapter, storedRecord, type LoadedStoredReport, type ReportExportAccessContext, } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { getGeneration } from './schema-generator.service.js';
const selectionSchema = z.object({}).strict();
type Selection = z.infer<typeof selectionSchema>;
type SchemaGenerationExportContext = Pick<ReportExportAccessContext, 'accountId' | 'target'>;
async function base(context: SchemaGenerationExportContext) {
    assertSiteResourceTarget(context.target);
    const generation = await getGeneration({ accountId: context.accountId, generationId: context.target.resourceId });
    if (generation.siteId !== context.target.siteId)
        throw HttpError.notFound({ code: 'SCHEMA_GENERATOR_ERRORS_NOT_FOUND', messageKey: 'schemaGenerator.errors.notFound' });
    return generation;
}
export function createSchemaGenerationReportExportAdapter() {
    return createStoredReportAdapter<Selection>({
        kind: 'schema.generation', localizationStem: 'schemaGeneration', formats: ['json', 'jsonld'], selectionSchema,
        access: base,
        async load(context): Promise<LoadedStoredReport> {
            const generation = await base(context);
            assertSiteResourceTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const evidenceByProperty = new Map<string, typeof generation.evidence>();
            for (const row of generation.evidence)
                evidenceByProperty.set(row.property, [...(evidenceByProperty.get(row.property) ?? []), row]);
            const omissionByProperty = new Map(generation.omissions.map((row) => [row.property, row]));
            const properties = [...new Set([...evidenceByProperty.keys(), ...omissionByProperty.keys()])].sort();
            const records = [storedRecord('generation', generation.id, stableReportJson({
                    pageUrl: generation.pageUrl, source: generation.source, schemaType: generation.schemaType,
                    registryVersion: generation.registryVersion, status: generation.status,
                    conformanceStatus: generation.conformanceStatus, failureReason: generation.failureReason,
                    generatedAt: generation.generatedAt, conformance: generation.conformance,
                }), 'generated', { state: generation.status, observedAt: generation.generatedAt })];
            properties.forEach((property) => records.push(storedRecord('schema-property', property, stableReportJson({
                evidence: evidenceByProperty.get(property) ?? [], omission: omissionByProperty.get(property) ?? null,
            }), evidenceByProperty.has(property) ? 'observation' : 'derived', { state: omissionByProperty.has(property) ? 'omitted' : 'included', observedAt: generation.generatedAt })));
            let artifact: LoadedStoredReport['artifact'];
            if (generation.payload !== null) {
                const parsed = JSON.parse(generation.payload) as Record<string, unknown>;
                artifact = { format: 'jsonld', label: `${generation.id}.jsonld`, value: parsed };
            }
            return {
                siteLabel: site.displayName || site.domain, observedAt: generation.generatedAt,
                sourceVersionValue: generation, selectedItems: properties.length, records, ...(artifact ? { artifact } : {}),
            };
        },
    });
}
