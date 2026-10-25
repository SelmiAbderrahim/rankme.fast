import type { RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { sendLocalizedMessage } from '../../shared/i18n/localized-response.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { extractIp, recordAudit } from '../audit/index.js';
import { getKeywordDiscoveryContentSourceProvider, getSiteKeywordProvider, } from '../keyword-research/index.js';
import { getRanksDb, getRanksQueue } from './ranks.queue-holder.js';
import { altEnginePreviewSchema, cadencePatchSchema, createKeywordSchema, createKeywordsBulkSchema,
    KEYWORD_PHRASE_MAX, historyQuerySchema, keywordIdParamsSchema, keywordSuggestionsSchema,
    listKeywordsQuerySchema, keywordMarketMoveSchema, normalizeEngineTarget, siteIdParamsSchema, } from './keywords.schema.js';
import { createKeyword, createKeywordsBulk, previewAltEngineKeyword, deactivateKeyword,
    discoverKeywordSuggestions, getKeywordHistory, listKeywords, listTrackedKeywordPhrases,
    updateRankCadence, } from './keywords.service.js';
import { resolveKeywordMarket } from './keyword-market.js';
import { moveKeywordsToSiteMarket, previewKeywordMarketMove } from './keyword-market-move.service.js';
import { checkKeywordNow, checkSiteNow, getActiveRankCheckJob, getRankCheckJob, retryFailedRankCheckJob } from './rank-jobs.service.js';
const idempotencyKeySchema = z.string().trim().min(1).max(128).optional();
export const keywordSuggestionsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const body = keywordSuggestionsSchema.parse(req.body);
    const result = await discoverKeywordSuggestions({ accountId, siteId, ...body }, {
        db: getRanksDb(),
        provider: getSiteKeywordProvider(),
        contentSource: getKeywordDiscoveryContentSourceProvider(),
    });
    res.status(200).json(result);
});
export const createKeywordHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const body = createKeywordSchema.parse(req.body);
    const market = await resolveKeywordMarket({ accountId, siteId, ...body });
    const keyword = await createKeyword({
        accountId,
        siteId,
        ...body,
        ...market,
        // Normalize the alt-engine match token once, here, so the
        // stored value is exactly what the provider comparison expects.
        engineTarget: normalizeEngineTarget(body.engine, body.engineTarget),
    }, { db: getRanksDb(), ranksQueue: getRanksQueue() });
    await recordAudit({
        actorUserId: requireUserId(req.user),
        action: 'keyword.add',
        targetType: 'keyword',
        targetId: keyword.id,
        ip: extractIp(req),
        metadata: { siteId, phrase: keyword.phrase, engine: keyword.engine },
    });
    sendLocalizedMessage(req, res, 201, 'ranks.keywordAdded', { keyword });
});
export const createKeywordsBulkHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const body = createKeywordsBulkSchema.parse(req.body);
    const market = await resolveKeywordMarket({ accountId, siteId, ...body });
    const results = await createKeywordsBulk({ accountId, siteId, ...body, ...market,
        engineTarget: normalizeEngineTarget(body.engine, body.engineTarget),
        maxLength: KEYWORD_PHRASE_MAX }, { db: getRanksDb(), ranksQueue: getRanksQueue() });
    const counts = { added: 0, duplicate: 0, invalid: 0 };
    const ip = extractIp(req);
    for (const result of results) {
        counts[result.status] += 1;
        if (!result.keyword) continue;
        await recordAudit({ actorUserId: requireUserId(req.user), action: 'keyword.add',
            targetType: 'keyword', targetId: result.keyword.id, ip,
            metadata: { siteId, phrase: result.keyword.phrase, engine: result.keyword.engine } });
    }
    sendLocalizedMessage(req, res, 200, 'ranks.keywordsProcessed', { counts,
        results: results.map(({ messageKey, ...result }) => ({ ...result,
            ...(messageKey ? { message: req.t(messageKey) } : {}) })) });
});
export const trackedKeywordPhrasesHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    res.status(200).json({ keywords: await listTrackedKeywordPhrases(accountId, siteId,
        { db: getRanksDb() }) });
});
export const keywordMarketMovePreviewHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    res.status(200).json({ preview: await previewKeywordMarketMove(getRanksDb(), { accountId, siteId }) });
});
export const keywordMarketMoveHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const { token } = keywordMarketMoveSchema.parse(req.body);
    const result = await moveKeywordsToSiteMarket(getRanksDb(), { accountId, siteId, token });
    await recordAudit({ actorUserId: requireUserId(req.user), action: 'keyword.market_move',
        targetType: 'site', targetId: siteId, ip: extractIp(req),
        metadata: { moved: result.moved } });
    res.status(200).json(result);
});
export const altEnginePreviewHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const { engine } = altEnginePreviewSchema.parse(req.body);
    const preview = await previewAltEngineKeyword({ accountId, siteId, engine });
    res.status(200).json(preview);
});
export const listKeywordsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const query = listKeywordsQuerySchema.parse(req.query);
    const page = await listKeywords({ accountId, siteId, ...query }, { db: getRanksDb(), ranksQueue: getRanksQueue() });
    res.status(200).json(page);
});
export const deactivateKeywordHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = keywordIdParamsSchema.parse(req.params);
    await deactivateKeyword(accountId, id, {
        db: getRanksDb(),
        ranksQueue: getRanksQueue(),
    });
    await recordAudit({
        actorUserId: requireUserId(req.user),
        action: 'keyword.remove',
        targetType: 'keyword',
        targetId: id,
        ip: extractIp(req),
    });
    sendLocalizedMessage(req, res, 200, 'ranks.keywordDeactivated', {});
});
export const checkNowHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const result = await checkSiteNow({ accountId, siteId,
        idempotencyKey: idempotencyKeySchema.parse(req.get('Idempotency-Key')) ?? null },
    { db: getRanksDb(), ranksQueue: getRanksQueue() });
    sendLocalizedMessage(req, res, 202, 'ranks.checkQueued', {
        checkStartedAt: result.startedAt.toISOString(),
        job: result.job,
        reused: result.reused,
    });
});
export const checkKeywordNowHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = keywordIdParamsSchema.parse(req.params);
    const result = await checkKeywordNow({ accountId, keywordId: id,
        idempotencyKey: idempotencyKeySchema.parse(req.get('Idempotency-Key')) ?? null },
    { db: getRanksDb(), ranksQueue: getRanksQueue() });
    res.status(202).json({
        message: req.t('ranks.checkQueued'),
        checkStartedAt: result.startedAt.toISOString(),
        job: result.job,
        reused: result.reused,
    });
});
export const activeRankJobHandler: RequestHandler = asyncHandler(async (req, res) => {
    const { siteId } = siteIdParamsSchema.parse(req.params);
    res.status(200).json({ job: await getActiveRankCheckJob({ accountId: requireAccountId(req), siteId }, getRanksDb()) });
});
export const rankJobHandler: RequestHandler = asyncHandler(async (req, res) => {
    const { siteId } = siteIdParamsSchema.parse(req.params);
    res.status(200).json({ job: await getRankCheckJob({ accountId: requireAccountId(req), siteId,
        jobId: String(req.params.jobId ?? '') }, getRanksDb()) });
});
export const retryFailedRankJobHandler: RequestHandler = asyncHandler(async (req, res) => {
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const result = await retryFailedRankCheckJob({ accountId: requireAccountId(req), siteId,
        jobId: String(req.params.jobId ?? '') }, { db: getRanksDb(), ranksQueue: getRanksQueue() });
    res.status(202).json({ message: req.t('ranks.checkQueued'), checkStartedAt: result.startedAt.toISOString(),
        job: result.job, reused: result.reused });
});
export const updateCadenceHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const body = cadencePatchSchema.parse(req.body);
    const result = await updateRankCadence({ accountId, siteId, cadence: body.cadence }, { db: getRanksDb(), ranksQueue: getRanksQueue() });
    sendLocalizedMessage(req, res, 200, 'ranks.cadenceUpdated', {
        cadence: result.cadence,
    });
});
export const keywordHistoryHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = keywordIdParamsSchema.parse(req.params);
    const query = historyQuerySchema.parse(req.query);
    const result = await getKeywordHistory({ accountId, keywordId: id, from: query.from, to: query.to }, { db: getRanksDb(), ranksQueue: getRanksQueue() });
    res.status(200).json(result);
});
