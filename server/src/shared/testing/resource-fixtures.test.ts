import { eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { keywords, rankings } from '../../db/schema/keywords.js';
import { listKeywords } from '../../modules/ranks/keywords.service.js';
import { Site } from '../../modules/sites/sites.model.js';
import { VendorTimeoutError, VendorUnavailableError } from '../providers/errors.js';
import { FAKE_RANK_RESULT } from '../providers/fakes.js';
import { KEYWORD_STATES, TEST_NOW, freezeClock, resourceFakes, siteWithKeywords, withFakeBehavior } from './resource-fixtures.js';
import { startMemoryMongo, stopMemoryMongo } from './mongo.js';
import { getTestDb, startTestPostgres, stopTestPostgres } from './postgres.js';

const rankInput = { keyword: 'example', domain: 'example.com', locationCode: 2840, languageCode: 'en', device: 'desktop' as const };

describe('controllable resource fixtures', () => {
    afterEach(() => vi.useRealTimers());
    it('pins Date while keeping timers real, and restores the clock', async () => {
        const before = Date.now();
        const restore = freezeClock();
        expect(new Date()).toEqual(TEST_NOW);
        await new Promise((resolve) => setTimeout(resolve, 1));
        restore();
        expect(Date.now()).toBeGreaterThanOrEqual(before);
        freezeClock(new Date('2027-01-01T00:00:00Z'));
        expect(Date.now()).toBe(Date.parse('2027-01-01T00:00:00Z'));
    });
    it('retains provider properties and method receivers with optional latency', async () => {
        const provider = withFakeBehavior({ label: 'ok', async read() { return this.label; } }, { latencyMs: 10 });
        expect(provider.label).toBe('ok');
        const started = performance.now();
        await expect(provider.read()).resolves.toBe('ok');
        expect(performance.now() - started).toBeGreaterThanOrEqual(8);
    });
    it('returns typed unavailable and timeout failures without calling the provider', async () => {
        const call = vi.fn();
        await expect(withFakeBehavior({ call }, { mode: 'vendor_unavailable' }).call()).rejects.toBeInstanceOf(VendorUnavailableError);
        expect(call).not.toHaveBeenCalled();
        await expect(resourceFakes.rank({ mode: 'timeout' }).checkRank(rankInput)).rejects.toBeInstanceOf(VendorTimeoutError);
    });
    it('degrades successful results only with an explicit transform', async () => {
        const provider = resourceFakes.rank({ mode: 'partial', degrade: (value) => ({ ...(value as object), serpTopUrls: [] }) });
        const result = await provider.checkRank(rankInput);
        expect(result.position).toBe(FAKE_RANK_RESULT.position);
        expect(result.serpTopUrls).toEqual([]);
        expect(() => withFakeBehavior({}, { mode: 'partial' })).toThrow(/needs a degrade function/u);
    });
    it('builds every supported resource fake', () => {
        expect(typeof resourceFakes.backlinks().getSummary).toBe('function');
        expect(typeof resourceFakes.contentAnalysis().listMarkets).toBe('function');
        expect(typeof resourceFakes.aiSummary().summarize).toBe('function');
    });
});

describe('site keyword state fixtures', () => {
    beforeAll(async () => { await startMemoryMongo(); await startTestPostgres(); });
    afterEach(async () => { await getTestDb().delete(keywords); });
    afterAll(async () => { await stopTestPostgres(); await stopMemoryMongo(); });

    it('seeds the current rank storage, including failed and never checked states', async () => {
        const fixture = await siteWithKeywords(new Types.ObjectId().toHexString());
        expect(await Site.exists({ _id: fixture.siteId })).toBeTruthy();
        expect(Object.keys(fixture.keywordIds)).toEqual([...KEYWORD_STATES]);
        const stored = await getTestDb().select().from(keywords).where(eq(keywords.id, fixture.keywordIds.failedLastCheck));
        expect(stored[0]?.lastFailedReason).toBe('vendor_unavailable');
        expect(stored[0]?.lastFailedCheckAt).toEqual(new Date(TEST_NOW.getTime() - 86_400_000));
        const never = await getTestDb().select().from(keywords).where(eq(keywords.id, fixture.keywordIds.neverChecked));
        expect(never[0]?.lastFailedCheckAt).toBeNull();
        for (const state of ['failedLastCheck', 'neverChecked'] as const) {
            expect(await getTestDb().select().from(rankings).where(eq(rankings.keywordId, fixture.keywordIds[state]))).toEqual([]);
        }
        expect(await getTestDb().select().from(rankings).where(eq(rankings.keywordId, fixture.keywordIds.ranked))).toHaveLength(1);
        expect(await getTestDb().select().from(rankings).where(eq(rankings.keywordId, fixture.keywordIds.improved))).toHaveLength(2);
    });

    it('is interpreted by the current keyword reader with an existing site and explicit clock', async () => {
        const accountId = new Types.ObjectId().toHexString();
        const site = await Site.create({ accountId, url: 'https://existing.example', domain: 'existing.example' });
        const fixture = await siteWithKeywords(accountId, { siteId: String(site._id), now: TEST_NOW });
        expect(fixture.siteId).toBe(String(site._id));
        const page = await listKeywords({ accountId, siteId: fixture.siteId, limit: 100 }, { db: getTestDb() as never, ranksQueue: null });
        const item = (state: (typeof KEYWORD_STATES)[number]) => page.keywords.find((row) => row.id === fixture.keywordIds[state]);
        expect(page.keywords).toHaveLength(8);
        expect(item('improved')?.delta).toBe(12);
        expect(item('declined')?.delta).toBe(-13);
        expect(item('lost')).toMatchObject({ previousPosition: 12, latestPosition: null });
        expect(item('new')).toMatchObject({ previousPosition: null, latestPosition: 40 });
        expect(item('notInTop100')).toMatchObject({ latestPosition: null, lastCheckedAt: new Date(TEST_NOW.getTime() - 86_400_000).toISOString() });
        expect(item('failedLastCheck')).toMatchObject({ lastFailedReason: 'vendor_unavailable', lastCheckedAt: null });
        expect(item('neverChecked')).toMatchObject({ lastFailedReason: null, lastCheckedAt: null });
    });
});
