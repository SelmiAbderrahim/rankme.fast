import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keywords, rankings } from '../../db/schema/keywords.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { getSiteMarket } from '../sites/index.js';

const MARKET_MOVE_ENGINES = ['google', 'bing'] as const;
type MarketEngine = (typeof MARKET_MOVE_ENGINES)[number];
type Market = { locationCode: number; languageCode: string; device: 'desktop' | 'mobile' };
type MoveInput = { accountId: string; siteId: string };
type Movable = { id: string; phrase: string; engine: MarketEngine; trackLocalPack: boolean };

export interface KeywordMarketMovePreview {
    target: Market;
    tracked: number;
    inTarget: number;
    movable: number;
    alreadyTracked: number;
    withHistory: number;
    resumesHistory: number;
    token: string;
}

const stale = () => HttpError.conflict({ code: 'RANKS_ERRORS_MARKET_MOVE_STALE',
    messageKey: 'ranks.errors.marketMoveStale' });
const tupleKey = (engine: string, phrase: string) => `${engine}\u0000${phrase}`;

async function targetMarket(input: MoveInput): Promise<Market> {
    const market = await getSiteMarket(input.accountId, input.siteId, { offlineCatalog: true });
    if (market.source === 'assumed') throw HttpError.conflict({
        code: 'RANKS_ERRORS_MARKET_MOVE_NO_DEFAULT', messageKey: 'ranks.errors.marketMoveNoDefault',
    });
    return { locationCode: market.locationCode, languageCode: market.languageCode,
        device: market.device };
}

async function withHistory(db: Db, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await db.selectDistinct({ keywordId: rankings.keywordId }).from(rankings)
        .where(inArray(rankings.keywordId, [...ids]));
    return new Set(rows.map((row) => row.keywordId));
}

async function planMove(db: Db, input: MoveInput, target: Market): Promise<{
    preview: KeywordMarketMovePreview; movable: Movable[];
}> {
    const active = await db.select({ id: keywords.id, phrase: keywords.phrase,
        engine: keywords.engine, locationCode: keywords.locationCode,
        languageCode: keywords.languageCode, device: keywords.device,
        trackLocalPack: keywords.trackLocalPack }).from(keywords).where(and(
        eq(keywords.accountId, input.accountId), eq(keywords.siteId, input.siteId),
        eq(keywords.active, true), inArray(keywords.engine, [...MARKET_MOVE_ENGINES]),
    )).orderBy(keywords.createdAt, keywords.id);
    const matches = (row: typeof active[number]) => row.locationCode === target.locationCode &&
        row.languageCode.toLowerCase() === target.languageCode && row.device === target.device;
    const outside = active.filter((row) => !matches(row));
    const existing = outside.length ? await db.select({ id: keywords.id,
        phrase: keywords.phrase, engine: keywords.engine, active: keywords.active })
        .from(keywords).where(and(eq(keywords.accountId, input.accountId),
            eq(keywords.siteId, input.siteId), eq(keywords.locationCode, target.locationCode),
            eq(keywords.languageCode, target.languageCode), eq(keywords.device, target.device),
            inArray(keywords.engine, [...MARKET_MOVE_ENGINES]),
            inArray(keywords.phrase, [...new Set(outside.map((row) => row.phrase))]))) : [];
    const targets = new Map(existing.map((row) => [tupleKey(row.engine, row.phrase), row]));
    const claimed = new Set<string>();
    const movable: Movable[] = [];
    let alreadyTracked = 0;
    for (const row of outside) {
        const key = tupleKey(row.engine, row.phrase);
        if (targets.get(key)?.active || claimed.has(key)) {
            alreadyTracked += 1;
            continue;
        }
        claimed.add(key);
        movable.push({ id: row.id, phrase: row.phrase, engine: row.engine as MarketEngine,
            trackLocalPack: row.trackLocalPack });
    }
    const oldHistory = await withHistory(db, movable.map((row) => row.id));
    const targetHistory = await withHistory(db, movable.map((row) =>
        targets.get(tupleKey(row.engine, row.phrase))?.id).filter((id): id is string => !!id));
    const token = createHash('sha256').update(JSON.stringify({ target,
        active: [...active].sort((a, b) => a.id.localeCompare(b.id)),
        targetRows: [...existing].sort((a, b) => a.id.localeCompare(b.id)),
        oldHistory: [...oldHistory].sort(), targetHistory: [...targetHistory].sort(),
    })).digest('hex');
    return { movable, preview: { target, tracked: active.length,
        inTarget: active.length - outside.length, movable: movable.length, alreadyTracked,
        withHistory: oldHistory.size, resumesHistory: targetHistory.size, token } };
}

export async function previewKeywordMarketMove(db: Db, input: MoveInput): Promise<KeywordMarketMovePreview> {
    return (await planMove(db, input, await targetMarket(input))).preview;
}

/** Retain old market history, resume target history when present, and never enqueue a check. */
export async function moveKeywordsToSiteMarket(db: Db, input: MoveInput & { token: string }): Promise<{
    moved: number; preview: KeywordMarketMovePreview;
}> {
    const target = await targetMarket(input);
    return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'rank-market-move'}), hashtext(${input.siteId}))`);
        const plan = await planMove(txDb, input, target);
        if (plan.preview.token !== input.token) throw stale();
        const now = new Date();
        for (const row of plan.movable) {
            const removed = await txDb.update(keywords).set({ active: false, updatedAt: now })
                .where(and(eq(keywords.id, row.id), eq(keywords.accountId, input.accountId),
                    eq(keywords.active, true))).returning({ id: keywords.id });
            if (removed.length === 0) throw stale();
            const added = await txDb.insert(keywords).values({ accountId: input.accountId,
                siteId: input.siteId, phrase: row.phrase, engine: row.engine, engineTarget: null,
                locationCode: target.locationCode, languageCode: target.languageCode,
                device: target.device, trackLocalPack: row.trackLocalPack })
                .onConflictDoUpdate({ target: [keywords.siteId, keywords.engine, keywords.phrase,
                    keywords.locationCode, keywords.languageCode, keywords.device],
                set: { active: true, updatedAt: now, trackLocalPack: row.trackLocalPack },
                setWhere: sql`${keywords.active} = false` }).returning({ id: keywords.id });
            if (added.length === 0) throw stale();
        }
        return { moved: plan.movable.length,
            preview: (await planMove(txDb, input, target)).preview };
    });
}
