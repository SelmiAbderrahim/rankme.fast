import type { Queue } from 'bullmq';
let landscapeQueue: Queue | null = null;
let landscapeDb: ApplicationDb | null = null;
export function setCompetitorLandscapeQueue(queue: Queue | null): void {
    landscapeQueue = queue;
}
export function getCompetitorLandscapeQueue(): Queue | null {
    return landscapeQueue;
}
export function setCompetitorLandscapeDb(db: ApplicationDb | null): void {
    landscapeDb = db;
}
export function getCompetitorLandscapeDb(): ApplicationDb | null {
    return landscapeDb;
}
