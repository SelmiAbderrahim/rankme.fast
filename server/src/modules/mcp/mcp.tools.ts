/**
 * MCP tool handlers. Each is a pure function over injected deps; the request
 * layer (`mcp.controller.ts`) wires them to `McpServer.registerTool`.
 *
 * Every handler:
 *   1. parses the input via its zod schema (rejects malformed types fast),
 *   2. reads only owner-scoped, provider-neutral fields from the existing
 *      product read services (getAuditReport, listKeywords, listAnalyses, …),
 *   3. never touches vendors — EXCEPT `start_audit`, which delegates to
 *      `startAuditForSite` so the canonical parse → own → enqueue order lives
 *      in one place, and
 *   4. passes the outgoing payload through `assertNoForbidden` before we
 *      return it — no secret names, authorization material, raw HTML, prompt
 *      text, or vendor payload keys reach the wire. The
 *      raw-HTML check is waived for the first-party localized copy fields in
 *      `FIRST_PARTY_COPY_FIELDS`, which quote markup by design; see the note
 *      there.
 */
import { ZodError } from 'zod';
import { HttpError } from '../../shared/utils/http-error.js';
import { logger } from '../../config/logger.js';
import { assertSiteAllowed, assertSpendAllowed, type EffectiveMcpPermissions, } from '../../shared/mcp-permissions/index.js';
import { ForbiddenOutputError, assertNoForbidden, } from '../../shared/security/denylist-scan.js';
import { translate, type TranslationVars } from '../../shared/i18n/index.js';
import type { SupportedLocale } from '../../shared/i18n/locales.js';
import { BEARER_DEFAULT_LOCALE } from '../../shared/middleware/bearer-language.js';
import { Site, tryRunWithSiteWorkLease } from '../sites/index.js';
import { getAuditRun, getLatestSiteReport, startAuditForSite, } from '../audits/index.js';
import { getKeywordHistoryBatch, listKeywords, } from '../ranks/index.js';
import { getAnalysis as ciGetAnalysis, listAnalyses as ciListAnalyses, } from '../content-intelligence/index.js';
import { listActionsForSite, mutateActionState } from '../actions/index.js';
import { getMcpAuditsQueue, getMcpDb } from './mcp.holder.js';
import { MCP_PAGE_LIMIT_DEFAULT, getAuditStatusInputSchema, getContentAnalysisInputSchema, getLatestAuditReportInputSchema, getRankHistoryInputSchema, listActionsInputSchema, listContentAnalysesInputSchema, listKeywordsInputSchema, listSitesInputSchema, setActionStateInputSchema, startAuditInputSchema, } from './mcp.schema.js';
/** Shape returned to `McpServer.registerTool` — structuredContent + text. */
export interface McpToolResult {
    [key: string]: unknown;
    structuredContent: Record<string, unknown>;
    content: Array<{
        type: 'text';
        text: string;
    }>;
    isError?: boolean;
}
export interface McpToolContext {
    accountId: string;
    locale: SupportedLocale;
    /**
     * Effective permissions (account defaults ∩ key scopes). Site-taking tools
     * call `assertSiteAllowed` BEFORE their ownership query so a blocked site
     * and a non-owned site produce identical not-found tool errors;
     * `start_audit` additionally passes `assertSpendAllowed`.
     */
    permissions: EffectiveMcpPermissions;
}
type McpResultKey = 'mcp.results.sitesEmpty' | 'mcp.results.sitePaused' | 'mcp.results.latestAuditReport' | 'mcp.results.keywordsEmpty' | 'mcp.results.rankHistory' | 'mcp.results.contentAnalyses' | 'mcp.results.contentAnalysesMore' | 'mcp.results.contentAnalysis' | 'mcp.results.auditStarted' | 'mcp.results.auditStatus' | 'mcp.results.actions' | 'mcp.results.actionState';
function resultText(locale: SupportedLocale, key: McpResultKey, vars?: TranslationVars): string {
    return translate(locale, key, vars);
}
function resolveLocale(arg: unknown, fallback: SupportedLocale = BEARER_DEFAULT_LOCALE): SupportedLocale {
    if (typeof arg === 'string') {
        const parsed = getContentAnalysisInputSchema.shape.locale.safeParse(arg);
        if (parsed.success && parsed.data)
            return parsed.data;
    }
    return fallback;
}
/** Format a structured object as a compact human-readable text block. */
function stringifyStructured(value: unknown): string {
    return JSON.stringify(value, null, 2);
}
/**
 * Field names whose subtree carries copy WE author — the localized rule and
 * action strings pulled from `shared/i18n/dictionaries`. Several legitimately
 * quote markup (`auditRules.mobile-unfriendly.fix` says `add a <meta
 * name="viewport" …> tag inside the <head>`), which the denylist's raw-HTML
 * check would otherwise reject on every single report and action list. Only
 * that check is waived here; authorization material and high-entropy secrets
 * are still rejected inside these fields. Crawl output (`evidence`,
 * `affectedUrls`) and model prose (`aiSummary`) are deliberately NOT listed.
 */
