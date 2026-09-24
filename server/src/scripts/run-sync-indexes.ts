// CLI runner for the Mongoose index synchronizer.
//
// Composed for testability: the connect + sync + disconnect steps are wired
// through `runSyncIndexesCli(deps)` so the runner can be exercised end-to-end
// against injected mocks (no live Mongo required).
//
// Usage in production:
//   node --import tsx server/src/scripts/run-sync-indexes.ts
import type { Logger } from 'pino';
import type { Mongoose } from 'mongoose';
import { syncAllIndexes, type SyncIndexesResult } from './sync-indexes.js';
export interface RunSyncIndexesDeps {
    mongoose: Mongoose;
    mongoUri: string;
    logger: Logger;
}
export async function runSyncIndexesCli(deps: RunSyncIndexesDeps): Promise<SyncIndexesResult[]> {
    await deps.mongoose.connect(deps.mongoUri);
    try {
        const result = await syncAllIndexes({ mongoose: deps.mongoose, logger: deps.logger });
        deps.logger.info({ models: result.length, result }, 'mongoose index sync complete');
        return result;
    }
    finally {
        await deps.mongoose.disconnect();
    }
}
