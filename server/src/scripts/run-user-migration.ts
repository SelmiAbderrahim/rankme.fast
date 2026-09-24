// CLI runner for the one-shot Mongo → Better Auth user migration. Excluded
// from coverage like server.ts (integration seam, no branching logic). Usage:
//   node --import tsx src/scripts/run-user-migration.ts
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { db, closeDb } from '../db/client.js';
import { migrateUsersToBetterAuth } from './migrate-users-to-better-auth.js';
async function main(): Promise<void> {
    await mongoose.connect(env.MONGODB_URI);
    try {
        const result = await migrateUsersToBetterAuth(db);
        logger.info(result, 'user migration complete');
    }
    finally {
        await mongoose.disconnect();
        await closeDb();
    }
}
main().catch((err) => {
    logger.error({ err }, 'user migration failed');
    process.exitCode = 1;
});
