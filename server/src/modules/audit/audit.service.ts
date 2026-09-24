import type { Request } from 'express';
import { logger } from '../../config/logger.js';
import { AuditLog, type AuditAction, type AuditLogHydrated, type AuditTargetType, } from './audit-log.model.js';
export interface RecordAuditInput {
    actorUserId: string;
    action: AuditAction;
    targetType: AuditTargetType;
    targetId: string;
    ip?: string;
    metadata?: Record<string, unknown>;
}
/**
 * Append a single audit entry. Best-effort — a persistence failure is logged
 * but never surfaced to the caller (audit MUST NOT block the primary action).
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
    try {
        await AuditLog.create({
            actorUserId: input.actorUserId,
            action: input.action,
            targetType: input.targetType,
            targetId: input.targetId,
            ip: input.ip ?? '',
            metadata: input.metadata ?? {},
        });
    }
    catch (err) {
        logger.error({ err, action: input.action, actorUserId: input.actorUserId }, 'audit.recordAudit failed');
    }
}
/**
 * Durable, replay-safe audit persistence for an irreversible finalization.
 * Unlike the ordinary best-effort logger, failures surface to the caller so
 * the owning lifecycle can retain its tombstone and retry safely.
 */
export async function recordAuditOnce(idempotencyKey: string, input: RecordAuditInput): Promise<boolean> {
    try {
        const result = await AuditLog.updateOne({ idempotencyKey }, {
            $setOnInsert: {
                actorUserId: input.actorUserId,
                action: input.action,
                targetType: input.targetType,
                targetId: input.targetId,
                ip: input.ip ?? '',
                metadata: input.metadata ?? {},
                idempotencyKey,
            },
        }, { upsert: true });
        return result.upsertedCount === 1;
    }
    catch (error) {
        // A concurrent upsert can lose to the unique index after both callers
        // observe no row. That means the required evidence already exists.
        if (error instanceof Error && (error as {
            code?: unknown;
        }).code === 11000) {
            return false;
        }
        throw error;
    }
}
/**
 * Extract the source IP from a request. Trusts `X-Forwarded-For` per the
 * documented `app.set('trust proxy', 1)` config; falls back to socket address.
 */
export function extractIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        /* c8 ignore next -- split of a non-empty string always yields a defined [0] */
        return forwarded.split(',')[0]?.trim() ?? '';
    }
    if (Array.isArray(forwarded) && forwarded.length > 0) {
        /* c8 ignore next -- split of a stringified head always yields a defined [0] */
        return String(forwarded[0]).split(',')[0]?.trim() ?? '';
    }
    return req.ip ?? '';
}
export async function listAuditForUser(userId: string, limit = 100): Promise<AuditLogHydrated[]> {
    return AuditLog.find({ actorUserId: userId }).sort({ createdAt: -1 }).limit(limit);
}
