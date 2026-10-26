/**
 * Pages stored-data read tools: `list_pages` and
 * `get_page_detail`.
 *
 * Both read through the SAME Pages service the dashboard uses, built with a
 * refusing fallback-refresh port and no GSC sync port, so they can only read
 * stored rows (GSC snapshots, page-performance snapshots, the latest completed
 * audit inventory). They never refresh, and never
 * reach a provider. The Pages API allows paused sites, so these tools do too.
 *
 * Output carries the canonical states: `crawlState` + `crawlEvidence`
 * (`finalUrl`, `redirectChain`, `failureKind`, `status`) and
 * `metrics.associatedQueryCount` (`number | null`) with
 * `associatedQueryState` (`unavailable | anonymized | observed`).
 *
 * Page ids are 43-character URL-safe hashes, which the output denylist would
 * read as a high-entropy secret. They are therefore emitted as
 * `page:<hash>` (the colon breaks the base64 shape) and accepted back in that
 * form.
 */
import { env } from '../../config/env.js';
import { HttpError } from '../../shared/utils/http-error.js';
import {
  PagesError,
  createPagesService,
  type PageRow,
  type PagesEnvelope,
  type PagesFallbackReason,
  type PagesService,
} from '../pages/index.js';
import {
  runSiteStoredRead,
  type StoredReadOutcome,
  type StoredReadReason,
} from './mcp.read-kit.js';
import {
  getPageDetailInputSchema,
  listPagesInputSchema,
} from './mcp.read-schemas.js';
import { getMcpDb } from './mcp.holder.js';
import type { McpToolContext, McpToolResult } from './mcp.tools.js';

const PAGE_REF_PREFIX = 'page:';
const DEFAULT_LIMIT = 25;
/** Associated query / keyword rows returned for one page. */
const DETAIL_ASSOCIATED_LIMIT = 50;

/**
 * Stored-only Pages service: the refresh ports are deliberately absent/refusing
 * so a future code path inside `list`/`detail` could never spend.
 */
function storedPagesService(): PagesService {
  return createPagesService({
    db: getMcpDb(),
    cursorSecret: env.MASTER_ENCRYPTION_KEY,
    providerSelection: env.PROVIDER_KEYWORD,
    fallbackRefresh: {
      refresh: () => {
        throw new Error('stored Pages reads never refresh');
      },
    },
  });
}

/** Map the Pages service errors onto plain, non-leaking tool errors. */
function toToolError(error: unknown): unknown {
  if (!(error instanceof PagesError)) return error;
  if (error.code === 'PAGES_INVALID_CURSOR' || error.code === 'PAGES_INVALID_REQUEST') {
    return HttpError.badRequest({
      code: 'MCP_ERRORS_INVALID_INPUT',
      messageKey: 'mcp.errors.invalidInput',
    });
  }
  if (error.code === 'PAGES_PAGE_NOT_FOUND') {
    return HttpError.notFound({
      code: 'PAGES_PAGE_NOT_FOUND',
      messageKey: 'pages.errors.pageNotFound',
    });
  }
  return HttpError.notFound({
    code: 'SITES_ERRORS_NOT_FOUND',
    messageKey: 'sites.errors.notFound',
  });
}

const FALLBACK_REASONS: Readonly<Record<PagesFallbackReason, StoredReadReason>> = {
  gsc_not_connected: 'googleNotConnected',
  gsc_needs_reconnect: 'googleReconnect',
  gsc_revoked: 'googleReconnect',
  gsc_property_unmatched: 'gscPropertyMismatch',
};

function emptyReason(envelope: PagesEnvelope): StoredReadReason {
  return envelope.fallbackReason ? FALLBACK_REASONS[envelope.fallbackReason] : 'noCrawl';
}

