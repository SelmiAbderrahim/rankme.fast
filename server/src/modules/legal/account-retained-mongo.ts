import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { AuditLog } from '../audit/index.js';
const MONGO_ACTOR_DOMAIN = 'rankme.fast:deleted-mongo-actor:v1\0';
const MONGO_REFERENCE_DOMAIN = 'rankme.fast:deleted-mongo-reference:v1\0';
function digest(domain: string, value: string): string {
    return createHash('sha256').update(domain).update(value).digest('hex');
}
export function deletedMongoActorId(accountId: string): Types.ObjectId {
    return new Types.ObjectId(digest(MONGO_ACTOR_DOMAIN, accountId).slice(0, 24));
}
export function deletedMongoReference(value: string): string {
    // Retained references are fed back through this sanitizer on lifecycle
    // retries and on later deletion of a cross-account audit actor. Keeping the
    // transform idempotent avoids both needless churn and broken durable
    // idempotency keys.
    if (value.startsWith('redacted:'))
        return value;
    return `redacted:${digest(MONGO_REFERENCE_DOMAIN, value)}`;
}
export interface RetainedMongoSanitizationInput {
    accountId: string;
    /** Account/site/run/etc. ids captured before the owned graph is erased. */
    resourceIds: ReadonlySet<string>;
}
export interface RetainedMongoSanitizationStats {
    auditLogs: number;
}
async function sanitizeAuditLogs(input: RetainedMongoSanitizationInput): Promise<number> {
    const resourceIds = [...new Set([input.accountId, ...input.resourceIds])];
    const documents = await AuditLog.find({
        $or: [
            { actorUserId: input.accountId },
            { targetId: { $in: resourceIds } },
        ],
    }).lean();
    if (documents.length === 0)
        return 0;
    const pseudonymousActor = deletedMongoActorId(input.accountId);
    await AuditLog.bulkWrite(documents.map((document) => {
        const actorMatches = String(document.actorUserId) === input.accountId;
        const targetId = String(document.targetId);
        const targetMatches = resourceIds.includes(targetId);
        return {
            updateOne: {
                filter: { _id: document._id },
                update: {
                    $set: {
                        ...(actorMatches ? { actorUserId: pseudonymousActor } : {}),
                        ...(targetMatches ? { targetId: deletedMongoReference(targetId) } : {}),
                        ip: '',
                        metadata: { redacted: true },
                        ...(document.idempotencyKey
                            ? { idempotencyKey: deletedMongoReference(document.idempotencyKey) }
                            : {}),
                    },
                },
            },
        };
    }));
    return documents.length;
}
/** Preserve only operational evidence after removing personal links. */
export async function sanitizeRetainedMongoData(input: RetainedMongoSanitizationInput): Promise<RetainedMongoSanitizationStats> {
    const auditLogs = await sanitizeAuditLogs(input);
    return { auditLogs };
}
