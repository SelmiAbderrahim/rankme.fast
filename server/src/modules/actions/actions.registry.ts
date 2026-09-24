import type { ActionSourceType } from '../../db/schema/action-events.js';
import type { CandidateAction, SourceStatus, } from './actions.types.js';
export interface SourceReaderContext {
    accountId: string;
    siteId: string;
    db: ApplicationDb;
}
export interface SourceReaderResult {
    actions: CandidateAction[];
    status: SourceStatus;
    lastObservedAt?: string;
}
export type SourceReader = (ctx: SourceReaderContext) => Promise<SourceReaderResult>;
// Ordered list of registered adapters; iteration order = deterministic default.
const registry = new Map<ActionSourceType, SourceReader>();
export function registerSource(sourceType: ActionSourceType, reader: SourceReader): void {
    registry.set(sourceType, reader);
}
export function getSourceReaders(): ReadonlyMap<ActionSourceType, SourceReader> {
    return registry;
}
export function clearSourceRegistry(): void {
    registry.clear();
}
