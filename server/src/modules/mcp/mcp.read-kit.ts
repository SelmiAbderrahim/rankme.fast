/**
 * Stored-data read kit — the ONE harness every read-only
 * stored-data MCP/Assistant tool runs through.
 *
 * Contract enforced here so individual tools cannot get it wrong:
 *   1. zod-parse the input (strict objects, bounded fields),
 *   2. per-key `allowedSiteIds` intersection (`assertSiteAllowed`) BEFORE any
 *      lookup, so a blocked site and a stranger's site are indistinguishable,
 *   3. site-scoped tools take the existing Site work lease (a site that is
 *      mid-deletion, deleted, foreign, or not owned reads as not found —
 *      never forbidden) and load the owned Site document,
 *   4. the tool body returns a typed outcome (`ok | empty | unavailable`);
 *      missing data is a marker with a localized reason, never zeros,
 *   5. the payload is turned into plain JSON (no Mongoose docs, ObjectIds,
 *      Dates, bigints), untrusted markup is neutralized, arrays are bounded
 *      to <=100 rows and the whole payload to <=64 KB with `truncated: true`,
 *   6. the result goes through `runTool`, which logs failures and
 *      denylist-scans the structured payload.
 *
 * Read tools NEVER call a provider or enqueue a job.
 */
import type { z } from 'zod';
import { translate, type TranslationVars } from '../../shared/i18n/index.js';
import {
  assertSiteAllowed,
} from '../../shared/mcp-permissions/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import {
  loadOwnedSite,
  tryRunWithSiteWorkLease,
  type SiteHydrated,
} from '../sites/index.js';
import {
  runTool,
  type McpToolContext,
  type McpToolResult,
} from './mcp.tools.js';

/** Hard row ceiling for any list inside a stored-read payload. */
export const STORED_READ_ROW_LIMIT = 100;
/** Hard serialized-payload ceiling (bytes) for one stored-read result. */
export const STORED_READ_MAX_BYTES = 64 * 1024;

/**
 * Closed set of machine-readable reasons. Each has a localized sentence under
 * `mcp.reasons.<code>` in all seven dictionaries.
 */
export const STORED_READ_REASONS = [
  'noData',
  'googleNotConnected',
  'googleReconnect',
  'gscNotLinked',
  'gscPropertyMismatch',
  'ga4NotLinked',
  'snapshotMissing',
  'noCrawl',
  'notConfigured',
  'expired',
  'unsupported',
  'payloadTooLarge',
] as const;
export type StoredReadReason = (typeof STORED_READ_REASONS)[number];

export type StoredReadOutcome =
  | {
      status: 'ok';
      /** Plain DTO fields merged at the top level of `structuredContent`. */
      data: Record<string, unknown>;
      /** Row count for the human-readable summary line. */
      count?: number;
      /** Set when the tool itself clipped rows (kit also clips by bytes). */
      truncated?: boolean;
    }
  | {
      status: 'empty' | 'unavailable';
      reason: StoredReadReason;
      /** Optional context (e.g. the requested range) kept alongside the marker. */
      data?: Record<string, unknown>;
    };

export interface StoredReadEnv {
  accountId: string;
  locale: McpToolContext['locale'];
  /** Loaded, owned Site (site-scoped tools only). */
  site: SiteHydrated;
}

export interface StoredReadAccountEnv {
  accountId: string;
  locale: McpToolContext['locale'];
  /**
   * Effective permissions. Account-scoped tools whose rows can be tied to a
   * site MUST hide rows of sites outside `permissions.allowedSiteIds` (and
   * account-level rows, which belong to no allowed site) when it is non-null.
   */
  permissions: McpToolContext['permissions'];
}

function reasonMessage(
  locale: McpToolContext['locale'],
  reason: StoredReadReason,
): string {
  return translate(locale, `mcp.reasons.${reason}`);
}

function summaryLine(
  locale: McpToolContext['locale'],
  tool: string,
  key: 'ok' | 'empty' | 'unavailable',
  vars: TranslationVars,
): string {
  return translate(locale, `mcp.results.stored.${key}`, { tool, ...vars });
}

/** Replace `<` so untrusted crawl/AI/user text can never read as markup. */
function neutralize(value: string): string {
  return value.replace(/</g, '‹');
}

/**
 * Deep clone to plain JSON. Dates become ISO strings and ObjectIds hex strings
 * (via `toJSON`); `undefined` keys disappear; strings are markup-neutralized.
 * Throws on cycles/bigint — callers hand over DTOs, never raw documents.
 */
export function toPlainJson<T>(value: T): T {
  const text = JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === 'string' ? neutralize(inner) : inner,
  );
  return (text === undefined ? null : JSON.parse(text)) as T;
}

