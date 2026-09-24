import { Types } from 'mongoose';
import { AuditRun } from './audit-run.model.js';
import { AuditedPage } from './audited-page.model.js';
export const PAGES_AUDIT_INVENTORY_MAX = 5000;
export interface AuditPageInventoryRow {
    url: string;
    title: string | null;
    isIndexable: boolean;
    nonIndexableReason: string | null;
    onPageScore: number | null;
}
export interface AuditPageInventory {
    runId: string | null;
    rows: AuditPageInventoryRow[];
    fetchedCount: number;
    truncated: boolean;
}
/** Bounded account/site-scoped projection used by Pages through this module's barrel. */
export async function readLatestCompletedPageInventory(accountId: string, siteId: string, limit = PAGES_AUDIT_INVENTORY_MAX): Promise<AuditPageInventory> {
    if (!Types.ObjectId.isValid(accountId) || !Types.ObjectId.isValid(siteId)) {
        return { runId: null, rows: [], fetchedCount: 0, truncated: false };
    }
    const run = await AuditRun.findOne({
        accountId,
        siteId,
        kind: 'site',
        status: 'succeeded',
    })
        .sort({ _id: -1 })
        .select({ _id: 1 })
        .lean();
    if (!run)
        return { runId: null, rows: [], fetchedCount: 0, truncated: false };
    const bounded = Math.min(Math.max(limit, 1), PAGES_AUDIT_INVENTORY_MAX);
    const docs = await AuditedPage.find({ runId: run._id }, {
        _id: 0,
        url: 1,
        title: 1,
        isIndexable: 1,
        nonIndexableReason: 1,
        onPageScore: 1,
    })
        .sort({ url: 1, _id: 1 })
        .limit(bounded + 1)
        .lean();
    return {
        runId: String(run._id),
        fetchedCount: docs.length,
        truncated: docs.length > bounded,
        rows: docs.slice(0, bounded).map((row) => ({
            url: row.url,
            title: row.title ?? null,
            isIndexable: row.isIndexable,
            nonIndexableReason: row.nonIndexableReason ?? null,
            onPageScore: Number.isFinite(row.onPageScore) ? row.onPageScore : null,
        })),
    };
}