const FIRST_PARTY_COPY_FIELDS = [
    'copy',
    'problem',
    'whyItMatters',
    'nextStep',
] as const;
/**
 * Our own DTOs are bounded but wide — a full report walks findings ×
 * affectedUrls, GSC top queries/pages and rich-result items. The scanner's
 * 10k default would report `node-limit` on a large-but-legitimate report and
 * fail the call, so raise it for first-party payloads.
 */
const MCP_SCAN_MAX_NODES = 100000;
/**
 * Map a thrown error onto the MCP tool-error result shape.
 *
 * Every branch returns a localized i18n key as `code` so a caller can act on
 * the failure instead of guessing. The generic bucket stays last and stays
 * vague on the wire — the detail goes to the log, never to the model.
 */
function toolErrorKey(err: unknown): string {
    if (err instanceof HttpError)
        return err.message;
    if (err instanceof ZodError)
        return 'mcp.errors.invalidInput';
    if (err instanceof ForbiddenOutputError)
        return 'mcp.errors.forbiddenOutput';
    return 'common.internalError';
}
/**
 * Wrap any thrown `HttpError` / zod error in the MCP tool-error result shape.
 * Nothing escapes to the JSON-RPC error path, so this is the ONLY place a tool
 * failure can be observed — it must log, or the failure is invisible (that is
 * exactly how the denylist regression on `get_latest_audit_report` survived).
 * Every returned payload is denylist-scanned first.
 */