/** Clip a list to the shared row ceiling, reporting whether rows were cut. */
export function clampRows<T>(
  rows: readonly T[],
  limit: number = STORED_READ_ROW_LIMIT,
): { rows: T[]; truncated: boolean } {
  const cap = Math.max(1, Math.min(limit, STORED_READ_ROW_LIMIT));
  return { rows: rows.slice(0, cap), truncated: rows.length > cap };
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * Keep the payload under `STORED_READ_MAX_BYTES` by repeatedly halving the
 * longest top-level array. Returns `null` when no array is left to shrink.
 */
export function boundPayload(
  payload: Record<string, unknown>,
  maxBytes: number = STORED_READ_MAX_BYTES,
): { payload: Record<string, unknown>; truncated: boolean } | null {
  let current = payload;
  let truncated = false;
  // Terminates: each pass strictly shrinks the longest array or returns null.
  while (byteLength(current) > maxBytes) {
    let longestKey: string | null = null;
    let longest = 0;
    for (const [key, entry] of Object.entries(current)) {
      if (Array.isArray(entry) && entry.length > longest) {
        longest = entry.length;
        longestKey = key;
      }
    }
    if (longestKey === null || longest === 0) return null;
    const list = current[longestKey] as unknown[];
    current = { ...current, [longestKey]: list.slice(0, Math.floor(list.length / 2)) };
    truncated = true;
  }
  return { payload: current, truncated };
}

function buildResult(
  tool: string,
  locale: McpToolContext['locale'],
  outcome: StoredReadOutcome,
): McpToolResult {
  if (outcome.status !== 'ok') {
    const message = reasonMessage(locale, outcome.reason);
    return {
      structuredContent: {
        ...(outcome.data ? toPlainJson(outcome.data) : {}),
        status: outcome.status,
        reason: outcome.reason,
        message,
        locale,
      },
      content: [
        {
          type: 'text',
          text: summaryLine(locale, tool, outcome.status, { reason: message }),
        },
      ],
    };
  }
  const plain = toPlainJson({
    ...outcome.data,
    status: 'ok',
    truncated: outcome.truncated === true,
    locale,
  }) as Record<string, unknown>;
  const bounded = boundPayload(plain);
  if (bounded === null) {
    const message = reasonMessage(locale, 'payloadTooLarge');
    return {
      structuredContent: {
        status: 'unavailable',
        reason: 'payloadTooLarge',
        message,
        locale,
      },
      content: [
        { type: 'text', text: summaryLine(locale, tool, 'unavailable', { reason: message }) },
      ],
    };
  }
  const structured = bounded.truncated
    ? { ...bounded.payload, truncated: true }
    : bounded.payload;
  return {
    structuredContent: structured,
    content: [
      {
        type: 'text',
        text: summaryLine(locale, tool, 'ok', { count: outcome.count ?? 0 }),
      },
    ],
  };
}

export interface SiteStoredReadOptions<S extends z.ZodTypeAny> {
  name: string;
  /** Strict zod object with a required `siteId`. */
  schema: S;
  read: (input: z.infer<S>, env: StoredReadEnv) => Promise<StoredReadOutcome>;
}

/**
 * Run a site-scoped stored read. Order is load-bearing: parse → allowed-site
 * intersection → lease + ownership (404) → read.
 */
export function runSiteStoredRead<S extends z.ZodType<{ siteId: string }>>(
  options: SiteStoredReadOptions<S>,
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runTool(options.name, rawInput, context, async (locale) => {
    const input = options.schema.parse(rawInput ?? {}) as z.infer<S> & { siteId: string };
    assertSiteAllowed(context.permissions, input.siteId);
    const leased = await tryRunWithSiteWorkLease(
      { accountId: context.accountId, siteId: input.siteId },
      `mcp:read:${options.name}`,
      async () => {
        const site = await loadOwnedSite(context.accountId, input.siteId, {
          allowPaused: true,
        });
        return options.read(input, { accountId: context.accountId, locale, site });
      },
    );
    if (!leased.acquired) {
      throw HttpError.notFound({
        code: 'SITES_ERRORS_NOT_FOUND',
        messageKey: 'sites.errors.notFound',
      });
    }
    return buildResult(options.name, locale, leased.value);
  });
}

export interface AccountStoredReadOptions<S extends z.ZodTypeAny> {
  name: string;
  schema: S;
  read: (input: z.infer<S>, env: StoredReadAccountEnv) => Promise<StoredReadOutcome>;
}

/** Account-scoped stored read (no siteId): parse → read. */
export function runAccountStoredRead<S extends z.ZodTypeAny>(
  options: AccountStoredReadOptions<S>,
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runTool(options.name, rawInput, context, async (locale) => {
    const input = options.schema.parse(rawInput ?? {}) as z.infer<S>;
    const outcome = await options.read(input, {
      accountId: context.accountId,
      locale,
      permissions: context.permissions,
    });
    return buildResult(options.name, locale, outcome);
  });
}
