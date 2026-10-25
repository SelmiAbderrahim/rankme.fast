/**
 * Competitors portfolio stored-data read tool:
 * `list_competitors`.
 *
 * Reads the confirmed competitor profiles of one owned site (the Content
 * comparison portfolio: `competitor_profiles` rows) with the same
 * `listCompetitors` service the dashboard route uses. No provider call, no
 * scrape.
 */
import { listCompetitors } from '../competitor-content/index.js';
import { clampRows, runSiteStoredRead } from './mcp.read-kit.js';
import { getMcpDb } from './mcp.holder.js';
import { listCompetitorsInputSchema } from './mcp.read-schemas.js';
import type { McpToolContext, McpToolResult } from './mcp.tools.js';

export function toolListCompetitors(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runSiteStoredRead(
    {
      name: 'list_competitors',
      schema: listCompetitorsInputSchema,
      read: async (input, env) => {
        const status = input.status ?? 'active';
        const all = await listCompetitors(getMcpDb(), {
          accountId: env.accountId,
          siteId: input.siteId,
          status: 'all',
        });
        const counts = {
          active: all.filter((profile) => profile.status === 'active').length,
          archived: all.filter((profile) => profile.status === 'archived').length,
          total: all.length,
        };
        const selected = all.filter((profile) => status === 'all' || profile.status === status);
        if (selected.length === 0) {
          return {
            status: 'empty',
            reason: 'noData',
            data: { siteId: input.siteId, statusFilter: status, counts },
          };
        }
        const { rows, truncated } = clampRows(selected);
        return {
          status: 'ok',
          count: rows.length,
          truncated,
          data: {
            siteId: input.siteId,
            statusFilter: status,
            counts,
            competitors: rows.map((profile) => ({
              id: profile.id,
              domain: profile.registrableDomain,
              origin: profile.origin,
              source: profile.source,
              status: profile.status,
              addedAt: profile.createdAt,
            })),
          },
        };
      },
    },
    rawInput,
    context,
  );
}
