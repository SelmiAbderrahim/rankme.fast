/**
 * Export evidence lines for deep crawl findings.
 *
 * The report export's findings block carries short evidence strings next to
 * the affected URLs. These lines are built only from the structured meta the
 * rules stored (redirect hops, duplicate groups, resources), use numbers and
 * symbols rather than words so they read the same in every locale, and pass
 * through `neutralizeExportCell` so no line can start a spreadsheet formula.
 */
import { neutralizeExportCell } from '../../shared/utils/csv.js';

/** The findings block accepts at most 100 evidence lines of 1,000 characters. */
export const EXPORT_EVIDENCE_MAX_LINES = 100;
const EXPORT_EVIDENCE_MAX_CHARS = 1_000;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

function chainLine(value: unknown): string | null {
  const chain = record(value);
  if (!chain || typeof chain.from !== 'string' || !Array.isArray(chain.hops)) return null;
  const hops = chain.hops.flatMap((hop) => {
    const entry = record(hop);
    return entry && typeof entry.url === 'string'
      ? [`${entry.url} (${typeof entry.status === 'number' && entry.status > 0 ? entry.status : '?'})`]
      : [];
  });
  return [chain.from, ...hops].join(' » ');
}

function groupLine(value: unknown): string | null {
  const group = record(value);
  const urls = strings(group?.urls);
  if (urls.length === 0) return null;
  const similarity = typeof group?.similarity === 'number' ? `${group.similarity}/10: ` : '';
  return `${similarity}${urls.join(' · ')}`;
}

function resourceLine(value: unknown): string | null {
  const resource = record(value);
  if (!resource || typeof resource.url !== 'string') return null;
  const parts = [resource.url, typeof resource.statusCode === 'number' ? String(resource.statusCode) : '—'];
  if (typeof resource.sizeBytes === 'number') parts.push(`${resource.sizeBytes} B`);
  const usedOn = strings(resource.usedOn);
  if (usedOn.length > 0) parts.push(`« ${usedOn.join(' · ')}`);
  return parts.join(' · ');
}

/** Evidence lines for one finding's meta; `[]` for findings without structured evidence. */
export function deepCrawlEvidenceLines(meta: Record<string, unknown> | undefined): string[] {
  if (!meta) return [];
  const lines = [
    ...(Array.isArray(meta.chains) ? meta.chains.map(chainLine) : []),
    ...(Array.isArray(meta.groups) ? meta.groups.map(groupLine) : []),
    ...(Array.isArray(meta.resources) ? meta.resources.map(resourceLine) : []),
  ].filter((line): line is string => line !== null);
  return lines
    .slice(0, EXPORT_EVIDENCE_MAX_LINES)
    .map((line) => neutralizeExportCell(line).slice(0, EXPORT_EVIDENCE_MAX_CHARS));
}
