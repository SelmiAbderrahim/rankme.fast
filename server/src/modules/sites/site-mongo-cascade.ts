import mongoose, { type Model } from 'mongoose';
interface RefPath {
    path: string;
    ref: string | null;
}
interface MatchedModel {
    model: Model<unknown>;
    ids: Set<string>;
    depth: number;
}
let modelRegistration: Promise<unknown> | null = null;
/**
 * Public module barrels that own Mongoose models. Keeping the complete model
 * tree here (including account-only models) makes registration independent of
 * which API routes happen to be imported by a worker entry point. A source-tree
 * ratchet test fails when a new model-owning module is added without joining
 * this inventory.
 */
const SITE_LIFECYCLE_MODEL_MODULE_IMPORTERS = {
    'app-seo': () => import('../app-seo/index.js'),
    audit: () => import('../audit/index.js'),
    audits: () => import('../audits/index.js'),
    backlinks: () => import('../backlinks/index.js'),
    'brand-radar': () => import('../brand-radar/index.js'),
    cannibalization: () => import('../cannibalization/index.js'),
    chat: () => import('../chat/index.js'),
    'client-reports': () => import('../client-reports/index.js'),
    'competitor-content': () => import('../competitor-content/index.js'),
    competitors: () => import('../competitors/index.js'),
    'content-briefs': () => import('../content-briefs/index.js'),
    'content-intelligence': () => import('../content-intelligence/index.js'),
    'content-monitoring': () => import('../content-monitoring/index.js'),
    'google-connections': () => import('../google-connections/index.js'),
    'internal-links': () => import('../internal-links/index.js'),
    'keyword-clusters': () => import('../keyword-clusters/index.js'),
    'keyword-research': () => import('../keyword-research/index.js'),
    'local-seo': () => import('../local-seo/index.js'),
    'mcp-permissions': () => import('../mcp-permissions/index.js'),
    'report-exports': () => import('../report-exports/index.js'),
    'schema-generator': () => import('../schema-generator/index.js'),
    users: () => import('../users/index.js'),
    'audience-research': () => import('../audience-research/index.js'),
} as const;
export const SITE_LIFECYCLE_MONGO_PUBLIC_MODULES = Object.freeze(Object.keys(SITE_LIFECYCLE_MODEL_MODULE_IMPORTERS).sort());
/**
 * Account-purge runs in the worker, which does not otherwise import every
 * API-only feature model. Load each feature through its public API before
 * introspection so the cascade inventory is identical in api and worker
 * processes (and future descendants remain discoverable through refs).
 */
async function ensureSiteLifecycleModelsRegistered(): Promise<void> {
    modelRegistration ??= Promise.all(Object.values(SITE_LIFECYCLE_MODEL_MODULE_IMPORTERS).map((load) => load()));
    await modelRegistration;
}
export interface MongoSiteResourceInventory {
    /** Model name → ids rooted in this site (used by indirect queue matching). */
    idsByModel: ReadonlyMap<string, ReadonlySet<string>>;
    documents: number;
}
/** Review ratchet: every shipped model with a direct Site edge. */
export const SITE_SCOPED_MONGO_MODEL_NAMES = [
    'AppChartSubscription',
    'AppProfile',
    'AppReviewRun',
    'AudienceResearchRun',
    'AuditRun',
    'BacklinkPullRun',
    'BrandRadarScan',
    'CannibalizationReport',
    'ChatConversation',
    'ClientPortalToken',
    'CompetitorContentRun',
    'CompetitorDiscoveryAttempt',
    'CompetitorLandscapeLegCheckpoint',
    'CompetitorLandscapeReportPage',
    'CompetitorLandscapeRun',
    'CompetitorPageFacts',
    'ContentAnalysis',
    'ContentBrief',
    'ContentInventoryPage',
    'ContentInventoryRun',
    'ContentMonitor',
    'InternalLinkRun',
    'LinkGapRun',
    'LocalSeoReviewRow',
    'LocalSeoReviewSource',
    'LocalSeoReviewSyncRun',
    'MonitorWebhookReceipt',
    'ReportExportShare',
    'ReportExportSnapshot',
    'ReportSnapshot',
    'SchemaGeneration',
    'SerpClusterRun',
    'ToxicityReviewRun',
    'TrafficSnapshotRun',
    'TrendsExplorationRun',
] as const;
function registeredModels(): Array<Model<unknown>> {
    return mongoose.modelNames().map((name) => mongoose.model(name) as Model<unknown>);
}
function referencePaths(model: Model<unknown>): RefPath[] {
    const result: RefPath[] = [];
    model.schema.eachPath((path, schemaType) => {
        const typed = schemaType as unknown as {
            options?: {
                ref?: unknown;
            };
            caster?: {
                options?: {
                    ref?: unknown;
                };
            };
        };
        // Mongoose stores a scalar ref on the path itself and an array-element
        // ref on its caster. Both are ownership edges in the deletion graph.
        const candidate = typed.options?.ref ?? typed.caster?.options?.ref;
        const ref = typeof candidate === 'string' ? candidate : null;
        // A small number of legacy/current records store a string siteId without
        // a Mongoose `ref`; include that canonical field name explicitly.
        if (ref || path === 'siteId')
            result.push({ path, ref });
    });
    return result;
}
/** Names of all currently registered direct site-scoped Mongo models. */
export async function registeredSiteScopedModelNames(): Promise<string[]> {
    await ensureSiteLifecycleModelsRegistered();
    return registeredModels()
        .filter((model) => referencePaths(model).some((entry) => entry.ref === 'Site' || entry.path === 'siteId'))
        .map((model) => model.modelName)
        .filter((name) => name !== 'Site')
        .sort();
}
/**
 * Walk typed Mongoose refs from Site to descendants before deleting anything.
 * This captures child-only collections such as AuditedPage, ContentSnapshot,
 * inventory/competitor snapshots, and MonitorEvidence.
 */
