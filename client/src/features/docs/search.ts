import type { DocsSearchEntry, DocsSection } from './types';

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim();
}

export function filterDocs(
  docs: DocsSearchEntry[],
  query: string,
  section?: DocsSection,
): DocsSearchEntry[] {
  const needle = normalize(query);
  return docs.filter((doc) => {
    if (section && doc.section !== section) return false;
    if (!needle) return true;
    return normalize(`${doc.title} ${doc.description} ${doc.searchText}`).includes(needle);
  });
}
