import type { DisavowSelection, ToxicityRow } from './types';

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/u;

function containsUnsafeText(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x2028 && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });
}

function safeDomain(value: string): string | null {
  const domain = value.toLowerCase().replace(/\.$/u, '');
  if (
    value !== value.trim() ||
    containsUnsafeText(value) ||
    /^[=+\-@]/u.test(value) ||
    domain.length > 253 ||
    !domain.includes('.') ||
    !domain.split('.').every((label) => HOST_LABEL.test(label))
  ) {
    return null;
  }
  return domain;
}

function safeUrl(value: string): string | null {
  if (value !== value.trim() || containsUnsafeText(value) || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname
    ) {
      return null;
    }
    parsed.hash = '';
    const canonical = parsed.toString();
    // Unsafe source characters were rejected before parsing; URL serialization
    // cannot introduce new control or bidi characters.
    return canonical.length <= 2048 ? canonical : null;
  } catch {
    return null;
  }
}

/** Client preview only. The server serializer remains the export authority. */
export function serializeDisavowPreview(
  rows: readonly ToxicityRow[],
  entries: readonly DisavowSelection[],
  rubricVersion: string,
  generatedOn: Date,
): string {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const directives = new Set<string>();
  for (const entry of entries) {
    const row = byId.get(entry.rowId);
    if (!row) continue;
    const value = entry.kind === 'domain' ? safeDomain(row.domain) : safeUrl(row.url);
    if (value) directives.add(entry.kind === 'domain' ? `domain:${value}` : value);
  }
  const domains = [...directives].filter((line) => line.startsWith('domain:')).sort();
  const urls = [...directives].filter((line) => !line.startsWith('domain:')).sort();
  return (
    [
      '# RankMeFast link review export',
      `# rubric: ${rubricVersion}`,
      `# generated: ${generatedOn.toISOString().slice(0, 10)}`,
      ...domains,
      ...urls,
    ].join('\n') + '\n'
  );
}
