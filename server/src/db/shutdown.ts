import { disconnectDb } from '../config/db.js';
import { logger } from '../config/logger.js';
import { closeDb } from './client.js';
// Graceful shutdown for BOTH datastores. allSettled so a failure closing one
// never blocks closing the other.
export async function closeDatastores(): Promise<void> {
    const results = await Promise.allSettled([disconnectDb(), closeDb()]);
    for (const result of results) {
        if (result.status === 'rejected') {
            logger.warn({ err: result.reason }, 'datastore close failed during shutdown');
        }
    }
}
