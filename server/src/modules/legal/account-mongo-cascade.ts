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
 * Public feature barrels that own Mongoose models. Account deletion runs in a
 * worker, so it cannot rely on API route imports having registered every
 * collection. The companion source-tree test is intentionally a ratchet: a
 * newly added model-owning feature must be reviewed for deletion semantics.
 */
const ACCOUNT_LIFECYCLE_MODEL_MODULE_IMPORTERS = {
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
    sites: () => import('../sites/index.js'),
    users: () => import('../users/index.js'),
    'audience-research': () => import('../audience-research/index.js'),
} as const;
export const ACCOUNT_LIFECYCLE_MONGO_PUBLIC_MODULES = Object.freeze(Object.keys(ACCOUNT_LIFECYCLE_MODEL_MODULE_IMPORTERS).sort());
/**
 * These collections have a deliberately different retention policy. Site is
 * erased by the site lifecycle (which also tears down remote monitors and its
 * Postgres graph). User is the final account tombstone in Mongo and is removed
 * only after every fallible purge step. AuditLog is retained in sanitized
 * form.
 */
export const ACCOUNT_MONGO_CASCADE_EXCLUDED_MODEL_NAMES = Object.freeze([
    'AuditLog',
    'Site',
    'User',
]);
/** Review ratchet: every shipped model with a direct `accountId` owner edge. */
export const ACCOUNT_SCOPED_MONGO_MODEL_NAMES = [
    'AppChartSubscription',
    'AppProfile',
    'AppReviewRun',
    'AudienceResearchRun',
    'AuditRun',
    'BacklinkPullRun',
    'BrandRadarMention',
    'BrandRadarMentionSummary',
    'BrandRadarScan',
    'CannibalizationReport',
    'ChatConversation',
    'ChatMessage',
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
    'GoogleConnection',
    'InternalLinkRun',
    'KeywordClusterRun',
    'LinkGapRun',
    'LocalSeoReviewRow',
    'LocalSeoReviewSource',
    'LocalSeoReviewSyncRun',
    'McpPermissionSettings',
    'MonitorEvidence',
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
async function ensureAccountLifecycleModelsRegistered(): Promise<void> {
    modelRegistration ??= Promise.all(Object.values(ACCOUNT_LIFECYCLE_MODEL_MODULE_IMPORTERS).map((load) => load()));
    await modelRegistration;
}
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
        const candidate = typed.options?.ref ?? typed.caster?.options?.ref;
        const ref = typeof candidate === 'string' ? candidate : null;
        if (ref || path === 'accountId')
            result.push({ path, ref });
    });
    return result;
}
function isExcluded(modelName: string): boolean {
    return ACCOUNT_MONGO_CASCADE_EXCLUDED_MODEL_NAMES.includes(modelName);
}
/** Names of every registered direct account-owned collection. */
export async function registeredAccountScopedModelNames(): Promise<string[]> {
    await ensureAccountLifecycleModelsRegistered();
    return registeredModels()
        .filter((model) => !isExcluded(model.modelName) && referencePaths(model).some((entry) => entry.path === 'accountId'))
        .map((model) => model.modelName)
        .sort();
}
export interface MongoAccountResourceInventory {
    /** Model name → ids rooted in this account. */
    idsByModel: ReadonlyMap<string, ReadonlySet<string>>;
    documents: number;
}
/**
 * Walk from every direct `accountId` document through typed Mongoose refs.
 * This captures child-only collections such as AuditedPage,
 * ContentSnapshot, inventory/competitor snapshots, and MonitorEvidence. User
 * references other than `accountId` are not treated as ownership edges: an
 * actor/creator relationship must never erase another account's resource.
 */
export async function collectAccountMongoResources(accountId: string): Promise<MongoAccountResourceInventory & {
    matched: MatchedModel[];
}> {
    await ensureAccountLifecycleModelsRegistered();
    const idsByModel = new Map<string, Set<string>>([['User', new Set([accountId])]]);
    const matchedByModel = new Map<string, MatchedModel>();
    let changed = true;
    while (changed) {
        changed = false;
        for (const model of registeredModels()) {
            if (isExcluded(model.modelName))
                continue;
            const conditions: Array<Record<string, unknown>> = [];
            let depth = 1;
            for (const entry of referencePaths(model)) {
                if (entry.path === 'accountId') {
                    conditions.push({ accountId });
                    continue;
                }
                // Other User refs are attribution, not necessarily ownership.
                if (!entry.ref || entry.ref === 'User')
                    continue;
                const parentIds = idsByModel.get(entry.ref);
                if (!parentIds || parentIds.size === 0)
                    continue;
                conditions.push({ [entry.path]: { $in: [...parentIds] } });
                // Every non-User id set is created together with its matched-model
                // entry in this fixed-point walk, so the parent depth is present.
                const parentDepth = matchedByModel.get(entry.ref)!.depth;
                depth = Math.max(depth, parentDepth + 1);
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
 * Delete descendants before parents and repeat to a fixed point. The process-
 * wide/account tombstone barriers should make a second pass unnecessary; the
 * bounded retry protects against a pre-claim writer finishing at the edge.
 */
export async function purgeAccountMongoData(accountId: string): Promise<MongoAccountResourceInventory> {
    const aggregate = new Map<string, Set<string>>([['User', new Set([accountId])]]);
    let deleted = 0;
    for (let pass = 0; pass < 5; pass += 1) {
        const inventory = await collectAccountMongoResources(accountId);
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
    throw new Error('account Mongo cascade did not converge after five passes');
}
