/**
 * `get_ai_visibility_summary` — stored AI Visibility read.
 *
 * Reads only what earlier checks already persisted: tracked prompts, the last
 * 30 days of mention snapshots, the share-of-voice rollup over those same
 * rows, and the latest stored prompt-suggestion set. It never runs a check,
 * never generates suggestions, and never calls a provider.
 *
 * Field naming: the MCP output denylist rejects any key named `prompt` (it
 * guards against leaking model prompts), so tracked prompts, checks and
 * suggestions expose the text as `question`.
 */
import {
  getAiVisibilityOverview,
  readStoredSuggestions,
} from '../ai-visibility/index.js';
import { clampRows, runSiteStoredRead } from './mcp.read-kit.js';
import { getMcpDb } from './mcp.holder.js';
import { getAiVisibilitySummaryInputSchema } from './mcp.read-schemas.js';
import type { McpToolContext, McpToolResult } from './mcp.tools.js';

/** Window the overview's share-of-voice and snapshots are computed over. */
const AI_VISIBILITY_WINDOW_DAYS = 30;
const SUGGESTION_ROW_LIMIT = 20;

export function toolGetAiVisibilitySummary(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runSiteStoredRead(
    {
      name: 'get_ai_visibility_summary',
      schema: getAiVisibilitySummaryInputSchema,
      read: async (input, env) => {
        const db = getMcpDb();
        const scope = { accountId: env.accountId, siteId: input.siteId };
        const overview = await getAiVisibilityOverview(scope, { db });
        if (overview.prompts.length === 0) {
          return { status: 'empty', reason: 'notConfigured' };
        }
        if (overview.snapshots.length === 0) {
          return {
            status: 'empty',
            reason: 'noData',
            data: {
              trackedPrompts: overview.prompts.map((prompt) => ({
                id: prompt.id,
                question: prompt.prompt,
              })),
            },
          };
        }

        // Newest first already; keep the latest answer per prompt + engine.
        const seen = new Set<string>();
        const latest = overview.snapshots.filter((row) => {
          const key = `${row.prompt}\u0000${row.model}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const checks = clampRows(
          latest.map((row) => ({
            question: row.prompt,
            engine: row.model,
            mentioned: row.mentioned,
            citedUrl: row.citedUrl,
            sentiment: row.sentiment,
            checkedAt: row.checkedAt,
          })),
        );

        const stored = await readStoredSuggestions(
          { ...scope, outputLocale: env.locale },
          { db },
        );
        const suggestions = clampRows(
          stored.suggestions.map((row) => ({
            question: row.prompt,
            source: row.source,
            intent: row.intent,
            evidenceSource: row.evidenceSource,
          })),
          SUGGESTION_ROW_LIMIT,
        );

        return {
          status: 'ok',
          count: checks.rows.length,
          truncated: checks.truncated,
          data: {
            checkedAt: overview.checkedAt,
            window: {
              days: AI_VISIBILITY_WINDOW_DAYS,
              source: 'stored_ai_mention_checks',
            },
            trackedPrompts: overview.prompts.map((prompt) => ({
              id: prompt.id,
              question: prompt.prompt,
              createdAt: prompt.createdAt,
            })),
            latestChecks: checks.rows,
            shareOfVoice: {
              pct: overview.shareOfVoicePct,
              scope: 'brand_mentions_vs_stored_competitor_mentions_in_window',
            },
            sentiment: overview.sentiment,
            notMentionedPrompts: overview.notMentionedPrompts,
            notCheckedPrompts: overview.notCheckedPrompts,
            suggestions: {
              generatedAt: stored.generatedAt,
              evidence: stored.evidence,
              items: suggestions.rows,
              truncated: suggestions.truncated,
            },
          },
        };
      },
    },
    rawInput,
    context,
  );
}
