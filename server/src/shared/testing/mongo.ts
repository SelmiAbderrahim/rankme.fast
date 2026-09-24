import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
let mongod: MongoMemoryServer | null = null;
export async function startMemoryMongo(): Promise<string> {
    mongod = await MongoMemoryServer.create({
        instance: {
            ip: '127.0.0.1',
            // Match Vitest's saturated-host hook budget. The library default is
            // only 10 seconds, which can expire before mongod is scheduled.
            launchTimeout: 120000,
        },
    });
    const uri = mongod.getUri();
    /* c8 ignore next 3 -- tests always start with readyState 0 (disconnected); the guard is belt-and-braces for hypothetical concurrent setups. */
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(uri);
    }
    return uri;
}
export async function stopMemoryMongo(): Promise<void> {
    /* c8 ignore next 3 -- tests always stop from a connected state; the guard is belt-and-braces. */
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
    /* c8 ignore next 4 -- mongod is always set between start/stop pairs; the null guard is defensive. */
    if (mongod) {
        await mongod.stop();
        mongod = null;
    }
}
export async function clearCollections(): Promise<void> {
    const db = mongoose.connection.db;
    if (!db)
        return;
    const collections = await db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
}
