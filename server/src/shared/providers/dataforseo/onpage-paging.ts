export const MAX_PAGED_REQUESTS = 600;
export async function collectPaged<T>(args: {
    fetchPage: (offset: number) => Promise<{ items: T[]; total: number | null | undefined }>;
    keyOf: (item: T) => string;
    maxItems?: number;
}): Promise<{ items: T[]; complete: boolean }> {
    const items: T[] = [];
    const seen = new Set<string>();
    let offset = 0;
    for (let request = 0; request < MAX_PAGED_REQUESTS; request += 1) {
        const page = await args.fetchPage(offset);
        if (page.items.length === 0) return { items, complete: true };
        const fresh = page.items.filter((item) => !seen.has(args.keyOf(item)));
        if (fresh.length === 0) return { items, complete: false };
        for (const item of page.items) seen.add(args.keyOf(item));
        items.push(...fresh);
        offset += page.items.length;
        const reachedTotal = typeof page.total === 'number' && items.length >= page.total;
        if (args.maxItems !== undefined && items.length >= args.maxItems) {
            return { items: items.slice(0, args.maxItems),
                complete: reachedTotal && items.length === args.maxItems };
        }
        if (reachedTotal) return { items, complete: true };
    }
    return { items, complete: false };
}
