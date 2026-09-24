import type { SpendCachedStatus, SpendPreview, SpendPreviewOperation } from '../../shared/safety/operation-preview.js';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { backlinkDeepPayloadSchemas, linkGapSnapshotPayloadSchema, } from '../../db/schema/index.js';
import { computeVendorCacheKey } from '../../shared/vendor-cache/cache-key.js';
import { createVendorCacheRepo, type VendorCacheRepo, } from '../../shared/vendor-cache/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { BacklinkPullType } from './backlink-runs.model.js';
import { BACKLINK_PULL_MAX_ROWS, } from './backlink-runs.model.js';
import { backlinkDeepDomainSchema } from './backlink-deep.schema.js';
import type { BacklinkDeepPreviewBody, LinkGapPreviewBody, } from './backlink-preview.schema.js';
import { BACKLINK_VENDOR_OPERATIONS, backlinkBulkRanksCacheParams, backlinkCompetitorsCacheParams, deepVendorCacheParams, deepVendorOperation, } from './backlink-vendor-operations.js';
import { LINK_INTEL_UNAVAILABLE_KEY } from './backlink-deep.service.js';
import { normalizeGapCompetitors } from './link-gap.service.js';
export interface BacklinkPreviewDeps {
    db: Db;
    now?: () => Date;
    repo?: VendorCacheRepo;
}
interface CacheProbe {
    cached: boolean;
    payload: unknown;
}
async function probeCache(repo: VendorCacheRepo, input: {
    operation: string;
    params: Record<string, unknown>;
    now: Date;
}): Promise<CacheProbe> {
    const hit = await repo.read({
        capability: 'backlink',
        operation: input.operation,
        cacheKey: computeVendorCacheKey({
            capability: 'backlink',
            operation: input.operation,
            params: input.params,
        }),
    }, input.now);
    return hit ? { cached: true, payload: hit.payload } : { cached: false, payload: null };
}
function previewDomain(body: BacklinkDeepPreviewBody): string {
    return 'domain' in body ? body.domain : body.domains[0]!;
}
function previewDomains(body: BacklinkDeepPreviewBody): string[] {
    return body.type === 'bulkRanks' ? [...body.domains] : [];
}
function previewLimit(body: BacklinkDeepPreviewBody): number | null {
    return 'limit' in body ? body.limit : null;
}
function aggregateCachedStatus(breakdown: readonly SpendPreviewOperation[]): SpendCachedStatus {
    if (breakdown.every((entry) => entry.cachedStatus === 'hit'))
        return 'hit';
    if (breakdown.every((entry) => entry.cachedStatus === 'miss'))
        return 'miss';
    return 'partial';
}
function communityPreview(operation: string, breakdown: SpendPreviewOperation[], now: Date): SpendPreview {
    return {
        deploymentMode: 'community',
        capacityEnforced: false,
        feature: 'link_intelligence',
        operation,
        productUnits: breakdown.length,
        cachedStatus: aggregateCachedStatus(breakdown),
        breakdown,
        estimatedAt: now.toISOString(),
    };
}
export async function previewBacklinkDeepSpend(body: BacklinkDeepPreviewBody, deps: BacklinkPreviewDeps): Promise<SpendPreview> {
    if (!env.LINK_INTELLIGENCE_ENABLED) {
        throw new HttpError(503, { code: 'LINK_INTEL_UNAVAILABLE', messageKey: LINK_INTEL_UNAVAILABLE_KEY });
    }
    const now = (deps.now ?? (() => new Date()))();
    const repo = deps.repo ?? createVendorCacheRepo(deps.db);
    const type = body.type as BacklinkPullType;
    const domain = previewDomain(body);
    const domains = previewDomains(body);
    const limit = previewLimit(body);
    const operation = deepVendorOperation(type);
    const params = deepVendorCacheParams({ type, domain, limit, domains });
    const hit = await probeCache(repo, { operation, params, now });
    const schema = backlinkDeepPayloadSchemas[type];
    const cached = hit.cached && schema.safeParse(hit.payload).success;
    return communityPreview(operation, [
        {
            operationKey: operation,
            metric: 'link_intel_checks',
            productUnits: 1,
            cachedStatus: cached ? 'hit' : 'miss',
        },
    ], now);
}
async function gapLegCachedStatus(repo: VendorCacheRepo, ownDomain: string, competitor: string, now: Date): Promise<SpendCachedStatus> {
    const competitorParams = backlinkCompetitorsCacheParams(competitor, BACKLINK_PULL_MAX_ROWS);
    const competitorHit = await probeCache(repo, {
        operation: BACKLINK_VENDOR_OPERATIONS.competitors,
        params: competitorParams,
        now,
    });
    const parsedCompetitors = linkGapSnapshotPayloadSchema.safeParse(competitorHit.payload);
    if (!competitorHit.cached || !parsedCompetitors.success)
        return 'miss';
    const candidates = parsedCompetitors.data
        .map((row) => backlinkDeepDomainSchema.parse(row.domain))
        .filter((domain) => domain !== ownDomain)
        .slice(0, 100);
    if (candidates.length === 0)
        return 'hit';
    const bulkParams = backlinkBulkRanksCacheParams(candidates);
    const bulkHit = await probeCache(repo, {
        operation: BACKLINK_VENDOR_OPERATIONS.bulkRanks,
        params: bulkParams,
        now,
    });
    return bulkHit.cached && backlinkDeepPayloadSchemas.bulkRanks.safeParse(bulkHit.payload).success
        ? 'hit'
        : 'miss';
}
export async function previewLinkGapSpend(body: LinkGapPreviewBody, deps: BacklinkPreviewDeps): Promise<SpendPreview> {
    if (!env.LINK_INTELLIGENCE_ENABLED) {
        throw new HttpError(503, { code: 'LINK_INTEL_UNAVAILABLE', messageKey: LINK_INTEL_UNAVAILABLE_KEY });
    }
    const ownDomain = backlinkDeepDomainSchema.parse(body.ownDomain);
    const competitors = normalizeGapCompetitors(body.competitors, ownDomain);
    const now = (deps.now ?? (() => new Date()))();
    const repo = deps.repo ?? createVendorCacheRepo(deps.db);
    const breakdown: SpendPreviewOperation[] = [];
    for (const competitor of competitors) {
        breakdown.push({
            operationKey: `gap:${competitor}`,
            metric: 'link_intel_checks',
            productUnits: 1,
            cachedStatus: await gapLegCachedStatus(repo, ownDomain, competitor, now),
        });
    }
    return communityPreview('link-gap', breakdown, now);
}
