/**
 * Dependency builders for the stored Search Console / GA4 reads. They bind the
 * Postgres snapshot readers to one site binding generation, so a read never
 * mixes rows from a previous property. Shared by the Google routes and by the
 * read-only assistant/MCP tools; nothing here talks to Google.
 */
import type { Db } from '../../db/client.js';
import { env } from '../../config/env.js';
import { readLatestSnapshotDate, readPreviousSnapshotTotals, readSearchAnalytics, } from '../gsc-snapshots/index.js';
import { readGa4Metrics, readLatestGa4SnapshotDate, readPreviousGa4Totals, } from '../ga4-snapshots/index.js';
import type { Ga4SummaryReadDeps } from './google-analytics.service.js';
import type { GscSummaryReadDeps } from './google-connections.service.js';

export function buildGscSummaryDeps(db: Db, bindingGenerationId: string): GscSummaryReadDeps {
    return {
        readLatestSnapshotDate: (site, dimensionSet, windowDays) => readLatestSnapshotDate(db, site, dimensionSet, windowDays, bindingGenerationId),
        readSearchAnalytics: (site, dimensionSet, range, windowDays) => readSearchAnalytics(db, site, dimensionSet, range, windowDays, bindingGenerationId),
        readPreviousTotals: async (site, beforeDate, windowDays) => {
            const totals = await readPreviousSnapshotTotals(db, site, 'query', beforeDate, windowDays, bindingGenerationId);
            return totals ? { clicks: totals.clicks, impressions: totals.impressions } : null;
        },
    };
}

export function buildGa4SummaryReadDeps(db: Db, bindingGenerationId: string, lastSyncedAt?: Date | null): Ga4SummaryReadDeps {
    return {
        lagDays: env.GA4_LAG_DAYS,
        lastSyncedAt: lastSyncedAt ?? null,
        readLatest: (site, dimensionSet, windowDays) => readLatestGa4SnapshotDate(db, site, dimensionSet, windowDays, bindingGenerationId),
        readRows: (site, dimensionSet, windowDays, range) => readGa4Metrics(db, site, dimensionSet, windowDays, range, bindingGenerationId),
        readPreviousTotals: async (site, dimensionSet, windowDays, beforeDate) => {
            const totals = await readPreviousGa4Totals(db, site, dimensionSet, windowDays, beforeDate, bindingGenerationId);
            return totals
                ? {
                    sessions: totals.sessions,
                    activeUsers: totals.activeUsers,
                    engagedSessions: totals.engagedSessions,
                    keyEvents: totals.keyEvents,
                }
                : null;
        },
    };
}
