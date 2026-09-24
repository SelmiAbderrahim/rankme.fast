import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { sendLocalizedMessage } from '../../shared/i18n/localized-response.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { extractIp, recordAudit } from '../audit/index.js';
import { getKeywordDiscoveryContentSourceProvider, getSiteKeywordProvider, } from '../keyword-research/index.js';
import { getRanksDb, getRanksQueue } from './ranks.queue-holder.js';
import { altEnginePreviewSchema, cadencePatchSchema, createKeywordSchema, historyQuerySchema, keywordIdParamsSchema, keywordSuggestionsSchema, listKeywordsQuerySchema, normalizeEngineTarget, siteIdParamsSchema, } from './keywords.schema.js';
import { createKeyword, previewAltEngineKeyword, deactivateKeyword, discoverKeywordSuggestions, getKeywordHistory, listKeywords, triggerKeywordRankCheck, triggerRankCheck, updateRankCadence, } from './keywords.service.js';
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
    const keyword = await createKeyword({
        accountId,
        siteId,
        ...body,
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
    const result = await triggerRankCheck({ accountId, siteId }, { db: getRanksDb(), ranksQueue: getRanksQueue() });
    sendLocalizedMessage(req, res, 202, 'ranks.checkQueued', {
        checkStartedAt: result.startedAt.toISOString(),
    });
});
export const checkKeywordNowHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = keywordIdParamsSchema.parse(req.params);
    const result = await triggerKeywordRankCheck({ accountId, keywordId: id }, { db: getRanksDb(), ranksQueue: getRanksQueue() });
    res.status(202).json({
        message: req.t('ranks.checkQueued'),
        checkStartedAt: result.startedAt.toISOString(),
    });
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
