import type { LocalizedFinding } from './types';

export interface PageEvidenceRow {
  url: string;
  problems: string[];
  statusCode?: number;
  clickDepth?: number;
  inboundInternalLinks?: number;
  pageSizeBytes?: number;
  transferSizeBytes?: number;
  serverResponseMs?: number;
  fetchMs?: number;
  imageCount?: number;
  renderBlockingScripts?: number;
  renderBlockingStylesheets?: number;
  contentEncoding?: string | null;
  canonical?: string;
  openGraph?: boolean;
  twitterCard?: boolean;
}

export interface ResourceEvidenceRow {
  url: string;
  type: 'image' | 'script' | 'stylesheet' | 'other';
  statusCode: number | null;
  sizeBytes?: number;
  usedOn: string[];
  usedOnCount?: number;
}

export interface DeepCrawlEvidence {
  pages: Map<string, PageEvidenceRow>;
  resources: Map<string, ResourceEvidenceRow>;
  chains: Array<{ from: string; hops: Array<{ url: string; status: number }>; isLoop: boolean }>;
  groups: Array<{ urls: string[]; title?: string | null; similarity?: number }>;
  insecureResources: string[];
  reachedThroughChain: string[];
  truncated: number | null;
}

const numberFacts = [
  'statusCode', 'clickDepth', 'inboundInternalLinks', 'pageSizeBytes',
  'transferSizeBytes', 'serverResponseMs', 'fetchMs', 'imageCount',
  'renderBlockingScripts', 'renderBlockingStylesheets',
] as const;
const resourceTypes = new Set(['image', 'script', 'stylesheet', 'other']);
const namedProblemKeys = [
  'canonicalToBroken', 'canonicalToRedirect', 'canonicalChain', 'canonicalLoop',
  'linkRelationConflict', 'largePage', 'veryLargePage', 'slowServerResponse',
  'slowLoad', 'missingDoctype', 'missingCharset', 'deprecatedTags', 'flash',
  'frames', 'urlHasUnusualCharacters', 'urlHasParameters', 'urlTooLong',
] as const;
type NamedProblem = (typeof namedProblemKeys)[number];
const namedProblemSet: ReadonlySet<string> = new Set(namedProblemKeys);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const rows = <T>(value: unknown, read: (raw: unknown) => T | null): T[] =>
  Array.isArray(value) ? value.flatMap((entry) => { const row = read(entry); return row ? [row] : []; }) : [];

function page(raw: unknown): PageEvidenceRow | null {
  if (!record(raw) || typeof raw.url !== 'string') return null;
  const result: PageEvidenceRow = { url: raw.url, problems: strings(raw.problems) };
  for (const key of numberFacts) if (finite(raw[key])) result[key] = raw[key];
  if (raw.contentEncoding === null || typeof raw.contentEncoding === 'string') result.contentEncoding = raw.contentEncoding;
  if (typeof raw.canonical === 'string') result.canonical = raw.canonical;
  if (typeof raw.openGraph === 'boolean') result.openGraph = raw.openGraph;
  if (typeof raw.twitterCard === 'boolean') result.twitterCard = raw.twitterCard;
  return result;
}

function resource(raw: unknown): ResourceEvidenceRow | null {
  if (!record(raw) || typeof raw.url !== 'string') return null;
  const result: ResourceEvidenceRow = {
    url: raw.url,
    type: typeof raw.type === 'string' && resourceTypes.has(raw.type) ? raw.type as ResourceEvidenceRow['type'] : 'other',
    statusCode: finite(raw.statusCode) ? raw.statusCode : null,
    usedOn: strings(raw.usedOn),
  };
  if (finite(raw.sizeBytes)) result.sizeBytes = raw.sizeBytes;
  if (finite(raw.usedOnCount)) result.usedOnCount = raw.usedOnCount;
  return result;
}

function chain(raw: unknown): DeepCrawlEvidence['chains'][number] | null {
  if (!record(raw) || typeof raw.from !== 'string' || !Array.isArray(raw.hops)) return null;
  return {
    from: raw.from,
    hops: rows(raw.hops, (hop) => record(hop) && typeof hop.url === 'string' && finite(hop.status)
      ? { url: hop.url, status: hop.status } : null),
    isLoop: raw.isLoop === true,
  };
}

function group(raw: unknown): DeepCrawlEvidence['groups'][number] | null {
  if (!record(raw)) return null;
  const urls = strings(raw.urls);
  if (urls.length === 0) return null;
  const result: DeepCrawlEvidence['groups'][number] = { urls };
  if (typeof raw.title === 'string' || raw.title === null) result.title = raw.title;
  if (finite(raw.similarity)) result.similarity = raw.similarity;
  return result;
}

/** Malformed or absent vendor evidence never prevents a report from opening. */
export function readDeepCrawlEvidence(meta: LocalizedFinding['meta']): DeepCrawlEvidence {
  const pages = rows(meta?.pages, page);
  const resources = rows(meta?.resources, resource);
  return {
    pages: new Map(pages.map((row) => [row.url, row])),
    resources: new Map(resources.map((row) => [row.url, row])),
    chains: rows(meta?.chains, chain),
    groups: rows(meta?.groups, group),
    insecureResources: strings(meta?.insecureResources),
    reachedThroughChain: strings(meta?.reachedThroughChain),
    truncated: finite(meta?.evidenceTruncated) ? meta.evidenceTruncated : null,
  };
}

export const namedProblems = (row: PageEvidenceRow): NamedProblem[] =>
  row.problems.filter((problem): problem is NamedProblem => namedProblemSet.has(problem));
