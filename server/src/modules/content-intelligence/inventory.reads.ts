/**
 * Narrow stored-inventory read API for downstream first-party workflows.
 *
 * This file deliberately exposes derived page facts only. It never reads the
 * short-lived excerpt collection and has no content-source/provider import, so
 * consumers cannot accidentally turn a stored snapshot read into a crawl.
 */
import { ContentInventoryPage, ContentInventoryRun, } from './inventory.model.js';
import { inventoryPageFactsSchema, type InventoryPageFacts, } from './inventory.schemas.js';
/** Hard allocation bound; the inventory request schema currently caps at 1,000. */
export const COMPLETED_INVENTORY_PAGE_READ_LIMIT = 1000;
export interface LoadCompletedInventorySnapshotInput {
    accountId: string;
    siteId: string;
    /** Pin an already-selected run. Omit to read the newest completed run. */
    runId?: string;
}
export interface CompletedInventorySnapshot {
    runId: string;
    completedAt: Date;
    pages: InventoryPageFacts[];
}
/**
 * Load the newest (or explicitly pinned) completed inventory and its validated
 * derived facts. Partial/in-flight/failed runs never qualify. Malformed legacy
 * page rows are skipped at this trust boundary rather than passed downstream.
 */
export async function loadCompletedInventorySnapshot(input: LoadCompletedInventorySnapshotInput): Promise<CompletedInventorySnapshot | null> {
    const run = await ContentInventoryRun.findOne({
        ...(input.runId ? { _id: input.runId } : {}),
        accountId: input.accountId,
        siteId: input.siteId,
        status: 'completed',
        completedAt: { $ne: null },
    })
        .sort({ completedAt: -1, _id: -1 })
        .select({ _id: 1, completedAt: 1 })
        .lean();
    if (!run?.completedAt)
        return null;
    const rows = await ContentInventoryPage.find({
        runId: run._id,
        accountId: input.accountId,
        siteId: input.siteId,
    })
        .sort({ url: 1 })
        .limit(COMPLETED_INVENTORY_PAGE_READ_LIMIT)
        .select({ facts: 1 })
        .lean();
    const pages: InventoryPageFacts[] = [];
    for (const row of rows) {
        const parsed = inventoryPageFactsSchema.safeParse(row.facts);
        if (parsed.success)
            pages.push(parsed.data);
    }
    return {
        runId: String(run._id),
        completedAt: new Date(run.completedAt),
        pages,
    };
}
