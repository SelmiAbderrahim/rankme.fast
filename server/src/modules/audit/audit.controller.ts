import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { listAuditForUser } from './audit.service.js';
export const listAudit: RequestHandler = asyncHandler(async (req, res) => {
    const userId = requireUserId(req.user);
    const rawLimit = Number.parseInt(String(req.query.limit ?? '100'), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 && rawLimit <= 500
        ? rawLimit
        : 100;
    const entries = await listAuditForUser(userId, limit);
    res.status(200).json({
        entries: entries.map((entry) => ({
            id: String(entry._id),
            action: entry.action,
            targetType: entry.targetType,
            targetId: entry.targetId,
            ip: entry.ip,
            metadata: entry.metadata,
            createdAt: (entry as unknown as {
                createdAt: Date;
            }).createdAt.toISOString(),
        })),
    });
});
