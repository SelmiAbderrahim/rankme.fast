import { REPORT_CATALOG, getReportCatalogDescriptor, type ReportKindId, } from '../../shared/report-exports/index.js';
import type { ReportExportAdapter } from './report-exports.types.js';
import type { Db } from '../../db/client.js';
import { createAuditReportExportAdapter } from '../audits/index.js';
import { createRankReportExportAdapters } from '../ranks/index.js';
import { createGoogleReportExportAdapters } from '../google-connections/index.js';
import { createClientReportExportAdapter } from '../client-reports/index.js';
import { createKeywordResearchReportExportAdapters } from '../keyword-research/index.js';
import { createKeywordClusterReportExportAdapter } from '../keyword-clusters/index.js';
import { createCannibalizationReportExportAdapter } from '../cannibalization/index.js';
import { createBacklinkReportExportAdapters } from '../backlinks/index.js';
import { createCompetitorLandscapeReportExportAdapter, createCompetitorReportExportAdapters } from '../competitors/index.js';
import { createCompetitorContentReportExportAdapter } from '../competitor-content/index.js';
import { createActionsReportExportAdapter } from '../actions/index.js';
import { createAiVisibilityReportExportAdapter } from '../ai-visibility/index.js';
import { createAudienceResearchReportExportAdapter } from '../audience-research/index.js';
import { createBrandRadarReportExportAdapter } from '../brand-radar/index.js';
import { createContentIntelligenceReportExportAdapters } from '../content-intelligence/index.js';
import { createContentMonitorReportExportAdapter } from '../content-monitoring/index.js';
import { createContentBriefReportExportAdapter } from '../content-briefs/index.js';
import { createInternalLinksReportExportAdapter } from '../internal-links/index.js';
import { createWeeklyPulseReportExportAdapter } from '../weekly-pulse/index.js';
import { createLocalSeoReportExportAdapters } from '../local-seo/index.js';
import { createGeogridReportExportAdapter } from '../geogrid/index.js';
import { createSchemaGenerationReportExportAdapter } from '../schema-generator/index.js';
import { createAppSeoReportExportAdapters } from '../app-seo/index.js';
import { createPagesReportExportAdapter } from '../pages/index.js';
function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
    return (left.length === right.length &&
        left.every((value, index) => value === right[index]));
}
export class ReportExportAdapterRegistry {
    readonly #adapters = new Map<ReportKindId, ReportExportAdapter>();
    register(adapter: ReportExportAdapter): void {
        const descriptor = getReportCatalogDescriptor(adapter.kind);
        if (!descriptor) {
            throw new Error(`unknown report-export kind: ${adapter.kind}`);
        }
        if (this.#adapters.has(adapter.kind)) {
            throw new Error(`duplicate report-export adapter: ${adapter.kind}`);
        }
        if (adapter.kindVersion !== descriptor.kindVersion) {
            throw new Error(`report-export kind version mismatch: ${adapter.kind}`);
        }
        if (!sameOrderedValues(adapter.supportedFormats, descriptor.formats)) {
            throw new Error(`report-export format contract mismatch: ${adapter.kind}`);
        }
        this.#adapters.set(adapter.kind, adapter);
    }
    get(kind: ReportKindId): ReportExportAdapter | undefined {
        return this.#adapters.get(kind);
    }
    has(kind: ReportKindId): boolean {
        return this.#adapters.has(kind);
    }
    listAvailableKinds(): ReportKindId[] {
        return REPORT_CATALOG
            .filter((descriptor) => this.#adapters.has(descriptor.kind))
            .map((descriptor) => descriptor.kind);
    }
}
/** Empty registry remains the isolated test and incremental-adapter seam. */
export function createReportExportAdapterRegistry(): ReportExportAdapterRegistry {
    return new ReportExportAdapterRegistry();
}
function assertCompleteRegistry(registry: ReportExportAdapterRegistry, expectedKinds: readonly ReportKindId[]): void {
    const availableKinds = registry.listAvailableKinds();
    if (!sameOrderedValues(availableKinds, expectedKinds)) {
        const missingKinds = expectedKinds.filter((kind) => !registry.has(kind));
        throw new Error(`incomplete report-export registry: ${missingKinds.join(', ')}`);
    }
}
/** Register every implemented adapter in authoritative catalog order. */
export function createCoreReportExportAdapterRegistry(db: Db): ReportExportAdapterRegistry {
    const registry = createReportExportAdapterRegistry();
    registry.register(createAuditReportExportAdapter());
    for (const adapter of createRankReportExportAdapters(db))
        registry.register(adapter);
    for (const adapter of createGoogleReportExportAdapters(db))
        registry.register(adapter);
    registry.register(createClientReportExportAdapter(db));
    for (const adapter of createKeywordResearchReportExportAdapters(db))
        registry.register(adapter);
    registry.register(createKeywordClusterReportExportAdapter());
    registry.register(createCannibalizationReportExportAdapter());
    for (const adapter of createBacklinkReportExportAdapters(db))
        registry.register(adapter);
    for (const adapter of createCompetitorReportExportAdapters(db))
        registry.register(adapter);
    registry.register(createCompetitorContentReportExportAdapter());
    registry.register(createCompetitorLandscapeReportExportAdapter(db));
    registry.register(createActionsReportExportAdapter(db));
    registry.register(createAiVisibilityReportExportAdapter(db));
    registry.register(createAudienceResearchReportExportAdapter(db));
    registry.register(createBrandRadarReportExportAdapter());
    for (const adapter of createContentIntelligenceReportExportAdapters(db))
        registry.register(adapter);
    registry.register(createContentMonitorReportExportAdapter(db));
    registry.register(createContentBriefReportExportAdapter());
    registry.register(createInternalLinksReportExportAdapter());
    registry.register(createWeeklyPulseReportExportAdapter(db));
    for (const adapter of createLocalSeoReportExportAdapters(db))
        registry.register(adapter);
    registry.register(createGeogridReportExportAdapter(db));
    registry.register(createSchemaGenerationReportExportAdapter());
    registry.register(createPagesReportExportAdapter(db));
    for (const adapter of createAppSeoReportExportAdapters(db))
        registry.register(adapter);
    const expectedKinds = REPORT_CATALOG.map((descriptor) => descriptor.kind);
    assertCompleteRegistry(registry, expectedKinds);
    return registry;
}
export const reportExportRegistryTestables = Object.freeze({
    assertCompleteRegistry,
    sameOrderedValues,
});