export async function collectSiteMongoResources(siteId: string): Promise<MongoSiteResourceInventory & {
    matched: MatchedModel[];
}> {
    await ensureSiteLifecycleModelsRegistered();
    const idsByModel = new Map<string, Set<string>>([['Site', new Set([siteId])]]);
    const matchedByModel = new Map<string, MatchedModel>();
    let changed = true;
    while (changed) {
        changed = false;
        for (const model of registeredModels()) {
            if (model.modelName === 'Site')
                continue;
            const conditions: Array<Record<string, unknown>> = [];
            let depth = 1;
            for (const entry of referencePaths(model)) {
                if (entry.ref) {
                    const parentIds = idsByModel.get(entry.ref);
                    if (!parentIds || parentIds.size === 0)
                        continue;
                    conditions.push({ [entry.path]: { $in: [...parentIds] } });
                    const parentDepth = matchedByModel.get(entry.ref)?.depth ?? 0;
                    depth = Math.max(depth, parentDepth + 1);
                }
                else {
                    // referencePaths only emits typed refs or this canonical legacy key.
                    conditions.push({ siteId });
                }
            }
            if (conditions.length === 0)
                continue;
            const docs = await model.find({ $or: conditions }, { _id: 1 }).lean();
            if (docs.length === 0)
                continue;
            let match = matchedByModel.get(model.modelName);
            if (!match) {
                match = { model, ids: new Set(), depth };
                matchedByModel.set(model.modelName, match);
            }
            else {
                match.depth = Math.max(match.depth, depth);
            }
            const known = idsByModel.get(model.modelName) ?? new Set<string>();
            for (const doc of docs as Array<{
                _id: unknown;
            }>) {
                const id = String(doc._id);
                if (!known.has(id)) {
                    known.add(id);
                    match.ids.add(id);
                    changed = true;
                }
            }
            idsByModel.set(model.modelName, known);
        }
    }
    const matched = [...matchedByModel.values()].sort((left, right) => right.depth - left.depth || left.model.modelName.localeCompare(right.model.modelName));
    return {
        idsByModel,
        matched,
        documents: matched.reduce((sum, entry) => sum + entry.ids.size, 0),
    };
}
/**
 * Deletes descendants before parents and converges if a pre-claim request
 * finishes during the first pass. Five passes is a hard bound; a continuing
 * writer fails deletion rather than falsely reporting success.
 */
export async function purgeSiteMongoData(siteId: string): Promise<MongoSiteResourceInventory> {
    const aggregate = new Map<string, Set<string>>([['Site', new Set([siteId])]]);
    let deleted = 0;
    for (let pass = 0; pass < 5; pass += 1) {
        const inventory = await collectSiteMongoResources(siteId);
        for (const [name, ids] of inventory.idsByModel) {
            const target = aggregate.get(name) ?? new Set<string>();
            for (const id of ids)
                target.add(id);
            aggregate.set(name, target);
        }
        if (inventory.documents === 0) {
            return { idsByModel: aggregate, documents: deleted };
        }
        for (const entry of inventory.matched) {
            const result = await entry.model.deleteMany({ _id: { $in: [...entry.ids] } });
            deleted += result.deletedCount;
        }
    }
    throw new Error('site Mongo cascade did not converge after five passes');
}
