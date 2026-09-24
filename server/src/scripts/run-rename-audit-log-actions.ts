// CLI runner for the one-shot Mongo → SEO audit-log rename (Audit D.1).
// Excluded from coverage like the other CLI seams — the underlying logic in
// `rename-audit-log-actions.ts` is fully covered.
//
// Usage:
//   node --import tsx server/src/scripts/run-rename-audit-log-actions.ts
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AuditLog } from '../modules/audit/audit-log.model.js';
import { renameAuditLogActions } from './rename-audit-log-actions.js';
async function main(): Promise<void> {
    await mongoose.connect(env.MONGODB_URI);
    try {
        const result = await renameAuditLogActions(AuditLog);
        logger.info(result, 'audit-log rename complete');
    }
    finally {
        await mongoose.disconnect();
    }
}
main().catch((err) => {
    logger.error({ err }, 'audit-log rename failed');
    process.exitCode = 1;
});