function envelopeDto(envelope: PagesEnvelope) {
  return {
    source: envelope.source,
    status: envelope.status,
    fallbackReason: envelope.fallbackReason,
    observedAt: envelope.observedAt,
    staleAt: envelope.staleAt,
    range: envelope.range,
    rangeSemantics: envelope.rangeSemantics,
    dataWindow: envelope.dataWindow,
    market: envelope.market,
    coverage: envelope.coverage,
  };
}

function pageDto(page: PageRow) {
  return {
    pageId: `${PAGE_REF_PREFIX}${page.pageId}`,
    url: page.url,
    title: page.title,
    performanceSource: page.performanceSource,
    isIndexable: page.isIndexable,
    nonIndexableReason: page.nonIndexableReason,
    onPageScore: page.onPageScore,
    crawlState: page.crawlState,
    crawlEvidence: page.crawlEvidence,
    metrics: page.metrics,
    associatedQueryState: page.associatedQueryState,
    deltas: page.deltas,
    insights: page.insights,
    ...(page.crawledAs ? { crawledAs: page.crawledAs } : {}),
  };
}

export function toolListPages(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runSiteStoredRead(
    {
      name: 'list_pages',
      schema: listPagesInputSchema,
      read: async (input, env_) => {
        const range = input.range ?? '28d';
        const query = {
          range,
          sort: input.sort ?? 'opportunity',
          limit: input.limit ?? DEFAULT_LIMIT,
          ...(input.q ? { q: input.q } : {}),
          ...(input.insight ? { insight: input.insight } : {}),
          ...(input.indexability ? { indexability: input.indexability } : {}),
          ...(input.visibility ? { visibility: input.visibility } : {}),
          ...(input.direction ? { direction: input.direction } : {}),
          ...(input.cursor ? { cursor: input.cursor } : {}),
        } as Parameters<PagesService['list']>[2];
        let response: Awaited<ReturnType<PagesService['list']>>;
        try {
          response = await storedPagesService().list(env_.accountId, input.siteId, query);
        } catch (error) {
          throw toToolError(error);
        }
        if (response.pageInfo.totalInventory === 0) {
          return {
            status: response.envelope.status === 'unavailable' ? 'unavailable' : 'empty',
            reason: emptyReason(response.envelope),
            data: { siteId: input.siteId, range, envelope: envelopeDto(response.envelope) },
          };
        }
        return {
          status: 'ok',
          count: response.items.length,
          data: {
            siteId: input.siteId,
            range,
            envelope: envelopeDto(response.envelope),
            summary: response.summary,
            pages: response.items.map(pageDto),
            pageInfo: response.pageInfo,
          },
        } satisfies StoredReadOutcome;
      },
    },
    rawInput,
    context,
  );
}

export function toolGetPageDetail(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runSiteStoredRead(
    {
      name: 'get_page_detail',
      schema: getPageDetailInputSchema,
      read: async (input, env_) => {
        const range = input.range ?? '28d';
        const pageId = input.pageId.startsWith(PAGE_REF_PREFIX)
          ? input.pageId.slice(PAGE_REF_PREFIX.length)
          : input.pageId;
        let response: Awaited<ReturnType<PagesService['detail']>>;
        try {
          response = await storedPagesService().detail(env_.accountId, input.siteId, pageId, range);
        } catch (error) {
          throw toToolError(error);
        }
        const associated = response.associated.rows.slice(0, DETAIL_ASSOCIATED_LIMIT);
        const truncated =
          response.associated.truncated || response.associated.rows.length > associated.length;
        return {
          status: 'ok',
          count: associated.length,
          truncated,
          data: {
            siteId: input.siteId,
            range,
            envelope: envelopeDto(response.envelope),
            page: pageDto(response.page),
            associated: {
              kind: response.associated.kind,
              total: response.associated.total,
              rows: associated,
            },
            trend: response.trend.map((point) => ({
              observedAt: point.observedAt,
              source: point.source,
              range: point.range,
              metrics: point.metrics,
            })),
          },
        } satisfies StoredReadOutcome;
      },
    },
    rawInput,
    context,
  );
}
