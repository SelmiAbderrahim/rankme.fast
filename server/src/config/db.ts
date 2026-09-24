import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';
mongoose.set('strictQuery', true);
export async function connectDb(): Promise<typeof mongoose> {
    const maxAttempts = 5;
    let attempt = 0;
    let lastError: unknown;
    while (attempt < maxAttempts) {
        attempt += 1;
        try {
            const conn = await mongoose.connect(env.MONGODB_URI, {
                serverSelectionTimeoutMS: 5000,
                // AutoIndex hits the cluster on every boot in
                // production, which is expensive and racy. Ops runs sync-indexes.ts
                // out-of-band. Dev/test keeps it on for zero-friction schema edits.
                autoIndex: env.NODE_ENV !== 'production',
            });
            logger.info({ host: conn.connection.host, db: conn.connection.name }, 'mongo connected');
            return conn;
        }
        catch (err) {
            lastError = err;
            if (attempt < maxAttempts) {
                const backoff = Math.min(1000 * 2 ** (attempt - 1), 10000);
                logger.warn({ err, attempt, backoff }, 'mongo connection failed, retrying');
                await new Promise((resolve) => setTimeout(resolve, backoff));
            }
            else {
                logger.warn({ err, attempt }, 'mongo connection failed, retrying');
            }
        }
    }
    logger.error({ err: lastError }, 'mongo connection failed after retries');
    throw lastError;
}
export async function disconnectDb(): Promise<void> {
    await mongoose.disconnect();
}
