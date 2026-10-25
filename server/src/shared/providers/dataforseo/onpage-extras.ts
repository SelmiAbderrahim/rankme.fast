/**
 * Extra On-Page reads after the page list.
 *
 * Free reads (docs.dataforseo.com: "Your account will not be charged for
 * using this function"):
 *   /on_page/duplicate_tags     paged — shared titles and descriptions
 *   /on_page/redirect_chains    paged — chains of two or more redirects
 *   /on_page/duplicate_content  one URL per request — only flagged pages
 *   /on_page/waterfall          one URL per request — only slow pages
 * Reads of the resource scan (`load_resources` on the task):
 *   /on_page/resources          bounded — broken first, then the largest
 *   /on_page/pages_by_resource  one resource per request — bounded
 *
 * Contract: an extra read can never fail the audit. A vendor error, or the
 * wall-clock budget running out, marks only that signal as unavailable
 * (`AuditResult.unavailableSignals`) and the rules report it as not
 * evaluated. Only the error's class name is logged, never its message.
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { dataForSeoRequest, type DataForSeoConfig } from '../http.js';
import { VendorMalformedError } from '../errors.js';
import {
  MAX_AUDIT_RESOURCES,
  type AuditDuplicateGroup,
  type AuditExtraSignal,
  type AuditPage,
  type AuditRedirectChain,
  type AuditResource,
  type AuditResourceType,
  type AuditResult,
} from '../types.js';
import { collectPaged } from './onpage-paging.js';

/** At most this many URLs per audit for each one-URL-per-request read. */
export const MAX_PER_URL_READS = 50;
/** At most this many resources looked up with `pages_by_resource`. */
export const MAX_RESOURCE_PAGE_LOOKUPS = 25;
/** Pages kept per looked-up resource. */
export const MAX_RESOURCE_USED_ON = 10;
/**
 * Wall-clock budget shared by the one-URL-per-request reads: three minutes,
 * a tenth of the default 30-minute audit deadline. Serial at roughly
 * 200–400 ms per request, the bounded 125 requests fit with room to spare;
 * the budget only matters when the vendor slows down.
 */
export const DEFAULT_EXTRA_READS_BUDGET_MS = 3 * 60 * 1000;

