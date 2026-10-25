/**
 * Keyword-research stored-data read tools.
 *
 * Account-scoped: research history belongs to the account and is optionally
 * attributed to a site. Both tools read only what an earlier lookup already
 * stored (the history table and the shared keyword cache). They never call a
 * provider, never spend keyword lookups and never write a history row.
 *
 * Site restriction: when the effective permissions carry an `allowedSiteIds`
 * list, only history rows attributed to one of those sites are visible.
 * Account-level rows (no site) belong to no allowed site, so they are hidden
 * too; a hidden row reads exactly like an unknown id (not found).
 */
import { HttpError } from '../../shared/utils/http-error.js';
import {
  findResearchHistoryRow,
  getKeywordResearchDb,
  listResearchHistory,
  readStoredResearchResult,
} from '../keyword-research/index.js';
import { clampRows, runAccountStoredRead } from './mcp.read-kit.js';
import {
  getKeywordResearchResultInputSchema,
  listKeywordResearchHistoryInputSchema,
} from './mcp.read-schemas.js';
import { MCP_PAGE_LIMIT_DEFAULT } from './mcp.schema.js';
import type { McpToolContext, McpToolResult } from './mcp.tools.js';

export function toolListKeywordResearchHistory(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runAccountStoredRead(
    {
      name: 'list_keyword_research_history',
      schema: listKeywordResearchHistoryInputSchema,
      read: async (input, env) => {
        const allowed = env.permissions.allowedSiteIds;
        if (allowed !== null && allowed.length === 0) {
          return { status: 'empty', reason: 'noData' };
        }
        const page = await listResearchHistory(getKeywordResearchDb(), {
          accountId: env.accountId,
          limit: input.limit ?? MCP_PAGE_LIMIT_DEFAULT,
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(allowed !== null ? { siteIds: allowed } : {}),
        });
        if (page.items.length === 0) return { status: 'empty', reason: 'noData' };
        const { rows } = clampRows(page.items);
        return {
          status: 'ok',
          count: rows.length,
          truncated: page.nextCursor !== null,
          data: {
            source: 'stored_history',
            rowsReturned: rows.length,
            totalCount: page.total,
            nextCursor: page.nextCursor,
            history: rows.map((row) => ({
              id: row.id,
              kind: row.kind,
              phrases: row.phrases,
              locationCode: row.locationCode,
              languageCode: row.languageCode,
              resultCount: row.resultCount,
              servedFromCache: row.cached,
              lookupId: row.lookupId,
              createdAt: row.createdAt,
            })),
          },
        };
      },
    },
    rawInput,
    context,
  );
}

export function toolGetKeywordResearchResult(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runAccountStoredRead(
    {
      name: 'get_keyword_research_result',
      schema: getKeywordResearchResultInputSchema,
      read: async (input, env) => {
        const db = getKeywordResearchDb();
        const row = await findResearchHistoryRow(db, env.accountId, input.historyId);
        const allowed = env.permissions.allowedSiteIds;
        const visible =
          row !== null &&
          (allowed === null || (row.siteId !== null && allowed.includes(row.siteId)));
        if (!visible) {
          throw HttpError.notFound({
            code: 'KEYWORD_RESEARCH_ERRORS_HISTORY_NOT_FOUND',
            messageKey: 'keywordResearch.errors.historyNotFound',
          });
        }
        const stored = await readStoredResearchResult(db, row, new Date());
        const keywords = clampRows(stored.keywords);
        const items = clampRows(stored.items);
        const data = {
          source: 'stored_cache',
          id: stored.id,
          kind: stored.kind,
          lookupId: stored.lookupId,
          phrases: stored.phrases,
          locationCode: stored.locationCode,
          languageCode: stored.languageCode,
          storedStatus: stored.status,
          requestedCount: stored.requestedCount,
          storedCount: stored.storedCount,
          seed: stored.seed,
          keywords: keywords.rows,
          items: items.rows,
          fetchedAt: stored.fetchedAt,
          expiresAt: stored.expiresAt,
        };
        if (stored.status === 'expired' || stored.status === 'unsupported') {
          return { status: 'unavailable', reason: stored.status, data };
        }
        return {
          status: 'ok',
          count: keywords.rows.length + items.rows.length,
          truncated: keywords.truncated || items.truncated,
          data,
        };
      },
    },
    rawInput,
    context,
  );
}
