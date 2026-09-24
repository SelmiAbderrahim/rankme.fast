import mongoose, { type InferSchemaType, type HydratedDocument } from 'mongoose';
export const AUDIT_ACTIONS = [
    'site.create',
    'site.delete',
    'site.pause',
    'site.resume',
    'audit.run',
    'report.view',
    'report_export.created',
    'report_export.rendered',
    'report_export.downloaded',
    'report_export.deleted',
    'report_export.refused',
    'report_export.share_created',
    'report_export.share_viewed',
    'report_export.share_revoked',
    'report_export.expired',
    'report_export.purged',
    'keyword.add',
    'keyword.remove',
    'google.connect',
    'google.set_property',
    'google.set_ga4_property',
    'google.set_site_bindings',
    'google.unlink_site',
    'google.disconnect',
    'data.export',
    'data.delete.requested',
    'data.delete.cancelled',
    'data.delete.blocked',
    'data.delete.completed',
    'admin.role_change',
    'admin.suspend',
    'admin.unsuspend',
    'superadmin.role_change',
    'superadmin.suspend',
    'superadmin.unsuspend',
    'superadmin.dlq_requeue',
    'superadmin.kill_switch',
    'superadmin.monitor_reconcile',
    'superadmin.cache_invalidate',
    'team.invite',
    'team.accept',
    'team.remove',
    // rankme-enterprise-orgs 02.
    'team.role_change',
    'team.invite_resend',
    'team.reject',
    'team.access_change',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_TARGET_TYPES = [
    'site',
    'keyword',
    'user',
    'webhook',
    'team_member',
    'queue_job',
    'kill_switch',
    'monitor',
    'cache_key',
    'report_export',
    'report_export_share',
] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];
const auditLogSchema = new mongoose.Schema({
    actorUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        // The single `actorUserId` index is redundant
        // with the compound `{ actorUserId: 1, createdAt: -1 }` below, which
        // serves every `{ actorUserId }`-prefix query via left-most.
    },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    targetType: { type: String, enum: AUDIT_TARGET_TYPES, required: true },
    targetId: { type: String, required: true },
    // Set only for operations whose success must survive retries. The unique
    // index turns concurrent upserts into one durable audit entry.
    idempotencyKey: { type: String, default: null },
    ip: { type: String, default: '' },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({}),
    },
}, { timestamps: { createdAt: true, updatedAt: false } });
auditLogSchema.index({ actorUserId: 1, createdAt: -1 });
auditLogSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
export type AuditLogDocument = InferSchemaType<typeof auditLogSchema>;
export type AuditLogHydrated = HydratedDocument<AuditLogDocument>;
export const AuditLog = (mongoose.models.AuditLog as mongoose.Model<AuditLogDocument>) ||
    mongoose.model('AuditLog', auditLogSchema);
