import { vi } from 'vitest';
import { keywords, rankings, type RankCheckFailureReason } from '../../db/schema/keywords.js';
import { Site } from '../../modules/sites/sites.model.js';
import { VendorTimeoutError, VendorUnavailableError } from '../providers/errors.js';
import { createFakeBacklinkProvider, createFakeContentAnalysisProvider, createFakeRankProvider } from '../providers/fakes.js';
import { createFakeProfileSummaryProvider } from '../providers/summary/profile.js';
import { getTestDb } from './postgres.js';

export const TEST_NOW = new Date('2026-10-16T12:00:00.000Z');

/** Freeze Date only so database drivers and optional fake-provider latency keep working. */
export function freezeClock(now: Date = TEST_NOW): () => void {
    vi.useFakeTimers({ toFake: ['Date'], now });
    return () => vi.useRealTimers();
}

export type FakeMode = 'ok' | 'vendor_unavailable' | 'timeout' | 'partial';
export interface FakeBehavior {
    latencyMs?: number;
    mode?: FakeMode;
    degrade?: (result: unknown) => unknown;
}

export function withFakeBehavior<T extends object>(provider: T, behavior: FakeBehavior = {}): T {
    const { latencyMs = 0, mode = 'ok', degrade } = behavior;
    if (mode === 'partial' && degrade === undefined) {
        throw new Error('withFakeBehavior: mode "partial" needs a degrade function');
    }
    return new Proxy(provider, {
        get(target, property, receiver) {
            const value: unknown = Reflect.get(target, property, receiver);
            if (typeof value !== 'function') return value;
            return async (...args: unknown[]) => {
                if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
                const details = { provider: 'fake', operation: String(property) };
                if (mode === 'timeout') throw new VendorTimeoutError('fake provider timed out', details);
                if (mode === 'vendor_unavailable') throw new VendorUnavailableError('fake provider unavailable', details);
                const result: unknown = await (value as (...input: unknown[]) => unknown).apply(target, args);
                return mode === 'partial' ? (degrade as (input: unknown) => unknown)(result) : result;
            };
        },
    });
}

export const resourceFakes = {
    rank: (behavior?: FakeBehavior) => withFakeBehavior(createFakeRankProvider(), behavior),
    backlinks: (behavior?: FakeBehavior) => withFakeBehavior(createFakeBacklinkProvider(), behavior),
    contentAnalysis: (behavior?: FakeBehavior) => withFakeBehavior(createFakeContentAnalysisProvider(), behavior),
    aiSummary: (behavior?: FakeBehavior) => withFakeBehavior(createFakeProfileSummaryProvider(), behavior),
};

export const KEYWORD_STATES = ['ranked', 'notInTop100', 'failedLastCheck', 'neverChecked', 'lost', 'new', 'improved', 'declined'] as const;
export type KeywordState = (typeof KEYWORD_STATES)[number];
interface KeywordHistory {
    checks: Array<number | null>;
    failedReason?: RankCheckFailureReason;
}
const HISTORIES: Record<KeywordState, KeywordHistory> = {
    ranked: { checks: [7] },
    notInTop100: { checks: [null] },
    failedLastCheck: { checks: [], failedReason: 'vendor_unavailable' },
    neverChecked: { checks: [] },
    lost: { checks: [12, null] },
    new: { checks: [null, 40] },
    improved: { checks: [20, 8] },
    declined: { checks: [5, 18] },
};

export interface SiteWithKeywords {
    siteId: string;
    accountId: string;
    keywordIds: Record<KeywordState, string>;
}

/** Seed current keyword/ranking storage; newest observations are one day before now. */
export async function siteWithKeywords(accountId: string, options: { siteId?: string; now?: Date } = {}): Promise<SiteWithKeywords> {
    const now = options.now ?? TEST_NOW;
    const siteId = options.siteId ?? String((await Site.create({ accountId, url: 'https://keywords.example', domain: 'keywords.example', displayName: '' }))._id);
    const db = getTestDb();
    const keywordIds = {} as Record<KeywordState, string>;
    for (const state of KEYWORD_STATES) {
        const history = HISTORIES[state];
        const [row] = await db.insert(keywords).values({
            accountId, siteId, phrase: `fixture ${state}`, locationCode: 2840, languageCode: 'en',
            lastFailedCheckAt: history.failedReason === undefined ? null : new Date(now.getTime() - 86_400_000),
            lastFailedReason: history.failedReason ?? null,
        }).returning({ id: keywords.id });
        const id = (row as { id: string }).id;
        keywordIds[state] = id;
        for (const [index, position] of history.checks.entries()) {
            await db.insert(rankings).values({ keywordId: id, position, checkedAt: new Date(now.getTime() - (history.checks.length - index) * 86_400_000), source: 'fresh' });
        }
    }
    return { siteId, accountId, keywordIds };
}
