/**
 * Pure helpers behind the schema page picker's search + grouping.
 *
 * A site audit can hand the picker ~100 pages; a flat radio wall is
 * unusable. Pages are grouped by their first path segment when they sit
 * below one (`/ar/…`, `/blog/…`) — which is how multilingual sites split
 * languages — and top-level pages share the `/` group.
 */
export interface PickablePage {
  url: string;
  /** Optional human title (audited pages carry one; inventory pages do not). */
  title?: string | null;
}

export interface IndexedPage<T extends PickablePage> {
  page: T;
  /** Position in the ORIGINAL list — ids/test ids stay stable under filtering. */
  index: number;
}

export interface PageGroup<T extends PickablePage> {
  prefix: string;
  pages: IndexedPage<T>[];
}

export const ROOT_GROUP = '/';

export function pathGroupOf(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return ROOT_GROUP;
  }
  const segments = pathname.split('/').filter((segment) => segment !== '');
  return segments.length > 1 ? `/${segments[0]}/` : ROOT_GROUP;
}

export function filterPages<T extends PickablePage>(
  pages: readonly T[],
  query: string,
): IndexedPage<T>[] {
  const needle = query.trim().toLocaleLowerCase();
  const indexed = pages.map((page, index) => ({ page, index }));
  if (needle === '') return indexed;
  return indexed.filter(
    ({ page }) =>
      page.url.toLocaleLowerCase().includes(needle) ||
      (page.title ?? '').toLocaleLowerCase().includes(needle),
  );
}

/** Groups keep first-seen order, so the server's page order is preserved. */
export function groupPages<T extends PickablePage>(
  pages: readonly IndexedPage<T>[],
): PageGroup<T>[] {
  const groups = new Map<string, IndexedPage<T>[]>();
  for (const entry of pages) {
    const prefix = pathGroupOf(entry.page.url);
    const bucket = groups.get(prefix);
    if (bucket) bucket.push(entry);
    else groups.set(prefix, [entry]);
  }
  return [...groups].map(([prefix, grouped]) => ({ prefix, pages: grouped }));
}
