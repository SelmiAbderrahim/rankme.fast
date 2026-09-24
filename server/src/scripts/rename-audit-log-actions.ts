/**
 * One-shot, idempotent Mongo migration renaming legacy audit-log rows onto the
 * SEO action + target-type enums (the CLAUDE.md rebrand).
 *
 * Legacy `action` values from the old Dockstash backup product map onto the
 * closest SEO enum member. Legacy `targetType='project'` becomes `'site'`.
 *
 * Runs directly against the AuditLog collection so the DB user is the same
 * app user the api container already uses. Safe to re-run: rows that already
 * carry the new value are left untouched.
 *
 * Usage (inside the api container):
 *   node --import tsx server/src/scripts/run-rename-audit-log-actions.ts
 */
import type { Model } from 'mongoose';
import type { AuditLogDocument } from '../modules/audit/audit-log.model.js';
export const LEGACY_ACTION_MAP: Record<string, string> = {
    'backup.run': 'audit.run',
    'backup.restore': 'audit.run',
    'backup.delete': 'site.delete',
};
export const LEGACY_TARGET_TYPE_MAP: Record<string, string> = {
    project: 'site',
};
export interface RenameAuditLogActionsResult {
    actionRenames: Record<string, number>;
    targetTypeRenames: Record<string, number>;
    totalActionRows: number;
    totalTargetRows: number;
}
/**
 * Rename legacy audit-log rows in-place. Returns per-value counts so operators
 * (and the accompanying test) can prove the migration touched every legacy row.
 */
export async function renameAuditLogActions(model: Model<AuditLogDocument>): Promise<RenameAuditLogActionsResult> {
    const actionRenames: Record<string, number> = {};
    let totalActionRows = 0;
    for (const [oldValue, newValue] of Object.entries(LEGACY_ACTION_MAP)) {
        const res = await model.updateMany({ action: oldValue }, { $set: { action: newValue } });
        const modified = res.modifiedCount ?? 0;
        actionRenames[oldValue] = modified;
        totalActionRows += modified;
    }
    const targetTypeRenames: Record<string, number> = {};
    let totalTargetRows = 0;
    for (const [oldValue, newValue] of Object.entries(LEGACY_TARGET_TYPE_MAP)) {
        const res = await model.updateMany({ targetType: oldValue }, { $set: { targetType: newValue } });
        const modified = res.modifiedCount ?? 0;
        targetTypeRenames[oldValue] = modified;
        totalTargetRows += modified;
    }
    return { actionRenames, targetTypeRenames, totalActionRows, totalTargetRows };
}
