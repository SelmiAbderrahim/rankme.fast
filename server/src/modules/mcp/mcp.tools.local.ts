/**
 * `get_local_seo_summary` and `get_reviews_summary` —
 * stored Local SEO and Review Intelligence reads.
 *
 * Local SEO mirrors `GET /api/sites/:siteId/local-seo`: the latest persisted
 * listing (NAP) snapshot, reviews snapshot and local-pack ranks. It never
 * refreshes listings.
 *
 * Reviews mirror the stored review routes (`/reviews/sources`,
 * `/runs`, `/stats/:id`, `/themes/:id`) and stay readable when the review
 * feature is switched off. Nothing syncs, previews, or reads
 * review bodies beyond the cited short excerpts the themes route already
 * exposes. Review source targets (place ids / URLs) are deliberately omitted.
 */
import {
  REVIEW_SOURCES,
  getReviewStats,
  getReviewThemes,
  listReviewRuns,
  listReviewSources,
  readLatestSnapshot,
  type ReviewThemesView,
} from '../local-seo/index.js';
import { clampRows, runSiteStoredRead } from './mcp.read-kit.js';
import { getMcpDb } from './mcp.holder.js';
import {
  getLocalSeoSummaryInputSchema,
  getReviewsSummaryInputSchema,
} from './mcp.read-schemas.js';
import type { McpToolContext, McpToolResult } from './mcp.tools.js';

/** Months of rating/velocity history returned; older buckets are dropped. */
const REVIEW_TREND_MONTHS = 24;
const THEME_SAMPLES_PER_THEME = 2;
const THEMES_PER_KIND = 10;

export function toolGetLocalSeoSummary(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runSiteStoredRead(
    {
      name: 'get_local_seo_summary',
      schema: getLocalSeoSummaryInputSchema,
      read: async (input, env) => {
        const snapshot = await readLatestSnapshot(
          { accountId: env.accountId, siteId: input.siteId },
          { db: getMcpDb() },
        );
        if (
          snapshot.listings.length === 0 &&
          snapshot.reviews === null &&
          snapshot.localPack.length === 0
        ) {
          return { status: 'empty', reason: 'notConfigured' };
        }
        const listings = clampRows(snapshot.listings);
        const localPack = clampRows(snapshot.localPack);
        const consistent = snapshot.listings.filter((row) => row.consistent).length;
        return {
          status: 'ok',
          count: listings.rows.length + localPack.rows.length,
          truncated: listings.truncated || localPack.truncated,
          data: {
            sitePaused: env.site.paused === true,
            source: 'stored_local_listing_snapshot',
            listingsFetchedAt: snapshot.fetchedAt,
            listings: listings.rows,
            listingConsistency: {
              total: snapshot.listings.length,
              consistent,
              inconsistent: snapshot.listings.length - consistent,
            },
            reviews: snapshot.reviews,
            reviewsFetchedAt: snapshot.reviewsFetchedAt,
            localPack: localPack.rows,
          },
        };
      },
    },
    rawInput,
    context,
  );
}

function summarizeThemes(
  themes: ReviewThemesView['complaintThemes'],
): Array<Record<string, unknown>> {
  return themes.slice(0, THEMES_PER_KIND).map((theme) => ({
    label: theme.label,
    summary: theme.summary,
    citationCount: theme.citations.length,
    samples: theme.citations.slice(0, THEME_SAMPLES_PER_THEME).map((citation) => ({
      source: citation.source,
      rating: citation.rating,
      reviewedAt: citation.reviewedAt,
      sample: citation.excerpt,
    })),
  }));
}

export function toolGetReviewsSummary(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runSiteStoredRead(
    {
      name: 'get_reviews_summary',
      schema: getReviewsSummaryInputSchema,
      read: async (input, env) => {
        const [{ sources }, { runs }] = await Promise.all([
          listReviewSources(env.accountId, input.siteId),
          listReviewRuns(env.accountId, { profileId: input.siteId, limit: 1 }),
        ]);
        const run = runs[0] ?? null;
        if (sources.length === 0 && run === null) {
          return { status: 'empty', reason: 'notConfigured' };
        }
        const configured = new Set<string>(sources.map((row) => row.source));
        const outcomes = new Map(
          (run?.perSourceOutcomes ?? []).map((row) => [row.source as string, row]),
        );
        const sourceRows = REVIEW_SOURCES.map((source) => {
          const outcome = outcomes.get(source);
          return {
            source,
            configured: configured.has(source),
            lastOutcome: outcome?.outcome ?? null,
            lastRetainedCount: outcome?.retained ?? null,
            lastErrorCode: outcome?.errorCode ?? null,
          };
        });
        if (run === null) {
          return {
            status: 'empty',
            reason: 'noData',
            data: { sources: sourceRows },
          };
        }

        const [stats, themes] = await Promise.all([
          getReviewStats(env.accountId, run.id),
          getReviewThemes(env.accountId, run.id),
        ]);
        if (stats.totalReviews === 0) {
          return {
            status: 'empty',
            reason: 'noData',
            data: {
              sources: sourceRows,
              latestRun: { status: run.status, createdAt: run.createdAt },
            },
          };
        }
        const complaintThemes = summarizeThemes(themes.complaintThemes);
        const praiseThemes = summarizeThemes(themes.praiseThemes);
        return {
          status: 'ok',
          count: stats.totalReviews,
          data: {
            source: 'stored_review_inventory',
            latestRun: {
              status: run.status,
              retainedCount: run.retainedCount,
              createdAt: run.createdAt,
              completedAt: run.completedAt,
              aiCompletedAt: run.aiCompletedAt,
            },
            sources: sourceRows,
            totalReviews: stats.totalReviews,
            ratingHistogram: stats.ratingHistogram,
            sourceMix: stats.sourceMix,
            monthlyVelocity: stats.monthlyVelocity.slice(-REVIEW_TREND_MONTHS),
            averageRatingTrend: stats.averageRatingTrend.slice(-REVIEW_TREND_MONTHS),
            themes: {
              terminal: themes.terminal,
              complaints: complaintThemes,
              praise: praiseThemes,
            },
          },
        };
      },
    },
    rawInput,
    context,
  );
}
