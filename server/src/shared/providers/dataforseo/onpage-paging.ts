/**
 * Offset/limit walker shared by every paged On-Page read.
 */

/**
 * Requests allowed per paged endpoint. A vendor that serves 100 rows per
 * request needs 500 requests for the 50,000-page enterprise ceiling; the
 * bound only exists so a vendor that never runs dry cannot loop forever.
 */
export const MAX_PAGED_REQUESTS = 600;

/**
 * Walks an offset/limit endpoint to exhaustion. The walk ends when a request
 * returns no rows, the reported total is reached, or a page repeats rows an
 * earlier page already returned (a vendor that ignores `offset` would
 * otherwise loop) — NEVER because a page was shorter than the `limit` we asked
 * for, since vendors cap rows per request. `complete: false` means the walk
 * stopped on a repeated page or the request ceiling.
 */
export async function collectPaged<T>(args: {
  fetchPage: (offset: number) => Promise<{ items: T[]; total: number | null | undefined }>;
  /** Identity of a row across pages; used only to detect a repeated page. */
  keyOf: (item: T) => string;
  /** Stop once this many rows are collected (`complete: false` when it cuts the walk short). */
  maxItems?: number;
}): Promise<{ items: T[]; complete: boolean }> {
  const all: T[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (let request = 0; request < MAX_PAGED_REQUESTS; request += 1) {
    const page = await args.fetchPage(offset);
    if (page.items.length === 0) return { items: all, complete: true };
    const fresh = page.items.filter((item) => !seen.has(args.keyOf(item)));
    if (fresh.length === 0) return { items: all, complete: false };
    for (const item of page.items) seen.add(args.keyOf(item));
    all.push(...fresh);
    offset += page.items.length;
    const reachedTotal = typeof page.total === 'number' && all.length >= page.total;
    if (args.maxItems !== undefined && all.length >= args.maxItems) {
      return {
        items: all.slice(0, args.maxItems),
        complete: reachedTotal && all.length === args.maxItems,
      };
    }
    if (reachedTotal) return { items: all, complete: true };
  }
  return { items: all, complete: false };
}