async function runTool(name: string, rawInput: unknown, context: McpToolContext, execute: (locale: SupportedLocale) => Promise<McpToolResult>): Promise<McpToolResult> {
    const rawLocale = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
        ? (rawInput as Record<string, unknown>).locale
        : undefined;
    const locale = resolveContextLocale(context.locale, rawLocale);
    try {
        const result = await execute(locale);
        assertNoForbidden(result.structuredContent, {
            allowedEvidenceFieldNames: ['keywords'],
            allowedHtmlFieldNames: FIRST_PARTY_COPY_FIELDS,
            maxNodes: MCP_SCAN_MAX_NODES,
        });
        return result;
    }
    catch (err) {
        const messageKey = toolErrorKey(err);
        logger.warn({
            tool: name,
            code: messageKey,
            causeName: err instanceof Error ? err.constructor.name : typeof err,
        }, 'mcp tool failed');
        const localized = translate(locale, messageKey);
        const payload = {
            error: { tool: name, code: messageKey, message: localized },
            locale,
        };
        return {
            structuredContent: payload,
            content: [{ type: 'text', text: localized }],
            isError: true,
        };
    }
}
// ---------------------------------------------------------------------------
// list_sites
// ---------------------------------------------------------------------------
export async function toolListSites(rawInput: unknown, context: McpToolContext): Promise<McpToolResult> {
    return runTool('list_sites', rawInput, context, async (locale) => {
        listSitesInputSchema.parse(rawInput ?? {});
        const filter: Record<string, unknown> = {
            accountId: context.accountId,
            deletionStartedAt: null,
        };
        if (context.permissions.allowedSiteIds !== null) {
            filter._id = { $in: context.permissions.allowedSiteIds };
        }
        const rows = await Site.find(filter, { domain: 1, url: 1, createdAt: 1, paused: 1 })
            .sort({ createdAt: -1 })
            .lean();
        const sites = rows.map((row) => ({
            id: String(row._id),
            domain: row.domain,
            url: row.url,
            paused: row.paused === true,
            createdAt: row.createdAt.toISOString(),
        }));
        const structured = { sites, locale };
        return {
            structuredContent: structured,
            content: [
                {
                    type: 'text',
                    text: sites.length === 0
                        ? resultText(locale, 'mcp.results.sitesEmpty')
                        : sites
                            .map((s) => `- ${s.domain} (${s.id})${s.paused ? ` (${resultText(locale, 'mcp.results.sitePaused')})` : ''}`)
                            .join('\n'),
                },
            ],
        };
    });
}
// ---------------------------------------------------------------------------
// get_latest_audit_report
// ---------------------------------------------------------------------------
export async function toolGetLatestAuditReport(rawInput: unknown, context: McpToolContext): Promise<McpToolResult> {
    return runTool('get_latest_audit_report', rawInput, context, async (locale) => {
        const input = getLatestAuditReportInputSchema.parse(rawInput ?? {});
        assertSiteAllowed(context.permissions, input.siteId);
        const { runId, report } = await getLatestSiteReport({
            accountId: context.accountId,
            siteId: input.siteId,
            locale,
        });
        const structured = { runId, report, locale };
        return {
            structuredContent: structured,
            content: [
                {
                    type: 'text',
                    text: resultText(locale, 'mcp.results.latestAuditReport', {
                        runId,
                        counts: stringifyStructured(report.counts),
                    }),
                },
            ],
        };
    });
}
// ---------------------------------------------------------------------------
// list_keywords
// ---------------------------------------------------------------------------
export async function toolListKeywords(rawInput: unknown, context: McpToolContext): Promise<McpToolResult> {
    return runTool('list_keywords', rawInput, context, async (locale) => {
        const input = listKeywordsInputSchema.parse(rawInput ?? {});
        assertSiteAllowed(context.permissions, input.siteId);
        const limit = input.limit ?? MCP_PAGE_LIMIT_DEFAULT;
        const page = await listKeywords({
            accountId: context.accountId,
            siteId: input.siteId,
            limit,
        }, { db: getMcpDb(), ranksQueue: null });
        const keywords = page.keywords.map((k) => ({
            id: k.id,
            phrase: k.phrase,
        }));
        return {
            structuredContent: { keywords, locale },
            content: [
                {
                    type: 'text',
                    text: keywords.length === 0
                        ? resultText(locale, 'mcp.results.keywordsEmpty')
                        : keywords.map((k) => `- ${k.phrase}`).join('\n'),
                },
            ],
        };
    });
}
// ---------------------------------------------------------------------------
// get_rank_history
// ---------------------------------------------------------------------------
export async function toolGetRankHistory(rawInput: unknown, context: McpToolContext): Promise<McpToolResult> {
    return runTool('get_rank_history', rawInput, context, async (locale) => {
        const input = getRankHistoryInputSchema.parse(rawInput ?? {});
        assertSiteAllowed(context.permissions, input.siteId);
        const deps = { db: getMcpDb(), ranksQueue: null };
        // ownership + bounded keyword page via listKeywords (throws site.notFound).
        const page = await listKeywords({
            accountId: context.accountId,
            siteId: input.siteId,
            limit: MCP_PAGE_LIMIT_DEFAULT,
        }, deps);
        const batch = await getKeywordHistoryBatch({
            accountId: context.accountId,
            keywordIds: page.keywords.map((k) => k.id),
            ...(input.from ? { from: input.from } : {}),
            ...(input.to ? { to: input.to } : {}),
        }, deps);
        const seriesById = new Map(batch.map((e) => [e.keywordId, e.series]));
        const keywords = page.keywords.map((k) => ({
            id: k.id,
            phrase: k.phrase,
            series: seriesById.get(k.id) ?? [],
        }));
        return {
            structuredContent: { keywords, locale },
            content: [
                {
                    type: 'text',
                    text: resultText(locale, 'mcp.results.rankHistory', { count: keywords.length }),
                },
            ],
        };
    });
}
// ---------------------------------------------------------------------------
// list_content_analyses
// ---------------------------------------------------------------------------
export async function toolListContentAnalyses(rawInput: unknown, context: McpToolContext): Promise<McpToolResult> {
    return runTool('list_content_analyses', rawInput, context, async (locale) => {
        const input = listContentAnalysesInputSchema.parse(rawInput ?? {});
        assertSiteAllowed(context.permissions, input.siteId);
        const limit = input.limit ?? MCP_PAGE_LIMIT_DEFAULT;
        const result = await ciListAnalyses({
            accountId: context.accountId,
            siteId: input.siteId,
            limit,
            ...(input.cursor ? { cursor: input.cursor } : {}),
        });
        return {
            structuredContent: {
                items: result.items,
                nextCursor: result.nextCursor,
                locale,
            },
            content: [
                {
                    type: 'text',
                    text: resultText(locale, result.nextCursor
                        ? 'mcp.results.contentAnalysesMore'
                        : 'mcp.results.contentAnalyses', { count: result.items.length }),
                },
            ],
        };
    });
}
// ---------------------------------------------------------------------------
// get_content_analysis
// ---------------------------------------------------------------------------
export async function toolGetContentAnalysis(rawInput: unknown, context: McpToolContext): Promise<McpToolResult> {
    return runTool('get_content_analysis', rawInput, context, async (locale) => {
        const input = getContentAnalysisInputSchema.parse(rawInput ?? {});
        const analysis = await ciGetAnalysis({
            accountId: context.accountId,
            analysisId: input.analysisId,
        });
        return {
            structuredContent: { analysis, locale },
            content: [
                {
                    type: 'text',
                    text: resultText(locale, 'mcp.results.contentAnalysis', {
                        analysisId: analysis.analysisId,
                        status: analysis.status,
                    }),
                },
            ],
        };
    });
}
// ---------------------------------------------------------------------------
// start_audit  — the ONLY spending tool. Delegates to startAuditForSite so
// the canonical order (own → enqueue) is not
// duplicated. Returns the same PublicAuditRun the REST endpoint returns.
// ---------------------------------------------------------------------------
export async function toolStartAudit(rawInput: unknown, context: McpToolContext): Promise<McpToolResult> {
    return runTool('start_audit', rawInput, context, async (locale) => {
        const input = startAuditInputSchema.parse(rawInput ?? {});
        assertSiteAllowed(context.permissions, input.siteId);
        assertSpendAllowed(context.permissions);
        const leased = await tryRunWithSiteWorkLease({ accountId: context.accountId, siteId: input.siteId }, 'mcp:start-audit', () => startAuditForSite({
            accountId: context.accountId,
            siteId: input.siteId,
            ...(typeof input.pageCap === 'number'
                ? { requestedPageCap: input.pageCap }
                : {}),
        }, {
            auditsQueue: getMcpAuditsQueue(),
        }));
        if (!leased.acquired)
            throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
        const run = leased.value;
        return {
            structuredContent: { run, locale },
            content: [
                {
                    type: 'text',
                    text: resultText(locale, 'mcp.results.auditStarted', {
                        runId: run.id,
                        status: run.status,
                    }),
                },
            ],
        };
    });
}
// ---------------------------------------------------------------------------
// get_audit_status
// ---------------------------------------------------------------------------
export async function toolGetAuditStatus(rawInput: unknown, context: McpToolContext): Promise<McpToolResult> {
    return runTool('get_audit_status', rawInput, context, async (locale) => {
        const input = getAuditStatusInputSchema.parse(rawInput ?? {});
        const { run: publicRun } = await getAuditRun({
            runId: input.runId,
            accountId: context.accountId,
        });
        return {
            structuredContent: { run: publicRun, locale },
            content: [
                {
                    type: 'text',
                    text: resultText(locale, 'mcp.results.auditStatus', {
                        runId: publicRun.id,
                        status: publicRun.status,
                    }),
                },
            ],
        };
    });
}
// ---------------------------------------------------------------------------
// list_actions / set_action_state — the unified Next Actions surface.
// Both are zero-spend: the list fans out over already-persisted first-party
// sources, and the mutation appends one Postgres row. Neither touches a vendor,
// so neither calls assertSpendAllowed.
// ---------------------------------------------------------------------------
export async function toolListActions(rawInput: unknown, context: McpToolContext): Promise<McpToolResult> {
    return runTool('list_actions', rawInput, context, async (locale) => {
        const input = listActionsInputSchema.parse(rawInput ?? {});
        assertSiteAllowed(context.permissions, input.siteId);
        const filters = {
            ...(input.state ? { state: input.state } : {}),
            ...(input.source ? { source: input.source } : {}),
            ...(input.severity ? { severity: input.severity } : {}),
        };
        const result = await listActionsForSite({
            accountId: context.accountId,
            siteId: input.siteId,
            locale,
            db: getMcpDb(),
            ...(Object.keys(filters).length > 0 ? { filters } : {}),
            ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
            ...(input.cursor ? { cursor: input.cursor } : {}),
        });
        // The text block leads with id/state/version because those three are the
        // exact arguments set_action_state needs next.
        const lines = result.items.map((item) => `${item.id} state=${item.state} version=${item.version} severity=${item.severity} source=${item.sourceType}`);
        return {
            structuredContent: {
                items: result.items,
                sourceStatus: result.sourceStatus,
                nextCursor: result.nextCursor,
                locale,
            },
            content: [
                {
                    type: 'text',
                    text: `${resultText(locale, 'mcp.results.actions', {
                        count: result.items.length,
                    })}\n${lines.join('\n')}`,
                },
            ],
        };
    });
}
export async function toolSetActionState(rawInput: unknown, context: McpToolContext): Promise<McpToolResult> {
    return runTool('set_action_state', rawInput, context, async (locale) => {
        const input = setActionStateInputSchema.parse(rawInput ?? {});
        assertSiteAllowed(context.permissions, input.siteId);
        // The REST route inherits its lease from `siteMutationLease`, which the MCP
        // mount does not carry — take it here so a site claimed for deletion is not
        // still writable through this surface.
        const leased = await tryRunWithSiteWorkLease({ accountId: context.accountId, siteId: input.siteId }, 'mcp:set-action-state', () => mutateActionState({
            accountId: context.accountId,
            siteId: input.siteId,
            actionId: input.actionId,
            // Mirrors actions.controller.ts: an API key authenticates an ACCOUNT,
            // so the account id is the actor of record.
            actorUserId: context.accountId,
            newState: input.state,
            expectedVersion: input.expectedVersion,
            note: input.note ?? null,
            clientKey: input.clientKey,
            db: getMcpDb(),
        }));
        if (!leased.acquired)
            throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
        const result = leased.value;
        return {
            structuredContent: { ...result, locale },
            content: [
                {
                    type: 'text',
                    text: resultText(locale, 'mcp.results.actionState', {
                        actionId: result.actionId,
                        state: result.state,
                        version: result.version,
                        replayed: String(result.replayed),
                    }),
                },
            ],
        };
    });
}
export function resolveContextLocale(headerLocale: string | undefined, argLocale: unknown): SupportedLocale {
    return resolveLocale(argLocale, resolveLocale(headerLocale, BEARER_DEFAULT_LOCALE));
}