export interface ExtraReadsConfig extends DataForSeoConfig {
  logger?: Logger;
  /** Budget for the per-URL reads. Defaults to {@link DEFAULT_EXTRA_READS_BUDGET_MS}. */
  extraReadsBudgetMs?: number;
  /** Test seam — millisecond clock. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Schemas (recorded: fixtures/dataforseo-onpage/<operation>/sandbox-shape.json)
// ---------------------------------------------------------------------------

const crawlResult = <T extends z.ZodTypeAny>(item: T) =>
  z
    .array(
      z
        .object({
          total_items_count: z.number().nullable().optional(),
          total_pages_count: z.number().nullable().optional(),
          items: z.array(item).nullable().optional(),
        })
        .passthrough(),
    )
    .min(1);

const pageRefSchema = z.object({ url: z.string() }).passthrough();

const duplicateTagsResultSchema = crawlResult(
  z
    .object({
      accumulator: z.string().nullable().optional(),
      pages: z.array(pageRefSchema).nullable().optional(),
    })
    .passthrough(),
);

const redirectChainsResultSchema = crawlResult(
  z
    .object({
      is_redirect_loop: z.boolean().nullable().optional(),
      chain: z
        .array(
          z
            .object({
              link_from: z.string(),
              link_to: z.string(),
              page_to_status_code: z.number().nullable().optional(),
            })
            .passthrough(),
        )
        .nullable()
        .optional(),
    })
    .passthrough(),
);

const duplicateContentResultSchema = crawlResult(
  z
    .object({
      url: z.string().nullable().optional(),
      pages: z
        .array(
          z
            .object({
              similarity: z.number().nullable().optional(),
              page: z.array(pageRefSchema).nullable().optional(),
            })
            .passthrough(),
        )
        .nullable()
        .optional(),
    })
    .passthrough(),
);

const waterfallResultSchema = crawlResult(
  z
    .object({
      page_url: z.string().nullable().optional(),
      waiting_time: z.number().nullable().optional(),
    })
    .passthrough(),
);

const resourceItemSchema = z
  .object({
    url: z.string(),
    resource_type: z.string().nullable().optional(),
    accept_type: z.string().nullable().optional(),
    status_code: z.number().nullable().optional(),
    size: z.number().nullable().optional(),
    cache_control: z
      .object({ cachable: z.boolean().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    checks: z
      .object({ is_broken: z.boolean().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

type ResourceItem = z.infer<typeof resourceItemSchema>;

const resourcesResultSchema = crawlResult(resourceItemSchema);
const pagesByResourceResultSchema = crawlResult(pageRefSchema);

// ---------------------------------------------------------------------------
// Request helper
// ---------------------------------------------------------------------------

async function readResult<T>(
  cfg: DataForSeoConfig,
  path: string,
  task: Record<string, unknown>,
  schema: z.ZodType<T[]>,
  operation: string,
): Promise<T> {
  const outcomes = await dataForSeoRequest(cfg, path, [task], schema, { operation });
  const outcome = outcomes[0];
  if (!outcome || outcome.status !== 'ok') {
    throw new VendorMalformedError(`${path.slice(1)} not ok`, { provider: 'dataforseo', operation });
  }
  return outcome.result[0]!;
}

// ---------------------------------------------------------------------------
// Paged reads
// ---------------------------------------------------------------------------

/** `/on_page/duplicate_tags` for titles and descriptions. Paginated by page row. */
export async function fetchDuplicateTagGroups(
  cfg: DataForSeoConfig,
  vendorTaskId: string,
  pagesPerRequest: number,
): Promise<AuditDuplicateGroup[]> {
  const groups: AuditDuplicateGroup[] = [];
  for (const [type, kind] of [
    ['duplicate_title', 'title'],
    ['duplicate_description', 'description'],
  ] as const) {
    const rows = await collectPaged<{ accumulator: string; url: string }>({
      keyOf: (row) => `${row.accumulator}\u0000${row.url}`,
      fetchPage: async (offset) => {
        const result = await readResult(
          cfg,
          '/on_page/duplicate_tags',
          { id: vendorTaskId, type, limit: pagesPerRequest, offset },
          duplicateTagsResultSchema,
          'on-page-duplicate-tags',
        );
        const items = (result.items ?? []).flatMap((item) =>
          (item.pages ?? []).map((page) => ({ accumulator: item.accumulator ?? '', url: page.url })),
        );
        return { items, total: result.total_pages_count };
      },
    });
    const byValue = new Map<string, Set<string>>();
    for (const row of rows.items) {
      const urls = byValue.get(row.accumulator) ?? new Set<string>();
      urls.add(row.url);
      byValue.set(row.accumulator, urls);
    }
    for (const urls of byValue.values()) {
      if (urls.size >= 2) groups.push({ kind, urls: [...urls] });
    }
  }
  return groups;
}

/** `/on_page/redirect_chains` — every chain of two or more redirects, loops included. */
export async function fetchRedirectChains(
  cfg: DataForSeoConfig,
  vendorTaskId: string,
  pagesPerRequest: number,
): Promise<AuditRedirectChain[]> {
  type Item = NonNullable<z.infer<typeof redirectChainsResultSchema>[number]['items']>[number];
  const items = await collectPaged<Item>({
    keyOf: (item) => (item.chain ?? []).map((hop) => `${hop.link_from}>${hop.link_to}`).join('|'),
    fetchPage: async (offset) => {
      const result = await readResult(
        cfg,
        '/on_page/redirect_chains',
        { id: vendorTaskId, limit: pagesPerRequest, offset },
        redirectChainsResultSchema,
        'on-page-redirect-chains',
      );
      return { items: result.items ?? [], total: result.total_items_count };
    },
  });
  return items.items.flatMap((item): AuditRedirectChain[] => {
    const chain = item.chain ?? [];
    const first = chain[0];
    if (!first) return [];
    return [
      {
        from: first.link_from,
        // Each hop is the address reached and the status it answered with.
        hops: chain.map((hop) => ({ url: hop.link_to, status: hop.page_to_status_code ?? 0 })),
        isLoop: item.is_redirect_loop === true,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// One-URL-per-request reads
// ---------------------------------------------------------------------------

interface Budget {
  exhausted: () => boolean;
}

function makeBudget(cfg: ExtraReadsConfig): Budget {
  const now = cfg.now ?? Date.now;
  const startedAt = now();
  const budgetMs = cfg.extraReadsBudgetMs ?? DEFAULT_EXTRA_READS_BUDGET_MS;
  return { exhausted: () => now() - startedAt >= budgetMs };
}

interface PerUrlOutcome<T> {
  values: Map<string, T>;
  /** Flagged URLs left without evidence (bound, budget, or a failed read). */
  unverified: number;
  stop: 'budget' | 'vendor-error' | null;
}

async function readPerUrl<T>(
  urls: readonly string[],
  budget: Budget,
  read: (url: string) => Promise<T>,
): Promise<PerUrlOutcome<T>> {
  const values = new Map<string, T>();
  let stop: PerUrlOutcome<T>['stop'] = null;
  for (const url of urls.slice(0, MAX_PER_URL_READS)) {
    if (budget.exhausted()) {
      stop = 'budget';
      break;
    }
    try {
      values.set(url, await read(url));
    } catch {
      stop = 'vendor-error';
      break;
    }
  }
  return { values, unverified: urls.length - values.size, stop };
}

/** Near-duplicate pages of one URL, with the vendor's 0–10 similarity. */
export async function readDuplicateContent(
  cfg: DataForSeoConfig,
  vendorTaskId: string,
  url: string,
): Promise<{ url: string; similarity: number }[]> {
  const result = await readResult(
    cfg,
    '/on_page/duplicate_content',
    { id: vendorTaskId, url },
    duplicateContentResultSchema,
    'on-page-duplicate-content',
  );
  return (result.items ?? []).flatMap((item) =>
    (item.pages ?? []).flatMap((match) =>
      (match.page ?? []).map((page) => ({ url: page.url, similarity: match.similarity ?? 0 })),
    ),
  );
}

/** Time to first byte of one URL from `/on_page/waterfall`; `null` when not timed. */
export async function readWaterfall(
  cfg: DataForSeoConfig,
  vendorTaskId: string,
  url: string,
): Promise<number | null> {
  const result = await readResult(
    cfg,
    '/on_page/waterfall',
    { id: vendorTaskId, url },
    waterfallResultSchema,
    'on-page-waterfall',
  );
  const waiting = result.items?.[0]?.waiting_time;
  return typeof waiting === 'number' && waiting > 0 ? Math.round(waiting) : null;
}

/** Content groups from per-URL matches, one group per distinct set of pages. */
function contentGroups(matches: Map<string, { url: string; similarity: number }[]>): AuditDuplicateGroup[] {
  const groups = new Map<string, { urls: string[]; similarity: number }>();
  for (const [source, found] of matches) {
    const others = found.filter((match) => match.url !== source);
    if (others.length === 0) continue;
    const urls = [...new Set([source, ...others.map((match) => match.url)])];
    const key = [...urls].sort().join('\u0000');
    const similarity = Math.max(...others.map((match) => match.similarity));
    const existing = groups.get(key);
    if (!existing) groups.set(key, { urls, similarity });
    else existing.similarity = Math.max(existing.similarity, similarity);
  }
  return [...groups.values()].map((group) => ({ kind: 'content', ...group }));
}

// ---------------------------------------------------------------------------
// Resource scan (crawl option)
// ---------------------------------------------------------------------------

const RESOURCE_TYPES: ReadonlySet<string> = new Set(['image', 'script', 'stylesheet']);

function resourceType(item: ResourceItem): AuditResourceType {
  for (const candidate of [item.resource_type, item.accept_type]) {
    if (candidate && RESOURCE_TYPES.has(candidate)) return candidate as AuditResourceType;
  }
  return 'other';
}

function normalizeResource(item: ResourceItem): AuditResource {
  const status = typeof item.status_code === 'number' && item.status_code > 0 ? item.status_code : null;
  const isBroken =
    item.resource_type === 'broken' || item.checks?.is_broken === true || status === null || status >= 400;
  const out: AuditResource = { url: item.url, type: resourceType(item), statusCode: status, isBroken, usedOn: [] };
  if (typeof item.size === 'number' && item.size >= 0) out.sizeBytes = Math.round(item.size);
  if (typeof item.cache_control?.cachable === 'boolean') out.cacheable = item.cache_control.cachable;
  return out;
}

/**
 * Broken resources first (paged up to the bound), then the largest images,
 * scripts and stylesheets to fill it. `total` is the vendor's resource count.
 */
export async function fetchResources(
  cfg: DataForSeoConfig,
  vendorTaskId: string,
  pagesPerRequest: number,
): Promise<{ resources: AuditResource[]; total: number | undefined }> {
  let total: number | undefined;
  const broken = await collectPaged<ResourceItem>({
    keyOf: (item) => item.url,
    maxItems: MAX_AUDIT_RESOURCES,
    fetchPage: async (offset) => {
      const result = await readResult(
        cfg,
        '/on_page/resources',
        {
          id: vendorTaskId,
          limit: pagesPerRequest,
          offset,
          filters: [
            ['resource_type', '=', 'broken'],
            'or',
            ['checks.is_broken', '=', true],
            'or',
            ['status_code', '>=', 400],
          ],
        },
        resourcesResultSchema,
        'on-page-resources',
      );
      return { items: result.items ?? [], total: result.total_items_count };
    },
  });
  const kept = new Map<string, AuditResource>();
  for (const item of broken.items) kept.set(item.url, normalizeResource(item));
  const room = MAX_AUDIT_RESOURCES - kept.size;
  if (room > 0) {
    const largest = await readResult(
      cfg,
      '/on_page/resources',
      {
        id: vendorTaskId,
        limit: Math.min(room, pagesPerRequest),
        filters: [['resource_type', 'in', ['image', 'script', 'stylesheet']]],
        order_by: ['size,desc'],
      },
      resourcesResultSchema,
      'on-page-resources',
    );
    if (typeof largest.total_items_count === 'number') total = largest.total_items_count;
    for (const item of largest.items ?? []) {
      if (kept.size >= MAX_AUDIT_RESOURCES) break;
      if (!kept.has(item.url)) kept.set(item.url, normalizeResource(item));
    }
  }
  return { resources: [...kept.values()], total };
}

/** Pages that load one resource, at most {@link MAX_RESOURCE_USED_ON}. */
export async function readPagesByResource(
  cfg: DataForSeoConfig,
  vendorTaskId: string,
  url: string,
): Promise<{ urls: string[]; count: number }> {
  const result = await readResult(
    cfg,
    '/on_page/pages_by_resource',
    { id: vendorTaskId, url, limit: MAX_RESOURCE_USED_ON },
    pagesByResourceResultSchema,
    'on-page-pages-by-resource',
  );
  const urls = (result.items ?? []).slice(0, MAX_RESOURCE_USED_ON).map((page) => page.url);
  return { urls, count: Math.max(result.total_items_count ?? urls.length, urls.length) };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type ExtraSignals = Pick<
  AuditResult,
  'duplicateGroups' | 'redirectChains' | 'resources' | 'resourceTotal' | 'unavailableSignals' | 'unverified'
>;

/**
 * Runs every extra read for a finished crawl and folds the per-page evidence
 * (time to first byte) into `pages`. Each signal is isolated: its failure is
 * recorded and the others still run.
 */
export async function readExtraSignals(
  cfg: ExtraReadsConfig,
  vendorTaskId: string,
  pages: AuditPage[],
  options: { pagesPerRequest: number; resourceScan: boolean },
): Promise<ExtraSignals> {
  const unavailable: NonNullable<AuditResult['unavailableSignals']> = [];
  const out: ExtraSignals = {};
  const fail = (signal: AuditExtraSignal, cause: 'vendor-error' | 'budget', error?: unknown): void => {
    unavailable.push({ signal, cause });
    cfg.logger?.warn(
      {
        provider: 'dataforseo',
        operation: `on-page-${signal}`,
        vendorTaskId,
        cause,
        ...(error instanceof Error ? { error: error.name } : {}),
      },
      'on_page extra read unavailable; that signal is reported as not evaluated',
    );
  };

  let groups: AuditDuplicateGroup[] | undefined;
  try {
    groups = await fetchDuplicateTagGroups(cfg, vendorTaskId, options.pagesPerRequest);
  } catch (error) {
    fail('duplicate-tags', 'vendor-error', error);
  }

  try {
    out.redirectChains = await fetchRedirectChains(cfg, vendorTaskId, options.pagesPerRequest);
  } catch (error) {
    fail('redirect-chains', 'vendor-error', error);
  }

  const budget = makeBudget(cfg);
  const servedIndexable = pages.filter((page) => page.isIndexable && Math.floor(page.statusCode / 100) === 2);

  const duplicateUrls = servedIndexable.filter((page) => page.checks?.duplicateContent === true).map((page) => page.url);
  if (duplicateUrls.length > 0) {
    const read = await readPerUrl(duplicateUrls, budget, (url) => readDuplicateContent(cfg, vendorTaskId, url));
    groups = [...(groups ?? []), ...contentGroups(read.values)];
    if (read.unverified > 0) out.unverified = { ...out.unverified, duplicateContent: read.unverified };
    if (read.stop) fail('duplicate-content', read.stop);
  }
  if (groups) out.duplicateGroups = groups;

  const slowPages = servedIndexable.filter(
    (page) => page.checks?.slowServerResponse === true || page.checks?.slowLoad === true,
  );
  if (slowPages.length > 0) {
    const read = await readPerUrl(
      slowPages.map((page) => page.url),
      budget,
      (url) => readWaterfall(cfg, vendorTaskId, url),
    );
    for (const page of slowPages) {
      const ms = read.values.get(page.url);
      if (typeof ms === 'number') page.serverResponseMs = ms;
    }
    if (read.unverified > 0) out.unverified = { ...out.unverified, slowPages: read.unverified };
    if (read.stop) fail('waterfall', read.stop);
  }

  if (options.resourceScan) {
    try {
      const scanned = await fetchResources(cfg, vendorTaskId, options.pagesPerRequest);
      const lookups = scanned.resources
        .filter((resource) => resource.isBroken || resource.type === 'image')
        .sort((a, b) => Number(b.isBroken) - Number(a.isBroken) || (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))
        .slice(0, MAX_RESOURCE_PAGE_LOOKUPS);
      for (const resource of lookups) {
        if (budget.exhausted()) break;
        try {
          const found = await readPagesByResource(cfg, vendorTaskId, resource.url);
          resource.usedOn = found.urls;
          resource.usedOnCount = found.count;
        } catch {
          // Where a resource is used is evidence only; the resource row stands.
          break;
        }
      }
      out.resources = scanned.resources;
      if (scanned.total !== undefined && scanned.total > scanned.resources.length) {
        out.resourceTotal = scanned.total;
      }
    } catch (error) {
      fail('resources', 'vendor-error', error);
    }
  }

  if (unavailable.length > 0) out.unavailableSignals = unavailable;
  return out;
}
