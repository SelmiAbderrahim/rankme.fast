/**
 * Backlinks stored-data read tools.
 *
 * Both tools are cache-only: they read the per-site `backlink_snapshots` row /
 * the cross-user vendor cache that a metered refresh already wrote, through
 * the strictly read-only `readStoredBacklink*` service readers. There is no
 * `fresh` pull and no cursor path, so a call can never reach the provider
 * or enqueue a deep pull.
 *
 * Truthful counts (#15): `totalLinks` is every link the vendor knows about,
 * `referringDomains` is the number of distinct domains, and the list holds ONE
 * link per referring domain, so `rowsReturned` is bounded by
 * `referringDomains` and is usually far below `totalLinks`.
 */
import {
  BACKLINK_LIST_SCOPE,
  getBacklinksDb,
  readStoredBacklinkList,
  readStoredBacklinkSummary,
} from '../backlinks/index.js';
import { clampRows, runSiteStoredRead } from './mcp.read-kit.js';
import {
  getBacklinksSummaryInputSchema,
  listBacklinksInputSchema,
} from './mcp.read-schemas.js';
import { MCP_PAGE_LIMIT_DEFAULT } from './mcp.schema.js';
import type { McpToolContext, McpToolResult } from './mcp.tools.js';

export function toolGetBacklinksSummary(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runSiteStoredRead(
    {
      name: 'get_backlinks_summary',
      schema: getBacklinksSummaryInputSchema,
      read: async (input, env) => {
        const summary = await readStoredBacklinkSummary(
          { accountId: env.accountId, siteId: input.siteId },
          { db: getBacklinksDb() },
        );
        if (!summary) return { status: 'empty', reason: 'noData' };
        return {
          status: 'ok',
          count: 1,
          data: {
            siteId: input.siteId,
            domain: env.site.domain,
            source: 'stored_snapshot',
            fetchedAt: summary.fetchedAt,
            totalLinks: summary.backlinks,
            referringDomains: summary.referringDomains,
            brokenLinks: summary.brokenBacklinks,
            domainRating: summary.domainRating,
            countScopes: {
              totalLinks: 'every_link',
              referringDomains: 'distinct_referring_domains',
              brokenLinks: 'links_pointing_to_missing_pages',
            },
          },
        };
      },
    },
    rawInput,
    context,
  );
}

export function toolListBacklinks(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runSiteStoredRead(
    {
      name: 'list_backlinks',
      schema: listBacklinksInputSchema,
      read: async (input, env) => {
        const stored = await readStoredBacklinkList(
          { accountId: env.accountId, siteId: input.siteId },
          { db: getBacklinksDb() },
        );
        if (stored.rows.length === 0 || stored.fetchedAt === null) {
          return { status: 'empty', reason: 'noData' };
        }
        const { rows, truncated } = clampRows(
          stored.rows,
          input.limit ?? MCP_PAGE_LIMIT_DEFAULT,
        );
        return {
          status: 'ok',
          count: rows.length,
          truncated: truncated || stored.nextCursor !== null,
          data: {
            siteId: input.siteId,
            domain: env.site.domain,
            source: 'stored_first_page',
            fetchedAt: stored.fetchedAt,
            scope: BACKLINK_LIST_SCOPE,
            rowsReturned: rows.length,
            rowsStored: stored.rows.length,
            // More rows exist only behind a metered vendor pull in the app;
            // this tool never pages, so no cursor is exposed.
            moreRowsExistInApp: stored.nextCursor !== null,
            rows: rows.map((row) => ({
              domainFrom: row.domainFrom ?? null,
              urlFrom: row.urlFrom,
              urlTo: row.urlTo,
              anchor: row.anchor,
              dofollow: row.dofollow,
              isBroken: row.isBroken,
              firstSeen: row.firstSeen,
              lastSeen: row.lastSeen,
              spamScore: row.backlinkSpamScore ?? null,
              suspicion: row.suspicion
                ? {
                    status: row.suspicion.status,
                    verified: row.suspicion.verified,
                    reasons: row.suspicion.reasons,
                  }
                : null,
            })),
          },
        };
      },
    },
    rawInput,
    context,
  );
}
