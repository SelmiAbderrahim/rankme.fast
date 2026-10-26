import { hostnameOf } from '@shared/lib/registrableDomain';
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

export function safeDisavowDomain(value: string): string | null {
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
    const value = entry.kind === 'domain' ? safeDisavowDomain(row.domain) : safeUrl(row.url);
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

export const SUSPICION_HEURISTIC_VERSION = 'link-suspicion-v1';

/** Referring host of a row, without a leading `www.`. */
export function referringHostOf(row: { domainFrom?: string; urlFrom: string }): string {
  const host = row.domainFrom && row.domainFrom.length > 0 ? row.domainFrom : hostnameOf(row.urlFrom);
  return host.replace(/^www\./u, '');
}

/**
 * Google disavow text for links the person reviewed and selected. Whole
 * domains only (`domain:` lines), de-duplicated and sorted; anything that is
 * not a plain hostname is dropped, so a hostile value can never inject a line
 * or a spreadsheet formula. The comments say the flags are suspicions, not
 * facts.
 */
export function serializeSuspectedDisavow(hosts: readonly string[], generatedOn: Date): string {
  const directives = new Set<string>();
  for (const host of hosts) {
    const domain = safeDisavowDomain(host);
    if (domain) directives.add(`domain:${domain}`);
  }
  return (
    [
      '# RankMeFast suspected-spam review export',
      '# Suspected, not verified: check every domain before you submit this file to Google.',
      `# heuristic: ${SUSPICION_HEURISTIC_VERSION}`,
      `# generated: ${generatedOn.toISOString().slice(0, 10)}`,
      ...[...directives].sort(),
    ].join('\n') + '\n'
  );
}
