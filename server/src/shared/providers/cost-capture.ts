/**
 * Ambient vendor-cost capture — the bridge between the DataForSEO HTTP
 * choke point (which sees the vendor-reported `cost` on every envelope)
 * and the archive writers (which persist one `vendor_responses` row per
 * provider-method invocation).
 *
 * `captureVendorCost(fn)` opens an AsyncLocalStorage scope; every
 * `dataForSeoRequest` that resolves inside `fn` records its envelope cost
 * into the scope, so multi-request flows (task_post + polls, fan-outs)
 * sum automatically. Providers that never report a cost (fakes, Google,
 * Anthropic) record nothing and the capture resolves `costMicros: null` —
 * "no actual cost known", which downstream readers render as an estimate.
 * A recorded zero stays `0n` (the vendor really charged nothing).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
interface CostScope {
    micros: bigint;
    recorded: boolean;
}
const costScopes = new AsyncLocalStorage<CostScope>();
/** Vendor-reported float USD → bigint micro-dollars; null on garbage input. */
export function usdToMicros(usd: number): bigint | null {
    if (!Number.isFinite(usd) || usd < 0)
        return null;
    return BigInt(Math.round(usd * 1000000));
}
/**
 * Record a vendor-reported cost into the active capture scope. No-op when
 * no scope is active (call sites that never archive) or when the value is
 * absent/garbage — those calls simply stay "unrecorded".
 */
export function recordVendorCostUsd(costUsd: number | null | undefined): void {
    const scope = costScopes.getStore();
    if (!scope || costUsd === null || costUsd === undefined)
        return;
    const micros = usdToMicros(costUsd);
    if (micros === null)
        return;
    scope.micros += micros;
    scope.recorded = true;
}
/**
 * Run `fn` in a fresh capture scope and return its value plus the summed
 * vendor cost. `costMicros` is null iff nothing was recorded; a recorded
 * zero resolves `0n`. Nested captures are isolated — an inner scope never
 * leaks records into the outer one.
 */
export async function captureVendorCost<T>(fn: () => Promise<T>): Promise<{
    value: T;
    costMicros: bigint | null;
}> {
    const scope: CostScope = { micros: 0n, recorded: false };
    const value = await costScopes.run(scope, fn);
    return { value, costMicros: scope.recorded ? scope.micros : null };
}
