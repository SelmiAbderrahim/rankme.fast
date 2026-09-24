import type { Db } from '../../db/client.js';
import { vendorResponses } from '../../db/schema/index.js';
import { captureVendorCost } from '../../shared/providers/index.js';
import type { TrafficProviderBundle } from './traffic-snapshots.schema.js';
export const TRAFFIC_COST_TASK_MICROS = 6000n;
export const TRAFFIC_COST_ITEM_MICROS = 400n;
export const TRAFFIC_HISTORY_POINT_MICROS = 200n;
export const TRAFFIC_COST_MAX_HISTORY_POINTS = 30;
export type TrafficCostSubOperation = 'traffic-estimation' | 'rank-overview' | 'rank-overview-history';
export interface TrafficSnapshotCostDeps {
    db: Db;
    now?: () => Date;
}
interface CaptureTrafficCostInput<T> {
    targetDomain: string;
    subOperation: TrafficCostSubOperation;
    fallbackItems: number;
    itemsFromValue: (value: T) => number;
}
function clampItems(value: number, maximum: number): number {
    return Math.min(maximum, Math.max(0, Math.floor(value)));
}
export function pinnedTrafficOperationCostMicros(subOperation: TrafficCostSubOperation, items: number): bigint {
    if (subOperation === 'traffic-estimation') {
        return TRAFFIC_COST_TASK_MICROS + TRAFFIC_COST_ITEM_MICROS;
    }
    if (subOperation === 'rank-overview')
        return TRAFFIC_COST_TASK_MICROS;
    return (TRAFFIC_COST_TASK_MICROS +
        TRAFFIC_HISTORY_POINT_MICROS *
            BigInt(clampItems(items, TRAFFIC_COST_MAX_HISTORY_POINTS)));
}
async function appendTrafficCostRow(deps: TrafficSnapshotCostDeps, input: {
    targetDomain: string;
    subOperation: TrafficCostSubOperation;
    items: number;
    cached: boolean;
    successful: boolean;
    costMicros: bigint;
}): Promise<void> {
    const fetchedAt = (deps.now ?? (() => new Date()))();
    await deps.db.insert(vendorResponses).values({
        capability: 'competitor',
        operation: 'traffic',
        cacheKey: input.targetDomain,
        params: {
            targetDomain: input.targetDomain,
            subOperation: input.subOperation,
            tasks: 1,
            items: input.items,
            cached: input.cached,
        },
        payload: {
            subOperation: input.subOperation,
            cached: input.cached,
            successful: input.successful,
        },
        accountId: null,
        costMicros: input.costMicros,
        fetchedAt,
    });
}
/** Capture one Labs call and append exactly one sub-operation cost row. */
export async function captureTrafficSnapshotOperationCost<T>(deps: TrafficSnapshotCostDeps, input: CaptureTrafficCostInput<T>, call: () => Promise<T>): Promise<T> {
    const captured = await captureVendorCost(async () => {
        try {
            return { ok: true as const, value: await call() };
        }
        catch (error) {
            return { ok: false as const, error };
        }
    });
    const items = clampItems(captured.value.ok
        ? input.itemsFromValue(captured.value.value)
        : input.fallbackItems, input.subOperation === 'rank-overview-history'
        ? TRAFFIC_COST_MAX_HISTORY_POINTS
        : 1);
    await appendTrafficCostRow(deps, {
        targetDomain: input.targetDomain,
        subOperation: input.subOperation,
        items,
        cached: false,
        successful: captured.value.ok,
        costMicros: captured.costMicros ??
            pinnedTrafficOperationCostMicros(input.subOperation, items),
    });
    if (!captured.value.ok)
        throw captured.value.error;
    return captured.value.value;
}
/** A cache-served bundle emits one zero-cost row per skipped Labs operation. */
export async function recordCachedTrafficSnapshotCosts(deps: TrafficSnapshotCostDeps, targetDomain: string, bundle: TrafficProviderBundle): Promise<void> {
    const rows: Array<{
        subOperation: TrafficCostSubOperation;
        items: number;
        successful: boolean;
    }> = [
        {
            subOperation: 'traffic-estimation',
            items: 1,
            successful: bundle.retainedOps.traffic,
        },
        {
            subOperation: 'rank-overview',
            items: 1,
            successful: bundle.retainedOps.rankOverview,
        },
        {
            subOperation: 'rank-overview-history',
            items: clampItems(bundle.history?.points.length ?? 0, TRAFFIC_COST_MAX_HISTORY_POINTS),
            successful: bundle.retainedOps.history,
        },
    ];
    for (const row of rows) {
        await appendTrafficCostRow(deps, {
            targetDomain,
            ...row,
            cached: true,
            costMicros: 0n,
        });
    }
}
