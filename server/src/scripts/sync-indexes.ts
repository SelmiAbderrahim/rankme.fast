/**
 * One-shot ops script — synchronize every registered Mongoose model's indexes
 * with the live database.
 *
 * `mongoose.connect` in production runs with `autoIndex: false` (see
 * `config/db.ts`), so schema-added indexes never fire on boot. Operators run
 * this script during deploy windows.
 *
 * Usage (inside the api container):
 *   node --import tsx server/src/scripts/run-sync-indexes.ts
 */
import type { Logger } from 'pino';
import type { Mongoose, Model } from 'mongoose';
export interface SyncIndexesResult {
    model: string;
    dropped: string[];
}
export interface SyncIndexesDeps {
    mongoose: Mongoose;
    logger?: Logger;
}
/**
 * Runs `syncIndexes()` on every registered model. Returns the per-model result
 * so tests can assert every model was touched exactly once.
 */
export async function syncAllIndexes(deps: SyncIndexesDeps): Promise<SyncIndexesResult[]> {
    const results: SyncIndexesResult[] = [];
    const modelNames = deps.mongoose.modelNames();
    for (const name of modelNames) {
        const model = deps.mongoose.model(name) as Model<unknown>;
        const dropped = (await model.syncIndexes()) as unknown as string[];
        deps.logger?.info({ model: name, dropped }, 'model indexes synchronized');
        results.push({ model: name, dropped: dropped ?? [] });
    }
    return results;
}
